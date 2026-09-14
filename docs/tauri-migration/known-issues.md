# Known issues found during the migration

Bugs discovered while auditing or porting, each assigned to the stage that owns
the fix. Nothing here is fixed in the Electron build unless the fix is a
zero-behaviour-change change, per migration rule 4.

| # | Issue | Severity | Status |
|---|---|---|---|
| 1 | Backing tracks ignore the audio-output-device setting | High | **Fixed** under Tauri; unchanged under Electron |
| 2 | Dev and packaged builds keep entirely separate state | High | Stage 3 |
| 3 | `local-media://` can read any file on disk | Medium | **Fixed** |
| 4 | Media panel hidden behind a dead File System Access check | Medium | **Fixed** |
| 5 | `vosk` is a dependency that is never imported | Low | Stage 7 |
| 6 | Build workflows trigger on a branch that does not exist | Low | Open |
| 7 | Ten pre-existing ESLint errors | Low | Deferred — see below |
| 8 | Speech-to-search blocked by a CORS preflight, not by Electron | Medium | **Fixed** |
| 9 | Monitor hot-plug never moved the output window | High | **Fixed** |
| 10 | No webview crash recovery on Windows or Linux under Tauri | Medium | Stage 7 |
| 11 | Unfreezing the output does not catch the audience screen up | Medium | **Fixed** |
| 12 | The Looks window and the operator window agree by polling | Medium | **Fixed** |
| 13 | The Looks window's NDI column does nothing | Medium | **Fixed** under Tauri |
| 14 | The compositor does not draw scripture, plain text, filters, or media the way the window does | **High** | **Fixed** |
| 15 | Four compositor costs that stall a 30 fps stream | High | **Fixed** |
| 16 | Both stage displays were blank under Tauri | High | **Fixed** |

---

## 1. Backing tracks ignore the audio-output-device setting

`AudioTabPanel.tsx:136` creates its own `new Audio()` for playlist playback and
sets `.volume` on it, but never calls `setSinkId`. Across the whole repository
`setSinkId` appears exactly once, in `useShowVideoSync.ts:121`, which routes the
Show-View video only.

So the audio-output-device setting added in `e81feb0` covers video and nothing
else. On a laptop whose default output is the built-in speakers, video audio
goes to the desk while backing tracks come out of the laptop.

**Fixed (Stage 5), on the Tauri shell.**

The defect was never a forgotten call. `setSinkId` is a *per-element* call, so
the setting reached whichever elements someone remembered to route. The fix is
that there is now exactly one place either source can be routed from —
`applyAudioRouting` in `shared/hooks/useAudioRouting.ts` — backed by a Rust sink
that owns the device (`services/audio.rs`). A source cannot be left behind by
omission any more, because omitting it means producing no audio at all.

Verified in the running app. The startup gate reports `audioSink=shared`, which
is both sources returning the same device, and `audibleMirrors=none`.

**Unchanged under Electron**, which is the standing call in handoff §6: fix in
the rewrite, not in the shipping build. The Electron path passes the same values
it set inline before, `deviceId: null` for the backing track included. Flipping
it is a one-line change to the fallback in `AudioTabPanel.tsx` if that call
changes.

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

**Partly done.** Stage 3 moved the media folder list, because the file scope
depends on it: a list kept in IndexedDB starts empty in the Tauri origin, and a
scope that starts empty means no media plays. It lives in
`media-folders.json` beside `display-preferences.json`, in one app-data
directory, and survives a restart.

The other twenty-odd `present-*` localStorage keys, the offline IndexedDB blob
and its sync queue, and the auth session are all still where they were. They
belong to the subsystems that own them — settings and looks are Stage 4, the
session is Stage 7 — and moving them ahead of those stages would mean writing
the same migration twice. The remaining work is a Rust-owned key/value store
plus a one-time import, and it is not done.

---

## 3. `local-media://` can read any file on disk — FIXED

`protocol.service.ts:137-145` takes the URL pathname and passes it straight to
`fs.stat` / `fs.createReadStream` with no containment check, so the renderer can
read any file the user can read. The file commands in `file.ipc.ts` are the
same: their arguments go to `node:fs` unvalidated.

**Fixed** in the Tauri build — see
[stage-3-native-apis.md](stage-3-native-apis.md).

Tauri's own asset protocol was the obvious replacement and was not used. Its
scope is the `fs` plugin's, the URL shape is `convertFileSrc`'s rather than the
`local-media://media/...` the React tree already builds, and the media folders
this app has to allow are chosen at runtime by the operator. A scheme handler
in Rust keeps the URLs unchanged, keeps the scope ours, and keeps control of the
range behaviour that video playback depends on.

The rule: a path is reachable only from inside a folder the operator chose in a
dialog they saw — a media folder, which persists, or a file picked this run,
which does not. Paths are canonicalised before comparison, so symlinks out of a
media folder, `..` walks and lookalike siblings such as `Media-old` are all
refused.

Confirmed against the running app, not only in tests: `read_folder` on `/etc`
returns `denied`, `local-media://media/etc/passwd` returns **403**, and a file
in a granted folder returns 206 with the right `Content-Range`. The refusal
logs as `/private/etc/passwd`, which shows canonicalisation ran first.

Electron is untouched, per migration rule 4.

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


---

## 11. Unfreezing the output does not catch the audience screen up — FIXED

`useOutputBroadcast.ts:201-205`:

```js
const previouslyFrozen = wasFrozenRef.current;
wasFrozenRef.current = !!isFrozen;
if (isFrozen) return;
if (previouslyFrozen && !isFrozen) return;
```

The second early return fires on the render that *clears* the freeze. Nothing
is sent on that pass, and nothing was sent during the freeze either, so the
audience screen keeps showing the frozen content until some unrelated state
change happens to re-run the effect.

In practice an operator freezes the output, changes slides behind it, and
unfreezes — and the congregation stays on the old slide until the operator
touches something else. Whatever the second return was meant to prevent, this
is what it does.

**Fixed** in the Tauri build. `OutputState::set_frozen(false)` broadcasts the
scene the operator arrived at. Freeze still means "stop changing the audience
screen" rather than "stop tracking what the operator is doing", so the scene
keeps updating underneath and the catch-up is one event.

Electron is untouched, per migration rule 4.

---

## 12. The Looks window and the operator window agree by polling — FIXED

The output layer flags — which of slide, media, messages, props and mask each
surface shows — live in a `localStorage` key shared between windows.
`localStorage` fires no `storage` event in the window that wrote it, so
`useLooksConfig.ts:87` polls every 400 ms.

Two consequences. A layer the operator toggles can take that long to reach the
audience screen. And two windows writing in the same tick lose one of the
writes, with nothing to indicate it happened.

**Fixed** in the Tauri build: Rust owns the flags and emits `looks:changed`.
Verified in the running app — a toggle applied in Rust reached a subscribed
window rather than waiting for a poll.

Electron is untouched.

---

## 13. The Looks window's NDI column does nothing

The Looks window edits three columns of layer flags: Screen 1, Stage and NDI.
Electron's NDI stream is `capturePage()` on the audience window
(`ndi.service.ts:335`), and that window only ever receives the program flags,
folded into the scene by `App.tsx:535-546`. Nothing reads the NDI column. An
operator can hide the timer from the livestream in the Looks window and the
livestream shows it anyway.

**Fixed under Tauri** (Stage 6), by the owner's call: the stream follows the
NDI column. `services/ndi/look.rs` derives the scene fields from it exactly as
`App.tsx` derives them from the program column, with one deliberate difference —
the NDI messages flag gates the banner, because unlike the program toggle
nothing clears the overlay when it changes.

What this does not do: the operator's quick toggles still write only the
program column, so clearing the words on the projector does not clear them on
the stream. Recorded in stage-6-ndi.md §1.

Electron is untouched.

---

## 14. The compositor does not draw what the audience window draws — FIXED

Found reading `OutputWindow.tsx` against `services/compositor` while wiring NDI,
which is the compositor's first real consumer. ADR-001 requires the two
renderings of a slide to stay visually identical; they are not yet:

- **Scripture is not drawn at all.** A `scripture:` slide with no authored
  elements goes through `ScriptureTextLayer` (auto-fit text, footer, shadow).
  The compositor draws only slide elements, and generated scripture has none.
- **Library slides without elements are not drawn** — the window's
  `CanvasSlideLayer` falls back to one centred line of text.
- **Media is cropped rather than letterboxed**, and the decoder stretches a
  video whose aspect ratio differs from the frame.
- **The slide background colour sits under the media** instead of over it, and
  is dropped when the mask layer is on.
- **`mediaFilterCSS` is ignored**, so a background the operator dimmed is not
  dimmed.

**Severity is high because of where it bites.** Under Electron the NDI stream is
a capture of the real window and has none of these problems; under Tauri every
one is a regression on the stream, and it would be one on the projector once the
surface swap lands. Nothing in Tauri reaches an audience through the compositor
today except NDI.

**Fixed** (Stage 6, `d6dbc99`). Scripture is `ScriptureTextLayer` ported, the
plain fallback is `CanvasSlideLayer`'s squeezed line, media is letterboxed and
decoded at its own aspect ratio, the slide colour is over the media, and the
seven filter functions apply to the media alone. A fifth gap turned up on the
way: **Inter's optical size**. Chromium on macOS sets the `opsz` axis from the
pixel size and cosmic-text does not, so every line came out about nine percent
wider and verses broke in different places; faces with that axis are now
instanced at the size they are drawn.

Checked against Chrome rendering the same markup at 1920×1080: each line of a
four-line verse within 1–3 px, the plain-text line the same width and about
5 px lower. What is still different is in stage-6-ndi.md §6.

---

## 15. Four compositor costs that stall a 30 fps stream — FIXED

Measured by streaming a lyric slide over a real service video to a receiver, on
the release profile. The first run received 28.7 fps with a gap over 50 ms once a
second. Each cause was affordable for Stage 5's one-off renders:

1. The cached slide layer was keyed on `OutputScene::differs`, which counts the
   video's position, so it was rebuilt on every position report while a video
   played.
2. A background image was read and decoded every frame, and a video with no
   decoded frame yet was read from disk as an image every frame.
3. A countdown timer lived in the slide layer, so each tick rebuilt it — a median
   92 ms.
4. Text was composited through `draw_pixmap` over a full-frame scratch, 37 ms for
   a clock whose text took under one.

**Fixed** (Stage 6). After: 30.0 fps received, no gap over 50 ms, with and
without the timer showing. Details in stage-6-ndi.md §5.

---

## 16. Both stage displays were blank under Tauri — FIXED

A Tauri regression, not an Electron bug. Stage 4's bridge sent `sendToStage`
and `sendToWorshipStage` to `send_to_output`, on the reasoning that the stage
displays would render the one Rust scene. They do not: the confidence monitor
shows the **next** slide, which no scene carries, and both windows still
listened on `onStageData` and `onWorshipStageData`, which nothing delivered.
`send_to_output` has no `stage-content` variant, so those updates were refused,
and the bridge swallowed the error. No test covered it and no window had been
opened under Tauri, which is how it survived two stages.

**Fixed** (Stage 7, `a6458c6`): the stage displays have their own feed again,
kept per type in Rust so a display opened mid-service is sent what it missed.
Verified with each window reporting its own rendered text. Details in
stage-7-subsystems.md §4.
