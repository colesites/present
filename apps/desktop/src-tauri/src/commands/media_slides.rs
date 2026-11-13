//! The Media panel's Slides: PowerPoints and PDFs kept in a media folder, and
//! the one converted copy of each that every service reads
//! (`services/media_slides.rs`).

use tauri::State;

use crate::errors::{AppError, AppResult};
use crate::services::dialog::{self, PickedPresentation};
use crate::services::media_slides::{self, MediaSlides};
use crate::state::FileState;

/// The id the slides of the document at `path` are kept under. The document
/// must be in a media folder.
#[tauri::command]
pub async fn media_slides_id(files: State<'_, FileState>, path: String) -> AppResult<String> {
    let path = files.resolve_existing(&path)?;
    tauri::async_runtime::spawn_blocking(move || media_slides::deck_id(&path))
        .await
        .map_err(|error| AppError::Invalid(error.to_string()))?
}

/// The converted deck kept for `id`, or `null` when there is none yet.
#[tauri::command]
pub async fn read_media_slides(
    store: State<'_, MediaSlides>,
    id: String,
) -> AppResult<Option<serde_json::Value>> {
    let directory = store.0.clone();
    tauri::async_runtime::spawn_blocking(move || media_slides::read(&directory, &id))
        .await
        .map_err(|error| AppError::Invalid(error.to_string()))?
}

/// Keep the converted deck for `id`.
#[tauri::command]
pub async fn write_media_slides(
    store: State<'_, MediaSlides>,
    id: String,
    deck: serde_json::Value,
) -> AppResult<()> {
    let directory = store.0.clone();
    tauri::async_runtime::spawn_blocking(move || media_slides::write(&directory, &id, &deck))
        .await
        .map_err(|error| AppError::Invalid(error.to_string()))?
}

/// A PowerPoint or PDF in a media folder, as the presentation picker returns
/// one, for the importer to convert.
#[tauri::command]
pub async fn read_media_presentation(
    files: State<'_, FileState>,
    path: String,
) -> AppResult<PickedPresentation> {
    dialog::read_presentation_file(&files, &path)
}
