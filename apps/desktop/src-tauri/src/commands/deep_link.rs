//! Deep-link collection.
//!
//! One command, and it exists to close a race. The OS can launch the app
//! *because* a `present://` link was opened, so the link is handled before any
//! webview exists to hear the event. Electron re-fires it on `did-finish-load`,
//! which is a guess about when React attached its listener. Here the frontend
//! asks, as it subscribes, whether one is waiting.

use tauri::State;

use crate::errors::AppResult;
use crate::services::deep_link::{AuthPayload, PendingDeepLink};

/// Take the link that arrived before anything was listening, if there is one.
/// Reading it clears it: a sign-in must not be replayed.
#[tauri::command]
pub async fn take_pending_deep_link(
    state: State<'_, PendingDeepLink>,
) -> AppResult<Option<AuthPayload>> {
    Ok(state.take())
}
