//! The view the audience window is drawn on.
//!
//! **There is no setting.** The compositor draws the audience output wherever
//! it can: the operator does not choose a rendering engine, and a build that
//! shipped with the choice off was a build whose congregation never saw a
//! frame FFmpeg decoded. At most one native view, on the Output window, while
//! it is open. See `services/surface` for the handover with the webview,
//! which draws only until the first frame lands and on platforms that have no
//! native view yet.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, MutexGuard};
#[cfg(target_os = "macos")]
use std::time::{Duration, Instant};

use tauri::{AppHandle, Emitter};

use crate::services::surface::{SurfaceStatus, SurfaceWorker};

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

#[derive(Default)]
pub struct OutputSurfaceState {
    presenting: AtomicBool,
    slot: Mutex<Slot>,
}

impl OutputSurfaceState {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn status(&self) -> SurfaceStatus {
        SurfaceStatus {
            presenting: self.presenting.load(Ordering::Relaxed),
            supported: SUPPORTED,
        }
    }

    fn slot(&self) -> MutexGuard<'_, Slot> {
        self.slot
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }

    /// Put the native view on the Output window.
    ///
    /// Returns at once; the attach runs on its own thread. It needs the main
    /// thread to answer, and both callers — the window being built, and a
    /// synchronous command — may be on the main thread themselves.
    pub fn attach(self: &Arc<Self>, app: &AppHandle) {
        if !SUPPORTED {
            // Windows and Linux have no native view yet, so the webview keeps
            // drawing there, as it always has.
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

/// Only the native macOS view reports that it started or stopped presenting,
/// so on the other platforms nothing calls this yet.
///
/// Allowed rather than `cfg`-gated: gating the function makes its import
/// unused on those platforms too, and then the `cfg` has to be repeated on
/// the import — one platform difference spreading into two places that must
/// agree. The day another platform grows a native view, this attribute goes
/// and nothing else changes.
#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
fn emit(app: &AppHandle, status: SurfaceStatus) {
    if let Err(error) = app.emit(SURFACE_CHANGED_EVENT, status) {
        tracing::warn!(%error, "could not announce the audience surface");
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_compositor_draws_the_audience_output_with_nothing_to_turn_on() {
        let state = OutputSurfaceState::new();
        let status = state.status();
        assert_eq!(
            status.supported,
            cfg!(target_os = "macos"),
            "where there is a native view to draw on"
        );
        assert!(
            !status.presenting,
            "no frame has landed yet, so the webview is still drawing"
        );
    }

    #[test]
    fn detaching_with_nothing_attached_cancels_a_pending_attach() {
        let state = OutputSurfaceState::new();
        let before = state.slot().generation;
        state.detach();
        assert_eq!(state.slot().generation, before + 1);
        assert!(state.slot().worker.is_none());
    }
}
