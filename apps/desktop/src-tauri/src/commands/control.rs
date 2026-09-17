//! Setting up the pedals, MIDI and OSC.

use serde::Serialize;
use tauri::{AppHandle, State};

use crate::errors::AppResult;
use crate::services::control::{self, ControlConfig};
use crate::state::ControlState;

/// What is set up, and what is actually open.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ControlStatus {
    pub config: ControlConfig,
    /// A MIDI port is open.
    pub midi_listening: bool,
    /// The OSC port being listened on, which is `None` when it could not be
    /// opened — something else has it.
    pub osc_port: Option<u16>,
    /// Every MIDI port on this machine, for the picker.
    pub midi_ports: Vec<String>,
}

fn status(state: &ControlState) -> ControlStatus {
    let (midi_listening, osc_port) = state.listening();
    ControlStatus {
        config: state.snapshot(),
        midi_listening,
        osc_port,
        midi_ports: control::midi::ports(),
    }
}

#[tauri::command]
pub async fn get_control_settings(state: State<'_, ControlState>) -> AppResult<ControlStatus> {
    Ok(status(&state))
}

#[tauri::command]
pub async fn set_control_settings(
    app: AppHandle,
    state: State<'_, ControlState>,
    config: ControlConfig,
) -> AppResult<ControlStatus> {
    state.set(&app, config)?;
    Ok(status(&state))
}

/// What the next MIDI message would bind to: the operator presses their pedal
/// and the app reads it, rather than asking which note it sends.
///
/// `None` when nothing arrives, which is the usual answer when the pedal is
/// not plugged in.
#[tauri::command]
pub async fn learn_midi_message(seconds: Option<u64>) -> AppResult<Option<control::LearnedMidi>> {
    let wait = std::time::Duration::from_secs(seconds.unwrap_or(10).clamp(1, 60));
    // On a thread: it waits, and commands run on a pool that should not.
    let learned = tokio::task::spawn_blocking(move || control::midi::learn(wait))
        .await
        .map_err(|error| crate::errors::AppError::Invalid(error.to_string()))?;
    Ok(learned.map(|(channel, message)| control::LearnedMidi { channel, message }))
}

/// Do what a control would do. The remote and the tests use it, and so does
/// the settings screen when the operator tries a binding out.
#[tauri::command]
pub async fn run_control_action(app: AppHandle, action: control::Action) -> AppResult<()> {
    control::dispatch(&app, &action, "app");
    Ok(())
}
