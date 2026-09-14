# Stage 7 — the remaining subsystems

**Status:** in progress. Bibles are on Rust, and the stage displays have a feed again. Fonts are next.

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
| Fonts | `getSystemFonts` · `getSystemFontFaces` · `pickFontFile` · `installCustomFonts` · `getCustomFonts` — on `window.fontAPI`, which Tauri does not install at all | next |
| AI Operator | `listAiOperatorTools` | |
| Speech | `requestAssemblyAiToken` | check: Stage 3 moved the transport as `request_speech_token` |
| PPTX | `openFile` · `parseFile` — on `window.pptxAPI`, likewise not installed | the Rust parser |
| Browser mode | `setBrowserModeEnabled` · `setBrowserModeBounds` · `browserNavigate` · `browserBack` · `browserForward` · `browserReload` · `setBrowserProjectionTarget` · `getBrowserModeState` · `fetchBrowserSuggestions` · `onBrowserModeStateChanged` · `onBrowserFocusAddress` | child webviews |
| Stage displays | `onStageData` · `onWorshipStageData` (`onOutputData` is unused under Tauri) | **done**, §4 — they were blank |

Plus two known issues assigned here: §5 (`vosk`, never imported) and §10 (no
webview crash recovery on Windows and Linux), and error reporting, whose
renderer half is bridged into the Rust log but whose redacting ndjson log is
still Electron's.

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
