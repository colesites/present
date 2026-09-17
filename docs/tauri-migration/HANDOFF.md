# Present — Electron → Tauri migration: session handoff

**Read this first.** It is the state of the migration as of 2026-09-17, written
so a new session can continue without re-deriving anything.

Branch `rust`, 104 commits ahead of `master` — the last is this update — **nothing pushed**.

**Electron is gone.** Stages 6 and 7 are code complete, and on 2026-09-15 the
owner had the Electron build removed (its last commit is tagged
`electron-final`). Present is a Tauri app: React for the interface, Rust for
everything else. The same day the owner's first hands-on run found five bugs,
all fixed (known-issues §18–21), and decided three directions: FFmpeg as the
video decoder on every platform, SQLite in Rust for offline data, and React
kept for the interface (§6). Since then (after-stage-7.md): daily log files,
frame-time benchmarks, live media folders, OpenLyrics import, and FFmpeg
decoding video on every platform (ADR-003), which also fixed the NDI stream
stalling when decoding fell behind (known-issues §22). Start with §4.

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
| [adr-003-ffmpeg-video-decode.md](adr-003-ffmpeg-video-decode.md) | Video is decoded by FFmpeg on every platform, on the GPU where it can be. Measured against AVFoundation; what shipping it obliges. |
| [adr-002-video-decode.md](adr-002-video-decode.md) | **Superseded by ADR-003.** The platform decoders, and the transport-owns-the-clock reasoning ADR-003 keeps. |
| [adr-001-output-compositor.md](adr-001-output-compositor.md) | The load-bearing decision: the audience output gets composited in Rust with wgpu. **Amended**: the surface is a hybrid, with a webview layer above it for YouTube and capture props. |
| [known-issues.md](known-issues.md) | Seventeen bugs found so far, each assigned to the stage that owns the fix. Fifteen fixed or mostly fixed; the other two open on purpose. |
| [stage-1-tauri-skeleton.md](stage-1-tauri-skeleton.md) | The Tauri shell beside Electron. |
| [stage-2-displays.md](stage-2-displays.md) | Display enumeration, identity, persistence, monitor names. |
| [stage-2-windows.md](stage-2-windows.md) | All eight windows in Rust: specs as data, the output hardening, crash policy, the physical/logical placement trap. |
| [stage-2-hotplug.md](stage-2-hotplug.md) | Monitors changing under a running app: the poll, what counts as a change, and the work-area feedback loop. |
| [stage-3-native-apis.md](stage-3-native-apis.md) | The file scope and why it is shaped that way, the media scheme without a stream, dialogs, menu, shortcut, deep links, permissions, and the `electronAPI` bridge. |
| [stage-4-presentation-core.md](stage-4-presentation-core.md) | The characterisation gate, the output layer flags, the auth session, the audience scene, the presentation position, and what Stage 5 inherits. |
| [stage-5-media-engine.md](stage-5-media-engine.md) | The full audio inventory, the Rust audio graph, the compositor, video decode, and the frame budget. |
| [stage-6-ndi.md](stage-6-ndi.md) | **Code complete.** The owner's three decisions, NDI loaded at runtime, the send loop, what streaming found, drawing what the window draws, the bundled runtime, NDI props, and the opt-in native audience screen. |
| [after-stage-7.md](after-stage-7.md) | The owner's crate list as it lands: log files and benchmarks, live media folders, OpenLyrics, FFmpeg. |
| [stage-7-subsystems.md](stage-7-subsystems.md) | **Code complete.** The owner's decisions (one changed), Bibles, the blank stage displays, fonts, the tool list and speech token, the error log, settings out of browser storage, `vosk`, crash recovery off macOS, PowerPoint import in Rust, and browser mode on wry views. |

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

**Stage 5 — the media engine and a single audio path.** Done. The gate is met.
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
- ✅ Video decode via the platform decoder (ADR-002), verified on their own library — replaced by FFmpeg (ADR-003)
- ✅ The frame budget met with room: 9-12 ms against NDI's 33.3 ms, both resolutions
- ✅ Unplayable media flagged in the panel, with advice (ADR-002's UI requirement)
- ✅ Message, props and timer overlays, and the screen composer, drawn in Rust
- ✅ The React player moved onto the Rust transport
- ✅ The surface swap — carried to Stage 6, and landed there opt-in

The old guard scanned `<video>` and nothing else, so three other routes to a
speaker were unguarded: the backing-track `new Audio()`, the audience YouTube
embed whose silence is a hand-edited `mute=1`, and the speech capture graph,
which connects the microphone to the audio destination behind a single gain
node pinned to zero. None were bugs. All were conventions nothing checked.

**Stage 6 — NDI, plus the audience surface swap.** Code complete; the owner's gate is open.
- ✅ Characterisation first: 34 cases pinning Electron's NDI rules, each proven to fail under mutation
- ✅ NDI reached from Rust, the runtime loaded at run time rather than linked — no SDK on any build machine
- ✅ Discovery, connect, output and reconnect proven against two real runtimes (library level)
- ✅ NDI output from the compositor, following the Looks window's NDI column (owner's call)
- ✅ A freeze holds the stream: `OutputState::on_screen` is apart from the operator's scene
- ✅ 30.0 fps received, no gap over 50 ms, release profile, lyric slide over a real video
- ✅ Four compositor costs that stalled a 30 fps stream, found by streaming and fixed (known-issues §15)
- ✅ The running app's stream received from a separate process, 1920×1080
- ✅ Compositor parity: scripture, plain text, media fit and order, filters, Inter's optical size — known-issues §14
- ✅ `libndi` in the bundle; the packaged build loads its own copy
- ✅ NDI input: discovery, the shared receiver with its grace period, `ndi-frame://`, the CSP — verified against a real source
- ✅ The audience window drawn natively, opt-in (owner's call), with the webview as fallback — verified in the running app
- ⬜ **The owner's gate**: NDI Tools watching a live service, 45 minutes, Test Patterns as a prop, the native screen on a projector

**Stage 7 — the remaining subsystems.** Code complete; the parity checklist is open.
- ✅ Bibles: the bundled list and reader, and the hosted catalog, from Rust — characterised first
- ✅ Both stage displays were blank under Tauri (a Stage 4 bridge gap) — fed by a Rust relay now, known-issues §16
- ✅ Fonts: the system list read as `font-list` reads it, installs refused outside the picked files
- ✅ The AI Operator's 46 tool definitions in one JSON file both shells read
- ✅ The redacted local error log, from Rust, including panics and dead webview processes
- ✅ Settings out of origin-bound browser storage into `web-storage.json`, with a one-time import of the Electron build's — known-issues §2 mostly fixed
- ✅ `vosk` removed — known-issues §5
- ✅ Webview crash recovery on Windows and Linux — known-issues §10, checked by cross-compiling, not run
- ✅ PowerPoint import ported from `parse_pptx.py` to Rust: the recorded fixtures exactly, and 26 of the owner's decks identical
- ✅ Browser mode on two wry views over the operator and audience windows — not Tauri's `unstable` child webviews (owner, 2026-09-15; §6)
- ⬜ **The parity checklist by hand**, §8 F

**Stage 8 — remove Electron.** Done without the measurement, at the owner's call.
- ✅ The last Electron commit tagged `electron-final`
- ✅ The Electron main process, preload, Forge, Webpack, their workflows and dependencies removed
- ✅ The React tree's Electron fallbacks removed; every hook talks to Rust
- ⬜ The Electron-versus-Tauri performance comparison the migration plan asked for — skipped; the tag can still be built for it

**The single-audible-video guard exists now** (`tests/single-audible-video.test.mjs`)
and is proven to fail when a second audible element appears. It is what stops
the Stage 5 media rewrite reintroducing audience echo, and it is why Electron
stays until Stage 8.

### Commits on this branch

```
bf486f6 refactor(video): remove the AVFoundation decoder
4678b77 perf(video): keep the stream at 30 fps when decoding falls behind
f18c37c feat(video): decode with FFmpeg on every platform, on the GPU where it can
41e657b feat(library): import OpenLyrics songs
8bc25a9 feat(media): media folders update while the app is open
d702389 feat(core): keep the log in daily files, and benchmark the frame time
c838ebe docs: Electron removed, the owner's decisions, and what comes next
385ed2c refactor: drop the React tree's Electron fallbacks
7a137a2 chore: remove the Electron build
a8fd16d docs: record issues 18 to 21 from the owner's first hands-on run
00bb21e feat(windows): a splash while the app starts, and no white windows
82cf67c fix(media): show videos in the panels as still pictures
11b42ba fix(media): smooth mirrors, a pause that holds, and videos from the start
8ec0caf fix(editor): let Artist and Author take a space
b90eddd docs(stage-7): record browser mode, close Stage 7's code, and bring the handoff up to date
fb91402 feat(stage-7): browser mode inside the operator window, on wry views
e192d82 test(stage-7): pin browser mode's rules before moving it to child webviews
3e84e0c test(stage-7): spell the error log test's no-break spaces as escapes
d3909a1 docs(stage-7): record the PowerPoint importer's port to Rust
32e1999 feat(stage-7): import PowerPoint files in Rust, without Python
1dc0f9d test(stage-7): pin the PPTX importer's output before porting it to Rust
579759a docs(stage-7): record browser storage, vosk, crash recovery off macOS, and the CI clippy fix
a60dfbe feat(stage-7): recover a crashed webview on Windows and Linux too
498b9c5 fix(tauri): stop two keychain constants failing CI's Linux clippy
cf167c1 feat(stage-7): keep the app's browser storage in Rust, and bring Electron's over
3015193 chore(stage-7): drop vosk, which nothing imports
8ef7252 docs(stage-7): record fonts, the tool list, the speech token and the error log
d6b34ba feat(stage-7): keep the redacted local error log from Rust
7915d7a test(stage-7): pin the local error log exactly before porting it
e23e0f1 feat(stage-7): serve the AI Operator's tool list from one shared file
3038b6e feat(stage-7): list and install fonts from Rust
9142cf9 test(stage-7): pin the font catalog rules against font-list itself
7149f79 docs(stage-7): record the owner's two decisions, Bibles, and the blank stage displays
a6458c6 fix(stage-7): feed the two stage displays under Tauri
d1e1bab feat(stage-7): serve the bundled Bibles and the hosted catalog from Rust
e334d67 test(stage-7): pin the bundled Bible catalog rules before porting them
9e8e81c docs(stage-6): close Stage 6's code, and hand over to Stage 7
ed3c0b1 feat(stage-6): draw the audience window natively, behind a setting
1c61d7d feat(stage-6): receive NDI sources for props
39c80fd feat(stage-6): ship the NDI runtime inside the Tauri bundle
d6dbc99 feat(stage-6): draw what the audience window draws
cf2928b docs(stage-6): record NDI output, what streaming it found, and what is left
cd6754e feat(stage-6): send the audience frame over NDI from the Rust compositor
6f5050c perf(stage-6): stop a ticking countdown stalling the frame once a second
d44edca fix(stage-6): read a background image once, and never read a video as one
2231ea6 fix(stage-6): keep what is on screen separate from what is queued
81edf64 perf(stage-6): stop a playing video's clock redrawing the slide
7e38b9e feat(stage-6): reach NDI from Rust, loaded at runtime
81aaeab test(stage-6): pin the NDI rules before porting them to Rust
8de38ed docs: gather every manual test for Stages 1 to 5 into one list
dfc66b5 docs: close Stage 5, and say where the surface swap went
1d023ce feat(stage-5): move the React player onto the Rust transport
0c560b2 feat(stage-5): draw the overlays and the screen composer
fa06821 docs(stage-5): record the unplayable-media warning
f5d07b4 feat(stage-5): flag media the decoder cannot open, in the panel
ff6f8c1 docs(stage-5): the frame budget, measured down to a third
8f336d9 perf(stage-5): spread the pixel work across cores and stop reallocating the frame
cad5618 docs(stage-5): record video decode and how the frame budget was met
817df19 perf(stage-5): let the hardware scale video during decode
c114d43 feat(stage-5): composite video under the slide, and stop redrawing what has not changed
6c98de1 feat(stage-5): decode video with the platform decoder
20d1a8e docs(stage-5): the frame time after the glyph fix, measured
c491875 docs(stage-5): record the frame budget, and what about it is unmeasured
31eb429 perf(stage-5): rasterise text into a buffer instead of per glyph pixel
ced0f85 docs(stage-5): record the compositor and renumber the stage doc
9951491 feat(stage-5): draw the audience frame in Rust
4a180d9 docs: correct the commit count and list after the Stage 5 slices
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

**1. The GPU compositor** (owner, 2026-09-17): wgpu draws every output, not
only 4K ones, with the CPU compositor as the fallback and pixel-parity tests
between the two. It also removes the decoder's copy off the GPU and its CPU
colour conversion, which is what still keeps a 4K video from holding 30 fps
inside the NDI stream on this Mac (after-stage-7.md §4).

**Before that, three things the bundled FFmpeg leaves open** (after-stage-7.md
§5, which the bundles now carry):

- **The Windows and Linux bundles have never been built.** Windows builds
  FFmpeg in MSYS2 from an MSVC developer environment and Linux builds it
  against VA-API; neither step has run, here or in CI, because nothing has
  been pushed.
- **`nasm` is not installed on this machine**, so a local
  `bun run desktop:tauri:build` stops unless `PRESENT_FFMPEG_NO_ASM=1` is set,
  which makes a build that must not ship. `brew install nasm` fixes it.
- **The source offer.** The LGPL means anyone given the app can ask for
  FFmpeg's source. The bundle carries the notices and the exact version and
  configure line, not the tarball; keeping that tarball available where the
  app is published is the owner's to arrange.

**Then converting MKV/AVI/WebM on import**, since the operator's windows play
video in WebKit and cannot open them.

**2. The owner's crate list, as features** (owner, 2026-09-15), in this order:
rolling log files (`tracing-appender`) and frame-time benchmarks (`criterion`);
media folders that update live (`notify`); OpenLyrics import (`quick-xml`) and
scripture references (`nom`); MIDI and OSC control (`midir`, `rosc`); a phone
remote on the local network (`axum`, `tokio-tungstenite`, `mdns-sd`,
`qrcode`); then the offline store.

**3. SQLite in Rust for offline data** (owner, 2026-09-15): `rusqlite` bundled,
migrations, WAL, `ulid` ids, `blake3` media hashes, and Convex sync from Rust
with backoff. It replaces the IndexedDB work in the owner's uncommitted
`localData.ts` and `useOfflineSyncEngine.ts` — agree with the owner what happens
to those edits before touching them.

**4. The manual gates, §8**, still unrun: a service on one machine (A), the
second monitor (B), an account (C), NDI (E), the Stage 7 checklist (F).

**5. Windows and Linux.** Crash recovery and browser mode have platform code for
both, type-checked by cross-compiling (stage-7-subsystems.md §8 has the recipe)
and never run.

**Also owed:** a check that an expired sign-in can never stop the app working
offline — the owner's point, not yet looked at. And `ServicesSidebar.tsx`, one of
the owner's in-progress files, still draws video thumbnails as live video
elements (known-issues §18).

**Still the owner's to decide:** the operator's quick toggles write only the
program column, so clearing the words on the projector does not clear them on
the NDI stream (stage-6-ndi.md §1).

## 5. What the Rust core contains today

About 38 500 lines, tests included, across `apps/desktop/src-tauri/src`, mirroring the Electron main
process's own structure as the audit asked. Nothing here is a stub.

```
commands/      thin: deserialise, delegate, map to AppResult
  ai_operator.rs list_ai_operator_tools
  app.rs         get_app_info
  bible.rs       list_bundled_bibles · read_bundled_bible · fetch_hosted_bible_catalog
  browser_mode.rs set_browser_mode_enabled/_bounds · browser_navigate/_back/_forward/_reload
                 set_browser_projection_target · get_browser_mode_state
                 fetch_browser_suggestions
  compositor.rs  render_output_frame — renders the live scene, optionally to PNG
  media.rs       check_video_support — which files the decoder cannot open
  audio.rs       get_audio_graph · get_source_routing · set_audio_device
                 set_audio_source_gain/_muted · set_audio_master_gain/_muted
  deep_link.rs   take_pending_deep_link
  diagnostics.rs report_webview_capabilities · report_diagnostic · report_renderer_error
  display.rs     get_displays · get/set_preferred_display
                 get/set_preferred_resolution · reconcile_displays
  auth.rs        get/set/clear_stored_auth_session · consume_pending_auth_token
                 begin_auth_flow · open_external_browser · refresh_desktop_session
  file.rs        the eight dialogs · the six file operations · the two
                 library-bundle calls · list/remove_media_folder
  fonts.rs       get_system_fonts · get_system_font_faces · pick_font_file
                 install_custom_fonts · get_custom_fonts
  looks.rs       get_looks_config · set_looks_target · set_selected_look
                 add_look · set_look_name · set_look_layer · set_look_text_position
  mini_lyrics.rs get_mini_lyrics_payload · save_mini_lyrics
                 respond_mini_lyrics_save
  ndi.rs         start_ndi_output · stop_ndi_output · get_ndi_status
                 list_ndi_sources · start_ndi_input · stop_ndi_input
  output.rs      get_output_scene (what is ON SCREEN) · send_to_output
                 set/is_output_frozen
  permissions.rs request/get microphone and camera access
  pptx.rs        open_pptx · parse_pptx
  playback.rs    get_playback · select_playback_media · play/pause/toggle/stop
                 seek · report_playback_position · set_playback_duration · ended
  presentation.rs get_presentation_position · set_presentation_service/_item/_group
                 set_presentation_deck · go_to_slide · next/previous_slide
                 reconcile_presentation_services
  speech.rs      request_speech_token · report_speech_usage
  stage.rs       send_to_stage · get_stage_messages
  surface.rs     get_output_surface · set_output_surface_native
  web_storage.rs get_web_storage · initialize_web_storage · set_web_storage_items
  window.rs      open_window · close_window · open/close_mini_lyrics_window
                 list_open_windows
services/      domain logic, most of it runtime-free and tested
  app_menu.rs        the menu, ported from menu/app.menu.ts
  audio.rs           THE audio graph: one sink, one device, two sources. Only
                     the operator surface can produce sound, and that is a
                     match rather than a convention. No Tauri types.
  auth.rs            session read-back rules, the refresh transport, the
                     sign-in URL. No Tauri types.
  bible.rs           the bundled Bibles' names and codes, the hosted catalog
  browser_mode/      browser mode (Stage 7), on wry views Tauri does not manage
    rules.rs           the address bar, restore, crop and suggestion rules,
                       case for case with src/main/lib/browser-mode.mjs
    mod.rs             BrowserMode: Electron's steps against a Host trait. No wry.
    view.rs            THE wry host. Views live on the main thread; callbacks
                       only send Signals. Never call wry's url() on macOS.
    view/native.rs     attach, history state and snapshot, per platform
    suggestions.rs     the web app's search suggestions
  collation.rs       localeCompare, closely enough for sorting names
  deep_link.rs       present:// parsing and the pending-link buffer. Parser
                     has no Tauri types.
  dialog.rs          the eight native dialogs; every pick grants scope
  error_log.rs       the redacted ndjson error log, rotation, the panic hook
  display.rs         the role→monitor selection rule, ported from
                     src/shared/lib/display-selection.mjs. No Tauri types.
  display_identity.rs (name, ordinal) identity + the FNV-1a 53-bit id
  display_names.rs   AppKit NSScreen.localizedName, main-thread hop
  display_watch.rs   the hot-plug poll, diff and reconcile pass
  file_scope.rs      THE containment rule. No Tauri types. Read this before
                     touching anything that takes a path.
  filesystem.rs      the file operations, all scope-checked
  fonts.rs           font-list's catalog rules, custom font install
  system_fonts.rs    NSFontManager on the main thread, as font-list's helper reads it
  looks.rs           THE output layer flag reducer. No Tauri types. Twin of
                     shared/lib/looks-config.mjs, case for case.
  media_protocol.rs  the local-media:// handler: URL parsing, range planning,
                     content types, the scope check
  mini_lyrics.rs     the editor's payload and its save round trip
  output.rs          THE audience scene, and the rules for merging an update
                     into it. No Tauri types.
  monitors.rs        Tauri-facing enumeration and role resolution
  ndi/               NDI (Stage 6). The runtime is loaded at run time with
                     libloading, never linked — no build machine needs the SDK.
    rules.rs           Electron's NDI rules, case for case with
                       shared/lib/ndi-rules.mjs. No FFI, no Tauri.
    library.rs         where libndi is looked for, and the error naming each place
    sys.rs             THE C interface. Every struct offset pinned by a test.
                       Nothing outside finder/sender/receiver may call it.
    finder.rs · sender.rs · receiver.rs   the three safe wrappers
    look.rs            the on-screen scene through the Looks window's NDI column
    video_feed.rs      the background video kept in time like the audience mirror
    output.rs          the send loop, NdiStatus, OutputWorker. No Tauri.
                       NOTHING ON THIS THREAD MAY PANIC: release aborts on panic.
    stream.rs          what the running app draws into it
    input.rs           receiving a source for a prop: throttle, scale, JPEG
  permissions.rs     AVFoundation microphone/camera authorisation
  compositor/        THE frame pipeline (ADR-001). Rasterises on the CPU with
                     tiny-skia, not wgpu — see frame.rs for why. Every layer
                     refuses to guess rather than painting over the lyrics.
    color.rs           CSS colours; an unrecognised one paints nothing
    filters.rs         mediaFilterCSS: the colour matrices and the box blur
    optical_size.rs    variable fonts instanced at the size they are drawn
    slide_text.rs      scripture and the plain-text fallback, as the window
                       lays them out
    frame.rs           the buffer, and to_bgra() for NDI
    geometry.rs        deck units to frame units
    images.rs          decode and object-fit
    loader.rs          THE scope check for scene media. Never std::fs directly.
    scene.rs           the layer order, and what was left to the webview
    shapes.rs          rects, radii, inset borders
    composer.rs        the screen composer's layout, typed
    overlays.rs        message banner, props and the timer
    parallel.rs        splitting the per-pixel passes across cores
    pipeline.rs        THE per-frame path: caches the slide layer, the timer
                       layer and the background still; composites video
    text.rs            cosmic-text layout; upright text is blitted directly,
                       never through draw_pixmap (37 ms a full frame)
  video/             THE video decoder (ADR-003). The support check is separate
                     and answers by extension, so an unplayable file is caught
                     in the panel rather than on the audience screen.
    ffmpeg.rs          FFmpeg on the GPU, software when the GPU turns a file
                       down; colour rules; NV12 split for the fast path
    gpu_scale.rs       macOS: a larger GPU frame shrunk with scale_vt first
    read_ahead.rs      decoding ahead on a thread; poll_frame never waits
  pptx/              PowerPoint import (Stage 7), python-pptx's behaviour exactly
    package.rs         the zip, content types and relationships
    payload.rs         parse_pptx.py
    convert.rs         src/main/lib/pptx-payload.mjs
    numbers.rs         Python's round, %, int(), float() and colorsys
    image.rs           Pillow's format detection, MPO included
  playback.rs        THE media transport: resume points, and the two drift
                     tolerances the audit recorded as one. No Tauri types.
  presentation.rs    where the operator is: service, item, deck, slide, and the
                     bounds on moving between them. No Tauri types.
  slide.rs           what a slide is made of, typed for the compositor. Unknown
                     types and fields survive rather than blanking the screen.
  surface/           the opt-in native audience screen. The webview is the
                     fallback: it draws everything until `presenting`.
    mod.rs             the loop, the handover delays, SurfaceWorker. No Tauri.
    macos.rs           the NSView below the WKWebView, and drawsBackground
    stream.rs          what the running app draws onto it
  shortcuts.rs       Control+Alt+Space
  speech.rs          AssemblyAI token broker transport
  stage_relay.rs     the last message per type for each stage display, replayed
  window.rs          building, showing, placing and closing windows
  web_storage.rs     which keys are mirrored, the store, the Electron LevelDB import
  webview_crash.rs   WebView2 ProcessFailed and WebKitGTK web-process-terminated
  window_spec.rs     all eight windows as serialisable structs. No Tauri.
state/
  app_state.rs          uptime only
  audio_state.rs        the live audio graph, persisted
  auth_state.rs         the session, in the OS keychain
  display_state.rs      role→display + resolution, persisted atomically
  file_state.rs         media folders + the live scope they define
  looks_state.rs        the live layer flags, persisted
  ndi_state.rs          the loaded NDI runtime and the running stream. In memory.
  ndi_input_state.rs    the one shared receiver, its clients, the latest JPEG
  output_surface_state.rs the native-screen setting, persisted, and its view
  output_state.rs       the operator's scene, what is on screen, and the freeze
                        flag. In memory.
  persist.rs            load-or-default and atomic save, shared
  playback_state.rs     the live transport. In memory.
  presentation_state.rs the position; the service half persists
  stage_relay_state.rs  the stage displays' replay. In memory.
  web_storage_state.rs  web-storage.json, persisted atomically
  window_state.rs       per-window crash history for the loop guard
errors.rs      the single AppError crossing the boundary: { kind, message }
```

**Events emitted to the frontend.** `display:list-changed`, `looks:changed`,
`output:scene-changed`, `presentation:changed`, `audio:changed`,
`playback:changed`, `output-surface:changed`, `output-window-closed`,
`media-stage-window-closed`, `worship-stage-window-closed`, `open-import`,
`ai-operator:toggle-shortcut`, `auth-callback`, `mini-lyrics:save-request`,
`stage-data`, `worship-stage-data`, `browser-state-changed`,
`browser-focus-address`.
The `*-window-closed` names, `open-import`, `auth-callback`, the mini-lyrics,
stage and browser ones match what Electron sends; the rest are new because what they carry is new.

**Files the Rust core owns**, in one app-config directory:
`display-preferences.json`, `media-folders.json`, `looks.json`,
`service-position.json`, `audio.json`, `output-surface.json` and
`web-storage.json`. Plus the auth session, which is in the OS keychain and not
a file at all. In the app-data directory: `logs/present-errors.ndjson`,
`custom-fonts/`, and browser mode's own session data (`browser-mode/` on
Windows and Linux; a WebKit data store on macOS 14+).

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
  reports `ndiRuntime=loaded (…)`, and exposes `__presentFiles`,
  `__presentWindows`, `__presentLooks`, `__presentPosition`, `__presentAudio`,
  `__presentPlayback` and `__presentNdi` so the parts that need a human can be
  driven by hand.
- `capability-probe.ts` — the WKWebView feature report
- `web-storage.ts`, `start-main.ts`, `start-output.ts` — bring localStorage up
  to `web-storage.json` before React starts, and mirror writes back
- the bridge also installs `window.fontAPI` and `window.pptxAPI`, the preload's
  other two globals

Outside that directory, exactly three files know both shells exist:
`src/shared/lib/local-media-url.ts` (which imports nothing from either) and the
two callers that use it.

**Test counts.** 733 Rust — 732 in the library and the panic hook's own binary
— plus two ignored NDI loopback tests that need the runtime; 128 JS. The JS
tests for code that only Electron ran went with it; the Rust ports carry their
cases. `bun run --filter @present/desktop tauri:check`
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

**PPTX import is ported to Rust** (owner, 2026-09-14), not shipped as a Python
sidecar. No machine needs Python, and no installer grows by 40 MB. Done; its
output is the Electron importer's exactly (stage-7-subsystems.md §9).

**Browser mode is built on wry views directly, inside the operator window**
(owner, 2026-09-15). The first answer, 2026-09-14, was Tauri's `unstable` child
webviews. Building it showed that feature rebuilds every window's webview as a
child view, and that a window holding a second Tauri webview stops being a
webview window — every command taking the operator window and every lookup by
label fails while browser mode is open. Given that, the owner chose wry views
Tauri does not manage: the same place on screen, nothing else changed. Do not
turn `unstable` on. wry is pinned to Tauri's version (stage-7-subsystems.md
§10).

**Electron is removed** (owner, 2026-09-15), without the performance comparison.
The last Electron commit is tagged `electron-final`.

**FFmpeg decodes video on every platform** (owner, 2026-09-15), replacing the
platform decoders ADR-002 chose. Built (ADR-003), against Homebrew's FFmpeg,
which the owner agreed to on 2026-09-17 and was already installed. Shipping it
is §4.

**The interface stays React** (owner, 2026-09-15). winit + egui would rewrite
every screen.

**wgpu draws every audience output, after FFmpeg** (owner, 2026-09-17), not
only 4K ones, with the CPU compositor kept as the fallback.

**Offline data moves to SQLite in Rust** (owner, 2026-09-15), replacing the
IndexedDB approach. Not built yet — §4.

**A video chosen again starts from the beginning** (owner, 2026-09-15). The
transport used to keep a resume point per video.

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
- **NDI against the real runtime** (NDI Tools 6.2.1 and grandi's 6.3.0.3):
  discovery in under a second, a frame arriving with channel order and
  orientation intact, the sender clocked at 30 fps watched and unwatched, and
  the same receiver resuming after the source restarted.
- **The NDI stream at 30.0 fps**, 15 s with no gap over 50 ms, release profile,
  a lyric slide over one of the owner's videos, with and without the timer
  showing; the received frame looked at.
- **The running app's NDI stream** received by a separate process: 1920×1080,
  28.9 fps on the debug build, started and stopped through the bridge.
- **The compositor against Chrome** rendering the same markup: each line of a
  four-line verse within 1–3 px, the plain-text fallback the same width and
  about 5 px lower.
- **The packaged app loading its bundled `libndi`** (6.3.0.3) rather than NDI
  Tools' installed copy.
- **NDI props in the running app** against a real source: listed, received
  through `ndi-frame://` at 640×360, the shared receiver kept through one client
  leaving and stopped after the last.
- **The native audience screen in the running app**: attached and presenting
  0.5 s after being turned on, a slide on it screen-captured, handed back to
  the webview and captured again with the text in the same place, one view
  after a rapid on-off-on, reattached when the window reopened.
- **Stage 7, each through the bridge in the running app** by a harness removed
  before committing: 13 bundled Bibles listed and KJV read in 39 ms; both stage
  displays replaying and following live messages; 186 font families; an
  uncaught error and an unhandled rejection redacted into the error log at mode
  0600, and later a real panic with its stack; settings written, removed and
  restored across launches, and a true first launch importing 23 of the
  Electron build's keys; the PowerPoint fixtures through `parseFile` equal to
  the recordings and a 28 MB deck imported; browser mode loading, navigating,
  mirroring scroll, previewing and projecting, with browsed pages seeing no
  Tauri IPC. Details in stage-7-subsystems.md.
- **PowerPoint import against 26 of the owner's decks**, compared locally with
  `parse_pptx.py`: all identical. The decks are not in the repository.

**Not verified — do not claim otherwise:**

- No live AssemblyAI transcription end-to-end. Needs the owner signed in.
- Display id across an **OS reboot**. App restarts only. (Lower risk than first
  thought: the name is a hardware model number, not a display id.)
- Nothing on Windows or Linux. macOS only so far. Crash recovery and browser
  mode have code for both, type-checked by cross-compiling and never run.
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
- **The NDI stream's frame rate since the parity work.** A compositor A/B shows
  no slowdown, but every stream run since has been on a throttled or swapping
  machine (stage-6-ndi.md §6).
- **No service has gone out over NDI or onto the native screen.** The app's own
  stream was received black, because nothing was on screen; the content was
  proved by the probe's own scene and a harness slide. No NDI Tools receiver
  has watched it, and the native screen has not been on a projector.

## 8. The manual test list

Everything here has code, tests and startup probes. **Almost none of it
has been used.** This is the whole of what needs a person, gathered in one place
so it can be worked through rather than rediscovered.

Run `bun run desktop:tauri`. A Tauri webview's console cannot be read from a
terminal, so findings that need recording should go through
`window.__presentRustCore` or the diagnostics command and will appear in the
terminal running the app.

**Handles for driving things by hand**, on the operator window only:
`__presentFiles`, `__presentWindows`, `__presentLooks`, `__presentPosition`,
`__presentAudio`, `__presentPlayback`.

### A. One machine, signed out — start here

Nothing below needs a second screen or an account. This is the hour that will
find the most.

- [ ] **Advance a slide.** Load a service, press next and previous through a
      song. Does the deck move, and does it stop at the ends rather than rolling
      into the next item?
- [ ] **Open the audience output window.** It has never been opened. Expect the
      Rust scene rendered in a webview.
- [ ] **Open both stage displays** — worship stage and media stage. Same.
- [ ] **Open the mini lyrics editor**, change a verse, save it. The round trip
      is tested only in units. There is a ten-second timeout; an operator who
      hits save needs an answer either way.
- [ ] **Play a video** from the media panel. Does it decode and play in the
      webview? Nothing has ever played through `local-media://`.
- [ ] **Hear something.** No audio has come out of a speaker under Tauri at all.
      Play a video with sound, then a backing track from the audio panel.
- [ ] **Change the audio output device** in settings, with both a video and a
      backing track playing. **Both should follow it** — that is known-issues §1
      fixed, and the part that has only been proven through the startup gate.
- [ ] **Freeze and unfreeze the output.** The behaviour deliberately differs
      from Electron now: unfreezing catches the audience screen up rather than
      leaving it stale (known-issues §11).
- [ ] **Toggle the output layers** from the Looks window and watch the audience
      screen follow. It should be immediate, not on a 400 ms poll.
- [ ] **Open each of the eight native dialogs** via `__presentFiles`: folder,
      media file, audio files, prop image, prop media, presentation files,
      library export destination, library import source. None has been clicked.
- [ ] **Press `Control+Alt+Space`.** The AI Operator shortcut has never been
      pressed.
- [ ] **Trigger the permission prompts** for microphone and camera. Never shown.
- [ ] **Use the application menu** — Present, File, Edit, View, Window.
- [ ] **Add an `.avi` or `.mkv` to a media folder.** It should appear with an
      amber border and a warning telling you to convert it. All 67 of your
      current files are MP4 or MOV, so this needs a deliberately odd file.
- [ ] **Export a library bundle, then import it back.** Tested only in units,
      never driven through the UI.
- [ ] **Close the last window**, then reopen from the Dock. The process should
      survive and recreate the operator window.

### B. Needs a second monitor — the outstanding Stage 2 gate

This is the one gap that is a *gate* rather than a gap. Window placement has
only ever been exercised at the origin, which is exactly where a
physical-versus-logical pixel mistake is invisible.

- [ ] Put the audience output on the second monitor and confirm it covers it
      exactly — no offset, no partial coverage, no wrong screen. **A
      physical-versus-logical pixel mistake is a whole screen's width of error
      and is invisible at the origin**, which is the only place this has run.
- [ ] Same for both stage displays.
- [ ] **Unplug the second monitor mid-service.** Windows should reconcile.
- [ ] **Plug it back in.** They should return to it. The untested case is
      specifically crossing a boundary: whether unfullscreen, reposition,
      refullscreen lands on the *other* display, and whether the 700 ms
      transition allowance is enough there (stage-2-hotplug.md).
- [ ] Change the second monitor's resolution while a window is on it.
- [ ] Confirm the display picker names the monitors the way macOS does.
- [ ] Play a video full-screen on the second monitor and watch for tearing or
      dropped frames.

### C. Needs an account

- [ ] **Sign in.** Nobody has signed in under Tauri. The session store, the
      refresh transport and the deep-link handler all have tests; the flow has
      never run.
- [ ] Confirm the session survives a restart — it is in the OS keychain now,
      not a file.
- [ ] **Follow a `present://` deep link** while the app is running, and again
      while it is closed.
- [ ] **Run live speech-to-search.** No AssemblyAI transcription has run
      end to end.

### D. Worth doing once, not urgent

- [ ] Restart the **operating system** and confirm the display id is unchanged.
      Only app restarts have been tested. Lower risk than it sounds — the name
      is a hardware model number, not a display id.
- [ ] Run the packaged `.app` rather than `tauri dev` and repeat section A
      quickly. The packaged build serves from `tauri://localhost` rather than a
      dev server, which is a different origin and a different URL form.

### E. NDI — Stage 6, needs NDI Tools (installed on this machine)

- [ ] **Settings → Enable NDI source**, then open **NDI Video Monitor** and pick
      `Present Main Output`. Nothing but this code's own receiver has ever
      watched the stream.
- [ ] **Go live with a song over a background video** and watch it on the
      monitor. Expect it to follow the Looks window's **NDI** column, not the
      projector's (known-issues §13).
- [ ] **Put scripture on screen**, a long verse and a short one. Expect the
      stream to break the lines where the projector does.
- [ ] **Freeze the output**, change slides, unfreeze. The stream should hold and
      catch up exactly as the projector does.
- [ ] **Run a countdown timer** with the NDI column's Props layer on, and watch
      for a stutter once a second. There should be none now.
- [ ] Leave it running for **45 minutes**. Electron has run longer; the Rust
      sender has not.
- [ ] Open **NDI Test Patterns**, add an NDI prop in the Layers panel, and pick
      it. Put the same source on two props, then remove one: the other should
      keep its picture.
- [ ] Quit NDI Test Patterns with the prop on screen and start it again. The
      prop should come back without anyone touching it.
- [ ] Run the **packaged** app on a machine without NDI Tools and turn NDI on.
      It should use the runtime inside the app.
- [ ] **Settings → Audience screen → Draw natively**, with the output on the
      projector. Go through a service: a song over a video, scripture, a
      countdown, a YouTube prop, a message. Watch for any black frame when it is
      turned on and off, and compare the words with it off. Expect softer text
      only on a Retina or scaled 4K screen.

### F. Stage 7 — the parity checklist

- [ ] **Open the Bible panel**, pick a translation, read a chapter, put a verse
      on screen. The bundled Bibles have been listed and read only by harness.
- [ ] **Put a song on screen and look at both stage displays.** They were blank
      under Tauri before Stage 7 (known-issues §16).
- [ ] **Open a font picker**, choose a system font, then **install a custom
      font** through the picker and use it on a slide.
- [ ] **Change some settings** — a layout, a timer, a media filter — quit, and
      reopen. They should survive, and a packaged build should show the same.
- [ ] **Launch the packaged app for the first time** on a machine that has run
      the Electron build: its settings should come across, once.
- [ ] **Import a PowerPoint file** through the import dialog (File → Import, or
      the library). Only the dialog has not been driven; the parse has.
- [ ] **Open browser mode**, search, follow links, go back and forward, press
      ⌘L inside a page, and watch the preview sidebar. Then **project to the
      main output** and scroll: the audience screen should follow. Close the
      output window while projecting, and project again.
- [ ] Break something on purpose and find it in
      `~/Library/Application Support/space.multivrs.present/logs/present-errors.ndjson`.

To watch a stream from a terminal instead:
`cargo run --release --example ndi_watch -- "Present Main Output" 10 frame.png`
in `apps/desktop/src-tauri`. From the operator window's console,
`__presentNdi.start()`, `.status()` and `.stop()` drive it by hand — but
Settings stops it again about eight seconds into a launch if NDI is disabled
there.

### What to watch for throughout

- **Any black frame on the audience screen**, however brief. That is the
  failure this migration cares about most.
- **The same audio twice**, a fraction of a second apart. That is audience echo,
  and it is the regression that must never return.
- Renderer errors in the terminal. A clean launch currently produces **zero**,
  so anything at all is new.

## 9. Open issues

Every bug found so far, with its current state. The detail is in
[known-issues.md](known-issues.md); this table is so a new session can see the
whole picture without opening it.

| # | Issue | Severity | State |
|---|---|---|---|
| 1 | Backing tracks ignore the audio-output-device setting | High | **Fixed** under Tauri |
| 2 | Dev and packaged builds keep entirely separate state | High | **Mostly fixed** — see below |
| 3 | `local-media://` can read any file on disk | Medium | **Fixed** |
| 4 | Media panel hidden behind a dead File System Access check | Medium | **Fixed** |
| 5 | `vosk` is a dependency that is never imported | Low | **Fixed** |
| 6 | Build workflows trigger on a branch that does not exist | Low | Open — deliberately |
| 7 | Ten pre-existing ESLint errors | Low | Open — deliberately |
| 8 | Speech-to-search blocked by a CORS preflight | Medium | **Fixed** |
| 9 | Monitor hot-plug never moved the output window | High | **Fixed** |
| 10 | No webview crash recovery on Windows or Linux under Tauri | Medium | **Fixed**, not run on either |
| 11 | Unfreezing the output does not catch the audience screen up | Medium | **Fixed** |
| 12 | The Looks window and the operator window agree by polling | Medium | **Fixed** |
| 13 | The Looks window's NDI column does nothing | Medium | **Fixed** under Tauri |
| 14 | The compositor does not draw scripture, plain text, filters, or media the way the window does | High | **Fixed** |
| 15 | Four compositor costs that stall a 30 fps stream | High | **Fixed** |
| 16 | Both stage displays were blank under Tauri | High | **Fixed** |
| 17 | CI's Linux clippy would fail on two keychain constants | Medium | **Fixed** |

**§2 is the one to understand.** Most of it is done: the auth session is in
the OS keychain; the media folders, output layer flags and service position are
Rust files; and since Stage 7 the rest of the `present-*` localStorage keys are
mirrored into `web-storage.json`, so every build shares them. What is still
origin-bound is the offline library — being moved to IndexedDB in the owner's
in-progress `localData.ts` — its sync queue, the Dexie Bible cache, and fonts
installed under Electron.

**Issues 6 and 7 are open on purpose.** Release triggers are not a migration
decision, and the ten lint errors are pre-existing on `master` — eight of them
change render timing in live-service code. Neither belongs inside a migration
commit.

### Gaps that are not bugs

Things that are missing rather than wrong. **All of them are in
[§8, the manual test list](#8-the-manual-test-list)** — this is
the short version, for anyone deciding what to trust rather than what to do.

| Gap | Where it bites |
|---|---|
| **No service has been run end to end under Tauri** | The largest gap in the whole migration |
| **No audio has come out of a speaker** | The single audio path is proven by tests and a startup gate, not by hearing it |
| No window has been on a second monitor | The outstanding Stage 2 gate |
| No stage display has been used in a service | Both were blank under Tauri until Stage 7 (known-issues §16); fixed and checked by harness, never by a person |
| Nobody has signed in | Session store, refresh transport and deep links are tested, never run |
| The native audience screen is opt-in | Deliberate, the owner's call, until it has run a service on a projector |
| Nothing has run on Windows or Linux | The URL form, single-instance lock, argv deep links, keychain fallback and **video decode** are all macOS-only; crash recovery and browser mode have code for both, never run |
| No Stage 7 subsystem has been used by hand | Each was driven through the bridge by a harness; §8 F |

## 10. Working agreements

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

## 11. Commands

The monorepo runs on **bun**, not pnpm. Root aliases start each app from
anywhere in the tree:

```bash
bun run desktop:tauri          # Tauri + Vite — the app being built
bun run web                    # Next.js web app
bun run convex                 # Convex CLI
```

Everything else:

```bash
bun run desktop:tauri:build                     # production bundle, FFmpeg and all

# The FFmpeg the bundle carries (ADR-003), from apps/desktop.
bun run --filter @present/desktop tauri:ffmpeg   # build and stage it, no bundle
FFMPEG_DIR=$PWD/src-tauri/ffmpeg/prefix cargo test --manifest-path src-tauri/Cargo.toml

# NDI, from apps/desktop/src-tauri. The first two need the NDI runtime.
cargo test --test ndi_loopback -- --ignored --nocapture
cargo run --profile perf --example ndi_stream_probe -- <video> [seconds] [frame.png|-] [program]
cargo run --profile perf --example decode_probe -- <video> [frame.png]   # FFmpeg on a real file
cargo run --release --example ndi_watch -- "<source name>" [seconds] [frame.png]
cargo run --release --example slide_text_sample              # scripture as the compositor draws it
cargo run --example font_catalog_probe                       # the font list as Rust reads it
cargo run --example web_storage_probe                        # what an Electron import would bring, no values
cargo run --example pptx_import_probe -- deck.pptx           # a deck as the importer reads it, JSON
bun run --filter @present/desktop tauri:stage-ndi            # copy libndi in for a bundle
bun run --filter @present/desktop tauri:check   # fmt + clippy -D warnings + tests
bun run test                                    # 128 JS tests
bun run typecheck
bun run lint
node apps/desktop/scripts/check-tauri-version.mjs [--fix]
```

`bun run desktop:tauri` exists because `bun tauri dev` from the repo root does
not work: the Tauri CLI finds `src-tauri` by scanning the workspace but runs
`beforeDevCommand` from the invocation directory, where `tauri:vite:dev` is not
a script. Run it from `apps/desktop` or use the alias.

Current: **770 Rust tests, 128 JS tests**, clippy/fmt/typecheck clean.

## 12. Installed skills

`rust-best-practices`, `rust-async-patterns`, `rust-testing`, `rust-patterns`,
`rust-engineer`, `tauri-v2`, plus `frontend-design` globally. Project-scoped in
`.agents/skills` with symlinks in `.claude/skills`.

The owner asked about `JavaScript-Mastery-Pro/skills`; it was assessed as a
generic nine-step workflow pack that overlaps and competes with the migration
plan's own stage gates. Not installed. That was advice, not a veto — install it
if asked.

## 13. Traps

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
- **A panic on the NDI send thread aborts the app.** `profile.release` has
  `panic = "abort"`, so a stray `unwrap` there ends the service, not the stream.
  Read Tauri state with `try_state`, never `state`, which panics if the state is
  not managed yet.
- **Draw from `OutputState::on_screen()`, never `scene()`,** in anything that
  renders the output. `scene()` keeps moving during a freeze.
- **tiny-skia's `draw_pixmap` is slow for an aligned copy** — 37 ms for a
  full 1080p frame, whether or not it holds any ink. `blend_over` in
  `pipeline.rs` and `composite` in `text.rs` are the fast paths.
- **A cache keyed on `OutputScene::differs` is rebuilt ten times a second**
  while a video plays, because the scene carries the video's clock. Key on what
  the cached thing actually reads.
- **Judge frame times on the release profile only.** The debug build took
  46–52 ms a frame for an empty black scene in `tauri dev`; the release build
  takes 11.7 ms for a lyric slide over video. Not a like-for-like pair, but the
  direction is not in doubt.
- **Settings stops NDI on launch when NDI is disabled there** — the Tauri origin
  starts with it disabled (known-issues §2). A stream started by hand dies
  about eight seconds in.
- **The NDI runtime found first** is the bundled copy in a packaged app, then
  `/usr/local/lib/libndi.dylib` (NDI Tools, 6.2.1 on this machine), then in
  debug builds grandi's 6.3.0.3 in `node_modules`. Set `PRESENT_NDI_LIBRARY` to
  test a specific one.
- **`allsorts` is why the crate declares Rust 1.83.** Downgrading the declared
  version breaks the build, not a lint.
- **Chromium sets a variable font's optical size from the pixel size; cosmic-text
  does not.** Text drawn without `optical_size.rs` is about nine percent wider
  than the window's, which moves line breaks. A face instanced under its own
  family name is shadowed by the original — register the instance under an
  alias.
- **Parity was measured against Chrome, and Tauri's webview is WebKit.** The
  Electron audience window is Chromium; the Tauri one is not. Compare against
  the engine that matters for the question.
- **`with_webview` runs its closure on the main thread.** Waiting for its answer
  from the main thread — a synchronous command, a window event handler —
  deadlocks. `OutputSurfaceState::attach` spawns a thread for that reason, and
  the surface worker is signalled, never joined.
- **Do not enable Tauri's `macos-private-api` to make a webview transparent.**
  It turns wry's `transparent` on for every window. The surface sets
  `drawsBackground` on the one webview it sits under, and restores it.
- **The native surface is drawn at CSS size.** On a 2× screen it is upscaled.
  Drawing at device pixels needs a scale through the whole compositor.
- **This machine throttles and swaps.** An i7-8750H that has just run a release
  build shows `kernel_task` near 100% CPU; with the browser open it has also
  been 11.5 GB into a 12 GB swap. Frame times taken then are not comparable to
  anything — on 2026-09-14 the pre-parity and current stream probes both got
  under 2 fps back to back. Check `top`, `sysctl vm.loadavg` and
  `sysctl vm.swapusage` before trusting a measurement, and A/B against the
  previous commit rather than against a number in a doc.
- JavaScript numbers are exact only to 2^53−1. Anything hashed or generated in
  Rust and sent to the UI as a number must respect that.
- **Do not turn on Tauri's `unstable` feature.** It rebuilds every window's
  webview as a child view, and a window with a second Tauri webview is no
  longer a webview window: `get_webview_window` returns `None` and commands
  taking `WebviewWindow` fail for as long as it exists. Browser mode's views
  are wry's, outside Tauri's manager, for exactly this reason.
- **wry's `WebView::url()` panics on macOS** for a view that has not committed a
  page — it unwraps WKWebView's nil URL. Read the URL natively
  (`browser_mode/view/native.rs`). A panic in a wry callback on the main thread
  ends the app.
- **wry is pinned to `=0.55.1`, Tauri's version.** When Tauri moves to another
  wry, move the pin with it; a test fails if the lockfile holds two.
- **wry's navigation handler is asked about frames too**, without saying which.
  Refusing everything but http(s) there breaks `about:blank` and `data:`
  iframes.
- **The Tauri dev binary and the packaged app keep separate WebKit data**
  (`~/Library/WebKit/present` vs `~/Library/WebKit/space.multivrs.present`).
  `web-storage.json` is what they share.
- **Python's arithmetic is not Rust's.** `round(x, 4)` rounds the exact binary
  value ties-to-even (`format!("{x:.4}")` agrees), float `%` takes the divisor's
  sign, and `serde_json` without `float_roundtrip` can read a float one bit
  away — which made identical PowerPoint output compare unequal.
- **The editor tool decodes `\uXXXX` escapes** in file content it writes into
  literal, often invisible, characters. Write such source through a quoted
  heredoc, or scan for Zs/Cc/Cf characters afterwards.
- **WebKit pauses a video in a hidden window by itself** — covered by the output
  window, minimised, behind another app — and resumes it when the window is
  seen. A `pause` event while `document.visibilityState` is `hidden` is not the
  operator. Treating it as one stopped the transport whenever the output opened.
- **WebKit runs no animation frames in a hidden window.** Anything that waits for
  `requestAnimationFrame` before showing a window never shows it.
- **A mirror compared against a position that crossed IPC is always behind.**
  Aim at the position plus the time since it was sampled
  (`mirror-video-sync.mjs`), and never seek a playing mirror for a small gap.
- **Homebrew's FFmpeg is a GPL build.** Build and test against it, never ship
  it: the bundles carry their own LGPL build (`scripts/build-ffmpeg.sh`), and
  a release that loaded a system one logs an error at the first decode.
- **An FFmpeg built without `nasm` must not ship.** x86 assembly is most of
  swscale's and the software decoder's speed, and without it the fast colour
  conversion rounds a further level down — enough that a test reading grey
  levels three apart misread them. The decoder needs FFmpeg 5.0 or later (sliced scaling); Ubuntu 22.04's
  4.4 will not do.
- **FFmpeg's own messages are silenced** (`Level::Fatal` in `ffmpeg.rs`),
  because the GPU decoder prints a "failed setup" line for every file it turns
  down. Raise the level there to see FFmpeg's view of a bad file.
- **"Copying a frame off the GPU" includes waiting for the GPU to decode it.**
  The 10–17 ms that step measured at 4K is mostly decode, not memcpy.
- **`grandi` is still a dependency after Electron.** Its prebuilt package is
  where the bundled `libndi` is copied from (`scripts/stage-tauri-ndi.mjs`), and
  `bunfig.toml`'s hoisted linker is what lets that script find it.
