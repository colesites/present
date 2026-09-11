# ADR-002 — Video is decoded by the operating system, not by a bundled FFmpeg

**Status:** accepted · **Date:** 2026-09-11 · **Follows:** [ADR-001](adr-001-output-compositor.md)

## Context

ADR-001 made the audience output a Rust-composited surface. The compositor
draws backgrounds, shapes, text and images. It cannot draw video, because there
is no video decoder in this tree — which is the single largest gap in Stage 5
and the reason the output window is still a webview.

Two ways to get frames:

1. **Bundle FFmpeg.** Opens essentially every container and codec.
2. **Use the platform decoders.** AVFoundation/VideoToolbox on macOS, Media
   Foundation on Windows, and something yet to be chosen on Linux.

## Decision

**Option 2, the platform decoders. macOS first.**

## Why

**It is what comparable software does.** ProPresenter is built on the OS media
frameworks rather than shipping its own decoder, which is also why its guidance
to churches is about *codecs* rather than settings — it asks people to convert
media into what the OS decodes well.

**Decode quality is identical and colour handling is safer.** H.264 is a
deterministic standard: the same file produces the same pixels either way. The
differences that actually show on a projector are around the decode, and the
worst of them is colour — BT.601 against BT.709, full range against limited.
Getting it wrong looks like washed-out blacks. Asking VideoToolbox for BGRA
makes that the OS's problem, in hardware, rather than ours.

**The cost difference is not marginal.** Software-decoding 1080p H.264 is
roughly a core; the hardware path uses a dedicated video block and barely
touches the CPU or the battery. Frames also arrive without FFmpeg's tens of
megabytes in the installer and without LGPL obligations on a shipped app.

## Consequences

### Paid

**Some files will not play, and the app has to say so.** The media panel accepts
`.mkv` and `.avi`, and AVFoundation opens neither. VP9 inside `.webm` is not
reliable either. FFmpeg would open all of them. This is a real regression
against the Electron build, where Chromium's own decoders handled more.

**Measured against the owner's actual library, that cost is currently zero.**
Sixty-seven videos across the media folders, and **not one** is in a container
AVFoundation cannot open — every file is MP4 or MOV. Eight of them, from 720p to
2048×1152, were decoded end to end: correct dimensions, correct colour, and
seeks landing on the requested second. The gap is real and still needs the
warning, because the next file somebody adds could be an `.avi` from a wedding
videographer. It is not, today, a gap anyone is standing in.

**It must fail loudly.** A volunteer dropping an unsupported file into a media
folder needs to be told before the service, not shown a black rectangle during
it. That is a UI requirement this decision creates, not an implementation
detail.

**Done.** An unplayable file carries an amber border and warning badge in the
media panel, with advice that names the file and the next step rather than
diagnosing the container. The check returns only the problems, so a library of
MP4s costs one round trip and an empty array, and it asks about the visible
items rather than the whole library. Tauri only: under Electron the media goes
through Chromium, which opens more.

**Three backends over time.** macOS is the only platform this migration has run
on, so it is the only one being written now. Windows and Linux inherit the same
trait and an unimplemented backend, which is honest about where the work is.

### Gained

- Hardware decode, so video costs the CPU almost nothing during a service.
- Correct colour conversion without writing the conversion.
- Nothing added to the installer, and no licence obligations.
- The same path the software these users already know has taken.

## Why `AVAssetReader` rather than `AVPlayer`

`MediaPlayback` in `services/playback.rs` already owns play, pause, seek and
position. `AVPlayer` would bring its own clock, and two clocks for one video is
how drift and double-seeking start. `AVAssetReader` is a pull interface: the
compositor asks for the next frame, which is exactly the shape a frame pipeline
wants.

The cost is that seeking means rebuilding the reader over a new time range.
Acceptable here — worship video is overwhelmingly linear playback of loops and
bumpers, not scrubbing.

## Rejected

**Bundling FFmpeg** was rejected on installer size, licence obligations, and CPU
cost during a live service, not on capability. It genuinely opens more files.

**FFmpeg as a front end to hardware decode** (its `videotoolbox` backend) was
rejected as the worst of both: the bundle and the licence, to end up calling the
same OS decoder this decision calls directly.

## Open, deliberately

**HAP.** A codec that stores frames already in GPU texture form, widely used in
this field for performance-critical playback. Cheap to decode and worth adding
if anyone runs video-heavy sets. Not needed to reach parity.
