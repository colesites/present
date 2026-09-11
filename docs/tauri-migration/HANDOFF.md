# Present — Electron → Tauri migration: session handoff

**Read this first.** It is the state of the migration as of 2026-09-10, written
so a new session can continue without re-deriving anything.

Branch `rust`, 50 commits ahead of `master`, **nothing pushed**.

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
| [adr-002-video-decode.md](adr-002-video-decode.md) | Video is decoded by the OS, not a bundled FFmpeg. What that costs in containers, and what their own library says about it. |
| [adr-001-output-compositor.md](adr-001-output-compositor.md) | The load-bearing decision: the audience output gets composited in Rust with wgpu. **Amended**: the surface is a hybrid, with a webview layer above it for YouTube and capture props. |
| [known-issues.md](known-issues.md) | Twelve bugs found so far, each assigned to the stage that owns the fix. Seven fixed. |
| [stage-1-tauri-skeleton.md](stage-1-tauri-skeleton.md) | The Tauri shell beside Electron. |
| [stage-2-displays.md](stage-2-displays.md) | Display enumeration, identity, persistence, monitor names. |
| [stage-2-windows.md](stage-2-windows.md) | All eight windows in Rust: specs as data, the output hardening, crash policy, the physical/logical placement trap. |
| [stage-2-hotplug.md](stage-2-hotplug.md) | Monitors changing under a running app: the poll, what counts as a change, and the work-area feedback loop. |
| [stage-3-native-apis.md](stage-3-native-apis.md) | The file scope and why it is shaped that way, the media scheme without a stream, dialogs, menu, shortcut, deep links, permissions, and the `electronAPI` bridge. |
| [stage-4-presentation-core.md](stage-4-presentation-core.md) | The characterisation gate, the output layer flags, the auth session, the audience scene, the presentation position, and what Stage 5 inherits. |
| [stage-5-media-engine.md](stage-5-media-engine.md) | **In progress.** The full audio inventory, the Rust audio graph, why decode waits for the compositor, and what is left. |

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

**Stage 4 — the presentation core.** Done. The gate is met.
- ✅ Characterisation tests written against the running Electron build first
- ✅ Output layer flags in Rust, which killed a 400 ms cross-window poll
- ✅ Auth session in Rust and the OS keychain (pulled forward from Stage 7)
- ✅ The audience scene: one Rust-owned value, not three relayed streams
- ✅ The presentation position: which service, which item, which slide
- ✅ The mini lyrics save round trip
- ✅ **The Tauri build renders the whole operator UI**, with zero renderer errors

Every hook kept its signature, so no component changed and no prop chain was
rewritten. `PresentContainer.tsx` still holds most of its sixteen `useState`
hooks on purpose — only a handful describe the presentation; the rest are view
state, and moving those would be moving UI into the core for nothing.

**Stage 5 — the media engine and a single audio path.** In progress. Two
slices landed; the gate is met on the audio side, and nothing has been heard
yet.
- ✅ The audio regression suite covers every route to a speaker, not just `<video>`
- ✅ The audio graph in Rust: one sink, one device, two sources
- ✅ Only the operator surface can produce sound, structurally rather than by convention
- ✅ Both audible sources routed through one sink — **known-issues §1 fixed** under Tauri
- ✅ Proven in the running app: `audioSink=shared audibleMirrors=none`, zero renderer errors
- ✅ Slide elements typed, with round-trip fidelity and degradation proven
- ✅ The media transport in Rust — resume points, both drift tolerances
- ⬜ Wiring the React player onto the transport
- ✅ The compositor draws slides: background, shapes, text, images, scope-checked media
- ✅ Frame time measured: **29.5 ms** at 1920×1080, inside NDI's 33 ms budget
- ⬜ Cache the composited frame — a static slide is recomposed 30x a second for nothing
- ✅ Video decode via the platform decoder (ADR-002), verified on their own library
- ✅ The frame budget met with room: 9-12 ms against NDI's 33.3 ms, both resolutions
- ✅ Unplayable media flagged in the panel, with advice (ADR-002's UI requirement)
- ⬜ Overlays, screen-composer layout, and the surface swap

The old guard scanned `<video>` and nothing else, so three other routes to a
speaker were unguarded: the backing-track `new Audio()`, the audience YouTube
embed whose silence is a hand-edited `mute=1`, and the speech capture graph,
which connects the microphone to the audio destination behind a single gain
node pinned to zero. None were bugs. All were conventions nothing checked.

### Stages 6–8, untouched

Content and gates from the audit's §12, inlined so this file stands alone.

| Stage | Content | Gate |
|---|---|---|
| **6** | NDI, per ADR-001. | Discovery/connect/output/reconnect |
| **7** | Bible, fonts, PPTX sidecar, auth, AI Operator on Rust commands, error reporting, settings. | Parity checklist |
| **8** | Measure against the Electron baseline, then remove Electron. | Definition of done |

**The single-audible-video guard exists now** (`tests/single-audible-video.test.mjs`)
and is proven to fail when a second audible element appears. It is what stops
the Stage 5 media rewrite reintroducing audience echo, and it is why Electron
stays until Stage 8.

### Commits on this branch

```
37ef7b7 test(stage-5): say what each .play() plays, not just where it is
26f777b docs(stage-5): record the typed scene, the transport, and the hybrid surface
5f9076b feat(stage-5): move the media transport into Rust
375585a feat(stage-5): type the slide elements the compositor has to draw
9b9db6e docs(stage-5): record §1 fixed, and what the running app proved
b949248 feat(stage-5): route both audible sources through the one sink
417d435 fix(tauri): catch the unlisten rejection the guard was written for
c4cd375 docs(stage-5): record the audio inventory, the graph, and what is left
13c1fdb feat(stage-5): make the single audio path a Rust-owned graph
9303665 test(stage-5): inventory every audio path before the media engine moves any
bc05ab5 feat(stage-4): replace the mini lyrics save round trip
f25608c feat(stage-4): move the presentation position into Rust
82fb3ef docs(stage-4): record the gate, the three slices done, and the two bugs
d838a47 feat(stage-4): make the audience scene Rust-owned state
b9ef5d9 feat(stage-4): move the auth session into Rust and the OS keychain
b55c894 feat(stage-4): move the output layer flags into Rust
a8c8d25 test(stage-4): pin the audible-video invariant and the output layer flags
1b6398d docs: correct the test counts and commit list after the URL suite
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

**Stage 5 — the media engine and a single audio path**, continued. Two slices
are in; see [stage-5-media-engine.md](stage-5-media-engine.md) for what they
did and why.

Two things still come first, in this order. **Neither is Stage 5 work, both
need a person, and both change what Stage 5 can be trusted against.**

**1. Run a service through the Tauri build by hand.** Everything below Stage 5
has code, tests and startup probes; none of it has been *used*. No slide has
been advanced, no video played, no audience window opened, no dialog clicked,
no deep link followed. An hour with the app will find more than another day of
reading will. `__presentFiles`, `__presentWindows`, `__presentLooks` and
`__presentPosition` on the operator window expose the pieces that need a human.

**2. Run the multi-monitor matrix.** Still the outstanding Stage 2 gate, and
Stage 5 puts real video on that second screen. Needs a second monitor, not a
code change.

Then the remaining Stage 5 slices:

- **Media playback state in Rust** — play, pause, stop, seek, volume, mute,
  position, lifecycle, preview/output sync. `OutputScene` already carries
  `is_video_playing` and `video_current_time`; what is missing is the transport
  that owns them rather than mirroring React.
- **The compositor**, per ADR-001. The expensive part: weeks, not days. It needs
  `slide_elements` and `screen_composer_layout`, carried verbatim since Stage 4,
  to become real structs.

Building the compositor onto an audience surface that has never once displayed
a slide is the risk worth naming: it would be the first thing to render there,
and every failure would look like a compositor bug.

Per ADR-001, **output state must be fully describable as serialisable Rust
structs** — never as React component state. The scene already is; the compositor
is what makes it authoritative rather than descriptive.

## 5. What the Rust core contains today

13 200 lines across `apps/desktop/src-tauri/src`, mirroring the Electron main
process's own structure as the audit asked. Nothing here is a stub.

```
commands/      thin: deserialise, delegate, map to AppResult
  app.rs         get_app_info
  compositor.rs  render_output_frame — renders the live scene, optionally to PNG
  media.rs       check_video_support — which files the decoder cannot open
  audio.rs       get_audio_graph · get_source_routing · set_audio_device
                 set_audio_source_gain/_muted · set_audio_master_gain/_muted
  deep_link.rs   take_pending_deep_link
  diagnostics.rs report_webview_capabilities · report_diagnostic
  display.rs     get_displays · get/set_preferred_display
                 get/set_preferred_resolution · reconcile_displays
  auth.rs        get/set/clear_stored_auth_session · consume_pending_auth_token
                 begin_auth_flow · open_external_browser · refresh_desktop_session
  file.rs        the eight dialogs · the six file operations · the two
                 library-bundle calls · list/remove_media_folder
  looks.rs       get_looks_config · set_looks_target · set_selected_look
                 add_look · set_look_name · set_look_layer · set_look_text_position
  mini_lyrics.rs get_mini_lyrics_payload · save_mini_lyrics
                 respond_mini_lyrics_save
  output.rs      get_output_scene · send_to_output · set/is_output_frozen
  permissions.rs request/get microphone and camera access
  playback.rs    get_playback · select_playback_media · play/pause/toggle/stop
                 seek · report_playback_position · set_playback_duration · ended
  presentation.rs get_presentation_position · set_presentation_service/_item/_group
                 set_presentation_deck · go_to_slide · next/previous_slide
                 reconcile_presentation_services
  speech.rs      request_speech_token · report_speech_usage
  window.rs      open_window · close_window · open/close_mini_lyrics_window
                 list_open_windows
services/      domain logic, most of it runtime-free and tested
  app_menu.rs        the menu, ported from menu/app.menu.ts
  audio.rs           THE audio graph: one sink, one device, two sources. Only
                     the operator surface can produce sound, and that is a
                     match rather than a convention. No Tauri types.
  auth.rs            session read-back rules, the refresh transport, the
                     sign-in URL. No Tauri types.
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
  looks.rs           THE output layer flag reducer. No Tauri types. Twin of
                     shared/lib/looks-config.mjs, case for case.
  media_protocol.rs  the local-media:// handler: URL parsing, range planning,
                     content types, the scope check
  mini_lyrics.rs     the editor's payload and its save round trip
  output.rs          THE audience scene, and the rules for merging an update
                     into it. No Tauri types.
  monitors.rs        Tauri-facing enumeration and role resolution
  permissions.rs     AVFoundation microphone/camera authorisation
  compositor/        THE frame pipeline (ADR-001). Rasterises on the CPU with
                     tiny-skia, not wgpu — see frame.rs for why. Every layer
                     refuses to guess rather than painting over the lyrics.
    color.rs           CSS colours; an unrecognised one paints nothing
    frame.rs           the buffer, and to_bgra() for NDI
    geometry.rs        deck units to frame units
    images.rs          decode and object-fit
    loader.rs          THE scope check for scene media. Never std::fs directly.
    scene.rs           the layer order, and what was left to the webview
    shapes.rs          rects, radii, inset borders
    parallel.rs        splitting the per-pixel passes across cores
    pipeline.rs        THE per-frame path: caches the slide, composites video
    text.rs            cosmic-text layout and rasterisation
  video/             THE video decoder (ADR-002). Platform decoders, macOS only
                     so far. The support check is separate and answers by
                     extension, so an unplayable file is caught in the panel
                     rather than on the audience screen.
  playback.rs        THE media transport: resume points, and the two drift
                     tolerances the audit recorded as one. No Tauri types.
  presentation.rs    where the operator is: service, item, deck, slide, and the
                     bounds on moving between them. No Tauri types.
  slide.rs           what a slide is made of, typed for the compositor. Unknown
                     types and fields survive rather than blanking the screen.
  shortcuts.rs       Control+Alt+Space
  speech.rs          AssemblyAI token broker transport
  window.rs          building, showing, placing and closing windows
  window_spec.rs     all eight windows as serialisable structs. No Tauri.
state/
  app_state.rs          uptime only
  audio_state.rs        the live audio graph, persisted
  auth_state.rs         the session, in the OS keychain
  display_state.rs      role→display + resolution, persisted atomically
  file_state.rs         media folders + the live scope they define
  looks_state.rs        the live layer flags, persisted
  output_state.rs       the live audience scene + the freeze flag. In memory.
  persist.rs            load-or-default and atomic save, shared
  playback_state.rs     the live transport. In memory.
  presentation_state.rs the position; the service half persists
  window_state.rs       per-window crash history for the loop guard
errors.rs      the single AppError crossing the boundary: { kind, message }
```

**Events emitted to the frontend.** `display:list-changed`, `looks:changed`,
`output:scene-changed`, `presentation:changed`, `audio:changed`,
`playback:changed`, `output-window-closed`,
`media-stage-window-closed`, `worship-stage-window-closed`, `open-import`,
`ai-operator:toggle-shortcut`, `auth-callback`, `mini-lyrics:save-request`.
The `*-window-closed` names, `open-import`, `auth-callback` and the mini-lyrics
one match what Electron sends; the rest are new because what they carry is new.

**Files the Rust core owns**, in one app-config directory:
`display-preferences.json`, `media-folders.json`, `looks.json`,
`service-position.json` and `audio.json`. Plus the auth session, which is in the OS keychain and
not a file at all.

**The TypeScript side** is `src/renderer/tauri/`:

- `boot.ts` — the first module each Tauri window runs. Installs the bridge.
  Loaded before the React entry in `index.html` and `output.html`, and the
  ordering there is the whole mechanism.
- `electron-bridge.ts` — `window.electronAPI` backed by `invoke`. Temporary by
  design; each entry goes away when its subsystem moves to Rust. Anything not
  implemented reads as `undefined` and reports itself once into the Rust log.
- `runtime.ts` — the typed `invoke` wrapper
- `audio.ts` — the audio graph client. Transport only; the one place that
  applies routing is `applyAudioRouting` in `shared/hooks/useAudioRouting.ts`,
  which works on both shells
- `looks.ts`, `output.ts`, `presentation.ts` — typed clients for the three
  Rust-owned state slices, each imported dynamically so the Electron bundle
  never sees `@tauri-apps/api`
- `boot-probe.ts` — startup smoke test, operator window only. Also proves the
  file scope, the looks change event and the navigation bounds on every launch,
  and exposes `__presentFiles`, `__presentWindows`, `__presentLooks` and
  `__presentPosition` so the parts that need a human can be driven by hand.
- `capability-probe.ts` — the WKWebView feature report

Outside that directory, exactly three files know both shells exist:
`src/shared/lib/local-media-url.ts` (which imports nothing from either) and the
two callers that use it.

**Test counts.** 461 Rust, 93 JS. `bun run --filter @present/desktop tauri:check`
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
- **The whole operator UI rendering under Tauri** — services sidebar, media
  panel, audience preview, timers, toolbar — with **zero renderer errors** on a
  clean launch.
- A looks toggle applied in Rust reaching a subscribed window as an event
  rather than on a poll (`changeEvent=delivered`).
- The compositor's frame time, measured rather than assumed: **300 ms** at
  1920×1080 before the glyph fix and **29.5 ms** after it, against NDI's 33 ms
  budget. That is a static slide with no video, so the headroom is about 10%.
- **A real lyric slide drawn by the Rust compositor** and looked at, with the
  `web` element correctly left as a hole for the webview layer above.
- The compositor's scope check refusing a file outside the granted folders and
  a traversal out of one.
- **The audio graph across the real serialisation boundary**: both audible
  sources returning the same output device (`audioSink=shared`) and all twelve
  mirror/source combinations refused (`audibleMirrors=none`).
- A clean Tauri launch going from **15 unhandled rejections to 0** after the
  `safelyUnlisten` fix, with zero renderer errors.
- Slide navigation refusing to run with no deck loaded rather than guessing
  (`navigateWithoutDeck=refused`).
- Electron still packaging cleanly with every shared file this branch touched.

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
- **No service has been run through the Tauri build.** No slide advanced, no
  video played, no audience window opened, no dialog clicked, no deep link
  followed, no shortcut pressed, no permission prompt shown, no mini lyrics
  editor opened. Everything below Stage 5 is exercised by tests and by startup
  probes, not by use. This is the single largest gap in the whole migration.
- **No media has actually played through `local-media://`.** A range request
  returns the right bytes; a video decoding and playing in WKWebView is
  a different claim and has not been made.
- **Nobody has signed in under Tauri.** The session store, the refresh
  transport and the deep-link handler all have tests; the flow has never run.

## 8. Open issues

Every bug found so far, with its current state. The detail is in
[known-issues.md](known-issues.md); this table is so a new session can see the
whole picture without opening it.

| # | Issue | Severity | State |
|---|---|---|---|
| 1 | Backing tracks ignore the audio-output-device setting | High | **Fixed** under Tauri |
| 2 | Dev and packaged builds keep entirely separate state | High | **Partly fixed** — see below |
| 3 | `local-media://` can read any file on disk | Medium | **Fixed** |
| 4 | Media panel hidden behind a dead File System Access check | Medium | **Fixed** |
| 5 | `vosk` is a dependency that is never imported | Low | Open — Stage 7 |
| 6 | Build workflows trigger on a branch that does not exist | Low | Open — deliberately |
| 7 | Ten pre-existing ESLint errors | Low | Open — deliberately |
| 8 | Speech-to-search blocked by a CORS preflight | Medium | **Fixed** |
| 9 | Monitor hot-plug never moved the output window | High | **Fixed** |
| 10 | No webview crash recovery on Windows or Linux under Tauri | Medium | Open — Stage 7 |
| 11 | Unfreezing the output does not catch the audience screen up | Medium | **Fixed** |
| 12 | The Looks window and the operator window agree by polling | Medium | **Fixed** |

**§2 is the one to understand.** Four of its parts are done: the auth session
is in the OS keychain, and the media folder list, the output layer flags and
the service position are in Rust files owned by the app rather than by a
renderer origin. What is still in origin-partitioned web storage is the rest of
the `present-*` localStorage keys — UI state, timers, service templates, the
screen composer layout, local audio, media filters, browser history — plus the
offline IndexedDB blob and its sync queue, and the Dexie Bible cache. Those
belong to the subsystems that own them; moving them ahead of those stages means
writing the same migration twice.

**Issues 6 and 7 are open on purpose.** Release triggers are not a migration
decision, and the ten lint errors are pre-existing on `master` — eight of them
change render timing in live-service code. Neither belongs inside a migration
commit.

### Gaps that are not bugs

Things that are missing rather than wrong, and would be easy to mistake for
finished work.

| Gap | Where it bites |
|---|---|
| **No service has been run end to end under Tauri** | The largest gap. No slide advanced, no video played, no audience window opened, no dialog clicked, no deep link followed, no shortcut pressed, nobody signed in |
| The output window and both stage displays have never been opened | They render the Rust scene in code only |
| Freeze and unfreeze have not been exercised by hand | The behaviour deliberately differs from Electron now — see §11 |
| Nothing has run on Windows or Linux | The `http://local-media.localhost` URL form, the single-instance lock, argv deep links and the keychain fallback are all untested there |
| No window has been on a second monitor | The outstanding Stage 2 gate |
| No live AssemblyAI transcription | Needs the owner signed in |
| The mini lyrics editor has never been opened | Its save round trip is tested only in units |
| Display id across an OS reboot | Only app restarts have been tested |

## 9. Working agreements

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

## 10. Commands

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
bun run test                                    # 93 JS tests
bun run typecheck
bun run lint
node apps/desktop/scripts/check-tauri-version.mjs [--fix]
```

`bun run desktop:tauri` exists because `bun tauri dev` from the repo root does
not work: the Tauri CLI finds `src-tauri` by scanning the workspace but runs
`beforeDevCommand` from the invocation directory, where `tauri:vite:dev` is not
a script. Run it from `apps/desktop` or use the alias.

Current: **461 Rust tests, 93 JS tests**, clippy/fmt/typecheck clean.

## 11. Installed skills

`rust-best-practices`, `rust-async-patterns`, `rust-testing`, `rust-patterns`,
`rust-engineer`, `tauri-v2`, plus `frontend-design` globally. Project-scoped in
`.agents/skills` with symlinks in `.claude/skills`.

The owner asked about `JavaScript-Mastery-Pro/skills`; it was assessed as a
generic nine-step workflow pack that overlaps and competes with the migration
plan's own stage gates. Not installed. That was advice, not a veto — install it
if asked.

## 12. Traps

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
- **`rename_all = "camelCase"` mangles acronyms.** `media_filter_css` becomes
  `mediaFilterCss`, and the frontend reads `mediaFilterCSS`. A serialisation
  test caught it; nothing at runtime would have.
- **Tauri's unlisten throws when the listener is already gone**, which a Vite
  hot reload causes by resetting the injected registry. Always detach through
  `safelyUnlisten` in `src/renderer/tauri/electron-bridge.ts`. Note *how* it
  fails: `UnlistenFn` is typed `void` but returns a promise, so the failure is a
  rejection and a bare `try`/`catch` never sees it.
- **A `State<'_, T>` cannot cross into a spawned task.** Clone the `AppHandle`
  and re-fetch the state inside. The URI scheme handler does this.
- **A temporary in a `match` scrutinee lives for the whole match.** An
  `RwLock` read guard taken there and a write lock taken in an arm is a
  deadlock, and it presents as a hung test rather than a panic.
- **Anything that touches the OS keychain must be injectable.** An earlier
  `AuthState` picked its backend per call and its own tests wrote into the
  developer's login keychain.
- **`profile.release` optimises for size**, not speed — `opt-level = "s"` with
  LTO and one codegen unit. Right for the bundle, misleading for judging the
  compositor. Use the `perf` profile to measure, and expect a long first build.
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
