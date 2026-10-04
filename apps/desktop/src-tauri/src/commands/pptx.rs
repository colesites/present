//! PowerPoint import. Replaces `open-pptx` and `parse-pptx`, on
//! `window.pptxAPI` as before — without the Python the Electron build needed.

use base64::Engine;
use tauri::{AppHandle, Manager, State, WebviewWindow};

use crate::errors::{AppError, AppResult};
use crate::services::pptx::media::{self, FileSink, ImportedMedia};
use crate::services::{dialog, pptx};
use crate::state::FileState;

#[tauri::command]
pub async fn open_pptx(
    app: AppHandle,
    window: WebviewWindow,
    state: State<'_, FileState>,
) -> AppResult<Option<String>> {
    dialog::select_pptx_file(&app, &state, Some(&window))
}

/// The deck at `file_path` as `ParsedPptxPresentation`, its pictures saved
/// in the app's imported-media folder. Only a file the operator picked — here
/// or through the presentation picker — can be read.
///
/// The fonts it embeds are installed among the app's own fonts, loaded for
/// the screens, and its text pointed at them.
#[tauri::command]
pub async fn parse_pptx(
    app: AppHandle,
    state: State<'_, FileState>,
    imported: State<'_, ImportedMedia>,
    file_path: String,
) -> AppResult<serde_json::Value> {
    let path = state.resolve_existing(&file_path)?;
    let directory = imported.0.clone();
    let font_directory = app
        .path()
        .app_data_dir()
        .map(|data| data.join(crate::services::fonts::CUSTOM_FONT_DIRECTORY))
        .ok();
    tauri::async_runtime::spawn_blocking(move || {
        let mut sink = FileSink::new(&directory);
        let (mut presentation, package, embedded) =
            pptx::import_with(&path, &mut sink).map_err(|error| {
                AppError::Invalid(format!(
                    "[pptx] Could not import this PowerPoint file. {error}"
                ))
            })?;
        if let Some(font_directory) = font_directory.filter(|_| !embedded.is_empty()) {
            let installed = pptx::fonts::install(&package, &embedded, &font_directory);
            pptx::fonts::rename(&mut presentation, &installed);
            let paths: Vec<std::path::PathBuf> =
                installed.into_iter().map(|font| font.path).collect();
            crate::services::compositor::text::load_font_files(&paths);
        }
        Ok(presentation)
    })
    .await
    .map_err(|error| AppError::Invalid(error.to_string()))?
}

/// A picture an import made — a PDF's page — saved beside a deck's, and the
/// URL to draw it from.
#[tauri::command]
pub async fn save_imported_media(
    imported: State<'_, ImportedMedia>,
    data: String,
    extension: String,
) -> AppResult<String> {
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(data.trim())
        .map_err(|error| AppError::Invalid(format!("The picture is not base64: {error}")))?;
    let directory = imported.0.clone();
    tauri::async_runtime::spawn_blocking(move || media::save(&directory, &bytes, &extension))
        .await
        .map_err(|error| AppError::Invalid(error.to_string()))?
        .map_err(AppError::from)
}
