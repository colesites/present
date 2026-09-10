//! The live media transport.
//!
//! In memory, not on disk, and that is the deliberate half of this file. Where
//! a video had got to is not a preference — an operator restarting the app
//! between services wants the countdown at zero, not eleven minutes in. It is
//! the same reasoning that keeps `OutputState` in memory while `LooksState`
//! persists: this describes the moment, not the setup.
//!
//! The resume points inside it are per-session for the same reason. They exist
//! so stepping away from an item and back does not restart it, which is a
//! within-service concern.

use std::sync::RwLock;

use crate::services::playback::MediaPlayback;

#[derive(Default)]
pub struct PlaybackState {
    playback: RwLock<MediaPlayback>,
}

impl PlaybackState {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn snapshot(&self) -> MediaPlayback {
        self.playback
            .read()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .clone()
    }

    /// Apply a change, returning the new state only when something moved.
    ///
    /// Same contract as every other slice: a no-op does not wake every window.
    /// It matters more here than elsewhere, because the element reports its
    /// position about ten times a second and most of those reports change
    /// nothing worth broadcasting.
    pub fn update<F>(&self, mutate: F) -> Option<MediaPlayback>
    where
        F: FnOnce(&mut MediaPlayback) -> bool,
    {
        let mut playback = self
            .playback
            .write()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        if !mutate(&mut playback) {
            return None;
        }
        Some(playback.clone())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_fresh_state_has_nothing_loaded() {
        let state = PlaybackState::new();
        assert_eq!(state.snapshot(), MediaPlayback::default());
    }

    #[test]
    fn a_no_op_update_reports_nothing() {
        let state = PlaybackState::new();
        // Nothing is loaded, so play refuses.
        assert!(state.update(|playback| playback.play()).is_none());
    }

    #[test]
    fn a_change_comes_back_as_the_new_state() {
        let state = PlaybackState::new();
        let updated = state
            .update(|playback| playback.select_media(Some("bumper"), true))
            .expect("changed");

        assert_eq!(updated.media_id.as_deref(), Some("bumper"));
        assert!(updated.playing);
        assert_eq!(state.snapshot(), updated);
    }
}
