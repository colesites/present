//! Minting AssemblyAI streaming tokens.
//!
//! The desktop app holds no AssemblyAI key — shipping one in a distributed
//! binary would let anyone extract it. The web app is the broker: it
//! authenticates the user's session, checks their speech quota, and returns a
//! short-lived streaming token.
//!
//! Under Electron the renderer called that endpoint directly from an `app://app`
//! origin, which is a cross-origin request with an `Authorization` header and so
//! subject to a CORS preflight. A main-process broker was written to sidestep
//! that (`network.ipc.ts:251`) but was never wired up, and the direct fetch is
//! what shipped — which is why speech search ended up being used through the web
//! app instead of the desktop.
//!
//! Doing it here removes the problem rather than reconfiguring around it: a
//! request from Rust is not a browser request, so no preflight, no origin
//! allowlist, and nothing to update when the app's origin changes again.

use std::time::Duration;

use serde::{Deserialize, Serialize};

use crate::errors::{AppError, AppResult};

const TOKEN_PATH: &str = "/api/assemblyai/token";
const USAGE_PATH: &str = "/api/assemblyai/usage";
const REQUEST_TIMEOUT: Duration = Duration::from_secs(15);

/// Which feature is asking, so the web app can attribute usage.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum SpeechUsageSource {
    Bible,
    Library,
}

/// Passed through to the frontend unchanged. The shape is the web route's, not
/// ours — deliberately opaque so a change there does not require a Rust release.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(transparent)]
pub struct SpeechTokenResponse(pub serde_json::Value);

/// Builds the token endpoint URL for a given web-app base URL.
///
/// Split out so the joining rules are testable without a network call —
/// trailing slashes and base paths are exactly where this kind of thing breaks.
pub fn build_token_url(web_app_base_url: &str) -> AppResult<String> {
    let trimmed = web_app_base_url.trim();
    if trimmed.is_empty() {
        return Err(AppError::Invalid(
            "Web app URL is not configured.".to_owned(),
        ));
    }

    let base = url_join_base(trimmed);
    Ok(format!("{base}{TOKEN_PATH}"))
}

/// Builds the usage-reporting endpoint URL.
pub fn build_usage_url(web_app_base_url: &str) -> AppResult<String> {
    let trimmed = web_app_base_url.trim();
    if trimmed.is_empty() {
        return Err(AppError::Invalid(
            "Web app URL is not configured.".to_owned(),
        ));
    }

    Ok(format!("{}{USAGE_PATH}", url_join_base(trimmed)))
}

fn url_join_base(value: &str) -> String {
    value.trim_end_matches('/').to_owned()
}

fn http_client() -> AppResult<reqwest::Client> {
    reqwest::Client::builder()
        .timeout(REQUEST_TIMEOUT)
        .build()
        .map_err(|error| AppError::Invalid(format!("Could not build HTTP client: {error}")))
}

/// Ask the web app for a streaming token on behalf of the signed-in user.
pub async fn request_token(
    web_app_base_url: &str,
    session_token: &str,
    source: SpeechUsageSource,
) -> AppResult<SpeechTokenResponse> {
    if session_token.trim().is_empty() {
        return Err(AppError::Invalid("Sign in to use voice search.".to_owned()));
    }

    let url = build_token_url(web_app_base_url)?;

    let response = http_client()?
        .post(&url)
        .bearer_auth(session_token)
        .json(&serde_json::json!({ "source": source }))
        .send()
        .await
        .map_err(|error| {
            AppError::Invalid(format!("Could not reach the speech service: {error}"))
        })?;

    let status = response.status();
    let body = response.text().await.map_err(|error| {
        AppError::Invalid(format!("Speech service reply was unreadable: {error}"))
    })?;

    if !status.is_success() {
        // The route returns either a JSON error envelope or a bare string.
        // Prefer the human-readable field when there is one; quota-exhausted
        // messages in particular are written for the user.
        let message = serde_json::from_str::<serde_json::Value>(&body)
            .ok()
            .and_then(|value| {
                value
                    .get("message")
                    .or_else(|| value.get("error"))
                    .and_then(|field| field.as_str())
                    .map(str::to_owned)
            })
            .unwrap_or_else(|| {
                if body.trim().is_empty() {
                    format!("Live transcription could not start ({status}).")
                } else {
                    body.clone()
                }
            });

        tracing::warn!(%status, "speech token request rejected");
        return Err(AppError::Invalid(message));
    }

    let payload = serde_json::from_str::<serde_json::Value>(&body).map_err(|error| {
        AppError::Invalid(format!("Speech service reply was not JSON: {error}"))
    })?;

    Ok(SpeechTokenResponse(payload))
}

/// Report a finished streaming session so the web app can meter it.
///
/// Speech search is billed by the second, so a silently dropped report is lost
/// revenue on one side and an unmetered user on the other. Under Electron this
/// was a fire-and-forget `fetch` from the renderer; the same CORS preflight that
/// broke token minting would have dropped it under Tauri without a sound.
pub async fn report_usage(
    web_app_base_url: &str,
    auth_bearer: &str,
    session_id: &str,
    ended_at_ms: i64,
) -> AppResult<serde_json::Value> {
    if auth_bearer.trim().is_empty() {
        return Err(AppError::Invalid("Missing authorization token.".to_owned()));
    }
    if session_id.trim().is_empty() {
        return Err(AppError::Invalid("Missing billing session id.".to_owned()));
    }

    let url = build_usage_url(web_app_base_url)?;

    let response = http_client()?
        .post(&url)
        .bearer_auth(auth_bearer)
        .json(&serde_json::json!({
            "sessionId": session_id,
            "endedAtMs": ended_at_ms,
        }))
        .send()
        .await
        .map_err(|error| AppError::Invalid(format!("Could not report speech usage: {error}")))?;

    let status = response.status();
    let body = response.text().await.unwrap_or_default();

    if !status.is_success() {
        tracing::warn!(%status, "speech usage report rejected");
        return Err(AppError::Invalid(format!(
            "Speech usage report failed ({status})."
        )));
    }

    Ok(serde_json::from_str(&body).unwrap_or(serde_json::Value::Null))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn builds_the_token_url_from_a_plain_base() {
        let url = build_token_url("https://present.multivrs.space").expect("a url");
        assert_eq!(url, "https://present.multivrs.space/api/assemblyai/token");
    }

    #[test]
    fn a_trailing_slash_does_not_double_up() {
        let url = build_token_url("https://present.multivrs.space/").expect("a url");
        assert_eq!(url, "https://present.multivrs.space/api/assemblyai/token");
    }

    #[test]
    fn surrounding_whitespace_is_ignored() {
        let url = build_token_url("  http://localhost:3001  ").expect("a url");
        assert_eq!(url, "http://localhost:3001/api/assemblyai/token");
    }

    #[test]
    fn an_empty_base_url_is_rejected_rather_than_producing_a_relative_path() {
        let error = build_token_url("   ").expect_err("should reject");
        assert!(matches!(error, AppError::Invalid(_)));
    }

    #[tokio::test]
    async fn a_blank_session_token_fails_before_any_network_call() {
        let error = request_token(
            "https://present.multivrs.space",
            "   ",
            SpeechUsageSource::Bible,
        )
        .await
        .expect_err("should reject");

        assert!(error.to_string().contains("Sign in"));
    }

    #[test]
    fn builds_the_usage_url() {
        let url = build_usage_url("https://present.multivrs.space/").expect("a url");
        assert_eq!(url, "https://present.multivrs.space/api/assemblyai/usage");
    }

    #[tokio::test]
    async fn usage_reporting_validates_its_inputs_before_any_network_call() {
        let missing_auth = report_usage("https://example.test", "  ", "sess_1", 0)
            .await
            .expect_err("should reject");
        assert!(missing_auth.to_string().contains("authorization"));

        let missing_session = report_usage("https://example.test", "token", "  ", 0)
            .await
            .expect_err("should reject");
        assert!(missing_session.to_string().contains("session id"));
    }

    #[test]
    fn usage_source_serialises_as_the_web_route_expects() {
        assert_eq!(
            serde_json::to_string(&SpeechUsageSource::Bible).expect("serializable"),
            "\"bible\""
        );
        assert_eq!(
            serde_json::to_string(&SpeechUsageSource::Library).expect("serializable"),
            "\"library\""
        );
    }
}
