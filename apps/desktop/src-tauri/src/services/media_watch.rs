//! Media folders that update while the app is open.
//!
//! The media panel read each folder when it loaded and when someone pressed
//! refresh, so a video copied in before a service did not appear until then.
//! This watches every media folder (FSEvents on macOS, ReadDirectoryChangesW
//! on Windows, inotify on Linux) and tells the panel once a burst of changes
//! has settled — copying a large file is many events, and one re-read is enough.

use std::collections::BTreeSet;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use notify::{EventKind, RecommendedWatcher, RecursiveMode, Watcher};
use tauri::{AppHandle, Emitter};
use tokio::sync::mpsc;

use crate::state::FileState;

pub const CHANGED_EVENT: &str = "media:folders-changed";
/// Changes closer together than this are one change.
pub const SETTLE: Duration = Duration::from_millis(300);

/// Whether a file-system event can change what the panel lists. Reads do not.
pub fn changes_listing(kind: &EventKind) -> bool {
    matches!(
        kind,
        EventKind::Create(_) | EventKind::Remove(_) | EventKind::Modify(_) | EventKind::Any
    )
}

/// The watched folders a set of changed paths belong to.
pub fn affected_folders<'a>(
    watched: impl IntoIterator<Item = &'a PathBuf>,
    changed: &[PathBuf],
) -> Vec<String> {
    watched
        .into_iter()
        .filter(|folder| {
            changed
                .iter()
                .any(|path| path == *folder || path.parent() == Some(folder.as_path()))
        })
        .map(|folder| folder.display().to_string())
        .collect()
}

type Emit = Arc<dyn Fn(Vec<String>) + Send + Sync>;

pub struct MediaWatch {
    watcher: Mutex<Option<RecommendedWatcher>>,
    watched: Arc<Mutex<BTreeSet<PathBuf>>>,
}

impl MediaWatch {
    /// Watch for the app: changes are announced as [`CHANGED_EVENT`].
    pub fn start(app: AppHandle) -> Arc<Self> {
        Self::start_with(Arc::new(move |folders: Vec<String>| {
            tracing::info!(?folders, "media folders changed");
            if let Err(error) = app.emit(CHANGED_EVENT, folders) {
                tracing::warn!(%error, "could not announce a media folder change");
            }
        }))
    }

    pub fn start_with(emit: Emit) -> Arc<Self> {
        let (sender, mut receiver) = mpsc::unbounded_channel::<Vec<PathBuf>>();
        let watcher =
            notify::recommended_watcher(
                move |result: notify::Result<notify::Event>| match result {
                    Ok(event) if changes_listing(&event.kind) => {
                        let _ = sender.send(event.paths);
                    }
                    Ok(_) => {}
                    Err(error) => tracing::warn!(%error, "media folder watcher error"),
                },
            );
        let watcher = match watcher {
            Ok(watcher) => Some(watcher),
            Err(error) => {
                tracing::warn!(%error, "media folders will not update live");
                None
            }
        };

        let watch = Arc::new(Self {
            watcher: Mutex::new(watcher),
            watched: Arc::new(Mutex::new(BTreeSet::new())),
        });

        let watched = Arc::clone(&watch.watched);
        tauri::async_runtime::spawn(async move {
            while let Some(first) = receiver.recv().await {
                let mut changed = first;
                // Wait for the burst to settle.
                while let Ok(Some(more)) = tokio::time::timeout(SETTLE, receiver.recv()).await {
                    changed.extend(more);
                }
                let folders = {
                    let watched = watched
                        .lock()
                        .unwrap_or_else(|poisoned| poisoned.into_inner());
                    affected_folders(watched.iter(), &changed)
                };
                if !folders.is_empty() {
                    emit(folders);
                }
            }
        });
        watch
    }

    /// Watch exactly `folders`.
    pub fn sync(&self, folders: &[PathBuf]) {
        let desired: BTreeSet<PathBuf> = folders.iter().cloned().collect();
        let mut watcher = self
            .watcher
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        let Some(watcher) = watcher.as_mut() else {
            return;
        };
        let mut watched = self
            .watched
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        for gone in watched.difference(&desired).cloned().collect::<Vec<_>>() {
            let _ = watcher.unwatch(&gone);
            watched.remove(&gone);
        }
        for added in desired.difference(&watched.clone()) {
            match watcher.watch(added, RecursiveMode::NonRecursive) {
                Ok(()) => {
                    watched.insert(added.clone());
                }
                Err(error) => {
                    tracing::warn!(folder = %added.display(), %error, "could not watch a media folder");
                }
            }
        }
    }

    /// Watch the folders `state` holds now.
    pub fn sync_with(&self, state: &FileState) {
        let folders: Vec<PathBuf> = state
            .folders()
            .into_iter()
            .map(|folder| Path::new(&folder.path).to_path_buf())
            .collect();
        self.sync(&folders);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_do_not_change_the_listing_and_everything_else_might() {
        use notify::event::{AccessKind, CreateKind, ModifyKind, RemoveKind, RenameMode};
        assert!(changes_listing(&EventKind::Create(CreateKind::File)));
        assert!(changes_listing(&EventKind::Remove(RemoveKind::File)));
        assert!(changes_listing(&EventKind::Modify(ModifyKind::Name(
            RenameMode::Both
        ))));
        assert!(!changes_listing(&EventKind::Access(AccessKind::Read)));
    }

    #[test]
    fn a_change_belongs_to_the_folder_holding_it() {
        let watched = [
            PathBuf::from("/media/backgrounds"),
            PathBuf::from("/media/announcements"),
        ];
        assert_eq!(
            affected_folders(&watched, &[PathBuf::from("/media/backgrounds/loop.mp4")]),
            vec!["/media/backgrounds".to_owned()]
        );
        assert_eq!(
            affected_folders(&watched, &[PathBuf::from("/media/announcements")]),
            vec!["/media/announcements".to_owned()],
            "the folder itself"
        );
        assert!(
            affected_folders(
                &watched,
                &[PathBuf::from("/media/backgrounds/sub/deep.mp4")]
            )
            .is_empty(),
            "the panel lists a folder's own files, not its subfolders'"
        );
    }

    #[test]
    fn a_file_copied_into_a_watched_folder_is_announced_once_settled() {
        let dir = std::env::temp_dir().join(format!("present-media-watch-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let dir = dir.canonicalize().unwrap();

        let announced = Arc::new(Mutex::new(Vec::<Vec<String>>::new()));
        let sink = Arc::clone(&announced);
        let watch =
            MediaWatch::start_with(Arc::new(move |folders| sink.lock().unwrap().push(folders)));
        watch.sync(std::slice::from_ref(&dir));
        std::thread::sleep(Duration::from_millis(300));

        for index in 0..5 {
            std::fs::write(dir.join(format!("clip-{index}.mp4")), b"not really a video").unwrap();
        }

        let deadline = std::time::Instant::now() + Duration::from_secs(5);
        while announced.lock().unwrap().is_empty() && std::time::Instant::now() < deadline {
            std::thread::sleep(Duration::from_millis(50));
        }
        std::thread::sleep(SETTLE * 3);
        let announced = announced.lock().unwrap().clone();
        assert!(!announced.is_empty(), "no change announced");
        assert!(
            announced.len() <= 2,
            "five writes are one or two announcements, not {}",
            announced.len()
        );
        assert!(announced
            .iter()
            .all(|folders| folders == &vec![dir.display().to_string()]));

        watch.sync(&[]);
        let _ = std::fs::remove_dir_all(&dir);
    }
}
