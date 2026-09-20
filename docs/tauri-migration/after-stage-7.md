# After Stage 7 — the owner's crate list, and FFmpeg

Work done after Electron was removed (HANDOFF §4), in the order the owner
asked for it. Each section says what was built, how it was checked, and what was
not.

## 1. Log files and frame-time benchmarks — `d702389`

**Log files** (`tracing-appender`, `services/log_files.rs`). Every line the
terminal shows also goes to a file per day in the folder Tauri uses for app
logs (`~/Library/Logs/space.multivrs.present` on macOS), and the last fourteen
are kept. Before this, a service left nothing behind but the redacted error
log, which records the error and none of what led to it. Lines are written
synchronously, because the app exits without unwinding and a buffered writer
would lose the last ones.

**Benchmarks** (`criterion`, `benches/frame_time.rs`).
`cargo bench --bench frame_time --profile perf` measures a 1080p audience frame
drawn from generated media, so it runs anywhere. On the development Mac:

| Frame | Time |
|---|---|
| Slide drawn from nothing | 23.7 ms |
| Cached slide over a playing video | 5.4 ms |
| Frame to BGRA for NDI | 1.8 ms |

NDI's budget is 33.3 ms.

## 2. Media folders that update live — `8bc25a9`

`services/media_watch.rs` watches every media folder (FSEvents on macOS,
ReadDirectoryChangesW on Windows, inotify on Linux). Once a burst of changes
has been quiet for 300 ms, it emits `media:folders-changed` and the panel
re-reads. Five quick writes produce one or two announcements, not five. A
re-read keeps the current items on screen instead of flashing the loading
state.

**Found on the way:** the panel kept its folder list in IndexedDB, while Rust
kept its own in `media-folders.json`. Removing a folder in the panel never
told Rust, so the app could still read that folder, and each build had its own
list. The panel now uses Rust's list. Creating or renaming a folder registers
it through `add_media_folder`, which accepts only a path the app may already
read.

**Verified in the app** with a scratch folder, removed afterwards: a copied
file appeared in the panel 120 ms after the event and disappeared when deleted,
with no empty frame in between. **Not run** on Windows or Linux.

## 3. OpenLyrics import — `41e657b`

OpenLyrics is the format OpenLP, Quelea and others export. The Libraries
panel's import button now offers it beside Present's own library export.

`services/openlyrics.rs` (`quick-xml`) reads a song into:

- a title
- its credits: words, music and translation authors, each listed once
- copyright and CCLI number
- a body in the lyrics editor's own form: a `[Verse 1]` header over each
  slide, verses in the song's `verseOrder` with repeats, and a verse split
  into several `<lines>` as one slide per part

Chords, comments and instrumental sections are left out, and a translated
verse keeps its first language. A file that is not an OpenLyrics song, is cut
off, or has no title is refused with a message, and the other files still
import.

**Verified:** the parser's cases in unit tests. In the app, the library's own
slide builder read a parsed body into the five labelled slides expected.
**Not verified:** picking files in the dialog by hand.

## 4. FFmpeg decodes video — `f18c37c`, `4678b77`, `bf486f6`, ADR-003

`services/video/ffmpeg.rs` decodes for the compositor, the NDI stream, the
native audience surface and thumbnails, on every platform. The reasoning and
measurements are in [ADR-003](adr-003-ffmpeg-video-decode.md). In short:

- **GPU first:** VideoToolbox, D3D11/DXVA2 or VA-API. **Software, on every
  core, when the GPU turns a file down.** That is settled on the first frame,
  at open, and a GPU failure mid-file carries on in software from the next
  frame.
- **Colour:** the file's own matrix and range, or BT.709 from 720 lines up /
  BT.601 below, limited range unless it is a `yuvj` format.
- **Frames:** BGRA at the requested size. On macOS a larger GPU frame is
  shrunk on the GPU (`scale_vt`, `gpu_scale.rs`) before it is copied off. A
  GPU frame at the right size is split into planar YUV for swscale's fast path.
  Anything else is scaled with bilinear swscale sliced across every core.
- **Decoding ahead** (`read_ahead.rs`): a worker keeps two frames ready. The
  NDI stream and the native surface take what is ready
  (`VideoDecoder::poll_frame`) and never wait once a frame is on screen.
- `PRESENT_VIDEO_SOFTWARE=1` rules the GPU out, for diagnosis.

**What the first version did to the NDI stream** (known-issues §22): with a
4K background it fell to 2 fps, because the stream waited for each frame and
FFmpeg's GPU decode, copy and CPU shrink took longer than a frame. With the
three changes above, the stream holds 30 fps at 4K. The video inside it runs
at 25–27 fps on this Mac and drifts up to half a second behind before a seek
catches it up; AVFoundation kept 4K within 15 ms. At 1080p FFmpeg matched
it in two runs of three; the third, on a busy machine, showed 17 fps of
video.

**Tests** write their own clips with FFmpeg's encoders and delete them:

- colour for undeclared HD and SD and for a declared matrix and range,
  including scaled, on lossless FFV1
- seeking between key frames on MPEG-4 Part 2, which this Mac's GPU refuses,
  so it covers the software path
- the same seek test on H.264 from the Mac's own encoder, which covers the GPU
  path (a CI virtual Mac may run it in software)
- a GPU frame shrunk on the GPU, to an even and an odd size, keeping its
  colour
- the NV12 split, at an odd size
- the end of a clip staying the end until a seek
- a missing file reported as not found
- decoding ahead (`read_ahead.rs`, against a fake decoder): order, the end,
  nothing decoded before a seek handed out, errors, only two frames ahead,
  polling without waiting, and the worker stopping when dropped
- the feed (`video_feed.rs`): the last frame stays up while the decoder is
  behind, a seek on its way is not repeated, and a new seek replaces it

**Compared with AVFoundation**, before it was removed, on five of the
owner's files (`examples/decoder_compare.rs`, in `4678b77`), and end to end on the NDI stream
(`examples/ndi_stream_probe`, which now also reports how many video frames
reached the stream and how far behind the clock they were). Colour matches.
Seeks land on the same frames. FFmpeg also decodes the two 4:2:2 files
AVFoundation calls "Cannot Decode". The tables are in the ADR.

**Checked for Windows and Linux from macOS:** `clippy --all-targets -D
warnings` passes for both targets. The stage-7 §8 recipe now needs FFmpeg's
headers for the bindings, too:

- `FFMPEG_DIR=$(brew --prefix ffmpeg)`
- `BINDGEN_EXTRA_CLANG_ARGS_<target>="-isystem $(xcrun --show-sdk-path)/usr/include"`
- for Windows, also `-D__GNUC__=4` (so Darwin's headers use the compiler's
  `va_list`) and `-include` of a header that typedefs `ssize_t` as `long long`
  (Darwin's `long` is 4 bytes under Windows' type sizes)

**Where FFmpeg comes from** is §5: the bundles carry their own.

**Not done:**

- **4K on a slow machine.** FFmpeg's GPU decode waits for each frame and
  runs in turn with the copy and colour conversion. Running decoding and
  conversion on separate threads would help, and wgpu would remove the copy
  and conversion.
- ~~Opening a video still waits~~ — fixed in `7cb78fc` (§6).
- **MKV, AVI and WebM** are still refused, because the operator's windows play
  video in WebKit. Converting on import would lift that.

## 5. The FFmpeg the bundles carry

Present ships FFmpeg, so it must ship one it is allowed to: **LGPL 2.1, as
separate shared libraries, built from the pinned upstream source**. A
distribution's FFmpeg will not do — Homebrew's and Ubuntu's are GPL builds.

`scripts/build-ffmpeg.sh` builds it, into `src-tauri/ffmpeg/` (git-ignored,
with a README):

- FFmpeg **9.0.1**, downloaded from ffmpeg.org and checked against a pinned
  SHA-256 — the same one Homebrew's formula records for that release.
- `--disable-autodetect --disable-gpl --disable-nonfree --disable-version3`,
  shared libraries only. Nothing outside FFmpeg is linked, so no external
  library can bring a licence in unnoticed. The script reads FFmpeg's own
  `config.h` afterwards and stops unless it says `LGPL version 2.1 or later`.
- Only what the app uses: every decoder, demuxer and parser; the platform's
  GPU decoder (VideoToolbox, D3D11 and DXVA2, or VA-API); swscale; `scale_vt`
  and its filter graph on macOS. A few encoders and one muxer stay because
  the decoder's tests write their own clips. 16 MB on this Mac.
- The libraries are named so they can be found next to the app:
  `@rpath/…` on macOS, `$ORIGIN` on Linux. `build.rs` adds the matching search
  path — `Contents/Frameworks` and `lib/present-ffmpeg` — and a build that
  bundles never records the build machine's own path.
- x86 needs `nasm` for FFmpeg's assembly. Without it the script stops, unless
  `PRESENT_FFMPEG_NO_ASM=1` asks for a slower build for trying the packaging
  out. That build must never ship: swscale's fast conversion rounds a level
  further down without assembly, and software decoding is much slower.

`scripts/stage-tauri-ffmpeg.mjs` copies the libraries into
`src-tauri/ffmpeg/runtime/` and the licence notices into
`src-tauri/ffmpeg/licenses/`, and refuses a build that does not describe
itself as LGPL. It also checks that the platform's bundle config still names
what it staged, so a new FFmpeg major version cannot quietly leave a library
behind. `tauri.macos.conf.json` lists the five libraries as frameworks,
`tauri.windows.conf.json` puts them beside the executable, and
`tauri.linux.conf.json` puts them in `/usr/lib/present-ffmpeg` in the `.deb`,
the `.rpm` and the AppImage, with `libva` as a dependency.

`scripts/tauri-build.mjs` is what `bun run desktop:tauri:build` now runs: build
FFmpeg if the pinned build is not there, stage it, then `tauri build` with
`FFMPEG_DIR` pointing at it. Development still builds against whatever FFmpeg
the machine has, so a first run needs no FFmpeg build; `tauri:ffmpeg` builds
and stages without bundling, and `FFMPEG_DIR=…/ffmpeg/prefix cargo test` runs
the tests against the build that ships.

**The app says which FFmpeg it loaded**: version and licence, the first time
it decodes anything. A release build that somehow loaded a GPL one logs an
error. `PRESENT_EXPECT_LGPL_FFMPEG=1` makes a test fail on it instead, which
is what CI sets.

**What the licence obliges**, beyond the build being LGPL: the notices travel
with the app (`COPYING.LGPLv2.1`, FFmpeg's `LICENSE.md`, and a
`FFMPEG-SOURCE.txt` naming the exact source and configure line), the
libraries stay replaceable — they are separate files, not linked in — and
whoever receives the app can receive FFmpeg's source. **The source travels
with every build**: CI uploads `ffmpeg-9.0.1.tar.xz` beside the bundles, and
`scripts/check-ffmpeg-source.mjs` fails the build if it is missing or is not
the pinned release. The notices say so and name where else to ask for it, so
publishing the bundles anywhere else means publishing that file with them.

**Verified on macOS**, with a bundle built by `bun run desktop:tauri:build`
(`--bundles app`, and with `PRESENT_FFMPEG_NO_ASM=1` because this machine has
no `nasm`):

- `Contents/Frameworks` holds the five libraries, 16 MB.
- The executable asks for them as `@rpath/libavcodec.63.dylib` and friends,
  and its only search path is `@executable_path/../Frameworks`. No Homebrew
  path, and no path from the machine that built it, appears anywhere in the
  app.
- Launched, it loads all five from inside itself and none from anywhere else
  (`DYLD_PRINT_LIBRARIES`).
- A binary built the same way, in the same layout with those staged
  libraries and nothing else, opens the owner's 4K file, decodes 60 frames
  and seeks.
- `Contents/Resources/ffmpeg` carries `COPYING.LGPLv2.1`, FFmpeg's
  `LICENSE.md`, `FFMPEG-SOURCE.txt` and the notice README.
- The 770 Rust tests pass against this FFmpeg
  (`FFMPEG_DIR=…/ffmpeg/prefix`), as well as against Homebrew's 8.1.1.

**Not run:** the Windows and Linux bundles, and CI, which nothing has pushed
yet. Windows builds FFmpeg in MSYS2 from an MSVC developer environment; that
step, and Linux's VA-API build, have never executed.

## 6. The stream no longer stalls when a video starts — `7cb78fc`

Starting a video paused the NDI stream and the native audience screen. The
file was opened inside the stream's frame — and opening decodes the first
frame — and then the feed waited for the frame at the operator's position,
which after a seek is decoded from the key frame before it. A quarter of a
second at 1080p, a third of one at 4K, with the lyrics frozen too.

`video_feed.rs` now opens on a thread of its own and takes the decoder when it
is ready, and waits for nothing, not even a video's first frame: the
background is empty for the frame or two before it arrives. The opener became
owned and shareable, built once by each stream source from an `AppHandle`,
because a `State<'_, T>` cannot cross to that thread.

**Measured** (`examples/ndi_stream_probe`, 8 s, load average under 8, twice
each): not one frame over the 33.3 ms budget after the first, at 1080p or 4K,
where before there were 248, 105 and 60 ms frames at the start and 391 ms at
4K. The stream holds 29.8–30.1 fps; the video inside it runs 23–29 fps, 42 to
144 ms behind the clock.

## 7. Scripture references in Rust — `1e20ba7`

The panel has read "Genesis 1:2", "gen 1 2" and "turn to first John one two"
since the Electron build. `services/scripture.rs` reads them the same way, so
what does not come from the React tree can resolve a reference for itself — a
service item and the AI operator today, the pedals and the phone remote next.

`tests/fixtures/scripture-references.json` is the table both parsers answer to:
56 references over eight books, generated from the panel's parser so it pins
what the app does today, quirks and all (a chapter `0` reported as a missing
chapter, `1:2-2` as a range that does not go forwards, a version code taken
from trailing words). `nom` parses the chapter and verse grammar; the
normalising before it — ordinals, spoken numbers, "chapter" and "verse" — is
token replacement.

The one call that can wait a round trip, a service item's reference, reads it
in Rust. The panel still parses as the operator types, where an answer is
wanted on the keystroke; the shared table is what keeps the two agreeing.

## 8. Pedals, MIDI and OSC — `903d6d2`

One table of actions, two ways in, and the phone remote will be the third.
MIDI is what a booth's hardware speaks over a cable; OSC is what software and
newer consoles speak over the network.

- `services/control` holds the actions (next and previous slide, go to slide,
  next and previous item, the words, the media, the background, freeze, clear
  the media, go to a scripture reference), the bindings and the settings file.
  The core does what it owns — the slide position — and announces the rest as
  `control:action`, which `useControlActions` turns into the same handler a
  click reaches.
- **MIDI** reads notes, control changes and program changes. A note off does
  nothing, or a pedal would fire twice; a control change fires on the way down.
  Every port is opened unless one is named.
- **OSC** listens on a socket of its own. A button sending 0 on release does
  nothing. A slide number or a scripture reference is read from the message.
- Both are **off until set up**, in Settings → Connections. A MIDI binding is
  made by pressing the button, not by naming the note.

**Verified in the running app**, with real OSC packets from another process:
next slide, go to slide 12, the words, the media, freeze, clear, next item and
`"John 3:16"` all arrived and were acted on; a released button and an unbound
address did nothing. A temporary probe in the operator window (removed
afterwards) showed each action reaching it with the payload the hook expects.
**Not tried on hardware:** no MIDI device was plugged into this machine, so
`midir`'s port opening is covered by its tests and not by a pedal.

## 9. The stream's frame rate — `ceebe66`

Settings → Connections now offers 24, 25, 30, 50 and 60 fps for the NDI
stream, beside the source and group names. The rate travels to the sender,
which declares it on every frame, and to the send loop's pacing. Anything else
is refused rather than sent: a stream that declares what it cannot hold is
worse than one that runs slower than asked. The audience screen still follows
the monitor.

On this Mac a 4K background will not hold 50 or 60 — the GPU decode alone is
17–24 ms a frame — which the setting says next to the picker.

## 10. The phone remote — `867bb69`

The last of the ways in, and it rides the same action table as the pedals: a
phone press, a pedal press and a click are the same thing happening.

`services/remote` serves one page, built into the binary — a phone in a hall
with no signal has to be able to open it, and a remote that needs a download is
a remote nobody uses. It shows what is on the audience screen, has big targets
for one-handed use in the dark, and reconnects by itself after the phone
sleeps. Four routes: the page, the state, an action, and a socket that pushes
what is on screen when it changes (`axum`, whose sockets are
`tokio-tungstenite`).

**What keeps it safe on a church's open Wi-Fi:** it is off until switched on;
every request carries a 128-bit token from the operating system's randomness,
compared whole rather than character by character; the token is new each time
the remote starts, so a photograph of last Sunday's screen is not a way in; and
anything without it gets a plain 404, which does not admit there is a remote
there at all. Settings → Connections shows the code to scan and the address to
type. The name is announced over mDNS for whatever looks for it later.

**Verified against the running app:** the page, the state, an action and the
live socket all answered with the token; no token, a wrong one and a truncated
one each got 404; the action reached the core marked as coming from the remote.
**Not verified:** the mDNS announcement, and the page on a real phone.

**Found doing it:** macOS's firewall blocks incoming connections to the
development binary, so a phone cannot reach `bun run desktop:tauri` until it is
allowed — the server answers on localhost meanwhile, which is how this was
tested. A packaged, signed app asks the usual way.

## 11. Signing in stays signed in — `fa3f2b5`, `ccc0ab1`

The owner asked why signing in expires at all, when ProPresenter never signs
anybody out. Three things were wrong, and browser sign-in was not one of them
— that is what Claude, ChatGPT and ProPresenter do too. What those keep
afterwards is a credential of their own; Present kept a pointer to a browser
session.

**On the desktop** (`fa3f2b5`): it signed itself out on its own clock, in two
places — at startup, where a stored session past its date was deleted from the
keychain before anything was asked of the network, and online, where a token
request past that date signed out rather than asking. Both are gone. The rule
is `expiredSessionAction` beside the refresh policy: offline, the cached
identity stays and the operator keeps presenting; online, the server is asked;
only its 401 or 403 signs anybody out.

**On the server** (`ccc0ab1`): every refresh asked Clerk whether the browser
session that started this was still active, so Clerk's session lifetime was
Present's. The web app now mints the desktop's Convex token itself — RS256,
one hour, subject the Clerk user id that every Convex function reads — and
checks the account, not a session. Convex accepts it because the issuer is a
second provider in `auth.config.ts` and the key is published at
`/.well-known/jwks.json`.

**Signing a computer out** is a timestamp on the account,
`desktopSessionsRevokedBefore` in Clerk's private metadata: tokens issued
before it stop being renewed, and a desktop that cannot renew signs out within
the hour. Settable from the Clerk dashboard today; a button for it is a
follow-up.

**Turning it on** — it is inert until then, and the order matters, because a
token Convex does not know is a token every desktop is refused:

1. Make a key: `openssl genrsa -out desktop.pem 2048` then
   `openssl pkcs8 -topk8 -nocrypt -in desktop.pem -out desktop.pkcs8.pem`.
2. **Convex first:** set `DESKTOP_JWT_ISSUER_DOMAIN` to the web app's URL
   (`https://present.multivrs.space`) and deploy the backend, so the provider
   exists before any token claims it.
3. **Then the web app:** set `DESKTOP_JWT_PRIVATE_KEY` to the PKCS#8 file's
   contents and `DESKTOP_JWT_ISSUER` to the same URL, and deploy.
4. Check `https://present.multivrs.space/.well-known/openid-configuration` and
   `/.well-known/jwks.json` answer, the second with one key.
5. The desktop needs no change or release: its next refresh gets the new token.

Until step 3, Clerk's session is used exactly as before. **Not verified:** the
minted token against a real Convex deployment — the tests verify it the way
Convex does, with the published keys, but nothing here can deploy.

**The stop-gap**, if the owner wants the expiries to stop today without a
deploy: raise the session lifetime in Clerk's dashboard and turn off its
inactivity timeout. That helps the web app as well, and stops mattering for
the desktop once the above is on.

## 12. The library on this machine, in SQLite — `44f7fab`

The last of the owner's crate list. Everything the operator can open on a
Sunday — categories, library items, services, messages — is kept in
`library.sqlite3` beside the app's settings, written before anything is sent
anywhere and read back from there, so a hall with no wifi is an ordinary
Sunday and not a broken one.

**Why not the browser's own storage.** IndexedDB is per origin, and the app
has two (`stage-7-subsystems.md`): what the main window wrote, the output
window could not read. It is also cleared with the webview's data, it has no
transaction the two windows share, and a write interrupted halfway can leave
the library looking empty with nothing to say why. SQLite is one file on every
platform, bundled so no machine needs it installed, in WAL so the sync can read
while the operator writes, with `synchronous=NORMAL` and a five-second busy
timeout — a power cut costs the last write, never the library.

**The shape.** `services/store`: `documents` keyed by (workspace, kind, id),
holding the entity as it was written plus `updated_at` and a `version` that
goes up on every write, which is what a sync needs to tell which copy is newer.
`sync_queue` holds changes made here that Convex has not been told about, in
the order they were made. Migrations are `rusqlite_migration`, one so far, and
a test re-applies them to prove a second start is a no-op. Ids made here are
ULIDs: unique without asking anybody, sortable by when they were made, so two
machines offline never collide and a service keeps its order.

**How the React tree reaches it:** nine commands (`commands/offline.rs`) and
the typed bindings in `renderer/tauri/offline.ts`. Those field names are
written by hand on both sides, so a Rust test pins the wire shape — a rename
that was not made twice fails there instead of on a Sunday.

**Verified:** 814 Rust tests, clippy clean, and the running app creates the
database at startup — `PRAGMA journal_mode` is `wal`, `user_version` is 1, and
both tables and their indexes are there.

**Not done yet, and deliberately:** nothing reads it. The React tree still
uses the offline path it had, because the owner's uncommitted `localData.ts`
and `useOfflineSyncEngine.ts` are the files that would change, and those are
theirs. The Convex sync from Rust — backoff, `blake3` media hashes — is the
other half and is not built.
