//! The operator's preview frames, and the `output-frame://` response.
//!
//! **Nothing is drawn on the request's thread.** The first ask starts a loop
//! that draws as fast as the output does and keeps the newest frame on hand;
//! a request takes whatever is there and returns. Drawing per request meant
//! the video advanced only as often as the webview asked — twenty times a
//! second for a thirty frame video — which is a skip built into the design,
//! and it put a decode and a JPEG encode in front of every answer.
//!
//! The loop stops on its own once nobody has asked for a while, so a machine
//! whose operator never opens the preview draws nothing.

use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use tauri::http;
use tauri::AppHandle;

use crate::services::preview::{self, PreviewSource};

/// How often the loop draws. The output's own rate: a preview that skips is
/// not a preview of what the congregation is seeing.
const FRAME_EVERY: Duration = Duration::from_micros(16_667);

/// How long the loop keeps drawing after the last request.
///
/// Longer than any hiccup in the webview's asking, short enough that a
/// preview nobody is looking at stops costing anything.
const KEEP_DRAWING_FOR: Duration = Duration::from_secs(2);

#[derive(Default)]
pub struct PreviewState {
    shared: Arc<Shared>,
    running: Arc<Mutex<bool>>,
}

#[derive(Default)]
struct Shared {
    /// The newest frame, as JPEG. `Arc` so a request clones a pointer.
    latest: Mutex<Option<Arc<Vec<u8>>>>,
    /// The size asked for, packed as two `u32`s so the loop can read it
    /// without waiting for a lock a request might be holding.
    wanted: AtomicU64,
    /// When the last request came in, as milliseconds since the loop started.
    asked_at: Mutex<Option<Instant>>,
    stop: AtomicBool,
}

impl Shared {
    fn wanted_size(&self) -> (u32, u32) {
        let packed = self.wanted.load(Ordering::Relaxed);
        (((packed >> 32) & 0xffff_ffff) as u32, (packed & 0xffff_ffff) as u32)
    }

    fn want(&self, size: (u32, u32)) {
        self.wanted
            .store((u64::from(size.0) << 32) | u64::from(size.1), Ordering::Relaxed);
    }
}

impl PreviewState {
    pub fn new() -> Self {
        Self::default()
    }

    /// The newest frame, and a promise to keep drawing.
    pub fn frame(&self, app: &AppHandle, size: (u32, u32)) -> Option<Arc<Vec<u8>>> {
        self.shared.want(size);
        *self
            .shared
            .asked_at
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner()) = Some(Instant::now());
        self.ensure_drawing(app);
        self.shared
            .latest
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .clone()
    }

    /// Start the loop if it is not already running.
    fn ensure_drawing(&self, app: &AppHandle) {
        let mut running = self
            .running
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        if *running {
            return;
        }
        *running = true;
        self.shared.stop.store(false, Ordering::Relaxed);

        let shared = Arc::clone(&self.shared);
        let still_running = Arc::clone(&self.running);
        let app = app.clone();
        // A thread of its own, not the async pool: it draws for as long as
        // somebody is looking, which is not what a pool's tasks are for.
        std::thread::Builder::new()
            .name("present-preview".to_owned())
            .spawn(move || {
                // Whatever ends the loop — idle, a stop, a panic — the state
                // has to hear about it, or nothing ever starts it again and
                // the preview stays dark for the rest of the run.
                let _running = Running(still_running);
                draw_until_idle(&app, &shared);
            })
            .map(|_| ())
            .unwrap_or_else(|error| {
                tracing::warn!(%error, "the preview could not start drawing");
                *running = false;
            });
    }

    /// Let go of the compositor, any video it has open, and the loop.
    pub fn release(&self) {
        self.shared.stop.store(true, Ordering::Relaxed);
    }

    #[cfg(test)]
    fn is_running(&self) -> bool {
        *self
            .running
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }
}

/// Marks the loop stopped however it ends.
struct Running(Arc<Mutex<bool>>);

impl Drop for Running {
    fn drop(&mut self) {
        *self.0.lock().unwrap_or_else(|poisoned| poisoned.into_inner()) = false;
    }
}

fn draw_until_idle(app: &AppHandle, shared: &Shared) {
    let mut source = PreviewSource::new(app.clone());
    loop {
        let started = Instant::now();
        if shared.stop.load(Ordering::Relaxed) {
            break;
        }
        let asked_at = *shared
            .asked_at
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        match asked_at {
            Some(at) if at.elapsed() < KEEP_DRAWING_FOR => {}
            // Nobody is looking.
            _ => break,
        }

        let size = shared.wanted_size();
        if size.0 > 0 && size.1 > 0 {
            match source.frame(size) {
                Ok(picture) => {
                    let drew = started.elapsed();
                    let frame = Arc::new(picture.to_vec());
                    tracing::trace!(?drew, bytes = frame.len(), "preview frame");
                    *shared
                        .latest
                        .lock()
                        .unwrap_or_else(|poisoned| poisoned.into_inner()) = Some(frame);
                }
                Err(error) => {
                    tracing::debug!(%error, "no preview frame this time");
                }
            }
        }

        // Whatever is left of this frame's time. Drawing took longer than the
        // frame: go straight on to the next one rather than falling further
        // behind by sleeping.
        if let Some(rest) = FRAME_EVERY.checked_sub(started.elapsed()) {
            std::thread::sleep(rest);
        }
    }

    *shared
        .latest
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner()) = None;
}

/// The size asked for in `?w=` and `?h=`, whatever the query looks like.
pub fn size_from_uri(uri: &str) -> (u32, u32) {
    let query = uri.split_once('?').map(|(_, rest)| rest).unwrap_or("");
    let number = |name: &str| {
        query
            .split('&')
            .filter_map(|pair| pair.split_once('='))
            .find(|(key, _)| *key == name)
            .and_then(|(_, value)| value.parse::<u32>().ok())
    };
    preview::requested_size(number("w"), number("h"))
}

/// The `output-frame://frame/audience?w=&h=&t=` response.
///
/// 204 while the loop has not drawn its first frame yet, and not 500: the
/// preview is a picture of what is already on screen elsewhere, so the honest
/// answer to "not yet" is to show nothing and let the next request try again.
pub fn respond(state: &PreviewState, app: &AppHandle, uri: &str) -> http::Response<Vec<u8>> {
    // Same origin rules as the media protocol: a preview frame is a picture
    // this app drew for itself, and a canvas that reads it — a test, a
    // thumbnail — should not be tainted by it.
    let builder = http::Response::builder()
        .header("Cache-Control", "no-store")
        .header("Access-Control-Allow-Origin", "*");
    match state.frame(app, size_from_uri(uri)) {
        Some(picture) => builder
            .status(200)
            .header("Content-Type", "image/jpeg")
            .body(picture.as_ref().clone()),
        None => builder.status(204).body(Vec::new()),
    }
    .unwrap_or_else(|_| http::Response::new(Vec::new()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_size_comes_from_the_query_and_is_kept_sane() {
        assert_eq!(
            size_from_uri("output-frame://frame/audience?w=480&h=270&t=12"),
            (480, 270)
        );
        assert_eq!(
            size_from_uri("output-frame://frame/audience?t=12"),
            (640, 360),
            "a request that says nothing still gets a picture"
        );
        assert_eq!(
            size_from_uri("output-frame://frame/audience?w=abc&h=-4"),
            (640, 360),
            "nonsense is not a size"
        );
        assert_eq!(
            size_from_uri("output-frame://frame/audience?w=99999&h=99999"),
            (preview::MAX_SIDE, preview::MAX_SIDE)
        );
        assert_eq!(size_from_uri("output-frame://frame/audience"), (640, 360));
    }

    #[test]
    fn a_size_survives_the_trip_through_the_atomic() {
        let shared = Shared::default();
        shared.want((3840, 2160));
        assert_eq!(shared.wanted_size(), (3840, 2160));
        shared.want((1, 1));
        assert_eq!(shared.wanted_size(), (1, 1));
    }

    #[test]
    fn nothing_is_drawn_until_somebody_asks() {
        let state = PreviewState::new();
        assert!(!state.is_running(), "no loop, no compositor, no video open");
    }
}
