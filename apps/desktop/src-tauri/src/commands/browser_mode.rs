//! Browser mode. Replaces the eight `browser-mode:*` channels in
//! `browser.ipc.ts` and `fetch-browser-suggestions` in `network.ipc.ts`.

use std::sync::Arc;

use serde_json::Value;
use tauri::State;

use crate::errors::AppResult;
use crate::services::browser_mode::rules::{BrowserState, ProjectionTarget, RawBounds};
use crate::services::browser_mode::view::WryHost;
use crate::services::browser_mode::{suggestions, BrowserMode, History};

type Browser<'a> = State<'a, Arc<BrowserMode<WryHost>>>;

#[tauri::command]
pub async fn set_browser_mode_enabled(
    browser: Browser<'_>,
    enabled: bool,
) -> AppResult<BrowserState> {
    browser.inner().set_enabled(enabled).await
}

#[tauri::command]
pub async fn set_browser_mode_bounds(
    browser: Browser<'_>,
    bounds: RawBounds,
) -> AppResult<BrowserState> {
    Ok(browser.inner().set_bounds(bounds).await)
}

#[tauri::command]
pub async fn browser_navigate(browser: Browser<'_>, input: String) -> AppResult<BrowserState> {
    browser.inner().navigate(&input).await
}

#[tauri::command]
pub async fn browser_back(browser: Browser<'_>) -> AppResult<BrowserState> {
    Ok(browser.inner().go(History::Back).await)
}

#[tauri::command]
pub async fn browser_forward(browser: Browser<'_>) -> AppResult<BrowserState> {
    Ok(browser.inner().go(History::Forward).await)
}

#[tauri::command]
pub async fn browser_reload(browser: Browser<'_>) -> AppResult<BrowserState> {
    Ok(browser.inner().reload().await)
}

#[tauri::command]
pub async fn set_browser_projection_target(
    browser: Browser<'_>,
    target: ProjectionTarget,
) -> AppResult<BrowserState> {
    browser.inner().set_projection(target).await
}

#[tauri::command]
pub async fn get_browser_mode_state(browser: Browser<'_>) -> AppResult<BrowserState> {
    Ok(browser.inner().state().await)
}

/// The web app's base URL comes from the renderer, as for sign-in
/// (`commands/auth.rs`): it is a build-time constant there.
#[tauri::command]
pub async fn fetch_browser_suggestions(query: Value, web_app_base_url: String) -> Value {
    suggestions::fetch(&web_app_base_url, &query).await
}
