# Stage 0 — Present Electron Audit

**Status:** complete · **Date:** 2026-09-08 · **Branch:** `rust` · **Baseline:** `7373da5`, desktop `v0.3.8`

This is the pre-migration audit required by the migration plan. No code has been changed.
Nothing here is speculative — every claim is anchored to a file and line in the repo at the
baseline commit.

---

## 1. Repository shape

```
present-monorepo/
  apps/
    desktop/          @present/desktop  — Electron 41 + Forge 7 + Webpack, React 19
    web/              @present/web      — companion web app (auth origin)
  packages/
    backend/          @present/backend  — Convex functions + generated API
    shared/           @present/shared   — Zustand workspace store, shared types
  docs/
```

`apps/desktop/src` is **~62 000 LOC across 208 TS/TSX files**, split:

| Area | Files | LOC | Note |
|---|---:|---:|---|
| `src/main/**` | 51 | ~8 200 | Electron main process — already modular |
| `src/shared/**` | 8 | ~750 | types shared main↔renderer |
| `src/renderer/**` | ~35 | ~9 500 | window roots, shared hooks, stores, offline layer |
| `src/features/**` | ~115 | ~43 500 | all product UI |

The main process is genuinely well-factored (`ipc/`, `services/`, `windows/`, `menu/`,
`utils/`, `ai/`) and `src/main/index.ts` is a 111-line lifecycle file. **This structure should
be preserved and mirrored in Rust**, not discarded.

---

## 2. Architecture map (as-built)

```
                       ┌──────────────────────────────────────────┐
                       │  React renderer (main_window bundle)      │
                       │                                           │
                       │  App.tsx ─ routes on ?window= param       │
                       │    ├─ (none)         → full app           │
                       │    ├─ settings       → SettingsScreen     │
                       │    ├─ looks          → LooksWindow        │
                       │    ├─ media-stage    → StageDisplayWindow │
                       │    ├─ worship-stage  → WorshipStage…      │
                       │    ├─ screen-composer→ ScreenComposer…    │
                       │    └─ mini-lyrics    → MiniLyricsWindow   │
                       │                                           │
                       │  PresentContainer  ← AUTHORITATIVE STATE  │
                       │  useLooksConfig    ← output layer flags   │
                       │  useShowVideoSync  ← THE audible player   │
                       │  useOutputBroadcast─ diff & fan-out       │
                       └───────────────┬───────────────────────────┘
                                       │ contextBridge `electronAPI`
                                       │ 79 IPC channels
                       ┌───────────────▼───────────────────────────┐
                       │  Electron main — MOSTLY A RELAY            │
                       │                                           │
                       │  window.ipc  : send-to-output ──────┐     │
                       │                send-to-stage        │ opaque
                       │                send-to-worship-stage│ blobs
                       │  file.ipc    : dialogs + fs                │
                       │  ndi.service : capturePage @30fps         │
                       │  browser-view: BrowserView embed          │
                       │  pptx        : python3 subprocess         │
                       └───────────────┬───────────────────────────┘
                                       │
                       ┌───────────────▼───────────────────────────┐
                       │  output_window bundle (separate entry)     │
                       │  OutputWindow.tsx — pure renderer of blobs │
                       │  every <video> hard-coded muted            │
                       └────────────────────────────────────────────┘
```

**The single most important structural fact:** the Electron main process owns almost no
application state. Presentation, media, output-layer and playback state all live in React
(`PresentContainer.tsx`, `useLooksConfig`, `useShowVideoSync`), and main is a dumb postman
that forwards `unknown` payloads between windows (`src/main/ipc/window.ipc.ts:180-215`).

That is precisely the inversion the migration exists to perform.

---

## 3. Windows

Eight window modules, but only **two Webpack renderer entry points**
(`forge.config.ts:96-118`): `main_window` and `output_window`. Six of the eight windows load
the `main_window` bundle with a `?window=<role>` query string and branch inside `App.tsx:52-72`.

| Window | Module | Bundle | Display target | Frame | Purpose |
|---|---|---|---|---|---|
| Main | `windows/main.window.ts` | `main_window` | primary | yes | operator UI |
| **Audience / output** | `windows/output.window.ts` | `output_window` | preferred external | **frameless, fullscreen, `#000`** | production-critical |
| Media stage | `windows/media-stage.window.ts` | `main_window?window=media-stage` | role `media` | — | confidence monitor |
| Worship stage | `windows/worship-stage.window.ts` | `main_window?window=worship-stage` | role `worship` | — | stage display |
| Settings | `windows/settings.window.ts` | `main_window?window=settings` | primary | yes | settings |
| Looks | `windows/looks.window.ts` | `main_window?window=looks` | primary | yes | look editor |
| Screen composer | `windows/screen-composer.window.ts` | `main_window?window=screen-composer` | primary | yes | region layout |
| Mini lyrics | `windows/mini-lyrics.window.ts` | `main_window?window=mini-lyrics&libraryId=…` | primary | yes | quick lyric edit |

Output window hardening already present and **must be preserved verbatim in Tauri**
(`output.window.ts:57-90`):

- `backgroundColor: '#000000'` + `show: false` until `ready-to-show` — no white flash
- `backgroundThrottling: false` — no blank frame when the main window takes focus
- `render-process-gone` → automatic single reload
- `screen` hot-plug events (`main/index.ts:69-79`) → `reconcileOutputWindowDisplay()`

Main window carries an equivalent crash-recovery policy with a loop guard
(`main.window.ts:184-222`): reload on crash, but stop after 2 crashes inside 10 s.

---

## 4. IPC inventory — 79 channels

70 `ipcMain.handle` (request/response) + 9 `ipcMain.on` (fire-and-forget), plus 15
main→renderer `webContents.send` channels.

### Window & display (23)
`get-displays` · `set-preferred-output-display` · `get-preferred-output-display` ·
`set-preferred-display` · `get-preferred-display` · `set-preferred-resolution` ·
`open-output-window` · `close-output-window` · `open-media-stage-window` ·
`close-media-stage-window` · `open-worship-stage-window` · `close-worship-stage-window` ·
`open-looks-window` · `close-looks-window` · `open-screen-composer-window` ·
`close-screen-composer-window` · `open-mini-lyrics-window` · `close-mini-lyrics-window` ·
`mini-lyrics:ready` · `mini-lyrics:save` · `mini-lyrics:save-response` ·
`send-to-output` · `output-ready`

### Stage relay (4)
`send-to-stage` · `stage-ready` · `send-to-worship-stage` · `worship-stage-ready`

### File system (14)
`select-folder` · `select-library-export-destination` · `read-folder` · `select-media-file` ·
`select-audio-files` · `select-prop-image` · `select-prop-media` ·
`select-presentation-files` · `copy-media-file` · `rename-media-file` · `delete-media-file` ·
`create-directory` · `rename-directory` · `import-library-bundle` · `export-library-bundle`

### Bible (3)
`list-bundled-bibles` · `read-bundled-bible` · `fetch-hosted-bible-catalog`

### Auth & network (8)
`begin-auth-flow` · `consume-pending-auth-token` · `get-stored-auth-session` ·
`set-stored-auth-session` · `clear-stored-auth-session` · `refresh-desktop-session` ·
`open-external-browser` · `request-assemblyai-token`

### Browser mode (9)
`browser-mode:set-enabled` · `browser-mode:set-bounds` · `browser-mode:navigate` ·
`browser-mode:back` · `browser-mode:forward` · `browser-mode:reload` ·
`browser-mode:set-projection` · `browser-mode:get-state` · `fetch-browser-suggestions`

### Fonts (5)
`get-system-fonts` · `get-system-font-faces` · `pick-font-file` · `install-custom-fonts` ·
`get-custom-fonts`

### NDI (6)
`ndi:start` · `ndi:stop` · `ndi:status` · `ndi:list-sources` · `ndi:start-input` ·
`ndi:stop-input`

### PPTX (2) · Permissions (2) · AI (1) · Errors (1)
`open-pptx` · `parse-pptx` — `request-microphone-access` · `request-camera-access` —
`ai-operator:list-tools` — `report-renderer-error`

### Main → renderer events (15)
`output-data` · `output-window-closed` · `output-ready` · `stage-data` · `stage-ready` ·
`media-stage-window-closed` · `worship-stage-data` · `worship-stage-ready` ·
`worship-stage-window-closed` · `auth-callback` · `open-settings` · `open-import` ·
`browser-state-changed` · `browser-focus-address` · `mini-lyrics:data` ·
`mini-lyrics:save-request`

**Redesign note.** Roughly 30 of these are already domain-shaped and port 1:1. The ~10
`send-to-*` / `*-ready` relay channels are *not* an API — they are a symptom of state living
in the wrong process and must be replaced by Rust-owned state + typed events, not renamed.

---

## 5. Media, audio and output pipeline

This is the highest-risk subsystem and the one the plan singles out. The findings are better
than feared in one respect and worse in another.

### 5.1 Media asset model

```ts
// features/media/hooks/useMediaFolders.ts:6
type MediaItem = { id; name; type: "image" | "video"; url; path; folderId; lastModified }
type VideoSettings = { loop: boolean; muted: boolean; volume: number }
```

Media is served to the renderer over a custom `local-media://` scheme registered as
privileged with `stream: true` and full HTTP `Range` support
(`services/protocol.service.ts:135-198`). Video is therefore decoded by Chromium, not by the
main process. There is **no Rust/FFmpeg-style media engine today** — playback is entirely
HTML `<video>`.

### 5.2 The 15 `<video>` elements

| File | Line | Muted? |
|---|---:|---|
| `renderer/output/OutputWindow.tsx` | 486, 569, 624, 945, 1216 | **hard-coded `muted`** ×5 |
| `features/slides/OutputPreview.tsx` | 553, 1391, 1632 | **hard-coded `muted`** ×3 |
| `features/stage/WorshipStageDisplayWindow.tsx` | 261 | **hard-coded `muted`** |
| `features/screen-composer/ScreenComposerWorkspace.tsx` | 284 | **hard-coded `muted`** |
| `features/sidebar-rail/panels/LayersTabPanel.tsx` | 1114 | **hard-coded `muted`** |
| `features/services/ServicesSidebar.tsx` | 1416 | **hard-coded `muted`** |
| `features/media/MediaPanel.tsx` | 141 | **hard-coded `muted`** |
| `features/settings/components/SettingsScreen.tsx` | 1829 | preview thumb |
| `features/present/PresentCenterArea.tsx` | 183 | **`muted={videoSettings.muted}` — the only audible one** |

### 5.3 Current audio ownership model

There is exactly **one audible video element in the application**: the Show-View player in
`PresentCenterArea.tsx:183`, driven by `useShowVideoSync.ts`. Its own comment states the
intent (`useShowVideoSync.ts:107-109`):

> The presenter Show View is the application's only audible video player. All external
> display windows are muted mirrors, so video audio works even before a projector is opened.

Every mirror — output, worship stage, preview, props, screen composer, thumbnails — is
muted at the JSX level. Volume, mute and `setSinkId()` routing are applied only to that one
element (`useShowVideoSync.ts:110-124`).

**Assessment: the duplicate-audio problem is currently solved by convention, not by
architecture.** It holds today, but it is enforced by nine independent hard-coded `muted`
attributes. Any future `<video>` that forgets one reintroduces the echo. In the Rust design
this must become a structural invariant: exactly one `AudioSink` in `AppState`, and mirror
surfaces that are *incapable* of producing audio.

### 5.4 Confirmed defect — second audio path bypasses device routing

`features/sidebar-rail/panels/AudioTabPanel.tsx:136` creates an independent
`new Audio()` for backing-track playlists. It sets `.volume` (line 147) but **never calls
`setSinkId`**. Verified: `setSinkId` appears in exactly one file in the whole repo
(`useShowVideoSync.ts:121`).

Consequence: the audio-output-device setting added in `e81feb0` applies to video only.
Backing tracks always play out of the system default device. On a service laptop whose
default is the built-in speakers, backing tracks go to the laptop while video audio goes to
the desk. **This is a live bug, not a migration artifact** — it should be captured as a
parity requirement, and the Rust mixer design must route *both* sources.

### 5.5 Output synchronisation

`useOutputBroadcast.ts` (422 lines) is the entire output pipeline. It:

1. builds four payload types — `active-slide`, `media-update`, `message-overlay`,
   `props-overlay`;
2. `JSON.stringify`s each into a signature and skips the send when unchanged;
3. tracks per-target signatures so output and worship stage dedupe independently;
4. re-sends everything on `output-ready` / `worship-stage-ready` (late-join resync);
5. honours a freeze flag by returning early.

Video position sync is a `shouldSyncTime` boolean plus `videoCurrentTime` sampled at ~10 Hz
(`useShowVideoSync.ts:176-186`). Mirrors seek when drift exceeds 0.5 s.

Costs to note for the rewrite: a full `JSON.stringify` of every payload on **every React
render** of the presentation tree, and a ~50-entry effect dependency array. This is the
strongest single argument for moving the state to Rust — the diffing becomes structural
equality on typed structs and the events become targeted deltas.

---

## 6. State architecture

| Layer | Mechanism | Scope |
|---|---|---|
| Presentation / output runtime | React `useState` in `PresentContainer.tsx` (16 hooks) and `App.tsx` | **authoritative, in-renderer** |
| Output layer visibility | `useLooksConfig` → `liveLook.targets.program.layers` | `App.tsx:534-545` |
| Workspace | Zustand `@present/shared` `useWorkspaceStore` | cross-package |
| UI-local | 6 Zustand stores in `renderer/shared/store` + 3 in `features/scripture/lib` | per-panel |
| Server data | Convex (`convex/react`) across 14 files | libraries, services, messages, themes, props, playlists, playback |
| Offline mirror | hand-rolled IndexedDB `present-offline-data/keyval` blob + localStorage mirror + sync queue (`offline/localData.ts`, 1069 lines) | libraries, services, messages, categories |
| Bible | **Dexie** `ScriptureDatabase` (`features/scripture/lib/db.ts`) | verses/translations only |
| Settings & UI prefs | ~20 `localStorage` keys | see below |
| Auth session | main process, `safeStorage`-encrypted file in `userData` (`session-storage.service.ts`) | tokens |
| Display / resolution prefs | **in-memory module globals in main, never persisted** (`display.service.ts:9-21`) | lost on restart |

`localStorage` keys in use: `present-settings`, `present-ui-state`, `present-looks-config`,
`present-timer-state-v1`, `present-playback-local`, `present-service-state`,
`present-service-templates-v1`, `present-default-service-template-id-v1`,
`present-screen-composer-v2`, `present-local-audio-v1`, `present-local-data-v1`,
`present-local-data-meta-v1`, `present-sync-queue-v1`, `present-sync-id-map-v1`,
`present-media-filters`, `present-sidebar-tab-v2`, `present-library-search-mode-v1`,
`present-browser-history-v1`, `present:resizable:*`.

Note the split-brain: main holds the *live* preferred display, the renderer holds the
*persisted* one in `present-settings` and pushes it down on boot. In the Rust design the
display preference should be owned and persisted in one place.

---

## 7. Native and external dependencies

| Dependency | Where | Migration character |
|---|---|---|
| **NDI** (`grandi` ESM + `.node` addon) | `services/ndi.service.ts` | Rust crate / FFI rewrite. Staged unpacked into `Resources/node_modules` by `scripts/stage-ndi.cjs` |
| **`font-list`** | `services/font.service.ts:112-121` | replace with Rust `font-kit`/`fontdb` |
| **Python 3 + `python-pptx`** | `services/pptx-python.service.ts:127-133` spawns `python3`/`python` on `parse_pptx.py` | keep subprocess (Tauri sidecar) or port |
| **`fast-xml-parser` + `jszip`** | `services/pptx.service.ts` legacy path | disabled unless `PRESENT_PPTX_LEGACY_FALLBACK=1` (`pptx.service.ts:829-838`) |
| **`pdfjs-dist`** | renderer | stays in React |
| **`vosk` 0.3.39** | **declared in `package.json`, imported nowhere** | dead dependency — drop |
| **AssemblyAI** | `useSpeechRecognition.ts` — browser `getUserMedia` + `AudioContext` + `wss://streaming.assemblyai.com/v3/ws` | stays in the webview; token minted in main |
| **Convex** | `packages/backend` | unchanged |
| **Clerk** | web app + `webviewTag: true`, CSP allowances, `setWindowOpenHandler` allow-list (`main.window.ts:150-170`) | auth is external-browser + `present://` deep link, so Tauri-friendly |
| **Bible XML** | `apps/desktop/bible`, shipped via `extraResource` | Rust file reads |

### Custom protocol schemes (`protocol.service.ts:41-68`)
- `app://` — production renderer origin (needed so Clerk sees a real origin, not `file://`)
- `local-media://` — ranged local media streaming
- `ndi-frame://` — latest received NDI frame as JPEG

---

## 8. Build and release

- **Bundler:** Webpack 5 via `@electron-forge/plugin-webpack`, dev server on :3000.
- **Makers:** Squirrel (Windows), ZIP (macOS), RPM + DEB (Linux).
- **Fuses enabled:** `RunAsNode` off, cookie encryption on, `OnlyLoadAppFromAsar`,
  `EnableEmbeddedAsarIntegrityValidation`.
- **`extraResource`:** `bible/`, `assets/icons/`, `parse_pptx.py`, staged NDI modules.
- **Protocol registration:** `present://` scheme declared in `packagerConfig.protocols`.
- **macOS entitlements:** `NSMicrophoneUsageDescription` on app and helper.
- **CI:** `.github/workflows/` — `build-macos`, `build-windows`, `build-linux`, `quality`,
  `release-desktop`; release gated by `.github/scripts/verify-desktop-release.mjs`.
- **Tests:** 8 `node --test` suites in `apps/desktop/tests` — all pure-logic
  (`scripture-parser`, `service-layout`, `verse-search-index`, `auth-refresh-policy`,
  `organization-scope-policy`, `service-library-id-map`, `slide-list-scroll`,
  `diagnostic-redaction`). **There are no media, output, window or display tests at all.**

⚠️ The three build workflows trigger on `push: branches: [main]`, but this repository's
default branch is `master` and no `main` branch exists. Push-triggered builds are therefore
dead; only tag pushes and `workflow_dispatch` fire. Unrelated to the migration, but worth
fixing before it hides a regression.

---

## 9. Migration matrix

Priority: **P0** = required for a runnable Tauri build · **P1** = required for parity ·
**P2** = required before Electron can be deleted.

| # | Feature | Today | Target | Pri | Risk |
|---|---|---|---|---|---|
| 1 | Main window | `BrowserWindow` | Tauri `WebviewWindow` | P0 | Low |
| 2 | Audience/output window | separate Webpack entry, frameless fullscreen | dedicated Tauri window + Rust `OutputState` | P0 | **High** |
| 3 | Secondary windows (6) | `?window=` on main bundle | same pattern, Rust-created | P0 | Low |
| 4 | Display management | `electron.screen`, in-memory prefs | Rust `display` service, persisted | P0 | Med |
| 5 | Display hot-plug | `screen.on(added/removed/metrics)` | Tauri monitor events + reconcile | P0 | Med |
| 6 | `local-media://` streaming | privileged scheme + Range | Tauri `asset:` protocol **with scope** | P0 | Med |
| 7 | `app://` origin | custom protocol for Clerk | Tauri default origin (`tauri://`) | P0 | Med |
| 8 | File dialogs (8) | `dialog.show*` | `tauri-plugin-dialog` | P0 | Low |
| 9 | File ops (6) | `node:fs` in `file.ipc` | Rust `filesystem` service, path-validated | P0 | Low |
| 10 | Presentation state | React `useState` | **Rust `PresentationState`** | P1 | **High** |
| 11 | Output/looks state | `useLooksConfig` localStorage | **Rust `OutputState`** + persistence | P1 | **High** |
| 12 | Output broadcast | JSON-diff over `send-to-output` | Rust events, typed deltas | P1 | **High** |
| 13 | Media playback | HTML `<video>` in Show View | Rust `MediaState` authority, webview render | P1 | **High** |
| 14 | Audio | one unmuted `<video>` + one stray `new Audio()` | **single Rust-owned audio path** | P1 | **High** |
| 15 | Audio device routing | `setSinkId` on video only | Rust output-device selection for all sources | P1 | Med |
| 16 | NDI output | `capturePage()` @30 fps → `grandi` | **no direct Tauri equivalent — see §10.1** | P1 | **Blocker** |
| 17 | NDI input | receiver → JPEG → `ndi-frame://` | Rust receiver + custom protocol | P1 | Med |
| 18 | Browser mode | `BrowserView` + mirrored view + `capturePage` | **Tauri child webviews (unstable) — see §10.2** | P2 | **Blocker** |
| 19 | PPTX | `python3` subprocess | Tauri sidecar (same script) | P1 | Med |
| 20 | Bible | XML in `extraResource`, Dexie cache | Rust reads; Dexie stays | P1 | Low |
| 21 | Fonts | `font-list` + `userData` install dir | Rust `fontdb` + install dir | P1 | Med |
| 22 | Auth | external browser + `present://` + `safeStorage` | `tauri-plugin-deep-link` + `tauri-plugin-stronghold`/keyring | P2 | Med |
| 23 | Convex + offline sync | renderer-only | unchanged | P2 | Low |
| 24 | Speech (AssemblyAI) | webview `getUserMedia` + WS | unchanged; token via Rust | P2 | Med |
| 25 | Global shortcut | `globalShortcut` (`Ctrl+Alt+Space`) | `tauri-plugin-global-shortcut` | P2 | Low |
| 26 | App menu | `Menu.buildFromTemplate` | Tauri v2 menu API | P2 | Low |
| 27 | AI Operator | 40+ tools → React setters | tools → **Rust commands** | P2 | Med |
| 28 | Error reporting | `report-renderer-error` + redaction | Rust logging | P2 | Low |
| 29 | Permissions (mic/cam) | `systemPreferences` | `tauri-plugin-macos-permissions` / native | P2 | Med |
| 30 | Installers | Forge makers | `tauri bundle` (dmg/msi/deb/rpm/AppImage) | P2 | Med |
| 31 | Vosk | unused dependency | **delete** | P2 | None |

---

## 10. Risks and blockers

### 10.1 🔴 BLOCKER — NDI output depends on `webContents.capturePage()`

`ndi.service.ts:325-341` runs a 33 ms interval that calls
`outputWindow.webContents.capturePage()`, converts to BGRA via `image.toBitmap()`, and pushes
the frame to the NDI sender. **Tauri has no equivalent API** — there is no supported way to
read back a webview's framebuffer at 30 fps.

Three viable paths, in order of preference:

1. **Render the audience output in Rust (wgpu) instead of a webview.** The output is a
   constrained scene — background media, slide text/elements, overlays. Compositing it in
   Rust gives NDI a native frame source, removes the capture round-trip, and removes the
   duplicate-`<video>` audio hazard by construction. Highest effort, best outcome, and it is
   what "make Rust the application core" actually implies for this app.
2. **OS-level window/display capture** (ScreenCaptureKit on macOS, DXGI Desktop Duplication
   on Windows, PipeWire on Linux) targeting the output window. Keeps the webview renderer;
   adds a screen-recording permission prompt on macOS and platform-specific code.
3. **Offscreen headless Chromium** purely as an NDI frame source. Duplicates the render and
   doubles GPU cost; a fallback, not a plan.

**This decision gates the whole media/output architecture and must be made before Stage 2.**

### 10.2 🔴 BLOCKER — Browser mode depends on `BrowserView`

`browser-view.service.ts` embeds a `BrowserView` inside the main window at renderer-supplied
bounds, mirrors it into a second `BrowserView` inside the output window, and uses
`capturePage()` for preview thumbnails. Tauri v2's multi-webview (child webviews inside one
window) is behind the `unstable` feature flag. Options: accept the unstable feature, restrict
browser mode to a separate real window, or defer the feature. Lowest-priority blocker — it is
P2 — but it should not be discovered late.

### 10.3 🟠 Media/audio rewrite is the highest-value, highest-risk work

The duplicate-audio invariant is currently held by nine hard-coded `muted` attributes. If the
Rust media engine keeps HTML `<video>` as the renderer, that fragility survives the migration.
Decide §10.1 first: option 1 removes the class of bug entirely.

### 10.4 🟠 Presentation state extraction touches ~44 000 LOC of UI

`PresentContainer.tsx` (2 244 lines) and `App.tsx` (954 lines) thread presentation state
through props into every feature panel. `usePresentAiToolProvider.ts` alone takes 40+ state
setters as props. Extracting state to Rust means rewriting those prop chains — which the
migration rules explicitly forbid doing as a big-bang. Plan it as: Rust becomes authoritative
per *slice* (output flags → media → slides), with a thin React adapter hook per slice so
component signatures don't change.

### 10.5 🟠 Clerk/auth origin change

Production currently serves the renderer from `app://app/…` specifically because Clerk needs a
real origin. Tauri serves from `tauri://localhost` (or `http://tauri.localhost` on Windows).
Clerk's allowed-origins configuration and the CSP in `csp.ts` both need revisiting, and the
`webviewTag: true` escape hatch has no Tauri equivalent.

### 10.6 🟡 `local-media://` has no path validation

`protocol.service.ts:137-145` takes the URL pathname and reads it directly — the renderer can
read **any file the user can read**. This is an existing hole; the Tauri migration should
close it with an explicit asset scope rather than reproduce it.

### 10.7 🟡 Python dependency for PPTX

`parse_pptx.py` requires a system `python3` with `python-pptx`. The XML fallback is disabled
by default (`pptx.service.ts:832`), so a machine without Python cannot import PPTX at all.
Package Python as a Tauri sidecar during the migration, or port the parser to Rust.

### 10.8 🟡 No tests for anything being migrated

All 8 existing tests are pure-logic. The subsystems with the highest migration risk — media,
audio, output, display — have zero coverage. Characterisation tests for the current behaviour
should be written *before* each subsystem moves, otherwise "verify parity" has nothing to
verify against.

---

## 11. Proposed target architecture

```
apps/desktop/
  src/                        # React — unchanged in structure
  src-tauri/
    Cargo.toml
    tauri.conf.json
    capabilities/
      main.json               # main window: full command set
      output.json             # output window: render-only, no fs, no dialog
      stage.json              # stage windows: read-only subscriptions
    src/
      main.rs                 # thin: builder, plugins, run
      lib.rs                  # wiring, state registration

      commands/               # #[tauri::command] — thin, no logic
        window.rs  display.rs  file.rs    media.rs
        presentation.rs       output.rs   bible.rs
        font.rs    pptx.rs    ndi.rs      auth.rs
        browser.rs ai_operator.rs

      state/
        app_state.rs          # AppState { presentation, media, output, display }
        presentation.rs       # service, slides, current index, freeze
        media.rs              # assets, playback instances, positions
        output.rs             # per-target layer flags (program/stage/ndi)
        display.rs            # monitors + persisted role→display map

      services/
        filesystem.rs         # scoped, validated
        display.rs            # enumerate, preferred-for-role, hot-plug reconcile
        window.rs             # create/close/move, fullscreen, recovery
        media.rs              # asset registry + playback authority
        audio.rs              # SINGLE sink; device routing for video AND tracks
        presentation.rs
        persistence.rs        # replaces the localStorage sprawl
        font.rs  bible.rs  pptx.rs (sidecar)  auth.rs  ndi.rs

      output/
        compositor.rs         # (if §10.1 option 1) wgpu scene → frame
        frame_sink.rs         # fan-out: window surface + NDI + capture

      events.rs               # typed event names, one place
      errors.rs               # AppError → serializable
      domain/                 # shared serde models, ts-rs exported
```

### Command surface (domain-shaped, seeded from the existing AI Operator tools)

The AI Operator tool catalogue in `src/main/ai/operator-tools.ts` is **already a domain command
API** — `next_slide`, `previous_slide`, `go_to_slide`, `play_video`, `stop_video`,
`set_text_visibility`, `set_output_freeze`, `change_background`, `play_audio`,
`start_countdown`, … 40+ verbs. It should be lifted directly into the Rust command surface;
the AI Operator then calls the same commands the UI calls, which is exactly the architecture
§17 of the plan asks for.

```
presentation: next_slide · previous_slide · show_slide · load_service · save_service
media:        play_media · pause_media · stop_media · seek_media
              set_media_volume · set_media_muted · set_audio_output_device
output:       get_output_state · set_output_layer · set_output_freeze
              open_output_window · close_output_window
display:      get_displays · get_preferred_display · set_output_display
              set_output_resolution
files:        pick_media · import_media · read_folder · export_library · import_library
```

### Events (Rust → React)

```
presentation:changed   media:state-changed   media:position
output:state-changed   output:display-changed
display:list-changed   ndi:status-changed    app:error
```

### Type sharing

Define domain models once in Rust with `serde` and generate TypeScript via `ts-rs` (or
`specta`/`tauri-specta`). Models: `Presentation`, `Slide`, `Service`, `ServiceItem`,
`MediaAsset`, `PlaybackState`, `OutputState`, `Display`, `Project`, `BibleVerse`. This
replaces the hand-maintained `src/shared/types/electron.d.ts` (359 lines).

---

## 12. Recommended sequence

| Stage | Content | Gate |
|---|---|---|
| **0** | This audit | ✅ done |
| **0.5** | **Decide §10.1 (NDI/compositor).** Spike: Rust wgpu output vs. OS capture. | Blocks Stage 2 design |
| **1** | `src-tauri` skeleton alongside Electron. Both `bun run desktop:electron` and `bun run desktop:tauri` work. Dev + prod builds on all three platforms. | Electron untouched |
| **2** | Windows + display. All 8 windows, role→display mapping, persistence, hot-plug, fullscreen, output hardening (black bg, no-throttle, crash reload). | Multi-monitor manual matrix |
| **3** | Native APIs: filesystem (scoped), dialogs, deep links, global shortcut, menus, permissions. | `local-media` scope closed |
| **4** | Presentation core into Rust, slice by slice: output layer flags → slides → service. React adapter hooks keep component props stable. | Characterisation tests first |
| **5** | Media engine + single audio path. Fixes §5.4 as part of the work. | Audio regression suite |
| **6** | NDI, per the §0.5 decision. | Discovery/connect/output/reconnect |
| **7** | Bible, fonts, PPTX sidecar, auth, AI Operator on Rust commands, error reporting, settings. | Parity checklist |
| **8** | Measure vs. Electron baseline, then remove Electron. | §21 definition of done |

**Before Stage 4 and 5, write characterisation tests against the current Electron build** —
particularly one that asserts exactly one audible media element exists for a given playback.
That test is the guardrail the plan's §18 demands, and it is the one regression that must
never return.

---

## 13. Open questions for the product owner

1. **NDI frame source (§10.1)** — is a Rust-composited audience output acceptable, given it
   means the output window stops being a React surface? This is the single highest-leverage
   decision in the migration.
2. **Browser mode (§10.2)** — accept Tauri's unstable multi-webview, demote browser mode to a
   separate window, or defer it past the Electron cutover?
3. **PPTX** — ship Python as a sidecar (≈ +40 MB per installer) or invest in a Rust parser?
4. **Backing-track routing (§5.4)** — fix in the Electron build now, or only in the Rust
   rewrite? It is a live bug either way.
