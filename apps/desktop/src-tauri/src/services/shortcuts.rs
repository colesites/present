//! The application-wide AI Operator shortcut.
//!
//! Ports `src/main/services/ai-operator-shortcuts.service.ts`. Same accelerator,
//! same channel name, same behaviour when registration fails: warn and carry on,
//! because another app holding `Ctrl+Alt+Space` is not a reason to refuse to
//! start ten minutes before a service.

use tauri::{AppHandle, Emitter, Manager};

use crate::services::window_spec::WindowRole;

/// `AI_OPERATOR_ACCELERATOR` (`ai-operator-shortcuts.service.ts:4`).
pub const AI_OPERATOR_ACCELERATOR: &str = "Control+Alt+Space";
/// `AI_OPERATOR_TOGGLE_CHANNEL` (`ai-operator-shortcuts.service.ts:5`).
pub const AI_OPERATOR_TOGGLE_EVENT: &str = "ai-operator:toggle-shortcut";

/// Register the shortcut. Errors are logged, never propagated.
pub fn register(app: &AppHandle) {
    use tauri_plugin_global_shortcut::{GlobalShortcutExt, ShortcutState};

    let handle = app.clone();
    let result = app.global_shortcut().on_shortcut(
        AI_OPERATOR_ACCELERATOR,
        move |_app, _shortcut, event| {
            // The plugin reports both edges. Electron's callback fires once per
            // press, so only the press is forwarded — otherwise every use would
            // toggle the operator panel open and shut again.
            if event.state() != ShortcutState::Pressed {
                return;
            }
            toggle(&handle);
        },
    );

    if let Err(error) = result {
        tracing::warn!(
            %error,
            accelerator = AI_OPERATOR_ACCELERATOR,
            "failed to register the AI Operator global shortcut"
        );
    }
}

fn toggle(app: &AppHandle) {
    let Some(window) = app.get_webview_window(WindowRole::Main.label()) else {
        return;
    };
    if let Err(error) = window.emit(AI_OPERATOR_TOGGLE_EVENT, ()) {
        tracing::error!(%error, "could not deliver the AI Operator shortcut");
    }
}
