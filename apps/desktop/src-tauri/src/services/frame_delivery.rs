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
//! already has the newest is answered when the next frame is ready, or after
//! [`WAIT_FOR_NEW`] with an empty answer — not the same JPEG again, and not
//! "nothing new" at once, which had a paused video's panel ask a hundred and
//! fifty times a second. How long it was kept waiting comes back too
//! (`X-Frame-Waited-Ms`), so the panel does not count it as travel.

use std::sync::{Arc, Condvar, Mutex};
use std::time::{Duration, Instant};

use tauri::http;

/// The most a panel may ask to be drawn ahead.
pub const MAX_LEAD: Duration = Duration::from_millis(250);

/// The longest a request for a newer frame is kept waiting for one: a held
/// video's panel asks four times a second rather than a hundred and fifty.
pub const WAIT_FOR_NEW: Duration = Duration::from_millis(250);

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

/// The newest frame in `latest` — once it is not `after`, the one the panel
/// already shows, or once [`WAIT_FOR_NEW`] has passed. `fresh` is told when
/// `latest` changes.
pub fn newer_than(
    latest: &Mutex<Option<Latest>>,
    fresh: &Condvar,
    after: Option<u64>,
) -> Option<Latest> {
    let mut current = latest
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    let Some(after) = after else {
        return current.clone();
    };
    let deadline = Instant::now() + WAIT_FOR_NEW;
    while current.as_ref().is_some_and(|frame| frame.seq == after) {
        let Some(left) = deadline.checked_duration_since(Instant::now()) else {
            break;
        };
        current = fresh
            .wait_timeout(current, left)
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .0;
    }
    current.clone()
}

/// The answer: the newest frame; an empty one marked `X-Frame-Same` when the
/// panel already has it; or an empty one while there is none yet. `waited` is
/// how long the request was held for a newer frame.
pub fn respond(latest: Option<Latest>, uri: &str, waited: Duration) -> http::Response<Vec<u8>> {
    // Same origin rules as the media protocol. The headers are exposed: the
    // panel reads them through `fetch`.
    let builder = http::Response::builder()
        .header("Cache-Control", "no-store")
        .header("Access-Control-Allow-Origin", "*")
        .header(
            "Access-Control-Expose-Headers",
            "X-Frame-Age-Ms, X-Frame-Seq, X-Frame-Same, X-Frame-Waited-Ms",
        )
        .header("X-Frame-Waited-Ms", waited.as_millis().to_string());
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
        let fresh = respond(
            Some(latest(7)),
            "media-frame://frame/a?after=6",
            Duration::ZERO,
        );
        assert_eq!(fresh.status(), 200);
        assert_eq!(fresh.headers()["X-Frame-Seq"], "7");
        assert!(fresh.headers().contains_key("X-Frame-Age-Ms"));
        let same = respond(
            Some(latest(7)),
            "media-frame://frame/a?after=7",
            WAIT_FOR_NEW,
        );
        assert_eq!(same.status(), 204);
        assert_eq!(same.headers()["X-Frame-Same"], "1");
        assert!(same.body().is_empty());
        assert_eq!(same.headers()["X-Frame-Waited-Ms"], "250");
        assert_eq!(
            respond(None, "media-frame://frame/a", Duration::ZERO).status(),
            204
        );
    }

    #[test]
    fn a_panel_with_the_newest_frame_waits_for_the_next_rather_than_asking_again() {
        let latest_frame = Arc::new(Mutex::new(Some(latest(3))));
        let fresh = Arc::new(Condvar::new());
        // Not waiting: it has never had one.
        assert_eq!(
            newer_than(&latest_frame, &fresh, None).map(|frame| frame.seq),
            Some(3)
        );
        // A new frame arrives while it waits.
        let (publisher_frame, publisher_fresh) = (Arc::clone(&latest_frame), Arc::clone(&fresh));
        let publisher = std::thread::spawn(move || {
            std::thread::sleep(Duration::from_millis(30));
            *publisher_frame.lock().unwrap() = Some(latest(4));
            publisher_fresh.notify_all();
        });
        let started = Instant::now();
        let next = newer_than(&latest_frame, &fresh, Some(3));
        publisher.join().unwrap();
        assert_eq!(next.map(|frame| frame.seq), Some(4));
        assert!(
            started.elapsed() < WAIT_FOR_NEW,
            "answered as soon as it came"
        );
        // Nothing new: answered with what there is, once the wait is up.
        let started = Instant::now();
        let same = newer_than(&latest_frame, &fresh, Some(4));
        assert_eq!(same.map(|frame| frame.seq), Some(4));
        assert!(started.elapsed() >= WAIT_FOR_NEW);
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
