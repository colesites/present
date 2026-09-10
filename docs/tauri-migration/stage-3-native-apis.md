# Stage 3 — Native APIs

**Status:** complete · **Date:** 2026-09-10

Filesystem, dialogs, deep links, global shortcut, menus and permissions. The
stage gate was closing the `local-media://` scope, and it is closed.

This is also the stage where the React tree first talks to the Rust core at
all. Everything before it ran beside the UI; this one connects them.

## 1. The gate — `local-media://` reads any file on disk

`protocol.service.ts:137-145` takes the URL pathname and passes it to `fs.stat`
and `fs.createReadStream` with no check of any kind. Any script running in the
renderer can read every file the operator can read. Same for the file commands:
`file.ipc.ts` hands its arguments to `node:fs` unvalidated.

That is known-issues §3, and it is the reason Stage 3 leads with the
filesystem.

### The rule

A path is reachable only from inside a directory the operator chose in a dialog
they saw. There are exactly two ways a directory gets in
(`services/file_scope.rs`):

| Grant | Comes from | Survives a restart |
|---|---|---|
| `Media` | a folder added in the Media panel | yes |
| `Session` | a file or folder picked in a native dialog | no |

Nothing else. There is no setting that widens it and no command that admits a
path without a dialog.

Picking a *file* admits its folder rather than the file alone. The webview asks
for more than the file itself — a video is fetched in ranges and re-fetched
whenever the surface showing it remounts — and narrowing the grant to one path
would mean tracking every derived request. The operator browsed to that folder;
that is the consent.

### Why canonicalisation, not string comparison

Every path is resolved with `fs::canonicalize` before it is compared, and the
comparison walks path components rather than matching a prefix. Four escapes
that a naive check lets through, each with a test:

- `..` out of a media folder
- a symlink inside a media folder pointing at `~/.ssh`
- `/Volumes/Media-old`, which *string*-prefixes `/Volumes/Media`
- a rename whose "new name" is `../elsewhere.mp4`

Canonicalisation is also required in the other direction: on macOS a dialog
returns `/tmp/...` for what is really `/private/tmp/...`, and a root stored
unresolved would match nothing at all.

A path that does not exist yet — a copy target, a new folder — is resolved as
far as its deepest existing ancestor, and that ancestor is what is checked. A
`..` in the part that does not exist is refused rather than collapsed: there is
no legitimate caller, and collapsing it lexically is the mistake this module
exists to avoid.

### Verified against the running app

Reasoning about a security boundary is not evidence. The boot probe asks the
webview itself, and mirrors the answer into the Rust log because a Tauri
webview's console cannot be read from a terminal:

```
readFolderOutsideScope = denied
localMediaOutsideScope = 403
localMediaInsideScope  = 206, Content-Range: bytes 0-15/57
```

The refusal appears in the Rust log as `/private/etc/passwd` for a request
naming `/etc/passwd`, which shows the symlink was resolved before the check
rather than after.

## 2. Serving media without a stream

Electron streams: `fs.createReadStream` into a `Response`. A Tauri
custom-scheme response is a `Vec<u8>`, so a 4 GB service video cannot be handed
over in one piece.

Every response is capped at 8 MiB. A range request is truncated to that; a
request with no `Range` header is served whole below 16 MiB and as a 206 first
chunk above it. Both webviews follow up with ranges — that is how media
playback works regardless — and an `<img>` never hits the threshold.

Two departures from the Electron behaviour, both bugs rather than design:

- **`bytes=-500` is parsed.** Electron's `parseInt(parts[0])` yields `NaN` for
  the suffix form and emits a nonsense `Content-Range`. Reading the tail is how
  a player finds the `moov` atom of an MP4 that was not faststart-encoded.
- **A multi-range request is declined** with 416 rather than half-answered.

An unsatisfiable range returns 416 with `Content-Range: bytes */N`. Returning
404 there puts a media element into a retry loop.

### CORS, found by running it

A custom-scheme response carries no `Access-Control-Allow-Origin`, so `fetch`
could not read one from either origin the app has — `http://127.0.0.1:5173`
under `tauri dev`, `tauri://localhost` packaged. Media elements were unaffected,
which is exactly why this would have been found late.

The responses now say `Access-Control-Allow-Origin: *` and expose
`Content-Range`. That opens nothing: every response has already passed the
scope check, and no other application can reach the scheme.

### URL shape

`local-media://media/absolute/path`, unchanged from Electron, so the React code
that builds these URLs did not have to change. WebView2 does not resolve custom
schemes, so a Windows build uses the `http://local-media.localhost/media/...`
form wry rewrites them to. `createLocalMediaUrl` in `src/shared/lib/` and
`url_for` in `services/media_protocol.rs` are twins and must stay that way.

One difference from `encodeURI`: `#` and `?` are escaped in the Tauri path. Left
raw they truncate the URL, so a file called `Set #2.mp4` is unplayable — true in
the Electron build today, and left true there per migration rule 4.

## 3. Media folders move into Rust

Under Electron the folder list lives in the renderer's IndexedDB and the scope
does not exist. Owning the list in Rust is what lets the scope survive a
restart at all, and it removes one instance of known-issues §2: a list kept in
origin-partitioned web storage starts empty in every new build, and Tauri is a
sixth origin.

A folder on a drive that is not mounted at launch is remembered but not
admitted, and is re-admitted the first time a request for it is refused. Losing
an operator's media folder because a USB stick was unplugged is not acceptable;
paying a canonicalisation on the failure path only keeps the common path to one
lock.

## 4. The rest of the stage

**Dialogs** (`services/dialog.rs`) — the eight `dialog.show*` calls, filters
unchanged. `select_library_import_source` is new: `LibrariesPanel` reuses
`selectFolder` under Electron, which would now add a bundle to the Media panel
as though it were a folder of videos.

`select_presentation_files` returns base64 rather than Electron's `Uint8Array`.
A JSON array of numbers costs roughly seven wire bytes per file byte and a deck
is tens of megabytes; the bridge decodes it before the UI sees it, so the type
the React side consumes is unchanged.

**Menu** (`services/app_menu.rs`) — item for item, including `Cmd+,` and
`Cmd+O`. Two items have no Tauri equivalent and are gone: `pasteAndMatchStyle`,
and the macOS Window menu's `front`. The View menu keeps `togglefullscreen`;
Tauri has no `reload`/`forceReload`/`toggleDevTools` roles.

**Global shortcut** (`services/shortcuts.rs`) — `Control+Alt+Space`. The plugin
reports both key edges where Electron reports one, so the release is dropped;
forwarding both would toggle the operator panel open and shut on every press.

**Deep links** (`services/deep_link.rs`) — `present://`, parsed exactly as
`main.window.ts:34-52` parses it, including both spellings of each token
parameter. A link can launch the app, so it arrives before any webview exists:
Electron re-fires on `did-finish-load`, which guesses when React attached its
listener. Here the link is held in Rust and collected by the frontend as it
subscribes, and reading it clears it — a sign-in must not replay. Windows and
Linux deliver links as a second launch, so a single-instance lock is what makes
them arrive at all; without it a link would start a second copy of Present,
with a second audience window.

**Permissions** (`services/permissions.rs`) — AVFoundation, same three outcomes
and the same strings as `systemPreferences`. Status can now be read without
prompting, which Electron could not do. The webview prompts on its own the
first time `getUserMedia` runs; what these add is the ability to ask before
showing UI that depends on the answer, and to tell "denied once, never prompts
again" from "not asked yet".

## 5. The bridge

`src/renderer/tauri/electron-bridge.ts` installs a `window.electronAPI` backed
by `invoke`, so 208 files of React keep calling what they already call. It is
temporary by design: each entry goes away when its subsystem moves to a Rust
state slice.

Anything not implemented reads as `undefined` — which is what the feature
checks scattered through the UI already test — and reports itself once into the
Rust log. Running the app produced the inventory:

| Missing channel | Owed by |
|---|---|
| `sendToOutput`, `sendToStage`, `onStageReady`, `onMiniLyricsSaveRequest` | Stage 4 |
| `getStoredAuthSession`, `consumePendingAuthToken` | Stage 7 (auth) |
| `listBundledBibles`, `fetchHostedBibleCatalog` | Stage 7 (Bible) |
| `reportRendererError` | Stage 7 (error reporting) |

Bridging Stage 2's window and display commands surfaced a gap in Stage 2
itself: `Display` had no `scaleFactor`, which the settings picker prints. It is
read from the monitor now.

Note that `Display.bounds` is physical pixels under Tauri and
device-independent pixels under Electron. On a scaled built-in display the
settings picker therefore reads differently between the two builds — 3840×2400
rather than 1920×1200. Physical is the more useful of the two for an operator
choosing an output resolution, and it is what the placement code already works
in, so it stays.

## 6. What is verified, and what is not

Verified by running the app:

- the scope refuses `/etc` by kind, and `/etc/passwd` through the media scheme
  with 403
- a granted folder serves a range request: 206, correct `Content-Range`,
  correct byte count
- media folders load from Rust persistence across a restart
- the application menu is installed and correct — `Present File Edit View
  Window`
- React mounts and reaches the native layer

Not verified — do not claim otherwise:

- **No dialog has been opened.** All eight need a human. `__presentFiles` on
  the operator window exposes each one for exactly that.
- **No `present://` link has been followed end to end.** The parser has tests;
  the OS registration and the Apple event have not been exercised, and the
  scheme is registered by the installer, so it needs a packaged build.
- **The global shortcut has not been pressed.**
- **No microphone or camera prompt has been shown.** Status reads work.
- **Nothing on Windows or Linux.** The `http://local-media.localhost` URL form,
  the single-instance lock and argv deep links are all untested there.
- **No library bundle has been exported or imported through the UI**, only
  through tests.

## 7. Test counts

191 Rust tests, 48 JS. The 87 added here are mostly the containment rule and the
range planner — the two pieces where being wrong is a security hole or a blank
audience screen.
