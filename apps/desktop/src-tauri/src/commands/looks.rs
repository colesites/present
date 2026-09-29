//! Output layer flag commands.
//!
//! The first slice of the presentation core to be Rust-owned. Under Electron
//! this state lives in React and reaches the other windows through
//! `localStorage` and a 400 ms poll; here there is one owner and one event.
//!
//! Every mutation returns the whole config. The payload is small — a column
//! of eight booleans and a text box for each audience screen, the NDI output
//! and the unused stage — and returning it means a caller never has to guess
//! what the state became.

use tauri::{AppHandle, Emitter, State};

use crate::errors::AppResult;
use crate::services::looks::{self, LookLayer, LookTarget, LookTextPositionPatch, LooksConfig};
use crate::state::looks_state::{generate_look_id, now_ms};
use crate::state::LooksState;

/// Emitted to every window when the layer flags change.
///
/// Broadcast rather than targeted: the audience output, both stage displays,
/// the Looks window and the operator window all render from this, and a
/// window that misses the event shows the wrong thing until the next one.
pub const LOOKS_CHANGED_EVENT: &str = "looks:changed";

/// Announce a change, or report the unchanged state when there was none.
fn broadcast(
    app: &AppHandle,
    state: &LooksState,
    changed: Option<LooksConfig>,
) -> AppResult<LooksConfig> {
    let Some(config) = changed else {
        return Ok(state.snapshot());
    };

    if let Err(error) = app.emit(LOOKS_CHANGED_EVENT, &config) {
        // The state is already saved; a failed broadcast leaves windows stale,
        // it does not lose the change.
        tracing::error!(%error, "could not broadcast the looks change");
    }
    Ok(config)
}

#[tauri::command]
pub async fn get_looks_config(state: State<'_, LooksState>) -> AppResult<LooksConfig> {
    Ok(state.snapshot())
}

#[tauri::command]
pub async fn set_looks_target(
    app: AppHandle,
    state: State<'_, LooksState>,
    target: LookTarget,
) -> AppResult<LooksConfig> {
    let changed = state.update(|config| {
        if config.selected_target == target {
            return false;
        }
        looks::set_selected_target(config, target.clone(), now_ms());
        true
    })?;
    broadcast(&app, &state, changed)
}

/// Select a look, which also takes it live.
#[tauri::command]
pub async fn set_selected_look(
    app: AppHandle,
    state: State<'_, LooksState>,
    look_id: String,
) -> AppResult<LooksConfig> {
    let changed = state.update(|config| looks::set_selected_look(config, &look_id, now_ms()))?;
    broadcast(&app, &state, changed)
}

#[tauri::command]
pub async fn add_look(
    app: AppHandle,
    state: State<'_, LooksState>,
    name: Option<String>,
) -> AppResult<LooksConfig> {
    let changed = state.update(|config| {
        let mut new_id = generate_look_id;
        looks::add_look(config, name.as_deref(), now_ms(), &mut new_id);
        true
    })?;
    broadcast(&app, &state, changed)
}

#[tauri::command]
pub async fn remove_look(
    app: AppHandle,
    state: State<'_, LooksState>,
    look_id: String,
) -> AppResult<LooksConfig> {
    let changed = state.update(|config| looks::remove_look(config, &look_id, now_ms()))?;
    broadcast(&app, &state, changed)
}

#[tauri::command]
pub async fn set_look_name(
    app: AppHandle,
    state: State<'_, LooksState>,
    look_id: String,
    name: String,
) -> AppResult<LooksConfig> {
    let changed = state.update(|config| {
        looks::set_look_name(config, &look_id, &name, now_ms());
        true
    })?;
    broadcast(&app, &state, changed)
}

/// Turn one layer on or off for one look and one surface.
///
/// The command an operator hits mid-service, and the reason this slice moved
/// first: under Electron the audience screen learns about it on the next poll.
#[tauri::command]
pub async fn set_look_layer(
    app: AppHandle,
    state: State<'_, LooksState>,
    look_id: String,
    target: LookTarget,
    layer: LookLayer,
    enabled: bool,
) -> AppResult<LooksConfig> {
    let changed = state.update(|config| {
        let current = config
            .looks
            .iter()
            .find(|look| look.id == look_id)
            .map(|look| look.targets.get(&target).layers.get(layer));
        if current == Some(enabled) {
            return false;
        }
        looks::set_layer_enabled(config, &look_id, &target, layer, enabled, now_ms());
        true
    })?;
    broadcast(&app, &state, changed)
}

/// Turn several layers on or off together, as one change.
///
/// The quick toggles are not one layer each: "words" is the slide layer and
/// the presentation layer, "media" is the media layer and the video input.
/// Sent as two commands they were two changes, each broadcasting the state it
/// produced — and two events racing meant the second could arrive first and
/// leave one of the pair on. The toggle then looked as though it had not
/// responded, or had turned itself back on.
#[tauri::command]
pub async fn set_look_layers(
    app: AppHandle,
    state: State<'_, LooksState>,
    look_id: String,
    target: LookTarget,
    layers: Vec<LookLayer>,
    enabled: bool,
) -> AppResult<LooksConfig> {
    let changed = state.update(|config| {
        let mut moved = false;
        for layer in &layers {
            let current = config
                .looks
                .iter()
                .find(|look| look.id == look_id)
                .map(|look| look.targets.get(&target).layers.get(*layer));
            if current == Some(enabled) {
                continue;
            }
            looks::set_layer_enabled(config, &look_id, &target, *layer, enabled, now_ms());
            moved = true;
        }
        moved
    })?;
    broadcast(&app, &state, changed)
}

#[tauri::command]
pub async fn set_look_text_position(
    app: AppHandle,
    state: State<'_, LooksState>,
    look_id: String,
    target: LookTarget,
    patch: LookTextPositionPatch,
) -> AppResult<LooksConfig> {
    let changed = state.update(|config| {
        looks::set_text_position(config, &look_id, &target, patch, now_ms());
        true
    })?;
    broadcast(&app, &state, changed)
}
