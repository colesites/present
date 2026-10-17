//! The live audience scene, and the freeze flag.
//!
//! Held in memory only. Unlike the display and looks preferences, this is what
//! is on screen *right now* — restoring last Sunday's slide on launch would be
//! worse than starting blank.

use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, RwLock};

use crate::services::output::{OutputScene, OutputUpdate};

pub struct OutputState {
    /// What the operator has set up, frozen or not.
    scene: RwLock<Arc<OutputScene>>,
    /// What the surfaces were last told to show. The same as `scene` except
    /// while frozen, when it is the held screen.
    on_screen: RwLock<Arc<OutputScene>>,
    /// Counts up each time `on_screen` changes.
    ///
    /// Every screen, preview and stream draws from `on_screen` up to sixty
    /// times a second. Each used to copy the whole scene — slide elements and
    /// all — and compare it with the one it drew last, every time. Now they
    /// read this number, and look at the scene again only when it has moved
    /// (`SceneCache`).
    version: AtomicU64,
    frozen: RwLock<bool>,
}

impl Default for OutputState {
    fn default() -> Self {
        Self::new()
    }
}

impl OutputState {
    pub fn new() -> Self {
        let empty = Arc::new(OutputScene::default());
        Self {
            scene: RwLock::new(Arc::clone(&empty)),
            on_screen: RwLock::new(empty),
            version: AtomicU64::new(0),
            frozen: RwLock::new(false),
        }
    }

    /// The scene the operator has set up, including anything queued behind a
    /// freeze.
    pub fn scene(&self) -> OutputScene {
        OutputScene::clone(&self.scene_shared())
    }

    /// [`scene`](Self::scene) without copying it.
    pub fn scene_shared(&self) -> Arc<OutputScene> {
        Arc::clone(
            &self
                .scene
                .read()
                .unwrap_or_else(|poisoned| poisoned.into_inner()),
        )
    }

    /// The scene the audience is looking at.
    ///
    /// What anything that *draws* the output must use. Under Electron the NDI
    /// stream was a capture of the audience window, so a freeze held the
    /// stream too; a sender reading [`scene`](Self::scene) instead would show
    /// a livestream the slides the operator is lining up behind the freeze.
    /// The same goes for an audience window opened mid-freeze.
    pub fn on_screen(&self) -> OutputScene {
        OutputScene::clone(&self.on_screen_shared().1)
    }

    /// [`on_screen`](Self::on_screen) without copying it, with its version.
    pub fn on_screen_shared(&self) -> (u64, Arc<OutputScene>) {
        let scene = self
            .on_screen
            .read()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        // Read under the same lock `show` writes both under.
        (self.version.load(Ordering::Acquire), Arc::clone(&scene))
    }

    /// The version of what is on screen: it moves whenever that does.
    pub fn version(&self) -> u64 {
        self.version.load(Ordering::Acquire)
    }

    fn show(&self, scene: Arc<OutputScene>) {
        let mut on_screen = self
            .on_screen
            .write()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        *on_screen = scene;
        self.version.fetch_add(1, Ordering::AcqRel);
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

        let mut next = OutputScene::clone(&scene);
        crate::services::output::apply(&mut next, update);

        if !scene.differs(&next) {
            return None;
        }
        let next = Arc::new(next);
        *scene = Arc::clone(&next);
        if self.is_frozen() {
            return None;
        }

        self.show(Arc::clone(&next));
        Some(OutputScene::clone(&next))
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
            let scene = self.scene_shared();
            self.show(Arc::clone(&scene));
            return Some(OutputScene::clone(&scene));
        }
        None
    }
}

/// What a drawing loop drew last: the scene, the video frame's time and the
/// size (`SceneCompositor::needs_drawing`).
pub type Drawn = (Arc<OutputScene>, Option<f64>, (u32, u32));

/// A screen's scene, worked out again only when the output or the looks have
/// changed: what each drawing loop keeps, rather than copying the whole scene
/// and comparing it with the last one sixty times a second.
///
/// The same `Arc` comes back while nothing has changed, so a loop can tell an
/// unchanged scene by pointer (`SceneCompositor::needs_drawing`).
#[derive(Default)]
pub struct SceneCache {
    key: Option<(u64, u64)>,
    scene: Option<Arc<OutputScene>>,
}

impl SceneCache {
    pub fn new() -> Self {
        Self::default()
    }

    /// What is on screen as the audience screen `screen` shows it
    /// (`LooksState::scene_for_screen`).
    pub fn for_screen(
        &mut self,
        output: &OutputState,
        looks: Option<&crate::state::LooksState>,
        screen: &str,
    ) -> Arc<OutputScene> {
        match looks {
            Some(looks) => self.through(output, Some(looks), |scene| {
                looks.scene_for_screen(scene, screen)
            }),
            None => self.through(output, None, |scene| scene),
        }
    }

    /// What is on screen, made into a picture's own by `derive` — called only
    /// when the output or the looks have changed since the last time.
    pub fn through(
        &mut self,
        output: &OutputState,
        looks: Option<&crate::state::LooksState>,
        derive: impl FnOnce(OutputScene) -> OutputScene,
    ) -> Arc<OutputScene> {
        let looks_version = looks.map_or(0, crate::state::LooksState::version);
        if let Some(scene) = self
            .scene
            .as_ref()
            .filter(|_| self.key == Some((output.version(), looks_version)))
        {
            return Arc::clone(scene);
        }
        let (version, on_screen) = output.on_screen_shared();
        let scene = Arc::new(derive(OutputScene::clone(&on_screen)));
        self.key = Some((version, looks_version));
        self.scene = Some(Arc::clone(&scene));
        scene
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
            media_fit: crate::services::output::MediaFit::Fit,
            is_video_playing: playing,
            video_current_time: time,
            video_time_sampled_at_ms: None,
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
    fn what_is_on_screen_follows_every_broadcast() {
        let state = OutputState::new();
        state.apply(media_update(true, 12.0, false));

        assert_eq!(state.on_screen(), state.scene());
    }

    #[test]
    fn a_freeze_holds_what_is_on_screen_while_the_operator_moves_on() {
        // The NDI stream and a late-opened audience window draw this. Drawing
        // `scene()` instead would show the livestream what the freeze is hiding.
        let state = OutputState::new();
        state.apply(media_update(true, 12.0, false));
        state.set_frozen(true);
        state.apply(media_update(false, 30.0, false));

        let held = state.on_screen();
        assert_eq!(held.video_current_time, 12.0);
        assert!(held.is_video_playing);
        assert_eq!(
            state.scene().video_current_time,
            30.0,
            "the operator's scene moved on"
        );
    }

    #[test]
    fn unfreezing_puts_the_operators_scene_on_screen() {
        let state = OutputState::new();
        state.apply(media_update(true, 12.0, false));
        state.set_frozen(true);
        state.apply(media_update(false, 30.0, false));
        state.set_frozen(false);

        assert_eq!(state.on_screen().video_current_time, 30.0);
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

    #[test]
    fn a_cached_scene_is_the_same_one_until_the_output_changes() {
        let state = OutputState::new();
        state.apply(media_update(true, 0.0, false));
        let mut cache = SceneCache::new();
        let mut derived = 0;
        let mut derive = |scene: OutputScene| {
            derived += 1;
            scene
        };
        let first = cache.through(&state, None, &mut derive);
        let again = cache.through(&state, None, &mut derive);
        assert!(Arc::ptr_eq(&first, &again), "not copied again");
        state.apply(media_update(false, 4.0, false));
        let changed = cache.through(&state, None, &mut derive);
        assert!(!Arc::ptr_eq(&first, &changed));
        assert_eq!(changed.video_current_time, 4.0);
        assert_eq!(derived, 2, "worked out once per change");
    }

    #[test]
    fn the_version_moves_only_when_what_is_on_screen_does() {
        let state = OutputState::new();
        let start = state.version();
        state.apply(media_update(true, 0.0, false));
        let shown = state.version();
        assert!(shown > start);

        state.apply(media_update(true, 0.0, false));
        assert_eq!(state.version(), shown, "nothing changed");

        state.set_frozen(true);
        state.apply(media_update(false, 30.0, false));
        assert_eq!(state.version(), shown, "held behind the freeze");

        state.set_frozen(false);
        assert!(state.version() > shown, "caught up");
        let (version, scene) = state.on_screen_shared();
        assert_eq!(version, state.version());
        assert_eq!(scene.video_current_time, 30.0);
    }
}
