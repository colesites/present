//! Turning the phone remote on, and showing the code to join it.

use tauri::{AppHandle, State};

use crate::errors::AppResult;
use crate::services::remote::{RemoteConfig, RemoteStatus};
use crate::state::RemoteState;

#[tauri::command]
pub async fn get_remote_status(state: State<'_, RemoteState>) -> AppResult<RemoteStatus> {
    Ok(state.status())
}

#[tauri::command]
pub async fn set_remote_settings(
    app: AppHandle,
    state: State<'_, RemoteState>,
    config: RemoteConfig,
) -> AppResult<RemoteStatus> {
    state.set(&app, config)?;
    Ok(state.status())
}
