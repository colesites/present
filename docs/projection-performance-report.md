# Video projection performance

2026-11-02 · measured on the 2018 15-inch MacBook Pro (i7-8750H, Radeon Pro 555X 4 GB + Intel UHD 630)

**Where a screen's video can be shown as layers (a lyric, scripture, timer or props over a background video, the common case), it now costs 4–7% of one core instead of 101–358%: 14 to 80 times less processor, with the same picture and colour.** Frames also arrive more evenly than before: 0–3 late frames in 15 s in all but one run, down from 8–140. The 4K 10-bit HEVC test clip now plays at a full 30 fps instead of 23. Screens that still draw whole pictures cost what they did.

| Scenario (15 s, old build → new build) | Processor, % of one core | Less | Late frames | Peak memory |
|---|---|---|---|---|
| 1 screen, 1080p30 H.264 | 114 → 4 | 28× | 29 → 1 | 162 → 103 MB |
| 1 screen + center pane, 1080p30 | 128 → 4 | 32× | 17 → 0 | 178 → 102 MB |
| 1 screen, 1080p60 H.264 | 237 → 6 | 40× | 69 → 0 | 211 → 105 MB |
| 3 screens, same 1080p30 | 319 → 4 | 80× | 32 → 21 (0, 0, 0 in three reruns) | 260 → 217 MB |
| 1 screen on 3 windows (mirrored), 1080p30 | 125 → 4 | 31× | 37 → 0 | 194 → 135 MB |
| 3 screens, same 4K30 H.264 | 358 → 6 | 60× | 140 → 3 | 295 → 255 MB |
| 1 screen, 4K30 10-bit HEVC | 101 → 7 | 14× | 8 → 3 (22.6 → 30.1 fps) | 188 → 160 MB |
| 3 screens, different videos (1080p, 720p, 4K) | 503 → 307 | 1.6× | 32 → 0 | 389 → 349 MB |
| 1 screen, 1080p 4:2:2 H.264 (the GPU refuses it) | 137 → 139 | none | 0 → 0 | 249 → 276 MB |

Measured on the 2018 15-inch MacBook Pro, CPU speed limit 100% for every run, each scenario old then new back to back. "Old build" is the last commit; "new" is this change. The processor column is this app's process; the window server's share is in the second table below.

## Where the time went

The video was already decoded once on the GPU (VideoToolbox) and shared by every screen (`video/live.rs`). The cost was everything after the decoder. For each frame of a 1080p video behind a lyric:

| Step | Thread | Memory moved per frame |
|---|---|---|
| Copy the frame off the GPU (NV12) | decoder's convert thread | 3 MB |
| Split NV12 into planar YUV | convert thread | 3 MB |
| YUV → BGRA (swscale) | convert thread | 8 MB written |
| Copy the rows into a `Vec` | convert thread | 8 MB |
| Copy the video into the compositor's frame | each screen's loop | 8 MB |
| Blend the cached slide layer over it | each screen's loop | 8 MB read, partly written |
| RGBA → BGRA swizzle for the view | each screen's loop | 16 MB |
| Write into each window's IOSurface | each screen's loop, per window | 8 MB |
| Write into the operator preview's IOSurface | preview loop | 8 MB |
| Write into the center pane's IOSurface (1080p, any-size frame) | center-pane loop | 8 MB |

That is 50–70 MB of memory traffic and several milliseconds of processor per frame, 30 times a second, for a picture whose slide had not changed. Three screens tripled the per-screen half. A 4K source was shrunk on the GPU first (`scale_vt`), so 4K cost the same per screen as 1080p after the decoder.

Not the bottleneck, checked: the slide's text is already cached and redrawn only when it changes; unchanged frames are not re-presented; there is no `requestAnimationFrame` loop or React render in the projection path (the audience window is drawn natively); Core Animation was already handed IOSurfaces, not CGImages.

## What changed

**A screen with a background video is now shown as layers the window server composites on the GPU** (`surface/layered.rs`, `surface/layers.rs`):

```text
canvas            the screen's colour
 ├─ clip          the box the video is clipped to
 │   └─ video     VideoToolbox's own IOSurface: no copy, no conversion
 └─ overlay       slide, timer, props, banner over transparency, drawn only when they change
```

- **No copies per video frame.** The decoder hands the VideoToolbox frame over as it is (`video/picture.rs`). A new frame is a new surface on the video layer: one Core Animation property change on the main thread.
- **The decode size follows the output.** A frame larger than the screen is made the screen's size on the GPU first (`scale_vt`), so a 4K video on a 1080p projector is never more than 1080p past the decoder. At the High video quality, a smaller one is scaled up there too, so the screen shows it pixel for pixel.
- **Colour matches the old pipeline.** The surface is tagged with the matrix the processor path used (BT.709 for 720 lines and up when the file says nothing, BT.601 below), BT.709 primaries and the sRGB transfer function. Checked by showing a test chart both ways and reading the screen back: every patch within one level. Untagged, macOS treats HD video as SD; tagged with the BT.709 transfer function, mid-grey rises from 128 to 140.
- **Whole pictures are still drawn where layers can't show the screen:** a transition that blends whole pictures, colour adjustments on the video, the screen composer's regions, a file the GPU can't decode (4:2:2 H.264, for example), a screen split across windows, and Compatibility mode. Switching to a whole picture first redraws the screen from the exact video frame it showed, so a transition starts from what was on screen.
- **Pixels only where needed.** The shared decoder hands frames over on the GPU only while something that shows them that way has asked in the last 3 seconds. NDI or a screen mid-transition converts a GPU frame to pixels once per size and shares it.
- **Operator panels share the screen's surfaces.** The preview shows the screen's own video and overlay surfaces; the center pane shows the decoder's surface. Neither copies a frame.
- **A playing video is decoded three frames ahead.** VideoToolbox sometimes takes 50–120 ms over one frame. The decoder used to stop at the moment asked for, so each of those stalls showed as a held frame. Keeping three frames on the GPU costs nothing.
- **Pictures are held until the window server lets go of them**, so the decoder never writes a new frame into a surface still on screen.
- **Different content per display still works.** Each screen has its own renderer and overlay; screens showing the live video share one decoder, others decode their own.

## Measurements

**How.** `examples/projection_bench` runs the app's own screen loops headlessly: the shared decoder, each screen's renderer drawing a lyric over the video at 1920 × 1080, 60 ticks a second, every window's IOSurface written as the app writes it, and the operator preview fed from the screen. The old build runs the same loops through the old code. The sound clock is held until the first frame is decoded, as the app's sound engine holds it. Each run is 2 s of warm-up and 15 s measured; processor time and peak memory come from `getrusage`, GPU load from `ioreg` once a second. `examples/present_probe` shows the screen in real macOS windows, so the window server's share is counted as well.

**Real windows** (960 × 540-point windows on the Retina display, so 1920 × 1080 pixels each; the old drawing path is the new build's Compatibility mode, which matched the old build within 1–5% headless):

| Video | Windows | App + window server, old path | App + window server, layers | Frames shown |
|---|---|---|---|---|
| 1080p30 H.264 | 1 | 111% + 2% | 5% + 3% | 30 fps both |
| 1080p30 H.264 | 3 | 119% + 4% | 6% + 9% | 30 fps both |
| 4K30 H.264 | 1 | 118% + 14% | 9% + 5% | 29 → 30 fps |
| 4K30 H.264 | 3 | 126% + 16% | 9% + 14% | 30 fps both |

**Sync and smoothness.** The median screen is 5–7 ms from the sound's clock in both builds. Over 90 s with three screens and the center pane, the old build had 114 and 116 late frames and a worst offset (p99) of 43 and 354 ms in two runs; the new build had 2 and 0 late frames and 16 ms. The difference is the decoder now running three frames ahead (see What changed): VideoToolbox sometimes takes 50–120 ms over one frame in either build, and a three-frame lead absorbs that.

**Long playback.** Three screens and the center pane for 180 s: memory flat at 211 MB from the first to the last minute, processor 5%, 28.9 new frames a second on every screen. No growth from holding GPU frames.

**Compatibility mode** (every picture drawn on the processor) costs the same as the old build: 327% vs 319% for three 1080p screens, and 301% and 318% vs 298% and 303% in two later pairs.

**GPU load** (Intel UHD 630, which decodes and composites here; the Radeon was idle in every run) moved by a few points either way, 2–27% in most runs. The 4K HEVC clip was 71% before and 78% after: it is decode-bound, and the new build decodes more of it (30 fps instead of 23).

**Not a 5× everywhere.** Where a screen still draws whole pictures (different videos on screens that aren't the live one, a file the GPU can't decode, a transition) the cost is the old cost. In the different-videos scenario only the live screen is layered, so it drops 1.6×, not 30×. The 4:2:2 H.264 file is decoded in software and drawn whole, so it is unchanged.

## Is hardware acceleration used

| Stage | Before | After |
|---|---|---|
| Decode | GPU (VideoToolbox) where the codec is supported; software otherwise | Same. Auto mode now asks VideoToolbox which codecs it decodes and goes straight to software for the rest |
| Scaling a larger video down | GPU (`scale_vt`) | GPU (`scale_vt`) |
| YUV → RGB colour conversion | Processor (swscale), every frame | GPU, by the window server while compositing |
| Combining video, slide and screen colour | Processor (Rust compositor), every frame | GPU (window server), every frame; the slide is drawn on the processor only when it changes |
| Handing the picture to the display | Processor copy into an IOSurface per window | None: the decoder's surface is shown directly |

On this Mac (asked of VideoToolbox), the GPU decodes H.264 and HEVC, including 10-bit HEVC. ProRes, VP9, AV1 and MPEG-4 Part 2 are not GPU-decoded. ProRes is still decoded by VideoToolbox (in its own software decoder) into surfaces the screens show without copying; VP9, AV1 and MPEG-4 go to FFmpeg's software decoders. Settings ▸ Projection shows the list for each machine.

## Projection settings

Settings ▸ Projection (`services/projection`, saved in `projection.json`):

| Preset | Resolution cap | Frame rate cap |
|---|---|---|
| Very Low | 1280 × 720 | 24 |
| Low | 1920 × 1080 | 30 |
| Medium | 1920 × 1080 | 30, rising to 60 while something moves |
| Balanced | 1920 × 1080 | 60 |
| High | 2560 × 1440 | 60 |
| Highest (default) | 3840 × 2160 | 60 |
| Custom | as set | as set |

- **Resolution and frame rate are output targets, not limits on the source.** The cap applies to what the processor draws (the slide, whole pictures) and the size the video is scaled to. A screen smaller than the cap is drawn at its own size. A video still plays at its own frame rate up to the cap.
- **Video quality:** High scales the video to each screen's exact size on the GPU; Standard only shrinks it and lets the window server scale it up.
- **Hardware decoding:** Auto (GPU for the codecs this GPU decodes, software for the rest, with no failed GPU attempt first), Enabled (always try the GPU first), Disabled (software only).
- **Rendering:** Automatic and GPU show video as layers where possible; Compatibility draws every picture on the processor as before.
- **Power:** Performance checks screens as often as the frame rate allows; Efficiency caps processor drawing (transitions, scrolling messages, whole pictures) at 30 fps and checks still screens 30 times a second.
- **Adjust automatically** (default on): if more than a quarter of screen ticks run late for 4 seconds, the resolution steps down one level, then the frame rate. It steps back up after 30 seconds with almost none late. One step at a time, so the change is a slightly softer slide, never a jump.

Settings ▸ Projection also lists the GPUs, which codecs they decode, and each display's resolution and refresh rate.

## Audio recording

**Recording from the built-in microphone costs this Mac about 4% of a core in macOS's own audio service, whichever app records. Present's recording engine adds 0.3–0.7% on top, less than ffmpeg's 6%.** Measured 20 s each with `examples/record_probe` (MacBook Pro Microphone, 44.1 kHz mono):

| Recording | The recording app | macOS audio service (`coreaudiod`) |
|---|---|---|
| Nothing recording | – | 0.7% |
| Bare capture, sound discarded | 0.3% | 3.4–3.9% |
| Present recording a take, window snapshots 16 times a second | 0.7% | 3.5% |
| Present's input meter, not recording | 0.4% | 3.5% |
| Present, hearing yourself with every effect on | 1.9% | 9.9% |
| ffmpeg recording the same microphone to WAV | 6.1% | 2.6% |
| Bare capture with 2,048- or 4,096-frame buffers | 0.1% | 7.2–8.0% |

No other macOS process woke during a capture. Hearing yourself costs more because macOS then runs the speakers' stream as well. Larger buffers wake the app less often but double the audio service's work, so Present keeps the device's default (512 frames). On the test Mac the other running apps (a browser at 6–13%, Docker, a system monitor) used more than recording did.

What was heavy was around the engine, not in it. The recording path in Rust was cheap: the waveform for the window samples about 1,900 points per track, not every sample, and the effects are a few multiplies per sample. The costs were around it:

- **The recorder window opened the microphone a second time in WebKit** (`useMicMonitor`: `getUserMedia`, an `AudioContext` analyser and a `requestAnimationFrame` loop that set state and re-rendered the whole window about 60 times a second). It was passed the app's native device id, which WebKit may not recognise, so on some machines it fails silently and on others it runs a second capture. Removed: the meter now uses the level the app's own capture already reports.
- **Every waveform was rebuilt 16 times a second** while recording, because each snapshot is a new object. The waveform now redraws only when its peaks change, so only the track being recorded redraws.
- **The audio thread allocated two buffers on every callback.** They are now kept between callbacks.

Audio quality is unchanged: the same capture rate, channels and processing.

## Bible and song agents: microphone and delay

**Listening costs the same as recording: 0.5–0.7% of a core for the app's capture and resampling to 16 kHz, plus about 3.7% in macOS's audio service.** Every microphone feature (recorder, Bible agent, song agent) now goes through the app's own capture; nothing opens the microphone in the web view.

**The 2–5 s delay was mostly the speech model.** Universal-3.5 Pro sends words only at pauses. Streaming a recorded sermon at real speed with the app's settings, a word showed a median 0.8 s and up to 1.8 s after it was said, in bursts (14 updates in 17 s). The agents now use Universal-Streaming English, which sends each word while it is still being said:

| Model (app settings) | Word on screen after it is said, median / worst | Updates in 17 s |
|---|---|---|
| Universal-3.5 Pro (before) | ~0.9 s / ~2 s | 14 |
| Universal-Streaming English (now) | ~0.5 s / ~0.65 s | 63 |

Real-time figures include 100 ms of audio per message and the hand-off from the microphone, which now happens within 20 ms of a chunk being whole (it was up to 50 ms). Shorter chunks gained nothing: the service answered them about as much later as they saved. About 0.4 s is the floor for cloud recognition: a word has to be said before it can be recognised, and it travels to the service and back.

Two changes make the faster model usable:
- **The word still being said is shown.** A message's `transcript` holds only finished words; the forming one is in `words` (`assemblyai-turn.ts`).
- **References are read before they are formatted.** The fast model writes "John three sixteen" as "john 316". The parser now splits a number that is no chapter of the book into the one chapter and verse it can be, using the verse counts: "romans 828" is Romans 8:28 and "psalm 1191" is Psalm 119:1 at once. "genesis 111" could be 1:11 or 11:1, so it waits for the formatted end of the turn (about 0.4–1.1 s after the pause), which says which. Only the formatted end of a turn counts as final, so a voice command acts once.

Checked live against AssemblyAI: all ten references said in the test ("John 3:16", "Psalm 119:1", "Genesis 1:11", "Genesis 11:1", "1 Corinthians 13:13" and others) were formatted correctly at the end of the turn. Accuracy on the test sermon was the same word for word; the new model writes numbers unformatted until a turn ends.

**Falling behind in a long session (fixed).** The service's own delay does not grow: ten minutes of sermon sent at true real time came back with a median 0.29–0.30 s every minute (90th percentile 0.33–0.53 s). What could grow was the sound's path through the page: each 100 ms chunk crossed to the web view and was sent on from the thread that also draws the Bible tab, so a busy page held the sound back. The microphone and the connection are now both in Rust (`services/speech_stream.rs`): sound goes to AssemblyAI as it is captured, and the page only reads what comes back. Checked with the default microphone against the live service (`examples/speech_stream_probe.rs`).

**A regression in this work, fixed.** With formatted turns on, AssemblyAI marks *every* message of a turn as formatted, not only the last. The first version read each one as final, so the agent closed every turn at its first word and ignored the rest ("stale-turn" in the log): it showed nothing. Only the end of a turn counts as final now, with a test for it. Replaying a recorded sermon through the fixed code: John 3:16 shown 0.30 s after it was said, Romans 8:28 0.44 s, Psalm 23:1 0.49 s, and no wrong verse flashed while a number was still being said (the agent waits while the newest word is a number that could still grow).

**The AI Gateway** (stories and indirect references; plain references never wait on it) answered three test requests correctly in 1.8–3.4 s, against a 3.8 s limit, so a slow answer is occasionally given up on. The one failure in the log on 3 November was that.

## Limitations and what is not verified

- **The layered video path is macOS only.** On Windows and Linux the audience screens are drawn by the app's web view, as before, and Settings ▸ Projection says so. What does apply there: the shared decoder running three frames ahead, the Hardware decoding setting (D3D11/DXVA2 and VA-API), and all the recorder-window fixes. The Windows and Linux builds were not compiled here; their CI workflows are the check.
- **Not yet run in the full app.** Verified with the app's own renderer in real windows (`examples/present_probe`) and headless (`examples/projection_bench`), including a screen capture. Playing a video on the audience screen, the preview and center pane, the Projection page and the recorder window still need a check in the running app.
- **Transitions that blend whole pictures still use the processor** for their duration, as do colour filters on the video and the screen composer. A GPU compositor for those is the next step (ADR-001's wgpu plan).
- **NDI** still needs pixels in memory, so it converts each frame (once per size, shared).
- **A decoder that can't keep up falls up to a second behind before it seeks.** On a hot, throttled machine (the CPU speed limit fell to 39% during this work) decoding can be slower than real time, and a video then runs a few hundred milliseconds late. This was already the behaviour; the app holds the sound until the first frame is ready, so it shows only under heavy load.
- **4K decoding is near this Mac's limit.** FFmpeg's VideoToolbox decoder waits for each frame (ADR-003), so a 4K 10-bit HEVC file manages 30 fps only with the layered path's spare time.
- **One outlier.** In the final matrix, three 1080p screens had 21 late frames once; three reruns had 0. Other work on the machine during that run is the likely cause.
- **The recorder's take buffer grows in one block**, which can briefly stall audio on very long takes.
- **Not measured:** playback while recording audio (the benchmark binary has no microphone permission), GPU memory per surface, and the Radeon Pro 555X (macOS kept every run on the Intel GPU). Apple silicon was not available to test.

## Reproducing

```bash
cd apps/desktop/src-tauri
cargo build --release --example projection_bench --example present_probe
./target/release/examples/projection_bench screens3 /path/to/1080p.mp4 --seconds 15
./target/release/examples/projection_bench screens3 /path/to/1080p.mp4 --seconds 15 --engine whole
./target/release/examples/present_probe /path/to/4k.mp4 --windows 3 --engine layers
```

Run old and new back to back and note `pmset -g therm`: this Mac throttles to 40% when hot, and a single timing is not evidence.
