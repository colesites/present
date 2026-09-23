# Stage 7 — the remaining subsystems

**Status:** code complete. Done: Bibles, fonts, the AI Operator's tool list, the error log, the stage displays' feed, browser-storage settings in Rust, `vosk` removed, crash recovery on Windows and Linux, the PPTX importer in Rust, browser mode. Left: the parity checklist by hand (HANDOFF §8 F).

The audit's content for this stage is Bible, fonts, the PPTX importer, auth,
the AI Operator, error reporting and settings; its gate is a parity checklist.
Auth's session and refresh moved in Stage 4.

---

## 1. Decisions, by the owner (2026-09-14)

| Question (audit §13) | Answer |
|---|---|
| PPTX: ship Python as a sidecar, or port the parser? | **Port `parse_pptx.py` to Rust.** No machine needs Python; no installer grows by 40 MB. |
| Browser mode: unstable child webviews, a separate window, or defer? | **Tauri's unstable child webviews**, so browser mode stays inside the operator window. Pin the Tauri version and re-test browser mode on every upgrade. **Changed by the owner on 2026-09-15** to wry views built directly on the windows — same place on screen — once the cost of `unstable` was found (§10). |

## 2. What is still on Electron

The bridge reports every `electronAPI` call it does not have. Against
`preload.ts`, 26 methods at the start of the stage:

| Subsystem | Methods | Slice |
|---|---|---|
| Bible | `listBundledBibles` · `readBundledBible` · `fetchHostedBibleCatalog` | **done**, §3 |
| Fonts | `getSystemFonts` · `getSystemFontFaces` · `pickFontFile` · `installCustomFonts` · `getCustomFonts` — on `window.fontAPI`, which Tauri did not install at all | **done**, §5 |
| AI Operator | `listAiOperatorTools` | **done**, §6 |
| Speech | `requestAssemblyAiToken` | **not needed**, §6 — nothing calls it |
| PPTX | `openFile` · `parseFile` — on `window.pptxAPI`, likewise not installed | **done**, §9 |
| Browser mode | `setBrowserModeEnabled` · `setBrowserModeBounds` · `browserNavigate` · `browserBack` · `browserForward` · `browserReload` · `setBrowserProjectionTarget` · `getBrowserModeState` · `fetchBrowserSuggestions` · `onBrowserModeStateChanged` · `onBrowserFocusAddress` | **done**, §10 |
| Stage displays | `onStageData` · `onWorshipStageData` (`onOutputData` is unused under Tauri) | **done**, §4 — they were blank |

Plus two known issues assigned here: §5 (`vosk`, never imported) and §10 (no
webview crash recovery on Windows and Linux), and error reporting — **done**,
§7.

## 3. Bibles

**Characterised first.** `src/shared/lib/bible-catalog.mjs` holds the naming,
id and ordering rules, moved verbatim out of `bible.utils.ts`,
`bible.constants.ts` and `bible.service.ts`, which import it now.
`tests/bible-catalog.test.mjs` pins them — each assertion checked against a
mutation — and `services/bible.rs` carries the same cases.

The rules are kept with their quirks, because an id is built from the code and
the scripture panel keys installed versions on it:

- the first listed code the upper-cased name contains wins, so
  `EnglishERVBible.xml` and `NIrV` are both **`RV`**, `AKJV` is `KJV`, and a
  "Webster" Bible is `WEB`
- otherwise the compacted name if it is 2 to 8 characters, else `BIBLE`
- the id rounds the modified time half up, which Rust does in integer
  nanoseconds so no float lands a file on the other millisecond
- the list is in `localeCompare` order; that port now lives in
  `services/collation.rs`, shared with the NDI source list

**What moved** (`d1e1bab`):

- `bible/` ships through `bundle.resources` — one directory, where Electron
  tries four, three of them development-checkout guesses
- a Bible is read only from inside it, after resolving symlinks; a missing file
  is refused exactly as an outside one is, so the answer says nothing about
  what exists
- the bytes cross as binary (`tauri::ipc::Response`) and the bridge hands the
  panel a `Uint8Array`, as Electron did
- the catalog follows at most five redirects, as Electron does, and only over
  http or https — `net.fetch` would have opened `file:` too

**Verified in the running app:** 13 Bibles listed from the bundled copy with
Electron's codes, names and order; KJV's 4.6 MB read whole in 39 ms; a path
outside the folder and a traversal both refused.

**The hosted catalog does not exist.** `present.multivrs.space/bibles/catalog.json`
answers 404, so under both shells the panel runs on the bundled Bibles alone.
The success path, a relative redirect, the redirect limit and error bodies are
tested against a local server instead.

**Not verified:** the packaged app's `bible/` (the dev build copies resources
the same way, and NDI's resources were verified packaged); importing a Bible
into the scripture panel end to end under Tauri.

## 4. The stage displays were blank

Checking the "stage relays" row found both stage displays blank under Tauri
(known-issues §16). Stage 4's bridge sent their updates to `send_to_output`,
assuming they would draw the Rust scene. They cannot: the confidence monitor
shows the next slide, which no scene carries. `send_to_output` refused the
`stage-content` messages, the bridge swallowed the error, and nothing
delivered `onStageData` or `onWorshipStageData` at all.

**What moved** (`a6458c6`): `services/stage_relay.rs` keeps the last message of
each type for each display and `send_to_stage` delivers it on Electron's channel
names. A display that opens asks `get_stage_messages` for what it missed —
media first, because the worship stage reads `showText` from the last
`media-update` when it applies a slide — which replaces the `*-ready`
handshake. The bridge listens before it asks and holds anything that arrives in
between, so a kept message never overwrites a newer live one.

The messages stay opaque: the two windows' reducers decide what they mean, and
did not change.

**Verified in the running app**, each window reporting its own rendered text:
messages sent before either display opened appeared when it did — the
confidence monitor's current and next lines, labels and timer; the worship
stage's slide and section label — and messages sent afterwards replaced them.
The worship stage draws a non-scripture slide on a canvas, so the check used a
scripture slide, which it draws as text.

**Not verified:** a person watching either display through a service; the
worship stage's background media.

## 5. Fonts

**Characterised first**, against the real thing. `src/shared/lib/font-catalog.mjs`
holds the rules from `shared/lib/font.ts` and `font.service.ts` — which import it
now — plus a port of the JavaScript half of `font-list` 2.0.2 and the guesses its
macOS helper makes from a PostScript name. `tests/font-catalog.test.mjs` pins
them, each assertion checked against a mutation, and on a Mac with font-list
installed one test runs the helper binaries and the library and requires the
port to match exactly: all 186 families on this machine do.

Quirks kept: `"Extra Bold"` is 700 (the earlier hint, `bold`, is a whole word
there) while `"ExtraBold"` is 800; `Montserrat-SemiBoldItalic.ttf` is 400 with its
whole name as its label; only ASCII letters start a title-cased word; faces
sort by one comma-joined string by UTF-16 code unit.

**What moved** (`3038b6e`):

- the system list comes from `NSFontManager` on the main thread, as the helpers
  read it: every family, and each family's first member's PostScript name
- `services/fonts.rs` reproduces the JavaScript regular expressions by hand;
  the `regex` crate's `\b` is Unicode-aware and would disagree
- installed fonts copy into `custom-fonts` in the app's data folder
- **only picked fonts install**: the picker grants each file to the scope and
  `install_custom_fonts` resolves through it, where Electron copied any path
- `window.fontAPI` is installed by the bridge; Tauri had never had it, so the
  pickers showed their seven-family fallback

**Verified:** `examples/font_catalog_probe` prints exactly what Electron's
pipeline prints on this Mac — 186 families and 186 faces, identical JSON (the
command to produce Electron's side is in the example's header). In the running
app `window.fontAPI` listed both, and refused to install a file not picked.

**Costs and gaps.** The first system-font call takes about 450 ms on the main
thread (24 ms after); Electron spent a second in a child process instead. The
Windows and Linux lists come from fontdb and have not been compared with
Electron. Fonts installed under Electron live in its own data folder and are not
seen here — known-issues §2. Installing through the picker has not been clicked
through by a person.

## 6. The AI Operator's tool list, and the speech token

**Tool list** (`e23e0f1`): the 46 definitions moved from `operator-tools.ts`
into `src/shared/ai-operator/present-tools.json`, checked deep-equal to the
TypeScript before it was removed. Electron imports the JSON; Rust compiles it in
with `include_str!`, so the two cannot drift. `tests/ai-operator-tools.test.mjs`
pins its shape. Nothing in the renderer calls `listAiOperatorTools` — the
operator runs in the operator window with its own tool provider — so this keeps
the channel answering rather than fixing anything visible.

**Speech token: not ported, on purpose.** Nothing calls
`electronAPI.requestAssemblyAiToken`. Under Tauri, voice search already gets its
token through `request_speech_token` (Stage 3). Electron's handler also falls back
to a direct AssemblyAI token, which the desktop is not meant to hold; bridging it
would reintroduce that path.

## 7. The error log

**Characterised first** (`7915d7a`): the entry shape, rotation and renderer
mapping moved into `src/main/lib/error-log.mjs`; `tests/error-log.test.mjs` pins
them and the redaction as exact output — `bearer` in any case becomes
`Bearer [REDACTED]`, a token value runs to whitespace (a no-break space counts)
or `&`, 80+ credential characters go between ASCII word boundaries, the text is
cut to 20 000 UTF-16 units.

**What moved** (`d6b34ba`): `services/error_log.rs` writes
`logs/present-errors.ndjson` in the app's data folder, one redacted line an
error, rotated to `.1` at 2 MiB, mode 0600.

| Electron records | Tauri records |
|---|---|
| `report-renderer-error` | `report_renderer_error`, any payload, as Electron accepts |
| main-process `uncaughtException` / `unhandledRejection` | a Rust panic, from a panic hook that runs before the release build aborts |
| `render-process-gone` | a webview content process terminating (macOS only) |
| `did-fail-load`, `child-process-gone` | nothing — Tauri reports neither |

**Verified in the running app:** a real uncaught error and a real unhandled
rejection went through the renderer's own handlers into the file, redacted, mode
0600; a non-object report was dropped. The panic hook is tested in its own test
binary (`tests/panic_hook.rs`), because a hook is process-wide.

## 8. Settings out of browser storage, `vosk`, and crash recovery everywhere

### Browser storage (known-issues §2)

**The rules** — which keys, and what a window does at start — are
`src/shared/lib/web-storage.mjs`, pinned by `tests/web-storage.test.mjs`.
Mirrored: every `present-*` and `present:*` key except the slices Rust already
owns (looks, service position, the auth session) and the offline library and
sync queue.

**What moved** (`cf167c1`):

- `web-storage.json` in the app's config folder is the durable copy; the
  components still read localStorage, synchronously, and did not change
- `index.html` and `output.html` start React through `start-main.ts` and
  `start-output.ts`, which wait for `web-storage.ts`: the first window of a run
  brings localStorage up to the store, later windows share it
- every window's writes to a mirrored key go to Rust, batched per task, patched
  on `Storage.prototype`
- first run: the store is created from this build's localStorage if it has any,
  otherwise once from the packaged Electron build's (`app://app` in
  `Present/Local Storage/leveldb`), read with `rusty-leveldb` from a copy
- a normal start gives up after 2 s; the one-time import after 20 s, and if it
  outlives that, the session's writes are not mirrored, so React's defaults
  cannot overwrite the imported settings

**Found by testing it:** the import took 2.5 s in a debug build — past the single
2 s timeout the first version had — and React's defaults would then have been
mirrored over the settings just imported. Hence the separate timeout and rule.
Also found: WebKit accepted a 5 000 000-character value, so the quota I had
assumed is not a constraint; and the Tauri dev binary and the packaged app keep
separate WebKit data (`~/Library/WebKit/present` vs `…/space.multivrs.present`).

**Verified in the running app**, across launches: created from the dev build's
own localStorage; a write and a removal reached the file, a non-mirrored key did
not; a value changed in the file while the app was stopped won on the next
launch, and opening the audience window did not undo it; with the dev WebKit data
moved aside (and restored afterwards), a true first launch put all 23 of the
Electron build's keys into localStorage before React read it.
`examples/web_storage_probe` lists what an import would bring, without values.

**Not verified:** the packaged app's first launch; two windows starting at the
same instant.

### `vosk` (known-issues §5) — `3015193`

Removed, with the nine packages only it used. Electron packages.

### Crash recovery on Windows and Linux (known-issues §10) — `a60dfbe`

`services/webview_crash.rs` registers WebView2's `ProcessFailed` and WebKitGTK's
`web-process-terminated` on every window; both reach the crash policy macOS uses.

**Checked from macOS, run on neither.** The crate type-checks and passes
`clippy --all-targets -D warnings` for `x86_64-pc-windows-msvc` and
`x86_64-unknown-linux-gnu`, and a planted error in each platform module fails the
check. The recipe, for whoever needs it again (all outside the repository):

- Linux: `PKG_CONFIG_ALLOW_CROSS=1`, `PKG_CONFIG` pointing at a script that
  answers `--modversion` with `99.0` and everything else with nothing;
  `CC_x86_64_unknown_linux_gnu=clang` with
  `CFLAGS_…="--target=x86_64-linux-gnu -DRING_CORE_NOSTDLIBINC=1 -isystem <dir>"`,
  where `<dir>` holds a `stdlib.h` declaring `malloc`, `free`, `posix_memalign`
- Windows: the same compiler flags with `--target=x86_64-pc-windows-msvc`, the
  `_byteswap_*` functions declared too, `AR_…` a script turning `lib.exe`'s
  `-out:` into `ar crs`, and an `llvm-rc` on `PATH` that writes an empty file
  where `/fo` says

That run also found **known-issues §17**: two keychain constants that CI's Linux
clippy would fail on. Fixed in `498b9c5`.

## 9. PowerPoint import, without Python

Under Electron, `parse-pptx` ran `parse_pptx.py` with the machine's own
`python3` and `python-pptx`, then converted its payload in JavaScript. A machine
without both could not import a PPTX. The owner chose a Rust port over shipping
Python (§1).

**Characterised first** (`1dc0f9d`): the conversion moved verbatim into
`src/main/lib/pptx-payload.mjs`; `scripts/make-pptx-fixtures.py` builds four
decks covering placeholders inheriting from their layout, theme colours with
`lumMod`/`lumOff`, spacing in points and as a multiple, groups, a merged table,
PNG/JPEG/GIF pictures, solid, themed and picture backgrounds, a picture
placeholder and an empty deck; `tests/fixtures/pptx/*.expected.json` are what
the Electron importer made of them.

**What moved** (`32e1999`): `services/pptx` — `package.rs` the zip and its
relationships, `payload.rs` the Python, `convert.rs` the JavaScript,
`numbers.rs` Python's arithmetic, `image.rs` Pillow's format detection.
`open_pptx` and `parse_pptx` serve `window.pptxAPI`, which Tauri had not
installed; `parse_pptx` reads only a file the operator picked, through the
presentation picker or `open_pptx`.

The output has to be the Electron importer's exactly, so the port reproduces
python-pptx rather than the file format. The places that decide a slide:

- every `p:sp` is text, whatever its geometry; one with no text body gets an
  empty paragraph
- a picture in a picture placeholder is dropped, as are charts, OLE objects
  and movies
- a placeholder without its own position takes its layout's (by `idx`), which
  takes its master's (by type)
- a group adds its position to its children's own coordinates, without its
  child transform
- a run's colour comes from python-pptx's `ColorFormat`: transforms on an RGB
  colour are ignored, and anything but RGB or a theme colour is black
- line spacing in points arrives as an EMU count (30 pt is 571 500)
- `round(x, 4)` rounds the exact binary value, ties to even; a JPEG with a
  multi-picture index is `MPO` to Pillow and exported as an empty PNG

`serde_json`'s `float_roundtrip` is on: the default parser can read a float
one bit away, which made an exact comparison fail on identical output.

**Verified:**

- the four fixtures, exactly, in `cargo test`
- 26 real decks from the owner's machine, compared locally against
  `parse_pptx.py` and the conversion: all 26 identical. Not committed, and not
  copied anywhere
- the running app: the fixtures through `window.pptxAPI.parseFile` came back
  equal to the recordings; a file outside the picked scope and a missing file
  were refused (`denied`, `not-found`); a real 28 MB, seven-slide deck imported
  through `importServicePresentationFile` into 7 slides and 75 elements

**Speed**, the same 28 MB deck: 0.15 s in an optimised build (1.2 s the first
time, from a cold disk cache), 2 s in a debug build; the Electron importer took
2.7 to 3.7 s.

**Not verified:** picking a file with the dialog by hand — the harness granted
the fixtures' folder instead.

## 10. Browser mode

Under Electron, `browser-view.service.ts` laid a `BrowserView` over the operator
window's viewport and, when projecting, a second over the audience window, then
polled the first every 180 ms: its scroll position, mirrored onto the second,
and a 360-wide capture for the preview sidebar.

**Characterised first** (`e192d82`): what that service and the suggestions
handler decide moved verbatim into `src/main/lib/browser-mode.mjs` — what the
address bar's input loads, which page a view restores, the viewport rounding,
the preview's crop, the suggestions URL, the starting state. Identical to the
originals on 100 000 generated inputs before those were removed.
`tests/browser-mode.test.mjs` pins it, quirks included: `ftp://files.example.com`
loads `https://ftp://files.example.com`, a tab does not rule an address out,
NEL is not trimmed. 21 mutations, one surviving — the `127.0.0.1:` prefix
check, which the dot check already covers.

### Why not Tauri's child webviews

The owner first chose Tauri's `unstable` child webviews. Building it found two
costs that decision had not been told about:

- **`unstable` is global.** With the feature on, `tauri-runtime-wry` builds
  *every* window's webview as a child view with proportional bounds instead of
  as the window's content — the operator window, the audience window, both
  stage displays. All would need re-testing, the native audience screen
  (Stage 6) included.
- **A window holding a second webview stops being a webview window.** Tauri's
  `is_webview_window` is "every webview has the window's label". With a browser
  child in `main`, `get_webview_window("main")` returns `None` and every command
  taking `WebviewWindow` from the operator window fails with "current webview is
  not a WebviewWindow" — 10 commands (every file dialog, the PPTX picker) and
  19 lookups by label (events to the operator window, close handlers, the
  native surface) for as long as browser mode is open.

Asked with those facts, the owner chose **wry views built directly on the
windows' native views**: the same place on screen, no `unstable`, no change to
any existing window. A page browsed there also gets no Tauri IPC script at all,
where a Tauri child webview gets `__TAURI_INTERNALS__` and relies on the ACL
refusing remote origins.

### What moved (`fb91402`)

- `services/browser_mode/rules.rs` — the pinned rules, with the JavaScript
  tests' cases
- `services/browser_mode/mod.rs` — `BrowserMode`: the service's steps in its
  order, against a `Host` trait standing for what a `BrowserView` did. Tested
  step by step against a fake host (enable, bounds, navigate, history, the
  projection, the poll, the preview, the views' own requests)
- `services/browser_mode/view.rs` — `WryHost`. The views live in a main-thread
  thread-local; every operation is posted there, and every wry callback only
  sends a `Signal`, answered off the main thread, so nothing re-enters them
- `services/browser_mode/view/native.rs` — per platform: building on the
  window's view, the history buttons' state, the snapshot
- `commands/browser_mode.rs` and the eleven bridge entries

| Electron | Here |
|---|---|
| `mainWindow.setBrowserView` | wry `build_as_child` on the operator window's content view (macOS: the parent of Tauri's WKWebView, because the window handle names a view wry has already replaced); a `gtk::Fixed` in an overlay over the window's webview (Linux); the window's HWND (Windows) |
| `partition: 'persist:present-browser-mode'` | a WebKit data store of its own on macOS 14+, the shared default store before that; a data directory of its own on Windows and Linux |
| `executeJavaScript` for the scroll position | `evaluate_script_with_callback`, with a script built from operators only, reading a non-finite value as 0 — the page can redefine `scrollX`, and wry's macOS bridge aborts on a value JSON cannot hold |
| `capturePage` | `takeSnapshotWithConfiguration` (WebKit crops and scales, so only a preview-sized image crosses); `CapturePreview` (WebView2); `webkit_web_view_get_snapshot` (WebKitGTK). Scaled and encoded off the main thread |
| `getURL`, `getTitle`, `canGoBack`, `isLoading` | read from the native view. Not wry's `url()`: it unwraps WKWebView's URL, which is nil until a page commits, and panicked the app the first time it ran |
| `did-navigate-in-page` | wry has no such event; each poll compares the URL |
| `will-navigate` refusing anything but http(s) | a navigation handler refusing the same — except that wry asks about frames too without saying which, so a frame's own `about:`, `data:` and `blob:` stay allowed |
| `before-input-event` for ⌘L / Ctrl+L | a capture-phase listener in the page, trusted events only, over wry's IPC |
| `setWindowOpenHandler` | a web address loads in the same view, as before |
| `outputWindow.on('resize' \| 'closed')` | the audience window's `Resized` and `Destroyed` |

**Deliberately different:**

- an identical preview is not sent again; Electron sent one every 180 ms
- a `window.open` of anything but a web address is refused. Electron handed it
  to the system, which lets any page open any URL scheme; the app's own
  `open_external_browser` already opens only http and https
- `browserNavigate` answers once the page stops loading or after 30 s, with the
  state. Electron's `await loadURL` threw on a failed load, which the panel does
  not catch
- a snapshot that has not finished in 3 s is abandoned, so a hidden window
  cannot stop the preview for good
- the audience view is not background-throttled, as for the audience window

**wry is pinned to `=0.55.1`**, the version Tauri resolves; a test fails if the
lockfile ever holds a second wry.

**Verified in the running app (macOS)**, against a local test server:

- the operator window stayed a webview window with browser mode open:
  `list_open_windows` listed `main`, then `main` and `output`
- a page loaded, titled, and answered in 309 ms; back, forward and reload
  reported the right page, title and history state
- a page scrolling itself to 400 was mirrored into the state; the preview
  arrived at 360×225 — the 800×500 viewport's shape — and showed that part of
  the page
- in the page: `window.__TAURI_INTERNALS__` undefined; `location.href =
  "file:///etc/hosts"` refused; a synthetic ⌘L ignored; `window.ipc`'s
  focus-address message delivered once; `window.open("mailto:…")` refused;
  `window.open` of a web address loaded it in the same view
- a search went to Google, which answered with its consent page
- projecting opened the audience window with the page at 1920 wide, scrolled to
  400 to match; back to the preview removed the view and left the window open,
  as Electron does
- disabled, no state events arrived; suggestions with no local web app came
  back empty, as Electron's did
- the first run's panic in wry's `url()` was written to the error log by the
  panic hook (§7), stack and all

**Checked, not run:** the Windows and Linux modules pass
`clippy --all-targets -D warnings` cross-compiled with §8's recipe, and a planted
error in each fails its check.

**Not verified:** a real keypress of ⌘L in a page; anyone using the panel by
hand; the preview while the operator window is hidden; a page that never
finishes loading; either platform other than macOS; macOS before 14, where the
data store is shared with the app.
