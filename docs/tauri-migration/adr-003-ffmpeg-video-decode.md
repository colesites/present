# ADR-003 — Video is decoded by FFmpeg, on the GPU where the platform allows

**Status:** accepted · **Date:** 2026-09-17 · **Supersedes:** [ADR-002](adr-002-video-decode.md)

## Context

ADR-002 chose the operating systems' own decoders, and only macOS's was ever
written. Windows and Linux had a trait and no decoder. On 2026-09-15 the owner
chose FFmpeg on every platform instead: one decoder, one set of colour rules,
one pipeline to test, and the containers AVFoundation turns down.

Everything that turns a file into frames goes through `services::video`: the
compositor, the NDI stream, the native audience surface, and thumbnails. The
operator's windows still play video with WebKit's `<video>`, which this
decision does not change.

## Decision

**`services::video::ffmpeg` decodes every video, on every platform.**

- **On the GPU first.** VideoToolbox on macOS, D3D11 then DXVA2 on Windows,
  VA-API on Linux, attached through FFmpeg's hardware device API.
- **In software, on every core, when the GPU turns a file down.** It is found
  out at open: the first frame is decoded there and then. A GPU decoder refuses
  a file in three different ways: an error, no frames at all, or quietly
  passing the job to FFmpeg's software decoder on a single thread. All three
  reopen the file in software, and the switch is logged. If the GPU fails
  partway through a file, playback continues in software from the frame after
  the last one shown.
- **Colour follows the file, with the players' defaults when it says nothing**:
  BT.709 from 720 lines up, BT.601 below it, and limited range unless the file
  says otherwise or the pixel format is a full-range `yuvj` one. Most of the
  owner's library declares nothing.
- **Frames come out as BGRA at the size the caller asked for.** They are
  scaled with swscale's bilinear filter, sliced across every core.
  `PRESENT_VIDEO_SOFTWARE=1` turns GPU decoding off, for diagnosis.

## Measured

On the owner's machine: a 2018 15-inch MacBook Pro (i7-8750H, UHD 630 and
Radeon Pro 555X), five files from the owner's own library, decoded at 1920×1080
by both decoders (`examples/decoder_compare.rs`). Load from other apps
varied between runs, so the timings below are ranges.

| File | AVFoundation | FFmpeg |
|---|---|---|
| 720p H.264, BT.709 | decodes | GPU; mean difference ≤ 0.4 levels |
| 1080p H.264, colour undeclared | decodes | GPU; mean difference ≤ 0.3, largest single 2 |
| 4K H.264, BT.709 | decodes | GPU; mean difference ≤ 1.7 |
| 1080p H.264 4:2:2, full range | **"Cannot Decode"** | software |
| 1080p H.264 4:2:2 10-bit | **"Cannot Decode"** | software |

- **Colour matches.** The largest single-pixel differences on the 4K file
  (up to about 190) are thin saturated lines. AVFoundation blurs their colour
  into the background, and FFmpeg keeps it. That is detail, not a matrix
  mistake.
- **Seeks land on the frame asked for**, on both decoders. FFmpeg reports the
  frame's own time (3.003 s at 29.97 fps), where AVFoundation reports the time
  asked for.
- **Where the time goes at 4K:** the GPU decode itself sets the pace. FFmpeg's
  command-line tool manages about 70–100 fps on this machine however the frames
  are handled afterwards. Copying a decoded 4K frame off the GPU took 10–17 ms
  and scaling it 9–12 ms, against 30–40 ms for a software decode. Slicing the
  scaler across cores cut its time to about a quarter. More decoder threads
  made no difference on the GPU path.
- **Scaling on the GPU** (FFmpeg's `scale_vt`) halved the CPU time of the 4K
  path but not the wall time, so it was not added. The wgpu compositor will
  take frames on the GPU directly, which removes this step altogether.

## Consequences

### Paid

- **The app must ship FFmpeg, and only an LGPL build of it**: shared
  libraries, no `--enable-gpl`, and no non-free parts. Homebrew's FFmpeg is a
  GPL build and must never be bundled. Until the bundles carry their own build
  (HANDOFF §4), a machine without FFmpeg installed cannot decode video in a
  bundle built by CI.
- **CI builds against FFmpeg on all three platforms**: Homebrew on macOS,
  vcpkg (LGPL features) on Windows, and Ubuntu 24.04's FFmpeg 6.1. 22.04 has
  4.4, and the decoder needs 5.0 or later for sliced scaling. This raises the
  Linux bundle's glibc floor until FFmpeg is bundled.
- **Some installer size**, a few tens of megabytes of libraries.

### Gained

- One decoder, one set of colour rules and one set of tests on every
  platform. Windows and Linux have a decoder for the first time.
- Files AVFoundation cannot open now decode, including 4:2:2 H.264 from
  cameras and editing software.
- The tests make their own clips with FFmpeg's encoders (lossless FFV1 for
  colour; MPEG-4 and, on a Mac, VideoToolbox H.264 for seeking). No fixtures
  are committed.

### Unchanged

- **The media panel's warning for MKV, AVI and WebM stays.** The operator's
  preview, show grid and media panel play video in WebKit, which still cannot
  open those files, even though the audience output could. Converting on
  import (FFmpeg can remux or re-encode with LGPL-safe encoders) is the way to
  close that gap, and it is not built.
- The transport still owns play, pause and position; the decoder is still a
  pull interface with no clock of its own (ADR-002's reasoning holds).

## Rejected

**Keeping AVFoundation on macOS and FFmpeg elsewhere.** It is two pipelines
with two sets of colour rules, and AVFoundation already fails on files FFmpeg
opens. It was kept only while the two were compared, behind
`PRESENT_VIDEO_DECODER=avfoundation`, and is being removed.

**Software decoding only.** A 4K frame costs 30–80 ms on this machine, over
the 33 ms a 30 fps output has.

**Linking FFmpeg statically.** It is simpler to ship, but under the LGPL a
closed app would then have to let users relink it against their own FFmpeg.
Shared libraries meet that obligation by being replaceable.
