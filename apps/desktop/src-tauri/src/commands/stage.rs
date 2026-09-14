//! The two stage displays' feed. Replaces `send-to-stage`,
//! `send-to-worship-stage` and their `*-ready` handshakes.

use serde_json::Value;
use tauri::{AppHandle, Emitter, State};

use crate::errors::AppResult;
use crate::services::stage_relay::StageTarget;
use crate::state::StageRelayState;

/// Keep a message for a stage display and deliver it on Electron's channel.
#[tauri::command]
pub async fn send_to_stage(
    app: AppHandle,
    state: State<'_, StageRelayState>,
    target: StageTarget,
    payload: Value,
) -> AppResult<()> {
    let message = state.record(target, payload)?;
    if let Err(error) = app.emit(target.event(), message) {
        tracing::warn!(%error, ?target, "could not deliver a stage message");
    }
    Ok(())
}

/// What a stage display that has just opened missed, in the order to apply it.
#[tauri::command]
pub async fn get_stage_messages(
    state: State<'_, StageRelayState>,
    target: StageTarget,
) -> AppResult<Vec<Value>> {
    Ok(state.replay(target))
}
