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
//! What an object looks like at a moment is a [`Pose`]: hidden, part-way
//! through an effect, or as it was made. The compositor draws the pose; the
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
    let mut items: Vec<(f64, usize, String, Phase, Build)> = Vec::new();
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
                items.push((order, items.len(), id.clone(), phase, build));
            }
        }
    }
    items.sort_by(|a, b| a.0.total_cmp(&b.0).then(a.1.cmp(&b.1)));

    let mut placed = Vec::with_capacity(items.len());
    let mut step = 0usize;
    let (mut previous_base, mut previous_end) = (0.0_f64, 0.0_f64);
    for (index, (_, _, element_id, phase, build)) in items.into_iter().enumerate() {
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
        previous_base = base;
        previous_end = begin_ms + duration_ms;
        placed.push(Placed {
            element_id,
            phase,
            step,
            begin_ms,
            duration_ms,
            effect: build.effect,
            direction: build.direction,
        });
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
    /// middle, and cut back from one side (a wipe: how much shows, from where).
    Moving {
        opacity: f32,
        dx: f32,
        dy: f32,
        scale: f32,
        wipe: Option<(WipeFrom, f32)>,
    },
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum WipeFrom {
    Left,
    Right,
    Top,
    Bottom,
}

fn ease_out(p: f64) -> f64 {
    1.0 - (1.0 - p).powi(3)
}

fn ease_in(p: f64) -> f64 {
    p.powi(3)
}

/// An effect at `shown` (0 nothing of it, 1 all of it) as a pose.
fn pose_of(effect: &str, direction: Option<&str>, shown: f64) -> Pose {
    if shown <= 0.0 {
        return Pose::Hidden;
    }
    let shown = shown.min(1.0);
    let away = (1.0 - shown) as f32;
    let still = Pose::Moving {
        opacity: 1.0,
        dx: 0.0,
        dy: 0.0,
        scale: 1.0,
        wipe: None,
    };
    match effect {
        "appear" => still,
        "fly" => {
            let (dx, dy) = match direction.unwrap_or("bottom") {
                "left" => (-away, 0.0),
                "right" => (away, 0.0),
                "top" | "up" => (0.0, -away),
                _ => (0.0, away),
            };
            Pose::Moving {
                opacity: 1.0,
                dx,
                dy,
                scale: 1.0,
                wipe: None,
            }
        }
        "wipe" => {
            let from = match direction.unwrap_or("left") {
                "right" => WipeFrom::Right,
                "top" | "up" => WipeFrom::Top,
                "bottom" | "down" => WipeFrom::Bottom,
                _ => WipeFrom::Left,
            };
            Pose::Moving {
                opacity: 1.0,
                dx: 0.0,
                dy: 0.0,
                scale: 1.0,
                wipe: Some((from, shown as f32)),
            }
        }
        "zoom" => Pose::Moving {
            opacity: shown as f32,
            dx: 0.0,
            dy: 0.0,
            scale: (0.3 + 0.7 * shown) as f32,
            wipe: None,
        },
        // A fade, and anything this build does not know.
        _ => Pose::Moving {
            opacity: shown as f32,
            dx: 0.0,
            dy: 0.0,
            scale: 1.0,
            wipe: None,
        },
    }
}

/// The poses at `step` (`usize::MAX`: everything built), `elapsed_ms` into
/// it. An object missing from the map is drawn as it was made. Also whether
/// anything is still moving, so the frames keep coming.
pub fn poses(timeline: &Timeline, step: usize, elapsed_ms: f64) -> (HashMap<String, Pose>, bool) {
    let mut moving = false;
    // How far each build has run: 0 not begun, 1 done.
    let progress = |placed: &Placed| -> f64 {
        if placed.step < step {
            1.0
        } else if placed.step > step {
            0.0
        } else if placed.duration_ms <= 0.0 {
            if elapsed_ms >= placed.begin_ms {
                1.0
            } else {
                0.0
            }
        } else {
            ((elapsed_ms - placed.begin_ms) / placed.duration_ms).clamp(0.0, 1.0)
        }
    };
    let mut ins: HashMap<&str, (&Placed, f64)> = HashMap::new();
    let mut outs: HashMap<&str, (&Placed, f64)> = HashMap::new();
    for placed in &timeline.placed {
        let p = progress(placed);
        if p > 0.0 && p < 1.0 {
            moving = true;
        }
        if placed.step == step && placed.duration_ms <= 0.0 && elapsed_ms < placed.begin_ms {
            moving = true;
        }
        if placed.step == step && placed.duration_ms > 0.0 && p == 0.0 {
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
        let entering = ins.get(id);
        let leaving = outs.get(id);
        let pose = match (entering, leaving) {
            (_, Some((placed, p))) if *p >= 1.0 => {
                let _ = placed;
                Some(Pose::Hidden)
            }
            (_, Some((placed, p))) if *p > 0.0 => Some(pose_of(
                &placed.effect,
                placed.direction.as_deref(),
                1.0 - ease_in(*p),
            )),
            (Some((placed, p)), _) if *p < 1.0 => Some(pose_of(
                &placed.effect,
                placed.direction.as_deref(),
                ease_out(*p),
            )),
            _ => None,
        };
        if let Some(pose) = pose {
            out.insert(id.to_owned(), pose);
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
            matches!(poses_now["title"], Pose::Moving { opacity, .. } if opacity > 0.0 && opacity < 1.0)
        );
        assert_eq!(poses_now["a"], Pose::Hidden);
        assert_eq!(poses_now["b"], Pose::Hidden);
        assert!(!poses_now.contains_key("plain"), "no builds: drawn as made");

        // Settled: the title as made, still waiting for the click.
        let (settled, moving) = poses(&timeline, 0, 1_000.0);
        assert!(!moving);
        assert!(!settled.contains_key("title"));
        assert_eq!(settled["a"], Pose::Hidden);

        // The first click: `a` flies in from the left, then `b` wipes.
        let (flying, _) = poses(&timeline, 1, 250.0);
        assert!(matches!(flying["a"], Pose::Moving { dx, .. } if dx < 0.0));
        assert_eq!(flying["b"], Pose::Hidden, "after the fly and its delay");
        let (wiping, _) = poses(&timeline, 1, 800.0);
        assert!(
            matches!(wiping["b"], Pose::Moving { wipe: Some((WipeFrom::Left, shown)), .. } if shown > 0.0 && shown < 1.0)
        );

        // The second click takes `b` away; everything built shows all as made.
        let (gone, _) = poses(&timeline, 2, 1_000.0);
        assert_eq!(gone["b"], Pose::Hidden);
        assert!(!gone.contains_key("a"));
        let (all, moving) = poses(&timeline, usize::MAX, 0.0);
        assert_eq!(all.get("b"), Some(&Pose::Hidden), "built out at the end");
        assert!(!all.contains_key("a"));
        assert!(!moving);
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
