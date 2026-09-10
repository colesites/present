//! The live audience scene, and the freeze flag.
//!
//! Held in memory only. Unlike the display and looks preferences, this is what
//! is on screen *right now* — restoring last Sunday's slide on launch would be
//! worse than starting blank.

use std::sync::RwLock;

use crate::services::output::{OutputScene, OutputUpdate};

pub struct OutputState {
    scene: RwLock<OutputScene>,
    frozen: RwLock<bool>,
}

impl Default for OutputState {
    fn default() -> Self {
        Self::new()
    }
}

impl OutputState {
    pub fn new() -> Self {
        Self {
            scene: RwLock::new(OutputScene::default()),
            frozen: RwLock::new(false),
        }
    }

    pub fn scene(&self) -> OutputScene {
        self.read_scene().clone()
    }

    pub fn is_frozen(&self) -> bool {
        *self
            .frozen
            .read()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }

    /// Apply an update. Returns the scene to broadcast, or `None` when there is
    /// nothing worth sending.
    ///
    /// Two reasons for `None`. The scene did not change in any way the surfaces
    /// would render differently — that is the structural equivalent of the
    /// `JSON.stringify` signature comparison in `useOutputBroadcast.ts`. Or the
    /// output is frozen, in which case the update is recorded but held back:
    /// freeze means "stop changing the audience screen", not "stop tracking
    /// what the operator is doing".
    pub fn apply(&self, update: OutputUpdate) -> Option<OutputScene> {
        let mut scene = self
            .scene
            .write()
            .unwrap_or_else(|poisoned| poisoned.into_inner());

        let before = scene.clone();
        crate::services::output::apply(&mut scene, update);

        if !before.differs(&scene) {
            return None;
        }
        if self.is_frozen() {
            return None;
        }

        Some(scene.clone())
    }

    /// Freeze or unfreeze the audience output.
    ///
    /// Returns the scene to broadcast on unfreeze, so the surfaces catch up
    /// with whatever the operator did while they were held.
    ///
    /// The Electron version does not do this. `useOutputBroadcast.ts:201-205`
    /// returns early on the render that clears the freeze as well as on every
    /// frozen one, so unfreezing alone sends nothing and the audience screen
    /// keeps showing the frozen content until some *other* change happens to
    /// trigger the effect. Recorded in known-issues rather than carried over.
    pub fn set_frozen(&self, frozen: bool) -> Option<OutputScene> {
        let was_frozen = {
            let mut flag = self
                .frozen
                .write()
                .unwrap_or_else(|poisoned| poisoned.into_inner());
            let previous = *flag;
            *flag = frozen;
            previous
        };

        if was_frozen && !frozen {
            return Some(self.scene());
        }
        None
    }

    fn read_scene(&self) -> std::sync::RwLockReadGuard<'_, OutputScene> {
        self.scene
            .read()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::services::output::{MediaKind, MediaUpdate, VideoSettings};

    fn media_update(playing: bool, time: f64, sync: bool) -> OutputUpdate {
        OutputUpdate::MediaUpdate(Box::new(MediaUpdate {
            media_url: Some("local-media://media/clip.mp4".to_owned()),
            media_id: Some("clip".to_owned()),
            media_type: Some(MediaKind::Video),
            show_text: true,
            show_media: true,
            hide_background: Some(false),
            text_position: None,
            video_settings: VideoSettings {
                loop_: true,
                muted: false,
            },
            media_filter_css: "none".to_owned(),
            is_video_playing: playing,
            video_current_time: time,
            should_sync_time: sync,
            scripture_style: None,
            library_style: None,
            timer_layout: None,
            screen_composer_enabled: None,
            screen_composer_layout: None,
        }))
    }

    #[test]
    fn the_first_update_is_broadcast() {
        let state = OutputState::new();

        assert!(state.apply(media_update(true, 0.0, false)).is_some());
    }

    #[test]
    fn an_identical_update_is_not_broadcast_again() {
        // The whole point of the signature comparison this replaces.
        let state = OutputState::new();
        state.apply(media_update(true, 0.0, false));

        assert!(state.apply(media_update(true, 0.0, false)).is_none());
    }

    #[test]
    fn a_seek_instruction_alone_does_not_rebroadcast() {
        // `shouldSyncTime` flips at 10 Hz while a video plays. Treating it as a
        // change would re-send the whole scene ten times a second.
        let state = OutputState::new();
        state.apply(media_update(true, 12.0, false));

        assert!(state.apply(media_update(true, 12.0, true)).is_none());
    }

    #[test]
    fn a_real_position_change_does_rebroadcast() {
        let state = OutputState::new();
        state.apply(media_update(true, 12.0, false));

        assert!(state.apply(media_update(true, 13.0, false)).is_some());
    }

    #[test]
    fn nothing_is_broadcast_while_the_output_is_frozen() {
        let state = OutputState::new();
        state.apply(media_update(true, 0.0, false));
        state.set_frozen(true);

        assert!(state.apply(media_update(false, 30.0, false)).is_none());
    }

    #[test]
    fn the_scene_still_tracks_the_operator_while_frozen() {
        // Freeze holds the audience screen, not the application's idea of what
        // is playing. The operator can queue the next thing up behind it.
        let state = OutputState::new();
        state.set_frozen(true);
        state.apply(media_update(false, 30.0, false));

        assert_eq!(state.scene().video_current_time, 30.0);
    }

    #[test]
    fn unfreezing_catches_the_surfaces_up() {
        let state = OutputState::new();
        state.apply(media_update(true, 0.0, false));
        state.set_frozen(true);
        state.apply(media_update(false, 30.0, false));

        let caught_up = state.set_frozen(false).expect("a scene to catch up with");
        assert_eq!(caught_up.video_current_time, 30.0);
        assert!(!caught_up.is_video_playing);
    }

    #[test]
    fn freezing_broadcasts_nothing() {
        let state = OutputState::new();
        state.apply(media_update(true, 0.0, false));

        assert!(state.set_frozen(true).is_none());
    }

    #[test]
    fn unfreezing_when_it_was_not_frozen_broadcasts_nothing() {
        let state = OutputState::new();

        assert!(state.set_frozen(false).is_none());
    }
}
