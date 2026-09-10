# Known issues found during the migration

Bugs discovered while auditing or porting, each assigned to the stage that owns
the fix. Nothing here is fixed in the Electron build unless the fix is a
zero-behaviour-change change, per migration rule 4.

| # | Issue | Severity | Status |
|---|---|---|---|
| 1 | Backing tracks ignore the audio-output-device setting | High | Stage 5 |
| 2 | Dev and packaged builds keep entirely separate state | High | Stage 3 |
| 3 | `local-media://` can read any file on disk | Medium | Stage 3 |
| 4 | Media panel hidden behind a dead File System Access check | Medium | **Fixed** |
| 5 | `vosk` is a dependency that is never imported | Low | Stage 7 |
| 6 | Build workflows trigger on a branch that does not exist | Low | Open |
| 7 | Ten pre-existing ESLint errors | Low | Deferred — see below |
| 8 | Speech-to-search blocked by a CORS preflight, not by Electron | Medium | **Fixed** |
| 9 | Monitor hot-plug never moved the output window | High | **Fixed** |
| 10 | No webview crash recovery on Windows or Linux under Tauri | Medium | Stage 7 |

---

## 1. Backing tracks ignore the audio-output-device setting

`AudioTabPanel.tsx:136` creates its own `new Audio()` for playlist playback and
sets `.volume` on it, but never calls `setSinkId`. Across the whole repository
`setSinkId` appears exactly once, in `useShowVideoSync.ts:121`, which routes the
Show-View video only.

So the audio-output-device setting added in `e81feb0` covers video and nothing
else. On a laptop whose default output is the built-in speakers, video audio
goes to the desk while backing tracks come out of the laptop.

**Fix (Stage 5):** one Rust-owned audio path. Both the presentation video and
the track player feed the same sink, and device selection is a property of the
sink rather than of each HTML element. See
[ADR-001](adr-001-output-compositor.md).

---

## 2. Dev and packaged builds keep entirely separate state

Two independent mechanisms split state by build:

**Main process.** `session-storage.service.ts:38-41` branches on
`app.isPackaged` and writes either `desktop-auth-session.v1.json` or
`desktop-auth-session.dev.v1.json`. Both files exist in the same `userData`
directory on a developer machine.

**Renderer.** Chromium partitions `localStorage` and IndexedDB by origin, and
the two builds have different origins — the dev build loads from the Webpack dev
server (`http://localhost:3000`), the packaged build from `app://app`
(`main.window.ts:78-88`). Observed partitions on one machine:

```
app_app_0.indexeddb.leveldb            packaged  (app://app)
http_localhost_3000.indexeddb.leveldb  dev
app_-_0.indexeddb.leveldb              older app:// variant
file__0.indexeddb.leveldb              pre-app:// era
http_localhost_3002.indexeddb.leveldb  another dev port
```

Everything the renderer persists is therefore duplicated per build: the ~20
`present-*` localStorage keys (settings, looks, timers, service state, media
filters, browser history) and the offline IndexedDB blob with its sync queue.

This is the cause of "sometimes when I open the app I am signed out" — it
depends on whether that launch was `bun run desktop:electron` or the
installed `.app`.

**Note for the migration:** Tauri serves from `tauri://localhost`, which is a
*sixth* origin. The Tauri build starts with no session, no settings and no
offline data. That is expected, but it needs a deliberate import path rather
than being discovered by a user.

**Fix (Stage 3):** move durable state out of origin-partitioned web storage into
Rust-owned persistence under a single app-data directory, keyed by nothing but
the app itself. That removes the dev/prod split and the Electron→Tauri
migration problem in one move. Auth tokens go to the OS keychain.

---

## 3. `local-media://` can read any file on disk

`protocol.service.ts:137-145` takes the URL pathname and passes it straight to
`fs.stat` / `fs.createReadStream` with no containment check, so the renderer can
read any file the user can read.

**Fix (Stage 3):** Tauri's asset protocol with an explicit scope limited to the
configured media folders. Do not reproduce the open-ended behaviour.

---

## 4. Media panel hidden behind a dead File System Access check — FIXED

`MediaPanel.tsx` gated its entire render on
`"showDirectoryPicker" in window` and otherwise showed *"Your browser doesn't
support the File System Access API. Please use Chrome, Edge, or another
Chromium-based browser."*

The app has never called that API. `showDirectoryPicker` appeared nowhere except
in the check itself and in an unused `src/shared/types/file-system.d.ts`. Media
folders are chosen with a native dialog (`useMediaFolders.addFolder` →
`selectFolder`) and read through the native layer. The check is a leftover from
a browser-based version of the app.

Under Chromium the condition was always true, so nobody saw it. Under a
non-Chromium webview — Tauri uses WKWebView on macOS — it hid a working panel.

**Fixed:** the gate and the unused type declarations are removed. No behaviour
change for Electron, where the branch was unreachable.

Note that the Media panel still cannot list folders under Tauri, because
`window.electronAPI` does not exist there yet. That is Stage 3 work; this fix
only removes a misleading message that was hiding the real state of things.

---

## 5. `vosk` is a dependency that is never imported

`vosk@0.3.39` is in `apps/desktop/package.json` but appears in no source file.
Speech recognition actually runs through AssemblyAI over a WebSocket
(`useSpeechRecognition.ts:134`).

**Fix (Stage 7):** drop it with the rest of the Electron dependency set.

---

## 6. Build workflows trigger on a branch that does not exist

`build-macos.yml`, `build-windows.yml`, `build-linux.yml` and `quality.yml` all
declare `push: branches: [main]`. This repository's default branch is `master`
and there is no `main`. Push-triggered builds never fire; only tag pushes and
`workflow_dispatch` work.

Unrelated to the migration and left alone deliberately — changing release
triggers is not a migration decision. `tauri.yml` lists both `master` and `main`
so it actually runs.

---

## 7. Ten pre-existing ESLint errors

`bun run --filter @present/desktop lint` fails on `master` as well as on
`rust`. Two were fixed because they were free:

- `prefer-const` on `ndiInputClientIds` (`ndi.service.ts:83`) — the set is
  mutated, never reassigned.
- the dead File System Access branch above.

The remaining ten are left alone on purpose:

- **eight** `react-hooks/set-state-in-effect` (`useCategories.ts` ×3,
  `MessagesTabPanel.tsx` ×2, `ScripturePanel.tsx`, `useShowVideoSync.ts`, and
  one more). Fixing these changes render timing in live-service code paths.
  Migration rule 4 says not to change product behaviour unless required, and
  several of these files are rewritten in Stages 4 and 5 anyway.
- **one** "Cannot call impure function during render" —
  `SpeechScriptureStack.tsx:58` calls `Date.now()` during render to compute a CSS
  animation duration. Benign in practice; the fix is a restructure.
- **one** React Compiler "Compilation Skipped: existing memoization could not be
  preserved" (`PresentCenterArea.tsx:164`) — informational.

These should be cleaned up as their own task, not folded into migration commits
where they would obscure the diff.

---

## 8. Speech-to-search was blocked by a CORS preflight — FIXED

Speech search ended up being used through the web app rather than the desktop.
The cause was not Electron IPC and not the microphone.

`useSpeechRecognition.ts` fetched its AssemblyAI token by calling the web app's
`/api/assemblyai/token` **directly from the renderer**, with an `Authorization`
header. That is a cross-origin request with a non-simple header, so the browser
issues a CORS preflight from the app's origin (`app://app`) before the real
request ever leaves.

A main-process broker was written to sidestep exactly this — `network.ipc.ts:251`
uses `net.fetch` with an explicit `Origin` header, which is not subject to
renderer CORS. It is registered in `ipc/index.ts`, exposed in `preload.ts:74`
and typed in `electron.d.ts:209`. **Nothing ever calls it.** The direct fetch is
what shipped. The fix existed and was never wired up.

### Can it work under Tauri?

Measured rather than assumed, because the Tauri webview is WKWebView on macOS
rather than Chromium. `src/renderer/tauri/capability-probe.ts` reports what the
runtime actually supports; results on macOS 15 / WKWebView 605.1.15:

| Capability | Result |
|---|---|
| `navigator.mediaDevices` | present |
| `getUserMedia` | present |
| `enumerateDevices` | present |
| `HTMLMediaElement.setSinkId` | **present** |
| `AudioContext` | present |
| `AudioWorklet` | present |
| `WebSocket` | present |
| `MediaRecorder` | present |
| `SpeechRecognition` | present |
| **live microphone capture** | **granted** |

Everything the streaming path needs is there, and `hasStreamingSupport`
(`useSpeechRecognition.ts:355`) never depended on `electronAPI` in the first
place — it checks `WebSocket`, `getUserMedia` and `AudioContext`, all present.

`setSinkId` being available matters beyond speech: it is how audio output
routing works today (`useShowVideoSync.ts:121`), and Safari's historical lack of
it would have broken the audio-device feature under Tauri.

### Fix

Token minting and usage reporting both moved into the Rust core
(`src-tauri/src/services/speech.rs`). The web app stays the broker — the desktop
must never hold an AssemblyAI key — but a request from Rust is not a browser
request, so there is no preflight and no origin allowlist to keep in step as the
app's origin changes.

The usage call mattered as much as the token call: speech search is metered by
the second, and `/api/assemblyai/usage` was a fire-and-forget `fetch` that the
preflight would have dropped **silently**, leaving sessions unbilled.

Both are behind a `__TAURI_INTERNALS__` check with a dynamic import, so the
Electron path and bundle are untouched.

### Still open

`src/main/ipc/network.ipc.ts` still registers the orphaned
`request-assemblyai-token` handler, and `preload.ts` still exposes it. Both are
dead code and go with the rest of the Electron layer in Stage 7.

---

## 9. Monitor hot-plug never moved the output window — FIXED

`main/index.ts:74-82` subscribes to `display-added`, `display-removed` and
`display-metrics-changed`, and each one calls `reconcileOutputWindowDisplay()`.
That function reaches `moveOutputWindowToDisplay`, whose whole body is guarded:

```js
if (!outputWindow.isFullScreen()) {
  outputWindow.setBounds(...);
  outputWindow.setFullScreen(true);
}
```

The output window is created with `fullscreen: true` (`output.window.ts:57`) and
re-asserts it on `ready-to-show` (`output.window.ts:76-81`). So by the time any
`screen` event can fire, `isFullScreen()` is already true and reconcile does
nothing.

The three subscriptions have therefore never moved the audience output. The
scenario they exist for — a projector unplugged and replugged mid-service, or a
resolution change — leaves the output window on whichever monitor it started on,
or on no visible monitor at all.

**Fixed** in the Tauri build — see
[stage-2-hotplug.md](stage-2-hotplug.md). The guard was replaced rather than
deleted: deleting it would drop the projector out of fullscreen and back on
every unrelated display event. `plan_reposition` asks whether the window is
already exactly covering the right monitor, in fullscreen, and only a window
that is genuinely wrong pays the transition.

Two things came out of fixing it. The reconcile now covers the two stage
displays as well as the audience output, which have the same problem. And
including the work area in the change comparison caused a feedback loop, because
macOS changes it when the menu bar hides for a fullscreen window.

Electron is untouched, per migration rule 4.

---

## 10. No webview crash recovery on Windows or Linux under Tauri

Electron's `render-process-gone` fires on every platform, and both the main and
output windows use it to reload after a renderer crash
(`main.window.ts:196-227`, `output.window.ts:83-92`).

Tauri 2.11 exposes one equivalent, `Builder::on_web_content_process_terminate`,
and it is `#[cfg(any(target_os = "macos", target_os = "ios"))]`. The underlying
hook is WKWebView's `webViewWebContentProcessDidTerminate:`; wry has no
counterpart wired for WebView2 or WebKitGTK.

So on macOS the Tauri build recovers exactly as Electron does, and on Windows and
Linux a crashed webview stays crashed. The policy itself is platform-independent
(`services/window_spec.rs`) and covered by tests, so only the trigger is missing.

**Fix (Stage 7):** this is a parity item, and Stage 7's gate is the parity
checklist. The options are a wry patch exposing the WebView2 `ProcessFailed`
event and the WebKitGTK `web-process-terminated` signal, or a liveness check
driven from Rust. Both need the Tauri build actually run on those platforms
first; CI produces Windows and Linux bundles today but nobody has launched one.
