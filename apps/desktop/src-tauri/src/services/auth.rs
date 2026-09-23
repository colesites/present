//! The desktop auth session.
//!
//! Ports `session-storage.service.ts` and `auth.ipc.ts`. Three things live
//! here: the shape of a stored session and the rules for reading one back, the
//! transport that refreshes it against the web app, and the URL the sign-in
//! flow opens.
//!
//! The desktop never talks to Clerk directly. Sign-in happens in the user's own
//! browser, and the web app hands the session back through a `present://` deep
//! link — which is why this survived the move to Tauri unchanged in shape.
//!
//! **Where the session is kept changed, and that fixes a real bug.** Electron
//! writes `desktop-auth-session.v1.json` when packaged and
//! `desktop-auth-session.dev.v1.json` when not (`session-storage.service.ts:38-41`),
//! so a developer machine holds two sessions and which one you get depends on
//! how the app was launched. That is half of known-issues §2 — "sometimes when
//! I open the app I am signed out". Here there is one session, in the OS
//! keychain, keyed by nothing but the app.

use std::time::Duration;

use serde::{Deserialize, Serialize};

use crate::errors::{AppError, AppResult};

const REFRESH_PATH: &str = "/api/auth/desktop/refresh-session";
const REQUEST_TIMEOUT: Duration = Duration::from_secs(20);
const MAX_REDIRECTS: usize = 5;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StoredUser {
    pub email: String,
    pub id: String,
    pub name: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StoredOrganization {
    pub id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub logo: Option<String>,
    pub name: String,
    #[serde(rename = "type")]
    pub kind: OrganizationKind,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum OrganizationKind {
    Organization,
    Personal,
}

/// `DesktopStoredSession` in `session-storage.service.ts:22-31`, field for
/// field, because the React side reads this shape today.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StoredSession {
    pub org_id: Option<String>,
    pub organizations: Vec<StoredOrganization>,
    pub saved_at_ms: i64,
    pub session_expires_at_ms: Option<i64>,
    pub session_token: String,
    pub token: Option<String>,
    pub token_expires_at_ms: Option<i64>,
    pub user: Option<StoredUser>,
}

/// The tokens a `present://auth` link carries.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AuthPayload {
    pub access_token: Option<String>,
    pub session_token: String,
}

/// Read a stored session back, applying the same rules as
/// `normalizeStoredSession` (`session-storage.service.ts:110-160`).
///
/// `None` means "no usable session", never an error. A session that cannot be
/// understood must sign the operator out cleanly rather than wedge the app.
pub fn normalize_session(value: &serde_json::Value) -> Option<StoredSession> {
    let session_token = value
        .get("sessionToken")
        .and_then(serde_json::Value::as_str)
        .filter(|token| !token.is_empty())?
        .to_owned();

    let organizations: Vec<StoredOrganization> = value
        .get("organizations")
        .and_then(serde_json::Value::as_array)
        .map(|entries| entries.iter().filter_map(normalize_organization).collect())
        .unwrap_or_default();

    // An org id is only kept when it names a real *organization* the user
    // belongs to. A stale one would scope every Convex query to a workspace
    // that is not theirs.
    let org_id = value
        .get("orgId")
        .and_then(serde_json::Value::as_str)
        .filter(|id| {
            organizations.iter().any(|organization| {
                organization.kind == OrganizationKind::Organization && organization.id == *id
            })
        })
        .map(str::to_owned);

    Some(StoredSession {
        org_id,
        organizations,
        saved_at_ms: finite_number(value, "savedAtMs")
            .unwrap_or_else(crate::state::looks_state::now_ms),
        session_expires_at_ms: finite_number(value, "sessionExpiresAtMs"),
        session_token,
        token: value
            .get("token")
            .and_then(serde_json::Value::as_str)
            .map(str::to_owned),
        token_expires_at_ms: finite_number(value, "tokenExpiresAtMs"),
        user: value.get("user").and_then(normalize_user),
    })
}

fn finite_number(value: &serde_json::Value, key: &str) -> Option<i64> {
    value
        .get(key)
        .and_then(serde_json::Value::as_f64)
        .filter(|number| number.is_finite())
        .map(|number| number as i64)
}

fn normalize_user(value: &serde_json::Value) -> Option<StoredUser> {
    let field = |key: &str| value.get(key).and_then(serde_json::Value::as_str);
    Some(StoredUser {
        id: field("id")?.to_owned(),
        name: field("name")?.to_owned(),
        email: field("email")?.to_owned(),
    })
}

fn normalize_organization(value: &serde_json::Value) -> Option<StoredOrganization> {
    let field = |key: &str| value.get(key).and_then(serde_json::Value::as_str);
    let kind = match field("type")? {
        "organization" => OrganizationKind::Organization,
        "personal" => OrganizationKind::Personal,
        _ => return None,
    };

    Some(StoredOrganization {
        id: field("id")?.to_owned(),
        name: field("name")?.to_owned(),
        logo: field("logo").map(str::to_owned),
        kind,
    })
}

/// The sign-in URL opened in the user's own browser.
/// Ports `buildDesktopAuthLoginUrl` (`auth.service.ts:35-44`).
///
/// `client=electron` is kept verbatim. It is wrong for this build, and changing
/// it means changing whatever the web app does with it — a coordinated change
/// across two apps, which belongs with the rest of the auth work rather than
/// here. Recorded rather than silently "fixed".
pub fn build_login_url(web_app_base_url: &str) -> AppResult<String> {
    build_login_url_returning_to(web_app_base_url, None)
}

/// The sign-in URL, optionally naming a loopback address to come back to.
///
/// A packaged build passes `None` and the session arrives over the
/// `present://` link, as it always has. A development build passes the
/// listener it opened, because on macOS that link belongs to whichever Present
/// is installed and never reaches the one being worked on
/// (`services/auth_loopback.rs`).
pub fn build_login_url_returning_to(
    web_app_base_url: &str,
    come_back_to: Option<&str>,
) -> AppResult<String> {
    let base = web_app_base_url.trim().trim_end_matches('/');
    if base.is_empty() {
        return Err(AppError::Invalid(
            "Web app URL is not configured.".to_owned(),
        ));
    }

    let next = match come_back_to {
        Some(address) => format!(
            "/auth/desktop/callback?redirect={}",
            encode_component(address)
        ),
        None => "/auth/desktop/callback".to_owned(),
    };
    Ok(format!(
        "{base}/sign-in?source=desktop&client=electron&flow=external-browser&next={}",
        encode_component(&next)
    ))
}

fn encode_component(value: &str) -> String {
    let mut out = String::with_capacity(value.len());
    for byte in value.as_bytes() {
        if byte.is_ascii_alphanumeric() || b"-_.!~*'()".contains(byte) {
            out.push(*byte as char);
        } else {
            out.push_str(&format!("%{byte:02X}"));
        }
    }
    out
}

pub fn build_refresh_url(web_app_base_url: &str) -> AppResult<String> {
    let base = web_app_base_url.trim().trim_end_matches('/');
    if base.is_empty() {
        return Err(AppError::Invalid(
            "Web app URL is not configured.".to_owned(),
        ));
    }
    Ok(format!("{base}{REFRESH_PATH}"))
}

/// What a refresh attempt produced. Mirrors `DesktopRefreshOutcome`
/// (`auth.ipc.ts:12-14`), which the React side already branches on.
#[derive(Debug, Clone, Serialize)]
#[serde(untagged)]
pub enum RefreshOutcome {
    Ok {
        ok: bool,
        data: serde_json::Value,
    },
    Failed {
        ok: bool,
        status: u16,
        error: String,
    },
}

impl RefreshOutcome {
    fn success(data: serde_json::Value) -> Self {
        Self::Ok { ok: true, data }
    }

    fn failure(status: u16, error: impl Into<String>) -> Self {
        Self::Failed {
            ok: false,
            status,
            error: error.into(),
        }
    }
}

/// Refresh a session against the web app, trying each candidate base URL.
///
/// The retry across base URLs is Electron's (`auth.ipc.ts:26-84`) and exists
/// because a developer's web app may be on either of two ports. A 4xx is
/// definitive and stops the loop — a rejected token is not going to be accepted
/// by a different host.
pub async fn refresh_session(
    web_app_base_urls: &[String],
    session_token: &str,
) -> AppResult<RefreshOutcome> {
    if session_token.trim().is_empty() {
        return Ok(RefreshOutcome::failure(400, "Missing session token"));
    }

    let client = reqwest::Client::builder()
        .timeout(REQUEST_TIMEOUT)
        // Redirects are followed by hand so a redirect without a `location`
        // is reported rather than swallowed, matching the Electron loop.
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .map_err(|error| AppError::Invalid(format!("Could not build HTTP client: {error}")))?;

    let body = serde_json::json!({ "sessionToken": session_token });
    let mut last_error = String::from("Network error refreshing desktop session");
    let mut last_status = 0u16;

    for base_url in web_app_base_urls {
        let Ok(mut url) = build_refresh_url(base_url) else {
            continue;
        };

        for _ in 0..=MAX_REDIRECTS {
            let response = match client.post(&url).json(&body).send().await {
                Ok(response) => response,
                Err(error) => {
                    last_error = error.to_string();
                    break;
                }
            };

            let status = response.status();

            if status.is_redirection() {
                match response
                    .headers()
                    .get(reqwest::header::LOCATION)
                    .and_then(|value| value.to_str().ok())
                {
                    Some(location) => {
                        url = resolve_redirect(&url, location);
                        continue;
                    }
                    None => {
                        last_status = status.as_u16();
                        last_error =
                            format!("Redirect without location header ({})", status.as_u16());
                        break;
                    }
                }
            }

            if status.is_client_error() {
                let message = response.text().await.unwrap_or_default();
                let message = if message.is_empty() {
                    format!("Desktop refresh failed ({})", status.as_u16())
                } else {
                    message
                };
                return Ok(RefreshOutcome::failure(status.as_u16(), message));
            }

            if !status.is_success() {
                last_status = status.as_u16();
                last_error = response
                    .text()
                    .await
                    .ok()
                    .filter(|text| !text.is_empty())
                    .unwrap_or_else(|| format!("Desktop refresh failed ({})", status.as_u16()));
                break;
            }

            return match response.json::<serde_json::Value>().await {
                Ok(data) => Ok(RefreshOutcome::success(data)),
                Err(error) => Ok(RefreshOutcome::failure(
                    0,
                    format!("Could not read the refresh response: {error}"),
                )),
            };
        }
    }

    Ok(RefreshOutcome::failure(last_status, last_error))
}

/// `new URL(location, currentUrl)` — an absolute location replaces the URL, a
/// rooted path keeps the origin, anything else is relative to the directory.
fn resolve_redirect(current: &str, location: &str) -> String {
    if location.starts_with("http://") || location.starts_with("https://") {
        return location.to_owned();
    }

    let origin_end = current
        .find("://")
        .and_then(|scheme| {
            current[scheme + 3..]
                .find('/')
                .map(|rest| scheme + 3 + rest)
        })
        .unwrap_or(current.len());
    let origin = &current[..origin_end];

    if location.starts_with('/') {
        return format!("{origin}{location}");
    }

    let directory = current
        .rfind('/')
        .map(|index| &current[..index])
        .unwrap_or(origin);
    format!("{directory}/{location}")
}

#[cfg(test)]
mod tests {
    use super::*;

    fn session_value() -> serde_json::Value {
        serde_json::json!({
            "sessionToken": "session-abc",
            "token": "jwt-xyz",
            "savedAtMs": 1_700_000_000_000i64,
            "sessionExpiresAtMs": 1_700_000_900_000i64,
            "tokenExpiresAtMs": 1_700_000_060_000i64,
            "orgId": "org-1",
            "organizations": [
                { "id": "org-1", "name": "Grace Church", "type": "organization" },
                { "id": "me", "name": "Personal", "type": "personal" },
            ],
            "user": { "id": "user-1", "name": "Cole", "email": "cole@example.com" },
        })
    }

    #[test]
    fn a_complete_session_round_trips() {
        let session = normalize_session(&session_value()).expect("valid");

        assert_eq!(session.session_token, "session-abc");
        assert_eq!(session.token.as_deref(), Some("jwt-xyz"));
        assert_eq!(session.org_id.as_deref(), Some("org-1"));
        assert_eq!(session.organizations.len(), 2);
        assert_eq!(session.user.expect("user").email, "cole@example.com");
    }

    #[test]
    fn a_session_with_no_token_is_not_a_session() {
        assert!(normalize_session(&serde_json::json!({})).is_none());
        assert!(normalize_session(&serde_json::json!({ "sessionToken": "" })).is_none());
        assert!(normalize_session(&serde_json::json!({ "sessionToken": 42 })).is_none());
    }

    #[test]
    fn an_org_id_the_user_does_not_belong_to_is_dropped() {
        // Otherwise every Convex query is scoped to someone else's workspace.
        let mut value = session_value();
        value["orgId"] = serde_json::json!("org-someone-else");

        let session = normalize_session(&value).expect("valid");
        assert_eq!(session.org_id, None);
    }

    #[test]
    fn a_personal_workspace_cannot_be_the_org_id() {
        let mut value = session_value();
        value["orgId"] = serde_json::json!("me");

        let session = normalize_session(&value).expect("valid");
        assert_eq!(session.org_id, None, "personal is not an organization");
    }

    #[test]
    fn a_malformed_organization_is_dropped_rather_than_failing_the_session() {
        let mut value = session_value();
        value["organizations"] = serde_json::json!([
            { "id": "org-1", "name": "Grace Church", "type": "organization" },
            { "id": "broken" },
            { "id": "org-2", "name": "Nope", "type": "hologram" },
        ]);

        let session = normalize_session(&value).expect("valid");
        assert_eq!(session.organizations.len(), 1);
        assert_eq!(session.organizations[0].id, "org-1");
    }

    #[test]
    fn a_partial_user_is_dropped_rather_than_half_populated() {
        let mut value = session_value();
        value["user"] = serde_json::json!({ "id": "user-1" });

        let session = normalize_session(&value).expect("valid");
        assert_eq!(session.user, None);
    }

    #[test]
    fn non_finite_timestamps_become_null() {
        let mut value = session_value();
        value["sessionExpiresAtMs"] = serde_json::json!("soon");
        value["tokenExpiresAtMs"] = serde_json::json!(null);

        let session = normalize_session(&value).expect("valid");
        assert_eq!(session.session_expires_at_ms, None);
        assert_eq!(session.token_expires_at_ms, None);
    }

    #[test]
    fn the_serialised_shape_matches_what_the_react_side_reads() {
        let session = normalize_session(&session_value()).expect("valid");
        let json = serde_json::to_value(&session).expect("serialisable");

        assert_eq!(json["sessionToken"], "session-abc");
        assert_eq!(json["orgId"], "org-1");
        assert_eq!(json["savedAtMs"], 1_700_000_000_000i64);
        assert_eq!(json["organizations"][0]["type"], "organization");
        assert_eq!(json["user"]["email"], "cole@example.com");
    }

    #[test]
    fn a_session_survives_a_round_trip_through_json() {
        let session = normalize_session(&session_value()).expect("valid");
        let encoded = serde_json::to_value(&session).expect("serialisable");

        assert_eq!(normalize_session(&encoded), Some(session));
    }

    #[test]
    fn the_login_url_matches_the_electron_one() {
        assert_eq!(
            build_login_url("https://present.multivrs.space").expect("url"),
            "https://present.multivrs.space/sign-in?source=desktop&client=electron\
             &flow=external-browser&next=%2Fauth%2Fdesktop%2Fcallback"
        );
    }

    #[test]
    fn a_trailing_slash_on_the_base_url_does_not_double_up() {
        assert_eq!(
            build_refresh_url("http://localhost:3001/").expect("url"),
            "http://localhost:3001/api/auth/desktop/refresh-session"
        );
    }

    #[test]
    fn an_empty_base_url_is_refused_rather_than_producing_a_bad_request() {
        assert!(build_login_url("   ").is_err());
        assert!(build_refresh_url("").is_err());
    }

    #[test]
    fn redirects_resolve_the_way_the_url_constructor_does() {
        let current = "https://present.app/api/auth/desktop/refresh-session";

        assert_eq!(
            resolve_redirect(current, "https://other.example/x"),
            "https://other.example/x"
        );
        assert_eq!(
            resolve_redirect(current, "/api/v2/refresh"),
            "https://present.app/api/v2/refresh"
        );
        assert_eq!(
            resolve_redirect(current, "refresh-v2"),
            "https://present.app/api/auth/desktop/refresh-v2"
        );
    }

    #[test]
    fn a_missing_session_token_is_refused_without_a_network_call() {
        let outcome = tauri::async_runtime::block_on(refresh_session(&[], "   ")).expect("handled");

        match outcome {
            RefreshOutcome::Failed { status, error, .. } => {
                assert_eq!(status, 400);
                assert_eq!(error, "Missing session token");
            }
            RefreshOutcome::Ok { .. } => panic!("an empty token must not be accepted"),
        }
    }

    #[test]
    fn the_refresh_outcome_serialises_the_way_the_react_side_branches_on_it() {
        let ok = serde_json::to_value(RefreshOutcome::success(serde_json::json!({ "token": "x" })))
            .expect("serialisable");
        assert_eq!(ok["ok"], true);
        assert_eq!(ok["data"]["token"], "x");

        let failed =
            serde_json::to_value(RefreshOutcome::failure(401, "nope")).expect("serialisable");
        assert_eq!(failed["ok"], false);
        assert_eq!(failed["status"], 401);
        assert_eq!(failed["error"], "nope");
    }
    #[test]
    fn a_development_sign_in_names_where_to_come_back_to() {
        let url = build_login_url_returning_to(
            "http://localhost:3001",
            Some("http://127.0.0.1:52341/auth"),
        )
        .expect("a url");
        assert!(
            url.starts_with("http://localhost:3001/sign-in?"),
            "the local web app: {url}"
        );
        assert!(
            url.contains("next=%2Fauth%2Fdesktop%2Fcallback%3Fredirect%3Dhttp%253A%252F%252F127.0.0.1%253A52341%252Fauth"),
            "and the address it should hand the session to: {url}"
        );
    }

    #[test]
    fn a_packaged_sign_in_is_exactly_what_it_was() {
        assert_eq!(
            build_login_url("https://present.multivrs.space").expect("a url"),
            build_login_url_returning_to("https://present.multivrs.space", None).expect("a url"),
        );
    }
}
