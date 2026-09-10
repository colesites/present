//! The live audio graph.
//!
//! Persisted, because the device choice is exactly the setting an operator
//! makes once when the desk is wired up and never expects to make again. Today
//! it lives in the `present-settings` localStorage key, which Chromium
//! partitions by origin, so the dev build and the packaged build already
//! disagree about it and the Tauri build — a sixth origin — starts with no
//! choice at all (known-issues §2). One file owned by the app removes all of
//! that.
//!
//! Levels ride along in the same file. They are small, they change during a
//! service, and an operator who set the backing track to 40% before the service
//! should not find it back at 85% after a crash.

use std::path::{Path, PathBuf};
use std::sync::RwLock;

use crate::errors::AppResult;
use crate::services::audio::AudioGraph;

use super::persist;

const AUDIO_FILE: &str = "audio.json";

pub struct AudioState {
    graph: RwLock<AudioGraph>,
    path: PathBuf,
}

impl AudioState {
    pub fn load(config_dir: &Path) -> Self {
        let path = config_dir.join(AUDIO_FILE);
        let graph = persist::load_or_default(&path, "the audio graph");

        Self {
            graph: RwLock::new(graph),
            path,
        }
    }

    pub fn snapshot(&self) -> AudioGraph {
        self.graph
            .read()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .clone()
    }

    /// Apply a change and write it out.
    ///
    /// The mutation returns whether anything actually changed, so nudging a
    /// slider to the value it already has neither rewrites the file nor wakes
    /// every window. Same contract as `LooksState::update`.
    pub fn update<F>(&self, mutate: F) -> AppResult<Option<AudioGraph>>
    where
        F: FnOnce(&mut AudioGraph) -> bool,
    {
        let snapshot = {
            let mut graph = self
                .graph
                .write()
                .unwrap_or_else(|poisoned| poisoned.into_inner());
            if !mutate(&mut graph) {
                return Ok(None);
            }
            graph.clone()
        };

        persist::save_atomic(&self.path, &snapshot)?;
        Ok(Some(snapshot))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::services::audio::{AudioSource, AudioSurface};

    fn temp_dir(label: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "present-audio-state-{label}-{}-{:?}",
            std::process::id(),
            std::thread::current().id()
        ));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).expect("temp dir");
        dir
    }

    #[test]
    fn a_fresh_install_gets_the_system_default_device() {
        let graph = AudioState::load(&temp_dir("fresh")).snapshot();

        assert_eq!(graph.sink.device_id, None);
        assert_eq!(graph.backing_track.gain, 0.85);
    }

    #[test]
    fn the_device_choice_survives_a_restart() {
        // The whole reason this is a file. Under Electron this setting is
        // origin-partitioned and a developer's two builds disagree about it.
        let dir = temp_dir("restart");
        let state = AudioState::load(&dir);

        state
            .update(|graph| graph.set_device(Some("desk-usb"), Some("Scarlett 2i2")))
            .expect("save");

        let reloaded = AudioState::load(&dir).snapshot();
        assert_eq!(reloaded.sink.device_id.as_deref(), Some("desk-usb"));
        assert_eq!(reloaded.sink.device_label, "Scarlett 2i2");
        assert_eq!(
            reloaded
                .routing(AudioSource::BackingTrack, AudioSurface::Operator)
                .device_id
                .as_deref(),
            Some("desk-usb")
        );
    }

    #[test]
    fn a_no_op_update_does_not_write_the_file() {
        let dir = temp_dir("noop");
        let state = AudioState::load(&dir);

        assert!(state
            .update(|graph| graph.set_master_muted(false))
            .expect("update")
            .is_none());
        assert!(!dir.join(AUDIO_FILE).exists());
    }

    #[test]
    fn an_unreadable_file_starts_from_defaults_rather_than_failing() {
        // An operator ten minutes before a service needs a working app more
        // than a saved preference (see `persist`).
        let dir = temp_dir("corrupt");
        std::fs::write(dir.join(AUDIO_FILE), "{ not json").expect("write");

        assert_eq!(AudioState::load(&dir).snapshot(), AudioGraph::default());
    }
}
