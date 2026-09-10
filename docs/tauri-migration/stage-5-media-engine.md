# Stage 5 — the media engine and a single audio path

**Status:** in progress. The audio half is done and verified in the running
app. The compositor has not been started.

The stage the audit calls the highest-value, highest-risk work (§10.3), and the
one ADR-001 was written for. Its gate is an audio regression suite.

---

## 1. What the gate needed first

The suite that existed guarded one source class. `single-audible-video.test.mjs`
scans the fifteen `<video>` elements and proves exactly one of them can make a
sound, which is real and holds — but it scans for `<video>`, so anything that
reaches a speaker another way is invisible to it. Four things do:

| Route | Held by | Seen by the old guard |
|---|---|---|
| Backing tracks, `AudioTabPanel.tsx:134` | nothing at all | no |
| The audience YouTube prop embed | `mute=1` in a hand-edited URL | no |
| Speech capture → `audioContext.destination` | one gain node pinned to `0` | no |
| Captured HDMI streams via `srcObject` | the host element's `muted` | partly |

The second and third are worth stating plainly. A prop can put a YouTube embed
on the audience screen; it plays in a webview, so no `muted` attribute governs
it and its silence is one parameter in a list somebody edits by hand. And
speech-to-search connects the microphone to the audio destination — deliberately,
because a `ScriptProcessorNode` does not fire unless it reaches one — with a
single `silenceSink.gain.value = 0` standing between the operator's microphone
and the house speakers.

None of these were bugs. All of them were conventions that nothing checked.

`tests/audio-output-paths.test.mjs` is the other half of the gate: every
remaining route, pinned as it behaves today. These are characterisation tests in
the audit's §10.8 sense — they assert what *is*, defect included. Every
assertion was proven to go red before being trusted, and so was the original
guard after its scanner moved to `tests/lib/source-scan.mjs`.

## 2. Slice one — the audio graph

Both of the audit's audio findings come from one cause: **audio properties are
attached to elements rather than to an audio path.**

Audibility is decided by fourteen hard-coded `muted` attributes implementing a
rule that is written down in a comment and enforced nowhere. Device routing
fails the same way from the other side: `setSinkId` is a per-element call, so
the audio-output-device setting reaches whichever elements somebody remembered
to call it on — one, across the whole repository. Backing tracks use an
independent `new Audio()` that never calls it, which is known-issues §1.

So `services/audio.rs` describes the path:

```text
Source            Sink                 Output device
---------------   ------------------   -------------
presentation      gain, mute,          one device id
video          →  and the single    →  shared by every
backing track     device selection     source
```

A surface asks `routing(source, surface)` and applies the answer. Two things
that were maintained by hand become structural:

- **Only the operator surface can produce sound.** Every mirror asks the same
  question and is handed silence — and is refused *before* levels are read, so
  no arithmetic can produce an audible mirror. Forgetting a `muted` attribute
  stops being a way to reach the audience speakers, because the attribute is no
  longer where the answer lives.
- **The device belongs to the sink**, so both sources follow it rather than one.

`can_produce_audio` is a `match` rather than a field, so adding a surface is a
compile error until somebody decides which side of the line it falls on. The
surface list has a test of its own: a surface added to the enum and not to
`ALL_SURFACES` would silently stop being covered by the exhaustiveness tests,
which is the one way this module could quietly lose its invariant.

**Two sources, both audible at once.** "One audible source" would be the wrong
rule — a backing track under a muted video is ordinary worship practice. The
echo the audit is worried about is one *source* heard on two *surfaces*, and
that is what `AudioSurface` governs.

The graph persists to `audio.json`. The device choice is what an operator sets
once when the desk is wired up, and today it lives in a localStorage key
Chromium partitions per origin — so the dev and packaged Electron builds
already disagree about it and Tauri starts with no choice at all
(known-issues §2).

## 3. Where the typing stops, and why audio is not decoded in Rust yet

Audio still comes out of WKWebView. The graph produces *instructions* that the
renderer applies to its own elements.

That is deliberate rather than unfinished. Moving decode into Rust ahead of the
wgpu compositor would split one stream across two runtimes — audio in Rust,
video pixels still drawn by the webview — and require the two to be
re-synchronised, which is worse than either end state. The graph is the part
that can move now, and it is the part the compositor will need when it arrives.

## 4. On the TypeScript side

`applyRouting` in `src/renderer/tauri/audio.ts` is the only function in the
renderer that touches `muted`, `volume` or the sink. Mirrors call it too,
passing their own surface and receiving silence, rather than carrying an
attribute someone has to remember to write.

It mutes before touching the level or the sink, so an element moved onto a
mirror surface cannot make a sound in between. It clamps, because assigning NaN
to `element.volume` throws — and a throw would abort the caller's effect and
leave the *previous* level applied, which is audio that ignores the operator
rather than audio that goes quiet.

## 5. What is verified

By running it:

- 351 Rust tests, 93 JS tests, clippy `-D warnings` and fmt clean, typecheck
  clean, lint unchanged at the 10 pre-existing errors
- every assertion in the new suite proven to fail: a second `new Audio()`, a
  stray `.play()`, a dropped `mute=1`, a raised silence gain, an added
  `setSinkId`, an `<audio>` element, and an unmuted mirror beside a capture
  stream
- the original video guard re-proven to fail on an injected audible `<video>`
  after its scanner moved

**Not verified.** *Nothing has been heard.* No audio has come out of a speaker
under Tauri, and no device has been switched at runtime by a person. The gate
proves the graph answers correctly and that both sources agree on the device; it
does not prove a sound came out of the right box. That needs the manual run
below.

## 6. Slice four — typing the scene, and the media transport

Two pieces the compositor needs whichever shape it takes.

### The slide elements

Stage 4 carried `slide_elements` as an opaque value and said why: nothing in
Rust interpreted them. The compositor does, so they have structs now.

The whole module is shaped by one constraint: **typing this must not be able to
blank the audience screen.** The values come from the operator's React tree and
from imported PowerPoint, both of which produce shapes the file has not seen,
and a failed deserialisation mid-service is a black screen in front of a
congregation. So unknown element types degrade to an `Unknown` arm, one
unreadable element does not cost the other eleven, and anything that is not an
array reads as no elements.

Unknown *fields* survive through a flattened `extra` map. That is not tidiness:
after the hybrid amendment React still renders part of the audience surface from
data that has been through Rust, so a field dropped in transit is a property
that silently stops applying with nothing to point at.

Geometry is `Option<f64>`, which is the part that would have been easy to get
wrong. A plain default reads an omitted width as zero and writes `"width": 0`
back out — data the input never contained. React lays out an undefined width
differently from a zero one, so inventing the zero would collapse elements that
render correctly today. The round-trip test caught it.

The scene keeps carrying the raw value. A typed field fails as a whole, and the
scene is relayed to windows that still render it in React. The typing happens at
the boundary that needs it.

### The transport

`showPlaybackByMediaIdRef` and `showTimeByMediaIdRef` remember, per media item,
whether it was playing and where it had got to — so an operator who steps away
mid-video and comes back resumes rather than restarting. Domain behaviour
someone relies on live, in a ref that dies with the component and that no other
window can see. It is Rust-owned now.

Two things the audit did not have quite right:

| | Tolerance | Why |
|---|---|---|
| Operator's own player | 0.5 s | do not fight somebody scrubbing |
| Audience mirror | 0.12 s | nothing is touching it; stay locked to what the operator hears |

The audit's §5.5 records only the first and attributes it to mirrors. Both are
kept and named, because collapsing them would be wrong for whichever one lost.
The relationship between them is a `const` assertion, so getting them the wrong
way round is a compile error rather than a test failure.

`report_position` sits beside `seek` rather than inside it. A report is the
element saying where it *is*; a seek is the operator saying where it *should
be*. Only one is authoritative, and collapsing them is how a stale sample drags
the playhead backwards mid-service.

**Not yet wired to the React player.** That cutover touches live-service video
sync and wants the manual run done first. What is in is the transport, a startup
gate proving it is reachable and bounded, and `__presentPlayback` so it can be
driven by hand during that run.

## 6. Slice three — routing both sources, and closing §1

The defect was never a forgotten call. `setSinkId` is a **per-element** call, so
the audio-output-device setting reached whichever elements somebody remembered
to route. Adding a second call site would have left the same shape in place.

So there is now exactly one place either source can be routed from —
`applyAudioRouting` — which both shells and both sources go through. A source
cannot be left behind by omission, because omitting it means producing no audio.

`useAudioRouting` is the adapter, shaped like every other slice's: the hook
keeps its signature, no component learns which shell it is in, Electron is
unchanged. The routing rule is deliberately not reimplemented in JS. Asking Rust
costs one `invoke` per mounted surface per change, and a graph change is an
operator moving a slider, not a render loop.

**The settings picker had to move with it.** Both sources now read the device
from the sink, so a picker still writing only to `localStorage` would have taken
the video's routing *away* rather than given the backing track its own.
`useAudioDeviceSync` seeds React from Rust on mount rather than the other way
round: the Tauri build is a fresh browser origin with an empty settings key
(known-issues §2), so pushing first would overwrite a saved device with a blank
one on every launch.

**The mirrors keep their `muted` attributes.** Replacing fourteen of them with
hook calls is churn in live-service code for a guarantee the suite already
gives, and ADR-001 deletes those elements outright when the compositor lands.
The graph refuses mirrors today; the attributes are belt and braces until there
is nothing left to brace.

### What the running app reports

A clean launch, zero renderer errors, every earlier gate still passing:

```
audioDevice=system-default audioSink=shared audibleMirrors=none
```

`shared` is known-issues §1: both sources return the same device. `none` is the
audit's §5.3 invariant, checked across the real serialisation boundary — where a
mistake in the surface names would fail open in exactly the place a unit test
cannot see.

That launch also turned up a bug in the shell. `safelyUnlisten` was written for
the unlisten failure a Vite reload causes, and its own comment names the symptom
("surfaces as an unhandled rejection"), but the guard was a bare `try`/`catch`
and the failure arrives as a promise rejection. Fifteen reached the Rust error
log on one launch, each indistinguishable from a real renderer failure — in the
one place this migration relies on to see anything, since a Tauri webview's
console cannot be read from a terminal. Now zero.

## 6. What is left

**Wire the React player to the transport.** `useShowVideoSync` still owns
playback in refs. Moving it onto the Rust transport is the cutover, and it
touches live-service video sync, so it wants the manual run done first.

**The compositor.** ADR-001's headline and the expensive part — weeks, not days.
`slide_elements` is typed now; `screen_composer_layout` still is not. The
surface is a hybrid per the ADR amendment: Rust composites the slide, media and
overlays, a transparent webview above it keeps the YouTube and capture props,
and those two layers do not reach NDI.

**Two prerequisites that are not code**, both still outstanding from the
handoff, and both needing a person:

1. Run a service through the Tauri build by hand. Nothing below Stage 5 has
   been *used* — no slide advanced, no video played, no audience window opened.
2. Run the multi-monitor matrix, the outstanding Stage 2 gate.

Building a compositor onto an audience surface that has never once displayed a
slide is the risk worth naming: the compositor would be the first thing to
render there, and every failure would look like a compositor bug.
