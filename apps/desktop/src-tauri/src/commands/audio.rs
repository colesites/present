//! The audio graph's command surface.
//!
//! Thin, like every command module: deserialise, delegate to
//! `services::audio`, broadcast. The interesting decision here is what the
//! renderer is *told* rather than what it is asked.
//!
//! Under Electron each surface decides its own audio: fourteen `<video>` tags
//! carry a hard-coded `muted`, one does not, and one `new Audio()` carries
//! nothing at all. Here a surface calls [`get_source_routing`] and applies the
//! answer. That inverts who is responsible — the renderer stops holding the
//! invariant and starts obeying it — which is what makes forgetting a `muted`
//! attribute stop being a way to put audio on the congregation's speakers.

use tauri::{AppHandle, Emitter, Manager, State};

use crate::errors::AppResult;
use crate::services::audio::{AudioGraph, AudioSource, AudioSurface, SourceRouting};
use crate::services::sound::SoundEngine;
use crate::state::AudioState;

/// Emitted to every window when the graph changes.
///
/// Broadcast rather than targeted, for the same reason `looks:changed` is:
/// every surface renders from this, and one that misses the event keeps
/// applying a level or a device the operator has already changed.
pub const AUDIO_CHANGED_EVENT: &str = "audio:changed";

fn broadcast(
    app: &AppHandle,
    state: &AudioState,
    changed: Option<AudioGraph>,
) -> AppResult<AudioGraph> {
    let Some(graph) = changed else {
        return Ok(state.snapshot());
    };

    // The sound the app plays itself follows the graph directly.
    if let Some(engine) = app.try_state::<SoundEngine>() {
        engine.set_routing(super::sound::routing(&graph));
    }
    if let Err(error) = app.emit(AUDIO_CHANGED_EVENT, &graph) {
        // The change is already saved; a failed broadcast leaves a window
        // stale, it does not lose the setting.
        tracing::error!(%error, "could not broadcast the audio change");
    }
    Ok(graph)
}

#[tauri::command]
pub async fn get_audio_graph(state: State<'_, AudioState>) -> AppResult<AudioGraph> {
    Ok(state.snapshot())
}

/// What one surface should apply to one source.
///
/// The call every `<video>` and the backing-track player makes instead of
/// deciding for itself.
#[tauri::command]
pub async fn get_source_routing(
    state: State<'_, AudioState>,
    source: AudioSource,
    surface: AudioSurface,
) -> AppResult<SourceRouting> {
    Ok(state.snapshot().routing(source, surface))
}

/// Point the single sink at an output device.
///
/// One call, and both the presentation video and the backing track follow it.
/// That is the fix for known-issues §1: the device stops being a property of
/// whichever elements someone remembered to call `setSinkId` on.
#[tauri::command]
pub async fn set_audio_device(
    app: AppHandle,
    state: State<'_, AudioState>,
    device_id: Option<String>,
    device_label: Option<String>,
) -> AppResult<AudioGraph> {
    let changed =
        state.update(|graph| graph.set_device(device_id.as_deref(), device_label.as_deref()))?;
    broadcast(&app, &state, changed)
}

#[tauri::command]
pub async fn set_audio_source_gain(
    app: AppHandle,
    state: State<'_, AudioState>,
    source: AudioSource,
    gain: f64,
) -> AppResult<AudioGraph> {
    let changed = state.update(|graph| graph.set_source_gain(source, gain))?;
    broadcast(&app, &state, changed)
}

#[tauri::command]
pub async fn set_audio_source_muted(
    app: AppHandle,
    state: State<'_, AudioState>,
    source: AudioSource,
    muted: bool,
) -> AppResult<AudioGraph> {
    let changed = state.update(|graph| graph.set_source_muted(source, muted))?;
    broadcast(&app, &state, changed)
}

#[tauri::command]
pub async fn set_audio_master_gain(
    app: AppHandle,
    state: State<'_, AudioState>,
    gain: f64,
) -> AppResult<AudioGraph> {
    let changed = state.update(|graph| graph.set_master_gain(gain))?;
    broadcast(&app, &state, changed)
}

#[tauri::command]
pub async fn set_audio_master_muted(
    app: AppHandle,
    state: State<'_, AudioState>,
    muted: bool,
) -> AppResult<AudioGraph> {
    let changed = state.update(|graph| graph.set_master_muted(muted))?;
    broadcast(&app, &state, changed)
}
