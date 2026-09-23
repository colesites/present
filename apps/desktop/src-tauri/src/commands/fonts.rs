//! The font catalog. Replaces the five `font.ipc.ts` channels with the same
//! payloads, on `window.fontAPI` as before.

use std::path::PathBuf;

use tauri::{AppHandle, Manager, State, WebviewWindow};

use crate::errors::{AppError, AppResult};
use crate::services::fonts::{self, FamilyEntry, FontFace};
use crate::services::{dialog, system_fonts};
use crate::state::FileState;

fn custom_font_directory(app: &AppHandle) -> AppResult<PathBuf> {
    let data = app
        .path()
        .app_data_dir()
        .map_err(|error| AppError::Invalid(format!("No app data folder: {error}")))?;
    Ok(data.join(fonts::CUSTOM_FONT_DIRECTORY))
}

/// The platform's families, read where the platform allows it.
async fn families(app: &AppHandle) -> AppResult<Vec<FamilyEntry>> {
    #[cfg(target_os = "macos")]
    {
        let (sender, receiver) = tokio::sync::oneshot::channel();
        app.run_on_main_thread(move || {
            let listed = objc2::MainThreadMarker::new().map(system_fonts::list_families);
            let _ = sender.send(listed);
        })?;
        receiver
            .await
            .map_err(|_| AppError::Invalid("The main thread did not answer".to_owned()))?
            .ok_or_else(|| AppError::Invalid("Fonts were not listed on the main thread".to_owned()))
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = app;
        tauri::async_runtime::spawn_blocking(system_fonts::list_families)
            .await
            .map_err(|error| AppError::Invalid(error.to_string()))
    }
}

#[tauri::command]
pub async fn get_system_fonts(app: AppHandle) -> AppResult<Vec<String>> {
    let names: Vec<String> = families(&app)
        .await?
        .into_iter()
        .map(|entry| entry.family_name)
        .collect();
    Ok(fonts::system_families(&names))
}

#[tauri::command]
pub async fn get_system_font_faces(app: AppHandle) -> AppResult<Vec<FontFace>> {
    Ok(fonts::system_faces(&families(&app).await?))
}

/// Font files to install, or `null` when the operator cancels. Each pick is
/// granted to the file scope, which is what lets `install_custom_fonts` read it.
#[tauri::command]
pub async fn pick_font_file(
    app: AppHandle,
    window: WebviewWindow,
    state: State<'_, FileState>,
) -> AppResult<Option<Vec<String>>> {
    dialog::select_font_files(&app, &state, Some(&window))
}

/// Copy picked fonts into the app's own folder. Only paths the operator picked
/// are read: Electron would copy any path it was handed.
#[tauri::command]
pub async fn install_custom_fonts(
    app: AppHandle,
    state: State<'_, FileState>,
    file_paths: Vec<String>,
) -> AppResult<Vec<FontFace>> {
    let sources = file_paths
        .iter()
        .map(|path| state.resolve_existing(path))
        .collect::<AppResult<Vec<PathBuf>>>()?;
    let directory = custom_font_directory(&app)?;
    tauri::async_runtime::spawn_blocking(move || fonts::install_custom(&directory, &sources))
        .await
        .map_err(|error| AppError::Invalid(error.to_string()))?
}

#[tauri::command]
pub async fn get_custom_fonts(app: AppHandle) -> AppResult<Vec<FontFace>> {
    let directory = custom_font_directory(&app)?;
    tauri::async_runtime::spawn_blocking(move || fonts::list_custom(&directory))
        .await
        .map_err(|error| AppError::Invalid(error.to_string()))?
}
