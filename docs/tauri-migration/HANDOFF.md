# Present — Electron → Tauri migration: session handoff

**Read this first.** It is the state of the migration as of 2026-09-09, written
so a new session can continue without re-deriving anything.

Branch `rust`, 7 commits ahead of `master`, **nothing pushed**.

---

## 1. What this is

Migrating Present — church presentation software, Electron + React 19 +
TypeScript, ~62 000 LOC across 208 files — to Tauri, making Rust the native
application core while React stays the UI.

The full brief is `apps/desktop/Present — Electron to Tauri-Rust Migration Plan
& AI Prompt.md`. Its rules matter and are being followed: don't rewrite the UI,
don't change product behaviour unless required, don't delete Electron until
parity, keep Electron runnable throughout, commit frequently, small reviewable
steps.

The application is used live during worship services. **Reliability during a
service outweighs architectural purity.** A blank frame or duplicate audio on
the audience screen is a serious bug, not a rough edge.

## 2. Documents, in reading order

| Doc | What it holds |
|---|---|
| [stage-0-audit.md](stage-0-audit.md) | The full audit. Architecture map, all 79 IPC channels, media/audio/output pipeline, state model, native deps, build system, 31-row migration matrix, risks. **The reference for anything about how Electron does it today.** |
| [adr-001-output-compositor.md](adr-001-output-compositor.md) | The load-bearing decision: the audience output gets composited in Rust with wgpu. |
| [known-issues.md](known-issues.md) | Eight bugs found so far, each assigned to the stage that owns the fix. Three fixed. |
| [stage-1-tauri-skeleton.md](stage-1-tauri-skeleton.md) | The Tauri shell beside Electron. |
| [stage-2-displays.md](stage-2-displays.md) | Display enumeration, identity, persistence, monitor names. |

## 3. Where things stand

**Stage 0 — audit.** Done.

**Stage 1 — Tauri skeleton.** Done. `src-tauri` builds and bundles; Vite serves
the same `src/` React tree Webpack serves for Electron; the whole existing UI
mounts under Tauri. Electron is untouched and still works. CI covers Rust
quality plus macOS/Windows/Linux bundles.

**Stage 2 — windows and display.** Half done.
- ✅ Display selection rule extracted, characterised (12 tests), ported to Rust
- ✅ Monitor enumeration, synthesised stable identity, persisted preferences
- ✅ Real monitor names in the picker
- ⬜ **Next: window creation** — all eight windows
- ⬜ Monitor hot-plug → reconcile

Stages 3–8 are untouched. Order and content are in the audit's §12.

## 4. The next task, concretely

Recreate the eight windows in Rust. The audit's §3 lists them; only two Webpack
entry points exist because six windows load the main bundle with a `?window=`
query parameter, and `App.tsx:52-72` branches on it. The same trick works under
Tauri.

**The audience/output window is production-critical.** Its hardening in
`src/main/windows/output.window.ts:57-90` must be preserved exactly:

- `backgroundColor: '#000000'` and `show: false` until first paint — no white
  flash on the projector, ever
- `backgroundThrottling: false` — otherwise it blanks when the main window takes
  focus
- `render-process-gone` → one automatic reload
- Main window has the same, with a loop guard: stop after 2 crashes in 10 s
  (`main.window.ts:184-222`)

Then hot-plug: the three `screen` events in `src/main/index.ts:69-79` map to
Tauri monitor events and a reconcile pass.

Per ADR-001, **output state must be fully describable as serialisable Rust
structs from here on** — never as React component state. The Stage 5 compositor
consumes that scene description.

## 5. Decisions already made — do not relitigate

**The audience output will be composited in Rust with wgpu** (ADR-001). NDI
output today depends on `webContents.capturePage()` at 30 fps, which Tauri
cannot provide. Options were: Rust compositing, OS-level screen capture, or
offscreen Chromium. The owner chose Rust compositing, understanding it costs the
most *engineering time* (weeks, not days) and means slide rendering exists twice
— React for the operator preview, Rust for the audience surface. It also makes
the single-audio-path invariant structural instead of held together by nine
hard-coded `muted` attributes.

**Fix every issue found in the rewrite, not in the Electron build** — owner's
call. Exception: zero-behaviour-change fixes are fine to make now.

**The web app stays the AssemblyAI token broker.** The desktop must never carry
an AssemblyAI key. Only the transport moved to Rust.

**Vite for Tauri, Webpack stays for Electron.** Forge's Webpack plugin is bound
to Forge. Two bundlers coexist; neither touches the other's inputs.

## 6. What is verified vs. assumed

Verified by running it, not by reasoning:

- React → `invoke` → Rust → serde round trip, in dev **and** in the packaged
  release `.app` serving from `dist-tauri`
- `tauri build` produces `Present.app` + `.dmg` (5.0 MB vs Electron's 389 MB —
  recorded as a baseline, not a claim; the Tauri bundle has no Bible XML, NDI
  modules or `parse_pptx.py` yet)
- WKWebView capability probe: `getUserMedia`, `setSinkId`, `AudioContext`,
  `AudioWorklet`, `WebSocket`, `MediaRecorder`, `SpeechRecognition` all present;
  **live microphone capture granted**
- Display enumeration, primary detection, work-area inset, automatic fallback,
  and the monitor label reading "Built-in Retina Display"
- Display id byte-identical across four launches and unchanged when the label
  changed

**Not verified — do not claim otherwise:**

- No live AssemblyAI transcription end-to-end. Needs the owner signed in.
- Display id across an **OS reboot**. App restarts only. (Lower risk than first
  thought: the name is a hardware model number, not a display id.)
- Nothing on Windows or Linux. macOS only so far.
- No Tauri window has been opened on a second monitor yet.

## 7. Working agreements

- **Never push.** Local commits on `rust` only.
- **Three files in the working tree are the owner's own in-progress edits** —
  `ServicesSidebar.tsx`, `useOfflineSyncEngine.ts`, `localData.ts`. Stage only
  your own paths; never `git add -A` from the repo root.
- Commit messages end with `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`.
- `pnpm --filter @present/desktop run lint` **fails on `master` too** — 10
  pre-existing errors, deliberately not fixed (see known-issues §7). Do not
  claim credit for them and do not silently "fix" them inside a migration commit.
- Before moving any subsystem: write characterisation tests against the current
  Electron behaviour first. Audit §10.8.
- When the repo can answer a question, read it rather than guessing. Reading
  tao's source is what corrected a wrong assumption about monitor ids.
- Verify on real hardware where possible. A Tauri webview's console is invisible
  from a terminal — mirror findings into the Rust log via
  `commands::diagnostics::report_diagnostic`.

## 8. Commands

```bash
pnpm --filter @present/desktop run start        # Electron, unchanged
pnpm --filter @present/desktop run tauri:dev    # Tauri + Vite
pnpm --filter @present/desktop run tauri:build  # production bundle
pnpm --filter @present/desktop run tauri:check  # fmt + clippy -D warnings + tests
pnpm --filter @present/desktop run test         # 48 JS tests
pnpm --filter @present/desktop run typecheck
node apps/desktop/scripts/check-tauri-version.mjs [--fix]
```

Current: **47 Rust tests, 48 JS tests**, clippy/fmt/typecheck clean.

## 9. Installed skills

`rust-best-practices`, `rust-async-patterns`, `rust-testing`, `rust-patterns`,
`rust-engineer`, `tauri-v2`, plus `frontend-design` globally. Project-scoped in
`.agents/skills` with symlinks in `.claude/skills`.

The owner asked about `JavaScript-Mastery-Pro/skills`; it was assessed as a
generic nine-step workflow pack that overlaps and competes with the migration
plan's own stage gates. Not installed. That was advice, not a veto — install it
if asked.

## 10. Traps

- **The Electron main process owns almost no state.** It is a relay: `send-to-output`
  forwards opaque `unknown` blobs. Presentation state lives in React
  (`PresentContainer.tsx`, 2 244 lines). Inverting that is the whole migration.
- **The single-audible-video invariant is held by nine hard-coded `muted`
  attributes across nine files**, not by architecture. Any new `<video>` that
  forgets one reintroduces audience echo.
- **Dev and packaged builds keep entirely separate state** — different session
  files *and* different renderer origins, so different localStorage/IndexedDB.
  Tauri is a sixth origin and starts blank. known-issues §2.
- **`local-media://` reads any file on disk.** Do not reproduce it; use a scoped
  asset protocol. known-issues §3.
- Commands the frontend can reach need registering in `generate_handler!`, or
  they fail silently.
- JavaScript numbers are exact only to 2^53−1. Anything hashed or generated in
  Rust and sent to the UI as a number must respect that.
