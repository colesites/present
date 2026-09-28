//! Display commands.
//!
//! Replaces the `get-displays` / `get-preferred-display` /
//! `set-preferred-display` / `set-preferred-resolution` IPC handlers
//! (`window.ipc.ts:43-83`). The payload shape is deliberately unchanged so the
//! React display pickers keep working untouched; what changes is that the
//! preference now survives a restart.

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, State};

use crate::errors::{AppError, AppResult};
use crate::services::display::{Display, ScreenRole};
use crate::services::display_modes::{self, DisplayMode, DisplayModeState, KEEP_WITHIN};
use crate::services::monitors::{self, ResolvedDisplay};
use crate::state::display_state::Resolution;
use crate::state::DisplayState;

/// Every connected monitor, in a stable order.
#[tauri::command]
pub fn get_displays(app: AppHandle) -> AppResult<Vec<Display>> {
    Ok(monitors::current_displays(&app)?
        .into_iter()
        .map(|(_, display)| display)
        .collect())
}

/// Which monitor a role resolves to, applying the same rule as Electron.
#[tauri::command]
pub fn get_preferred_display(
    app: AppHandle,
    state: State<'_, DisplayState>,
    role: ScreenRole,
) -> AppResult<Option<ResolvedDisplay>> {
    monitors::resolve_role(&app, &state, role)
}

/// Remember which monitor a role should use. `None` clears the choice and
/// returns the role to automatic selection.
#[tauri::command]
pub fn set_preferred_display(
    app: AppHandle,
    state: State<'_, DisplayState>,
    role: ScreenRole,
    display_id: Option<i64>,
) -> AppResult<()> {
    let key = match display_id {
        Some(id) => Some(
            monitors::current_displays(&app)?
                .into_iter()
                .find(|(_, display)| display.id == id)
                .map(|(key, _)| key)
                .ok_or_else(|| AppError::NotFound(format!("display {id}")))?,
        ),
        None => None,
    };

    state.update(|preferences| preferences.set_display(role, key))
}

/// Remember the output resolution for a role. Accepts the `"1920x1080"` strings
/// the frontend already sends.
#[tauri::command]
pub fn set_preferred_resolution(
    state: State<'_, DisplayState>,
    role: ScreenRole,
    resolution: String,
) -> AppResult<()> {
    let parsed = Resolution::parse(&resolution)
        .ok_or_else(|| AppError::Invalid(format!("Unrecognised resolution '{resolution}'.")))?;

    state.update(|preferences| preferences.set_resolution(role, parsed))
}

#[tauri::command]
pub fn get_preferred_resolution(
    state: State<'_, DisplayState>,
    role: ScreenRole,
) -> AppResult<Resolution> {
    Ok(state.snapshot().resolution_for(role))
}

/// Told to every window when a display's mode changes, is kept or is taken
/// back, so Screen Configuration can ask to keep it and read the modes again.
pub const DISPLAY_MODE_EVENT: &str = "display-mode:changed";

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ModeChanged {
    display_id: i64,
    /// Whether the new mode is waiting to be kept.
    waiting: bool,
    /// Whether it was taken back because nobody kept it.
    reverted: bool,
}

fn connected(app: &AppHandle, display_id: i64) -> AppResult<Display> {
    monitors::current_displays(app)?
        .into_iter()
        .map(|(_, display)| display)
        .find(|display| display.id == display_id)
        .ok_or_else(|| AppError::NotFound(format!("display {display_id}")))
}

/// The modes a connected display offers, the one it is in marked.
#[tauri::command]
pub async fn get_display_modes(app: AppHandle, display_id: i64) -> AppResult<Vec<DisplayMode>> {
    display_modes::modes_for(&connected(&app, display_id)?)
}

/// Put a connected display in one of its modes. It goes back to the mode it
/// was in after the returned number of seconds unless `keep_display_mode` is
/// called; 0 when it was already in that mode.
#[tauri::command]
pub async fn set_display_mode(
    app: AppHandle,
    state: State<'_, DisplayModeState>,
    display_id: i64,
    mode_id: String,
) -> AppResult<u64> {
    let previous = display_modes::set_mode(&connected(&app, display_id)?, &mode_id)?;
    if previous == mode_id {
        return Ok(0);
    }
    let token = state.changed(display_id, previous);
    let _ = app.emit(
        DISPLAY_MODE_EVENT,
        ModeChanged {
            display_id,
            waiting: true,
            reverted: false,
        },
    );

    let timer = app.clone();
    std::thread::spawn(move || {
        std::thread::sleep(KEEP_WITHIN);
        let Some(state) = timer.try_state::<DisplayModeState>() else {
            return;
        };
        if let Some(previous) = state.take_back(display_id, Some(token)) {
            take_back(&timer, display_id, &previous, true);
        }
    });
    Ok(KEEP_WITHIN.as_secs())
}

/// Keep a display's new mode.
#[tauri::command]
pub fn keep_display_mode(
    app: AppHandle,
    state: State<'_, DisplayModeState>,
    display_id: i64,
) -> AppResult<()> {
    if state.keep(display_id) {
        let _ = app.emit(
            DISPLAY_MODE_EVENT,
            ModeChanged {
                display_id,
                waiting: false,
                reverted: false,
            },
        );
    }
    Ok(())
}

/// Put a display straight back in the mode it was in before its change.
#[tauri::command]
pub async fn revert_display_mode(
    app: AppHandle,
    state: State<'_, DisplayModeState>,
    display_id: i64,
) -> AppResult<()> {
    if let Some(previous) = state.take_back(display_id, None) {
        take_back(&app, display_id, &previous, false);
    }
    Ok(())
}

fn take_back(app: &AppHandle, display_id: i64, previous: &str, reverted: bool) {
    let result =
        connected(app, display_id).and_then(|display| display_modes::set_mode(&display, previous));
    if let Err(error) = result {
        tracing::warn!(display_id, %error, "could not put the display back in its mode");
    }
    let _ = app.emit(
        DISPLAY_MODE_EVENT,
        ModeChanged {
            display_id,
            waiting: false,
            reverted,
        },
    );
}

/// Where the operating system sets a display's arrangement, and its
/// resolution where Present can't.
fn display_settings_url() -> Option<&'static str> {
    if cfg!(target_os = "macos") {
        Some("x-apple.systempreferences:com.apple.preference.displays")
    } else if cfg!(target_os = "windows") {
        Some("ms-settings:display")
    } else {
        None
    }
}

/// Open the system's display settings, from Screens & sound.
#[tauri::command]
pub fn open_display_settings(app: AppHandle) -> AppResult<()> {
    use tauri_plugin_opener::OpenerExt;

    let url = display_settings_url()
        .ok_or_else(|| AppError::Invalid("No display settings to open here.".to_owned()))?;
    app.opener()
        .open_url(url, None::<&str>)
        .map_err(|error| AppError::Invalid(format!("Could not open the display settings: {error}")))
}

/// Put every open full-screen window back on the display its role resolves to.
///
/// The hot-plug watcher does this automatically. This exposes it so an operator
/// can force it from the UI after changing a screen preference, without closing
/// and reopening the audience output.
#[tauri::command]
pub async fn reconcile_displays(app: AppHandle) -> AppResult<()> {
    crate::services::display_watch::reconcile_all(&app);
    Ok(())
}
