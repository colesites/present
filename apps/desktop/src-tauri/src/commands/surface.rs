//! The opt-in natively drawn audience screen. No Electron equivalent: the
//! Electron build only ever had the webview.

use std::sync::Arc;

use tauri::{AppHandle, Manager, State};

use crate::errors::AppResult;
use crate::services::surface::SurfaceStatus;
use crate::services::window_spec::WindowRole;
use crate::state::OutputSurfaceState;

#[tauri::command]
pub async fn get_output_surface(
    state: State<'_, Arc<OutputSurfaceState>>,
) -> AppResult<SurfaceStatus> {
    Ok(state.status())
}

/// Turn it on or off, and apply that to an Output window that is already open.
#[tauri::command]
pub async fn set_output_surface_native(
    app: AppHandle,
    state: State<'_, Arc<OutputSurfaceState>>,
    enabled: bool,
) -> AppResult<SurfaceStatus> {
    let output_open = app.get_webview_window(WindowRole::Output.label()).is_some();
    state.set_native(&app, enabled, output_open)
}
