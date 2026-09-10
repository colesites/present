//! Filesystem and dialog commands.
//!
//! Replaces the fourteen `file.ipc.ts` channels. Each one is the same call the
//! React side already makes, with the same arguments and the same return shape,
//! and each one is scope-checked on the way through.
//!
//! Every command here is `async`. Dialogs block until the operator answers, and
//! a synchronous command blocks the webview's message loop — on Windows that
//! deadlocks outright.

use tauri::{AppHandle, State, WebviewWindow};

use crate::errors::AppResult;
use crate::services::dialog::{self, PickedFile, PickedImage, PickedPresentation, PickedPropMedia};
use crate::services::filesystem::{
    self, ExportedBundle, FolderEntry, ImportedBundle, LibraryItem, RenamedFile,
};
use crate::state::file_state::MediaFolder;
use crate::state::FileState;

// --- dialogs -------------------------------------------------------------

#[tauri::command]
pub async fn select_folder(
    app: AppHandle,
    window: WebviewWindow,
    state: State<'_, FileState>,
) -> AppResult<Option<MediaFolder>> {
    dialog::select_folder(&app, &state, Some(&window))
}

#[tauri::command]
pub async fn select_library_export_destination(
    app: AppHandle,
    window: WebviewWindow,
    state: State<'_, FileState>,
    suggested_name: Option<String>,
) -> AppResult<Option<String>> {
    dialog::select_library_export_destination(
        &app,
        &state,
        Some(&window),
        suggested_name.as_deref(),
    )
}

/// Choose the folder to import a library bundle from.
///
/// Electron has no such channel — `LibrariesPanel` reuses `selectFolder`, which
/// under the new model would add the bundle to the Media panel as though it were
/// a folder of videos. A separate command keeps the import a one-off grant.
#[tauri::command]
pub async fn select_library_import_source(
    app: AppHandle,
    window: WebviewWindow,
    state: State<'_, FileState>,
) -> AppResult<Option<String>> {
    dialog::select_library_import_source(&app, &state, Some(&window))
}

#[tauri::command]
pub async fn select_media_file(
    app: AppHandle,
    window: WebviewWindow,
    state: State<'_, FileState>,
) -> AppResult<Option<PickedFile>> {
    dialog::select_media_file(&app, &state, Some(&window))
}

#[tauri::command]
pub async fn select_audio_files(
    app: AppHandle,
    window: WebviewWindow,
    state: State<'_, FileState>,
) -> AppResult<Vec<PickedFile>> {
    dialog::select_audio_files(&app, &state, Some(&window))
}

#[tauri::command]
pub async fn select_prop_image(
    app: AppHandle,
    window: WebviewWindow,
    state: State<'_, FileState>,
) -> AppResult<Option<PickedImage>> {
    dialog::select_prop_image(&app, &state, Some(&window))
}

#[tauri::command]
pub async fn select_prop_media(
    app: AppHandle,
    window: WebviewWindow,
    state: State<'_, FileState>,
) -> AppResult<Option<PickedPropMedia>> {
    dialog::select_prop_media(&app, &state, Some(&window))
}

#[tauri::command]
pub async fn select_presentation_files(
    app: AppHandle,
    window: WebviewWindow,
    state: State<'_, FileState>,
) -> AppResult<Option<Vec<PickedPresentation>>> {
    dialog::select_presentation_files(&app, &state, Some(&window))
}

// --- media folders -------------------------------------------------------

/// The folders the operator has added, as the Rust core knows them.
///
/// Under Electron this list lives only in the renderer's IndexedDB, so it is
/// per-origin and starts empty in every new build (known-issues §2). Owning it
/// here is what lets the scope survive a restart at all.
#[tauri::command]
pub async fn list_media_folders(state: State<'_, FileState>) -> AppResult<Vec<MediaFolder>> {
    Ok(state.folders())
}

/// Forget a media folder, closing the access it granted.
#[tauri::command]
pub async fn remove_media_folder(state: State<'_, FileState>, id: String) -> AppResult<bool> {
    state.remove_folder(&id)
}

// --- file operations -----------------------------------------------------

#[tauri::command]
pub async fn read_folder(
    state: State<'_, FileState>,
    folder_path: String,
) -> AppResult<Vec<FolderEntry>> {
    filesystem::read_folder(&state, &folder_path)
}

#[tauri::command]
pub async fn copy_media_file(
    state: State<'_, FileState>,
    source: String,
    target: String,
) -> AppResult<bool> {
    filesystem::copy_media_file(&state, &source, &target)
}

#[tauri::command]
pub async fn rename_media_file(
    state: State<'_, FileState>,
    old_path: String,
    new_name: String,
) -> AppResult<RenamedFile> {
    filesystem::rename_media_file(&state, &old_path, &new_name)
}

#[tauri::command]
pub async fn delete_media_file(state: State<'_, FileState>, file_path: String) -> AppResult<bool> {
    filesystem::delete_media_file(&state, &file_path)
}

#[tauri::command]
pub async fn create_directory(
    state: State<'_, FileState>,
    parent: String,
    name: String,
) -> AppResult<String> {
    filesystem::create_directory(&state, &parent, &name)
}

#[tauri::command]
pub async fn rename_directory(
    state: State<'_, FileState>,
    old_path: String,
    new_path: String,
) -> AppResult<bool> {
    filesystem::rename_directory(&state, &old_path, &new_path)
}

#[tauri::command]
pub async fn export_library_bundle(
    state: State<'_, FileState>,
    destination_path: String,
    items: Vec<LibraryItem>,
) -> AppResult<ExportedBundle> {
    filesystem::export_library_bundle(&state, &destination_path, &items)
}

#[tauri::command]
pub async fn import_library_bundle(
    state: State<'_, FileState>,
    folder_path: String,
) -> AppResult<ImportedBundle> {
    filesystem::import_library_bundle(&state, &folder_path)
}
