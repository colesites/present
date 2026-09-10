# Stage 4 — The presentation core into Rust

**Status:** in progress · **Date:** 2026-09-10

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

## 5. What is verified

By running the app, not by reasoning:

- the operator UI renders in full under Tauri — services, media panel, audience
  preview, timers, toolbar, menu
- no renderer errors at all, where the same build previously threw on
  `sendToOutput`
- a looks toggle applied in Rust reaches a subscribed window as an event
- the layer defaults come back byte-identical to the JS ones

Not verified:

- **No service has been run through it.** No slide advanced, no video played, no
  audience window opened onto a second screen.
- The output window and both stage displays render the Rust scene in code and
  have not been opened.
- Freeze and unfreeze have not been exercised by hand.
- Nothing on Windows or Linux.

## 6. What is left in Stage 4

The presentation state itself — `PresentContainer.tsx`'s sixteen `useState`
hooks and the service, item and slide navigation around them. That is the
~44 000 lines the audit warns about (§10.4), and the AI Operator's existing tool
catalogue (`next_slide`, `previous_slide`, `go_to_slide`, …) is already the
command surface it should become.

`reportRendererError` also landed here, out of order, because without it the
blank window could not be diagnosed at all: the call site is optional-chained,
so under Tauri every render failure vanished in silence.
