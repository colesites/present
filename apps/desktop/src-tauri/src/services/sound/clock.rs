//! Where the live video is, as heard: the one clock every picture of it keeps.
//!
//! Each decoder of the live video — the audience view, NDI, the operator's
//! preview, the center pane, the stage displays — used to keep its own copy of
//! the time, anchored whenever a position report reached it and corrected only
//! past a tolerance of 0.12 s. Copies anchored at different moments settled at
//! different offsets, so the pictures disagreed with each other and with the
//! sound. Now the sound engine publishes where the device has got to
//! (`mod.rs`), and every decoder asks this for the position at the instant its
//! picture will be seen: one clock, read the same way everywhere.
//!
//! **The operator's changes are scheduled, not immediate.** Every picture
//! reaches its screen some time after it is drawn: the audience view at its
//! next refresh, a panel in the operator window a few frames later. A change
//! applied the moment it was asked for reached the audience view first and
//! the operator's own panel last, so the panel that does the controlling was
//! the one behind. So a change is published ahead — "from this instant, here,
//! running or held" — and every picture draws it for the moment it is due,
//! each as far ahead as it needs, and the sound makes it then too
//! ([`GO_DELAY`]). Every screen changes on the same frame, as in ProPresenter.
//!
//! Process-wide rather than in Tauri state because the decoders that read it
//! (`ndi::video_feed`) are deliberately free of the app handle.

use std::path::{Path, PathBuf};
#[cfg(not(test))]
use std::sync::RwLock;
use std::time::{Duration, Instant};

use crate::services::media_protocol;

/// How long after the operator's click a change is made everywhere at once.
///
/// Longer than the slowest picture takes to reach its screen (a panel in the
/// operator window, about four frames) so that none is late, and short enough
/// to read as immediate.
pub const GO_DELAY: Duration = Duration::from_millis(100);

/// The live video from one instant on.
#[derive(Debug, Clone, PartialEq)]
pub struct Segment {
    /// The file, or `None` for no live video from `at` on.
    pub path: Option<PathBuf>,
    /// Where it is at `at`.
    pub seconds: f64,
    pub playing: bool,
    pub at: Instant,
    /// How fast it plays: 1 as recorded.
    pub rate: f64,
}

impl Segment {
    /// Where it is at `now`.
    pub fn seconds_at(&self, now: Instant) -> f64 {
        if self.playing {
            self.seconds + now.saturating_duration_since(self.at).as_secs_f64() * self.rate
        } else {
            self.seconds
        }
    }
}

/// The clock: where the live video is now, and the changes already made for
/// moments to come.
#[derive(Debug, Clone, PartialEq)]
pub struct HeardClock {
    pub now: Segment,
    /// In order; each takes over at its own `at`.
    pub scheduled: Vec<Segment>,
}

impl HeardClock {
    /// The segment in force at `now`.
    pub fn segment_at(&self, now: Instant) -> &Segment {
        self.scheduled
            .iter()
            .rev()
            .find(|segment| segment.at <= now)
            .unwrap_or(&self.now)
    }
}

#[cfg(not(test))]
static CLOCK: RwLock<Option<HeardClock>> = RwLock::new(None);

// Each test thread its own clock: tests run side by side, and one publishing
// would move the pictures of another.
#[cfg(test)]
thread_local! {
    static CLOCK: std::cell::RefCell<Option<HeardClock>> = const { std::cell::RefCell::new(None) };
}

/// Publish the clock, or that there is no live video and none to come.
pub fn publish(clock: Option<HeardClock>) {
    #[cfg(not(test))]
    {
        *CLOCK
            .write()
            .unwrap_or_else(|poisoned| poisoned.into_inner()) = clock;
    }
    #[cfg(test)]
    CLOCK.with(|cell| *cell.borrow_mut() = clock);
}

fn read<T>(look: impl FnOnce(Option<&HeardClock>) -> T) -> T {
    #[cfg(not(test))]
    {
        look(
            CLOCK
                .read()
                .unwrap_or_else(|poisoned| poisoned.into_inner())
                .as_ref(),
        )
    }
    #[cfg(test)]
    {
        CLOCK.with(|cell| look(cell.borrow().as_ref()))
    }
}

/// Where the video `url` names is at `now`, and whether it is running — if it
/// is the live video then. `now` may be ahead of the wall's clock: a picture
/// that will be seen later asks for then.
pub fn position_for(url: &str, now: Instant) -> Option<(f64, bool)> {
    let path = media_protocol::path_from_uri(url)
        .or_else(|| url.starts_with('/').then(|| PathBuf::from(url)))?;
    read(|clock| {
        let segment = clock?.segment_at(now);
        let live = segment.path.as_deref()?;
        same_file(&path, live).then(|| (segment.seconds_at(now), segment.playing))
    })
}

fn same_file(a: &Path, b: &Path) -> bool {
    a == b
}

#[cfg(test)]
mod tests {
    use super::*;

    fn segment(path: &str, seconds: f64, playing: bool, at: Instant) -> Segment {
        Segment {
            path: Some(path.into()),
            seconds,
            playing,
            at,
            rate: 1.0,
        }
    }

    #[test]
    fn a_running_segment_moves_on_and_a_held_one_does_not() {
        let at = Instant::now();
        let mut running = segment("/a.mp4", 10.0, true, at);
        assert!((running.seconds_at(at + Duration::from_millis(250)) - 10.25).abs() < 1e-9);
        running.playing = false;
        assert_eq!(running.seconds_at(at + Duration::from_secs(5)), 10.0);
    }

    #[test]
    fn a_change_takes_over_at_its_moment_and_not_before() {
        let start = Instant::now();
        let paused_at = start + GO_DELAY;
        let clock = HeardClock {
            now: segment("/a.mp4", 10.0, true, start),
            scheduled: vec![segment("/a.mp4", 10.1, false, paused_at)],
        };
        let before = clock.segment_at(paused_at - Duration::from_millis(1));
        assert!(before.playing, "still running until the pause is due");
        let after = clock.segment_at(paused_at + Duration::from_secs(3));
        assert!(!after.playing);
        assert_eq!(after.seconds_at(paused_at + Duration::from_secs(3)), 10.1);
    }
}
