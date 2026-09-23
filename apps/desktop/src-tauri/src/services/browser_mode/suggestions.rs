//! `fetch-browser-suggestions` (`network.ipc.ts:279-290`): the address bar's
//! search suggestions, from the web app.

use std::time::Duration;

use serde_json::{json, Value};

use super::rules;

/// Electron's loop followed five.
const MAX_REDIRECTS: usize = 5;
/// Electron set none; a suggestion that takes this long is not one.
const TIMEOUT: Duration = Duration::from_secs(10);

/// The web app's answer, or no suggestions — for a query with nothing in it,
/// and for any failure, as Electron answered.
pub async fn fetch(web_app_base_url: &str, query: &Value) -> Value {
    let Some(query) = query.as_str() else {
        return json!({ "suggestions": [] });
    };
    match request(web_app_base_url, query).await {
        Ok(Some(answer)) => answer,
        Ok(None) => json!({ "suggestions": [] }),
        Err(error) => {
            tracing::warn!(%error, "could not fetch browser suggestions");
            json!({ "suggestions": [] })
        }
    }
}

async fn request(web_app_base_url: &str, query: &str) -> Result<Option<Value>, String> {
    let Some(url) = rules::browser_suggestions_url(web_app_base_url, query)? else {
        return Ok(None);
    };
    let client = reqwest::Client::builder()
        .timeout(TIMEOUT)
        .redirect(reqwest::redirect::Policy::limited(MAX_REDIRECTS))
        .build()
        .map_err(|error| error.to_string())?;
    let response = client
        .get(url)
        .header(reqwest::header::ACCEPT, "application/json")
        .header(reqwest::header::CACHE_CONTROL, "no-store")
        .send()
        .await
        .map_err(|error| error.to_string())?;
    let status = response.status();
    if !status.is_success() {
        return Err(format!("Request failed ({})", status.as_u16()));
    }
    response
        .json()
        .await
        .map(Some)
        .map_err(|error| error.to_string())
}
