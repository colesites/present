//! The NDI runtime, and the stream while it runs.
//!
//! In memory. Whether NDI is enabled, and under which name, is a setting the
//! React side keeps and re-applies on launch (`useAppSettings.ts:543-567`);
//! this holds only what exists while the app is running.

use std::path::Path;
use std::sync::{Arc, Mutex, MutexGuard};

use tauri::AppHandle;

use crate::services::ndi::library;
use crate::services::ndi::output::{NdiStatus, OutputWorker};
use crate::services::ndi::rules;
use crate::services::ndi::sender::Sender;
use crate::services::ndi::stream::AppFrameSource;
use crate::services::ndi::NdiLib;

/// A loaded runtime, kept for the life of the process.
struct Runtime {
    lib: Arc<NdiLib>,
    version: String,
}

#[derive(Default)]
pub struct NdiState {
    runtime: Mutex<Option<Runtime>>,
    /// Why the runtime last failed to load. Kept so the status can say it
    /// without trying again on every poll.
    load_error: Mutex<Option<String>>,
    worker: Mutex<Option<OutputWorker>>,
    status: Arc<Mutex<NdiStatus>>,
}

/// What `startNdiOutput` answers.
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StartResult {
    pub ok: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    pub status: NdiStatus,
}

fn lock<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
    mutex
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}

impl NdiState {
    pub fn new() -> Self {
        Self::default()
    }

    /// The runtime, loading it if it is not loaded.
    ///
    /// A failure is retried on the next call, as Electron's loader does, so an
    /// operator who installs NDI Tools does not have to restart Present for it
    /// to be found. It is logged once.
    pub fn runtime(&self, resource_dir: Option<&Path>) -> Result<Arc<NdiLib>, String> {
        let mut runtime = lock(&self.runtime);
        if let Some(loaded) = runtime.as_ref() {
            return Ok(loaded.lib.clone());
        }

        match library::load(&library::candidates_from_env(resource_dir)) {
            Ok(loaded) => {
                tracing::info!(
                    path = %loaded.path.display(),
                    version = %loaded.version,
                    "NDI runtime loaded"
                );
                let lib = loaded.lib.clone();
                *runtime = Some(Runtime {
                    lib: loaded.lib,
                    version: loaded.version,
                });
                *lock(&self.load_error) = None;
                Ok(lib)
            }
            Err(error) => {
                let mut previous = lock(&self.load_error);
                if previous.as_deref() != Some(error.as_str()) {
                    tracing::warn!(%error, "NDI runtime unavailable");
                }
                *previous = Some(error.clone());
                Err(error)
            }
        }
    }

    /// Start sending, replacing any stream already running.
    pub fn start_output(
        &self,
        app: AppHandle,
        resource_dir: Option<&Path>,
        source_name: &str,
        group_name: &str,
    ) -> StartResult {
        let source_name = rules::normalize_source_name(source_name);
        let group_name = rules::normalize_group_name(group_name);

        // As Electron does: the names are the status's even if starting fails,
        // so Settings shows what was asked for.
        {
            let mut status = lock(&self.status);
            status.source_name = source_name.clone();
            status.group_name = group_name.clone();
        }

        self.stop_output();

        let fail = |error: String| {
            let mut status = lock(&self.status);
            status.running = false;
            status.last_error = Some(error.clone());
            drop(status);
            StartResult {
                ok: false,
                error: Some(error),
                status: self.status(resource_dir),
            }
        };

        let lib = match self.runtime(resource_dir) {
            Ok(lib) => lib,
            Err(error) => return fail(format!("Failed to load NDI backend. {error}")),
        };

        let sender = match Sender::new(lib, &source_name, &group_name) {
            Ok(sender) => sender,
            Err(error) => return fail(error),
        };

        {
            let mut status = lock(&self.status);
            status.running = true;
            status.frames_sent = 0;
            status.last_error = None;
            status.using_fallback_frame = false;
            status.connections = 0;
            status.frame_ms = None;
        }

        match OutputWorker::spawn(AppFrameSource::new(app), sender, self.status.clone()) {
            Ok(worker) => {
                *lock(&self.worker) = Some(worker);
                tracing::info!(source = %source_name, group = %group_name, "NDI output started");
                StartResult {
                    ok: true,
                    error: None,
                    status: self.status(resource_dir),
                }
            }
            Err(error) => fail(format!("The NDI output thread could not start: {error}")),
        }
    }

    /// Stop sending. The source leaves the network immediately.
    pub fn stop_output(&self) {
        let worker = lock(&self.worker).take();
        if let Some(worker) = worker {
            worker.stop();
            tracing::info!("NDI output stopped");
        }
        let mut status = lock(&self.status);
        status.running = false;
        status.using_fallback_frame = false;
        status.connections = 0;
    }

    /// The status, with whether the runtime can be loaded.
    ///
    /// Asking loads the runtime if it is not loaded — `getNdiStatus` does the
    /// same in Electron — which is how Settings can say "unavailable" before
    /// anyone has tried to start a stream.
    pub fn status(&self, resource_dir: Option<&Path>) -> NdiStatus {
        let loaded = self.runtime(resource_dir).is_ok();
        let version = lock(&self.runtime)
            .as_ref()
            .map(|runtime| runtime.version.clone());
        let mut status = lock(&self.status).clone();
        status.library_loaded = loaded;
        status.library_version = version;
        status
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_fresh_state_is_stopped_under_the_default_names() {
        let state = NdiState::new();
        let status = lock(&state.status).clone();
        assert!(!status.running);
        assert_eq!(status.source_name, "Present Main Output");
        assert_eq!(status.group_name, "Public");
        assert_eq!(status.frames_sent, 0);
    }

    #[test]
    fn stopping_what_never_started_is_harmless() {
        let state = NdiState::new();
        state.stop_output();
        state.stop_output();
        assert!(!lock(&state.status).running);
    }
}
