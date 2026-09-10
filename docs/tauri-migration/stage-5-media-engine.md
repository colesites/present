# Stage 5 — the media engine and a single audio path

**Status:** in progress. Two slices landed; the surfaces are not yet wired.

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

- 321 Rust tests, 92 JS tests, clippy `-D warnings` and fmt clean, typecheck
  clean, lint unchanged at the 10 pre-existing errors
- every assertion in the new suite proven to fail: a second `new Audio()`, a
  stray `.play()`, a dropped `mute=1`, a raised silence gain, an added
  `setSinkId`, an `<audio>` element, and an unmuted mirror beside a capture
  stream
- the original video guard re-proven to fail on an injected audible `<video>`
  after its scanner moved

**Not verified.** Nothing has been heard. No audio has come out of a speaker
under Tauri, no device has been switched at runtime, and no surface consumes
the graph yet. The slice is a reducer with tests, not a working mixer.

## 6. What is left

**Wire the surfaces.** Replace the nine hard-coded `muted` attributes and the
two level-setting effects with `applyRouting`. This is the slice that actually
closes known-issues §1, and until it lands the defect is unchanged on both
shells. It touches `ServicesSidebar.tsx`, which currently carries the owner's
own uncommitted edits — coordinate before starting.

**Media playback state in Rust.** The plan's §Stage 5 list: play, pause, stop,
seek, volume, mute, position, lifecycle, preview/output sync. `OutputScene`
already carries `is_video_playing` and `video_current_time`; what is missing is
the transport that owns them rather than mirroring React.

**The compositor.** ADR-001's headline and the expensive part — weeks, not days.
It needs `slide_elements` and `screen_composer_layout`, carried verbatim since
Stage 4, to become real structs.

**Two prerequisites that are not code**, both still outstanding from the
handoff, and both needing a person:

1. Run a service through the Tauri build by hand. Nothing below Stage 5 has
   been *used* — no slide advanced, no video played, no audience window opened.
2. Run the multi-monitor matrix, the outstanding Stage 2 gate.

Building a compositor onto an audience surface that has never once displayed a
slide is the risk worth naming: the compositor would be the first thing to
render there, and every failure would look like a compositor bug.
