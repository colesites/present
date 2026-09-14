# Stage 7 — the remaining subsystems

**Status:** in progress. Bibles, fonts, the AI Operator's tool list and the error log are on Rust, and the stage displays have a feed again. Next: the remaining browser-storage settings, `vosk`, and crash recovery off macOS; then the PPTX parser and browser mode.

The audit's content for this stage is Bible, fonts, the PPTX importer, auth,
the AI Operator, error reporting and settings; its gate is a parity checklist.
Auth's session and refresh moved in Stage 4.

---

## 1. Decisions, by the owner (2026-09-14)

| Question (audit §13) | Answer |
|---|---|
| PPTX: ship Python as a sidecar, or port the parser? | **Port `parse_pptx.py` to Rust.** No machine needs Python; no installer grows by 40 MB. |
| Browser mode: unstable child webviews, a separate window, or defer? | **Tauri's unstable child webviews**, so browser mode stays inside the operator window. Pin the Tauri version and re-test browser mode on every upgrade. |

## 2. What is still on Electron

The bridge reports every `electronAPI` call it does not have. Against
`preload.ts`, 26 methods at the start of the stage:

| Subsystem | Methods | Slice |
|---|---|---|
| Bible | `listBundledBibles` · `readBundledBible` · `fetchHostedBibleCatalog` | **done**, §3 |
| Fonts | `getSystemFonts` · `getSystemFontFaces` · `pickFontFile` · `installCustomFonts` · `getCustomFonts` — on `window.fontAPI`, which Tauri did not install at all | **done**, §5 |
| AI Operator | `listAiOperatorTools` | **done**, §6 |
| Speech | `requestAssemblyAiToken` | **not needed**, §6 — nothing calls it |
| PPTX | `openFile` · `parseFile` — on `window.pptxAPI`, likewise not installed | the Rust parser |
| Browser mode | `setBrowserModeEnabled` · `setBrowserModeBounds` · `browserNavigate` · `browserBack` · `browserForward` · `browserReload` · `setBrowserProjectionTarget` · `getBrowserModeState` · `fetchBrowserSuggestions` · `onBrowserModeStateChanged` · `onBrowserFocusAddress` | child webviews |
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
