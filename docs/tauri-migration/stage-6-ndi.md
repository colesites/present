# Stage 6 — NDI, and the audience surface swap

**Status:** in progress. NDI output runs from the Rust compositor and has been
received, at 30 fps, both in-process and from the running app. NDI input,
discovery in the UI, shipping `libndi`, compositor parity and the surface swap
are left — see §9.

The audit's gate for this stage is discovery, connect, output and reconnect.
All four are proven at the library level against the real runtime
(`tests/ndi_loopback.rs`); none has been exercised through the UI yet.

---

## 1. Decisions taken at the start, by the owner

| Question | Answer |
|---|---|
| Which layer settings does the NDI stream follow? | **The Looks window's NDI column**, from day one. |
| How does the Rust-drawn audience screen roll out? | **Opt-in**, with the webview output the default until a full service and the two-monitor test pass on it. |
| Has Electron's NDI ever run past 30 minutes? | **Yes.** The bundled `libndi` contains a string about a 30-minute limit; it sits beside the NDI\|HX encoder text and does not apply to a standard send. |

The first answer has a consequence worth stating plainly, because it was not
spelled out when the question was asked: **the operator's quick toggles — show
text, show media, hide background, the timer — write to the program column
only** (`App.tsx:548-600`). With the stream following the NDI column, clearing
the words on the projector does not clear them on the stream. That is one line
to change (`services/ndi/stream.rs` picks the target) if it turns out not to be
what a livestream operator expects.

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

## 6. The compositor is not yet the audience window

Reading `OutputWindow.tsx` against the compositor, to see what the stream would
be missing, found gaps that matter more than any above. Electron's stream is a
capture of the real window, so **each of these is a regression on the stream
until it is fixed**:

| React draws | The compositor |
|---|---|
| **Scripture** — `scripture:` slides without elements go through `ScriptureTextLayer`: auto-fit between 10 and 500 px, line height 1.625, a shadow, an upper-case footer | **nothing.** Generated scripture is plain text by design, so every Bible verse is missing from the stream |
| Library slides without authored elements — one centred `fillText`, squeezed to 90% width | nothing |
| Media with `object-contain`, letterboxed | video and stills with `cover`, cropped; and the decoder scales to the exact frame size, so a 4:3 video would be stretched |
| The slide background colour **over** the media | under it |
| `mediaFilterCSS` — brightness, contrast, saturate, blur, grayscale, sepia, hue-rotate | ignored. An operator dimming a busy video behind the lyrics dims the projector and not the stream |

`src/services/compositor/filters.rs` is in the working tree, **not committed and
not registered**: the seven filters parsed, the colour ones as the specification's
matrices with its eleven tests passing, blur as three box passes. It is not wired
in, and the blur has not been measured — it is O(pixels × radius) as written.

## 7. What is verified

- 575 Rust tests, 127 JS; clippy `-D warnings`, fmt and typecheck clean
- the 34 characterisation cases, each proven to fail under mutation
- the library loopback against two runtimes, the unwatched clock, and the stream
  probe and in-app run above, with frames looked at
- Electron still packages with `ndi-rules.mjs` imported

## 8. Not verified — do not claim otherwise

- **Nothing with a service loaded.** No lyric, scripture or video has gone from
  the app to NDI; the probe drew its own scene.
- **No NDI Tools receiver** — Video Monitor, OBS, a switcher — has been pointed
  at the stream. Only this code's own receiver has watched it.
- **The packaged build has no NDI.** `libndi` is not in `bundle.resources` yet.
- **Not on another machine or network**; everything above is loopback.
- Nothing on Windows or Linux.

## 9. What is left

1. **Ship `libndi`** in the bundle, and a packaged-build run.
2. **NDI input**: discovery in the Layers panel, the shared receiver with its
   client bookkeeping (already pinned by `rules`), and the `ndi-frame://` scheme.
   The Tauri CSP does not allow `ndi-frame:` yet, so input props are blocked
   today.
3. **Compositor parity**, §6, in the order the stream needs it: scripture, the
   media fit and order, filters, plain text. Each with a pixel test against what
   `OutputWindow.tsx` does.
4. **The gate, through the UI**: Settings → NDI on, a service live, watched in
   NDI Video Monitor; NDI Test Patterns as an input source; a source restarted
   mid-prop.
5. **The surface swap**, opt-in, once the stream has been watched with a service
   on it.
