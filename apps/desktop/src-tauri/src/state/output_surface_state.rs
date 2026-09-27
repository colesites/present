//! The view the audience window is drawn on.
//!
//! **There is no setting.** The compositor draws the audience output wherever
//! it can: the operator does not choose a rendering engine, and a build that
//! shipped with the choice off was a build whose congregation never saw a
//! frame FFmpeg decoded. At most one native view, on the Output window, while
//! it is open. See `services/surface` for the handover with the webview,
//! which draws only until the first frame lands and on platforms that have no
//! native view yet.

use std::collections::HashMap;
use std::sync::{Arc, Mutex, MutexGuard};
#[cfg(target_os = "macos")]
use std::time::{Duration, Instant};

use serde::Serialize;
use tauri::{AppHandle, Emitter};

use crate::services::surface::{SurfaceStatus, SurfaceWorker};

/// Sent to every window with a [`SurfaceChanged`] when either half changes.
pub const SURFACE_CHANGED_EVENT: &str = "output-surface:changed";

/// Whether this build has a native view to draw on.
pub const SUPPORTED: bool = cfg!(target_os = "macos");

/// A window's native view started or stopped presenting. Every audience
/// window hears it, and each looks for its own label.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SurfaceChanged {
    pub label: String,
    #[serde(flatten)]
    pub status: SurfaceStatus,
}

#[derive(Default)]
struct Slot {
    worker: Option<SurfaceWorker>,
    /// Bumped by every attach and detach, so an attach still waiting for the
    /// last view to go does not go ahead after the operator changed their mind
    /// or the window closed.
    generation: u64,
    presenting: bool,
}

/// One native view per audience window: the Output, and each audience screen
/// added in Screen Configuration, by window label.
#[derive(Default)]
pub struct OutputSurfaceState {
    slots: Mutex<HashMap<String, Slot>>,
}

impl OutputSurfaceState {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn status(&self, label: &str) -> SurfaceStatus {
        SurfaceStatus {
            presenting: self.slots().get(label).is_some_and(|slot| slot.presenting),
            supported: SUPPORTED,
        }
    }

    fn slots(&self) -> MutexGuard<'_, HashMap<String, Slot>> {
        self.slots
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }

    /// Put the native view on the window labelled `label`, drawing the
    /// audience screen `screen`.
    ///
    /// Returns at once; the attach runs on its own thread. It needs the main
    /// thread to answer, and both callers — the window being built, and a
    /// synchronous command — may be on the main thread themselves.
    pub fn attach(self: &Arc<Self>, app: &AppHandle, label: &str, screen: &str) {
        if !SUPPORTED {
            // Windows and Linux have no native view yet, so the webview keeps
            // drawing there, as it always has.
            return;
        }
        let generation = {
            let mut slots = self.slots();
            let slot = slots.entry(label.to_owned()).or_default();
            slot.generation += 1;
            slot.generation
        };
        let state = Arc::clone(self);
        let app = app.clone();
        let (label, screen) = (label.to_owned(), screen.to_owned());
        let spawned = std::thread::Builder::new()
            .name("audience-surface-attach".to_owned())
            .spawn(move || state.attach_now(&app, &label, &screen, generation));
        if let Err(error) = spawned {
            tracing::error!(%error, "could not start attaching the native audience view");
        }
    }

    #[cfg(target_os = "macos")]
    fn attach_now(self: &Arc<Self>, app: &AppHandle, label: &str, screen: &str, generation: u64) {
        use crate::services::surface::macos::MacPresenter;
        use crate::services::surface::stream::AppSurfaceSource;

        let current = |slots: &HashMap<String, Slot>| {
            slots
                .get(label)
                .is_some_and(|slot| slot.generation == generation)
        };

        // A view still being taken down goes first; two views under one
        // webview would be two pictures fighting over one window.
        let deadline = Instant::now() + Duration::from_secs(2);
        loop {
            {
                let slots = self.slots();
                if !current(&slots) {
                    return;
                }
                match slots.get(label).and_then(|slot| slot.worker.as_ref()) {
                    Some(worker) if !worker.is_finished() && !worker.is_stopping() => return,
                    Some(worker) if !worker.is_finished() => {}
                    _ => break,
                }
            }
            if Instant::now() >= deadline {
                tracing::warn!(
                    label,
                    "the previous native audience view never went; not attaching another"
                );
                return;
            }
            std::thread::sleep(Duration::from_millis(20));
        }

        // Not under the lock: this waits on the main thread, and the main
        // thread takes the lock when the window closes.
        let presenter = match MacPresenter::attach(app, label) {
            Ok(presenter) => presenter,
            Err(error) => {
                tracing::error!(%error, label, "could not put a native view on the audience window");
                return;
            }
        };

        let mut slots = self.slots();
        if !current(&slots) {
            // Dropping it takes the view away again.
            return;
        }
        let state = Arc::clone(self);
        let events = app.clone();
        let owner = label.to_owned();
        let on_presenting = Arc::new(move |presenting: bool| {
            if let Some(slot) = state.slots().get_mut(&owner) {
                slot.presenting = presenting;
            }
            tracing::info!(presenting, label = %owner, "native audience view");
            emit(&events, &owner, state.status(&owner));
        });
        let source = AppSurfaceSource::new(app.clone(), screen);
        match SurfaceWorker::spawn(source, presenter, on_presenting) {
            Ok(worker) => {
                if let Some(slot) = slots.get_mut(label) {
                    slot.worker = Some(worker);
                }
            }
            Err(error) => {
                tracing::error!(%error, label, "could not start the native audience view")
            }
        }
    }

    #[cfg(not(target_os = "macos"))]
    fn attach_now(
        self: &Arc<Self>,
        _app: &AppHandle,
        _label: &str,
        _screen: &str,
        _generation: u64,
    ) {
    }

    /// Hand the picture back to the webview of `label` and take the view
    /// away. Never waits: see [`SurfaceWorker::signal_stop`].
    pub fn detach(&self, label: &str) {
        let mut slots = self.slots();
        let slot = slots.entry(label.to_owned()).or_default();
        slot.generation += 1;
        slot.presenting = false;
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
fn emit(app: &AppHandle, label: &str, status: SurfaceStatus) {
    let changed = SurfaceChanged {
        label: label.to_owned(),
        status,
    };
    if let Err(error) = app.emit(SURFACE_CHANGED_EVENT, changed) {
        tracing::warn!(%error, "could not announce the audience surface");
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_compositor_draws_the_audience_output_with_nothing_to_turn_on() {
        let state = OutputSurfaceState::new();
        let status = state.status("output");
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
        let generation = |state: &OutputSurfaceState| {
            state
                .slots()
                .get("output")
                .map_or(0, |slot| slot.generation)
        };
        let before = generation(&state);
        state.detach("output");
        assert_eq!(generation(&state), before + 1);
        assert!(state.slots()["output"].worker.is_none());
    }

    #[test]
    fn each_audience_window_has_a_view_of_its_own() {
        let state = OutputSurfaceState::new();
        state.detach("audience-lobby");
        assert_eq!(generation_of(&state, "audience-lobby"), 1);
        assert_eq!(
            generation_of(&state, "output"),
            0,
            "the Output's is untouched"
        );
        assert!(!state.status("audience-lobby").presenting);
    }

    fn generation_of(state: &OutputSurfaceState, label: &str) -> u64 {
        state.slots().get(label).map_or(0, |slot| slot.generation)
    }
}
