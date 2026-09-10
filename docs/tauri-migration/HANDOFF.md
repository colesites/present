# Present — Electron → Tauri migration: session handoff

**Read this first.** It is the state of the migration as of 2026-09-10, written
so a new session can continue without re-deriving anything.

Branch `rust`, 17 commits ahead of `master`, **nothing pushed**.

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
| [known-issues.md](known-issues.md) | Twelve bugs found so far, each assigned to the stage that owns the fix. Seven fixed. |
| [stage-1-tauri-skeleton.md](stage-1-tauri-skeleton.md) | The Tauri shell beside Electron. |
| [stage-2-displays.md](stage-2-displays.md) | Display enumeration, identity, persistence, monitor names. |
| [stage-2-windows.md](stage-2-windows.md) | All eight windows in Rust: specs as data, the output hardening, crash policy, the physical/logical placement trap. |
| [stage-2-hotplug.md](stage-2-hotplug.md) | Monitors changing under a running app: the poll, what counts as a change, and the work-area feedback loop. |
| [stage-3-native-apis.md](stage-3-native-apis.md) | The file scope and why it is shaped that way, the media scheme without a stream, dialogs, menu, shortcut, deep links, permissions, and the `electronAPI` bridge. |
| [stage-4-presentation-core.md](stage-4-presentation-core.md) | **In progress.** The characterisation gate, the output layer flags, the auth session, and the audience scene. What is left. |

## 3. Where things stand

**Stage 0 — audit.** Done.

**Stage 1 — Tauri skeleton.** Done. `src-tauri` builds and bundles; Vite serves
the same `src/` React tree Webpack serves for Electron; the whole existing UI
mounts under Tauri. Electron is untouched and still works. CI covers Rust
quality plus macOS/Windows/Linux bundles.

**Stage 2 — windows and display.** Done.
- ✅ Display selection rule extracted, characterised (12 tests), ported to Rust
- ✅ Monitor enumeration, synthesised stable identity, persisted preferences
- ✅ Real monitor names in the picker
- ✅ All eight windows created by Rust, including the operator window
- ✅ Monitor hot-plug → reconcile, which also fixed known-issues §9

**The stage gate is not fully met.** The audit's Stage 2 gate is a multi-monitor
manual matrix, and this machine has one screen. No window has been placed on, or
moved to, a second monitor. Run that matrix before trusting Stage 2 in front of
a congregation — the list is in stage-2-hotplug.md's "Not verified".

**Stage 3 — native APIs.** Done. The gate is met.
- ✅ Scoped filesystem: `local-media://` and all fourteen file channels
- ✅ `local-media://` outside the scope returns 403, confirmed in the running app
- ✅ The eight native dialogs, filters unchanged
- ✅ Application menu, `Control+Alt+Space`, `present://`, mic/camera permissions
- ✅ `window.electronAPI` bridged to Rust, so the React tree runs under Tauri

**What Stage 3 did not finish.** Known-issues §2 was assigned here and is only
partly done. The media folder list moved into Rust because the scope depends on
it; the twenty-odd `present-*` localStorage keys, the offline IndexedDB blob and
the auth session did not. They belong to Stages 4 and 7, and moving them early
would mean writing the same migration twice. See §2 in known-issues.md.

Nothing has been driven by hand: no dialog opened, no deep link followed, no
shortcut pressed, no permission prompt shown. `__presentFiles` on the operator
window exposes each of those for exactly that. The full list is in
stage-3-native-apis.md §6.

### Stages 4–8, untouched

Content and gates from the audit's §12, inlined so this file stands alone.

| Stage | Content | Gate |
|---|---|---|
| **4** | Presentation core into Rust, slice by slice: output layer flags → slides → service. React adapter hooks keep component props stable. | Characterisation tests first |
| **5** | Media engine + single audio path. Fixes the audit's §5.4 as part of the work. | Audio regression suite |
| **6** | NDI, per ADR-001. | Discovery/connect/output/reconnect |
| **7** | Bible, fonts, PPTX sidecar, auth, AI Operator on Rust commands, error reporting, settings. | Parity checklist |
| **8** | Measure against the Electron baseline, then remove Electron. | Definition of done |

Stages 4 and 5 are the bulk of it: Stage 4 touches ~44 000 lines of UI and
Stage 5 carries the wgpu compositor. **Before either, write characterisation
tests against the running Electron build** — in particular one asserting that
exactly one audible media element exists for a given playback. That is the
regression that must never return, and it is why Electron stays until Stage 8.

### Commits on this branch

```
d1f4ff0 test(stage-3): pin the local media URL rule on both shells
4667521 docs(stage-3): record the file scope, what it proves, and what it does not
0289db5 feat(stage-3): bridge the React tree to the Rust core
26ee9e7 feat(stage-3): scoped filesystem, dialogs, menus, shortcut and deep links
b8413ea docs: bring the handoff up to date for a fresh session
49cb401 feat(stage-2): reconcile windows when the monitors change
b8961fe docs: reassign the webview crash-recovery gap to Stage 7
308cec1 chore: move the monorepo from pnpm to bun
f53b7e2 feat(stage-2): create all eight windows in Rust
df6c9a7 docs: add session handoff for the Tauri migration
17a232d feat(stage-2): show the real monitor name in the display picker
838ebd3 feat(stage-2): Rust display enumeration, identity and persisted preferences
11364f8 docs: restore issue table ordering
182351e feat(speech): move AssemblyAI token and usage calls into the Rust core
4160950 test(stage-2): pin display-selection behaviour before porting it to Rust
62d7b95 fix: remove dead File System Access gate hiding the media panel
2eb9488 feat(tauri): Stage 0 audit and Stage 1 Tauri/Rust skeleton
```

## 4. The next task, concretely

**Stage 4 — the presentation core into Rust**, slice by slice: output layer
flags, then slides, then service. React adapter hooks keep component props
stable. The gate is characterisation tests first, written against the *running
Electron build* — audit §10.8.

Two things are worth doing before Stage 4 proper, neither of which is Stage 4
work:

**Drive the Stage 3 native APIs by hand.** Eight dialogs, a deep link, a global
shortcut and two permission prompts have code and tests but have never been
operated by a human. `__presentFiles` and `__presentWindows` on the operator
window expose all of them. This is an hour, not a day, and it is the difference
between "the tests pass" and "it works".

**Run the multi-monitor matrix Stage 2 could not.** Needs a second screen, not a
code change.

Stage 4's first slice should be whichever one makes the app visible again. The
operator window mounts React and renders nothing, because it waits on an auth
session that does not exist at the Tauri origin (known-issues §2) and
`getStoredAuthSession` is not bridged. That is nominally Stage 7, but a blank
window makes every Stage 4 change unverifiable by eye, so consider pulling the
session read forward.

Per ADR-001, **output state must be fully describable as serialisable Rust
structs from here on** — never as React component state. Window specs and the
reposition decision already are; the scene description is Stage 5.

## 5. What the Rust core contains today

8 300 lines across `apps/desktop/src-tauri/src`, mirroring the Electron main
process's own structure as the audit asked. Nothing here is a stub.

```
commands/      thin: deserialise, delegate, map to AppResult
  app.rs         get_app_info
  deep_link.rs   take_pending_deep_link
  diagnostics.rs report_webview_capabilities · report_diagnostic
  display.rs     get_displays · get/set_preferred_display
                 get/set_preferred_resolution · reconcile_displays
  file.rs        the eight dialogs · the six file operations · the two
                 library-bundle calls · list/remove_media_folder
  permissions.rs request/get microphone and camera access
  speech.rs      request_speech_token · report_speech_usage
  window.rs      open_window · close_window · open/close_mini_lyrics_window
                 list_open_windows
services/      domain logic, most of it runtime-free and tested
  app_menu.rs        the menu, ported from menu/app.menu.ts
  deep_link.rs       present:// parsing and the pending-link buffer. Parser
                     has no Tauri types.
  dialog.rs          the eight native dialogs; every pick grants scope
  display.rs         the role→monitor selection rule, ported from
                     src/shared/lib/display-selection.mjs. No Tauri types.
  display_identity.rs (name, ordinal) identity + the FNV-1a 53-bit id
  display_names.rs   AppKit NSScreen.localizedName, main-thread hop
  display_watch.rs   the hot-plug poll, diff and reconcile pass
  file_scope.rs      THE containment rule. No Tauri types. Read this before
                     touching anything that takes a path.
  filesystem.rs      the file operations, all scope-checked
  media_protocol.rs  the local-media:// handler: URL parsing, range planning,
                     content types, the scope check
  monitors.rs        Tauri-facing enumeration and role resolution
  permissions.rs     AVFoundation microphone/camera authorisation
  shortcuts.rs       Control+Alt+Space
  speech.rs          AssemblyAI token broker transport
  window.rs          building, showing, placing and closing windows
  window_spec.rs     all eight windows as serialisable structs. No Tauri.
state/
  app_state.rs       uptime only
  display_state.rs   role→display + resolution, persisted atomically
  file_state.rs      media folders + the live scope they define
  persist.rs         load-or-default and atomic save, shared
  window_state.rs    per-window crash history for the loop guard
errors.rs      the single AppError crossing the boundary: { kind, message }
```

**Events emitted to the frontend.** `display:list-changed`,
`output-window-closed`, `media-stage-window-closed`,
`worship-stage-window-closed`, `open-import`, `ai-operator:toggle-shortcut`,
`auth-callback`. All but the first match the names Electron sends.

**Files the Rust core owns**, in one app-config directory:
`display-preferences.json` and `media-folders.json`.

**The TypeScript side** is `src/renderer/tauri/`:

- `boot.ts` — the first module each Tauri window runs. Installs the bridge.
  Loaded before the React entry in `index.html` and `output.html`, and the
  ordering there is the whole mechanism.
- `electron-bridge.ts` — `window.electronAPI` backed by `invoke`. Temporary by
  design; each entry goes away when its subsystem moves to Rust. Anything not
  implemented reads as `undefined` and reports itself once into the Rust log.
- `runtime.ts` — the typed `invoke` wrapper
- `boot-probe.ts` — startup smoke test, operator window only. Now also proves
  the file scope and exposes `__presentFiles` and `__presentWindows` so the
  dialogs and window openers can be driven by hand.
- `capability-probe.ts` — the WKWebView feature report

Outside that directory, exactly three files know both shells exist:
`src/shared/lib/local-media-url.ts` (which imports nothing from either) and the
two callers that use it.

**Test counts.** 191 Rust, 55 JS. `bun run --filter @present/desktop tauri:check`
runs fmt, clippy with `-D warnings`, and the Rust tests.

## 6. Decisions already made — do not relitigate

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

## 7. What is verified vs. assumed

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
- All eight windows opening, showing, reopening without a duplicate-label
  failure, and closing — in `tauri dev` **and** in the packaged `.app`, where
  the URL is `tauri://localhost/index.html?window=…` rather than a dev-server
  URL. The three fullscreen roles reported `fullscreen: true`.
- macOS lifecycle: closing the last window leaves the process running, and
  `open -a Present.app` recreates the operator window in that same process.
- Hot-plug reconcile, both paths: a window already covering its display is left
  untouched, and a displaced one is moved back and re-fullscreened. A steady
  single-monitor run produces no display-change events at all.
- **The file scope, from inside the webview.** `read_folder` on `/etc` returns
  `denied`; `local-media://media/etc/passwd` returns **403**; a file in a
  granted folder returns **206** with `Content-Range: bytes 0-15/57` and 16
  bytes. The refusal logs the canonical `/private/etc/passwd`, so the symlink
  was resolved before the check.
- Media folders loading from `media-folders.json` on a fresh launch, and the
  scope they define working immediately.
- The application menu installed and correct: `Present File Edit View Window`.
- React mounting under Tauri and reaching the native layer through the bridge.

**Not verified — do not claim otherwise:**

- No live AssemblyAI transcription end-to-end. Needs the owner signed in.
- Display id across an **OS reboot**. App restarts only. (Lower risk than first
  thought: the name is a hardware model number, not a display id.)
- Nothing on Windows or Linux. macOS only so far. In particular there is **no
  webview crash recovery at all** on those two platforms — Tauri's only hook is
  macOS/iOS-gated. known-issues §10.
- **Nothing on a second monitor.** This machine has one screen. Window
  placement is exercised only at the origin, which is exactly where a
  physical-vs-logical pixel mistake is invisible, and no window has been moved
  from one monitor to another. This is the outstanding Stage 2 gate.
- **No Stage 3 dialog has been opened**, no `present://` link followed, no
  global shortcut pressed, no permission prompt shown. Code and tests only.
  `__presentFiles` exposes each of them; stage-3-native-apis.md §6 is the list.
- **No media has actually played through `local-media://`.** A range request
  returns the right bytes; a video decoding and playing in WKWebView is
  a different claim and has not been made.
- **The operator window is blank under Tauri.** React mounts and reaches the
  Rust core, then waits on an auth session the Tauri origin does not have. See
  §4.

## 8. Working agreements

- **Never push.** Local commits on `rust` only.
- **The monorepo runs on bun**, not pnpm. `bunfig.toml` pins the hoisted linker
  and must stay that way — see the traps below.
- **Three files in the working tree are the owner's own in-progress edits** —
  `ServicesSidebar.tsx`, `useOfflineSyncEngine.ts`, `localData.ts`. Stage only
  your own paths; never `git add -A` from the repo root.
- Commit messages end with `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`.
- `bun run --filter @present/desktop lint` **fails on `master` too** — 10
  pre-existing errors, deliberately not fixed (see known-issues §7). Do not
  claim credit for them and do not silently "fix" them inside a migration commit.
- Before moving any subsystem: write characterisation tests against the current
  Electron behaviour first. Audit §10.8.
- When the repo can answer a question, read it rather than guessing. Reading
  tao's source is what corrected a wrong assumption about monitor ids.
- Verify on real hardware where possible. A Tauri webview's console is invisible
  from a terminal — mirror findings into the Rust log via
  `commands::diagnostics::report_diagnostic`.

## 9. Commands

The monorepo runs on **bun**, not pnpm. Root aliases start each app from
anywhere in the tree:

```bash
bun run desktop:tauri          # Tauri + Vite — the app being built
bun run desktop:electron       # Electron, unchanged, still the shipping app
bun run web                    # Next.js web app
bun run convex                 # Convex CLI
```

Everything else:

```bash
bun run desktop:tauri:build                     # production bundle
bun run --filter @present/desktop tauri:check   # fmt + clippy -D warnings + tests
bun run test                                    # 48 JS tests
bun run typecheck
bun run lint
node apps/desktop/scripts/check-tauri-version.mjs [--fix]
```

`bun run desktop:tauri` exists because `bun tauri dev` from the repo root does
not work: the Tauri CLI finds `src-tauri` by scanning the workspace but runs
`beforeDevCommand` from the invocation directory, where `tauri:vite:dev` is not
a script. Run it from `apps/desktop` or use the alias.

Current: **191 Rust tests, 55 JS tests**, clippy/fmt/typecheck clean.

## 10. Installed skills

`rust-best-practices`, `rust-async-patterns`, `rust-testing`, `rust-patterns`,
`rust-engineer`, `tauri-v2`, plus `frontend-design` globally. Project-scoped in
`.agents/skills` with symlinks in `.claude/skills`.

The owner asked about `JavaScript-Mastery-Pro/skills`; it was assessed as a
generic nine-step workflow pack that overlaps and competes with the migration
plan's own stage gates. Not installed. That was advice, not a veto — install it
if asked.

## 11. Traps

- **The Electron main process owns almost no state.** It is a relay: `send-to-output`
  forwards opaque `unknown` blobs. Presentation state lives in React
  (`PresentContainer.tsx`, 2 244 lines). Inverting that is the whole migration.
- **The single-audible-video invariant is held by nine hard-coded `muted`
  attributes across nine files**, not by architecture. Any new `<video>` that
  forgets one reintroduces audience echo.
- **Dev and packaged builds keep entirely separate state** — different session
  files *and* different renderer origins, so different localStorage/IndexedDB.
  Tauri is a sixth origin and starts blank. known-issues §2.
- **The file scope is the security boundary, and it is one module.**
  `services/file_scope.rs`. Anything new that takes a path from the frontend
  goes through `FileState::resolve_existing` or `resolve_new` — not through
  `std::fs` directly. A command that skips it reopens known-issues §3.
- **`Display.bounds` is physical pixels under Tauri and device-independent
  pixels under Electron.** The settings picker prints it, so a scaled built-in
  display reads 3840×2400 there rather than Electron's 1920×1200.
- **A Tauri custom-scheme response is a `Vec<u8>`, not a stream.** Anything
  serving bytes has to chunk. `media_protocol.rs` caps at 8 MiB.
- **The bridge is not the API.** `window.electronAPI` under Tauri is a
  compatibility shim that shrinks every stage. Do not add to it for anything
  Rust should own outright.
- **`bunfig.toml` sets `linker = "hoisted"` and that is load-bearing.** Bun
  defaults to an isolated `node_modules` for workspaces. Under it,
  `scripts/stage-ndi.cjs` finds no `grandi` at the repo root and the packaged
  Electron app ships with no NDI backend — silently, because the script reports
  nothing staged rather than failing. The removed `.npmrc` asked pnpm for the
  same layout.
- **`overrides` in the root `package.json` pins `@electron/node-gyp`.**
  `@electron/rebuild` depends on it by GitHub commit. Bun resolves that as a
  git dependency and fails to link it (`clonefileat` ENOENT), which aborts the
  whole install. The override points at the codeload tarball for the same
  commit, which is what pnpm resolved it to, so it changes the transport and
  not the code. Remove it when Electron goes.
- Commands the frontend can reach need registering in `generate_handler!`, or
  they fail silently.
- **Any command that builds a window must be `async`.** A synchronous one
  deadlocks on Windows under WebView2 and works fine on macOS, so nothing local
  catches it.
- **Tauri monitor geometry is physical pixels; `WebviewWindowBuilder` takes
  logical ones.** On a 2× display that is a whole screen's width of error, and
  it is invisible on a 1× test rig.
- **Six of the eight windows load the same `index.html`.** Anything added to a
  shared entry runs once per open window. That is what `boot-probe.ts` is gated
  on the window label for.
- JavaScript numbers are exact only to 2^53−1. Anything hashed or generated in
  Rust and sent to the UI as a number must respect that.
