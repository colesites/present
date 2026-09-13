//! NDI output. Replaces `ndi:start`, `ndi:stop` and `ndi:status`
//! (`ndi.ipc.ts`), with the same payloads, so Settings did not change.

use tauri::{AppHandle, Manager, State};

use crate::errors::AppResult;
use crate::services::ndi::output::NdiStatus;
use crate::state::ndi_state::{NdiState, StartResult};

fn resource_dir(app: &AppHandle) -> Option<std::path::PathBuf> {
    app.path().resource_dir().ok()
}

/// Start sending the audience frame as an NDI source.
///
/// `async` because it stops any running stream first, which waits for that
/// stream's thread to finish its frame.
#[tauri::command]
pub async fn start_ndi_output(
    app: AppHandle,
    state: State<'_, NdiState>,
    source_name: String,
    group_name: String,
) -> AppResult<StartResult> {
    let resources = resource_dir(&app);
    Ok(state.start_output(app, resources.as_deref(), &source_name, &group_name))
}

#[tauri::command]
pub async fn stop_ndi_output(state: State<'_, NdiState>) -> AppResult<()> {
    state.stop_output();
    Ok(())
}

#[tauri::command]
pub async fn get_ndi_status(app: AppHandle, state: State<'_, NdiState>) -> AppResult<NdiStatus> {
    Ok(state.status(resource_dir(&app).as_deref()))
}
