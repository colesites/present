//! The durable copy of the mirrored browser-storage keys.
//!
//! One file, `web-storage.json`, beside the other files the Rust core owns. It
//! does not exist until the first window of the first run creates it — from
//! that build's own localStorage, or else once from the Electron build's.

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;

use serde::{Deserialize, Serialize};

use crate::errors::{AppError, AppResult};
use crate::services::web_storage::is_mirrored_key;

use super::persist;

const WEB_STORAGE_FILE: &str = "web-storage.json";
const FILE_VERSION: u32 = 1;

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct StoredItems {
    version: u32,
    /// Where the store was first filled from, for whoever reads the file.
    imported_from: String,
    items: BTreeMap<String, String>,
}

/// What a starting window is told.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StorageStart {
    pub initialized: bool,
    /// No window has asked before, this run.
    pub first_window: bool,
    pub items: BTreeMap<String, String>,
}

/// One write from a window: a value, or `None` for a removal.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
pub struct StorageChange {
    pub key: String,
    pub value: Option<String>,
}

pub struct WebStorageState {
    path: PathBuf,
    /// `None` until the store has been created.
    stored: Mutex<Option<StoredItems>>,
    served: AtomicBool,
}

impl WebStorageState {
    pub fn load(config_dir: &Path) -> Self {
        let path = config_dir.join(WEB_STORAGE_FILE);
        let stored = match std::fs::read_to_string(&path) {
            Ok(contents) => match serde_json::from_str::<StoredItems>(&contents) {
                Ok(parsed) => Some(parsed),
                Err(error) => {
                    // Treated as never created: the next window re-imports
                    // from its own localStorage, which every write has kept
                    // current. Better than starting everyone from defaults.
                    tracing::warn!(%error, path = %path.display(), "web storage was unreadable; importing again");
                    None
                }
            },
            Err(_) => None,
        };
        Self {
            path,
            stored: Mutex::new(stored),
            served: AtomicBool::new(false),
        }
    }

    fn lock(&self) -> std::sync::MutexGuard<'_, Option<StoredItems>> {
        self.stored
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }

    pub fn start(&self) -> StorageStart {
        let stored = self.lock();
        StorageStart {
            initialized: stored.is_some(),
            first_window: !self.served.swap(true, Ordering::SeqCst),
            items: stored
                .as_ref()
                .map(|stored| stored.items.clone())
                .unwrap_or_default(),
        }
    }

    /// Create the store from `items`. If a window got there first, its store
    /// stands and is returned: two windows starting together must not race
    /// each other's imports.
    pub fn initialize(
        &self,
        items: BTreeMap<String, String>,
        imported_from: &str,
    ) -> AppResult<BTreeMap<String, String>> {
        let mut stored = self.lock();
        if let Some(existing) = stored.as_ref() {
            return Ok(existing.items.clone());
        }
        let created = StoredItems {
            version: FILE_VERSION,
            imported_from: imported_from.to_owned(),
            items: items
                .into_iter()
                .filter(|(key, _)| is_mirrored_key(key))
                .collect(),
        };
        persist::save_atomic(&self.path, &created)?;
        let items = created.items.clone();
        *stored = Some(created);
        Ok(items)
    }

    /// Apply writes from a window. Keys that are not mirrored are ignored.
    pub fn apply(&self, changes: Vec<StorageChange>) -> AppResult<()> {
        let mut stored = self.lock();
        let Some(current) = stored.as_mut() else {
            return Err(AppError::Invalid(
                "Web storage was written before it was created".to_owned(),
            ));
        };
        let mut changed = false;
        for change in changes
            .into_iter()
            .filter(|change| is_mirrored_key(&change.key))
        {
            changed |= match change.value {
                Some(value) => {
                    current.items.insert(change.key, value.clone()).as_ref() != Some(&value)
                }
                None => current.items.remove(&change.key).is_some(),
            };
        }
        if changed {
            persist::save_atomic(&self.path, &*current)?;
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_dir(name: &str) -> PathBuf {
        let dir =
            std::env::temp_dir().join(format!("present-web-storage-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        dir
    }

    fn items(pairs: &[(&str, &str)]) -> BTreeMap<String, String> {
        pairs
            .iter()
            .map(|(key, value)| ((*key).to_owned(), (*value).to_owned()))
            .collect()
    }

    #[test]
    fn a_first_run_is_uninitialized_and_only_the_first_window_is_first() {
        let state = WebStorageState::load(&temp_dir("first"));
        let start = state.start();
        assert!(!start.initialized);
        assert!(start.first_window);
        assert!(!state.start().first_window);
    }

    #[test]
    fn the_store_is_created_once_with_only_mirrored_keys_and_survives_a_restart() {
        let dir = temp_dir("create");
        let state = WebStorageState::load(&dir);
        let created = state
            .initialize(
                items(&[
                    ("present-settings", "a"),
                    ("present-looks-config", "x"),
                    ("other", "y"),
                ]),
                "tauri-origin",
            )
            .unwrap();
        assert_eq!(created, items(&[("present-settings", "a")]));

        let second = state
            .initialize(items(&[("present-settings", "b")]), "electron")
            .unwrap();
        assert_eq!(
            second,
            items(&[("present-settings", "a")]),
            "the first import stands"
        );

        let restarted = WebStorageState::load(&dir);
        let start = restarted.start();
        assert!(start.initialized);
        assert_eq!(start.items, items(&[("present-settings", "a")]));
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn writes_set_and_remove_and_ignore_keys_that_are_not_mirrored() {
        let dir = temp_dir("apply");
        let state = WebStorageState::load(&dir);
        assert!(
            state.apply(vec![]).is_err(),
            "nothing to write to before it exists"
        );
        state
            .initialize(
                items(&[("present-settings", "a"), ("present-ui-state", "u")]),
                "tauri-origin",
            )
            .unwrap();
        state
            .apply(vec![
                StorageChange {
                    key: "present-settings".into(),
                    value: Some("b".into()),
                },
                StorageChange {
                    key: "present-ui-state".into(),
                    value: None,
                },
                StorageChange {
                    key: "present-looks-config".into(),
                    value: Some("ignored".into()),
                },
                StorageChange {
                    key: "present:resizable:x".into(),
                    value: Some("1".into()),
                },
            ])
            .unwrap();
        assert_eq!(
            WebStorageState::load(&dir).start().items,
            items(&[("present-settings", "b"), ("present:resizable:x", "1")])
        );
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn an_unreadable_file_is_imported_again_rather_than_emptied() {
        let dir = temp_dir("corrupt");
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join(WEB_STORAGE_FILE), "{ not json").unwrap();
        assert!(!WebStorageState::load(&dir).start().initialized);
        let _ = std::fs::remove_dir_all(dir);
    }
}
