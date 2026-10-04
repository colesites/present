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
use crate::services::sound::SoundEngine;
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
    broadcast_playback(app, Some(playback.clone()));
    Ok(playback)
}

/// Tell every window the transport moved. Also how the sound engine's own
/// reports reach them (`commands::sound`).
pub fn broadcast_playback(app: &AppHandle, changed: Option<MediaPlayback>) {
    let Some(playback) = changed else {
        return;
    };
    if let Err(error) = app.emit(PLAYBACK_CHANGED_EVENT, &playback) {
        tracing::error!(%error, "could not broadcast the playback change");
    }
}

/// An instruction from the operator: broadcast it, and move the sound to
/// match (`services::sound`). Reports are not passed on — the sound engine
/// makes them.
fn steer(
    app: &AppHandle,
    state: &PlaybackState,
    engine: &SoundEngine,
    changed: Option<MediaPlayback>,
    source: Option<(String, Option<std::path::PathBuf>)>,
) -> AppResult<MediaPlayback> {
    let playback = broadcast(app, state, changed)?;
    engine.follow(playback.clone(), source);
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
    engine: State<'_, SoundEngine>,
    media_id: Option<String>,
    media_url: Option<String>,
    auto_play: bool,
) -> AppResult<MediaPlayback> {
    // Which file the video is, so its sound can be played.
    let source = media_id
        .clone()
        .map(|id| (id, media_url.as_deref().and_then(super::sound::source_path)));
    let changed = state.update(|playback| playback.select_media(media_id.as_deref(), auto_play));
    steer(&app, &state, &engine, changed, source)
}

#[tauri::command]
pub async fn play_playback(
    app: AppHandle,
    state: State<'_, PlaybackState>,
    engine: State<'_, SoundEngine>,
) -> AppResult<MediaPlayback> {
    let changed = state.update(MediaPlayback::play);
    steer(&app, &state, &engine, changed, None)
}

#[tauri::command]
pub async fn pause_playback(
    app: AppHandle,
    state: State<'_, PlaybackState>,
    engine: State<'_, SoundEngine>,
) -> AppResult<MediaPlayback> {
    let changed = state.update(MediaPlayback::pause);
    steer(&app, &state, &engine, changed, None)
}

#[tauri::command]
pub async fn toggle_playback(
    app: AppHandle,
    state: State<'_, PlaybackState>,
    engine: State<'_, SoundEngine>,
) -> AppResult<MediaPlayback> {
    let changed = state.update(MediaPlayback::toggle);
    steer(&app, &state, &engine, changed, None)
}

#[tauri::command]
pub async fn stop_playback(
    app: AppHandle,
    state: State<'_, PlaybackState>,
    engine: State<'_, SoundEngine>,
) -> AppResult<MediaPlayback> {
    let changed = state.update(MediaPlayback::stop);
    steer(&app, &state, &engine, changed, None)
}

/// Play faster or slower. The sound and every picture follow.
#[tauri::command]
pub async fn set_playback_rate(
    app: AppHandle,
    state: State<'_, PlaybackState>,
    engine: State<'_, SoundEngine>,
    rate: f64,
) -> AppResult<MediaPlayback> {
    let changed = state.update(|playback| playback.set_rate(rate));
    steer(&app, &state, &engine, changed, None)
}

#[tauri::command]
pub async fn seek_playback(
    app: AppHandle,
    state: State<'_, PlaybackState>,
    engine: State<'_, SoundEngine>,
    position_seconds: f64,
    sampled_at_ms: Option<f64>,
) -> AppResult<MediaPlayback> {
    let changed = state.update(|playback| playback.seek(position_seconds, sampled_at_ms));
    steer(&app, &state, &engine, changed, None)
}

/// Something saying where the video actually is. High frequency, low
/// authority. The sound engine reports for itself (`commands::sound`); this
/// stays for a surface that plays a video the engine does not.
#[tauri::command]
pub async fn report_playback_position(
    app: AppHandle,
    state: State<'_, PlaybackState>,
    position_seconds: f64,
    sampled_at_ms: Option<f64>,
) -> AppResult<MediaPlayback> {
    let changed =
        state.update(|playback| playback.report_position(position_seconds, sampled_at_ms));
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
    engine: State<'_, SoundEngine>,
    looping: bool,
) -> AppResult<MediaPlayback> {
    let changed = state.update(|playback| playback.ended(looping));
    steer(&app, &state, &engine, changed, None)
}
