# Stage 6 — NDI, and the audience surface swap

**Status:** code complete. NDI output runs from the Rust compositor, which now
draws what the audience window draws; `libndi` ships inside the bundle; NDI
props receive through the Rust core; and the audience window can be drawn
natively, opt-in. What is left is the owner's manual gate — §9.

The audit's gate for this stage is discovery, connect, output and reconnect.
All four are proven at the library level against the real runtime
(`tests/ndi_loopback.rs`), and discovery, connect and output through the running
app against a real source. Nothing has been watched in NDI Tools, and no service
has gone out over it.

---

## 1. Decisions taken at the start, by the owner

| Question | Answer |
|---|---|
| Which layer settings does the NDI stream follow? | **The Looks window's NDI column**, from day one. |
| How does the Rust-drawn audience screen roll out? | **Opt-in**, with the webview output the default until a full service and the two-monitor test pass on it. |
| Has Electron's NDI ever run past 30 minutes? | **Yes.** The bundled `libndi` contains a string about a 30-minute limit; it sits beside the NDI\|HX encoder text and does not apply to a standard send. |

The first answer had a consequence worth stating plainly, because it was not
spelled out when the question was asked: the operator's quick toggles — show
text, show media, hide background, the timer — write to the program column
only, so clearing the words on the projector did not clear them on the stream.

**Settled on 2026-09-17** (owner): it should. The NDI column now says which
layers the stream *may* carry, and the quick toggles say what is showing this
minute; a layer reaches the stream when both agree, and the background is
hidden if either asks (`services/ndi/look.rs`).

## 2. The gate, before anything moved

`tests/ndi-rules.test.mjs`, 34 cases, against `src/shared/lib/ndi-rules.mjs` —
extracted verbatim from `ndi.service.ts` and the `ndi-frame` handler, which
both import it now, so the suite pins what Electron runs. Each assertion was
proven to fail under a deliberate mutation.

Two things it states that nobody had written down:

- **The whole app shares one NDI receiver.** A prop on a second camera takes it
  from the first, and every client of the old source is dropped.
- **Sources sort with `localeCompare`**, which ignores case until case is the
  only difference. A character-code sort puts every upper-case machine name
  first.

`services/ndi/rules.rs` is the same cases in Rust.

## 3. Reaching NDI from Rust

**The runtime is loaded when NDI is first used, not linked at build time.**
`grafton-ndi`, the crate that covers send and receive, generates bindings with
bindgen against an installed SDK and needs Rust 1.87; every machine that builds
Present, CI's three bundle runners included, would need the NDI SDK. `ndi-sdk`
loads dynamically but covers only discovery and routing.

So `services/ndi/sys.rs` is fifteen functions transcribed from the SDK's
MIT-licensed headers, resolved with `libloading`. Every struct size and field
offset is pinned by a test, because a wrong offset is not a crash — it is the
SDK reading the stride as the data pointer.

The search order is in `library.rs`: an explicit `PRESENT_NDI_LIBRARY`, the
copy the bundle will ship, `NDI_RUNTIME_DIR_V6`, `/usr/local/lib` where NDI Tools
installs it on macOS, and in debug builds grandi's copy in `node_modules`. When
nothing loads, the app still starts and reports `libraryLoaded: false`, as
Electron does.

### Proven against the real runtime

`cargo test --test ndi_loopback -- --ignored --nocapture`, with both NDI Tools'
6.2.1 and grandi's 6.3.0.3:

| Gate item | Result |
|---|---|
| discovery | the sender found in 0.9 s, at `127.0.0.1:5961` |
| connect | a receiver created from the discovered source |
| output | 640×360 BGRA arriving with all four quadrant colours in place — channel order and orientation both right |
| reconnect | sender destroyed and recreated under the same name; **the same receiver** resumed in 0.02–0.9 s |
| clock | 30.0 fps watched, 30.4 fps with no receiver at all |

## 4. NDI output

```text
OutputState::on_screen ─► look::scene_for_ndi ─► SceneCompositor ─► write_bgra ─► Sender
          (freeze held)      (NDI column)         + VideoFeed        (reused buffer)  (SDK clock)
```

- **What is drawn is what is on screen.** `OutputState` now keeps the scene the
  surfaces were last told to show apart from the operator's, so a freeze holds
  the stream as it held Electron's captured window. `get_output_scene` answers
  with it too: an audience window opened mid-freeze shows the held screen.
- **The video keeps time like the audience mirror** (`OutputWindow.tsx:437`):
  its own clock, corrected past 0.12 s of drift. Re-anchoring on every
  position report — ten a second, each tens of milliseconds stale — stepped the
  video back and forward and juddered the stream. A test runs exactly that and
  asserts every stream frame advances one video frame.
- **The SDK paces the loop.** A sender created with `clock_video` blocks until
  the frame is due. The loop still sleeps if a runtime ever stops doing that.
- **A frame that fails to render resends the last good one.** Before any has
  rendered, opaque black. Electron sends a zeroed, transparent 1280×720 frame,
  which on a switcher keying the stream shows whatever is underneath.
- **The payloads are Electron's**, so Settings did not change. The status gains
  `connections`, `libraryVersion` and `frameMs`.

**Nothing on the send thread may panic.** The release profile aborts on panic,
so a panic there ends the service, not the stream. State is read with
`try_state`, never `state`.

## 5. What running it found

Every number here is the release profile at 1920×1080: a lyric slide over one of
the owner's service videos, streamed to a receiver, with the operator's player
simulated as it behaves (`examples/ndi_stream_probe.rs`).

| | first run | after the fixes |
|---|---|---|
| received | 28.7 fps | **30.0 fps** |
| gaps over 50 ms | 20 in 20 s | **none in 15 s** |
| mean render | 14.5 ms | 11.7 ms |
| with the timer showing | 28.5 fps, 13 gaps | **30.0 fps, none** |

Four defects, each a Stage 5 cost that a one-off render could afford and thirty
frames a second cannot:

1. **The video clock rebuilt the slide layer.** The cache compared scenes with
   `differs`, which counts `video_current_time`, so the slide was redrawn on
   every position report while any video played. Stage 5 measured the cache on a
   static scene.
2. **A background image was decoded from disk every frame**, and a video with
   no decoded frame yet fell through to the image path and read the whole video
   file — up to 256 MB — every frame.
3. **A ticking countdown rebuilt the whole slide layer once a second**, a median
   92 ms. The timer has its own layer now.
4. **And that redraw was nearly all compositing, not text.** Shaping the clock
   takes under a millisecond; handing it to tiny-skia's `draw_pixmap` took 37 ms,
   because the scratch was the whole frame and `draw_pixmap` walks every pixel.
   Upright text is now a source-over of the inked rectangle: **38 ms → 1.8 ms**.
   A full slide rebuild is still a median 40 ms — one late frame on a slide
   change — and most of what remains is a full-frame shape going through the
   same pipeline.

Separately, the received frame was checked by eye and against macOS's own
thumbnail of the same video, because its warm cast looked like a swapped red and
blue channel. It is the video's grade.

### In the running app

Started through the bridge from the operator window and received by
`examples/ndi_watch.rs` in a separate process: `C-TECH-698.LOCAL (Present
Harness)`, 1920×1080, **28.9 fps on the debug build**, no gap over 50 ms, then
stopped cleanly. The frame was black — signed out, nothing on screen — so this
proves the wiring, not the content.

Two things worth knowing from that run:

- **`useAppSettings` stops the stream when settings load with NDI disabled**,
  about eight seconds into a launch. Correct behaviour, and the reason a stream
  started by hand from the console seems to die on its own.
- **The webview's timers were throttled** — a 12 s `setTimeout` took 20.6 s with
  the window in the background. The stream runs on a Rust thread and did not
  notice, which is the point of drawing it there.

## 6. Drawing what the audience window draws

Reading `OutputWindow.tsx` against the compositor, to see what the stream would
be missing, found it drawing a different screen. Electron's stream is a capture
of the real window, so **each gap was a regression on the Tauri stream**
(known-issues §14). All are closed (`d6dbc99`):

| The window | The compositor now |
|---|---|
| **Scripture** — `scripture:` slides without elements go through `ScriptureTextLayer`: `AutoFitText`'s ten-step search between 10 and 500 px, line height 1.625, 48 px padding, two drop shadows, an upper-case footer | the same, in `compositor/slide_text.rs`. Before, every Bible verse was missing |
| Library slides with no visible elements — `CanvasSlideLayer`'s one centred `fillText`, squeezed to nine tenths of the width | the same, squeezed by rasterising the line at full width and scaling it |
| Media `object-contain`, letterboxed | letterboxed; the decoder is asked for an aspect-preserving size (`video::open_contained`), so a 4:3 video is not stretched, and a contain draw no longer smears the image's edge across the bars |
| The slide background colour **over** the media, whatever the mask says | over it, and no full-screen plate under the composer's regions |
| `mediaFilterCSS` on the `<video>` or `<img>` | the seven functions the UI writes, colour ones as the Filter Effects matrices, blur as running-sum box passes, on the media rectangle alone |
| Props and the message banner above the timer | the same order |

**A fifth gap turned up on the way: optical size.** Chromium on macOS sets
Inter's `opsz` axis from the pixel size, in HTML and Canvas. cosmic-text only
sets weight, so text came out nine percent wider and verses broke on different
lines. Faces with that axis are instanced with `allsorts` at the size they are
drawn — 13 ms per instance, and everything at slide sizes shares one per weight.
`allsorts` needs Rust 1.83, which is why the crate declares it.

Checked against Chrome rendering the same markup at 1920×1080:

- every line of a four-line verse and its footer within **1–3 px** of Chrome's
- the plain-text line the same width, and about **5 px lower**
- kerning is the font's default optical size — `allsorts` copies `GPOS` without
  applying variations. Advance widths, which decide the line breaks, are right.

**It did not make the compositor slower.** The same slide-rebuild benchmark,
built at the commit before parity (`cd6754e`) and at the surface commit
(`ed3c0b1`) on the `perf` profile and run alternately: rebuild median
48–57 ms before, 37–52 ms after; a cached frame 10–12 ms before, 8–10 ms after.

**The stream's frame rate after parity is not yet measured cleanly.** Right
after the parity work it received 30.0 fps with no gap over 50 ms. On
2026-09-14 the release probe gave 18.5, 22.4 and 27.6 fps in three runs, but
this machine was thermally throttling (`kernel_task` near 100%) and then
swapping (11.5 of 12 GB) with a browser taking 240% CPU. An alternating run of
the pre-parity and current probes on the same video got under 2 fps from
**both**, which is the machine and not the code. Re-run `ndi_stream_probe` on
a quiet machine before trusting either number.

## 7. Shipping the runtime, and NDI props

**`libndi` is in the bundle** (`39c80fd`). `scripts/stage-tauri-ndi.mjs` copies
this platform's runtime and its licences from grandi's prebuilt package into
`src-tauri/ndi/`, which `bundle.resources` includes, and `tauri build` runs it
first (`tauri:before-build`). Only a README and a `.gitignore` are committed
there, so the path exists on a machine with no NDI package. The loader prefers
the bundled copy to an installed one. In the packaged app,
`Contents/Resources/ndi/libndi.dylib` (6.3.0.3) was the one loaded, with NDI
Tools' `/usr/local/lib` copy also present; the app is 39 MB, the dmg 10 MB.

**NDI props receive through Rust** (`1c61d7d`), with Electron's payloads, so no
component changed:

- `list_ndi_sources` — this machine's sources included, 1.2 s, reading order
- **one shared receiver**, joined and left through `rules::plan_input_start`
  and `plan_input_stop`, the cases the characterisation suite pins. The last
  client leaving stops it after 1.2 s unless somebody joins first, so a prop
  re-rendering does not drop the camera.
- the lowest-bandwidth stream in BGRX/BGRA, at most one frame per 125 ms, scaled
  to at most 1280 px wide, a JPEG at quality 72
- `ndi-frame://` answers 204 until there is a frame, never serves another
  camera's frame under this one's name, and 400s a name that is not valid
  percent-encoding
- `ndi-frame:` added to the CSP's `img-src`, which had been blocking props

Verified in the running app against a real source: listed, started, the prop's
image loaded at 640×360 through the scheme, a wrong name got no image, a second
client kept the receiver through the first leaving, and the last leaving stopped
it after the grace period.

## 8. The audience window, drawn natively — opt-in

ADR-001's surface swap, behind **Settings → Audience screen**, off by default
(`ed3c0b1`). macOS only; elsewhere the switch is not shown.

```text
Output window
  ├─ WKWebView, transparent — YouTube, NDI, capture and video props,
  │                           composer camera regions
  └─ NSView below it        — each frame the compositor draws
```

`services/surface/` draws `OutputState::on_screen()` — the program column is
already folded into it — at the window's CSS size, 60 times a second at most,
and only hands a frame over when the scene, the video frame or the size changed.
Each frame becomes a `CGImage` over the premultiplied pixels, without a copy,
set as the view layer's contents on the main thread.

**The webview is the fallback, not a second renderer to reconcile:**

- It draws the whole output until the surface reports `presenting`, which is
  sent **100 ms after the first frame is handed over**, so the page never clears
  before the native picture has landed.
- Turned off, or **three failures in a row**, it is told to draw everything
  again, and the view stays **300 ms** longer while it repaints.
- A frame is dropped rather than queued while the main thread is still busy
  with the last one.
- `drawsBackground` is turned off on this one webview while the view is attached
  and restored after. Tauri's `macos-private-api` would do it for every window
  in the app.
- The worker is never joined from the main thread, because its last acts need
  the main thread. An attach waits for a view still being removed, and a
  generation count stops an attach going ahead after a detach.
- The view and the webview are retained, so a window closed and reopened under
  the same label cannot leave a pointer to a freed webview.

Verified in the running app, on the debug build: turned on with the Output
window open, the view attached and reported frames **0.5 s later**. A slide
drawn on it was screen-captured, then the webview's rendering after turning it
off — the same text in the same place. On, off and on again within 110 ms made
one view. Closing the window handed back; reopening it reattached on its own.
No renderer errors.

**What it costs, and why it stays opt-in:**

- **It is drawn at CSS size.** On a Retina screen, or a 4K screen at a scaled
  resolution, text is visibly softer than the webview's, which draws at device
  pixels. The switch says so. A projector at 1:1 is unaffected. Drawing at
  device pixels means a scale through the whole compositor, and four times the
  pixels on the CPU.
- **With NDI on as well, the frame is drawn twice** — once per target, each with
  its own video decoder, because the two follow different layer columns.
- **Handing back to the webview is not instant for video**: the page's
  `<video>` has to load and seek before it shows.
- Parity was checked against Chrome, the Electron engine. The Tauri webview is
  WebKit; the comparison above is the only one against it.

## 9. What is verified

- 634 Rust tests, 127 JS; clippy `-D warnings`, fmt and typecheck clean
- the 34 characterisation cases, each proven to fail under mutation
- the library loopback against two runtimes, the unwatched clock, and the stream
  probe and in-app run above, with frames looked at
- the compositor against Chrome for scripture and plain text, §6
- the packaged build loading its bundled `libndi`
- NDI input end to end in the running app, against a real source
- the native surface attaching, presenting, handing back and reattaching in the
  running app, captured on screen
- Electron still packages with `ndi-rules.mjs` imported

## 10. Not verified — do not claim otherwise

- **Nothing with a service loaded.** No lyric, scripture or video has gone from
  a live service to NDI or to the native surface.
- **No NDI Tools receiver** — Video Monitor, OBS, a switcher — has watched the
  stream. Only this code's own receiver has.
- **The native surface on a second monitor**, over a full service, or with a
  video playing behind the words.
- **Not on another machine or network**; everything above is loopback.
- **A long stream.** Nothing has run past a probe's 15–20 seconds.
- **The stream's frame rate after parity**, on a quiet machine — §6.
- Nothing on Windows or Linux. The surface is macOS-only by construction.

## 11. The owner's gate

In [HANDOFF.md §8 E](HANDOFF.md#e-ndi--stage-6-needs-ndi-tools-installed-on-this-machine).
In short: NDI on in Settings and watched in NDI Video Monitor with a service
live, scripture included; a freeze; a countdown; 45 minutes; NDI Test Patterns
as a prop, restarted mid-prop; and the native audience screen on the projector
through a service, before anyone turns it on for real.

Still open for the owner to decide: **the quick toggles write only the program
column** (§1), so clearing the words on the projector does not clear them on the
stream.
