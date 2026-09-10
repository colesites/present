//! Auth session commands.
//!
//! Replaces the eight channels in `auth.ipc.ts`. The flow itself is unchanged
//! and deliberately so: sign-in happens in the user's own browser, the web app
//! returns the session over a `present://` deep link, and the desktop stores
//! it. Nothing about that needed Electron.
//!
//! What changed is where the session is kept — the OS keychain rather than one
//! of two files chosen by whether the app was packaged. See
//! `state/auth_state.rs`.
//!
//! The web-app base URL is passed in by the frontend rather than read here.
//! It is a build-time constant of the *renderer* (`process.env.WEB_APP_URL`),
//! and duplicating that resolution in Rust would give two answers to one
//! question the first time a developer overrode it.

use tauri::{AppHandle, State};

use crate::errors::{AppError, AppResult};
use crate::services::auth::{self, AuthPayload, RefreshOutcome, StoredSession};
use crate::services::deep_link::PendingDeepLink;
use crate::state::AuthState;

/// Result of asking the OS to open the sign-in page. Mirrors what
/// `beginAuthFlow` returns (`auth.service.ts:65-77`).
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AuthFlowResult {
    pub ok: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

#[tauri::command]
pub async fn get_stored_auth_session(
    state: State<'_, AuthState>,
) -> AppResult<Option<StoredSession>> {
    Ok(state.get())
}

#[tauri::command]
pub async fn set_stored_auth_session(
    state: State<'_, AuthState>,
    payload: serde_json::Value,
) -> AppResult<bool> {
    state.set(&payload)
}

#[tauri::command]
pub async fn clear_stored_auth_session(state: State<'_, AuthState>) -> AppResult<bool> {
    state.clear()
}

/// Take the tokens from a deep link that arrived before anything was listening.
///
/// The same buffer `take_pending_deep_link` reads. Electron exposes both names
/// and `App.tsx` calls both — whichever runs first gets the payload, and they
/// hand it to the same function.
#[tauri::command]
pub async fn consume_pending_auth_token(
    state: State<'_, PendingDeepLink>,
) -> AppResult<Option<AuthPayload>> {
    Ok(state.take())
}

/// Open the sign-in page in the user's own browser.
///
/// Not in a webview, and not in one of our windows. The desktop must never see
/// the Clerk credentials, and an operator signing in should be able to use
/// their browser's password manager.
#[tauri::command]
pub async fn begin_auth_flow(
    app: AppHandle,
    web_app_base_url: String,
) -> AppResult<AuthFlowResult> {
    let url = match auth::build_login_url(&web_app_base_url) {
        Ok(url) => url,
        Err(error) => {
            return Ok(AuthFlowResult {
                ok: false,
                error: Some(error.to_string()),
            })
        }
    };

    match open_url(&app, &url) {
        Ok(()) => Ok(AuthFlowResult {
            ok: true,
            error: None,
        }),
        Err(error) => {
            tracing::error!(%error, "could not open the browser for sign-in");
            Ok(AuthFlowResult {
                ok: false,
                error: Some("Unable to open the browser for sign-in.".to_owned()),
            })
        }
    }
}

/// Open an arbitrary URL in the user's browser.
///
/// Refuses anything that is not http or https. Under Electron this passed
/// straight to `shell.openExternal` (`auth.ipc.ts:125-128`), which will happily
/// open a `file://` path or hand a custom scheme to whatever app claims it.
#[tauri::command]
pub async fn open_external_browser(app: AppHandle, url: String) -> AppResult<bool> {
    let trimmed = url.trim();
    if !trimmed.starts_with("http://") && !trimmed.starts_with("https://") {
        return Err(AppError::Invalid(format!(
            "Refusing to open {trimmed}: only http and https links open in the browser."
        )));
    }

    open_url(&app, trimmed)?;
    Ok(true)
}

fn open_url(app: &AppHandle, url: &str) -> AppResult<()> {
    use tauri_plugin_opener::OpenerExt;

    app.opener()
        .open_url(url, None::<&str>)
        .map_err(|error| AppError::Invalid(format!("Could not open the browser: {error}")))
}

/// Exchange a session token for a fresh one.
///
/// `web_app_base_urls` is a list because a developer's web app may be on either
/// of two ports; the Electron version walks the same candidates
/// (`app.utils.ts:26-46`).
#[tauri::command]
pub async fn refresh_desktop_session(
    web_app_base_urls: Vec<String>,
    session_token: String,
) -> AppResult<RefreshOutcome> {
    auth::refresh_session(&web_app_base_urls, &session_token).await
}
