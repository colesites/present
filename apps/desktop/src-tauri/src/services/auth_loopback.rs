//! Taking the session back from the browser, in development.
//!
//! Signing in happens in the operator's own browser, and the browser hands the
//! session back through the `present://` link the web app opens. **On macOS a
//! URL scheme belongs to a bundle**, and `tauri dev` runs a bare binary rather
//! than one — so in development that link goes to whichever Present is
//! installed in `/Applications`, which is the wrong app, and the one being
//! worked on never signs in at all.
//!
//! So in development the browser is asked to come back to this machine
//! instead: a listener on the loopback address, on a port the operating system
//! picks, waiting for one request. It is how every desktop application that
//! signs in through a browser does it (RFC 8252 calls it the loopback
//! redirect), and it is only used when the sign-in page is told to use it.
//!
//! **One request, from this machine, then it is gone.** The listener takes the
//! first `/auth` it is given, hands the session to the same place a deep link
//! would, answers with a page saying the browser can be closed, and stops. It
//! also stops on its own after [`GIVE_UP_AFTER`], so a sign-in somebody
//! abandoned does not leave a socket open.

use std::io::{BufRead, BufReader, Write};
use std::net::{Ipv4Addr, SocketAddr, TcpListener, TcpStream};
use std::time::Duration;

use tauri::AppHandle;

use crate::services::deep_link;

/// How long the browser has to come back before the listener gives up.
const GIVE_UP_AFTER: Duration = Duration::from_secs(300);

/// How often the socket is asked whether the browser has arrived.
const ASK_AGAIN_IN: Duration = Duration::from_millis(100);

/// What the browser is shown when it arrives.
const DONE_PAGE: &str = "<!doctype html><meta charset=utf-8><title>Signed in</title>\
<body style=\"font:16px system-ui;background:#0b0d14;color:#e8eaf2;display:grid;\
place-items:center;height:100vh;margin:0\"><p>Signed in. You can close this tab.</p>";

/// Start listening, and give back the address the browser should return to.
///
/// `None` when a socket could not be opened, which is not worth failing a
/// sign-in over: the caller carries on without a redirect and the deep link is
/// used, as it is in a packaged build.
pub fn listen(app: &AppHandle) -> Option<String> {
    let listener = TcpListener::bind(SocketAddr::from((Ipv4Addr::LOCALHOST, 0)))
        .map_err(|error| tracing::warn!(%error, "could not listen for the sign-in to come back"))
        .ok()?;
    let port = listener.local_addr().ok()?.port();
    // Nothing waits on this socket, so it must be asked rather than waited on:
    // a blocking `accept` for a browser that never comes back would hold the
    // thread and the port for as long as the app runs.
    listener
        .set_nonblocking(true)
        .map_err(|error| tracing::warn!(%error, "the sign-in listener would not be polled"))
        .ok()?;

    let app = app.clone();
    std::thread::Builder::new()
        .name("present-sign-in".to_owned())
        .spawn(move || wait_for_one(&app, &listener))
        .map_err(|error| tracing::warn!(%error, "could not wait for the sign-in"))
        .ok()?;

    // The port only: what comes back to it is a session token, and that is
    // never written down.
    tracing::info!(port, "waiting for the sign-in to come back");
    Some(format!("http://127.0.0.1:{port}/auth"))
}

fn wait_for_one(app: &AppHandle, listener: &TcpListener) {
    // A deadline rather than a loop with a timeout: one request is all this is
    // for, and the operator who wandered off should not leave a port open.
    let deadline = std::time::Instant::now() + GIVE_UP_AFTER;

    while std::time::Instant::now() < deadline {
        let Ok((stream, from)) = listener.accept() else {
            // Nothing there yet — or something went wrong, which is the same
            // answer: ask again shortly rather than spin.
            std::thread::sleep(ASK_AGAIN_IN);
            continue;
        };
        // Loopback only. Nothing else can reach a 127.0.0.1 socket, and if
        // something has, it is not what this is for.
        if !from.ip().is_loopback() {
            continue;
        }
        if let Some(url) = serve_one(stream) {
            // Handed to exactly the same place the deep link goes, so a
            // session that arrived this way is a session like any other.
            deep_link::handle(app, &url);
            return;
        }
    }
    tracing::info!("nobody came back from signing in");
}

/// Read one request, answer it, and give back the session it carried.
///
/// Knows nothing about the app, so the conversation with the browser can be
/// held to a real socket in a test.
fn serve_one(mut stream: TcpStream) -> Option<String> {
    // Accepted from a socket that is being polled; reading it wants the
    // ordinary blocking behaviour back, with a limit in case the browser
    // stops halfway through its request.
    let _ = stream.set_nonblocking(false);
    let _ = stream.set_read_timeout(Some(Duration::from_secs(5)));
    let mut reader = BufReader::new(stream.try_clone().ok()?);
    let mut line = String::new();
    reader.read_line(&mut line).ok()?;

    // The rest of the request is read and thrown away before anything is
    // written back. A reply sent while the browser is still sending its
    // headers can arrive as a reset connection instead of a page, and the
    // operator is left looking at an error where the app has in fact signed
    // them in.
    let mut header = String::new();
    while reader.read_line(&mut header).is_ok_and(|read| read > 0) {
        if header.trim().is_empty() {
            break;
        }
        header.clear();
    }

    // "GET /auth?sessionToken=... HTTP/1.1"
    let target = line
        .split_whitespace()
        .nth(1)
        .unwrap_or_default()
        .to_owned();
    let carried = session_from(&target);

    let body = if carried.is_some() {
        DONE_PAGE
    } else {
        "<!doctype html><meta charset=utf-8><p>Nothing to sign in with."
    };
    let response = format!(
        "HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\n\
         Content-Length: {}\r\nConnection: close\r\n\r\n{body}",
        body.len()
    );
    let _ = stream.write_all(response.as_bytes());
    let _ = stream.flush();

    carried
}

/// The deep link this request stands for, if it carried a session.
///
/// Written as the `present://auth?...` the rest of the app already knows how
/// to read, so there is one way a session arrives and not two.
pub fn session_from(target: &str) -> Option<String> {
    let (path, query) = target.split_once('?')?;
    if path != "/auth" || query.is_empty() {
        return None;
    }
    let carries_session = query
        .split('&')
        .filter_map(|pair| pair.split_once('='))
        .any(|(key, value)| {
            matches!(key, "sessionToken" | "session_token" | "token") && !value.is_empty()
        });
    carries_session.then(|| format!("present://auth?{query}"))
}

#[cfg(test)]
mod tests {
    use std::io::Read;

    use super::*;

    /// The whole conversation, over a real socket: a browser that sends its
    /// request line and its headers separately, as a browser does, and reads
    /// the page back before the connection closes.
    #[test]
    fn the_browser_is_answered_and_the_session_is_read_off_the_request() {
        let listener =
            TcpListener::bind(SocketAddr::from((Ipv4Addr::LOCALHOST, 0))).expect("a socket");
        let address = listener.local_addr().expect("an address");

        let served = std::thread::spawn(move || {
            let (stream, _) = listener.accept().expect("a browser");
            serve_one(stream)
        });

        let mut client = TcpStream::connect(address).expect("connected");
        client
            .write_all(b"GET /auth?sessionToken=abc123 HTTP/1.1\r\n")
            .expect("the request line");
        client.flush().expect("flushed");
        client
            .write_all(b"Host: 127.0.0.1\r\nUser-Agent: a browser\r\n\r\n")
            .expect("the headers");

        let mut answer = String::new();
        client.read_to_string(&mut answer).expect("an answer");

        assert!(answer.starts_with("HTTP/1.1 200 OK"), "{answer}");
        assert!(
            answer.contains("You can close this tab"),
            "the operator is told they are done: {answer}"
        );
        assert_eq!(
            served.join().expect("served").as_deref(),
            Some("present://auth?sessionToken=abc123")
        );
    }

    /// Anything else still gets a reply — an unanswered request is a browser
    /// left hanging — and the listener keeps waiting for the real one.
    #[test]
    fn something_that_is_not_a_sign_in_is_answered_and_carries_nothing() {
        let listener =
            TcpListener::bind(SocketAddr::from((Ipv4Addr::LOCALHOST, 0))).expect("a socket");
        let address = listener.local_addr().expect("an address");

        let served = std::thread::spawn(move || {
            let (stream, _) = listener.accept().expect("a browser");
            serve_one(stream)
        });

        let mut client = TcpStream::connect(address).expect("connected");
        client
            .write_all(b"GET /favicon.ico HTTP/1.1\r\nHost: 127.0.0.1\r\n\r\n")
            .expect("the request");

        let mut answer = String::new();
        client.read_to_string(&mut answer).expect("an answer");

        assert!(answer.starts_with("HTTP/1.1 200 OK"), "{answer}");
        assert_eq!(served.join().expect("served"), None);
    }

    #[test]
    fn a_request_carrying_a_session_becomes_the_link_the_app_already_reads() {
        assert_eq!(
            session_from("/auth?sessionToken=abc123").as_deref(),
            Some("present://auth?sessionToken=abc123")
        );
        assert_eq!(
            session_from("/auth?sessionToken=abc&accessToken=xyz").as_deref(),
            Some("present://auth?sessionToken=abc&accessToken=xyz"),
            "everything it was given, in the order it was given"
        );
    }

    #[test]
    fn anything_else_is_not_a_sign_in() {
        for target in [
            "/auth",
            "/auth?",
            "/auth?sessionToken=",
            "/favicon.ico",
            "/",
            "/auth/../something?sessionToken=abc",
            "",
        ] {
            assert_eq!(session_from(target), None, "{target:?}");
        }
    }
}
