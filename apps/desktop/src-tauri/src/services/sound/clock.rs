//! Where the live video is, as heard: the one clock every picture of it keeps.
//!
//! Each decoder of the live video — the audience view, NDI, the operator's
//! preview, the center pane, the stage displays — used to keep its own copy of
//! the time, anchored whenever a position report reached it and corrected only
//! past a tolerance of 0.12 s. Copies anchored at different moments settled at
//! different offsets, so the pictures disagreed with each other and with the
//! sound by up to a tenth of a second or more. Now the sound engine publishes
//! where the device has got to (`mod.rs`), and every decoder of that file asks
//! this for the position at the instant it is drawing: one clock, read the
//! same way everywhere.
//!
//! Process-wide rather than in Tauri state because the decoders that read it
//! (`ndi::video_feed`) are deliberately free of the app handle.

use std::path::{Path, PathBuf};
use std::sync::RwLock;
use std::time::Instant;

use crate::services::media_protocol;

/// The live video's position at one instant.
#[derive(Debug, Clone, PartialEq)]
pub struct HeardClock {
    /// The file whose sound this is.
    pub path: PathBuf,
    pub seconds: f64,
    pub playing: bool,
    pub at: Instant,
}

impl HeardClock {
    /// Where it is at `now`.
    pub fn seconds_at(&self, now: Instant) -> f64 {
        if self.playing {
            self.seconds + now.saturating_duration_since(self.at).as_secs_f64()
        } else {
            self.seconds
        }
    }
}

static CLOCK: RwLock<Option<HeardClock>> = RwLock::new(None);

/// Publish the clock, or that there is no live video.
pub fn publish(clock: Option<HeardClock>) {
    *CLOCK
        .write()
        .unwrap_or_else(|poisoned| poisoned.into_inner()) = clock;
}

/// The clock, if the live video is the file `url` names.
pub fn for_url(url: &str) -> Option<HeardClock> {
    let clock = CLOCK
        .read()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
        .clone()?;
    let path = media_protocol::path_from_uri(url)
        .or_else(|| url.starts_with('/').then(|| PathBuf::from(url)))?;
    same_file(&path, &clock.path).then_some(clock)
}

fn same_file(a: &Path, b: &Path) -> bool {
    a == b
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::Duration;

    #[test]
    fn a_running_clock_moves_on_and_a_held_one_does_not() {
        let at = Instant::now();
        let mut clock = HeardClock {
            path: "/a.mp4".into(),
            seconds: 10.0,
            playing: true,
            at,
        };
        assert!((clock.seconds_at(at + Duration::from_millis(250)) - 10.25).abs() < 1e-9);
        clock.playing = false;
        assert_eq!(clock.seconds_at(at + Duration::from_secs(5)), 10.0);
    }
}
