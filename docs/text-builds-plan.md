# Builds: animating any layer on a slide

Status: plan, nothing built yet.

## Words first

**Transitions and builds are different things, and Present needs both.**

| | Transition (we have it) | Build (this plan) |
|---|---|---|
| Acts on | the change from slide A to slide B | one layer *on* a slide |
| When | once, as the slide changes | when the slide arrives, after a delay, on a click, or on the way out |
| Example | cross-fade from verse 1 to verse 2 | "LET THE" wipes in, then "ARMY" 0.3 s later, then "ROAR" pops in |
| Stored on | the slide (`OutputScene.transition`) | each element (`SlideElement.builds`) |

ProPresenter calls the second one **Builds**: each layer has a **Build In** and
a **Build Out**, and each slide has a **Build Order**. We use the same words so
ProPresenter users are at home. **Text effects** is our name for the part that
goes beyond ProPresenter: animating a text layer word by word or letter by letter.

## What ProPresenter does (from the "Slide Builds" walkthrough and the screenshots)

* **Where:** Editor → select any layer → right-hand panel has tabs
  **Shape · Text · Build**. Builds work on text, shapes, images, video, any layer.
* **Build In / Build Out:** each starts as an "Add Build…" button. Adding one
  opens the same picker as slide transitions (thumbnails, favourites, filter).
  Once added, the card shows the effect's thumbnail, name, **Change**,
  **Duration** (e.g. 0.6 s), and *Reset to Default Parameters*.
* **Delivery** (text only): *All At Once*, *By Bullet* (each paragraph/line is
  its own step), *By Underline* (each underlined word starts hidden and is its
  own step — for fill-in-the-blank teaching slides).
* **Build Order** list at the bottom: every step on the slide, numbered, e.g.
  `1  In the beginning,   In: Dissolve`. Drag to reorder.
* **Start + Delay** for the selected step:
  * first step: *On Click*, *With Slide*, *After Transition*;
  * later steps: *On Click*, *With Previous*, *After Previous*;
  * delay up to 16 minutes.
* **Live:** click / space / right arrow runs the next click step; only when none
  are left does it go to the next slide. Slide thumbnails show **small dots**,
  one per click step, so an operator knows why "next" didn't change slides.

**Where ProPresenter stops:** delivery is only all-at-once, by bullet or by
underline, and the effects are slide transitions reused. It can't do the
lyric-video look (the TikTok examples and the "What A God" visual) without one
text box per word. That is the gap we fill.

> Note: I could read the YouTube walkthrough's transcript and the TikTok
> captions, but not see the TikTok videos themselves (one needs a login, and
> the video frames didn't capture). The plan's lyric-animation goals come from
> the earlier shorts and the TikTok descriptions ("lyrics animation with
> ProPresenter").

## What ours does

The same model as ProPresenter, with two additions: **finer delivery** and
**automatic stepping**, so one text box can animate word by word on its own.

### The Build tab

Editor inspector today: **Song · Slide · Text** (or Shape / Image). Add
**Build** as a fourth tab whenever *any* layer is selected
(`EditorInspector.tsx` — `tabs` / `TAB_LABELS`, and `activeTab` must stop
falling back to the object tab when "build" is chosen).

```
Build In                      [ thumbnail ]  Wipe          [Change]
  Duration        ──●────────  0.5 s
  Direction       ← → ↑ ↓
  Easing          Ease out ▾
  Animate         All at once ▾   (text: by line · by word · by letter · by underline)
  Step            Automatically ▾ (or: each on click)
  Gap between     ──●────────  0.1 s     (only when by line/word/letter + automatically)

Build Out                                         [Add Build…]

──────────────────────────────────────────────────
Build Order
  1  Let the…        In: Wipe      With slide
  2  Army            In: Pop       After previous  +0.3 s
  3  Roar            In: Pop       On click
  ● 1 click step on this slide
Start  After previous ▾        Delay  0.3 s
```

So every step on every layer has what you described: **a duration and a delay
in seconds**, plus when it starts.

### Timing model

For each step:

* **start** — `on-click` · `with-slide` · `after-transition` (first step only),
  `with-previous` · `after-previous` (later steps)
* **delay** — seconds after its start point (0 – 960)
* **duration** — seconds the effect takes (0 – 10)

For text delivered by line / word / letter / underline:

* **step: automatically** — the units run one after another, `gap` seconds
  apart, as one step in the build order. This is the lyric-video look from one
  text box.
* **step: each on click** — every unit is its own click step, like ProPresenter's
  *By Bullet* / *By Underline*.

### Effects

Start with the transition primitives we already draw (cut, fade/dissolve, wipe,
slide, push, zoom, shape reveal, blur), then text effects that only make sense
per unit:

* **Pop** — scale 0.6 → 1.05 → 1 with fade
* **Rise** — slide up a little and fade in
* **Drop** — fall from above with a small bounce
* **Typewriter** — letters appear with no motion (letter delivery + cut)
* **Blur in** — from blurred and transparent to sharp
* **Tracking in** — letter spacing wide → normal
* **Highlight** — a colour bar sweeps behind the word (later)

Build Out uses the same list played backwards (rise → sink, pop → shrink…).

## The data

On `SlideElement` (the `extra` flatten means older files and older React
versions keep working):

```jsonc
"builds": {
  "in": {
    "effect": "pop",          // registry id
    "durationMs": 500,
    "delayMs": 300,
    "start": "after-previous",
    "easing": "ease-out",     // reuse transition::Easing
    "direction": "up",        // reuse transition::Direction
    "delivery": "word",       // all | line | word | letter | underline
    "step": "auto",           // auto | click
    "gapMs": 100
  },
  "out": { "effect": "fade", "durationMs": 300, "start": "on-click" }
}
```

On the slide, the order of steps across layers:

```jsonc
"buildOrder": [
  { "elementId": "a1", "phase": "in" },
  { "elementId": "b2", "phase": "in" },
  { "elementId": "a1", "phase": "out" }
]
```

A slide with no `buildOrder` gets one in layer order, so adding a build never
needs a second action.

## How it fits the code we have

* **Reuse from `compositor/transition/`:** `easing.rs`, `config::Direction`, the
  drawing in `draw.rs`, the preset-as-data idea in `registry.rs`, and
  `sample.rs` + `TransitionTile` for picker thumbnails. Move `Easing` and
  `Direction` into a shared `compositor/motion/` so builds and transitions both
  use them without depending on each other.
* **New `compositor/build/`:**
  * `config.rs` — the types above.
  * `timeline.rs` — turns a slide's build order into absolute start/end times
    and a list of click steps. Pure and unit-tested without a screen, like
    `change_detection.rs`.
  * `registry.rs` — effect id → a function `progress → Pose { opacity, dx, dy,
    scale, rotate, blur, clip }`.
* **Drawing (`pipeline.rs` `draw_layer_into`):** a layer with a pose is drawn to
  its own pixmap once, then placed with the pose each frame. Layers without
  builds draw exactly as today.
* **Text units (`text.rs`):** a layout-only call returning lines → words →
  letters with their rectangles (cosmic-text already knows them). Each unit is
  cached as a small pixmap per slide and only moved/blended per frame, so a long
  verse by letter stays cheap.
* **Keeping frames flowing:** `is_animating()` stays true while any build is
  running, so the loop redraws; when everything has settled it stops, as today.
* **The "next" action:** before advancing slides, check the live slide's
  timeline for a pending click step and run it instead.
* **With transitions:** in changed-elements mode, a layer that has a Build In
  doesn't also get the transition's entrance. Build Outs run before the slide
  transition.
* **The webview renderer** (layers the compositor leaves to React, and the
  editor canvas preview) needs the same poses. Keep the pose functions in Rust
  and expose them to React, the same way the transition list already comes
  from Rust, so there is one definition.

## Other screens

* **Slide thumbnails:** show the finished slide, plus one dot per click step
  (ProPresenter's indicator), in `SlidesGrid.tsx` and the editor slide list.
* **Stage display:** shows the finished text immediately — a singer must never
  wait for a word to animate in. A per-output "play builds" setting (default on
  for audience and NDI, off for stage).
* **Editor canvas:** a ▶ Preview button that plays the slide's builds.

## Phases

1. **Build tab + object builds.** Build In/Out on any layer, all-at-once
   delivery, start/delay/duration, build order, effects: cut, dissolve, wipe,
   slide, zoom. Click steps on "next" and dots on thumbnails.
   *This matches ProPresenter.*
2. **Text effects.** By line / word / letter with automatic stepping and a gap;
   pop, rise, drop, typewriter, blur in. *This is the lyric-video look from one
   text box.*
3. **By underline and click-per-unit** (fill-in-the-blank teaching slides).
4. **Presets.** "Lyric pop", "Word by word rise", "Typewriter", saved
   presets of your own, and apply a build to a whole song or a theme so every
   lyric slide gets it.
5. **Later.** Looping effects while on screen (pulse, float, shimmer), timing to
   a song's BPM, MIDI/timecode triggers, importing PowerPoint animations in
   `services/pptx`.

## Open questions

1. **Tab name:** "Build" (matches ProPresenter) or "Animate"? Recommendation:
   **Build**.
2. **Seconds vs milliseconds in the UI:** recommend seconds with one decimal
   (0.3 s), stored as ms.
3. **Lyric slides generated from a song** have no hand-made layers: should a
   song-level "text effect" setting apply to every lyric slide? Recommendation:
   yes, in phase 4.
