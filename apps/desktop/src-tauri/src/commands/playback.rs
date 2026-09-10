//! The media transport's command surface.
//!
//! Thin, like every command module. The one thing worth reading carefully is
//! why `report_playback_position` exists next to `seek_playback` rather than
//! being folded into it: a report is the element saying where it *is*, a seek
//! is the operator saying where it *should be*. They arrive at very different
//! rates and only one of them is authoritative, and collapsing them is how a
//! stale sample drags the playhead backwards mid-service.

use tauri::{AppHandle, Emitter, State};

use crate::errors::AppResult;
use crate::services::playback::MediaPlayback;
use crate::state::PlaybackState;

/// Emitted when the transport moves.
///
/// Not emitted for a position report that changed nothing, which is most of
/// them: the element reports about ten times a second.
pub const PLAYBACK_CHANGED_EVENT: &str = "playback:changed";

fn broadcast(
    app: &AppHandle,
    state: &PlaybackState,
    changed: Option<MediaPlayback>,
) -> AppResult<MediaPlayback> {
    let Some(playback) = changed else {
        return Ok(state.snapshot());
    };

    if let Err(error) = app.emit(PLAYBACK_CHANGED_EVENT, &playback) {
        tracing::error!(%error, "could not broadcast the playback change");
    }
    Ok(playback)
}

#[tauri::command]
pub async fn get_playback(state: State<'_, PlaybackState>) -> AppResult<MediaPlayback> {
    Ok(state.snapshot())
}

#[tauri::command]
pub async fn select_playback_media(
    app: AppHandle,
    state: State<'_, PlaybackState>,
    media_id: Option<String>,
    auto_play: bool,
) -> AppResult<MediaPlayback> {
    let changed = state.update(|playback| playback.select_media(media_id.as_deref(), auto_play));
    broadcast(&app, &state, changed)
}

#[tauri::command]
pub async fn play_playback(
    app: AppHandle,
    state: State<'_, PlaybackState>,
) -> AppResult<MediaPlayback> {
    let changed = state.update(MediaPlayback::play);
    broadcast(&app, &state, changed)
}

#[tauri::command]
pub async fn pause_playback(
    app: AppHandle,
    state: State<'_, PlaybackState>,
) -> AppResult<MediaPlayback> {
    let changed = state.update(MediaPlayback::pause);
    broadcast(&app, &state, changed)
}

#[tauri::command]
pub async fn toggle_playback(
    app: AppHandle,
    state: State<'_, PlaybackState>,
) -> AppResult<MediaPlayback> {
    let changed = state.update(MediaPlayback::toggle);
    broadcast(&app, &state, changed)
}

#[tauri::command]
pub async fn stop_playback(
    app: AppHandle,
    state: State<'_, PlaybackState>,
) -> AppResult<MediaPlayback> {
    let changed = state.update(MediaPlayback::stop);
    broadcast(&app, &state, changed)
}

#[tauri::command]
pub async fn seek_playback(
    app: AppHandle,
    state: State<'_, PlaybackState>,
    position_seconds: f64,
) -> AppResult<MediaPlayback> {
    let changed = state.update(|playback| playback.seek(position_seconds));
    broadcast(&app, &state, changed)
}

/// The element saying where it actually is. High frequency, low authority.
#[tauri::command]
pub async fn report_playback_position(
    app: AppHandle,
    state: State<'_, PlaybackState>,
    position_seconds: f64,
) -> AppResult<MediaPlayback> {
    let changed = state.update(|playback| playback.report_position(position_seconds));
    broadcast(&app, &state, changed)
}

#[tauri::command]
pub async fn set_playback_duration(
    app: AppHandle,
    state: State<'_, PlaybackState>,
    duration_seconds: Option<f64>,
) -> AppResult<MediaPlayback> {
    let changed = state.update(|playback| playback.set_duration(duration_seconds));
    broadcast(&app, &state, changed)
}

#[tauri::command]
pub async fn playback_ended(
    app: AppHandle,
    state: State<'_, PlaybackState>,
    looping: bool,
) -> AppResult<MediaPlayback> {
    let changed = state.update(|playback| playback.ended(looping));
    broadcast(&app, &state, changed)
}
