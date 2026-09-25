//! The application menu's side of the operator window.

use std::collections::HashMap;

use tauri::AppHandle;

use crate::errors::AppResult;

/// Tick the menu items that say whether something is on — text on the output,
/// the audience window open — as the operator window sees them now
/// (`services/app_menu.rs`). Only the keys given change.
#[tauri::command]
pub fn set_menu_checks(app: AppHandle, checks: HashMap<String, bool>) -> AppResult<()> {
    crate::services::app_menu::set_checks(&app, &checks);
    Ok(())
}
