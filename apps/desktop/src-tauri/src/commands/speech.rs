//! Speech-to-search commands.

use crate::errors::AppResult;
use crate::services::speech::{self, SpeechTokenResponse, SpeechUsageSource};

/// Mint an AssemblyAI streaming token for the signed-in user.
///
/// The session token is supplied by the frontend for now; it moves into
/// Rust-owned session state in Stage 3, at which point this argument goes away.
#[tauri::command]
pub async fn request_speech_token(
    web_app_base_url: String,
    session_token: String,
    source: SpeechUsageSource,
) -> AppResult<SpeechTokenResponse> {
    speech::request_token(&web_app_base_url, &session_token, source).await
}

/// Report a finished streaming session for billing.
#[tauri::command]
pub async fn report_speech_usage(
    web_app_base_url: String,
    auth_bearer: String,
    session_id: String,
    ended_at_ms: i64,
) -> AppResult<serde_json::Value> {
    speech::report_usage(&web_app_base_url, &auth_bearer, &session_id, ended_at_ms).await
}
