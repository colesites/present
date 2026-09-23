//! Process-level commands.

use serde::Serialize;
use tauri::State;

use crate::errors::AppResult;
use crate::state::AppState;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppInfo {
    /// Crate version — kept in lockstep with `package.json` by
    /// `scripts/check-tauri-version.mjs`.
    pub version: String,
    pub platform: String,
    pub arch: String,
    /// Milliseconds since the Rust core started. Baseline for the startup-time
    /// comparison against Electron.
    pub uptime_ms: u64,
    pub debug_build: bool,
}

/// Returns runtime facts about the Rust core.
///
/// This is the migration's end-to-end smoke test: if the frontend can read a
/// typed struct back from here, the whole React → invoke → Rust → serde path is
/// wired correctly.
#[tauri::command]
pub fn get_app_info(state: State<'_, AppState>) -> AppResult<AppInfo> {
    tracing::info!(uptime_ms = state.uptime_ms(), "get_app_info");

    Ok(AppInfo {
        version: env!("CARGO_PKG_VERSION").to_owned(),
        platform: std::env::consts::OS.to_owned(),
        arch: std::env::consts::ARCH.to_owned(),
        uptime_ms: state.uptime_ms(),
        debug_build: cfg!(debug_assertions),
    })
}
