//! The natively drawn audience screen. No Electron equivalent: the Electron
//! build only ever had the webview.
//!
//! One command, and it only reports. There is nothing to turn on — the
//! compositor draws the audience output wherever it can, and the window asks
//! this only so it knows whether to stop drawing the output itself.

use std::sync::Arc;

use tauri::State;

use crate::errors::AppResult;
use crate::services::surface::SurfaceStatus;
use crate::state::OutputSurfaceState;

#[tauri::command]
pub async fn get_output_surface(
    state: State<'_, Arc<OutputSurfaceState>>,
) -> AppResult<SurfaceStatus> {
    Ok(state.status())
}
