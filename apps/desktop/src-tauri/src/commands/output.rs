//! The audience scene.
//!
//! Replaces `send-to-output`, `send-to-stage`, `send-to-worship-stage` and the
//! three `*-ready` handshakes they needed. There is no relay any more: the
//! operator sends an update, Rust merges it into the one authoritative scene,
//! and every surface is told the whole scene.
//!
//! `send_to_output` and `send_to_stage` are the same command. Under Electron
//! they were separate because each window had to be addressed separately and
//! each kept its own accumulated copy; now they describe one thing that every
//! surface renders. The two names survive only so the React side did not have
//! to change in the same commit.

use tauri::{AppHandle, Emitter, Manager, State};

use crate::errors::AppResult;
use crate::services::output::{OutputScene, OutputUpdate};
use crate::services::screens::screen_id_for_label;
use crate::state::{LooksState, OutputState};

/// Emitted to every window when the audience scene changes.
///
/// Broadcast, not addressed: the audience output, both stage displays and the
/// operator's preview all render the same scene, and each decides what to draw
/// from it using the looks configuration.
pub const OUTPUT_CHANGED_EVENT: &str = "output:scene-changed";

fn broadcast(app: &AppHandle, scene: Option<OutputScene>) {
    let Some(mut scene) = scene else {
        return;
    };
    // The operator window folds the Screen's timer layer into the scene from
    // its own copy of the look, which is the shipped one — timer on — until
    // the app's arrives: the first scenes after a launch showed the timer for
    // a moment with it off. The app's copy is read before any window opens.
    // It turns the layer on only once the app has, so this never hides a
    // timer just switched on.
    if let Some(looks) = app.try_state::<LooksState>() {
        scene.timer_visible &= looks.screen_shows_timer();
    }
    if let Err(error) = app.emit(OUTPUT_CHANGED_EVENT, &scene) {
        tracing::error!(%error, "could not broadcast the output scene");
    }
}

/// The scene as it stands on screen.
///
/// This is what makes a late-joining window work without a handshake. Electron
/// needs `output-ready` to travel to the operator window so it can re-send
/// everything it last sent; here the window that just opened simply asks.
///
/// It asks for what the audience is looking at, not what the operator has set
/// up: an audience window reopened during a freeze shows the held screen. The
/// Electron one shows nothing at all until the freeze ends, because the
/// re-send it waits for is itself held back by the freeze.
///
/// An audience window names itself by `label`, and is handed the scene as its
/// screen shows it: through its own column of the live look, for a screen
/// added beside the Screen. The event below carries the Screen's scene, so
/// such a window asks again when it hears one.
#[tauri::command]
pub async fn get_output_scene(
    state: State<'_, OutputState>,
    looks: State<'_, LooksState>,
    label: Option<String>,
) -> AppResult<OutputScene> {
    let scene = state.on_screen();
    Ok(match label.as_deref().and_then(screen_id_for_label) {
        Some(screen) => looks.scene_for_screen(scene, screen),
        None => scene,
    })
}

/// Apply an update from the operator window.
#[tauri::command]
pub async fn send_to_output(
    app: AppHandle,
    state: State<'_, OutputState>,
    payload: OutputUpdate,
) -> AppResult<()> {
    broadcast(&app, state.apply(payload));
    Ok(())
}

/// Freeze or unfreeze the audience output.
///
/// While frozen the scene keeps tracking what the operator is doing and the
/// surfaces are not told, so the congregation sees a held screen while the
/// operator sets up what comes next. Unfreezing sends the scene they arrived
/// at — which the Electron version does not do; see `state/output_state.rs`.
#[tauri::command]
pub async fn set_output_frozen(
    app: AppHandle,
    state: State<'_, OutputState>,
    frozen: bool,
) -> AppResult<bool> {
    broadcast(&app, state.set_frozen(frozen));
    Ok(frozen)
}

#[tauri::command]
pub async fn is_output_frozen(state: State<'_, OutputState>) -> AppResult<bool> {
    Ok(state.is_frozen())
}
