# ADR-001 — The audience output is composited in Rust with wgpu

**Status:** accepted · **Date:** 2026-09-08 · **Decides:** blocker §10.1 of
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
