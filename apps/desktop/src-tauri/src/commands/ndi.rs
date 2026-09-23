//! NDI. Replaces the six `ndi:*` channels (`ndi.ipc.ts`) with the same
//! payloads, so Settings, the Layers panel and the prop layers did not change.

use std::sync::Arc;

use tauri::{AppHandle, Manager, State};

use crate::errors::{AppError, AppResult};
use crate::services::ndi::output::NdiStatus;
use crate::state::ndi_input_state::{self, InputStartResult, NdiInputState, SourceList};
use crate::state::ndi_state::{NdiState, StartResult};

fn resource_dir(app: &AppHandle) -> Option<std::path::PathBuf> {
    app.path().resource_dir().ok()
}

/// Start sending the audience frame as an NDI source.
///
/// `frame_rate` is 24, 25, 30, 50 or 60; anything else means 30.
///
/// `async` because it stops any running stream first, which waits for that
/// stream's thread to finish its frame.
#[tauri::command]
pub async fn start_ndi_output(
    app: AppHandle,
    state: State<'_, NdiState>,
    source_name: String,
    group_name: String,
    frame_rate: Option<u32>,
) -> AppResult<StartResult> {
    let resources = resource_dir(&app);
    Ok(state.start_output(
        app,
        resources.as_deref(),
        &source_name,
        &group_name,
        frame_rate,
    ))
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

/// Which NDI sources are on the network. Waits up to 1.2 s for them.
#[tauri::command]
pub async fn list_ndi_sources(app: AppHandle, group_name: Option<String>) -> AppResult<SourceList> {
    let resources = resource_dir(&app);
    tauri::async_runtime::spawn_blocking(move || {
        let Some(ndi) = app.try_state::<NdiState>() else {
            return SourceList {
                ok: false,
                sources: Vec::new(),
                error: Some("NDI is not ready yet.".to_owned()),
            };
        };
        match ndi.runtime(resources.as_deref()) {
            Ok(lib) => ndi_input_state::list_sources(lib, group_name.as_deref()),
            Err(error) => SourceList {
                ok: false,
                sources: Vec::new(),
                error: Some(error),
            },
        }
    })
    .await
    .map_err(|error| AppError::Invalid(error.to_string()))
}

/// Receive a source for a prop, or join the receiver already on it.
#[tauri::command]
pub async fn start_ndi_input(
    app: AppHandle,
    source_name: String,
    group_name: Option<String>,
    client_id: Option<String>,
) -> AppResult<InputStartResult> {
    let resources = resource_dir(&app);
    tauri::async_runtime::spawn_blocking(move || {
        let (Some(input), Some(ndi)) = (
            app.try_state::<Arc<NdiInputState>>(),
            app.try_state::<NdiState>(),
        ) else {
            return InputStartResult {
                ok: false,
                error: Some("NDI is not ready yet.".to_owned()),
                source_name: None,
            };
        };
        input.start(
            || ndi.runtime(resources.as_deref()),
            &source_name,
            group_name.as_deref(),
            client_id.as_deref(),
        )
    })
    .await
    .map_err(|error| AppError::Invalid(error.to_string()))
}

/// Release a prop's hold on the receiver, or everybody's.
#[tauri::command]
pub async fn stop_ndi_input(
    input: State<'_, Arc<NdiInputState>>,
    client_id: Option<String>,
) -> AppResult<()> {
    input.stop(client_id.as_deref());
    Ok(())
}
