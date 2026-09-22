//! What the operator chose: one transition, serialisable with a slide.
//!
//! The shape the React tree already sends, kept deliberately small —
//! `{ type, direction, duration, easing, mode }` — because it travels with
//! every slide and a presentation holds thousands of them.

use serde::{Deserialize, Serialize};

use super::easing::Easing;

/// How long a transition is allowed to be.
///
/// A service is live: an operator who types 30 seconds into a box has made a
/// mistake, and the congregation should not have to sit through it.
pub const MAX_DURATION_MS: u32 = 5_000;

/// Which layers take part.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Deserialize, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum Mode {
    /// Only what actually changed moves. The background video carries on, the
    /// logo stays where it is, and the words are what transitions — which is
    /// what a presentation usually wants and what a video editor usually does
    /// not offer.
    #[default]
    ChangedElements,
    /// Everything at once, as one picture.
    FullSlide,
}

/// Which way a directional transition goes.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Deserialize, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum Direction {
    #[default]
    Left,
    Right,
    Up,
    Down,
    /// For the shapes and the radials: outwards from the middle.
    In,
    Out,
    Clockwise,
    CounterClockwise,
    /// Corner to corner.
    Diagonal,
}

impl Direction {
    /// The unit vector a slide or push moves along, as (x, y) in screen space.
    ///
    /// `None` for the directions that are not a translation — a wipe that
    /// turns, or a shape that opens — which use the direction differently.
    pub fn vector(self) -> Option<(f64, f64)> {
        Some(match self {
            Self::Left => (-1.0, 0.0),
            Self::Right => (1.0, 0.0),
            Self::Up => (0.0, -1.0),
            Self::Down => (0.0, 1.0),
            Self::Diagonal => (
                std::f64::consts::FRAC_1_SQRT_2,
                std::f64::consts::FRAC_1_SQRT_2,
            ),
            Self::In | Self::Out | Self::Clockwise | Self::CounterClockwise => return None,
        })
    }
}

/// One transition, as a slide carries it.
#[derive(Debug, Clone, PartialEq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Transition {
    /// A registry id: `"fade"`, `"slide"`, `"circle-reveal"`.
    #[serde(rename = "type")]
    pub kind: String,
    #[serde(default)]
    pub duration_ms: u32,
    #[serde(default)]
    pub easing: Easing,
    #[serde(default)]
    pub direction: Direction,
    #[serde(default)]
    pub mode: Mode,
}

impl Default for Transition {
    fn default() -> Self {
        Self::none()
    }
}

impl Transition {
    /// No transition at all: the next slide is simply there.
    pub fn none() -> Self {
        Self {
            kind: "cut".to_owned(),
            duration_ms: 0,
            easing: Easing::Linear,
            direction: Direction::default(),
            mode: Mode::default(),
        }
    }

    /// Whether this one actually animates anything.
    ///
    /// A zero duration is a cut however it is named, and a cut is a zero
    /// duration however long it says it is. Either way nothing is drawn twice.
    pub fn animates(&self) -> bool {
        self.duration_ms > 0 && self.kind != "cut" && self.kind != "none"
    }

    /// The duration to use, with an operator's mistake brought back in range.
    pub fn duration(&self) -> std::time::Duration {
        std::time::Duration::from_millis(u64::from(self.duration_ms.min(MAX_DURATION_MS)))
    }

    /// Where a transition of this length is at `elapsed`, eased, in 0..=1.
    pub fn progress(&self, elapsed: std::time::Duration) -> f64 {
        let duration = self.duration();
        if duration.is_zero() {
            return 1.0;
        }
        let linear = elapsed.as_secs_f64() / duration.as_secs_f64();
        self.easing.apply(linear.clamp(0.0, 1.0))
    }

    /// Whether it has finished by `elapsed`.
    pub fn is_over(&self, elapsed: std::time::Duration) -> bool {
        elapsed >= self.duration()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use std::time::Duration;

    #[test]
    fn a_transition_reads_the_way_the_react_tree_writes_it() {
        let written = json!({
            "type": "slide",
            "direction": "left",
            "durationMs": 400,
            "easing": "ease-in-out",
            "mode": "changed-elements",
        });
        let transition: Transition = serde_json::from_value(written.clone()).expect("read");
        assert_eq!(transition.kind, "slide");
        assert_eq!(transition.duration_ms, 400);
        assert_eq!(transition.direction, Direction::Left);
        assert_eq!(transition.easing, Easing::EaseInOut);
        assert_eq!(transition.mode, Mode::ChangedElements);
        assert_eq!(serde_json::to_value(&transition).unwrap(), written);
    }

    #[test]
    fn a_slide_that_says_only_its_kind_gets_sensible_everything_else() {
        let transition: Transition =
            serde_json::from_value(json!({ "type": "fade" })).expect("read");
        assert_eq!(transition.duration_ms, 0, "nothing said, nothing animated");
        assert_eq!(transition.mode, Mode::ChangedElements);
        assert!(!transition.animates());
    }

    #[test]
    fn a_cut_and_a_zero_duration_are_the_same_thing() {
        assert!(!Transition::none().animates());
        let named_but_instant = Transition {
            kind: "circle-reveal".to_owned(),
            duration_ms: 0,
            ..Transition::none()
        };
        assert!(!named_but_instant.animates());
        let cut_with_a_duration = Transition {
            kind: "cut".to_owned(),
            duration_ms: 400,
            ..Transition::none()
        };
        assert!(!cut_with_a_duration.animates());
    }

    #[test]
    fn an_operator_who_asks_for_half_a_minute_gets_five_seconds() {
        let long = Transition {
            kind: "fade".to_owned(),
            duration_ms: 30_000,
            ..Transition::none()
        };
        assert_eq!(long.duration(), Duration::from_millis(5_000));
        assert!(long.is_over(Duration::from_millis(5_000)));
    }

    #[test]
    fn progress_is_eased_and_ends_exactly_at_the_end() {
        let fade = Transition {
            kind: "fade".to_owned(),
            duration_ms: 400,
            easing: Easing::Linear,
            ..Transition::none()
        };
        assert_eq!(fade.progress(Duration::ZERO), 0.0);
        assert!((fade.progress(Duration::from_millis(200)) - 0.5).abs() < 1e-9);
        assert_eq!(fade.progress(Duration::from_millis(400)), 1.0);
        assert_eq!(
            fade.progress(Duration::from_secs(9)),
            1.0,
            "a frame that arrives late finishes it rather than overshooting"
        );

        let eased = Transition {
            easing: Easing::EaseInOut,
            ..fade.clone()
        };
        assert!(
            eased.progress(Duration::from_millis(100)) < fade.progress(Duration::from_millis(100)),
            "ease-in-out starts slower than linear"
        );
    }

    #[test]
    fn a_zero_length_transition_is_already_finished() {
        let cut = Transition::none();
        assert_eq!(cut.progress(Duration::ZERO), 1.0);
        assert!(cut.is_over(Duration::ZERO));
    }

    #[test]
    fn the_directions_that_are_a_movement_say_which_way() {
        assert_eq!(Direction::Left.vector(), Some((-1.0, 0.0)));
        assert_eq!(Direction::Up.vector(), Some((0.0, -1.0)));
        assert_eq!(
            Direction::In.vector(),
            None,
            "a shape opens, it does not move"
        );
        assert_eq!(Direction::Clockwise.vector(), None);
    }
}
