//! The bundled Bibles and the hosted catalog. Replaces `list-bundled-bibles`,
//! `read-bundled-bible` and `fetch-hosted-bible-catalog` with the same
//! payloads, so the scripture panel did not change.

use std::path::PathBuf;

use tauri::{AppHandle, Manager};

use crate::errors::{AppError, AppResult};
use crate::services::bible::{self, BundledBible};

/// Where the Bibles are: `bible/` in the app's resources, which
/// `bundle.resources` fills from `apps/desktop/bible`.
///
/// One directory rather than Electron's four candidates, three of which exist
/// only to find the folder from a development checkout. A debug build without
/// the resources copied falls back to the checkout's folder directly.
fn directories(app: &AppHandle) -> Vec<PathBuf> {
    let bundled = app
        .path()
        .resource_dir()
        .ok()
        .map(|resources| resources.join("bible"))
        .filter(|directory| directory.is_dir());
    #[cfg(debug_assertions)]
    let bundled = bundled.or_else(|| {
        Some(PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../bible"))
            .filter(|directory| directory.is_dir())
    });
    bundled.into_iter().collect()
}

/// Every Bible shipped with the app. Empty, never an error, as in Electron.
#[tauri::command]
pub async fn list_bundled_bibles(app: AppHandle) -> AppResult<Vec<BundledBible>> {
    let directories = directories(&app);
    tauri::async_runtime::spawn_blocking(move || bible::discover(&directories))
        .await
        .map_err(|error| AppError::Invalid(error.to_string()))
}

/// The raw bytes of one shipped Bible — several megabytes, so sent as binary
/// rather than as a JSON array of numbers.
#[tauri::command]
pub async fn read_bundled_bible(
    app: AppHandle,
    file_path: String,
) -> AppResult<tauri::ipc::Response> {
    let directories = directories(&app);
    let bytes = tauri::async_runtime::spawn_blocking(move || bible::read(&directories, &file_path))
        .await
        .map_err(|error| AppError::Invalid(error.to_string()))?
        .inspect_err(|error| tracing::warn!(%error, "could not read a bundled bible"))?;
    Ok(tauri::ipc::Response::new(bytes))
}

/// The hosted catalog, or `null` when it cannot be had — the panel falls back
/// to the bundled list, as it does under Electron.
#[tauri::command]
pub async fn fetch_hosted_bible_catalog(
    catalog_url: String,
) -> AppResult<Option<serde_json::Value>> {
    match bible::fetch_catalog(&catalog_url).await {
        Ok(catalog) => Ok(Some(catalog)),
        Err(error) => {
            tracing::warn!(%error, "could not fetch the hosted bible catalog");
            Ok(None)
        }
    }
}
