//! Builds: objects on a slide arriving and leaving on their own, step by
//! step, as PowerPoint's animations and Keynote's builds do
//! (`docs/text-builds-plan.md`, phase 1).
//!
//! Each object may carry `builds.in` and `builds.out` (on the element, so an
//! older build passes them through untouched). The slide's steps are worked
//! out from those alone:
//!
//! * the builds run in `order`, else in layer order, an object's in before
//!   its out;
//! * a build that starts `on-click` opens a new step; `with-previous` starts
//!   when the one before it starts, `after-previous` when it ends; each then
//!   waits its own `delayMs`;
//! * step 0 holds what runs with the slide by itself — everything before the
//!   first `on-click` — and each click after it is a step of its own.
//!
//! A text box's build can be delivered all at once, or by line, by word or
//! by letter: one box, its words arriving one after another `gapMs` apart,
//! instead of a box for each word. What an object looks like at a moment is
//! a [`Look`]: one [`Pose`] for all of it, or one for each of its words. The compositor draws the pose; the
//! same rules are in `features/editor/lib/builds.ts` for the editor.

use std::collections::HashMap;

use serde::Deserialize;

use crate::services::slide::SlideElement;

/// One build: how an object arrives (`in`) or leaves (`out`).
#[derive(Debug, Clone, PartialEq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Build {
    #[serde(default = "default_effect")]
    pub effect: String,
    #[serde(default = "default_duration")]
    pub duration_ms: f64,
    #[serde(default)]
    pub delay_ms: f64,
    #[serde(default = "default_start")]
    pub start: String,
    #[serde(default)]
    pub direction: Option<String>,
    /// Its place among the slide's builds; layer order when absent.
    #[serde(default)]
    pub order: Option<f64>,
    /// A text box all at once (`all`, the default), or by `line`, `word` or
    /// `letter`.
    #[serde(default)]
    pub delivery: Option<String>,
    /// Between one line, word or letter starting and the next.
    #[serde(default)]
    pub gap_ms: Option<f64>,
}

/// How a text box's build is handed out: all of it, or a piece at a time.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Hash)]
pub enum Delivery {
    #[default]
    All,
    /// Each paragraph.
    Line,
    Word,
    Letter,
}

impl Delivery {
    pub fn parse(value: Option<&str>) -> Self {
        match value.map(str::trim) {
            Some("line") => Self::Line,
            Some("word") => Self::Word,
            Some("letter") => Self::Letter,
            _ => Self::All,
        }
    }

    /// The gap between pieces when the build does not give one.
    pub fn default_gap_ms(self) -> f64 {
        match self {
            Self::All => 0.0,
            Self::Line => 400.0,
            Self::Word => 150.0,
            Self::Letter => 50.0,
        }
    }
}

fn default_effect() -> String {
    "fade".to_owned()
}
fn default_duration() -> f64 {
    500.0
}
fn default_start() -> String {
    "on-click".to_owned()
}

#[derive(Debug, Clone, Default, PartialEq, Deserialize)]
pub struct Builds {
    #[serde(default, rename = "in")]
    pub build_in: Option<Build>,
    #[serde(default, rename = "out")]
    pub build_out: Option<Build>,
}

/// An element's builds, if it has any.
pub fn builds_of(element: &SlideElement) -> Option<Builds> {
    let value = element.extra.get("builds")?;
    let builds: Builds = serde_json::from_value(value.clone()).ok()?;
    (builds.build_in.is_some() || builds.build_out.is_some()).then_some(builds)
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum Phase {
    In,
    Out,
}

/// One build placed on the slide's timeline.
#[derive(Debug, Clone, PartialEq)]
pub struct Placed {
    pub element_id: String,
    pub phase: Phase,
    pub step: usize,
    /// From the start of its step, in milliseconds.
    pub begin_ms: f64,
    pub duration_ms: f64,
    pub effect: String,
    pub direction: Option<String>,
    /// How it is handed out, and into how many pieces: 1 for all at once.
    pub delivery: Delivery,
    pub units: usize,
    pub gap_ms: f64,
}

impl Placed {
    /// From its first piece starting to its last one settling.
    pub fn span_ms(&self) -> f64 {
        self.duration_ms + self.gap_ms * self.units.saturating_sub(1) as f64
    }
}

/// How many pieces an object's build is handed out in, and how: a text box
/// by line, word or letter; anything else, and imported words in their own
/// runs, all at once.
fn delivery_of(element: &SlideElement, build: &Build) -> (Delivery, usize) {
    let delivery = Delivery::parse(build.delivery.as_deref());
    if delivery == Delivery::All
        || element.element_type != crate::services::slide::SlideElementType::Text
        || super::rich_text::applies(element)
    {
        return (Delivery::All, 1);
    }
    match super::text::unit_count(element, delivery) {
        count if count > 1 => (delivery, count),
        _ => (Delivery::All, 1),
    }
}

/// A slide's builds in time, and how many clicks it takes to show them all.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct Timeline {
    pub placed: Vec<Placed>,
    pub click_steps: usize,
}

impl Timeline {
    pub fn is_empty(&self) -> bool {
        self.placed.is_empty()
    }
}

pub fn timeline(elements: &[SlideElement]) -> Timeline {
    // Its order, its place in layer order, whose and which build it is, and
    // how it is handed out.
    type Item = (f64, usize, String, Phase, Build, (Delivery, usize));
    let mut items: Vec<Item> = Vec::new();
    for (index, element) in elements.iter().enumerate() {
        if !element.is_visible() {
            continue;
        }
        let Some(builds) = builds_of(element) else {
            continue;
        };
        let id = element.id.clone();
        for (phase, build) in [(Phase::In, builds.build_in), (Phase::Out, builds.build_out)] {
            if let Some(build) = build {
                let fallback = (index * 2 + usize::from(phase == Phase::Out)) as f64;
                let order = build.order.unwrap_or(fallback);
                let delivery = delivery_of(element, &build);
                items.push((order, items.len(), id.clone(), phase, build, delivery));
            }
        }
    }
    items.sort_by(|a, b| a.0.total_cmp(&b.0).then(a.1.cmp(&b.1)));

    let mut placed = Vec::with_capacity(items.len());
    let mut step = 0usize;
    let (mut previous_base, mut previous_end) = (0.0_f64, 0.0_f64);
    for (index, (_, _, element_id, phase, build, (delivery, units))) in
        items.into_iter().enumerate()
    {
        let base = match build.start.as_str() {
            "with-previous" => previous_base,
            "after-previous" => previous_end,
            // On a click: a step of its own. The very first build clicked in
            // is step 1; step 0 is what runs with the slide.
            _ => {
                if index > 0 || step == 0 {
                    step += 1;
                }
                0.0
            }
        };
        let duration_ms = if build.effect == "appear" {
            0.0
        } else {
            build.duration_ms.max(0.0)
        };
        let begin_ms = base + build.delay_ms.max(0.0);
        let gap_ms = if units > 1 {
            build
                .gap_ms
                .filter(|gap| gap.is_finite())
                .unwrap_or_else(|| delivery.default_gap_ms())
                .max(0.0)
        } else {
            0.0
        };
        let one = Placed {
            element_id,
            phase,
            step,
            begin_ms,
            duration_ms,
            effect: build.effect,
            direction: build.direction,
            delivery,
            units,
            gap_ms,
        };
        previous_base = base;
        previous_end = begin_ms + one.span_ms();
        placed.push(one);
    }
    Timeline {
        click_steps: step,
        placed,
    }
}

/// How an object is drawn at a moment.
#[derive(Debug, Clone, Copy, PartialEq)]
pub enum Pose {
    Hidden,
    /// Part-way: faded, moved (fractions of the slide), scaled about its
    /// middle (`scale_x` more across), turned (degrees, clockwise), blurred
    /// (a fraction of the slide's height) and cut back from one side (a
    /// wipe: how much shows, from where).
    Moving {
        opacity: f32,
        dx: f32,
        dy: f32,
        scale: f32,
        scale_x: f32,
        rotate: f32,
        blur: f32,
        wipe: Option<(WipeFrom, f32)>,
    },
}

/// How an object is drawn at a moment: all of it in one pose, or each of its
/// lines, words or letters in its own (`None`: as made).
#[derive(Debug, Clone, PartialEq)]
pub enum Look {
    Whole(Pose),
    Units {
        delivery: Delivery,
        poses: Vec<Option<Pose>>,
    },
}

impl Look {
    pub fn is_hidden(&self) -> bool {
        matches!(self, Self::Whole(Pose::Hidden))
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum WipeFrom {
    Left,
    Right,
    Top,
    Bottom,
}

/// How far, as a fraction of the slide, a rise or a drop travels.
const RISE_DISTANCE: f32 = 0.06;
/// How far a slide comes from.
const SLIDE_DISTANCE: f32 = 0.15;
/// How high a bounce falls from.
const BOUNCE_HEIGHT: f32 = 0.12;
/// How blurred a blur starts, as a fraction of the slide's height.
const BLUR_AMOUNT: f32 = 0.02;

fn ease_out(p: f64) -> f64 {
    1.0 - (1.0 - p).powi(3)
}

/// From 0 to 1, going a little past 1 and back on the way.
fn back_out(p: f64) -> f64 {
    1.0 + 2.70158 * (p - 1.0).powi(3) + 1.70158 * (p - 1.0).powi(2)
}

/// From 0 to 1 with a ball's bounces at the end.
fn bounce_out(p: f64) -> f64 {
    const N: f64 = 7.5625;
    const D: f64 = 2.75;
    if p < 1.0 / D {
        N * p * p
    } else if p < 2.0 / D {
        let p = p - 1.5 / D;
        N * p * p + 0.75
    } else if p < 2.5 / D {
        let p = p - 2.25 / D;
        N * p * p + 0.9375
    } else {
        let p = p - 2.625 / D;
        N * p * p + 0.984375
    }
}

/// From 0 to 1, springing past it and back a few times.
fn elastic_out(p: f64) -> f64 {
    2f64.powf(-10.0 * p) * ((p * 10.0 - 0.75) * (2.0 * std::f64::consts::PI / 3.0)).sin() + 1.0
}

/// Where a directed effect comes from, as a unit step.
fn from_side(direction: Option<&str>, fallback: &str) -> (f32, f32) {
    match direction.unwrap_or(fallback) {
        "left" => (-1.0, 0.0),
        "right" => (1.0, 0.0),
        "top" | "up" => (0.0, -1.0),
        _ => (0.0, 1.0),
    }
}

/// An effect `linear` of the way in (0 nothing of it, 1 all of it, in time:
/// each effect eases itself) as a pose. A build out plays it backwards.
pub fn pose_of(effect: &str, direction: Option<&str>, linear: f64) -> Pose {
    if linear <= 0.0 {
        return Pose::Hidden;
    }
    let still = Pose::Moving {
        opacity: 1.0,
        dx: 0.0,
        dy: 0.0,
        scale: 1.0,
        scale_x: 1.0,
        rotate: 0.0,
        blur: 0.0,
        wipe: None,
    };
    if linear >= 1.0 {
        return still;
    }
    // As made, which each effect then changes.
    let (opacity, dx, dy, scale, scale_x, rotate, blur, wipe) = (
        1.0_f32, 0.0_f32, 0.0_f32, 1.0_f32, 1.0_f32, 0.0_f32, 0.0_f32, None,
    );
    let shown = ease_out(linear);
    let away = (1.0 - shown) as f32;
    let s = shown as f32;
    let (opacity, dx, dy, scale, scale_x, rotate, blur, wipe) = match effect {
        "appear" => (opacity, dx, dy, scale, scale_x, rotate, blur, wipe),
        "fly" => {
            let (x, y) = from_side(direction, "bottom");
            (
                opacity,
                x * away,
                y * away,
                scale,
                scale_x,
                rotate,
                blur,
                wipe,
            )
        }
        // A short way in from one side, fading in.
        "slide" => {
            let (x, y) = from_side(direction, "bottom");
            (
                s,
                x * SLIDE_DISTANCE * away,
                y * SLIDE_DISTANCE * away,
                scale,
                scale_x,
                rotate,
                blur,
                wipe,
            )
        }
        "wipe" => {
            let from = match direction.unwrap_or("left") {
                "right" => WipeFrom::Right,
                "top" | "up" => WipeFrom::Top,
                "bottom" | "down" => WipeFrom::Bottom,
                _ => WipeFrom::Left,
            };
            (
                opacity,
                dx,
                dy,
                scale,
                scale_x,
                rotate,
                blur,
                Some((from, s)),
            )
        }
        "zoom" => (s, dx, dy, 0.3 + 0.7 * s, scale_x, rotate, blur, wipe),
        // Up a little from below, fading in: a lyric line arriving.
        "rise" => (
            s,
            dx,
            RISE_DISTANCE * away,
            scale,
            scale_x,
            rotate,
            blur,
            wipe,
        ),
        // Down a little from above, fading in.
        "drop" => (
            s,
            dx,
            -RISE_DISTANCE * away,
            scale,
            scale_x,
            rotate,
            blur,
            wipe,
        ),
        // Grows past its size and settles back, fading in quickly.
        "pop" => (
            (s * 2.0).min(1.0),
            dx,
            dy,
            (0.5 + 0.5 * back_out(shown)) as f32,
            scale_x,
            rotate,
            blur,
            wipe,
        ),
        // From nothing to its size, solid all the way.
        "grow" => (
            opacity,
            dx,
            dy,
            0.02 + 0.98 * s,
            scale_x,
            rotate,
            blur,
            wipe,
        ),
        // Falls from above and bounces to rest.
        "bounce" => (
            ((linear * 4.0).min(1.0)) as f32,
            dx,
            -BOUNCE_HEIGHT * (1.0 - bounce_out(linear) as f32),
            scale,
            scale_x,
            rotate,
            blur,
            wipe,
        ),
        // Springs out to its size, past it and back.
        "elastic" => (
            ((linear * 4.0).min(1.0)) as f32,
            dx,
            dy,
            elastic_out(linear).max(0.0) as f32,
            scale_x,
            rotate,
            blur,
            wipe,
        ),
        // Turns in a half turn as it grows.
        "spin" => (s, dx, dy, 0.3 + 0.7 * s, scale_x, -180.0 * away, blur, wipe),
        // Turns over like a card, edge first.
        "flip" => ((s * 2.0).min(1.0), dx, dy, scale, s, rotate, blur, wipe),
        // Drawn in from wide, as if its letters were pulled together.
        "stretch" => (s, dx, dy, scale, 1.0 + 1.5 * away, rotate, blur, wipe),
        // Out of focus to sharp, fading in.
        "blur" => (s, dx, dy, scale, scale_x, rotate, BLUR_AMOUNT * away, wipe),
        // A fade, and anything this build does not know.
        _ => (s, dx, dy, scale, scale_x, rotate, blur, wipe),
    };
    Pose::Moving {
        opacity,
        dx,
        dy,
        scale,
        scale_x,
        rotate,
        blur,
        wipe,
    }
}

/// How far one build has run at `step`, `elapsed_ms` into it, from
/// `begin_ms` for `duration_ms`: 0 not begun, 1 done.
fn progress_of(
    placed: &Placed,
    step: usize,
    elapsed_ms: f64,
    begin_ms: f64,
    duration_ms: f64,
) -> f64 {
    if placed.step < step {
        1.0
    } else if placed.step > step {
        0.0
    } else if duration_ms <= 0.0 {
        if elapsed_ms >= begin_ms {
            1.0
        } else {
            0.0
        }
    } else {
        ((elapsed_ms - begin_ms) / duration_ms).clamp(0.0, 1.0)
    }
}

/// An object's look part-way through one of its builds.
fn look_of(placed: &Placed, step: usize, elapsed_ms: f64) -> Look {
    let shown = |p: f64| match placed.phase {
        Phase::In => p,
        Phase::Out => 1.0 - p,
    };
    let pose = |p: f64| pose_of(&placed.effect, placed.direction.as_deref(), shown(p));
    if placed.units <= 1 {
        let p = progress_of(
            placed,
            step,
            elapsed_ms,
            placed.begin_ms,
            placed.duration_ms,
        );
        return Look::Whole(pose(p));
    }
    let poses = (0..placed.units)
        .map(|unit| {
            let begin = placed.begin_ms + placed.gap_ms * unit as f64;
            let p = progress_of(placed, step, elapsed_ms, begin, placed.duration_ms);
            // All the way in is as made; all the way out, gone.
            (shown(p) < 1.0).then(|| pose(p))
        })
        .collect();
    Look::Units {
        delivery: placed.delivery,
        poses,
    }
}

/// The looks at `step` (`usize::MAX`: everything built), `elapsed_ms` into
/// it. An object missing from the map is drawn as it was made. Also whether
/// anything is still moving, so the frames keep coming.
pub fn poses(timeline: &Timeline, step: usize, elapsed_ms: f64) -> (HashMap<String, Look>, bool) {
    let mut moving = false;
    let mut ins: HashMap<&str, (&Placed, f64)> = HashMap::new();
    let mut outs: HashMap<&str, (&Placed, f64)> = HashMap::new();
    for placed in &timeline.placed {
        // How far the whole build has run, its first piece to its last.
        let p = progress_of(placed, step, elapsed_ms, placed.begin_ms, placed.span_ms());
        if placed.step == step && (p < 1.0 || elapsed_ms < placed.begin_ms) {
            moving = true;
        }
        let into = match placed.phase {
            Phase::In => &mut ins,
            Phase::Out => &mut outs,
        };
        into.insert(placed.element_id.as_str(), (placed, p));
    }

    let mut out = HashMap::new();
    let ids: Vec<&str> = ins.keys().chain(outs.keys()).copied().collect();
    for id in ids {
        if out.contains_key(id) {
            continue;
        }
        let look = match (ins.get(id), outs.get(id)) {
            (_, Some((_, p))) if *p >= 1.0 => Some(Look::Whole(Pose::Hidden)),
            (_, Some((placed, p))) if *p > 0.0 => Some(look_of(placed, step, elapsed_ms)),
            (Some((placed, p)), _) if *p < 1.0 => Some(look_of(placed, step, elapsed_ms)),
            _ => None,
        };
        if let Some(look) = look {
            out.insert(id.to_owned(), look);
        }
    }
    (out, moving)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn elements(value: serde_json::Value) -> Vec<SlideElement> {
        serde_json::from_value(value).unwrap()
    }

    fn whole(look: &Look) -> Pose {
        match look {
            Look::Whole(pose) => *pose,
            Look::Units { .. } => panic!("expected one pose for the whole object"),
        }
    }

    fn deck() -> Vec<SlideElement> {
        elements(json!([
            { "id": "title", "type": "text", "x": 0, "y": 0, "width": 10, "height": 10, "content": "",
              "builds": { "in": { "effect": "fade", "durationMs": 400, "start": "with-previous" } } },
            { "id": "a", "type": "text", "x": 0, "y": 0, "width": 10, "height": 10, "content": "",
              "builds": { "in": { "effect": "fly", "direction": "left", "durationMs": 500, "start": "on-click" } } },
            { "id": "b", "type": "text", "x": 0, "y": 0, "width": 10, "height": 10, "content": "",
              "builds": { "in": { "effect": "wipe", "durationMs": 300, "delayMs": 200, "start": "after-previous" },
                          "out": { "effect": "fade", "durationMs": 300, "start": "on-click" } } },
            { "id": "plain", "type": "shape", "x": 0, "y": 0, "width": 10, "height": 10, "content": "" }
        ]))
    }

    #[test]
    fn steps_come_from_how_each_build_starts() {
        let timeline = timeline(&deck());
        let steps: Vec<(String, usize, f64)> = timeline
            .placed
            .iter()
            .map(|p| {
                (
                    format!("{}:{:?}", p.element_id, p.phase),
                    p.step,
                    p.begin_ms,
                )
            })
            .collect();
        assert_eq!(
            steps,
            vec![
                ("title:In".to_owned(), 0, 0.0),
                ("a:In".to_owned(), 1, 0.0),
                ("b:In".to_owned(), 1, 700.0),
                ("b:Out".to_owned(), 2, 0.0),
            ]
        );
        assert_eq!(timeline.click_steps, 2);
    }

    #[test]
    fn what_shows_at_each_step() {
        let timeline = timeline(&deck());
        // The slide has just come up: the title fades in, the rest wait.
        let (poses_now, moving) = poses(&timeline, 0, 100.0);
        assert!(moving);
        assert!(
            matches!(whole(&poses_now["title"]), Pose::Moving { opacity, .. } if opacity > 0.0 && opacity < 1.0)
        );
        assert_eq!(whole(&poses_now["a"]), Pose::Hidden);
        assert_eq!(whole(&poses_now["b"]), Pose::Hidden);
        assert!(!poses_now.contains_key("plain"), "no builds: drawn as made");

        // Settled: the title as made, still waiting for the click.
        let (settled, moving) = poses(&timeline, 0, 1_000.0);
        assert!(!moving);
        assert!(!settled.contains_key("title"));
        assert_eq!(whole(&settled["a"]), Pose::Hidden);

        // The first click: `a` flies in from the left, then `b` wipes.
        let (flying, _) = poses(&timeline, 1, 250.0);
        assert!(matches!(whole(&flying["a"]), Pose::Moving { dx, .. } if dx < 0.0));
        assert_eq!(
            whole(&flying["b"]),
            Pose::Hidden,
            "after the fly and its delay"
        );
        let (wiping, _) = poses(&timeline, 1, 800.0);
        assert!(
            matches!(whole(&wiping["b"]), Pose::Moving { wipe: Some((WipeFrom::Left, shown)), .. } if shown > 0.0 && shown < 1.0)
        );

        // The second click takes `b` away; everything built shows all as made.
        let (gone, _) = poses(&timeline, 2, 1_000.0);
        assert_eq!(whole(&gone["b"]), Pose::Hidden);
        assert!(!gone.contains_key("a"));
        let (all, moving) = poses(&timeline, usize::MAX, 0.0);
        assert_eq!(
            all.get("b"),
            Some(&Look::Whole(Pose::Hidden)),
            "built out at the end"
        );
        assert!(!all.contains_key("a"));
        assert!(!moving);
    }

    #[test]
    fn each_effect_starts_hidden_and_ends_as_made() {
        for effect in [
            "appear", "fade", "wipe", "fly", "zoom", "rise", "drop", "pop", "grow", "slide",
            "bounce", "elastic", "spin", "flip", "stretch", "blur",
        ] {
            assert_eq!(
                pose_of(effect, None, 0.0),
                Pose::Hidden,
                "{effect} starts hidden"
            );
            match pose_of(effect, None, 1.0) {
                Pose::Moving {
                    opacity,
                    dx,
                    dy,
                    scale,
                    scale_x,
                    rotate,
                    blur,
                    wipe,
                } => {
                    assert!((scale_x - 1.0).abs() < 1e-4, "{effect} ends its own width");
                    assert!(
                        rotate.abs() < 1e-4 && blur.abs() < 1e-4,
                        "{effect} ends upright and sharp"
                    );
                    assert!((opacity - 1.0).abs() < 1e-4, "{effect} ends opaque");
                    assert!(dx.abs() < 1e-4 && dy.abs() < 1e-4, "{effect} ends in place");
                    assert!((scale - 1.0).abs() < 1e-4, "{effect} ends its own size");
                    assert!(wipe.map_or(true, |(_, shown)| (shown - 1.0).abs() < 1e-4));
                }
                Pose::Hidden => panic!("{effect} ends shown"),
            }
        }
        // Pop goes past its size on the way.
        assert!(matches!(pose_of("pop", None, 0.8), Pose::Moving { scale, .. } if scale > 1.0));
        // Rise comes from below.
        assert!(matches!(pose_of("rise", None, 0.5), Pose::Moving { dy, .. } if dy > 0.0));
    }

    #[test]
    fn one_text_box_builds_word_by_word() {
        let slide = elements(json!([
            { "id": "lyric", "type": "text", "x": 0, "y": 0, "width": 10, "height": 10,
              "content": "Let the  army\nroar",
              "builds": { "in": { "effect": "pop", "durationMs": 400, "start": "with-previous",
                                  "delivery": "word", "gapMs": 200 } } },
            { "id": "next", "type": "text", "x": 0, "y": 0, "width": 10, "height": 10, "content": "",
              "builds": { "in": { "effect": "fade", "durationMs": 100, "start": "after-previous" } } }
        ]));
        let timeline = timeline(&slide);
        assert_eq!(timeline.placed[0].units, 4, "Let, the, army, roar");
        assert_eq!(timeline.placed[0].delivery, Delivery::Word);
        // The next build waits for the last word: 3 gaps and its length.
        assert_eq!(timeline.placed[1].begin_ms, 1_000.0);
        assert_eq!(timeline.click_steps, 0);

        let (looks, moving) = poses(&timeline, 0, 300.0);
        assert!(moving);
        let Look::Units { poses: words, .. } = &looks["lyric"] else {
            panic!("one look a word");
        };
        assert_eq!(words.len(), 4);
        assert!(
            matches!(words[0], Some(Pose::Moving { .. })),
            "the first word is arriving"
        );
        assert!(
            matches!(words[1], Some(Pose::Moving { .. })),
            "the second has begun"
        );
        assert_eq!(words[2], Some(Pose::Hidden), "the third waits");
        assert_eq!(words[3], Some(Pose::Hidden));

        let (settled, _) = poses(&timeline, 0, 2_000.0);
        assert!(!settled.contains_key("lyric"), "all in: drawn as made");
    }

    #[test]
    fn letters_and_lines_are_counted_as_the_words_read() {
        let slide = elements(json!([
            { "id": "a", "type": "text", "content": "Hi you\n\nthere",
              "builds": { "in": { "effect": "fade", "delivery": "letter" } } },
            { "id": "b", "type": "text", "content": "Hi you\n\nthere",
              "builds": { "in": { "effect": "fade", "delivery": "line" } } },
            { "id": "c", "type": "shape", "content": "",
              "builds": { "in": { "effect": "fade", "delivery": "word" } } }
        ]));
        let timeline = timeline(&slide);
        assert_eq!(timeline.placed[0].units, 10);
        assert_eq!(
            timeline.placed[0].gap_ms, 50.0,
            "a letter's gap unless one is given"
        );
        assert_eq!(timeline.placed[1].units, 2, "the empty line is not a step");
        assert_eq!(timeline.placed[2].units, 1, "a shape builds all at once");
        assert_eq!(timeline.placed[2].delivery, Delivery::All);
    }

    #[test]
    fn a_build_out_word_by_word_takes_the_words_away_in_turn() {
        let slide = elements(json!([
            { "id": "t", "type": "text", "content": "one two",
              "builds": { "out": { "effect": "fade", "durationMs": 100, "start": "on-click",
                                   "delivery": "word", "gapMs": 100 } } }
        ]));
        let timeline = timeline(&slide);
        let (looks, _) = poses(&timeline, 1, 150.0);
        let Look::Units { poses: words, .. } = &looks["t"] else {
            panic!("one look a word");
        };
        assert_eq!(words[0], Some(Pose::Hidden), "the first word has gone");
        assert!(matches!(words[1], Some(Pose::Moving { opacity, .. }) if opacity < 1.0));
        let (gone, _) = poses(&timeline, 1, 1_000.0);
        assert_eq!(gone["t"], Look::Whole(Pose::Hidden));
    }

    #[test]
    fn a_slide_without_builds_has_no_steps() {
        let timeline = timeline(&elements(
            json!([{ "id": "x", "type": "text", "content": "" }]),
        ));
        assert!(timeline.is_empty());
        assert_eq!(timeline.click_steps, 0);
    }
}
