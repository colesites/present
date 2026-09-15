//! PowerPoint import. Replaces `open-pptx` and `parse-pptx`, on
//! `window.pptxAPI` as before — without the Python the Electron build needed.

use tauri::{AppHandle, State, WebviewWindow};

use crate::errors::{AppError, AppResult};
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

/// The deck at `file_path` as `ParsedPptxPresentation`. Only a file the
/// operator picked — here or through the presentation picker — can be read.
#[tauri::command]
pub async fn parse_pptx(
    state: State<'_, FileState>,
    file_path: String,
) -> AppResult<serde_json::Value> {
    let path = state.resolve_existing(&file_path)?;
    tauri::async_runtime::spawn_blocking(move || pptx::import_for_renderer(&path))
        .await
        .map_err(|error| AppError::Invalid(error.to_string()))?
}
