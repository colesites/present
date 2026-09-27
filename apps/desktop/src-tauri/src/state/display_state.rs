//! Which monitor each screen role should use, and at what resolution.
//!
//! The Electron equivalent (`display.service.ts:10-20`) keeps this in module
//! globals, so every preference is lost when the app restarts and the operator
//! re-picks the audience screen at the start of every service. Here it is
//! persisted.
//!
//! Preferences store a `DisplayKey`, not the derived numeric id — see
//! `services/display_identity.rs` for why identity is (name, ordinal).

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::sync::RwLock;

use serde::{Deserialize, Serialize};

use crate::errors::AppResult;
use crate::services::display::ScreenRole;
use crate::services::display_identity::DisplayKey;
use crate::services::screens::{self, ScreenSetup};

use super::persist;

const PREFERENCES_FILE: &str = "display-preferences.json";
const CURRENT_VERSION: u32 = 1;

/// Matches the Electron defaults (`display.service.ts:16-20`).
const DEFAULT_RESOLUTION: Resolution = Resolution {
    width: 1920,
    height: 1080,
};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct Resolution {
    pub width: u32,
    pub height: u32,
}

impl Resolution {
    /// Clamped the same way the Electron setter clamps
    /// (`display.service.ts:86-89`): a resolution smaller than this is a bug in
    /// the caller, not a preference worth honouring.
    pub fn sanitized(self) -> Self {
        Self {
            width: self.width.max(320),
            height: self.height.max(240),
        }
    }

    /// Parses the `"1920x1080"` strings the frontend sends today.
    pub fn parse(value: &str) -> Option<Self> {
        let (width, height) = value.trim().split_once('x')?;
        let width: u32 = width.parse().ok()?;
        let height: u32 = height.parse().ok()?;

        // The Electron regex accepted 3-5 digits per side; keep the same range
        // so a typo cannot produce an 8-pixel-wide output window.
        if !(100..=99_999).contains(&width) || !(100..=99_999).contains(&height) {
            return None;
        }

        Some(Self { width, height })
    }
}

impl Default for Resolution {
    fn default() -> Self {
        DEFAULT_RESOLUTION
    }
}

/// The on-disk shape. Versioned so a later change can migrate rather than
/// silently discard an operator's setup.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DisplayPreferences {
    pub version: u32,
    #[serde(default)]
    pub displays: BTreeMap<String, DisplayKey>,
    /// The NDI stream's size, under `audience`. It was each role's output
    /// resolution, which only ever sized the stream; a screen's own size is
    /// in `screens`.
    #[serde(default)]
    pub resolutions: BTreeMap<String, Resolution>,
    /// Screen Configuration's screens (`services/screens.rs`): what the
    /// operator changed on the three built in, and the ones they added. Their
    /// outputs are in `displays`, by screen id.
    #[serde(default)]
    pub screens: Vec<ScreenSetup>,
}

impl Default for DisplayPreferences {
    fn default() -> Self {
        Self {
            version: CURRENT_VERSION,
            displays: BTreeMap::new(),
            resolutions: BTreeMap::new(),
            screens: Vec::new(),
        }
    }
}

/// Roles are stored under their serde name so the file stays readable and
/// matches what the frontend already sends.
fn role_key(role: ScreenRole) -> &'static str {
    match role {
        ScreenRole::Audience => "audience",
        ScreenRole::Media => "media",
        ScreenRole::Worship => "worship",
    }
}

impl DisplayPreferences {
    pub fn display_for(&self, role: ScreenRole) -> Option<&DisplayKey> {
        self.displays.get(role_key(role))
    }

    pub fn set_display(&mut self, role: ScreenRole, key: Option<DisplayKey>) {
        match key {
            Some(key) => {
                self.displays.insert(role_key(role).to_owned(), key);
            }
            None => {
                self.displays.remove(role_key(role));
            }
        }
    }

    pub fn resolution_for(&self, role: ScreenRole) -> Resolution {
        self.resolutions
            .get(role_key(role))
            .copied()
            .unwrap_or_default()
    }

    pub fn set_resolution(&mut self, role: ScreenRole, resolution: Resolution) {
        self.resolutions
            .insert(role_key(role).to_owned(), resolution.sanitized());
    }

    /// Every screen, in Screen Configuration's order.
    pub fn screens(&self) -> Vec<ScreenSetup> {
        screens::arranged(&self.screens)
    }

    pub fn screen(&self, id: &str) -> Option<ScreenSetup> {
        self.screens().into_iter().find(|screen| screen.id == id)
    }

    /// Keep `screen` as it now is, adding it if it is new.
    pub fn put_screen(&mut self, screen: ScreenSetup) {
        match self.screens.iter_mut().find(|kept| kept.id == screen.id) {
            Some(kept) => *kept = screen,
            None => self.screens.push(screen),
        }
    }

    /// Take an added screen away, and its outputs' displays with it. The
    /// three built in stay.
    pub fn remove_screen(&mut self, id: &str) -> bool {
        if screens::is_built_in(id) {
            return false;
        }
        let before = self.screens.len();
        self.screens.retain(|screen| screen.id != id);
        let nested = format!("{id}/");
        self.displays
            .retain(|key, _| key != id && !key.starts_with(&nested));
        self.screens.len() != before
    }

    /// The display chosen for one output of a screen. For the first output of
    /// the three built in this is the role's display: their ids are the names
    /// roles are stored under.
    pub fn display_for_output(&self, screen: &str, output: &str) -> Option<&DisplayKey> {
        self.displays.get(&screens::display_key(screen, output))
    }

    pub fn set_output_display(&mut self, screen: &str, output: &str, key: Option<DisplayKey>) {
        let stored = screens::display_key(screen, output);
        match key {
            Some(key) => {
                self.displays.insert(stored, key);
            }
            None => {
                self.displays.remove(&stored);
            }
        }
    }
}

/// In-memory preferences plus the file they came from.
pub struct DisplayState {
    preferences: RwLock<DisplayPreferences>,
    path: PathBuf,
}

impl DisplayState {
    /// Load from disk, falling back to defaults.
    ///
    /// A corrupt or unreadable file must not stop the app from starting — an
    /// operator opening the app ten minutes before a service needs a working
    /// app far more than they need their saved screen choice.
    pub fn load(config_dir: &Path) -> Self {
        let path = config_dir.join(PREFERENCES_FILE);
        let preferences = persist::load_or_default(&path, "display preferences");

        Self {
            preferences: RwLock::new(preferences),
            path,
        }
    }

    pub fn snapshot(&self) -> DisplayPreferences {
        self.read().clone()
    }

    /// One screen, without copying everything else: the audience surface
    /// asks every frame.
    pub fn screen(&self, id: &str) -> Option<ScreenSetup> {
        self.read().screen(id)
    }

    fn read(&self) -> std::sync::RwLockReadGuard<'_, DisplayPreferences> {
        // A poisoned lock means another thread panicked mid-update. The data is
        // a set of preferences, not an invariant-bearing structure, so reading
        // it is still safe and far better than taking the app down.
        self.preferences
            .read()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }

    /// Apply a change and write it out.
    pub fn update<F>(&self, mutate: F) -> AppResult<()>
    where
        F: FnOnce(&mut DisplayPreferences),
    {
        let snapshot = {
            let mut preferences = self
                .preferences
                .write()
                .unwrap_or_else(|poisoned| poisoned.into_inner());
            mutate(&mut preferences);
            preferences.clone()
        };

        persist::save_atomic(&self.path, &snapshot)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_dir(label: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "present-display-state-{label}-{}-{:?}",
            std::process::id(),
            std::thread::current().id()
        ));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).expect("temp dir");
        dir
    }

    #[test]
    fn resolution_parses_the_strings_the_frontend_sends() {
        assert_eq!(
            Resolution::parse("1920x1080"),
            Some(Resolution {
                width: 1920,
                height: 1080
            })
        );
        assert_eq!(
            Resolution::parse("  3840x2160 "),
            Some(Resolution {
                width: 3840,
                height: 2160
            })
        );
    }

    #[test]
    fn resolution_rejects_nonsense_rather_than_producing_a_tiny_window() {
        assert_eq!(Resolution::parse(""), None);
        assert_eq!(Resolution::parse("1920"), None);
        assert_eq!(Resolution::parse("1920x"), None);
        assert_eq!(Resolution::parse("axb"), None);
        assert_eq!(Resolution::parse("8x8"), None);
        assert_eq!(Resolution::parse("-1920x1080"), None);
    }

    #[test]
    fn resolutions_are_clamped_to_a_usable_minimum() {
        let clamped = Resolution {
            width: 10,
            height: 10,
        }
        .sanitized();
        assert_eq!(clamped.width, 320);
        assert_eq!(clamped.height, 240);
    }

    #[test]
    fn roles_default_to_1080p_like_the_electron_build() {
        let preferences = DisplayPreferences::default();
        for role in [ScreenRole::Audience, ScreenRole::Media, ScreenRole::Worship] {
            assert_eq!(preferences.resolution_for(role), DEFAULT_RESOLUTION);
        }
    }

    #[test]
    fn preferences_survive_a_restart() {
        let dir = temp_dir("survives");
        let key = DisplayKey {
            name: Some("LG UltraFine".to_owned()),
            ordinal: 1,
        };

        let state = DisplayState::load(&dir);
        state
            .update(|preferences| {
                preferences.set_display(ScreenRole::Audience, Some(key.clone()));
                preferences.set_resolution(
                    ScreenRole::Audience,
                    Resolution {
                        width: 3840,
                        height: 2160,
                    },
                );
            })
            .expect("saved");

        // A fresh instance is what the next launch sees.
        let reloaded = DisplayState::load(&dir).snapshot();
        assert_eq!(reloaded.display_for(ScreenRole::Audience), Some(&key));
        assert_eq!(
            reloaded.resolution_for(ScreenRole::Audience),
            Resolution {
                width: 3840,
                height: 2160
            }
        );
        // Untouched roles keep their defaults rather than inheriting audience.
        assert_eq!(reloaded.display_for(ScreenRole::Media), None);
    }

    #[test]
    fn roles_are_independent() {
        let dir = temp_dir("independent");
        let state = DisplayState::load(&dir);

        state
            .update(|preferences| {
                preferences.set_display(
                    ScreenRole::Audience,
                    Some(DisplayKey {
                        name: Some("Projector".to_owned()),
                        ordinal: 0,
                    }),
                );
                preferences.set_display(
                    ScreenRole::Worship,
                    Some(DisplayKey {
                        name: Some("Stage TV".to_owned()),
                        ordinal: 0,
                    }),
                );
            })
            .expect("saved");

        let snapshot = DisplayState::load(&dir).snapshot();
        assert_eq!(
            snapshot
                .display_for(ScreenRole::Audience)
                .and_then(|key| key.name.as_deref()),
            Some("Projector")
        );
        assert_eq!(
            snapshot
                .display_for(ScreenRole::Worship)
                .and_then(|key| key.name.as_deref()),
            Some("Stage TV")
        );
    }

    #[test]
    fn clearing_a_role_removes_it() {
        let dir = temp_dir("clearing");
        let state = DisplayState::load(&dir);

        state
            .update(|preferences| {
                preferences.set_display(
                    ScreenRole::Audience,
                    Some(DisplayKey {
                        name: Some("Projector".to_owned()),
                        ordinal: 0,
                    }),
                );
            })
            .expect("saved");
        state
            .update(|preferences| preferences.set_display(ScreenRole::Audience, None))
            .expect("saved");

        assert_eq!(
            DisplayState::load(&dir)
                .snapshot()
                .display_for(ScreenRole::Audience),
            None
        );
    }

    #[test]
    fn a_corrupt_file_does_not_stop_the_app_starting() {
        let dir = temp_dir("corrupt");
        std::fs::write(dir.join(PREFERENCES_FILE), "{ this is not json").expect("written");

        let snapshot = DisplayState::load(&dir).snapshot();
        assert_eq!(snapshot.version, CURRENT_VERSION);
        assert!(snapshot.displays.is_empty());
        assert_eq!(
            snapshot.resolution_for(ScreenRole::Audience),
            DEFAULT_RESOLUTION
        );
    }

    #[test]
    fn a_missing_config_directory_is_created_on_first_save() {
        let dir = temp_dir("nested").join("does").join("not").join("exist");
        let state = DisplayState::load(&dir);

        state
            .update(|preferences| {
                preferences.set_resolution(
                    ScreenRole::Media,
                    Resolution {
                        width: 1280,
                        height: 720,
                    },
                );
            })
            .expect("saved");

        assert!(dir.join(PREFERENCES_FILE).exists());
    }

    #[test]
    fn saving_leaves_no_temporary_file_behind() {
        let dir = temp_dir("atomic");
        let state = DisplayState::load(&dir);
        state
            .update(|preferences| {
                preferences.set_resolution(ScreenRole::Audience, DEFAULT_RESOLUTION)
            })
            .expect("saved");

        let leftovers: Vec<_> = std::fs::read_dir(&dir)
            .expect("readable")
            .filter_map(Result::ok)
            .filter(|entry| entry.file_name().to_string_lossy().ends_with(".tmp"))
            .collect();

        assert!(leftovers.is_empty(), "atomic write left a .tmp file behind");
    }
}
