//! Transitions: what happens between one slide and the next.
//!
//! Present is a presentation application, not a video editor, so the default
//! is **not** to transition the whole picture. Going from "Amazing Grace" to
//! "How sweet the sound" changes the words; the background video behind them
//! carries on playing, untouched, and the logo does not move. Only what
//! changed takes part ([`change_detection`]), unless the operator asks for the
//! whole slide.
//!
//! The pieces:
//!
//! * [`config`] — what the operator chose, as a slide stores it.
//! * [`easing`] — how progress is shaped, once, for every preset.
//! * [`registry`] — the library, as data the picker reads.
//! * [`change_detection`] — which layers moved.
//!
//! Nothing here draws yet: this is the part that has to be right before
//! anything is drawn, and it is all testable without a screen.

pub mod change_detection;
pub mod config;
pub mod easing;
pub mod registry;

pub use change_detection::{compare, Changes};
pub use config::{Direction, Mode, Transition};
pub use easing::Easing;
pub use registry::{Category, Preset, Primitive, PRESETS};
