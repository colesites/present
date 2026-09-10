//! `present://` deep links.
//!
//! Ports `handleDeepLink` (`main.window.ts:24-73`) and the three places Electron
//! feeds it from: `open-url` on macOS, `argv` on first launch, and the
//! second-instance callback on Windows and Linux.
//!
//! The parsing is the same, and so is the event the frontend receives —
//! `auth-callback` with `{ accessToken, sessionToken }`. What the desktop then
//! *does* with those tokens is auth, which is Stage 7; this module only carries
//! the link from the OS to the window.
//!
//! A link can arrive before the operator window has a listener attached: the OS
//! launches the app *because* of the link, so the webview does not exist yet.
//! Electron handles that with a `pendingDeepLink` field re-fired on
//! `did-finish-load`. Here the pending link is held in Rust and collected by the
//! frontend as it installs its listener, which removes the load-timing race
//! rather than reproducing it.

use std::sync::Mutex;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager};

use crate::services::window_spec::WindowRole;

/// The channel `App.tsx:212` already listens on.
pub const AUTH_CALLBACK_EVENT: &str = "auth-callback";

/// `DesktopAuthPayload` in `src/shared/types/electron.d.ts:29-32`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AuthPayload {
    pub access_token: Option<String>,
    pub session_token: String,
}

/// A link that arrived before anything was listening.
#[derive(Default)]
pub struct PendingDeepLink(Mutex<Option<AuthPayload>>);

impl PendingDeepLink {
    pub fn new() -> Self {
        Self::default()
    }

    fn store(&self, payload: AuthPayload) {
        *self.lock() = Some(payload);
    }

    /// Read and clear. A deep link is a one-shot: delivering it twice would
    /// re-run a sign-in the operator already completed.
    pub fn take(&self) -> Option<AuthPayload> {
        self.lock().take()
    }

    fn lock(&self) -> std::sync::MutexGuard<'_, Option<AuthPayload>> {
        self.0
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }
}

/// Handle one `present://` URL.
pub fn handle(app: &AppHandle, url: &str) {
    // The URL carries a session token, so only the scheme is logged. Electron
    // logs `url.split('?')[0]` for the same reason (`main.window.ts:26`).
    tracing::info!(
        route = %url.split('?').next().unwrap_or(""),
        "deep link received"
    );

    if let Some(window) = app.get_webview_window(WindowRole::Main.label()) {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }

    let Some(payload) = parse(url) else {
        return;
    };

    let delivered = app
        .get_webview_window(WindowRole::Main.label())
        .map(|window| window.emit(AUTH_CALLBACK_EVENT, &payload).is_ok())
        .unwrap_or(false);

    // Held either way: the window may exist while its React listener does not,
    // which is precisely the case Electron's `did-finish-load` re-fire covers.
    // The frontend clears this as it subscribes.
    if let Some(state) = app.try_state::<PendingDeepLink>() {
        state.store(payload);
    } else {
        tracing::error!("deep link arrived before state was registered");
    }

    if !delivered {
        tracing::info!("deep link held until the operator window is listening");
    }
}

/// Pull the auth tokens out of a `present://` URL.
///
/// Accepts every shape `main.window.ts:34-52` does: the route may be the host
/// (`present://auth?…`) or the path (`present:///auth?…`), and either parameter
/// name of each pair is honoured.
pub fn parse(url: &str) -> Option<AuthPayload> {
    let rest = url.strip_prefix("present://")?;
    let (route_and_path, query) = match rest.split_once('?') {
        Some((head, query)) => (head, query),
        None => (rest, ""),
    };

    // `present://open` and a bare `present://` are "just bring the app forward".
    let route = route_and_path.trim_end_matches('/');
    if route.is_empty() || route == "open" {
        return None;
    }
    if !route_and_path.contains("auth") {
        return None;
    }

    let mut session_token = None;
    let mut access_token = None;
    for (key, value) in query_pairs(query) {
        match key.as_str() {
            "sessionToken" | "refreshToken" if session_token.is_none() => {
                session_token = Some(value)
            }
            "accessToken" | "token" if access_token.is_none() => access_token = Some(value),
            _ => {}
        }
    }

    Some(AuthPayload {
        session_token: session_token?,
        access_token,
    })
}

fn query_pairs(query: &str) -> impl Iterator<Item = (String, String)> + '_ {
    query
        .split('&')
        .filter(|pair| !pair.is_empty())
        .map(|pair| {
            let (key, value) = pair.split_once('=').unwrap_or((pair, ""));
            (decode_component(key), decode_component(value))
        })
}

/// `URLSearchParams` decoding: percent escapes, and `+` for a space.
fn decode_component(value: &str) -> String {
    let bytes = value.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut index = 0;

    while index < bytes.len() {
        match bytes[index] {
            b'+' => {
                out.push(b' ');
                index += 1;
            }
            b'%' if index + 2 < bytes.len() => {
                let hex = std::str::from_utf8(&bytes[index + 1..index + 3]).ok();
                match hex.and_then(|hex| u8::from_str_radix(hex, 16).ok()) {
                    Some(byte) => {
                        out.push(byte);
                        index += 3;
                    }
                    None => {
                        out.push(bytes[index]);
                        index += 1;
                    }
                }
            }
            byte => {
                out.push(byte);
                index += 1;
            }
        }
    }

    String::from_utf8_lossy(&out).into_owned()
}

/// The `present://` URL in a command line, if there is one.
/// Ports `main/index.ts:83-87` and `main.window.ts:273-276`.
pub fn find_in_args<I, S>(args: I) -> Option<String>
where
    I: IntoIterator<Item = S>,
    S: AsRef<str>,
{
    args.into_iter()
        .map(|arg| arg.as_ref().to_owned())
        .find(|arg| arg.starts_with("present://"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn an_auth_link_yields_both_tokens() {
        let payload = parse("present://auth?sessionToken=abc&accessToken=def").expect("parsed");
        assert_eq!(payload.session_token, "abc");
        assert_eq!(payload.access_token.as_deref(), Some("def"));
    }

    #[test]
    fn the_alternate_parameter_names_are_accepted() {
        let payload = parse("present://auth?refreshToken=abc&token=def").expect("parsed");
        assert_eq!(payload.session_token, "abc");
        assert_eq!(payload.access_token.as_deref(), Some("def"));
    }

    #[test]
    fn the_route_may_be_a_path_instead_of_a_host() {
        let payload = parse("present:///auth/callback?sessionToken=abc").expect("parsed");
        assert_eq!(payload.session_token, "abc");
    }

    #[test]
    fn an_access_token_is_optional() {
        let payload = parse("present://auth?sessionToken=abc").expect("parsed");
        assert_eq!(payload.access_token, None);
    }

    #[test]
    fn a_link_with_no_session_token_carries_nothing_to_deliver() {
        assert_eq!(parse("present://auth?accessToken=def"), None);
    }

    #[test]
    fn the_open_route_only_brings_the_app_forward() {
        assert_eq!(parse("present://open"), None);
        assert_eq!(parse("present://"), None);
        assert_eq!(parse("present:///"), None);
    }

    #[test]
    fn another_scheme_is_ignored() {
        assert_eq!(parse("https://present.app/auth?sessionToken=abc"), None);
    }

    #[test]
    fn token_values_are_percent_decoded() {
        let payload =
            parse("present://auth?sessionToken=a%2Bb%2Fc%3D%3D&accessToken=x+y").expect("parsed");
        assert_eq!(payload.session_token, "a+b/c==");
        assert_eq!(payload.access_token.as_deref(), Some("x y"));
    }

    #[test]
    fn a_pending_link_is_delivered_once() {
        let pending = PendingDeepLink::new();
        pending.store(AuthPayload {
            session_token: "abc".to_owned(),
            access_token: None,
        });

        assert!(pending.take().is_some());
        assert!(pending.take().is_none(), "a deep link must not replay");
    }

    #[test]
    fn a_deep_link_is_found_among_launch_arguments() {
        assert_eq!(
            find_in_args([
                "/Applications/Present.app",
                "present://auth?sessionToken=abc"
            ]),
            Some("present://auth?sessionToken=abc".to_owned())
        );
        assert_eq!(find_in_args(["/Applications/Present.app"]), None);
    }
}
