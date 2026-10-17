//! The frames an audience screen has just drawn, for the operator's preview
//! of it.
//!
//! The preview drew the same picture a second time — its own compositor, its
//! own copy of the video, a JPEG for the webview — while the audience
//! window's loop had already drawn it (`surface::run`). With the screen's
//! window open, the preview now shows that loop's frame, the very same
//! buffer, made smaller by the GPU (`surface::panel`). With it closed there is
//! nothing to take, and the preview draws for itself as before
//! (`state::preview_state`).
//!
//! Process-wide, by screen, like the sound's clock (`sound::clock`): the loop
//! that publishes and the preview that reads know nothing of each other.

use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, LazyLock, Mutex, MutexGuard, PoisonError};

/// A screen's newest frame: premultiplied BGRA, top row first.
#[derive(Clone)]
pub struct Tapped {
    pub frame: Arc<Vec<u8>>,
    pub size: (u32, u32),
    /// Counts up with each frame, so a reader can tell a new one.
    pub seq: u64,
}

static TAPS: LazyLock<Mutex<HashMap<String, Tapped>>> = LazyLock::new(Mutex::default);
static SEQ: AtomicU64 = AtomicU64::new(0);

fn taps() -> MutexGuard<'static, HashMap<String, Tapped>> {
    TAPS.lock().unwrap_or_else(PoisonError::into_inner)
}

/// `screen` has drawn `frame`.
pub fn publish(screen: &str, frame: Arc<Vec<u8>>, size: (u32, u32)) {
    let expected = size.0 as usize * size.1 as usize * 4;
    if frame.len() != expected || expected == 0 {
        return;
    }
    let seq = SEQ.fetch_add(1, Ordering::Relaxed) + 1;
    taps().insert(screen.to_owned(), Tapped { frame, size, seq });
}

/// `screen` is no longer being drawn.
pub fn clear(screen: &str) {
    taps().remove(screen);
}

/// The newest frame `screen` has drawn, while its window is open.
pub fn latest(screen: &str) -> Option<Tapped> {
    taps().get(screen).cloned()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_screen_being_drawn_offers_its_newest_frame_and_then_nothing() {
        let screen = "tap-test-screen";
        assert!(latest(screen).is_none());
        publish(screen, Arc::new(vec![0; 2 * 2 * 4]), (2, 2));
        let first = latest(screen).expect("offered");
        publish(screen, Arc::new(vec![1; 2 * 2 * 4]), (2, 2));
        let second = latest(screen).expect("offered");
        assert!(second.seq > first.seq, "a new frame is told apart");
        assert_eq!(second.frame[0], 1);
        // A frame that does not match its size is not offered.
        publish(screen, Arc::new(vec![0; 3]), (2, 2));
        assert_eq!(latest(screen).map(|tapped| tapped.seq), Some(second.seq));
        clear(screen);
        assert!(latest(screen).is_none());
    }
}
