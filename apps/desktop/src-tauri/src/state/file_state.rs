//! The media folders the operator added, and the scope they define.
//!
//! Two things live together here because they are the same fact seen twice: the
//! list the Media panel shows, and the set of directories the renderer is
//! allowed to read. Under Electron they were separate — the list lived in the
//! renderer's IndexedDB and the permission did not exist at all — which is how
//! `local-media://` came to read anything on disk.
//!
//! Owning the list in Rust also survives the origin change. The Tauri build
//! serves from a sixth origin with an empty IndexedDB (known-issues §2), so a
//! folder list kept only in web storage would start blank on every build.

use std::path::{Path, PathBuf};
use std::sync::RwLock;

use serde::{Deserialize, Serialize};

use crate::errors::{AppError, AppResult};
use crate::services::file_scope::{FileScope, Grant};

use super::persist;

const FOLDERS_FILE: &str = "media-folders.json";
const CURRENT_VERSION: u32 = 1;

/// One folder in the Media panel. The shape matches what `select-folder`
/// returns under Electron (`file.ipc.ts:88-92`) so the React side is unchanged.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct MediaFolder {
    pub id: String,
    pub name: String,
    pub path: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MediaFolders {
    pub version: u32,
    #[serde(default)]
    pub folders: Vec<MediaFolder>,
}

impl Default for MediaFolders {
    fn default() -> Self {
        Self {
            version: CURRENT_VERSION,
            folders: Vec::new(),
        }
    }
}

pub struct FileState {
    scope: RwLock<FileScope>,
    folders: RwLock<MediaFolders>,
    path: PathBuf,
}

impl FileState {
    /// Load the saved folders and admit each one that is still reachable.
    ///
    /// A folder on an external drive that is not plugged in cannot be
    /// canonicalised, so it is kept in the list but not admitted to the scope.
    /// `reconcile_roots` picks it up once the drive comes back — losing the
    /// operator's folder because a USB stick was out is not acceptable.
    pub fn load(config_dir: &Path) -> Self {
        let path = config_dir.join(FOLDERS_FILE);
        let folders: MediaFolders = persist::load_or_default(&path, "media folders");

        let mut scope = FileScope::new();
        for folder in &folders.folders {
            if let Err(error) = scope.allow_dir(Path::new(&folder.path), Grant::Media) {
                tracing::warn!(
                    %error,
                    folder = %folder.path,
                    "saved media folder is not reachable right now"
                );
            }
        }

        Self {
            scope: RwLock::new(scope),
            folders: RwLock::new(folders),
            path,
        }
    }

    pub fn folders(&self) -> Vec<MediaFolder> {
        self.read_folders().folders.clone()
    }

    /// Add a folder, or return the existing entry when it is already there.
    ///
    /// Matching on the canonical path rather than the string the dialog
    /// returned means `/tmp/media` and `/private/tmp/media` are one folder, not
    /// two entries pointing at the same files.
    pub fn add_folder(&self, path: &Path) -> AppResult<MediaFolder> {
        let canonical = self.write_scope().allow_dir(path, Grant::Media)?;
        let canonical_string = canonical.display().to_string();

        if let Some(existing) = self
            .read_folders()
            .folders
            .iter()
            .find(|folder| folder.path == canonical_string)
        {
            return Ok(existing.clone());
        }

        let folder = MediaFolder {
            // Same shape as the Electron handler so nothing downstream has to
            // learn a new id format.
            id: format!("folder-{}", now_ms()),
            name: canonical
                .file_name()
                .map(|name| name.to_string_lossy().into_owned())
                .unwrap_or_else(|| canonical_string.clone()),
            path: canonical_string,
        };

        self.update_folders(|folders| folders.folders.push(folder.clone()))?;
        Ok(folder)
    }

    /// Remove a folder and close the access it granted.
    pub fn remove_folder(&self, id: &str) -> AppResult<bool> {
        let removed = self
            .read_folders()
            .folders
            .iter()
            .find(|folder| folder.id == id)
            .cloned();

        let Some(folder) = removed else {
            return Ok(false);
        };

        self.update_folders(|folders| folders.folders.retain(|entry| entry.id != id))?;
        self.write_scope().revoke_media(Path::new(&folder.path));
        Ok(true)
    }

    /// Admit a path the operator picked in a dialog, for this run only.
    pub fn grant_picked_file(&self, path: &Path) -> AppResult<PathBuf> {
        self.write_scope().allow_file(path, Grant::Session)
    }

    /// Admit a folder the operator picked in a dialog, for this run only.
    ///
    /// Used for the library export destination and the import source, neither
    /// of which is a media folder and neither of which should outlive the run.
    pub fn grant_picked_dir(&self, path: &Path) -> AppResult<PathBuf> {
        self.write_scope().allow_dir(path, Grant::Session)
    }

    pub fn resolve_existing(&self, path: &str) -> AppResult<PathBuf> {
        self.retrying(|scope| scope.resolve_existing(path))
    }

    pub fn resolve_new(&self, path: &str) -> AppResult<PathBuf> {
        self.retrying(|scope| scope.resolve_new(path))
    }

    /// Run a scope check, and if it is refused, re-admit any saved folder that
    /// has become reachable since startup and try once more.
    ///
    /// This is the unplugged-drive case: the operator's media lives on a USB
    /// disk that was not mounted when the app launched. Re-admitting only on
    /// failure keeps the common path to a single lock and no syscalls beyond
    /// the one canonicalisation.
    fn retrying<T, F>(&self, check: F) -> AppResult<T>
    where
        F: Fn(&FileScope) -> AppResult<T>,
    {
        // Bound to a `let` rather than matched directly: a temporary in a match
        // scrutinee lives for the whole match, so the read guard would still be
        // held when the retry arm asks for the write lock, and `RwLock`
        // deadlocks on that.
        let first = check(&self.read_scope());

        match first {
            Err(AppError::Denied(message)) => {
                if !self.reconcile_roots() {
                    return Err(AppError::Denied(message));
                }
                check(&self.read_scope())
            }
            other => other,
        }
    }

    /// Admit saved folders the scope does not hold yet. Returns whether
    /// anything was added.
    fn reconcile_roots(&self) -> bool {
        let saved = self.folders();
        let mut scope = self.write_scope();
        let mut admitted = false;

        for folder in saved {
            let path = Path::new(&folder.path);
            if scope.contains(path) {
                continue;
            }
            if scope.allow_dir(path, Grant::Media).is_ok() {
                tracing::info!(folder = %folder.path, "saved media folder is reachable again");
                admitted = true;
            }
        }

        admitted
    }

    fn update_folders<F>(&self, mutate: F) -> AppResult<()>
    where
        F: FnOnce(&mut MediaFolders),
    {
        let snapshot = {
            let mut folders = self
                .folders
                .write()
                .unwrap_or_else(|poisoned| poisoned.into_inner());
            mutate(&mut folders);
            folders.clone()
        };

        persist::save_atomic(&self.path, &snapshot)
    }

    fn read_folders(&self) -> std::sync::RwLockReadGuard<'_, MediaFolders> {
        self.folders
            .read()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }

    fn read_scope(&self) -> std::sync::RwLockReadGuard<'_, FileScope> {
        self.scope
            .read()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }

    fn write_scope(&self) -> std::sync::RwLockWriteGuard<'_, FileScope> {
        self.scope
            .write()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }
}

fn now_ms() -> u128 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|elapsed| elapsed.as_millis())
        .unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_dir(label: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "present-file-state-{label}-{}-{:?}",
            std::process::id(),
            std::thread::current().id()
        ));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).expect("temp dir");
        std::fs::canonicalize(&dir).expect("canonical")
    }

    #[test]
    fn a_folder_added_once_survives_a_restart() {
        let dir = temp_dir("restart");
        let config = dir.join("config");
        let media = dir.join("media");
        std::fs::create_dir_all(&media).expect("media dir");
        std::fs::write(media.join("clip.mp4"), "video").expect("clip");

        let state = FileState::load(&config);
        let folder = state.add_folder(&media).expect("added");
        assert_eq!(folder.name, "media");

        let reloaded = FileState::load(&config);
        assert_eq!(reloaded.folders().len(), 1);
        assert!(reloaded
            .resolve_existing(media.join("clip.mp4").to_str().expect("utf-8"))
            .is_ok());
    }

    #[test]
    fn adding_the_same_folder_twice_does_not_duplicate_it() {
        let dir = temp_dir("dedupe");
        let media = dir.join("media");
        std::fs::create_dir_all(&media).expect("media dir");

        let state = FileState::load(&dir.join("config"));
        let first = state.add_folder(&media).expect("added");
        let second = state.add_folder(&media).expect("added again");

        assert_eq!(first, second);
        assert_eq!(state.folders().len(), 1);
    }

    #[test]
    fn removing_a_folder_closes_its_files() {
        let dir = temp_dir("remove");
        let media = dir.join("media");
        std::fs::create_dir_all(&media).expect("media dir");
        let clip = media.join("clip.mp4");
        std::fs::write(&clip, "video").expect("clip");

        let state = FileState::load(&dir.join("config"));
        let folder = state.add_folder(&media).expect("added");
        assert!(state
            .resolve_existing(clip.to_str().expect("utf-8"))
            .is_ok());

        assert!(state.remove_folder(&folder.id).expect("removed"));
        assert!(state
            .resolve_existing(clip.to_str().expect("utf-8"))
            .is_err());
        assert!(!state.remove_folder(&folder.id).expect("already gone"));
    }

    #[test]
    fn a_saved_folder_that_reappears_is_readmitted() {
        let dir = temp_dir("readmit");
        let config = dir.join("config");
        let media = dir.join("media");
        std::fs::create_dir_all(&media).expect("media dir");

        let state = FileState::load(&config);
        state.add_folder(&media).expect("added");
        drop(state);

        // The drive is missing at launch…
        std::fs::remove_dir_all(&media).expect("unplugged");
        let state = FileState::load(&config);
        assert_eq!(state.folders().len(), 1, "the folder is remembered");

        // …and comes back afterwards.
        std::fs::create_dir_all(&media).expect("replugged");
        let clip = media.join("clip.mp4");
        std::fs::write(&clip, "video").expect("clip");

        assert!(state
            .resolve_existing(clip.to_str().expect("utf-8"))
            .is_ok());
    }

    #[test]
    fn nothing_is_reachable_before_a_folder_is_added() {
        let dir = temp_dir("empty");
        let stray = dir.join("stray.mp4");
        std::fs::write(&stray, "video").expect("file");

        let state = FileState::load(&dir.join("config"));
        let error = state
            .resolve_existing(stray.to_str().expect("utf-8"))
            .expect_err("must be refused");
        assert!(matches!(error, AppError::Denied(_)), "got {error:?}");
    }

    #[test]
    fn a_picked_file_is_reachable_but_not_saved() {
        let dir = temp_dir("picked");
        let config = dir.join("config");
        let picked = dir.join("elsewhere").join("prop.png");
        std::fs::create_dir_all(picked.parent().expect("parent")).expect("dir");
        std::fs::write(&picked, "image").expect("file");

        let state = FileState::load(&config);
        state.grant_picked_file(&picked).expect("granted");
        assert!(state
            .resolve_existing(picked.to_str().expect("utf-8"))
            .is_ok());
        assert!(state.folders().is_empty());

        // A session grant is exactly that: gone on the next launch.
        let relaunched = FileState::load(&config);
        assert!(relaunched
            .resolve_existing(picked.to_str().expect("utf-8"))
            .is_err());
    }
}
