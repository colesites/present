# ADR-004 — A playing video is shown by the GPU as it was decoded

**Status:** accepted · **Date:** 2026-11-02 · **Builds on:** [ADR-003](adr-003-ffmpeg-video-decode.md)

## Context

ADR-003 decoded every video on the GPU and then copied every frame off it.
Measured in this change (`examples/projection_bench`), each frame of a 1080p
video playing behind a lyric went through, for each screen:

| Step | Where | Per frame, 1080p |
|---|---|---|
| Copy off the GPU (NV12) | decoder's convert thread | 3 MB |
| Split NV12 into planar YUV | convert thread | 3 MB |
| YUV → BGRA (swscale) | convert thread | 8 MB written |
| Rows copied into a `Vec` | convert thread | 8 MB |
| Video copied into the compositor's frame | screen loop | 8 MB |
| Slide layer blended over it | screen loop | 8 MB read, partly written |
| RGBA → BGRA for the view | screen loop | 8 MB in, 8 MB out |
| Into the window's IOSurface | screen loop, per window | 8 MB |
| Into the preview panel's IOSurface | preview loop | 8 MB |

Fifty to sixty megabytes of memory traffic and several milliseconds of
processor a frame, thirty times a second, for a picture whose slide had not
changed. Three screens tripled the screen-loop half.

## Decision

**A screen that shows a background video is drawn as layers the window server
composites on the GPU** (`surface/layered.rs`, `surface/layers.rs`):

```text
canvas            the screen's colour
 ├─ clip          the box the video is clipped to
 │   └─ video     VideoToolbox's own IOSurface — no copy, no conversion
 └─ overlay       the slide, timer, props and banner over transparency,
                  drawn only when they change
```

- **The decoder hands the frame over as it is** (`video/picture.rs`). It is
  made the screen's size on the GPU (`scale_vt`) when it is larger, so a 4K
  video on a 1080p projector is never more than 1080p past the decoder.
- **Colour is tagged to match the processor's conversion**: the matrix the
  file declares (BT.709 from 720 lines when it declares none, BT.601 below),
  BT.709 primaries and the sRGB transfer function. Measured on the owner's
  MacBook Pro with a test chart shown both ways and read back from the
  screen: every patch within one level. Untagged, Core Animation treats HD as
  SD; tagged with the BT.709 transfer function it lifts mid-grey from 128 to
  140 (QuickTime's gamma shift).
- **Whole pictures are still drawn where layers cannot show a screen**: a
  transition that blends whole pictures, colour adjustments on the media, the
  screen composer, a video the GPU turned down, a screen split over windows.
  Going from layers to a whole picture, the screen as it stood is drawn first
  from the very frame it showed, so a transition starts from what was on
  screen.
- **Anything that needs pixels converts a GPU frame once per size**
  (`Resizer::convert_picture`): NDI, a screen mid transition. The shared
  decoder (`video/live.rs`) hands frames over on the GPU only while something
  that shows them so has asked in the last three seconds; otherwise it
  converts every frame as before.
- **A playing video is decoded three frames ahead** of the picture furthest
  ahead (`video/live.rs`, `DECODE_AHEAD`). VideoToolbox now and then takes 50
  to 120 ms over a frame on the owner's MacBook Pro, in either mode, and a
  decoder that stopped at the moment asked for showed each of those as a
  frame held too long. A frame on the GPU costs nothing to keep, so the lead
  is free; it took late frames in 90 s from about 115 to 0–2.
- **The operator's panels show the same layers**: the preview shows the
  screen's own surfaces, the center pane the decoder's.
- Each picture is kept until the window server has let go of its surface, so
  the decoder never writes a frame into one on screen.
- Settings ▸ Projection holds the operator's targets (`services/projection`):
  presets from Very Low (720p, 24 fps) to Highest (2160p, 60 fps), hardware
  decoding, rendering mode (Compatibility draws every picture whole, as
  before), power mode and automatic adjustment.

## Measured

See the performance report delivered with this change; the benchmarks are
`examples/projection_bench` (the app's loops, headless) and
`examples/present_probe` (real windows, with the window server's share).

## Consequences

- macOS only. Windows and Linux draw whole pictures as before; the same shape
  fits D3D11 and VA-API surfaces when those platforms get a native view.
- A GPU frame held by a screen is a decoder surface not reused; the shared
  decoder keeps at most twelve frames ahead, as it did.
- The rendering mode setting is the way back to whole pictures, for telling
  whether a problem is in the layers.

## Rejected

**AVSampleBufferDisplayLayer.** Measured with the same chart, it shows the same
colours as a plain layer given the surface, and adds a timebase, a queue and
failure states to manage. The plain layer reuses the mechanism the audience
view already used for its pictures.

**A wgpu compositor for every case.** It would draw transitions and filters on
the GPU too, and is the larger change ADR-001 left for later. The layers take
the common case — a slide over a playing video — off the processor today.
