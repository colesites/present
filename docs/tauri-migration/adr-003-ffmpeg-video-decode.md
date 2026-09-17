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
- **Frames come out as BGRA at the size the caller asked for.** On macOS a
  GPU frame larger than that is shrunk on the GPU first (`scale_vt`), so only
  the shown size is copied off it. What the CPU still resizes goes through
  swscale's bilinear filter, sliced across every core. A GPU frame already at
  the right size is split into planar YUV, which takes swscale's fast path
  to BGRA.
- **Decoding runs ahead on its own thread** (`read_ahead.rs`), two frames
  deep, as AVFoundation's reader did. The stream takes whatever frame is
  ready and never waits once one is on screen (known-issues §22).
- `PRESENT_VIDEO_SOFTWARE=1` turns GPU decoding off, for diagnosis.

## Measured

On the owner's machine: a 2018 15-inch MacBook Pro (i7-8750H, UHD 630 and
Radeon Pro 555X), five files from the owner's own library, decoded at 1920×1080
by both decoders (`examples/decoder_compare.rs`, removed with the
AVFoundation decoder; it is in `4678b77`). Load from other apps
varied between runs, so the timings below are ranges.

| File | AVFoundation | FFmpeg |
|---|---|---|
| 720p H.264, BT.709 | decodes | GPU; mean difference ≤ 0.4 levels |
| 1080p H.264, colour undeclared | decodes | GPU; mean difference ≤ 0.3, largest single 2 |
| 4K H.264, BT.709 | decodes | GPU; mean difference ≤ 1.9 |
| 1080p H.264 4:2:2, full range | **"Cannot Decode"** | software |
| 1080p H.264 4:2:2 10-bit | **"Cannot Decode"** | software |

- **Colour matches.** The largest single-pixel differences on the 4K file
  (109 shrunk on the GPU, up to 190 when the CPU shrank it) are thin
  saturated lines. AVFoundation blurs their colour
  into the background, and FFmpeg keeps it. That is detail, not a matrix
  mistake.
- **Seeks land on the frame asked for**, on both decoders. FFmpeg reports the
  frame's own time (3.003 s at 29.97 fps), where AVFoundation reports the time
  asked for.
- **Where the time goes at 4K.** Measured inside the decoder under load:

  | Step | First version | Now |
  |---|---|---|
  | GPU decode, including the wait for it | 17–24 ms | same |
  | Shrink on the GPU | — | 2–3 ms |
  | Copy off the GPU | 10–17 ms (4K) | 2 ms (1080p) |
  | Colour conversion and scaling | 9–20 ms | about 3 ms (FFmpeg's own tool, 1080p) |

  Slicing the scaler across cores cut its time to about a quarter. More
  decoder threads made no difference on the GPU path. FFmpeg's VideoToolbox
  decoder waits for each frame; AVFoundation's reader decodes ahead by itself.
- **End to end, on the NDI stream** (`examples/ndi_stream_probe`):

  | Background | FFmpeg | AVFoundation |
  |---|---|---|
  | 1080p | 28–30 fps; video 28–29 fps (17 in one run) | 30 fps; video 25–29 fps |
  | 4K | 30 fps; video 25–27 fps, up to 0.5 s behind | 30 fps; video 25–29 fps, within 15 ms |

  The first version, without GPU shrinking, decoding ahead or the stream that
  does not wait, took the whole stream down to 2 fps at 4K
  (known-issues §22).
- **Still slower than AVFoundation at 4K on this Mac.** The GPU decode's wait
  runs in turn with the copy and conversion on one thread. Splitting them
  would help. The wgpu compositor takes frames on the GPU and removes the copy
  and conversion altogether.

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
`PRESENT_VIDEO_DECODER=avfoundation`, and removed in `bf486f6`.

**Software decoding only.** A 4K frame costs 30–80 ms on this machine, over
the 33 ms a 30 fps output has.

**Converting colour on the GPU too** (VideoToolbox's pixel transfer to BGRA).
It would be faster again, but it is a second set of colour rules, and
macOS-only; the CPU conversion is now about 3 ms, and wgpu will do it in a
shader.

**Linking FFmpeg statically.** It is simpler to ship, but under the LGPL a
closed app would then have to let users relink it against their own FFmpeg.
Shared libraries meet that obligation by being replaceable.
