// SDI out through a Blackmagic DeckLink or UltraStudio device
// (`src/services/sdi.rs`).
//
// DeckLink's API is C++ interfaces in the COM style, so this small layer
// turns the part Present needs into plain C calls: the devices that can play
// out, and one output fed a BGRA picture at a time.
//
// The output runs on the card's own clock. Frames are scheduled a few ahead,
// and each time the card finishes one the newest picture Present has handed
// over is scheduled next, the same one again if nothing newer came. Present
// never waits on the card, and the card never waits on Present.
//
// The API itself is Blackmagic Desktop Video's, installed with its drivers.
// DeckLinkAPIDispatch.cpp finds it in /Library/Frameworks when first asked,
// so Present starts, and says SDI is unavailable, on a computer without it.

#include <atomic>
#include <cstdint>
#include <cstring>
#include <mutex>
#include <vector>

#include "DeckLinkAPI.h"

namespace {

// Frames in flight on the card before playback starts, and kept there after.
constexpr int kPreroll = 3;
// The preroll, the newest picture, and one being written.
constexpr int kFrames = kPreroll + 2;

void copy_error(char* out, int length, const char* message) {
    if (out == nullptr || length <= 0) return;
    std::strncpy(out, message, static_cast<size_t>(length) - 1);
    out[length - 1] = '\0';
}

bool same_iid(REFIID a, REFIID b) {
    return std::memcmp(&a, &b, sizeof(REFIID)) == 0;
}

int64_t persistent_id(IDeckLink* device, int index) {
    IDeckLinkProfileAttributes* attributes = nullptr;
    int64_t id = 0;
    if (device->QueryInterface(IID_IDeckLinkProfileAttributes, reinterpret_cast<void**>(&attributes)) == S_OK) {
        if (attributes->GetInt(BMDDeckLinkPersistentID, &id) != S_OK) id = 0;
        attributes->Release();
    }
    // A device that has no persistent id is known by where it is in the list.
    return id != 0 ? id : -(static_cast<int64_t>(index) + 1);
}

bool plays_out(IDeckLink* device) {
    IDeckLinkProfileAttributes* attributes = nullptr;
    int64_t support = 0;
    if (device->QueryInterface(IID_IDeckLinkProfileAttributes, reinterpret_cast<void**>(&attributes)) != S_OK) {
        return false;
    }
    const bool known = attributes->GetInt(BMDDeckLinkVideoIOSupport, &support) == S_OK;
    attributes->Release();
    return known && (support & bmdDeviceSupportsPlayback) != 0;
}

// BT.709, studio range, for a card that takes only 8-bit YUV.
inline void bgra_to_uyvy(const uint8_t* bgra, uint8_t* uyvy, long width) {
    for (long x = 0; x + 1 < width; x += 2) {
        const int b0 = bgra[0], g0 = bgra[1], r0 = bgra[2];
        const int b1 = bgra[4], g1 = bgra[5], r1 = bgra[6];
        const int y0 = ((47 * r0 + 157 * g0 + 16 * b0 + 128) >> 8) + 16;
        const int y1 = ((47 * r1 + 157 * g1 + 16 * b1 + 128) >> 8) + 16;
        const int r = (r0 + r1) / 2, g = (g0 + g1) / 2, b = (b0 + b1) / 2;
        const int u = ((-26 * r - 87 * g + 112 * b + 128) >> 8) + 128;
        const int v = ((112 * r - 102 * g - 10 * b + 128) >> 8) + 128;
        uyvy[0] = static_cast<uint8_t>(u);
        uyvy[1] = static_cast<uint8_t>(y0);
        uyvy[2] = static_cast<uint8_t>(v);
        uyvy[3] = static_cast<uint8_t>(y1);
        bgra += 8;
        uyvy += 4;
    }
}

class Output final : public IDeckLinkVideoOutputCallback {
public:
    IDeckLink* device = nullptr;
    IDeckLinkOutput* output = nullptr;
    long width = 0;
    long height = 0;
    BMDTimeValue duration = 0;
    BMDTimeScale scale = 0;
    BMDPixelFormat format = bmdFormat8BitBGRA;

    struct Slot {
        IDeckLinkMutableVideoFrame* frame = nullptr;
        int queued = 0;       // times it is scheduled and not yet shown
        bool writing = false;
    };
    Slot slots[kFrames];

    // Every slot, the newest picture and the stream's clock.
    std::mutex lock;
    int newest = 0;
    int64_t next = 0;
    bool stopping = false;

    std::atomic<ULONG> references{1};

    // The newest picture, or black before there is one, onto the card.
    // Called with `lock` held.
    void schedule_next() {
        Slot& slot = slots[newest];
        if (output->ScheduleVideoFrame(slot.frame, next * duration, duration, scale) == S_OK) {
            slot.queued += 1;
            next += 1;
        }
    }

    HRESULT STDMETHODCALLTYPE ScheduledFrameCompleted(IDeckLinkVideoFrame* completed,
                                                      BMDOutputFrameCompletionResult) override {
        std::lock_guard<std::mutex> guard(lock);
        for (Slot& slot : slots) {
            if (slot.frame == completed && slot.queued > 0) {
                slot.queued -= 1;
                break;
            }
        }
        if (!stopping) schedule_next();
        return S_OK;
    }

    HRESULT STDMETHODCALLTYPE ScheduledPlaybackHasStopped() override { return S_OK; }

    HRESULT STDMETHODCALLTYPE QueryInterface(REFIID iid, LPVOID* object) override {
        if (object == nullptr) return E_INVALIDARG;
        CFUUIDBytes unknown = CFUUIDGetUUIDBytes(IUnknownUUID);
        if (same_iid(iid, unknown) || same_iid(iid, IID_IDeckLinkVideoOutputCallback)) {
            *object = static_cast<IDeckLinkVideoOutputCallback*>(this);
            AddRef();
            return S_OK;
        }
        *object = nullptr;
        return E_NOINTERFACE;
    }

    ULONG STDMETHODCALLTYPE AddRef() override { return references.fetch_add(1) + 1; }

    ULONG STDMETHODCALLTYPE Release() override {
        const ULONG left = references.fetch_sub(1) - 1;
        if (left == 0) delete this;
        return left;
    }

    // Write one picture into a free slot and make it the newest.
    bool send(const uint8_t* bgra, long picture_width, long picture_height) {
        int chosen = -1;
        {
            std::lock_guard<std::mutex> guard(lock);
            for (int index = 0; index < kFrames; index += 1) {
                Slot& slot = slots[index];
                if (index != newest && slot.queued == 0 && !slot.writing) {
                    chosen = index;
                    slot.writing = true;
                    break;
                }
            }
        }
        // Every slot on the card: this picture is dropped, the card shows the last.
        if (chosen < 0) return true;

        IDeckLinkMutableVideoFrame* frame = slots[chosen].frame;
        void* bytes = nullptr;
        const bool writable = frame->GetBytes(&bytes) == S_OK && bytes != nullptr;
        if (writable) {
            auto* destination = static_cast<uint8_t*>(bytes);
            const long row_bytes = frame->GetRowBytes();
            const long rows = picture_height < height ? picture_height : height;
            const long columns = picture_width < width ? picture_width : width;
            for (long y = 0; y < height; y += 1) {
                uint8_t* row = destination + y * row_bytes;
                if (y >= rows) {
                    std::memset(row, format == bmdFormat8BitBGRA ? 0 : 0x10, static_cast<size_t>(row_bytes));
                    continue;
                }
                const uint8_t* source = bgra + static_cast<size_t>(y) * static_cast<size_t>(picture_width) * 4;
                if (format == bmdFormat8BitBGRA) {
                    std::memcpy(row, source, static_cast<size_t>(columns) * 4);
                } else {
                    bgra_to_uyvy(source, row, columns);
                }
            }
        }

        std::lock_guard<std::mutex> guard(lock);
        slots[chosen].writing = false;
        if (writable) newest = chosen;
        return writable;
    }
};

void fill_black(IDeckLinkMutableVideoFrame* frame, BMDPixelFormat format) {
    void* bytes = nullptr;
    if (frame->GetBytes(&bytes) != S_OK || bytes == nullptr) return;
    const long size = frame->GetRowBytes() * frame->GetHeight();
    if (format == bmdFormat8BitBGRA) {
        auto* pixels = static_cast<uint8_t*>(bytes);
        for (long index = 0; index < size; index += 4) {
            pixels[index] = 0;
            pixels[index + 1] = 0;
            pixels[index + 2] = 0;
            pixels[index + 3] = 255;
        }
    } else {
        auto* pixels = static_cast<uint8_t*>(bytes);
        for (long index = 0; index + 3 < size; index += 4) {
            pixels[index] = 128;
            pixels[index + 1] = 16;
            pixels[index + 2] = 128;
            pixels[index + 3] = 16;
        }
    }
}

bool supports(IDeckLinkOutput* output, BMDDisplayMode mode, BMDPixelFormat format) {
    bool supported = false;
    BMDDisplayMode actual = 0;
    return output->DoesSupportVideoMode(bmdVideoConnectionUnspecified, mode, format, bmdNoVideoOutputConversion,
                                        bmdSupportedVideoModeDefault, &actual, &supported) == S_OK &&
           supported;
}

void close_output(Output* out) {
    {
        std::lock_guard<std::mutex> guard(out->lock);
        out->stopping = true;
    }
    if (out->output != nullptr) {
        // A time scale of 0 stops at once; disabling the output flushes what
        // is still scheduled before the callback is let go.
        BMDTimeValue stopped = 0;
        out->output->StopScheduledPlayback(0, &stopped, 0);
        out->output->DisableVideoOutput();
        out->output->SetScheduledFrameCompletionCallback(nullptr);
    }
    for (auto& slot : out->slots) {
        if (slot.frame != nullptr) slot.frame->Release();
        slot.frame = nullptr;
    }
    if (out->output != nullptr) out->output->Release();
    if (out->device != nullptr) out->device->Release();
    out->output = nullptr;
    out->device = nullptr;
    out->Release();
}

}  // namespace

extern "C" {

struct PresentDeckLinkDevice {
    int64_t id;
    char name[128];
};

// Whether Blackmagic Desktop Video is installed.
int present_decklink_available(void) {
    IDeckLinkIterator* iterator = CreateDeckLinkIteratorInstance();
    if (iterator == nullptr) return 0;
    iterator->Release();
    return 1;
}

// The devices that can play out, up to `max` of them. Returns how many.
int present_decklink_devices(PresentDeckLinkDevice* out, int max) {
    IDeckLinkIterator* iterator = CreateDeckLinkIteratorInstance();
    if (iterator == nullptr) return 0;
    int count = 0;
    int index = 0;
    IDeckLink* device = nullptr;
    while (count < max && iterator->Next(&device) == S_OK) {
        if (plays_out(device)) {
            out[count].id = persistent_id(device, index);
            out[count].name[0] = '\0';
            CFStringRef name = nullptr;
            if (device->GetDisplayName(&name) == S_OK && name != nullptr) {
                CFStringGetCString(name, out[count].name, sizeof(out[count].name), kCFStringEncodingUTF8);
                CFRelease(name);
            }
            count += 1;
        }
        device->Release();
        index += 1;
    }
    iterator->Release();
    return count;
}

// Start playing out on device `id` in `mode`, black until the first picture.
// Returns null, with the reason in `error`, when it can't.
void* present_decklink_open(int64_t id, uint32_t mode, uint32_t* width, uint32_t* height, char* error,
                            int error_length) {
    IDeckLinkIterator* iterator = CreateDeckLinkIteratorInstance();
    if (iterator == nullptr) {
        copy_error(error, error_length, "Blackmagic Desktop Video isn't installed on this computer.");
        return nullptr;
    }
    IDeckLink* found = nullptr;
    IDeckLink* device = nullptr;
    int index = 0;
    while (found == nullptr && iterator->Next(&device) == S_OK) {
        if (persistent_id(device, index) == id) {
            found = device;
        } else {
            device->Release();
        }
        index += 1;
    }
    iterator->Release();
    if (found == nullptr) {
        copy_error(error, error_length, "That DeckLink device isn't connected.");
        return nullptr;
    }

    auto* out = new Output();
    out->device = found;
    if (found->QueryInterface(IID_IDeckLinkOutput, reinterpret_cast<void**>(&out->output)) != S_OK) {
        out->output = nullptr;
        copy_error(error, error_length, "That DeckLink device can't play out.");
        close_output(out);
        return nullptr;
    }

    if (supports(out->output, mode, bmdFormat8BitBGRA)) {
        out->format = bmdFormat8BitBGRA;
    } else if (supports(out->output, mode, bmdFormat8BitYUV)) {
        out->format = bmdFormat8BitYUV;
    } else {
        copy_error(error, error_length, "That DeckLink device can't play out in this video mode.");
        close_output(out);
        return nullptr;
    }

    IDeckLinkDisplayMode* display_mode = nullptr;
    if (out->output->GetDisplayMode(mode, &display_mode) != S_OK || display_mode == nullptr) {
        copy_error(error, error_length, "That DeckLink device doesn't know this video mode.");
        close_output(out);
        return nullptr;
    }
    out->width = display_mode->GetWidth();
    out->height = display_mode->GetHeight();
    display_mode->GetFrameRate(&out->duration, &out->scale);
    display_mode->Release();

    if (out->output->EnableVideoOutput(mode, bmdVideoOutputFlagDefault) != S_OK) {
        copy_error(error, error_length, "The DeckLink device is in use by another app.");
        close_output(out);
        return nullptr;
    }
    const long row_bytes = out->format == bmdFormat8BitBGRA ? out->width * 4 : out->width * 2;
    for (auto& slot : out->slots) {
        if (out->output->CreateVideoFrame(static_cast<int32_t>(out->width), static_cast<int32_t>(out->height),
                                          static_cast<int32_t>(row_bytes), out->format, bmdFrameFlagDefault,
                                          &slot.frame) != S_OK) {
            slot.frame = nullptr;
            copy_error(error, error_length, "The DeckLink device ran out of frame memory.");
            close_output(out);
            return nullptr;
        }
        fill_black(slot.frame, out->format);
    }

    out->output->SetScheduledFrameCompletionCallback(out);
    {
        std::lock_guard<std::mutex> guard(out->lock);
        for (int frame = 0; frame < kPreroll; frame += 1) out->schedule_next();
    }
    if (out->output->StartScheduledPlayback(0, out->scale, 1.0) != S_OK) {
        copy_error(error, error_length, "The DeckLink device wouldn't start playing out.");
        close_output(out);
        return nullptr;
    }
    if (width != nullptr) *width = static_cast<uint32_t>(out->width);
    if (height != nullptr) *height = static_cast<uint32_t>(out->height);
    return out;
}

// Hand over a picture. It is shown from the card's next free frame on.
int present_decklink_send(void* handle, const uint8_t* bgra, uint32_t width, uint32_t height) {
    if (handle == nullptr || bgra == nullptr) return 0;
    return static_cast<Output*>(handle)->send(bgra, static_cast<long>(width), static_cast<long>(height)) ? 1 : 0;
}

// Stop playing out and let the device go.
void present_decklink_close(void* handle) {
    if (handle != nullptr) close_output(static_cast<Output*>(handle));
}

}  // extern "C"
