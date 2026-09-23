//! Mini lyrics editor commands.
//!
//! Replaces `mini-lyrics:ready`, `mini-lyrics:save`, `mini-lyrics:save-request`
//! and `mini-lyrics:save-response`. Four channels become two commands and one
//! event, and the handshake disappears: the editor asks what it is editing
//! rather than announcing itself and waiting to be told.

use tauri::{AppHandle, Emitter, Manager, State};

use crate::errors::{AppError, AppResult};
use crate::services::mini_lyrics::{
    MiniLyricsPayload, MiniLyricsSavePayload, MiniLyricsSaveRequest, MiniLyricsSaveResponse,
    MiniLyricsSaveResult, MiniLyricsState, SAVE_TIMEOUT,
};
use crate::services::window_spec::WindowRole;

/// Sent to the operator window, which owns the Convex write and the offline
/// queue. Matches the Electron channel name.
pub const SAVE_REQUEST_EVENT: &str = "mini-lyrics:save-request";

/// What this editor is editing.
#[tauri::command]
pub async fn get_mini_lyrics_payload(
    state: State<'_, MiniLyricsState>,
    library_id: String,
) -> AppResult<Option<MiniLyricsPayload>> {
    Ok(state.payload(&library_id))
}

/// Save lyrics, by asking the operator window to do it.
///
/// Waits for its answer, or gives up after ten seconds. An operator who has
/// typed a verse and hit save needs an answer either way — a promise that never
/// settles leaves the editor looking like it is still working.
#[tauri::command]
pub async fn save_mini_lyrics(
    app: AppHandle,
    state: State<'_, MiniLyricsState>,
    payload: MiniLyricsSavePayload,
) -> AppResult<MiniLyricsSaveResult> {
    let Some(operator) = app.get_webview_window(WindowRole::Main.label()) else {
        return Ok(MiniLyricsSaveResult::failed("Main window is unavailable."));
    };

    let (request_id, receiver) = state.begin_save();

    if let Err(error) = operator.emit(
        SAVE_REQUEST_EVENT,
        MiniLyricsSaveRequest {
            request_id: request_id.clone(),
            payload,
        },
    ) {
        state.abandon_save(&request_id);
        tracing::error!(%error, "could not ask the operator window to save lyrics");
        return Ok(MiniLyricsSaveResult::failed("Main window is unavailable."));
    }

    match tokio::time::timeout(SAVE_TIMEOUT, receiver).await {
        Ok(Ok(result)) => Ok(result),
        // The sender was dropped without answering — the operator window closed
        // mid-save.
        Ok(Err(_)) => {
            state.abandon_save(&request_id);
            Ok(MiniLyricsSaveResult::failed("Main window is unavailable."))
        }
        Err(_) => {
            state.abandon_save(&request_id);
            Ok(MiniLyricsSaveResult::failed("Save timed out."))
        }
    }
}

/// The operator window reporting what happened.
#[tauri::command]
pub async fn respond_mini_lyrics_save(
    state: State<'_, MiniLyricsState>,
    response: MiniLyricsSaveResponse,
) -> AppResult<()> {
    if !state.complete_save(response) {
        // Not an error: the editor timed out first and has already been told.
        tracing::debug!("a mini lyrics save response arrived with nothing waiting for it");
    }
    Ok(())
}

/// Remember what an editor is for. Called by `open_mini_lyrics_window`.
pub fn remember(state: &MiniLyricsState, payload: MiniLyricsPayload) -> AppResult<()> {
    if payload.library_id.trim().is_empty() {
        return Err(AppError::Invalid(
            "A mini lyrics window needs a library id.".to_owned(),
        ));
    }
    state.set_payload(payload);
    Ok(())
}
