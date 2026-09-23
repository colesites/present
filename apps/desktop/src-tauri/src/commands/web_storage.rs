//! The durable copy of the app's browser storage (known-issues §2). The window
//! side is `src/renderer/tauri/web-storage.ts`.

use std::collections::BTreeMap;

use tauri::{AppHandle, Manager, State};

use crate::errors::{AppError, AppResult};
use crate::services::web_storage;
use crate::state::web_storage_state::{StorageChange, StorageStart, WebStorageState};

#[tauri::command]
pub async fn get_web_storage(state: State<'_, WebStorageState>) -> AppResult<StorageStart> {
    Ok(state.start())
}

/// Create the store: from `items`, this build's own localStorage, when it has
/// any; otherwise, once, from the packaged Electron build's.
#[tauri::command]
pub async fn initialize_web_storage(
    app: AppHandle,
    state: State<'_, WebStorageState>,
    items: Option<BTreeMap<String, String>>,
) -> AppResult<BTreeMap<String, String>> {
    if let Some(items) = items {
        return state.initialize(items, "this build's localStorage");
    }

    let leveldb = app
        .path()
        .config_dir()
        .map(|app_data| {
            web_storage::chromium_local_storage(&app_data.join(web_storage::ELECTRON_APP_FOLDER))
        })
        .map_err(|error| AppError::Invalid(format!("No application data folder: {error}")))?;
    let found = tauri::async_runtime::spawn_blocking(move || {
        web_storage::read_chromium_local_storage(&leveldb, web_storage::ELECTRON_ORIGIN)
    })
    .await
    .map_err(|error| AppError::Invalid(error.to_string()))?
    .unwrap_or_else(|error| {
        // Unreadable is not fatal: the operator starts from defaults, as they
        // would have without Electron.
        tracing::warn!(%error, "could not read the Electron build's settings");
        BTreeMap::new()
    });
    tracing::info!(
        keys = found.len(),
        "web storage created from the Electron build"
    );
    state.initialize(found, "the Electron build's localStorage")
}

#[tauri::command]
pub async fn set_web_storage_items(
    state: State<'_, WebStorageState>,
    changes: Vec<StorageChange>,
) -> AppResult<()> {
    state.apply(changes)
}
