//! Whether the audience window is drawn natively, and the view doing it.
//!
//! One setting, persisted, and at most one native view — on the Output window,
//! while it is open and the setting is on. See `services/surface` for the
//! handover between the view and the webview.

use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, MutexGuard};
#[cfg(target_os = "macos")]
use std::time::{Duration, Instant};

use tauri::{AppHandle, Emitter};

use crate::errors::AppResult;
use crate::services::surface::{SurfaceSetting, SurfaceStatus, SurfaceWorker};

use super::persist;

const SURFACE_FILE: &str = "output-surface.json";

/// Sent to every window with a [`SurfaceStatus`] when either half changes.
pub const SURFACE_CHANGED_EVENT: &str = "output-surface:changed";

/// Whether this build has a native view to draw on.
pub const SUPPORTED: bool = cfg!(target_os = "macos");

#[derive(Default)]
struct Slot {
    worker: Option<SurfaceWorker>,
    /// Bumped by every attach and detach, so an attach still waiting for the
    /// last view to go does not go ahead after the operator changed their mind
    /// or the window closed.
    generation: u64,
}

pub struct OutputSurfaceState {
    setting: Mutex<SurfaceSetting>,
    path: PathBuf,
    presenting: AtomicBool,
    slot: Mutex<Slot>,
}

impl OutputSurfaceState {
    pub fn load(config_dir: &Path) -> Self {
        let path = config_dir.join(SURFACE_FILE);
        let setting = persist::load_or_default(&path, "the audience surface setting");
        Self::with(path, setting)
    }

    fn with(path: PathBuf, setting: SurfaceSetting) -> Self {
        Self {
            setting: Mutex::new(setting),
            path,
            presenting: AtomicBool::new(false),
            slot: Mutex::new(Slot::default()),
        }
    }

    pub fn status(&self) -> SurfaceStatus {
        SurfaceStatus {
            enabled: self.enabled(),
            presenting: self.presenting.load(Ordering::Relaxed),
            supported: SUPPORTED,
        }
    }

    fn enabled(&self) -> bool {
        self.setting
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .native
    }

    fn slot(&self) -> MutexGuard<'_, Slot> {
        self.slot
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }

    /// Save the choice and act on it: a view onto an open Output window when
    /// turned on, the webview back when turned off.
    pub fn set_native(
        self: &Arc<Self>,
        app: &AppHandle,
        enabled: bool,
        output_open: bool,
    ) -> AppResult<SurfaceStatus> {
        let setting = SurfaceSetting { native: enabled };
        persist::save_atomic(&self.path, &setting)?;
        *self
            .setting
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner()) = setting;

        if enabled && output_open {
            self.attach(app);
        } else if !enabled {
            self.detach();
        }
        let status = self.status();
        emit(app, status);
        Ok(status)
    }

    /// Put the native view on the Output window, if the setting is on.
    ///
    /// Returns at once; the attach runs on its own thread. It needs the main
    /// thread to answer, and both callers — the window being built, and a
    /// synchronous command — may be on the main thread themselves.
    pub fn attach(self: &Arc<Self>, app: &AppHandle) {
        if !SUPPORTED || !self.enabled() {
            return;
        }
        let generation = {
            let mut slot = self.slot();
            slot.generation += 1;
            slot.generation
        };
        let state = Arc::clone(self);
        let app = app.clone();
        let spawned = std::thread::Builder::new()
            .name("audience-surface-attach".to_owned())
            .spawn(move || state.attach_now(&app, generation));
        if let Err(error) = spawned {
            tracing::error!(%error, "could not start attaching the native audience view");
        }
    }

    #[cfg(target_os = "macos")]
    fn attach_now(self: &Arc<Self>, app: &AppHandle, generation: u64) {
        use crate::services::surface::macos::MacPresenter;
        use crate::services::surface::stream::AppSurfaceSource;
        use crate::services::window_spec::WindowRole;

        // A view still being taken down goes first; two views under one
        // webview would be two pictures fighting over one window.
        let deadline = Instant::now() + Duration::from_secs(2);
        loop {
            {
                let slot = self.slot();
                if slot.generation != generation {
                    return;
                }
                match &slot.worker {
                    Some(worker) if !worker.is_finished() && !worker.is_stopping() => return,
                    Some(worker) if !worker.is_finished() => {}
                    _ => break,
                }
            }
            if Instant::now() >= deadline {
                tracing::warn!(
                    "the previous native audience view never went; not attaching another"
                );
                return;
            }
            std::thread::sleep(Duration::from_millis(20));
        }

        // Not under the lock: this waits on the main thread, and the main
        // thread takes the lock when the window closes.
        let presenter = match MacPresenter::attach(app, WindowRole::Output.label()) {
            Ok(presenter) => presenter,
            Err(error) => {
                tracing::error!(%error, "could not put a native view on the audience window");
                return;
            }
        };

        let mut slot = self.slot();
        if slot.generation != generation {
            // Dropping it takes the view away again.
            return;
        }
        let state = Arc::clone(self);
        let events = app.clone();
        let on_presenting = Arc::new(move |presenting: bool| {
            state.presenting.store(presenting, Ordering::Relaxed);
            tracing::info!(presenting, "native audience view");
            emit(&events, state.status());
        });
        match SurfaceWorker::spawn(AppSurfaceSource::new(app.clone()), presenter, on_presenting) {
            Ok(worker) => slot.worker = Some(worker),
            Err(error) => tracing::error!(%error, "could not start the native audience view"),
        }
    }

    #[cfg(not(target_os = "macos"))]
    fn attach_now(self: &Arc<Self>, _app: &AppHandle, _generation: u64) {}

    /// Hand the picture back to the webview and take the view away. Never
    /// waits: see [`SurfaceWorker::signal_stop`].
    pub fn detach(&self) {
        let mut slot = self.slot();
        slot.generation += 1;
        if let Some(worker) = &slot.worker {
            worker.signal_stop();
        }
    }
}

fn emit(app: &AppHandle, status: SurfaceStatus) {
    if let Err(error) = app.emit(SURFACE_CHANGED_EVENT, status) {
        tracing::warn!(%error, "could not announce the audience surface");
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_dir(name: &str) -> PathBuf {
        let dir =
            std::env::temp_dir().join(format!("present-surface-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        dir
    }

    #[test]
    fn a_first_launch_draws_with_the_webview() {
        let dir = temp_dir("first");
        let state = OutputSurfaceState::load(&dir);
        let status = state.status();
        assert!(!status.enabled);
        assert!(!status.presenting);
        assert_eq!(status.supported, cfg!(target_os = "macos"));
    }

    #[test]
    fn the_choice_survives_a_restart() {
        let dir = temp_dir("restart");
        let path = dir.join(SURFACE_FILE);
        persist::save_atomic(&path, &SurfaceSetting { native: true }).unwrap();
        assert!(OutputSurfaceState::load(&dir).status().enabled);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn an_unreadable_file_leaves_it_off() {
        let dir = temp_dir("unreadable");
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join(SURFACE_FILE), "{ not json").unwrap();
        assert!(!OutputSurfaceState::load(&dir).status().enabled);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn detaching_with_nothing_attached_cancels_a_pending_attach() {
        let state = OutputSurfaceState::with(PathBuf::new(), SurfaceSetting { native: true });
        let before = state.slot().generation;
        state.detach();
        assert_eq!(state.slot().generation, before + 1);
        assert!(state.slot().worker.is_none());
    }
}
