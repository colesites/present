//! How a transition's progress is shaped over its duration.
//!
//! One place, so that no transition carries its own copy: every preset takes a
//! duration and an easing independently, and `Slide Left` eased `Bounce` is the
//! slide implementation with a different curve rather than another preset.
//!
//! Every curve maps 0 to 0 and 1 to 1. Some overshoot in between — `Back` and
//! `Elastic` deliberately go outside 0..=1 — so anything that uses the result
//! to index pixels must clamp, not assume.

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Deserialize, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum Easing {
    Linear,
    EaseIn,
    EaseOut,
    #[default]
    EaseInOut,
    Cubic,
    Quint,
    Exponential,
    Back,
    Elastic,
    Bounce,
}

impl Easing {
    /// The eased progress for a linear `t` in 0..=1.
    pub fn apply(self, t: f64) -> f64 {
        let t = t.clamp(0.0, 1.0);
        match self {
            Self::Linear => t,
            // Quadratic, which is what "ease in" means when nothing says
            // otherwise; `Cubic` and `Quint` are the sharper ones.
            Self::EaseIn => t * t,
            Self::EaseOut => 1.0 - (1.0 - t) * (1.0 - t),
            Self::EaseInOut => {
                if t < 0.5 {
                    2.0 * t * t
                } else {
                    1.0 - (-2.0 * t + 2.0).powi(2) / 2.0
                }
            }
            Self::Cubic => {
                if t < 0.5 {
                    4.0 * t * t * t
                } else {
                    1.0 - (-2.0 * t + 2.0).powi(3) / 2.0
                }
            }
            Self::Quint => {
                if t < 0.5 {
                    16.0 * t.powi(5)
                } else {
                    1.0 - (-2.0 * t + 2.0).powi(5) / 2.0
                }
            }
            Self::Exponential => {
                if t == 0.0 {
                    0.0
                } else if t == 1.0 {
                    1.0
                } else if t < 0.5 {
                    2f64.powf(20.0 * t - 10.0) / 2.0
                } else {
                    (2.0 - 2f64.powf(-20.0 * t + 10.0)) / 2.0
                }
            }
            Self::Back => {
                // Pulls back before it goes, and overshoots at the end.
                const C1: f64 = 1.70158;
                const C2: f64 = C1 * 1.525;
                if t < 0.5 {
                    ((2.0 * t).powi(2) * ((C2 + 1.0) * 2.0 * t - C2)) / 2.0
                } else {
                    ((2.0 * t - 2.0).powi(2) * ((C2 + 1.0) * (t * 2.0 - 2.0) + C2) + 2.0) / 2.0
                }
            }
            Self::Elastic => {
                const C: f64 = std::f64::consts::TAU / 4.5;
                if t == 0.0 {
                    0.0
                } else if t == 1.0 {
                    1.0
                } else if t < 0.5 {
                    -(2f64.powf(20.0 * t - 10.0) * ((20.0 * t - 11.125) * C).sin()) / 2.0
                } else {
                    (2f64.powf(-20.0 * t + 10.0) * ((20.0 * t - 11.125) * C).sin()) / 2.0 + 1.0
                }
            }
            Self::Bounce => 1.0 - bounce_out(1.0 - t),
        }
    }
}

/// The bounce curve, written once and mirrored for the ease-in half.
fn bounce_out(t: f64) -> f64 {
    const N: f64 = 7.5625;
    const D: f64 = 2.75;
    if t < 1.0 / D {
        N * t * t
    } else if t < 2.0 / D {
        let t = t - 1.5 / D;
        N * t * t + 0.75
    } else if t < 2.5 / D {
        let t = t - 2.25 / D;
        N * t * t + 0.9375
    } else {
        let t = t - 2.625 / D;
        N * t * t + 0.984_375
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const ALL: [Easing; 10] = [
        Easing::Linear,
        Easing::EaseIn,
        Easing::EaseOut,
        Easing::EaseInOut,
        Easing::Cubic,
        Easing::Quint,
        Easing::Exponential,
        Easing::Back,
        Easing::Elastic,
        Easing::Bounce,
    ];

    #[test]
    fn every_curve_starts_at_the_start_and_ends_at_the_end() {
        for easing in ALL {
            assert!(
                easing.apply(0.0).abs() < 1e-9,
                "{easing:?} does not start at 0"
            );
            assert!(
                (easing.apply(1.0) - 1.0).abs() < 1e-9,
                "{easing:?} does not end at 1"
            );
        }
    }

    #[test]
    fn progress_outside_the_transition_is_held_at_its_ends() {
        for easing in ALL {
            assert_eq!(easing.apply(-1.0), easing.apply(0.0), "{easing:?}");
            assert_eq!(easing.apply(2.0), easing.apply(1.0), "{easing:?}");
        }
    }

    #[test]
    fn the_ordinary_curves_never_go_outside_the_transition() {
        // Back and Elastic overshoot on purpose; anything drawing with them
        // has to clamp. The rest must not surprise a caller that does not.
        for easing in ALL {
            if matches!(easing, Easing::Back | Easing::Elastic) {
                continue;
            }
            for step in 0..=100 {
                let eased = easing.apply(f64::from(step) / 100.0);
                assert!(
                    (-1e-9..=1.0 + 1e-9).contains(&eased),
                    "{easing:?} reached {eased} at {step}%"
                );
            }
        }
    }

    #[test]
    fn a_curve_only_ever_moves_forwards_where_it_should() {
        for easing in [
            Easing::Linear,
            Easing::EaseIn,
            Easing::EaseOut,
            Easing::EaseInOut,
            Easing::Cubic,
            Easing::Quint,
            Easing::Exponential,
        ] {
            let mut previous = -1.0;
            for step in 0..=100 {
                let eased = easing.apply(f64::from(step) / 100.0);
                assert!(eased >= previous - 1e-9, "{easing:?} went backwards");
                previous = eased;
            }
        }
    }

    #[test]
    fn the_names_are_the_ones_the_react_tree_sends() {
        for (easing, name) in [
            (Easing::Linear, "\"linear\""),
            (Easing::EaseIn, "\"ease-in\""),
            (Easing::EaseOut, "\"ease-out\""),
            (Easing::EaseInOut, "\"ease-in-out\""),
            (Easing::Exponential, "\"exponential\""),
        ] {
            assert_eq!(serde_json::to_string(&easing).unwrap(), name);
            assert_eq!(serde_json::from_str::<Easing>(name).unwrap(), easing);
        }
        assert_eq!(Easing::default(), Easing::EaseInOut);
    }
}
