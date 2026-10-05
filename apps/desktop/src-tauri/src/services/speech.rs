//! Minting AssemblyAI streaming tokens, from the desktop.
//!
//! The app asks AssemblyAI itself, with the key built into it
//! (`services/service_keys.rs`), for a short-lived token the webview streams
//! the microphone with. It used to ask the website, which held the key; the
//! website's other job there, starting the usage session that keeps a plan
//! within its speech time, is done by the renderer against Convex directly
//! (`useSpeechRecognition.ts`), so nothing about speech goes through the
//! website any more.
//!
//! The session's length comes from that usage session: AssemblyAI ends the
//! stream itself once a plan's remaining time is spent.

use std::time::Duration;

use serde::{Deserialize, Serialize};

use crate::errors::{AppError, AppResult};
use crate::services::service_keys;

const TOKEN_URL: &str = "https://streaming.assemblyai.com/v3/token";
const REQUEST_TIMEOUT: Duration = Duration::from_secs(15);

/// How long a token may wait before the stream is opened with it.
const TOKEN_LIFETIME_SECONDS: u32 = 300;

/// AssemblyAI's own limits on a streaming session's length.
const SHORTEST_SESSION_SECONDS: u32 = 60;
const LONGEST_SESSION_SECONDS: u32 = 3 * 60 * 60;

/// A token the webview opens the stream with.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StreamingToken {
    pub token: String,
    pub expires_in_seconds: u32,
}

/// The token request's address, for a session of at most `seconds`.
pub fn token_url(seconds: u32) -> String {
    let seconds = seconds.clamp(SHORTEST_SESSION_SECONDS, LONGEST_SESSION_SECONDS);
    format!(
        "{TOKEN_URL}?expires_in_seconds={TOKEN_LIFETIME_SECONDS}&max_session_duration_seconds={seconds}"
    )
}

/// What the operator is told when the voice service cannot be reached.
const NO_CONNECTION: &str =
    "Voice search couldn't connect. Check the internet connection and try again.";

/// Ask AssemblyAI for a streaming token, for a session of at most
/// `max_session_seconds`.
pub async fn mint_token(max_session_seconds: u32) -> AppResult<StreamingToken> {
    let key = service_keys::assemblyai().ok_or_else(|| {
        tracing::warn!("this build has no AssemblyAI key");
        AppError::User("Voice search isn't available in this build of Present.".to_owned())
    })?;

    let response = reqwest::Client::builder()
        .timeout(REQUEST_TIMEOUT)
        .build()
        .map_err(|error| AppError::Invalid(format!("Could not build HTTP client: {error}")))?
        .get(token_url(max_session_seconds))
        .header(reqwest::header::AUTHORIZATION, key)
        .send()
        .await
        .map_err(|error| {
            tracing::warn!(%error, "could not reach AssemblyAI for a streaming token");
            AppError::User(NO_CONNECTION.to_owned())
        })?;

    let status = response.status();
    let body: serde_json::Value = response.json().await.unwrap_or(serde_json::Value::Null);
    let token = body
        .get("token")
        .and_then(serde_json::Value::as_str)
        .filter(|token| !token.is_empty());
    match token {
        Some(token) if status.is_success() => Ok(StreamingToken {
            token: token.to_owned(),
            expires_in_seconds: body
                .get("expires_in_seconds")
                .and_then(serde_json::Value::as_u64)
                .map_or(TOKEN_LIFETIME_SECONDS, |seconds| seconds as u32),
        }),
        _ => {
            let reason = body
                .get("error")
                .or_else(|| body.get("message"))
                .and_then(serde_json::Value::as_str)
                .unwrap_or("no token in the reply");
            tracing::warn!(%status, reason, "AssemblyAI refused a streaming token");
            Err(AppError::User(
                "Voice search couldn't start just now. Try again in a moment.".to_owned(),
            ))
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_token_is_asked_for_the_session_the_plan_allows() {
        assert_eq!(
            token_url(900),
            "https://streaming.assemblyai.com/v3/token?expires_in_seconds=300&max_session_duration_seconds=900"
        );
    }

    #[test]
    fn a_session_is_kept_within_what_assemblyai_accepts() {
        assert!(token_url(5).ends_with("max_session_duration_seconds=60"));
        assert!(token_url(u32::MAX).ends_with("max_session_duration_seconds=10800"));
    }
}
