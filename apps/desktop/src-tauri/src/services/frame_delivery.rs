//! How a frame the webview asks for is answered: the operator's preview
//! (`output-frame://`) and the panels' videos (`media-frame://`).
//!
//! A panel shows a frame some time after it was drawn: the request, the JPEG,
//! the decode, the next paint. Shown as drawn, the picture is that much behind
//! the sound and the audience screen. So each answer says how old its frame
//! already is (`X-Frame-Age-Ms`), the panel works out how late its frames
//! reach the screen, and says so on its next request (`lead`); the frames
//! drawn for it from then on are the ones due when they will be seen.
//!
//! An answer also carries the frame's number (`X-Frame-Seq`). A panel that
//! already has the newest gets an empty answer rather than the same JPEG
//! again, which a paused video would otherwise send sixty times a second.

use std::sync::Arc;
use std::time::{Duration, Instant};

use tauri::http;

/// The most a panel may ask to be drawn ahead.
pub const MAX_LEAD: Duration = Duration::from_millis(250);

/// A frame, ready to send.
#[derive(Clone)]
pub struct Latest {
    pub jpeg: Arc<Vec<u8>>,
    /// When it was drawn.
    pub at: Instant,
    /// Counts up with each new frame.
    pub seq: u64,
}

static SEQ: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);

/// A number for a new frame: never one a panel already has, even from a
/// player that stopped and started again.
pub fn next_seq() -> u64 {
    SEQ.fetch_add(1, std::sync::atomic::Ordering::Relaxed) + 1
}

/// A number from the request's query string.
pub fn query_number(uri: &str, name: &str) -> Option<u64> {
    let query = uri.split_once('?').map(|(_, rest)| rest)?;
    query
        .split('&')
        .filter_map(|pair| pair.split_once('='))
        .find(|(key, _)| *key == name)
        .and_then(|(_, value)| value.parse::<u64>().ok())
}

/// How far ahead the request asks to be drawn.
pub fn lead_from_uri(uri: &str) -> Duration {
    query_number(uri, "lead")
        .map(Duration::from_millis)
        .unwrap_or_default()
        .min(MAX_LEAD)
}

/// The answer: the newest frame; an empty one marked `X-Frame-Same` when the
/// panel already has it; or an empty one while there is none yet.
pub fn respond(latest: Option<Latest>, uri: &str) -> http::Response<Vec<u8>> {
    // Same origin rules as the media protocol. The headers are exposed: the
    // panel reads them through `fetch`.
    let builder = http::Response::builder()
        .header("Cache-Control", "no-store")
        .header("Access-Control-Allow-Origin", "*")
        .header(
            "Access-Control-Expose-Headers",
            "X-Frame-Age-Ms, X-Frame-Seq, X-Frame-Same",
        );
    let after = query_number(uri, "after");
    match latest {
        Some(latest) if after == Some(latest.seq) => builder
            .status(204)
            .header("X-Frame-Same", "1")
            .header("X-Frame-Seq", latest.seq.to_string())
            .body(Vec::new()),
        Some(latest) => builder
            .status(200)
            .header("Content-Type", "image/jpeg")
            .header(
                "X-Frame-Age-Ms",
                latest.at.elapsed().as_millis().to_string(),
            )
            .header("X-Frame-Seq", latest.seq.to_string())
            .body(latest.jpeg.as_ref().clone()),
        None => builder.status(204).body(Vec::new()),
    }
    .unwrap_or_else(|_| http::Response::new(Vec::new()))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn latest(seq: u64) -> Latest {
        Latest {
            jpeg: Arc::new(vec![1, 2, 3]),
            at: Instant::now(),
            seq,
        }
    }

    #[test]
    fn a_panel_that_has_the_newest_frame_is_not_sent_it_again() {
        let fresh = respond(Some(latest(7)), "media-frame://frame/a?after=6");
        assert_eq!(fresh.status(), 200);
        assert_eq!(fresh.headers()["X-Frame-Seq"], "7");
        assert!(fresh.headers().contains_key("X-Frame-Age-Ms"));
        let same = respond(Some(latest(7)), "media-frame://frame/a?after=7");
        assert_eq!(same.status(), 204);
        assert_eq!(same.headers()["X-Frame-Same"], "1");
        assert!(same.body().is_empty());
        assert_eq!(respond(None, "media-frame://frame/a").status(), 204);
    }

    #[test]
    fn the_lead_asked_for_is_kept_sane() {
        assert_eq!(
            lead_from_uri("x://f?lead=40&t=1"),
            Duration::from_millis(40)
        );
        assert_eq!(lead_from_uri("x://f?lead=9000"), MAX_LEAD);
        assert_eq!(lead_from_uri("x://f?t=1"), Duration::ZERO);
    }
}
