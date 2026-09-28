//! The natively drawn audience screen. No Electron equivalent: the Electron
//! build only ever had the webview.
//!
//! One command, and it only reports. There is nothing to turn on — the
//! compositor draws the audience output wherever it can, and the window asks
//! this only so it knows whether to stop drawing the output itself.

use std::sync::Arc;

use tauri::{State, WebviewWindow};

use crate::errors::AppResult;
use crate::services::surface::SurfaceStatus;
use crate::state::OutputSurfaceState;

#[tauri::command]
pub async fn get_output_surface(
    window: WebviewWindow,
    state: State<'_, Arc<OutputSurfaceState>>,
) -> AppResult<SurfaceStatus> {
    // The asking window's own view: each audience screen has one.
    Ok(state.status(window.label()))
}
