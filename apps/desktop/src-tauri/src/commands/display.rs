//! Display commands.
//!
//! Replaces the `get-displays` / `get-preferred-display` /
//! `set-preferred-display` / `set-preferred-resolution` IPC handlers
//! (`window.ipc.ts:43-83`). The payload shape is deliberately unchanged so the
//! React display pickers keep working untouched; what changes is that the
//! preference now survives a restart.

use tauri::{AppHandle, State};

use crate::errors::{AppError, AppResult};
use crate::services::display::{Display, ScreenRole};
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
