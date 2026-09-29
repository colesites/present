//! The live output layer flags.
//!
//! Replaces the `present-looks-config` localStorage key and, with it, the
//! 400 ms poll two windows use to agree on what the audience sees
//! (`useLooksConfig.ts:87`). One writer, one file, and an event when it
//! changes.
//!
//! Kept separate from `DisplayState` because they answer different questions —
//! which monitor, versus what is drawn on it — and because this one changes
//! during a service while that one does not.

use std::path::{Path, PathBuf};
use std::sync::RwLock;

use crate::errors::AppResult;
use crate::services::look_scene::scene_for_look;
use crate::services::looks::{self, LookTarget, LooksConfig};
use crate::services::output::OutputScene;

use super::persist;

const LOOKS_FILE: &str = "looks.json";

pub struct LooksState {
    config: RwLock<LooksConfig>,
    path: PathBuf,
}

impl LooksState {
    /// Load the saved looks, or the defaults.
    ///
    /// Read as raw JSON and then normalised rather than deserialised straight
    /// into `LooksConfig`: the file may have been written by an older version,
    /// by the React side, or half-written, and `normalize` is the same
    /// forgiving reader the JS uses. A strict `serde` parse would drop the
    /// operator's whole setup over one unexpected field.
    pub fn load(config_dir: &Path) -> Self {
        let path = config_dir.join(LOOKS_FILE);
        let raw: Option<serde_json::Value> = match std::fs::read_to_string(&path) {
            Ok(contents) => serde_json::from_str(&contents).ok(),
            Err(_) => None,
        };

        let mut new_id = generate_look_id;
        let config = looks::normalize(raw.as_ref(), now_ms(), &mut new_id);

        Self {
            config: RwLock::new(config),
            path,
        }
    }

    pub fn snapshot(&self) -> LooksConfig {
        self.read().clone()
    }

    /// The scene on screen as the audience screen `screen` shows it: through
    /// its own column of the live look, for one added in Screen
    /// Configuration. The Screen every setup has shows it as it is — the
    /// operator window folds its column into the scene itself.
    pub fn scene_for_screen(&self, on_screen: OutputScene, screen: &str) -> OutputScene {
        match LookTarget::for_screen(screen) {
            Some(target @ LookTarget::Screen(_)) => {
                let column = self.read().live_look().targets.get(&target);
                scene_for_look(&on_screen, &column)
            }
            _ => on_screen,
        }
    }

    /// Apply a change and write it out.
    ///
    /// The mutation returns whether anything actually changed, so a no-op —
    /// selecting the look that is already live, say — neither writes the file
    /// nor wakes every window.
    pub fn update<F>(&self, mutate: F) -> AppResult<Option<LooksConfig>>
    where
        F: FnOnce(&mut LooksConfig) -> bool,
    {
        let snapshot = {
            let mut config = self
                .config
                .write()
                .unwrap_or_else(|poisoned| poisoned.into_inner());
            if !mutate(&mut config) {
                return Ok(None);
            }
            config.clone()
        };

        persist::save_atomic(&self.path, &snapshot)?;
        Ok(Some(snapshot))
    }

    fn read(&self) -> std::sync::RwLockReadGuard<'_, LooksConfig> {
        self.config
            .read()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }
}

pub fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|elapsed| elapsed.as_millis() as i64)
        .unwrap_or_default()
}

/// Matches `generateLookId` in `looks-config.mjs`, which the persisted ids were
/// created by. The shape has to stay recognisable, not unique across machines.
pub fn generate_look_id() -> String {
    // A counter rather than `Math.random()`: two looks added in the same
    // millisecond must not collide, and there is no randomness available here
    // without another dependency.
    use std::sync::atomic::{AtomicU32, Ordering};
    static COUNTER: AtomicU32 = AtomicU32::new(0);

    format!(
        "look-{}-{}",
        now_ms(),
        COUNTER.fetch_add(1, Ordering::Relaxed)
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::services::looks::LookLayer;

    fn temp_dir(label: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "present-looks-state-{label}-{}-{:?}",
            std::process::id(),
            std::thread::current().id()
        ));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).expect("temp dir");
        dir
    }

    #[test]
    fn a_fresh_install_gets_the_defaults() {
        let config = LooksState::load(&temp_dir("fresh")).snapshot();

        assert_eq!(config.looks.len(), 1);
        assert_eq!(config.live_look_id, "default");
        assert!(config.live_look().targets.program.layers.slide);
    }

    #[test]
    fn a_layer_toggle_survives_a_restart() {
        let dir = temp_dir("restart");
        let state = LooksState::load(&dir);

        state
            .update(|config| {
                looks::set_layer_enabled(
                    config,
                    "default",
                    &LookTarget::Program,
                    LookLayer::Media,
                    false,
                    now_ms(),
                );
                true
            })
            .expect("saved");

        let reloaded = LooksState::load(&dir).snapshot();
        assert!(!reloaded.live_look().targets.program.layers.media);
    }

    #[test]
    fn a_no_op_change_writes_nothing_and_wakes_nobody() {
        let dir = temp_dir("noop");
        let state = LooksState::load(&dir);

        let result = state
            .update(|config| looks::set_selected_look(config, "missing", now_ms()))
            .expect("handled");

        assert!(result.is_none());
        assert!(
            !dir.join(LOOKS_FILE).exists(),
            "a refused change must not touch the file"
        );
    }

    #[test]
    fn a_file_written_by_the_react_side_is_read_back() {
        // The two sides share a shape during the migration; a config saved by
        // the JS must not be discarded by the Rust reader.
        let dir = temp_dir("interop");
        std::fs::write(
            dir.join(LOOKS_FILE),
            serde_json::json!({
                "version": 2,
                "selectedTarget": "stage",
                "selectedLookId": "evening",
                "liveLookId": "evening",
                "looks": [{
                    "id": "evening",
                    "name": "Evening",
                    "targets": { "program": { "layers": { "mask": true } } },
                }],
                "updatedAt": 1_700_000_000_000i64,
            })
            .to_string(),
        )
        .expect("written");

        let config = LooksState::load(&dir).snapshot();
        assert_eq!(config.selected_target, LookTarget::Stage);
        assert_eq!(config.live_look_id, "evening");
        assert!(config.live_look().targets.program.layers.mask);
    }

    #[test]
    fn a_corrupt_file_does_not_stop_the_app_starting() {
        let dir = temp_dir("corrupt");
        std::fs::write(dir.join(LOOKS_FILE), "{ not json at all").expect("written");

        let config = LooksState::load(&dir).snapshot();
        assert_eq!(config.looks.len(), 1);
        assert_eq!(config.looks[0].id, "default");
    }

    #[test]
    fn generated_ids_do_not_collide_within_a_millisecond() {
        let first = generate_look_id();
        let second = generate_look_id();

        assert_ne!(first, second);
        assert!(first.starts_with("look-"));
    }

    #[test]
    fn each_audience_screen_shows_the_scene_through_its_own_column() {
        let dir = temp_dir("screens");
        let state = LooksState::load(&dir);
        state
            .update(|config| {
                let lobby = LookTarget::Screen("a1b2c3d4e5".to_owned());
                for layer in [LookLayer::Media, LookLayer::VideoInput] {
                    looks::set_layer_enabled(config, "default", &lobby, layer, false, now_ms());
                }
                true
            })
            .expect("saved");
        let showing = OutputScene {
            show_text: true,
            show_media: true,
            ..OutputScene::default()
        };

        let lobby = state.scene_for_screen(showing.clone(), "a1b2c3d4e5");
        assert!(!lobby.show_media, "its column has no media");
        assert!(lobby.show_text);
        assert!(
            state
                .scene_for_screen(showing.clone(), "0f0f0f0f0f")
                .show_media,
            "a screen with no column of its own shows what the Screen shows"
        );
        assert_eq!(
            state.scene_for_screen(showing.clone(), "audience"),
            showing,
            "the Screen's is the scene as the operator sent it"
        );
    }
}
