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
//!
//! One loop per audience screen asked for: each screen has its own colour,
//! and one added in Screen Configuration its own column of the live look, so
//! the operator's preview and Multiview's wall can each show a different one.

use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Condvar, Mutex};
use std::time::{Duration, Instant};

use tauri::http;
use tauri::AppHandle;

use crate::services::frame_delivery::{self, Latest};
use crate::services::preview::{self, PreviewSource};
use crate::services::screens;
use crate::services::surface::panel::NativePanel;
use crate::services::surface::tap;

/// How often the loop draws. The output's own rate: a preview that skips is
/// not a preview of what the congregation is seeing.
const FRAME_EVERY: Duration = Duration::from_micros(16_667);

/// How long the loop keeps drawing after the last request.
///
/// Longer than any hiccup in the webview's asking, short enough that a
/// preview nobody is looking at stops costing anything.
const KEEP_DRAWING_FOR: Duration = Duration::from_secs(2);

/// How long the largest size asked for is kept.
///
/// Long enough that a window being dragged is one size and not sixty, short
/// enough that a preview which shrank is being drawn at its own size again
/// within a moment.
const WIDEST_FOR: Duration = Duration::from_secs(3);

#[derive(Default)]
pub struct PreviewState {
    /// By audience screen id.
    loops: Mutex<HashMap<String, Loop>>,
}

/// One screen's drawing: what the requests and its loop share.
#[derive(Default, Clone)]
struct Loop {
    shared: Arc<Shared>,
    running: Arc<Mutex<bool>>,
}

#[derive(Default)]
struct Shared {
    /// The newest frame, as JPEG. `Arc` so a request clones a pointer.
    latest: Mutex<Option<Latest>>,
    /// Told when `latest` changes, for a request waiting on a new frame.
    fresh: Condvar,
    /// How far ahead to draw the video, in milliseconds: how late the
    /// preview's frames reach its screen (`frame_delivery`).
    lead_ms: AtomicU64,
    /// The size to draw at, packed as two `u32`s so the loop can read it
    /// without waiting for a lock a request might be holding.
    ///
    /// The **largest** asked for recently, not the latest. Two windows can
    /// show this preview at different sizes, and a panel changes size while it
    /// is dragged — and the video is opened for the size it is drawn at, so
    /// following every request meant reopening the decoder on every turn of
    /// the loop and never getting a frame out of it at all. One size, the
    /// biggest anyone wants, and the smaller ones scale it down themselves.
    wanted: AtomicU64,
    /// When the largest was last let go of, so a preview that shrank does not
    /// keep being drawn at the size it used to be.
    widest_since: Mutex<Option<Instant>>,
    /// When the last request came in, as milliseconds since the loop started.
    asked_at: Mutex<Option<Instant>>,
    stop: AtomicBool,
}

impl Shared {
    fn wanted_size(&self) -> (u32, u32) {
        let packed = self.wanted.load(Ordering::Relaxed);
        (
            ((packed >> 32) & 0xffff_ffff) as u32,
            (packed & 0xffff_ffff) as u32,
        )
    }

    /// Ask for a size. The largest asked for in the last [`WIDEST_FOR`] wins.
    fn want(&self, size: (u32, u32)) {
        let mut since = self
            .widest_since
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        let expired = since.is_none_or(|at| at.elapsed() >= WIDEST_FOR);
        let (width, height) = if expired {
            *since = Some(Instant::now());
            size
        } else {
            let (widest, tallest) = self.wanted_size();
            (widest.max(size.0), tallest.max(size.1))
        };
        self.wanted.store(
            (u64::from(width) << 32) | u64::from(height),
            Ordering::Relaxed,
        );
    }
}

impl PreviewState {
    pub fn new() -> Self {
        Self::default()
    }

    /// The newest frame of the audience screen `screen`, and a promise to
    /// keep drawing it.
    pub fn frame(
        &self,
        app: &AppHandle,
        screen: &str,
        size: (u32, u32),
        lead: Duration,
        after: Option<u64>,
    ) -> Option<Latest> {
        let drawing = self
            .loops
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .entry(screen.to_owned())
            .or_default()
            .clone();
        drawing.frame(app, screen, size, lead, after)
    }

    /// Let go of the compositors, any video they have open, and the loops.
    pub fn release(&self) {
        for drawing in self
            .loops
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .values()
        {
            drawing.shared.stop.store(true, Ordering::Relaxed);
        }
    }

    #[cfg(test)]
    fn is_running(&self) -> bool {
        self.loops
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .values()
            .any(Loop::is_running)
    }
}

impl Loop {
    /// The newest frame — or, for a preview that already has it (`after`),
    /// the next, once it is drawn (`frame_delivery::newer_than`).
    fn frame(
        &self,
        app: &AppHandle,
        screen: &str,
        size: (u32, u32),
        lead: Duration,
        after: Option<u64>,
    ) -> Option<Latest> {
        self.shared.want(size);
        self.shared
            .lead_ms
            .store(lead.as_millis() as u64, Ordering::Relaxed);
        *self
            .shared
            .asked_at
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner()) = Some(Instant::now());
        self.ensure_drawing(app, screen);
        frame_delivery::newer_than(&self.shared.latest, &self.shared.fresh, after)
    }

    /// Start the loop if it is not already running.
    fn ensure_drawing(&self, app: &AppHandle, screen: &str) {
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
        let screen = screen.to_owned();
        // A thread of its own, not the async pool: it draws for as long as
        // somebody is looking, which is not what a pool's tasks are for.
        std::thread::Builder::new()
            .name("present-preview".to_owned())
            .spawn(move || {
                // Whatever ends the loop — idle, a stop, a panic — the state
                // has to hear about it, or nothing ever starts it again and
                // the preview stays dark for the rest of the run.
                let _running = Running(still_running);
                draw_until_idle(&app, &screen, &shared);
            })
            .map(|_| ())
            .unwrap_or_else(|error| {
                tracing::warn!(%error, "the preview could not start drawing");
                *running = false;
            });
    }

    #[cfg(test)]
    fn is_running(&self) -> bool {
        *self
            .running
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }
}

/// Show the audience screen `screen` on `panel`, natively (`surface::panel`):
/// its own frames while its window is open, drawn here for the panel while
/// not. Stops when the flag it returns is set.
pub fn start_native(app: &AppHandle, screen: &str, panel: Arc<NativePanel>) -> Arc<AtomicBool> {
    let stop = Arc::new(AtomicBool::new(false));
    let (app, screen, flag) = (app.clone(), screen.to_owned(), Arc::clone(&stop));
    let spawned = std::thread::Builder::new()
        .name("present-preview-panel".to_owned())
        .spawn(move || present_until_stopped(&app, &screen, &panel, &flag));
    if let Err(error) = spawned {
        tracing::warn!(%error, "the native preview could not start");
    }
    stop
}

/// The native preview's loop.
///
/// While the audience screen is drawn in its window (`surface::tap`), the
/// preview is that very frame — no second compositor, no second copy of the
/// video, no JPEG — made smaller by the GPU. While it is not, the preview is
/// drawn here, at the panel's own size.
fn present_until_stopped(app: &AppHandle, screen: &str, panel: &NativePanel, stop: &AtomicBool) {
    let mut own: Option<PreviewSource> = None;
    let mut shown: Option<u64> = None;
    while !stop.load(Ordering::Relaxed) {
        let started = Instant::now();
        if !panel.is_current() {
            // Out of sight, or its page has stopped saying where it is.
            own = None;
            shown = None;
        } else if let Some(tapped) = tap::latest(screen) {
            own = None;
            if shown != Some(tapped.seq) {
                shown = Some(tapped.seq);
                panel.show_picture(tapped.size, &tapped.frame);
            }
        } else {
            shown = None;
            let size = panel.pixel_size();
            let source = own.get_or_insert_with(|| PreviewSource::new(app.clone(), screen));
            match source.picture(size) {
                Ok(Some(picture)) => panel.show_picture(size, picture),
                Ok(None) => {}
                Err(error) => tracing::debug!(%error, "no native preview frame this time"),
            }
        }
        if let Some(rest) = FRAME_EVERY.checked_sub(started.elapsed()) {
            std::thread::sleep(rest);
        }
    }
}

/// Marks the loop stopped however it ends.
struct Running(Arc<Mutex<bool>>);

impl Drop for Running {
    fn drop(&mut self) {
        *self
            .0
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner()) = false;
    }
}

fn draw_until_idle(app: &AppHandle, screen: &str, shared: &Shared) {
    let mut source = PreviewSource::new(app.clone(), screen);
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
            let lead = Duration::from_millis(shared.lead_ms.load(Ordering::Relaxed));
            match source.frame(size, lead) {
                Ok((picture, changed)) => {
                    let mut latest = shared
                        .latest
                        .lock()
                        .unwrap_or_else(|poisoned| poisoned.into_inner());
                    if changed || latest.is_none() {
                        *latest = Some(Latest {
                            jpeg: Arc::new(picture.to_vec()),
                            at: Instant::now(),
                            seq: frame_delivery::next_seq(),
                        });
                        shared.fresh.notify_all();
                    }
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
    shared.fresh.notify_all();
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

/// Which audience screen a request is for: `frame/<screen id>`. The Screen
/// for anything else, stage screens included, which the compositor does not
/// draw.
pub fn screen_from_uri(uri: &str) -> &str {
    let path = uri.split_once('?').map_or(uri, |(path, _)| path);
    path.split_once("/frame/")
        .map(|(_, id)| id)
        .filter(|id| screens::is_usable_id(id))
        .unwrap_or(screens::AUDIENCE)
}

/// The `output-frame://frame/<screen>?w=&h=&t=` response.
///
/// 204 while the loop has not drawn its first frame yet, and not 500: the
/// preview is a picture of what is already on screen elsewhere, so the honest
/// answer to "not yet" is to show nothing and let the next request try again.
pub fn respond(state: &PreviewState, app: &AppHandle, uri: &str) -> http::Response<Vec<u8>> {
    let asked = Instant::now();
    let latest = state.frame(
        app,
        screen_from_uri(uri),
        size_from_uri(uri),
        frame_delivery::lead_from_uri(uri),
        frame_delivery::query_number(uri, "after"),
    );
    frame_delivery::respond(latest, uri, asked.elapsed())
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
    fn the_screen_comes_from_the_path_and_is_an_audience_screen() {
        assert_eq!(
            screen_from_uri("output-frame://frame/audience?w=480&h=270&t=12"),
            "audience"
        );
        assert_eq!(
            screen_from_uri("http://output-frame.localhost/frame/a1b2c3d4e5?t=3"),
            "a1b2c3d4e5"
        );
        assert_eq!(
            screen_from_uri("output-frame://frame/media?t=1"),
            "audience",
            "a stage screen is not drawn here"
        );
        assert_eq!(screen_from_uri("output-frame://frame/../x?t=1"), "audience");
        assert_eq!(screen_from_uri("output-frame://frame"), "audience");
    }

    #[test]
    fn a_size_survives_the_trip_through_the_atomic() {
        let shared = Shared::default();
        shared.want((3840, 2160));
        assert_eq!(shared.wanted_size(), (3840, 2160));
    }

    /// The largest wins, which is what stops the decoder being reopened.
    ///
    /// Two windows can show this preview at different sizes, and a panel
    /// changes size while it is dragged. The video is opened for the size it
    /// is drawn at, so following every request reopened the decoder on every
    /// turn of the loop and it never produced a frame at all.
    #[test]
    fn the_biggest_size_anyone_asks_for_is_the_one_drawn() {
        let shared = Shared::default();
        shared.want((480, 270));
        shared.want((960, 540));
        assert_eq!(shared.wanted_size(), (960, 540));
        shared.want((480, 270));
        assert_eq!(
            shared.wanted_size(),
            (960, 540),
            "the small one scales the big picture down itself"
        );
    }

    #[test]
    fn a_preview_that_shrank_is_drawn_small_again_once_the_big_one_has_gone() {
        let shared = Shared::default();
        shared.want((1920, 1080));
        // As though the last big request was long enough ago.
        *shared
            .widest_since
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner()) =
            Some(Instant::now() - WIDEST_FOR - Duration::from_millis(1));
        shared.want((480, 270));
        assert_eq!(shared.wanted_size(), (480, 270));
    }

    #[test]
    fn nothing_is_drawn_until_somebody_asks() {
        let state = PreviewState::new();
        assert!(!state.is_running(), "no loop, no compositor, no video open");
    }
}
