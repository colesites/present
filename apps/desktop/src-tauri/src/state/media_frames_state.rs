//! The webview's video players (`services::media_frames`), and the
//! `media-frame://` response.
//!
//! The same arrangement as the operator's preview (`preview_state.rs`): the
//! first ask starts a loop that decodes as fast as the video runs and keeps the
//! newest frame on hand; a request takes whatever is there. The loop stops on
//! its own once nobody has asked for a while, and the player with it.
//!
//! A panel names its player by an id of its own, says which file and how it
//! keeps time (`set`), and lets it go when it is unmounted (`remove`).

use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Condvar, Mutex};
use std::time::{Duration, Instant};

use tauri::{http, AppHandle, Manager};

use crate::services::frame_delivery::{self, Latest};
use crate::services::media_frames::{Clock, Player};
use crate::services::preview::scoped_opener;
use crate::services::surface::panel::NativePanel;
use crate::services::thumbnails;
use crate::state::OutputState;

/// How often a player looks for its next frame: a 60 fps video's rate.
const FRAME_EVERY: Duration = Duration::from_micros(16_667);

/// How long a player keeps decoding after the last request.
const KEEP_DRAWING_FOR: Duration = Duration::from_secs(2);

/// The largest picture asked for, per side: a full HD output window, where it
/// draws before its native view has a frame or on a platform without one.
pub const MAX_SIDE: u32 = 1920;
pub const MIN_SIDE: u32 = 16;

#[derive(Default)]
pub struct MediaFramesState {
    players: Mutex<HashMap<String, Arc<Entry>>>,
}

#[derive(Default)]
struct Entry {
    /// The file and clock, as the panel last set them.
    wanted: Mutex<Option<(String, Clock)>>,
    latest: Mutex<Option<Latest>>,
    /// Told when `latest` changes, for a request waiting on a new frame.
    fresh: Condvar,
    /// How far ahead of the wall's clock to draw, in milliseconds: how late
    /// the panel's frames reach its screen (`frame_delivery`).
    lead_ms: AtomicU64,
    /// The size, packed as two `u32`s.
    size: AtomicU64,
    asked_at: Mutex<Option<Instant>>,
    running: AtomicBool,
    stop: AtomicBool,
}

fn lock<T>(mutex: &Mutex<T>) -> std::sync::MutexGuard<'_, T> {
    mutex
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}

impl MediaFramesState {
    pub fn new() -> Self {
        Self::default()
    }

    /// Show `url` in player `id`, keeping time by `clock`.
    pub fn set(&self, id: &str, url: String, clock: Clock) {
        let entry = lock(&self.players)
            .entry(id.to_owned())
            .or_default()
            .clone();
        *lock(&entry.wanted) = Some((url, clock));
    }

    /// The panel has gone: stop its player.
    pub fn remove(&self, id: &str) {
        if let Some(entry) = lock(&self.players).remove(id) {
            entry.stop.store(true, Ordering::Release);
            entry.fresh.notify_all();
        }
    }

    /// The newest frame of player `id`, and a promise to keep decoding, drawn
    /// `lead` ahead from now on.
    ///
    /// A panel that already has the newest (`after`) is answered when the
    /// next one is ready, or after [`frame_delivery::WAIT_FOR_NEW`] — not
    /// told "nothing new" at once, which had a paused video's panel ask a
    /// hundred and fifty times a second.
    pub fn frame(
        &self,
        app: &AppHandle,
        id: &str,
        size: (u32, u32),
        lead: Duration,
        after: Option<u64>,
    ) -> Option<Latest> {
        let entry = lock(&self.players).get(id)?.clone();
        entry
            .lead_ms
            .store(lead.as_millis() as u64, Ordering::Relaxed);
        entry.size.store(
            (u64::from(size.0) << 32) | u64::from(size.1),
            Ordering::Relaxed,
        );
        *lock(&entry.asked_at) = Some(Instant::now());
        ensure_running(app, &entry);
        frame_delivery::newer_than(&entry.latest, &entry.fresh, after)
    }
}

/// Start `entry`'s player if it is not running.
fn ensure_running(app: &AppHandle, entry: &Arc<Entry>) {
    if entry.running.swap(true, Ordering::AcqRel) {
        return;
    }
    let app = app.clone();
    let running = entry.clone();
    let spawned = std::thread::Builder::new()
        .name("present-media-frames".to_owned())
        .spawn(move || {
            decode_until_idle(&app, &running);
            running.running.store(false, Ordering::Release);
        });
    if let Err(error) = spawned {
        tracing::warn!(%error, "a video player could not start");
        entry.running.store(false, Ordering::Release);
    }
}

fn decode_until_idle(app: &AppHandle, entry: &Entry) {
    let open = scoped_opener(app.clone());
    let mut player: Option<Player> = None;
    let mut last: Option<(f64, (u32, u32))> = None;
    loop {
        let started = Instant::now();
        if entry.stop.load(Ordering::Acquire) {
            break;
        }
        if lock(&entry.asked_at).is_none_or(|at| at.elapsed() >= KEEP_DRAWING_FOR) {
            break;
        }
        let Some((url, clock)) = lock(&entry.wanted).clone() else {
            std::thread::sleep(FRAME_EVERY);
            continue;
        };
        match &mut player {
            Some(current) if current.url == url => current.set_clock(clock),
            _ => {
                player = Some(Player::new(url, clock));
                last = None;
            }
        }
        let packed = entry.size.load(Ordering::Relaxed);
        let size = ((packed >> 32) as u32, (packed & 0xffff_ffff) as u32);
        // Shared, not copied: this runs sixty times a second for every panel.
        let live = app
            .try_state::<OutputState>()
            .map(|output| output.scene_shared())
            .unwrap_or_default();
        if let Some(frame) = player.as_mut().and_then(|player| {
            let lead = Duration::from_millis(entry.lead_ms.load(Ordering::Relaxed));
            player.frame(&live, Instant::now() + lead, size, &open)
        }) {
            let key = (frame.presentation_seconds, (frame.width, frame.height));
            if last != Some(key) {
                match thumbnails::encode_jpeg(frame.width, frame.height, &frame.bgra) {
                    Ok(jpeg) => {
                        *lock(&entry.latest) = Some(Latest {
                            jpeg: Arc::new(jpeg),
                            at: Instant::now(),
                            seq: frame_delivery::next_seq(),
                        });
                        entry.fresh.notify_all();
                        last = Some(key);
                    }
                    Err(error) => tracing::debug!(%error, "a video frame could not be encoded"),
                }
            }
        }
        if let Some(rest) = FRAME_EVERY.checked_sub(started.elapsed()) {
            std::thread::sleep(rest);
        }
    }
    *lock(&entry.latest) = None;
    entry.fresh.notify_all();
}

/// A media panel drawn natively over the page (`surface::panel`): a player
/// of its own, handing the panel each frame as it was decoded, scaled by the
/// GPU — no JPEG, no fetch, nothing the page's own thread can hold up.
///
/// Apart from the players above, which the page fetches from: the two are
/// started and stopped by different calls, and those can arrive in either
/// order.
pub struct NativeMedia {
    /// The file and clock, as the page last set them.
    wanted: Mutex<(String, Clock)>,
    stop: AtomicBool,
}

impl NativeMedia {
    /// Start showing `url`, keeping time by `clock`, on `panel`.
    pub fn start(app: &AppHandle, panel: Arc<NativePanel>, url: String, clock: Clock) -> Arc<Self> {
        let media = Arc::new(Self {
            wanted: Mutex::new((url, clock)),
            stop: AtomicBool::new(false),
        });
        let (app, running) = (app.clone(), Arc::clone(&media));
        let spawned = std::thread::Builder::new()
            .name("present-media-panel".to_owned())
            .spawn(move || present_until_stopped(&app, &panel, &running));
        if let Err(error) = spawned {
            tracing::warn!(%error, "a native video panel could not start");
        }
        media
    }

    /// Show `url`, keeping time by `clock`, from now on.
    pub fn set(&self, url: String, clock: Clock) {
        *lock(&self.wanted) = (url, clock);
    }

    pub fn stop(&self) {
        self.stop.store(true, Ordering::Release);
    }
}

fn present_until_stopped(app: &AppHandle, panel: &NativePanel, media: &NativeMedia) {
    let open = scoped_opener(app.clone());
    let mut player: Option<Player> = None;
    // The frame last handed over, to hand each one once.
    let mut shown: Option<Arc<crate::services::video::VideoFrame>> = None;
    while !media.stop.load(Ordering::Acquire) {
        let started = Instant::now();
        // Out of sight, or its page has stopped saying where it is: nothing
        // worth decoding for it.
        if panel.is_current() {
            let (url, clock) = lock(&media.wanted).clone();
            let current = match &mut player {
                Some(current) if current.url == url => {
                    current.set_clock(clock);
                    current
                }
                _ => player.insert(Player::new(url, clock)),
            };
            let live = app
                .try_state::<OutputState>()
                .map(|output| output.scene_shared())
                .unwrap_or_default();
            // At the same moment the audience view draws, with no lead: the
            // panel's frames reach the screen as quickly as its do.
            let frame = current.frame_shared(&live, Instant::now(), panel.pixel_size(), &open);
            if let Some(frame) = frame {
                if !shown
                    .as_ref()
                    .is_some_and(|shown| Arc::ptr_eq(shown, &frame))
                {
                    panel.show_video(&frame);
                    shown = Some(frame);
                }
            }
        } else {
            shown = None;
        }
        if let Some(rest) = FRAME_EVERY.checked_sub(started.elapsed()) {
            std::thread::sleep(rest);
        }
    }
}

/// `?w=&h=`, kept within what a player draws.
fn size_from_uri(uri: &str) -> (u32, u32) {
    let query = uri.split_once('?').map(|(_, rest)| rest).unwrap_or("");
    let number = |name: &str| {
        query
            .split('&')
            .filter_map(|pair| pair.split_once('='))
            .find(|(key, _)| *key == name)
            .and_then(|(_, value)| value.parse::<u32>().ok())
    };
    let width = number("w").unwrap_or(640).clamp(MIN_SIDE, MAX_SIDE);
    let height = number("h")
        .unwrap_or(width * 9 / 16)
        .clamp(MIN_SIDE, MAX_SIDE);
    (width, height)
}

/// `frame/<id>`: letters, digits, `-` and `_`, as `mediaFrameUrl` makes them.
fn id_from_uri(uri: &str) -> Option<String> {
    let path = uri.split_once('?').map_or(uri, |(path, _)| path);
    let id = path.split_once("/frame/")?.1;
    let usable = !id.is_empty()
        && id.len() <= 128
        && id
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_');
    usable.then(|| id.to_owned())
}

/// The `media-frame://frame/<id>?w=&h=&lead=&after=&t=` response
/// (`frame_delivery`).
pub fn respond(state: &MediaFramesState, app: &AppHandle, uri: &str) -> http::Response<Vec<u8>> {
    let asked = Instant::now();
    let latest = id_from_uri(uri).and_then(|id| {
        state.frame(
            app,
            &id,
            size_from_uri(uri),
            frame_delivery::lead_from_uri(uri),
            frame_delivery::query_number(uri, "after"),
        )
    });
    frame_delivery::respond(latest, uri, asked.elapsed())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_request_names_its_player_and_a_sane_size() {
        assert_eq!(
            id_from_uri("media-frame://frame/center-pane?w=480&h=270&t=3").as_deref(),
            Some("center-pane")
        );
        assert_eq!(
            id_from_uri("http://media-frame.localhost/frame/prop-12?t=1").as_deref(),
            Some("prop-12")
        );
        assert_eq!(id_from_uri("media-frame://frame/../etc?t=1"), None);
        assert_eq!(id_from_uri("media-frame://frame/?t=1"), None);
        assert_eq!(
            size_from_uri("media-frame://frame/a?w=480&h=270"),
            (480, 270)
        );
        assert_eq!(
            size_from_uri("media-frame://frame/a?w=9000&h=0"),
            (MAX_SIDE, MIN_SIDE)
        );
    }
}
