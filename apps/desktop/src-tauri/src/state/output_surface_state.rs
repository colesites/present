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

use serde::Serialize;
use tauri::{AppHandle, Emitter};

use crate::services::screens::screen_id_for_label;
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

/// One screen's native drawing: its worker, and which of its windows have
/// frames on them.
#[derive(Default)]
struct Slot {
    worker: Option<SurfaceWorker>,
    presenting: HashMap<String, bool>,
}

/// One native view per audience window, drawn by one worker per screen: the
/// Output and the audience screens added in Screen Configuration, and each of
/// their outputs.
#[derive(Default)]
pub struct OutputSurfaceState {
    slots: Mutex<HashMap<String, Slot>>,
}

impl OutputSurfaceState {
    pub fn new() -> Self {
        Self::default()
    }

    /// Whether the window labelled `label` has frames on its native view.
    pub fn status(&self, label: &str) -> SurfaceStatus {
        let presenting = screen_id_for_label(label).is_some_and(|screen| {
            self.slots()
                .get(screen)
                .and_then(|slot| slot.presenting.get(label))
                .copied()
                .unwrap_or(false)
        });
        SurfaceStatus {
            presenting,
            supported: SUPPORTED,
        }
    }

    fn slots(&self) -> MutexGuard<'_, HashMap<String, Slot>> {
        self.slots
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }

    /// Put a native view on the window labelled `label`, drawn with the rest
    /// of its screen's windows.
    ///
    /// Returns at once; the attach runs on its own thread. It needs the main
    /// thread to answer, and both callers — the window being built, and a
    /// synchronous command — may be on the main thread themselves.
    pub fn attach(self: &Arc<Self>, app: &AppHandle, label: &str) {
        if !SUPPORTED {
            // Windows and Linux have no native view yet, so the webview keeps
            // drawing there, as it always has.
            return;
        }
        let Some(screen) = screen_id_for_label(label).map(str::to_owned) else {
            return;
        };
        let state = Arc::clone(self);
        let app = app.clone();
        let label = label.to_owned();
        let spawned = std::thread::Builder::new()
            .name("audience-surface-attach".to_owned())
            .spawn(move || state.attach_now(&app, &label, &screen));
        if let Err(error) = spawned {
            tracing::error!(%error, "could not start attaching a native audience view");
        }
    }

    #[cfg(target_os = "macos")]
    fn attach_now(self: &Arc<Self>, app: &AppHandle, label: &str, screen: &str) {
        use crate::services::surface::macos::MacPresenter;
        use crate::services::surface::stream::AppSurfaceSource;
        use crate::services::surface::Presenter;

        // Not under the lock: this waits on the main thread, and the main
        // thread takes the lock when a window closes.
        let presenter: Box<dyn Presenter> = match MacPresenter::attach(app, label) {
            Ok(presenter) => Box::new(presenter),
            Err(error) => {
                tracing::error!(%error, label, "could not put a native view on an audience window");
                return;
            }
        };

        let mut slots = self.slots();
        let slot = slots.entry(screen.to_owned()).or_default();
        let presenter = match &slot.worker {
            Some(worker) => {
                if worker.add(label, presenter) {
                    return;
                }
                // It has stopped; a new one starts with this window.
                match MacPresenter::attach(app, label) {
                    Ok(again) => Box::new(again) as Box<dyn Presenter>,
                    Err(error) => {
                        tracing::error!(%error, label, "could not put a native view on an audience window");
                        return;
                    }
                }
            }
            None => presenter,
        };

        let state = Arc::clone(self);
        let events = app.clone();
        let owner = screen.to_owned();
        let on_presenting = Arc::new(move |label: &str, presenting: bool| {
            if let Some(slot) = state.slots().get_mut(&owner) {
                slot.presenting.insert(label.to_owned(), presenting);
            }
            tracing::info!(presenting, label, "native audience view");
            emit(&events, label, state.status(label));
        });
        let source = AppSurfaceSource::new(app.clone(), screen);
        match SurfaceWorker::spawn(source, vec![(label.to_owned(), presenter)], on_presenting) {
            Ok(worker) => slot.worker = Some(worker),
            Err(error) => {
                tracing::error!(%error, screen, "could not start drawing a screen natively")
            }
        }
    }

    #[cfg(not(target_os = "macos"))]
    fn attach_now(self: &Arc<Self>, _app: &AppHandle, _label: &str, _screen: &str) {}

    /// Hand the window labelled `label` back to its webview and take its view
    /// away; the screen's other windows go on. Never waits: see
    /// [`SurfaceWorker::signal_stop`].
    pub fn detach(&self, label: &str) {
        let Some(screen) = screen_id_for_label(label) else {
            return;
        };
        let mut slots = self.slots();
        let Some(slot) = slots.get_mut(screen) else {
            return;
        };
        slot.presenting.remove(label);
        if let Some(worker) = &slot.worker {
            worker.remove(label);
            if worker.labels().is_empty() {
                worker.signal_stop();
            }
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
    fn each_window_says_whether_its_own_view_has_frames() {
        let state = OutputSurfaceState::new();
        state
            .slots()
            .entry("audience".into())
            .or_default()
            .presenting
            .insert("output--b".into(), true);
        assert!(state.status("output--b").presenting);
        assert!(
            !state.status("output").presenting,
            "the screen's other window has none yet"
        );
        state.detach("output--b");
        assert!(
            !state.status("output--b").presenting,
            "handed back when it goes"
        );
        assert!(
            !state.status("settings").presenting,
            "a window that is no screen's"
        );
    }
}
