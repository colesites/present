# After Stage 7 — the owner's crate list, and FFmpeg

Work done after Electron was removed (HANDOFF §4), in the order the owner
asked for it. Each section says what was built, how it was checked, and what was
not.

## 1. Log files and frame-time benchmarks — `d702389`

**Log files** (`tracing-appender`, `services/log_files.rs`). Every line the
terminal shows also goes to a file per day in the folder Tauri uses for app
logs (`~/Library/Logs/space.multivrs.present` on macOS), and the last fourteen
are kept. Before this, a service left nothing behind but the redacted error
log, which records the error and none of what led to it. Lines are written
synchronously, because the app exits without unwinding and a buffered writer
would lose the last ones.

**Benchmarks** (`criterion`, `benches/frame_time.rs`).
`cargo bench --bench frame_time --profile perf` measures a 1080p audience frame
drawn from generated media, so it runs anywhere. On the development Mac:

| Frame | Time |
|---|---|
| Slide drawn from nothing | 23.7 ms |
| Cached slide over a playing video | 5.4 ms |
| Frame to BGRA for NDI | 1.8 ms |

NDI's budget is 33.3 ms.

## 2. Media folders that update live — `8bc25a9`

`services/media_watch.rs` watches every media folder (FSEvents on macOS,
ReadDirectoryChangesW on Windows, inotify on Linux). Once a burst of changes
has been quiet for 300 ms, it emits `media:folders-changed` and the panel
re-reads. Five quick writes produce one or two announcements, not five. A
re-read keeps the current items on screen instead of flashing the loading
state.

**Found on the way:** the panel kept its folder list in IndexedDB, while Rust
kept its own in `media-folders.json`. Removing a folder in the panel never
told Rust, so the app could still read that folder, and each build had its own
list. The panel now uses Rust's list. Creating or renaming a folder registers
it through `add_media_folder`, which accepts only a path the app may already
read.

**Verified in the app** with a scratch folder, removed afterwards: a copied
file appeared in the panel 120 ms after the event and disappeared when deleted,
with no empty frame in between. **Not run** on Windows or Linux.

## 3. OpenLyrics import — `41e657b`

OpenLyrics is the format OpenLP, Quelea and others export. The Libraries
panel's import button now offers it beside Present's own library export.

`services/openlyrics.rs` (`quick-xml`) reads a song into:

- a title
- its credits: words, music and translation authors, each listed once
- copyright and CCLI number
- a body in the lyrics editor's own form: a `[Verse 1]` header over each
  slide, verses in the song's `verseOrder` with repeats, and a verse split
  into several `<lines>` as one slide per part

Chords, comments and instrumental sections are left out, and a translated
verse keeps its first language. A file that is not an OpenLyrics song, is cut
off, or has no title is refused with a message, and the other files still
import.

**Verified:** the parser's cases in unit tests. In the app, the library's own
slide builder read a parsed body into the five labelled slides expected.
**Not verified:** picking files in the dialog by hand.

## 4. FFmpeg decodes video — `f18c37c`, `4678b77`, `bf486f6`, ADR-003

`services/video/ffmpeg.rs` decodes for the compositor, the NDI stream, the
native audience surface and thumbnails, on every platform. The reasoning and
measurements are in [ADR-003](adr-003-ffmpeg-video-decode.md). In short:

- **GPU first:** VideoToolbox, D3D11/DXVA2 or VA-API. **Software, on every
  core, when the GPU turns a file down.** That is settled on the first frame,
  at open, and a GPU failure mid-file carries on in software from the next
  frame.
- **Colour:** the file's own matrix and range, or BT.709 from 720 lines up /
  BT.601 below, limited range unless it is a `yuvj` format.
- **Frames:** BGRA at the requested size. On macOS a larger GPU frame is
  shrunk on the GPU (`scale_vt`, `gpu_scale.rs`) before it is copied off. A
  GPU frame at the right size is split into planar YUV for swscale's fast path.
  Anything else is scaled with bilinear swscale sliced across every core.
- **Decoding ahead** (`read_ahead.rs`): a worker keeps two frames ready. The
  NDI stream and the native surface take what is ready
  (`VideoDecoder::poll_frame`) and never wait once a frame is on screen.
- `PRESENT_VIDEO_SOFTWARE=1` rules the GPU out, for diagnosis.

**What the first version did to the NDI stream** (known-issues §22): with a
4K background it fell to 2 fps, because the stream waited for each frame and
FFmpeg's GPU decode, copy and CPU shrink took longer than a frame. With the
three changes above, the stream holds 30 fps at 4K. The video inside it runs
at 25–27 fps on this Mac and drifts up to half a second behind before a seek
catches it up; AVFoundation kept 4K within 15 ms. At 1080p FFmpeg matched
it in two runs of three; the third, on a busy machine, showed 17 fps of
video.

**Tests** write their own clips with FFmpeg's encoders and delete them:

- colour for undeclared HD and SD and for a declared matrix and range,
  including scaled, on lossless FFV1
- seeking between key frames on MPEG-4 Part 2, which this Mac's GPU refuses,
  so it covers the software path
- the same seek test on H.264 from the Mac's own encoder, which covers the GPU
  path (a CI virtual Mac may run it in software)
- a GPU frame shrunk on the GPU, to an even and an odd size, keeping its
  colour
- the NV12 split, at an odd size
- the end of a clip staying the end until a seek
- a missing file reported as not found
- decoding ahead (`read_ahead.rs`, against a fake decoder): order, the end,
  nothing decoded before a seek handed out, errors, only two frames ahead,
  polling without waiting, and the worker stopping when dropped
- the feed (`video_feed.rs`): the last frame stays up while the decoder is
  behind, a seek on its way is not repeated, and a new seek replaces it

**Compared with AVFoundation**, before it was removed, on five of the
owner's files (`examples/decoder_compare.rs`, in `4678b77`), and end to end on the NDI stream
(`examples/ndi_stream_probe`, which now also reports how many video frames
reached the stream and how far behind the clock they were). Colour matches.
Seeks land on the same frames. FFmpeg also decodes the two 4:2:2 files
AVFoundation calls "Cannot Decode". The tables are in the ADR.

**Checked for Windows and Linux from macOS:** `clippy --all-targets -D
warnings` passes for both targets. The stage-7 §8 recipe now needs FFmpeg's
headers for the bindings, too:

- `FFMPEG_DIR=$(brew --prefix ffmpeg)`
- `BINDGEN_EXTRA_CLANG_ARGS_<target>="-isystem $(xcrun --show-sdk-path)/usr/include"`
- for Windows, also `-D__GNUC__=4` (so Darwin's headers use the compiler's
  `va_list`) and `-include` of a header that typedefs `ssize_t` as `long long`
  (Darwin's `long` is 4 bytes under Windows' type sizes)

**CI** installs FFmpeg on all three platforms (ADR-003). **Not run yet:**
Ubuntu 24.04's FFmpeg 6.1 build, and vcpkg's FFmpeg on Windows. Nothing has
been pushed.

**Not done:**

- **The bundles do not carry FFmpeg.** A bundle only decodes video on a
  machine with FFmpeg installed where the build found it. The app needs an
  LGPL-only shared build in each installer: in the app bundle's `Frameworks`
  with an `@rpath` on macOS, beside the executable on Windows, and in the
  AppImage or as `.deb` dependencies on Linux. Homebrew's FFmpeg is GPL and
  must not be shipped.
- **4K on a slow machine.** FFmpeg's GPU decode waits for each frame and
  runs in turn with the copy and colour conversion. Running decoding and
  conversion on separate threads would help, and wgpu would remove the copy
  and conversion.
- **Opening a video still waits**, inside the stream's frame: the file is
  opened and its first frame decoded before the stream moves on, as it was
  with AVFoundation.
- **MKV, AVI and WebM** are still refused, because the operator's windows play
  video in WebKit. Converting on import would lift that.
