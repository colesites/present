# Stage 4 — The presentation core into Rust

**Status:** complete · **Date:** 2026-09-10

Moving the state that decides what the congregation sees out of React and into
Rust, one slice at a time. The gate is characterisation tests written against
the running Electron build before anything moves, and that gate is met.

**The milestone this stage has already reached:** the Tauri build renders the
whole operator UI. Before it, the window mounted React and showed nothing.

## 1. The gate — characterisation first

Two suites, both written before any code moved.

**The audible-video guard** (`tests/single-audible-video.test.mjs`). Exactly one
`<video>` in the app may make a sound — the presenter Show View. The other
fourteen are muted mirrors, and that invariant is held by hard-coded attributes
across nine files rather than by anything structural (audit §5.3). One new
element that forgets `muted` and the congregation hears the video twice, a
fraction of a second apart.

The test scans the JSX, classifies every `<video>` by whether it can ever be
audible, and fails with file and line if more than one can. It was confirmed to
fail before it was trusted: adding an unmuted element reports `Found 2` and
names it.

**The output layer flags** (`tests/looks-config.test.mjs`, 25 cases). Extracted
from `useLooksConfig.ts` into `shared/lib/looks-config.mjs` the same way
`display-selection.mjs` was extracted in Stage 2 — the hook imports it, so the
tests pin what actually runs rather than a copy. The clock and id generator are
injected, so the suite is deterministic and the Rust port has no `Date.now()` to
reproduce.

## 2. Slice one — output layer flags

Chosen first because of how they travel, not how big they are.

Two windows agree on these flags through `localStorage`, which fires no event in
the window that wrote it, so the operator window **polls every 400 ms**. A layer
the operator toggles can take that long to reach the audience screen, and two
windows writing in the same tick lose one of the writes silently. That is
known-issues §12.

`services/looks.rs` is the reducer, ported case for case; 28 Rust tests mirror
the 25 JS ones. `LooksState` persists to `looks.json` and reads it back through
the same forgiving normaliser the JS uses, so a file written by either side is
understood by both.

Two refusals to carry a bug across: a NaN percentage becomes 0 rather than
reaching the layout, and the layers are a struct with a field per layer rather
than a map, so one cannot go missing.

`useLooksConfig` keeps its exact signature — no component changed. Under Tauri
it subscribes to `looks:changed` and holds no authoritative state of its own.

Verified in the running app: `changeEvent=delivered`.

## 3. Slice two — the auth session

Pulled ahead of Stage 7, deliberately. Nothing after it could be *seen* working:
the operator window mounted React, reached the native layer, and rendered
nothing while it waited for a session the Tauri origin does not have.

The flow is unchanged — sign-in in the user's own browser, session returned over
a `present://` link. What changed is where the session is kept. Electron writes
`desktop-auth-session.v1.json` when packaged and `…dev.v1.json` when not, so a
developer machine holds two sessions and which one you get depends on how the
app was launched. That is half of known-issues §2 and the cause of "sometimes
when I open the app I am signed out".

There is now one session, in the OS keychain. A session found in a file is moved
into the keychain on first read, and only then is the file removed. Linux keeps
the file at `0600` — the position Electron is in when `safeStorage` is
unavailable — because the keychain crate's Linux backend needs libdbus at build
time, and adding a system dependency to a CI bundle for a platform this build
has never run on is not a trade to make blind.

Two things worth noting beyond the port. `open_external_browser` now refuses
anything that is not http or https; under Electron it went straight to
`shell.openExternal`, which will open a `file://` path. And an earlier version of
`AuthState` chose keychain-or-file per call, and its own test suite wrote a fake
session into the developer's login keychain — the backend is an explicit field
now, so a test is structurally unable to reach it.

## 4. Slice three — the audience scene

The one the audit is most explicit about: the `send-to-*` channels "are not an
API — they are a symptom of state living in the wrong process and must be
replaced by Rust-owned state and typed events, not renamed".

What they do today explains the shape of the fix. `useOutputBroadcast.ts` builds
four partial payloads from React state, `JSON.stringify`s each to compare with
the last, and forwards the changed ones through a main process that relays
`unknown`. The receiving window then **merges those partials into its own React
state**. So the authoritative scene exists nowhere: it is split between a sender
that knows what it last sent and a receiver that knows what it accumulated, with
nothing to reconcile them.

There is now one `OutputScene`. The operator sends updates, Rust merges, every
surface receives the whole scene and renders it.

| Consequence | Before | After |
|---|---|---|
| Late join | `output-ready` travels to the operator window, which re-sends everything | the new window asks for the scene |
| Change detection | `JSON.stringify` of four payloads on every React render | one structural comparison |
| Targets | `sendToOutput`, `sendToStage`, `sendToWorshipStage` | one call; each surface decides what to draw using the looks config |

The rules that matter during a service are ported with tests. An empty slide
arriving while text is showing does not blank the screen — that transient
happens as the operator moves between items, and obeying it shows an empty frame
to the congregation. `shouldSyncTime` is excluded from change detection, as it
is from the Electron signature: it flips at 10 Hz while a video plays.

**Freeze now differs from Electron, on purpose.** The Electron effect returns
early on the render that *clears* the freeze as well as on every frozen one, so
unfreezing alone sends nothing and the audience screen keeps the frozen content
until something unrelated triggers the effect. That is known-issues §11.
Unfreezing here broadcasts the scene the operator arrived at.

**Where the typing stops.** Rust types everything it reasons about — flags, the
media reference, playback position, overlays, styles. Slide *elements* and the
screen-composer layout are carried verbatim, because nothing in Rust inspects
them until the wgpu compositor has to draw them (ADR-001, Stage 5). That is not
the opaque relay this replaces: they are typed fields of a typed scene, and the
day the compositor needs them is the day they get a struct.

## 5. Slice five — the mini lyrics round trip

The last relay this stage owns. A small window edits one item's lyrics and
cannot do the save itself: the write goes through Convex and the offline queue,
both of which live in the operator window's React tree.

Electron does it with four channels and a map of pending callbacks keyed by a
generated string (`window.ipc.ts:142-190`). Here it is two commands and one
event, and the `mini-lyrics:ready` handshake is gone — the editor asks what it
is editing, the same way a late-joining output window asks for the scene. That
closed a gap as well as moving one: the Rust payload previously carried only
the id and the title, so under Tauri the editor had nothing to edit.

The ten-second timeout is kept. An operator who has typed a verse and hit save
needs an answer either way.

## 6. What is verified

By running the app, not by reasoning:

- the operator UI renders in full under Tauri — services, media panel, audience
  preview, timers, toolbar, menu
- **zero renderer errors** on a clean launch, where the same build previously
  threw on `sendToOutput`
- the three live gates hold on every launch:

```
localMediaOutsideScope = 403        the Stage 3 file scope
changeEvent            = delivered  a looks toggle reaching another window
navigateWithoutDeck    = refused    slide navigation bounded, not guessed
```

- the layer defaults come back byte-identical to the JS ones
- everything Stage 4 owns is bridged; what the UI still reaches for and does not
  find is Bible (Stage 7) and NDI (Stage 6)
- Electron still packages

Not verified:

- **No service has been run through it.** No slide advanced, no video played, no
  audience window opened onto a second screen. This is the big one: the code
  paths are exercised by tests and by startup probes, not by use.
- The output window and both stage displays render the Rust scene in code and
  have not been opened.
- Freeze and unfreeze have not been exercised by hand.
- The mini lyrics editor has not been opened, so its save round trip is
  untested outside its unit tests.
- Nothing on Windows or Linux.

## 7. What the stage did not move, and why

`PresentContainer.tsx` still holds most of its sixteen `useState` hooks, and
that is the intended outcome rather than an unfinished one. Only a handful of
them describe *the presentation*; the rest are view state — whether the grid is
showing, what the edit panel scrolled to, which import dialog is open. Moving
those would be moving UI into the core for nothing, and the audit's own warning
about the ~44 000 lines (§10.4) is a warning against exactly that.

What was moved is the state that decides what the congregation sees, plus the
position that decides what comes next. The prop chains the audit worried about
were not rewritten, because the adapter pattern meant they did not have to be:
every hook kept its signature.

Two things landed here out of stage order, both because the alternative was
working blind. `reportRendererError` reaches the Rust log — the call site is
optional-chained, so under Tauri every render failure was vanishing in silence
and the blank window could not be diagnosed at all. And the auth session moved
early, because nothing after it could be seen working.

## 8. What Stage 5 inherits

- `OutputScene` is the serialisable output state ADR-001 requires. The wgpu
  compositor draws *that*, and the two fields carried verbatim today — slide
  elements and the screen-composer layout — are the ones it will need to type.
- The single-audible-video guard is in place and proven to fail correctly. It
  is what stops the media rewrite reintroducing audience echo.
- `PresentationPosition` already answers "which deck, which slide", so the
  media engine has something to ask.
