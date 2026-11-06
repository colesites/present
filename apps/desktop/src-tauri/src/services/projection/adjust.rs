//! Automatic quality adjustment: the resolution, then the frame rate, stepped
//! down while the screens cannot keep up, and back up once they can.
//!
//! Every screen's loop says, each tick, whether it kept to its time
//! (`record`). Once a second the ticks are counted. A step down needs most of
//! four seconds running with more than a quarter of the ticks late — never one
//! slow moment, a file opening or a window being dragged. A step back up needs
//! thirty seconds with almost none late. One step at a time, so the audience
//! sees at most a slightly softer slide, never a picture that jumps about.
//!
//! What it steps is the processor's drawing and the size the video is scaled
//! to, never the video's own frames: a 30 frames a second video is still shown
//! at 30.

use std::sync::{Mutex, MutexGuard, PoisonError};
use std::time::{Duration, Instant};

use super::{FrameRate, Resolution};

/// The fraction of a second's ticks that were late for it to count as behind.
const BEHIND: f64 = 0.25;
/// And for it to count as comfortably keeping up.
const KEEPING_UP: f64 = 0.05;
/// Seconds behind in a row before a step down.
const BEHIND_FOR: u32 = 4;
/// Seconds keeping up in a row before a step back up.
const KEEPING_UP_FOR: u32 = 30;
/// The most steps down: from 2160 to 720 is three, and 60 to 24 three more.
const MOST: u8 = 6;
/// A second with fewer ticks than this says nothing either way: the screens
/// were barely drawing.
const FEWEST_TICKS: u32 = 20;

/// The counting, apart from the clock, so it can be tested.
#[derive(Debug, Default, Clone, PartialEq, Eq)]
pub struct Controller {
    level: u8,
    behind: u32,
    keeping_up: u32,
}

/// What a second's count did.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Change {
    Down(u8),
    Up(u8),
}

impl Controller {
    /// Steps below what the operator set.
    pub fn level(&self) -> u8 {
        self.level
    }

    /// One second's ticks, `late` of them late.
    pub fn second(&mut self, ticks: u32, late: u32) -> Option<Change> {
        if ticks < FEWEST_TICKS {
            return None;
        }
        let fraction = f64::from(late) / f64::from(ticks);
        if fraction > BEHIND {
            self.keeping_up = 0;
            self.behind += 1;
            if self.behind >= BEHIND_FOR && self.level < MOST {
                self.behind = 0;
                self.level += 1;
                return Some(Change::Down(self.level));
            }
        } else if fraction < KEEPING_UP {
            self.behind = 0;
            self.keeping_up += 1;
            if self.keeping_up >= KEEPING_UP_FOR && self.level > 0 {
                self.keeping_up = 0;
                self.level -= 1;
                return Some(Change::Up(self.level));
            }
        } else {
            // In between: neither way.
            self.behind = 0;
            self.keeping_up = 0;
        }
        None
    }
}

/// `level` steps below `resolution` and `frame_rate`: the resolution first,
/// down to 720, then the frame rate.
pub fn lowered(
    mut resolution: Resolution,
    mut frame_rate: FrameRate,
    level: u8,
) -> (Resolution, FrameRate) {
    for _ in 0..level {
        if resolution.lower() != resolution {
            resolution = resolution.lower();
        } else {
            frame_rate = frame_rate.lower();
        }
    }
    (resolution, frame_rate)
}

struct Counting {
    controller: Controller,
    since: Instant,
    ticks: u32,
    late: u32,
}

static COUNTING: Mutex<Option<Counting>> = Mutex::new(None);

fn counting() -> MutexGuard<'static, Option<Counting>> {
    COUNTING.lock().unwrap_or_else(PoisonError::into_inner)
}

/// A screen's tick, and whether it was late.
pub fn record(late: bool) {
    let now = Instant::now();
    let mut counting = counting();
    let state = counting.get_or_insert_with(|| Counting {
        controller: Controller::default(),
        since: now,
        ticks: 0,
        late: 0,
    });
    state.ticks += 1;
    state.late += u32::from(late);
    if now.saturating_duration_since(state.since) < Duration::from_secs(1) {
        return;
    }
    let (ticks, late) = (state.ticks, state.late);
    state.ticks = 0;
    state.late = 0;
    state.since = now;
    match state.controller.second(ticks, late) {
        Some(Change::Down(level)) => tracing::info!(
            level,
            ticks,
            late,
            "the screens are falling behind; drawing them a step smaller"
        ),
        Some(Change::Up(level)) => {
            tracing::info!(level, "the screens are keeping up; a step back up")
        }
        None => {}
    }
}

/// The resolution and frame rate in force, after the adjustment.
pub fn apply(resolution: Resolution, frame_rate: FrameRate) -> (Resolution, FrameRate) {
    let level = counting()
        .as_ref()
        .map_or(0, |state| state.controller.level());
    lowered(resolution, frame_rate, level)
}

/// Steps below the operator's settings now.
pub fn level() -> u8 {
    counting()
        .as_ref()
        .map_or(0, |state| state.controller.level())
}

/// Start again from the operator's settings: they have just changed them.
pub fn reset() {
    *counting() = None;
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn one_slow_second_changes_nothing_and_four_step_down_once() {
        let mut controller = Controller::default();
        assert_eq!(controller.second(60, 40), None);
        assert_eq!(
            controller.second(60, 5),
            None,
            "caught up: the count starts again"
        );
        for _ in 0..3 {
            assert_eq!(controller.second(60, 40), None);
        }
        assert_eq!(controller.second(60, 40), Some(Change::Down(1)));
        assert_eq!(controller.level(), 1);
    }

    #[test]
    fn it_steps_back_up_only_after_half_a_minute_of_keeping_up() {
        let mut controller = Controller::default();
        for _ in 0..4 {
            controller.second(60, 40);
        }
        assert_eq!(controller.level(), 1);
        for _ in 0..29 {
            assert_eq!(controller.second(60, 0), None);
        }
        assert_eq!(controller.second(60, 0), Some(Change::Up(0)));
        for _ in 0..60 {
            assert_eq!(controller.second(60, 0), None, "never above what was set");
        }
    }

    #[test]
    fn a_second_with_hardly_any_ticks_says_nothing() {
        let mut controller = Controller::default();
        for _ in 0..10 {
            assert_eq!(controller.second(5, 5), None);
        }
        assert_eq!(controller.level(), 0);
    }

    #[test]
    fn the_resolution_goes_first_then_the_frame_rate() {
        let set = (Resolution::R2160, FrameRate::Fps60);
        assert_eq!(lowered(set.0, set.1, 0), set);
        assert_eq!(
            lowered(set.0, set.1, 1),
            (Resolution::R1440, FrameRate::Fps60)
        );
        assert_eq!(
            lowered(set.0, set.1, 3),
            (Resolution::R720, FrameRate::Fps60)
        );
        assert_eq!(
            lowered(set.0, set.1, 4),
            (Resolution::R720, FrameRate::Adaptive)
        );
        assert_eq!(
            lowered(set.0, set.1, 6),
            (Resolution::R720, FrameRate::Fps24)
        );
        assert_eq!(
            lowered(set.0, set.1, 9),
            (Resolution::R720, FrameRate::Fps24)
        );
    }
}
