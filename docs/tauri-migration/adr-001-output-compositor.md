# ADR-001 — The audience output is composited in Rust with wgpu

**Status:** accepted, amended 2026-09-10 · **Date:** 2026-09-08 · **Decides:** blocker §10.1 of
[stage-0-audit.md](stage-0-audit.md)

## Context

NDI output today runs a 33 ms interval that calls
`outputWindow.webContents.capturePage()`, converts the result to a BGRA bitmap and
hands it to the `grandi` sender (`apps/desktop/src/main/services/ndi.service.ts:325`).

Tauri exposes no equivalent — there is no supported way to read a webview's
framebuffer at 30 fps. Any Tauri port therefore has to answer the question
"where do NDI frames come from?" before the output subsystem can be designed.

Three options were on the table:

1. Composite the audience output in Rust (wgpu) instead of rendering it in a webview.
2. Capture at the OS level — ScreenCaptureKit (macOS), DXGI Desktop Duplication
   (Windows), PipeWire (Linux) — pointed at the output window.
3. Run an offscreen headless Chromium purely as a frame source.

## Decision

**Option 1.** The audience output becomes a Rust-composited surface. The output
window stops being a React surface.

## Consequences

### Gained

- **NDI gets a native frame source.** No capture round-trip, no per-frame bitmap
  conversion through the JS/main-process boundary.
- **The duplicate-audio class of bug disappears structurally.** Today the
  invariant "only one audible video element" is held by nine independent
  hard-coded `muted` attributes across nine files (audit §5.2–5.3). With the
  audience surface composited in Rust, mirror surfaces become incapable of
  producing audio rather than merely configured not to. This is the regression
  the migration plan says must never return.
- **No macOS screen-recording permission prompt**, which option 2 would require.
- **One frame pipeline feeds every consumer** — the audience window, NDI, and any
  future recording or streaming target — instead of each re-capturing.

### Paid

- **This is the expensive path in engineering time**, not in money or licensing.
  Text layout, image and video decode, a scene graph, and per-frame compositing
  all have to be written rather than delegated to Chromium. Weeks, not days.
- **The output renderer stops sharing code with the React UI.** Slide rendering
  exists twice: React for the operator's preview, Rust for the audience surface.
  They must be kept visually identical, which needs a shared scene description
  and screenshot-diff tests rather than shared components.
- **Feature gaps must be handled explicitly.** Anything the current output
  window gets free from the web platform — YouTube embeds
  (`OutputWindow.tsx:958`), HDMI capture via `getUserMedia`
  (`OutputWindow.tsx:1216`), CSS filters, web fonts — needs a deliberate design
  in the compositor or a documented fallback.

### Rejected alternatives

- **Option 2 (OS capture)** keeps the webview renderer and is much cheaper, but
  adds a macOS screen-recording permission prompt, three platform-specific
  capture backends, and leaves the audio invariant exactly as fragile as it is
  now.
- **Option 3 (offscreen Chromium)** duplicates the entire render and roughly
  doubles GPU cost for the output path. Kept only as an emergency fallback.

## Sequencing

The compositor is Stage 5 work and lands with the media engine, not before.
Stages 1–4 build the shell, windows, native APIs and presentation state on the
assumption that the audience surface will be Rust-composited — concretely, that
means output state must be fully described by serialisable Rust structs (a scene
description), never by React component state.

Until the compositor exists, the output window renders in a webview exactly as
it does under Electron, so parity is never lost mid-migration.

---

## Amendment — 2026-09-10: the surface is a hybrid

**Resolves the "feature gaps" consequence above**, which this ADR raised and
left open.

Two things on the audience surface exist only because it is a webview:
**YouTube prop embeds** (`OutputWindow.tsx:1049`) and **HDMI capture via
`getUserMedia`** (`OutputWindow.tsx:1128`). Neither can be drawn by a Rust
compositor — one is a browser and the other is a browser API. The options were
to drop both, to design a Rust equivalent for each, or to keep a webview for
exactly those two.

**Decision: keep a transparent webview layer above the composited surface.**
Rust composites the slide, the media and the overlays. The webview above it
draws only the YouTube and capture props.

### What this costs

- **Those two layers do not reach NDI.** The Rust frame pipeline is the NDI
  source, and it does not see what the webview above it draws. A service
  sending a YouTube prop to an NDI destination gets the composited surface
  without it. This is a real regression against Electron, which captured the
  whole window, and it is the price of the choice.
- **Two rendering paths on one screen**, which have to agree about geometry.
  The webview layer is positioned from the same scene the compositor draws
  from, so the alignment is only as good as that shared description.

### What it keeps

- Both features keep working on the screen the congregation looks at.
- The compositor does not have to grow a YouTube client or a capture backend,
  which is the work that would have made it months rather than weeks.
- The single-audio-path invariant is unaffected: neither of those two layers is
  a mixer input, and the graph in `services/audio.rs` refuses every surface but
  the operator's regardless of what draws it.

### What follows for the code

`SlideElementType::is_composited` is where this decision lives. `web` elements
return false, so the compositor leaves a hole rather than drawing over them.
Anything of an unknown type does the same, on the grounds that not drawing is
recoverable and drawing the wrong thing over a live audience screen is not.

