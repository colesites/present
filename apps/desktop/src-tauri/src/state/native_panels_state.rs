//! The panels drawn natively over the app's windows (`surface::panel`), by the
//! id each page gave its panel, and which window each is in.
//!
//! A panel the page forgets — a window reloaded, a page that crashed before it
//! could say goodbye — would leave its picture floating over the page. So a
//! page clears its window's panels when it loads (`forget_window`), and so
//! does the window closing; and a panel whose page stops saying where it is
//! hides itself (`NativePanel::is_current`).

use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, MutexGuard, PoisonError};

use tauri::AppHandle;

use crate::services::media_frames::Clock;
use crate::services::surface::panel::NativePanel;
use crate::state::media_frames_state::NativeMedia;
use crate::state::preview_state;

/// What a panel shows.
#[derive(Debug, Clone, PartialEq)]
pub enum PanelSource {
    /// A video file, keeping time as `clock` says (`media_frames`).
    Media { url: String, clock: Clock },
    /// The audience screen with this id, as the operator's preview of it.
    Preview(String),
}

/// What draws a panel's frames.
enum Driver {
    Media(Arc<NativeMedia>),
    Preview(Arc<AtomicBool>),
}

impl Driver {
    fn start(app: &AppHandle, source: PanelSource, panel: Arc<NativePanel>) -> Self {
        match source {
            PanelSource::Media { url, clock } => {
                Self::Media(NativeMedia::start(app, panel, url, clock))
            }
            PanelSource::Preview(screen) => {
                Self::Preview(preview_state::start_native(app, &screen, panel))
            }
        }
    }

    fn stop(&self) {
        match self {
            Self::Media(media) => media.stop(),
            Self::Preview(stop) => stop.store(true, Ordering::Relaxed),
        }
    }
}

struct Attached {
    window: String,
    panel: Arc<NativePanel>,
    driver: Driver,
}

#[derive(Default)]
pub struct NativePanelsState {
    panels: Mutex<HashMap<String, Attached>>,
}

impl NativePanelsState {
    pub fn new() -> Self {
        Self::default()
    }

    fn panels(&self) -> MutexGuard<'_, HashMap<String, Attached>> {
        self.panels.lock().unwrap_or_else(PoisonError::into_inner)
    }

    /// Show `source` on `panel`, the panel `id` of `window`, in place of any
    /// panel that had the id before.
    pub fn attach(
        &self,
        app: &AppHandle,
        id: &str,
        window: &str,
        source: PanelSource,
        panel: Arc<NativePanel>,
    ) {
        let driver = Driver::start(app, source, Arc::clone(&panel));
        let previous = self.panels().insert(
            id.to_owned(),
            Attached {
                window: window.to_owned(),
                panel,
                driver,
            },
        );
        if let Some(previous) = previous {
            previous.driver.stop();
        }
    }

    pub fn get(&self, id: &str) -> Option<Arc<NativePanel>> {
        self.panels()
            .get(id)
            .map(|attached| Arc::clone(&attached.panel))
    }

    /// Panel `id` shows another file, or keeps time another way. A panel that
    /// changes what kind of thing it shows is attached afresh by its page.
    pub fn set_source(&self, id: &str, source: PanelSource) {
        if let (Some(attached), PanelSource::Media { url, clock }) = (self.panels().get(id), source)
        {
            if let Driver::Media(media) = &attached.driver {
                media.set(url, clock);
            }
        }
    }

    /// The page is done with panel `id`: its picture goes.
    pub fn detach(&self, id: &str) {
        let removed = self.panels().remove(id);
        if let Some(removed) = removed {
            removed.driver.stop();
        }
    }

    /// Every panel of `window` goes: its page has loaded afresh, or it closed.
    pub fn forget_window(&self, window: &str) {
        let mut panels = self.panels();
        panels.retain(|_, attached| {
            if attached.window != window {
                return true;
            }
            attached.driver.stop();
            false
        });
    }

    #[cfg(test)]
    fn ids(&self) -> Vec<String> {
        let mut ids: Vec<String> = self.panels().keys().cloned().collect();
        ids.sort();
        ids
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_fresh_state_has_no_panels() {
        let state = NativePanelsState::new();
        assert!(state.ids().is_empty());
        assert!(state.get("center-pane").is_none());
    }
}
