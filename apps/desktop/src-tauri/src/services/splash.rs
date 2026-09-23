//! The splash window: the app's icon, name, version and what it is doing,
//! while the operator window starts behind it.
//!
//! The operator window stays hidden until React has drawn it, which on a cold
//! start is seconds. Before, that time was a white window; now it is this, the
//! way GarageBand and ProPresenter open. It closes when the operator window is
//! shown (`services::window::reveal`).

use std::sync::Mutex;

use tauri::{AppHandle, Emitter, Manager, WebviewUrl, WebviewWindowBuilder};

use crate::services::window_spec::Rgb;

pub const LABEL: &str = "splash";
pub const STATUS_EVENT: &str = "splash:status";
const FIRST_STATUS: &str = "Starting";

/// What the splash says, for a splash page that loads after it was set.
pub struct SplashState(Mutex<String>);

impl Default for SplashState {
    fn default() -> Self {
        Self(Mutex::new(FIRST_STATUS.to_owned()))
    }
}

impl SplashState {
    pub fn get(&self) -> String {
        self.0
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .clone()
    }
}

/// Open the splash. A failure is logged and the app starts without one.
pub fn open(app: &AppHandle) {
    if app.get_webview_window(LABEL).is_some() {
        return;
    }
    let Rgb(red, green, blue) = Rgb::APP_CHROME;
    let result = WebviewWindowBuilder::new(app, LABEL, WebviewUrl::App("splash.html".into()))
        .title("Present")
        .inner_size(560.0, 300.0)
        .resizable(false)
        .maximizable(false)
        .minimizable(false)
        .decorations(false)
        .shadow(true)
        .skip_taskbar(true)
        .center()
        .background_color(tauri::utils::config::Color(red, green, blue, 255))
        // Hidden until its page has loaded. The page is static HTML with its
        // styles inline, so loaded is drawn.
        .visible(false)
        .on_page_load(|window, payload| {
            if payload.event() == tauri::webview::PageLoadEvent::Finished {
                if let Err(error) = window.show() {
                    tracing::warn!(%error, "could not show the splash window");
                }
            }
        })
        .build();
    if let Err(error) = result {
        tracing::warn!(%error, "could not open the splash window");
    }
}

/// Tell the splash what is happening.
pub fn set_status(app: &AppHandle, status: &str) {
    if let Some(state) = app.try_state::<SplashState>() {
        *state
            .0
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner()) = status.to_owned();
    }
    if let Err(error) = app.emit_to(LABEL, STATUS_EVENT, status) {
        tracing::debug!(%error, "could not update the splash");
    }
}

pub fn close(app: &AppHandle) {
    if let Some(splash) = app.get_webview_window(LABEL) {
        if let Err(error) = splash.close() {
            tracing::warn!(%error, "could not close the splash window");
        }
    }
}
