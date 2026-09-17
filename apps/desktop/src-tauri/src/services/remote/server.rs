//! The remote's server: a page, an action, and a live view.
//!
//! Small on purpose. Four routes, one token, and no state of its own — what
//! the phone shows is read from the same output state the audience screen is
//! drawn from, and what it presses goes through `control::dispatch`, so a
//! phone, a pedal and a click are the same thing happening.

use std::net::{IpAddr, SocketAddr};
use std::sync::Arc;

use axum::extract::ws::{Message, WebSocket, WebSocketUpgrade};
use axum::extract::{Query, State};
use axum::http::StatusCode;
use axum::response::{Html, IntoResponse, Response};
use axum::routing::{get, post};
use axum::{Json, Router};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};
use tokio::sync::oneshot;

use super::{page, RemoteConfig};
use crate::services::control::{self, Action};
use crate::state::OutputState;

/// How often the live view looks for a change. Five times a second is well
/// under what a person notices, and costs nothing while nothing changes.
const LOOK_EVERY: std::time::Duration = std::time::Duration::from_millis(200);

/// What the phone shows.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RemoteView {
    /// The words on the audience screen, or `None` when there are none.
    pub slide_text: Option<String>,
}

/// What the audience screen is showing, as the phone should see it.
pub fn view_of(app: &AppHandle) -> RemoteView {
    // `try_state`, never `state`: a phone can connect while the app starts.
    let Some(output) = app.try_state::<OutputState>() else {
        return RemoteView::default();
    };
    let scene = output.on_screen();
    RemoteView {
        // What is on the screen, not what is queued: hidden words are not on it.
        slide_text: scene
            .slide_text
            .filter(|text| !text.trim().is_empty())
            .filter(|_| scene.show_text),
    }
}

#[derive(Clone)]
struct Remote {
    app: AppHandle,
    token: Arc<str>,
}

#[derive(Deserialize)]
struct Join {
    /// The token, which every route asks for.
    t: Option<String>,
}

impl Remote {
    /// Whether a request carries this run's token.
    fn allows(&self, join: &Join) -> bool {
        join.t.as_deref().is_some_and(|given| {
            // Same length and same bytes, compared whole: a token is not worth
            // leaking a character at a time.
            let (given, token) = (given.as_bytes(), self.token.as_bytes());
            given.len() == token.len()
                && given
                    .iter()
                    .zip(token)
                    .fold(0u8, |so_far, (a, b)| so_far | (a ^ b))
                    == 0
        })
    }
}

/// A running remote. Dropping it stops the server.
pub struct RemoteServer {
    stop: Option<oneshot::Sender<()>>,
    pub address: SocketAddr,
    pub token: String,
}

impl RemoteServer {
    /// Serve on `config`'s port, on every address this machine has.
    ///
    /// The whole network, not localhost: the phone is not this computer.
    pub fn start(app: AppHandle, config: &RemoteConfig, token: String) -> Result<Self, String> {
        if token.is_empty() {
            return Err("this machine would not give out a token".to_owned());
        }
        let runtime = tauri::async_runtime::handle();
        let listener = std::net::TcpListener::bind(("0.0.0.0", config.port))
            .map_err(|error| format!("Could not listen on port {}. {error}", config.port))?;
        listener
            .set_nonblocking(true)
            .map_err(|error| error.to_string())?;
        let address = listener.local_addr().map_err(|error| error.to_string())?;

        let remote = Remote {
            app,
            token: Arc::from(token.as_str()),
        };
        let router = Router::new()
            .route("/", get(serve_page))
            .route("/api/state", get(serve_state))
            .route("/api/action", post(take_action))
            .route("/ws", get(open_live_view))
            .with_state(remote);

        let (stop, stopped) = oneshot::channel();
        runtime.spawn(async move {
            let listener = match tokio::net::TcpListener::from_std(listener) {
                Ok(listener) => listener,
                Err(error) => {
                    tracing::warn!(%error, "the remote could not take its socket");
                    return;
                }
            };
            let served = axum::serve(listener, router)
                .with_graceful_shutdown(async {
                    let _ = stopped.await;
                })
                .await;
            if let Err(error) = served {
                tracing::warn!(%error, "the remote stopped");
            }
        });
        tracing::info!(port = address.port(), "the phone remote is listening");
        let server = Self {
            stop: Some(stop),
            address,
            token,
        };
        // At debug, because it carries the token: worth having when somebody
        // asks why their phone cannot find it, not worth writing down always.
        if let Some(url) = server.join_url() {
            tracing::debug!(url, "the phone remote can be joined here");
        }
        Ok(server)
    }

    /// The address a phone should open, when this machine knows one.
    pub fn join_url(&self) -> Option<String> {
        super::local_address()
            .map(|address| super::join_url(address, self.address.port(), &self.token))
    }
}

impl Drop for RemoteServer {
    fn drop(&mut self) {
        if let Some(stop) = self.stop.take() {
            let _ = stop.send(());
        }
    }
}

/// Anything without the token is told nothing at all — not that it was wrong,
/// not that there is a remote here.
fn refused() -> Response {
    (StatusCode::NOT_FOUND, "Not found").into_response()
}

async fn serve_page(State(remote): State<Remote>, Query(join): Query<Join>) -> Response {
    if !remote.allows(&join) {
        return refused();
    }
    Html(page::html(&remote.token)).into_response()
}

async fn serve_state(State(remote): State<Remote>, Query(join): Query<Join>) -> Response {
    if !remote.allows(&join) {
        return refused();
    }
    Json(view_of(&remote.app)).into_response()
}

async fn take_action(
    State(remote): State<Remote>,
    Query(join): Query<Join>,
    Json(action): Json<Action>,
) -> Response {
    if !remote.allows(&join) {
        return refused();
    }
    control::dispatch(&remote.app, &action, "remote");
    StatusCode::NO_CONTENT.into_response()
}

async fn open_live_view(
    State(remote): State<Remote>,
    Query(join): Query<Join>,
    upgrade: WebSocketUpgrade,
) -> Response {
    if !remote.allows(&join) {
        return refused();
    }
    upgrade.on_upgrade(move |socket| live_view(socket, remote.app))
}

/// Send what is on the screen, and again whenever it changes.
async fn live_view(mut socket: WebSocket, app: AppHandle) {
    let mut sent: Option<RemoteView> = None;
    loop {
        let view = view_of(&app);
        if sent.as_ref() != Some(&view) {
            let Ok(text) = serde_json::to_string(&view) else {
                return;
            };
            if socket.send(Message::Text(text.into())).await.is_err() {
                // The phone went away: its page reconnects by itself.
                return;
            }
            sent = Some(view);
        }
        tokio::time::sleep(LOOK_EVERY).await;
    }
}

/// Tell the network the remote is here, for anything that looks for it.
///
/// The code on screen is how a person joins; this is for a companion app, and
/// for finding the address again when the phone has been asleep.
pub struct Announcement {
    daemon: Option<mdns_sd::ServiceDaemon>,
    full_name: String,
}

impl Announcement {
    pub fn start(address: IpAddr, port: u16) -> Option<Self> {
        let daemon = mdns_sd::ServiceDaemon::new().ok()?;
        let host = format!("present-{port}.local.");
        let service = mdns_sd::ServiceInfo::new(
            "_present._tcp.local.",
            "Present",
            &host,
            address,
            port,
            None,
        )
        .ok()?;
        let full_name = service.get_fullname().to_owned();
        daemon.register(service).ok()?;
        Some(Self {
            daemon: Some(daemon),
            full_name,
        })
    }
}

impl Drop for Announcement {
    fn drop(&mut self) {
        if let Some(daemon) = self.daemon.take() {
            let _ = daemon.unregister(&self.full_name);
            let _ = daemon.shutdown();
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn remote(token: &str) -> Join {
        Join {
            t: Some(token.to_owned()),
        }
    }

    /// `Remote::allows` without an `AppHandle`, which tests cannot make.
    fn allows(token: &str, join: &Join) -> bool {
        let given = join.t.as_deref();
        given.is_some_and(|given| {
            let (given, token) = (given.as_bytes(), token.as_bytes());
            given.len() == token.len()
                && given
                    .iter()
                    .zip(token)
                    .fold(0u8, |so_far, (a, b)| so_far | (a ^ b))
                    == 0
        })
    }

    #[test]
    fn only_the_token_on_the_code_gets_in() {
        let token = "0123456789abcdef0123456789abcdef";
        assert!(allows(token, &remote(token)));
        assert!(!allows(token, &remote("")));
        assert!(!allows(token, &remote("0123456789abcdef0123456789abcdee")));
        assert!(!allows(token, &remote("0123456789abcdef")), "a prefix");
        assert!(!allows(token, &Join { t: None }), "nothing at all");
    }

    #[test]
    fn the_phone_is_shown_what_the_audience_is_shown() {
        // The rule the view applies, without an app to read it from.
        let showing = |text: Option<&str>, show_text: bool| {
            text.map(str::to_owned)
                .filter(|text| !text.trim().is_empty())
                .filter(|_| show_text)
        };
        assert_eq!(
            showing(Some("Amazing grace"), true).as_deref(),
            Some("Amazing grace")
        );
        assert_eq!(
            showing(Some("Amazing grace"), false),
            None,
            "words switched off"
        );
        assert_eq!(showing(Some("   "), true), None, "nothing worth showing");
        assert_eq!(showing(None, true), None);
    }
}
