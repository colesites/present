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

## 4. Slice two — routing both sources, and closing §1


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

## 5. On the TypeScript side


`applyRouting` in `src/renderer/tauri/audio.ts` is the only function in the
renderer that touches `muted`, `volume` or the sink. Mirrors call it too,
passing their own surface and receiving silence, rather than carrying an
attribute someone has to remember to write.

It mutes before touching the level or the sink, so an element moved onto a
mirror surface cannot make a sound in between. It clamps, because assigning NaN
to `element.volume` throws — and a throw would abort the caller's effect and
leave the *previous* level applied, which is audio that ignores the operator
rather than audio that goes quiet.

## 6. Slice three — typing the scene, and the media transport


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

## 7. Slice four — the compositor


ADR-001's headline. A scene goes in, pixels come out.

### It rasterises on the CPU, and that is deliberate

The ADR names wgpu. It named it before anyone had looked at how slides are
actually drawn, and they are drawn with the Canvas 2D API — `measureText`,
`fillText`, paths, rounded rects, `drawImage`, sixty context calls in
`CanvasSlideLayer.tsx`. `tiny-skia` is a Skia subset with that same model, so
what is here is a port rather than a reimplementation.

The ADR's *decision* was compositing in Rust over OS capture and offscreen
Chromium, and that is unchanged. Three things follow from the choice of
rasteriser:

- **NDI wants a CPU-side BGRA bitmap.** That is what `capturePage` produced and
  what `grandi` consumes (audit §10.1). A GPU compositor would have to read back
  every frame to feed it; rasterising on the CPU removes that readback rather
  than adding one.
- **It is testable headlessly**, with assertions about actual pixels. A wgpu
  path needs a GPU adapter, which CI runners frequently do not have.
- **There is nothing for a GPU to composite yet.** The expensive case is video
  frames at 30 fps, and this tree has no Rust video decoder.

`Frame` is a plain buffer precisely so a GPU path can replace the internals
later without any consumer changing.

### What each layer refuses to guess

| Layer | The refusal |
|---|---|
| colour | an unrecognised CSS string paints **nothing** — guessing black covers the lyrics, guessing white covers the video |
| geometry | rotation about the element's centre, not the origin; radius clamped to half the shorter side |
| shapes | the border insets by half its width, because a stroke straddles its path |
| text | size scales uniformly, never per-axis; unstyled text defaults to white |
| images | `cover` is the default, because letterboxing a background shows bars |
| scene | an empty scene renders black rather than failing |

`web` elements and unknown types are **deferred, not drawn** — they belong to
the webview layer above, and painting anything in their place would cover them.

### The security boundary

The renderer cannot open a file. Every URL in a scene came from the frontend,
and `file_scope` is the only thing allowed to turn one into a read. A compositor
calling `std::fs::read` would reopen known-issues §3 from a new direction, with
no HTTP response for anyone to notice the missing 403 on. `ScopedMediaLoader`
goes through `FileState`, and its tests prove that a file outside the granted
folders and a traversal out of one are both refused.

### Frame time, and the one number Stage 6 turns on

NDI runs at 30 fps, so a frame has **33 ms**. That budget is the whole reason
the compositor exists, and it is the first thing worth measuring rather than
assuming.

The first honest measurement was **300 ms** at 1920×1080 — nine times over,
before a single video frame had been drawn. The cause was not the rasteriser
but how glyphs arrived from it: cosmic-text's callback fires **per glyph pixel**
(`render.rs:139-153` passes `w: 1, h: 1`), and the draw path answered each one
with a full `fill_rect`. Two lines of a verse meant tens of thousands of
paint-and-transform round trips.

Glyphs now rasterise into a scratch pixmap that is composited once. All 78
compositor tests pass unchanged, which is what writing them as assertions about
ink and colour rather than exact pixels bought.

**Measured after the fix: 29.5 ms**, over four runs on the shipping release
profile, at 1920×1080. Nine times faster, and inside the budget.

**It is inside the budget with about 10% to spare, and that is the finding.**
That number is a static slide: three elements, no video, on this machine. Video
decode and scaling are per-frame work that has not been added yet, and they will
not fit in 3.8 ms.

So the next optimisation is architectural rather than micro. **The scene only
changes when the operator does something** — a slide can sit unchanged for four
minutes of a song. Recomposing an identical frame thirty times a second is pure
waste. Caching the composited frame and re-rendering only when the scene changes
leaves video as the only genuine per-frame cost, which is the shape the pipeline
wants anyway.

Two things to know when measuring:

- `profile.release` optimises for **size** — `opt-level = "s"`, LTO, one codegen
  unit. The 29.5 ms above is on that profile, so it is the honest shipping
  number; `--profile perf` builds at `opt-level = 3` if you want to know what
  the code can do rather than what it does.
- The first frame of a process pays for the system font scan, which is a startup
  cost and not a frame cost. `text::preload_fonts` exists to move it off the
  first slide of a service; it is not called at startup yet.

If the CPU rasteriser cannot reach the budget once video is in the frame, that
is the point at which the GPU path ADR-001 originally named earns its place —
and `Frame` is a plain buffer so that swap costs no consumer anything.

### What it looks like

`cargo run --example render_sample` writes a frame somebody can open. The pixel
tests assert about ink and colour, which is what keeps them independent of a
machine's fonts; they cannot say whether the result *looks* right, and ADR-001
requires the Rust and React renderings of the same slide to stay visually
identical. That is a judgement only an eye makes.

## 8. Slice five — video, and making the frame budget

ADR-002: the operating system decodes. `services/video` is the trait and the
support check; `services/video/macos.rs` is AVFoundation behind it.

`AVAssetReader` pulls frames rather than `AVPlayer` playing them, because
`services::playback` already owns position and a player would bring a second
clock. Frames are requested as BGRA so VideoToolbox does the colour conversion
in hardware — the half of decode quality that is easy to get wrong by hand.

Two bugs only running it found. **Seeking aborted the process**: an
`AVAssetReader`'s time range is immutable once reading starts, and setting it
afterwards raises an Objective-C exception, which Rust cannot catch. And
**pixel buffer rows are padded**, so copying the block in one go sheared every
frame diagonally.

### The frame budget

NDI gives a frame 33.3 ms. Getting well under it took five changes, every one of
them found by measuring rather than reasoning. Compositing a slide over one of
the owner's own 1080p service videos, ninety frames, release build:

| | decode | composite | total |
|---|---:|---:|---:|
| first working version | 4.3 ms | 84.4 ms | 88.7 ms |
| build the frame from the video's bytes | 4.6 ms | 53.1 ms | 57.7 ms |
| blend only the pixels that are not transparent | 4.7 ms | 23.1 ms | 27.8 ms |
| spread the pixel work across cores | | | |
| stop reallocating the frame every tick | 4.2 ms | 6.5 ms | **10.7 ms** |

Repeat runs land at 9 to 12 ms across seven of their videos — under a third of
the budget, with decode now the larger half of what remains.

**Decode never moved.** It was 4.2 to 4.7 ms at every step, which is the
hardware doing its job. Every gain was in compositing, which is worth knowing
before anyone reaches for a faster decoder.

What each change removed:

- **A full-screen video at native size is the frame.** Routing it through the
  general image path cost five passes over two million pixels, one of them
  bilinear resampling a 1920×1080 image into a 1920×1080 rectangle — arithmetic
  for a copy.
- **Most of a slide layer is nothing.** Lyrics cover perhaps a sixth of the
  screen; the rest is transparent and contributes zero.
- **Twelve cores, one in use.** Both hot loops are two million independent
  pixels. They run in bands now, one per core.
- **Sixteen megabytes allocated and freed per frame.** The output buffer's size
  only changes when the output does, so it is kept and overwritten.

### The resolution trap

The budget held for 1920×1080 and collapsed to **117 ms** for a 2048×1152
source, because the fast path only applies to a frame that arrives at the size
it will be drawn at. Anything else fell back to software resampling.

The decoder is asked for frames at the output size now, and VideoToolbox scales
on the hardware that just decoded — free, since the scaler is already in that
path. That same 2048×1152 file now composites in **9.9 ms**, marginally faster
than the 1080p one because the hardware hands back a frame that needs no further
work.

## 8. What is verified


By running it:

- 456 Rust tests, 93 JS tests, clippy `-D warnings` and fmt clean, typecheck
  clean, lint unchanged at the 10 pre-existing errors
- every assertion in the new suite proven to fail: a second `new Audio()`, a
  stray `.play()`, a dropped `mute=1`, a raised silence gain, an added
  `setSinkId`, an `<audio>` element, and an unmuted mirror beside a capture
  stream
- the original video guard re-proven to fail on an injected audible `<video>`
  after its scanner moved
- **a real lyric slide rendered by the compositor** and looked at: centred
  verse, italic footer, a rounded lower-third with a border and opacity, and the
  `web` element correctly left as a hole for the layer above
- the compositor's scope check refusing both a file outside the granted folders
  and a traversal out of one
- **video decoding from the owner's own library**: eight files, 720p to
  2048×1152, every seek landing on the requested second, and a decoded frame
  written out and looked at to confirm the channel order
- **the full pipeline at a third of the frame budget**: 9 to 12 ms against 33.3,
  measured across seven of their own videos and both resolutions
- the frame time measured rather than assumed: **300 ms** at 1920×1080 before
  the glyph fix and **29.5 ms** after it, against NDI's 33 ms budget

**Not verified.** *Nothing has been heard.* No audio has come out of a speaker
under Tauri, and no device has been switched at runtime by a person. The gate
proves the graph answers correctly and that both sources agree on the device; it
does not prove a sound came out of the right box. That needs the manual run
below.

## 9. What is left

**Wire the React player to the transport.** `useShowVideoSync` still owns
playback in refs. Moving it onto the Rust transport is the cutover, and it
touches live-service video sync.

**Bring the compositor to parity, then swap the surface.** The frame pipeline
exists and draws slides. What it does not draw yet:

| Gap | Why it is not there |
|---|---|
| **Video frames** | there is no Rust video decoder in this tree. The largest single gap, and the reason the surface has not swapped |
| Message, props and timer overlays | straightforward ports of `OutputWindow`'s layers onto the same primitives |
| `screen_composer_layout` | still carried verbatim; needs typing the way `slide_elements` was |
| Text shadow, gradient fill, text stroke | `CanvasSlideLayer` supports all three |
| Scripture auto-fit | `resolveScriptureAutoFitScale`, which shrinks a long verse to fit its box |

Until it reaches parity the output window stays a webview, which is what
ADR-001 requires so parity is never lost mid-migration.

**Two prerequisites that are not code**, both still outstanding from the
handoff, and both needing a person:

1. Run a service through the Tauri build by hand. Nothing below Stage 5 has
   been *used* — no slide advanced, no video played, no audience window opened.
2. Run the multi-monitor matrix, the outstanding Stage 2 gate.

**Stage 6 depends on this stage finishing.** NDI has no frame source until the
compositor is the audience surface — that is the whole of ADR-001's blocker
§10.1. `Frame::to_bgra` is the shape `grandi` consumes, so the interface Stage 6
needs is already there; what it is waiting for is frames with video in them.
