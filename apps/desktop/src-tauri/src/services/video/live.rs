//! The live video, decoded once for every picture of it.
//!
//! The audience view, the operator's preview, the center pane, the stage
//! displays and NDI each used to open the live video themselves: five
//! decoders of one file, each copying every frame off the GPU and converting
//! it, each with threads of its own, and each able to fall behind on its own —
//! which is how the center pane skipped while the audience screen played on.
//! They all show the same moment of the same file, because every one follows
//! the sound's clock (`sound::clock`). One decoder is enough.
//!
//! So the live video is decoded here, once, on a thread of its own, at the
//! largest size any picture of it asks for, and the last few frames are kept.
//! Each picture takes the frame due when it will be seen — the same frame, for
//! the same moment, in every one — and makes it smaller if it shows the video
//! smaller (`resize.rs`).
//!
//! **It is asked, not told.** Each picture says, every time it draws, where
//! the video is for it and how big it wants it. The decoder works towards the
//! furthest ahead anyone is (a panel draws a little ahead, for the time its
//! frames take to reach the screen), and keeps frames back to the furthest
//! behind. A picture that stops asking stops counting, and once nobody asks,
//! the decoder and its file are let go.

use std::collections::{HashMap, VecDeque};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Condvar, LazyLock, Mutex, MutexGuard, PoisonError};
use std::time::{Duration, Instant};

use super::resize::Resizer;
use super::{contain_size, VideoDecoder, VideoFrame};

/// Opens a video for a URL at a size: where the file scope is checked. The
/// same shape as the pictures' own (`ndi::video_feed::Opener`).
pub type Opener =
    Arc<dyn Fn(&str, (u32, u32)) -> Result<Box<dyn VideoDecoder>, String> + Send + Sync>;

/// How long the decoder carries on after the last picture asked.
const KEEP_FOR: Duration = Duration::from_secs(2);

/// How long an ask counts towards where the decoder aims. Every picture asks
/// at least thirty times a second.
const FRESH: Duration = Duration::from_millis(150);

/// How long a size asked for is remembered. A panel being dragged is one size
/// and not sixty, and one that shrank is decoded smaller again soon after.
const SIZE_FOR: Duration = Duration::from_secs(3);

/// The most frames kept: enough for the furthest-ahead panel at 60 fps.
const MAX_FRAMES: usize = 12;

/// The most memory the frames kept may take: a dozen 1080p frames, or four
/// for a screen drawn at 4K.
const MAX_BYTES: usize = 12 * 1920 * 1080 * 4;

/// How many frames of `frame_bytes` each are kept at most: never fewer than
/// three, the one on screen and two coming.
fn most_frames(frame_bytes: usize) -> usize {
    (MAX_BYTES / frame_bytes.max(1)).clamp(3, MAX_FRAMES)
}

/// Behind where it should be by more than this, and the decoder seeks rather
/// than decoding forward to it.
const SEEK_WHEN_BEHIND: f64 = 1.0;

/// Earlier than the oldest frame kept by more than this: the video went
/// backwards — a seek, or a loop — and the decoder follows it there.
const SEEK_WHEN_BACK: f64 = 0.12;

/// A frame this close after the moment asked for is the one for it: the
/// clock and the frames' times are both rounded.
const PICK_SLACK: f64 = 0.004;

/// Until the frames say otherwise.
const DEFAULT_FRAME: f64 = 1.0 / 30.0;

/// Frames already made smaller, kept for the next picture of the same size:
/// a few sizes, a couple of frames each.
const MAX_FITTED: usize = 8;

/// Which frame was made which size: its time, its own size, and the size.
type FitKey = (u64, (u32, u32), (u32, u32));

/// How long a video that would not open, or stopped decoding, is left before
/// it is opened again.
const RECOVER_AFTER: Duration = Duration::from_secs(2);

/// What a picture says each time it draws.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Ask {
    /// Where the video is for this picture.
    pub seconds: f64,
    pub playing: bool,
    pub rate: f64,
    /// The largest picture it can use: the frame is fitted inside this.
    pub bounds: (u32, u32),
}

impl Ask {
    fn seconds_at(&self, asked_at: Instant, now: Instant) -> f64 {
        if self.playing {
            self.seconds + now.saturating_duration_since(asked_at).as_secs_f64() * self.rate
        } else {
            self.seconds
        }
    }
}

/// How far the decoder of a live video has got towards a moment of it.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Readiness {
    /// The frame for that moment is decoded: every picture can show it.
    Ready,
    /// A picture has asked for the video, and the frame is on its way — the
    /// file opening, or the decoder finding the place.
    Preparing,
    /// No picture has asked for the video.
    Unasked,
}

/// A frame this close to the moment is the frame for it.
const READY_WITHIN: f64 = 0.1;

/// Every live video being decoded, one decoder each.
pub struct LiveHub {
    entries: Mutex<HashMap<PathBuf, Arc<Entry>>>,
}

static GLOBAL: LazyLock<Arc<LiveHub>> = LazyLock::new(LiveHub::new);

impl LiveHub {
    pub fn new() -> Arc<Self> {
        Arc::new(Self {
            entries: Mutex::new(HashMap::new()),
        })
    }

    /// The one every picture of the app shares.
    pub fn global() -> Arc<Self> {
        Arc::clone(&GLOBAL)
    }

    /// The frame of the video at `path` for `ask`, decoded once for everyone
    /// who shows it and fitted inside `ask.bounds` — made smaller with
    /// `resizer` the first time a picture of that size asks for it, and the
    /// same `Arc` for every picture of that size after. Without a `resizer`,
    /// the frame as it was decoded, for a picture the GPU scales
    /// (`surface::panel`). `None` until its first frame is decoded, and while
    /// it finds a new place: the picture keeps what it already shows.
    pub fn frame(
        self: &Arc<Self>,
        url: &str,
        path: &Path,
        ask: Ask,
        open: &Opener,
        resizer: Option<&mut Resizer>,
    ) -> Option<Arc<VideoFrame>> {
        let now = Instant::now();
        let mut entries = lock(&self.entries);
        let entry = Arc::clone(
            entries
                .entry(path.to_owned())
                .or_insert_with(|| Arc::new(Entry::new(path, url, open))),
        );
        let (picked, start) = {
            let mut inner = lock(&entry.inner);
            inner.record(ask, now);
            let start = !inner.running;
            inner.running = true;
            let picked = pick(&inner.frames, ask.seconds).map(|source| {
                let size = contain_size((source.width, source.height), ask.bounds);
                let key = (
                    source.presentation_seconds.to_bits(),
                    (source.width, source.height),
                    size,
                );
                let done = if resizer.is_none() || size == (source.width, source.height) {
                    Some(Arc::clone(&source))
                } else {
                    inner
                        .fitted
                        .iter()
                        .find(|(made, _)| *made == key)
                        .map(|(_, frame)| Arc::clone(frame))
                };
                (source, key, done)
            });
            (picked, start)
        };
        if start {
            let hub = Arc::clone(self);
            let worker = Arc::clone(&entry);
            let spawned = std::thread::Builder::new()
                .name("present-live-video".to_owned())
                .spawn(move || work(&hub, &worker));
            if let Err(error) = spawned {
                tracing::warn!(%error, "the live video's decoder could not start");
                lock(&entry.inner).running = false;
            }
        }
        drop(entries);
        entry.wake.notify_one();

        let (source, key, done) = picked?;
        if let Some(done) = done {
            return Some(done);
        }
        let resizer = resizer?;
        // Made smaller outside the lock, so the other pictures carry on.
        // Shown larger, should the scaler ever refuse: slower to draw, but
        // still the right frame.
        let fitted = resizer.resize(&source, key.2).map_or(source, Arc::new);
        let mut inner = lock(&entry.inner);
        inner.fitted.push_back((key, Arc::clone(&fitted)));
        while inner.fitted.len() > MAX_FITTED {
            inner.fitted.pop_front();
        }
        Some(fitted)
    }

    /// Whether the frame for `seconds` of the video at `path` is decoded:
    /// what a video starting, or moving, waits for before its sound goes
    /// (`sound::Engine::apply_due`), so the picture and the sound begin
    /// together.
    pub fn readiness(&self, path: &Path, seconds: f64) -> Readiness {
        let Some(entry) = lock(&self.entries).get(path).cloned() else {
            return Readiness::Unasked;
        };
        let inner = lock(&entry.inner);
        match pick(&inner.frames, seconds) {
            Some(frame) if (frame.presentation_seconds - seconds).abs() <= READY_WITHIN => {
                Readiness::Ready
            }
            _ => Readiness::Preparing,
        }
    }

    /// Let `entry` go if nobody has asked for it since `KEEP_FOR`. Under the
    /// hub's lock, so an ask either comes before and keeps it, or after and
    /// starts a new one.
    fn retire(&self, entry: &Arc<Entry>) -> bool {
        let mut entries = lock(&self.entries);
        let mut inner = lock(&entry.inner);
        if inner.asked_at.elapsed() < KEEP_FOR {
            return false;
        }
        inner.running = false;
        inner.frames.clear();
        inner.fitted.clear();
        if entries
            .get(&entry.path)
            .is_some_and(|current| Arc::ptr_eq(current, entry))
        {
            entries.remove(&entry.path);
        }
        true
    }

    #[cfg(test)]
    fn is_decoding(&self, path: &Path) -> bool {
        lock(&self.entries)
            .get(path)
            .is_some_and(|entry| lock(&entry.inner).running)
    }
}

/// One live video: its frames and who wants them.
struct Entry {
    path: PathBuf,
    inner: Mutex<Inner>,
    /// Told whenever a picture asks, so the decoder looks again at once.
    wake: Condvar,
}

struct Inner {
    url: String,
    open: Opener,
    /// In the order they are shown.
    frames: VecDeque<Arc<VideoFrame>>,
    /// Frames already made a picture's size, newest last.
    fitted: VecDeque<(FitKey, Arc<VideoFrame>)>,
    /// Recent asks, oldest first.
    asks: VecDeque<(Ask, Instant)>,
    /// Sizes asked for, and when each last was.
    sizes: Vec<((u32, u32), Instant)>,
    asked_at: Instant,
    running: bool,
}

impl Entry {
    fn new(path: &Path, url: &str, open: &Opener) -> Self {
        Self {
            path: path.to_owned(),
            inner: Mutex::new(Inner {
                url: url.to_owned(),
                open: Arc::clone(open),
                frames: VecDeque::new(),
                fitted: VecDeque::new(),
                asks: VecDeque::new(),
                sizes: Vec::new(),
                asked_at: Instant::now(),
                running: false,
            }),
            wake: Condvar::new(),
        }
    }

    /// Wait until a picture asks, or `most` has passed.
    fn wait(&self, most: Duration) {
        let inner = lock(&self.inner);
        let _ = self
            .wake
            .wait_timeout(inner, most)
            .unwrap_or_else(PoisonError::into_inner);
    }
}

/// What the decoder should be doing, as of the asks.
#[derive(Debug, Clone, Copy, PartialEq)]
struct Aim {
    /// The furthest behind any picture is: frames before it can go.
    floor: f64,
    /// The furthest ahead: decode up to here.
    target: f64,
    playing: bool,
    /// What the frames are decoded to fit inside.
    bounds: (u32, u32),
}

impl Inner {
    fn record(&mut self, ask: Ask, now: Instant) {
        self.asked_at = now;
        self.asks.push_back((ask, now));
        while self
            .asks
            .front()
            .is_some_and(|(_, at)| now.saturating_duration_since(*at) > FRESH)
        {
            self.asks.pop_front();
        }
        // A few pictures, each asking every frame: never many.
        if self.asks.len() > 256 {
            self.asks.pop_front();
        }
        let bounds = (ask.bounds.0.max(1), ask.bounds.1.max(1));
        match self.sizes.iter_mut().find(|(size, _)| *size == bounds) {
            Some(known) => known.1 = now,
            None => self.sizes.push((bounds, now)),
        }
    }

    fn aim(&mut self, now: Instant) -> Option<Aim> {
        self.asks
            .retain(|(_, at)| now.saturating_duration_since(*at) <= FRESH);
        self.sizes
            .retain(|(_, at)| now.saturating_duration_since(*at) <= SIZE_FOR);
        let mut aim: Option<Aim> = None;
        for (ask, at) in &self.asks {
            let seconds = ask.seconds_at(*at, now);
            let current = aim.get_or_insert(Aim {
                floor: seconds,
                target: seconds,
                playing: false,
                bounds: (1, 1),
            });
            current.floor = current.floor.min(seconds);
            current.target = current.target.max(seconds);
            current.playing |= ask.playing;
        }
        let mut aim = aim?;
        for (size, _) in &self.sizes {
            aim.bounds = (aim.bounds.0.max(size.0), aim.bounds.1.max(size.1));
        }
        Some(aim)
    }
}

/// The frame for `seconds`: the last one at or before it, or the first kept
/// if all of them are after it.
fn pick(frames: &VecDeque<Arc<VideoFrame>>, seconds: f64) -> Option<Arc<VideoFrame>> {
    let mut chosen = frames.front()?;
    for frame in frames {
        if frame.presentation_seconds <= seconds + PICK_SLACK {
            chosen = frame;
        } else {
            break;
        }
    }
    Some(Arc::clone(chosen))
}

/// Drop the frames nobody will show again: everything before the one at the
/// floor, which the picture furthest behind is showing.
fn evict(frames: &mut VecDeque<Arc<VideoFrame>>, floor: f64) {
    while frames.len() > 1 && frames[1].presentation_seconds <= floor + PICK_SLACK {
        frames.pop_front();
    }
}

#[derive(Debug, Clone, Copy, PartialEq)]
enum Step {
    Decode,
    Seek(f64),
    Hold,
}

/// What to do next, from the frames on hand and the aim. `sought` is where
/// the decoder was last sent: where it ran out, when it has.
fn decide(
    oldest: Option<f64>,
    newest: Option<f64>,
    room: bool,
    aim: &Aim,
    ended: bool,
    sought: f64,
    frame_seconds: f64,
) -> Step {
    match (oldest, newest) {
        (Some(oldest), Some(newest)) => {
            if aim.floor + SEEK_WHEN_BACK < oldest || aim.floor > newest + SEEK_WHEN_BEHIND {
                Step::Seek(aim.floor)
            } else if !ended && room && newest < aim.target - frame_seconds / 2.0 {
                Step::Decode
            } else {
                Step::Hold
            }
        }
        // Sent to the very end, or past it, and nothing came: with no frame
        // to tell it the pictures went back, it would hold nothing for good.
        // Once they want somewhere earlier — the video started again — it
        // goes there.
        _ if ended && aim.floor + SEEK_WHEN_BACK < sought => Step::Seek(aim.floor),
        _ if ended => Step::Hold,
        _ => Step::Decode,
    }
}

/// Whether a decoder made for `current` should be made again for `wanted`:
/// a picture wants it bigger, or nobody wants it more than a quarter as big.
fn outgrown(current: (u32, u32), wanted: (u32, u32)) -> bool {
    let area = |size: (u32, u32)| u64::from(size.0) * u64::from(size.1);
    wanted.0 > current.0 || wanted.1 > current.1 || area(wanted) * 4 <= area(current)
}

struct Decoding {
    decoder: Box<dyn VideoDecoder>,
    bounds: (u32, u32),
    /// The decoder has no more frames at this position.
    ended: bool,
    /// Where it was last sent.
    sought: f64,
    /// How far apart the frames are.
    frame_seconds: f64,
}

fn work(hub: &LiveHub, entry: &Arc<Entry>) {
    let mut decoding: Option<Decoding> = None;
    let mut failed_at: Option<Instant> = None;
    loop {
        let now = Instant::now();
        let (aim, url, open, idle) = {
            let mut inner = lock(&entry.inner);
            let idle = now.saturating_duration_since(inner.asked_at) >= KEEP_FOR;
            (
                inner.aim(now),
                inner.url.clone(),
                Arc::clone(&inner.open),
                idle,
            )
        };
        if idle {
            if hub.retire(entry) {
                return;
            }
            continue;
        }
        let Some(aim) = aim else {
            // Nobody has asked lately: nothing to aim at.
            entry.wait(Duration::from_millis(50));
            continue;
        };

        if decoding
            .as_ref()
            .is_none_or(|current| outgrown(current.bounds, aim.bounds))
        {
            if failed_at.is_some_and(|at| now.saturating_duration_since(at) < RECOVER_AFTER) {
                entry.wait(Duration::from_millis(100));
                continue;
            }
            // This thread decodes ahead itself: the opener's own queue would
            // only keep two more frames and a thread.
            let opened = open(&url, aim.bounds).map(|mut decoder| {
                let inner = decoder.take_unbuffered();
                inner.unwrap_or(decoder)
            });
            match opened {
                Ok(mut decoder) => {
                    let mut sought = 0.0;
                    if aim.floor > PICK_SLACK {
                        match decoder.seek(aim.floor) {
                            Ok(()) => sought = aim.floor,
                            Err(error) => tracing::warn!(
                                %error,
                                url,
                                "the live video could not find its place"
                            ),
                        }
                    }
                    decoding = Some(Decoding {
                        decoder,
                        bounds: aim.bounds,
                        ended: false,
                        sought,
                        frame_seconds: DEFAULT_FRAME,
                    });
                    // Kept until now, so the pictures had something to show
                    // while the decoder opened.
                    lock(&entry.inner).frames.clear();
                    failed_at = None;
                }
                Err(error) => {
                    tracing::warn!(%error, url, "the live video could not be opened");
                    failed_at = Some(Instant::now());
                    decoding = None;
                }
            }
            continue;
        }
        let Some(current) = decoding.as_mut() else {
            continue;
        };

        let (oldest, newest, room) = {
            let inner = lock(&entry.inner);
            let frame_bytes = inner.frames.back().map_or(0, |frame| frame.bgra.len());
            (
                inner.frames.front().map(|frame| frame.presentation_seconds),
                inner.frames.back().map(|frame| frame.presentation_seconds),
                inner.frames.len() < most_frames(frame_bytes),
            )
        };
        match decide(
            oldest,
            newest,
            room,
            &aim,
            current.ended,
            current.sought,
            current.frame_seconds,
        ) {
            Step::Seek(seconds) => match current.decoder.seek(seconds) {
                Ok(()) => {
                    current.ended = false;
                    current.sought = seconds;
                    // The pictures keep what they show until the new place's
                    // first frame arrives.
                    lock(&entry.inner).frames.clear();
                }
                Err(error) => {
                    tracing::warn!(%error, url, "the live video could not seek");
                    decoding = None;
                    failed_at = Some(Instant::now());
                }
            },
            Step::Decode => match current.decoder.next_frame() {
                Ok(Some(frame)) if frame.is_well_formed() => {
                    if let Some(previous) = newest {
                        let apart = frame.presentation_seconds - previous;
                        if apart > 0.001 && apart < 0.2 {
                            current.frame_seconds = apart;
                        }
                    }
                    let mut inner = lock(&entry.inner);
                    inner.frames.push_back(Arc::new(frame));
                    evict(&mut inner.frames, aim.floor);
                }
                Ok(Some(_)) => {
                    tracing::warn!(url, "the live video's decoder made a malformed frame");
                    decoding = None;
                    failed_at = Some(Instant::now());
                }
                Ok(None) => current.ended = true,
                Err(error) => {
                    tracing::warn!(%error, url, "the live video stopped decoding");
                    decoding = None;
                    failed_at = Some(Instant::now());
                }
            },
            Step::Hold => {
                let frame_seconds = current.frame_seconds;
                evict(&mut lock(&entry.inner).frames, aim.floor);
                let rest = if aim.playing {
                    Duration::from_secs_f64((frame_seconds / 2.0).clamp(0.002, 0.008))
                } else {
                    Duration::from_millis(50)
                };
                entry.wait(rest);
            }
        }
    }
}

fn lock<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
    mutex.lock().unwrap_or_else(PoisonError::into_inner)
}

#[cfg(test)]
mod tests {
    use std::sync::atomic::{AtomicUsize, Ordering};

    use super::*;
    use crate::services::video::VideoError;

    /// Thirty frames a second, numbered by their time.
    struct Counting {
        next: usize,
        frames: usize,
        size: (u32, u32),
        decoded: Arc<AtomicUsize>,
    }

    impl VideoDecoder for Counting {
        fn next_frame(&mut self) -> Result<Option<VideoFrame>, VideoError> {
            if self.next >= self.frames {
                return Ok(None);
            }
            self.decoded.fetch_add(1, Ordering::SeqCst);
            let frame = VideoFrame {
                width: self.size.0,
                height: self.size.1,
                bgra: vec![0; self.size.0 as usize * self.size.1 as usize * 4],
                presentation_seconds: self.next as f64 / 30.0,
            };
            self.next += 1;
            Ok(Some(frame))
        }

        fn seek(&mut self, seconds: f64) -> Result<(), VideoError> {
            self.next = (seconds * 30.0).round() as usize;
            Ok(())
        }

        fn duration_seconds(&self) -> Option<f64> {
            Some(self.frames as f64 / 30.0)
        }

        fn dimensions(&self) -> (u32, u32) {
            self.size
        }
    }

    fn opener(opens: Arc<AtomicUsize>, decoded: Arc<AtomicUsize>) -> Opener {
        Arc::new(move |_url: &str, bounds: (u32, u32)| {
            opens.fetch_add(1, Ordering::SeqCst);
            Ok(Box::new(Counting {
                next: 0,
                frames: 3000,
                size: bounds,
                decoded: Arc::clone(&decoded),
            }) as Box<dyn VideoDecoder>)
        })
    }

    fn held(seconds: f64, bounds: (u32, u32)) -> Ask {
        Ask {
            seconds,
            playing: false,
            rate: 1.0,
            bounds,
        }
    }

    /// Ask as a picture does.
    fn ask_hub(
        hub: &Arc<LiveHub>,
        path: &Path,
        ask: Ask,
        open: &Opener,
    ) -> Option<Arc<VideoFrame>> {
        hub.frame(
            "local-media://media/x.mp4",
            path,
            ask,
            open,
            Some(&mut Resizer::new()),
        )
    }

    /// Ask until a frame comes back, as a picture does every frame.
    fn frame_when_ready(
        hub: &Arc<LiveHub>,
        path: &Path,
        ask: Ask,
        open: &Opener,
    ) -> Arc<VideoFrame> {
        let deadline = Instant::now() + Duration::from_secs(5);
        loop {
            if let Some(frame) = ask_hub(hub, path, ask, open) {
                if (frame.presentation_seconds - ask.seconds).abs() < 0.05 {
                    return frame;
                }
            }
            assert!(Instant::now() < deadline, "no frame for {ask:?}");
            std::thread::sleep(Duration::from_millis(2));
        }
    }

    /// The owner's ask: one video playing, the same everywhere, rather than
    /// each screen with its own copy.
    #[test]
    fn every_picture_of_the_live_video_shares_one_decoder_and_one_frame() {
        let hub = LiveHub::new();
        let (opens, decoded) = (Arc::default(), Arc::default());
        let open = opener(Arc::clone(&opens), Arc::clone(&decoded));
        let path = Path::new("/live-shared.mp4");

        crate::services::video::ffmpeg::init();
        let screen = frame_when_ready(&hub, path, held(2.0, (1920, 1080)), &open);
        let ask = |bounds: (u32, u32)| {
            ask_hub(&hub, path, held(2.0, bounds), &open).expect("the frame already decoded")
        };
        let screen_again = ask((1920, 1080));
        let preview = ask((960, 540));
        let center_pane = ask((960, 540));
        let stage = ask((640, 360));

        assert!(
            Arc::ptr_eq(&screen, &screen_again),
            "the same frame, not a copy"
        );
        assert_eq!(
            (screen.width, screen.height),
            (1920, 1080),
            "the largest asked for"
        );
        assert_eq!((screen.presentation_seconds * 30.0).round(), 60.0);
        assert_eq!((preview.width, preview.height), (960, 540));
        assert!(
            Arc::ptr_eq(&preview, &center_pane),
            "made that size once, for both"
        );
        assert_eq!((stage.width, stage.height), (640, 360));
        for each in [&preview, &stage] {
            assert_eq!(each.presentation_seconds, screen.presentation_seconds);
        }
        assert_eq!(
            opens.load(Ordering::SeqCst),
            1,
            "one decoder for all of them"
        );
    }

    #[test]
    fn a_picture_drawing_ahead_gets_the_frame_due_then() {
        let hub = LiveHub::new();
        let open = opener(Arc::default(), Arc::default());
        let path = Path::new("/live-ahead.mp4");
        // The screen at 5 s, a panel a tenth of a second ahead of it, both
        // asking every frame, as they do.
        let frame_number = |frame: &Option<Arc<VideoFrame>>| {
            frame
                .as_ref()
                .map(|frame| (frame.presentation_seconds * 30.0).round())
        };
        let deadline = Instant::now() + Duration::from_secs(5);
        loop {
            let screen = ask_hub(&hub, path, held(5.0, (64, 36)), &open);
            let panel = ask_hub(&hub, path, held(5.1, (64, 36)), &open);
            if frame_number(&screen) == Some(150.0) && frame_number(&panel) == Some(153.0) {
                break;
            }
            assert!(
                Instant::now() < deadline,
                "screen {:?}, panel {:?}",
                frame_number(&screen),
                frame_number(&panel)
            );
            std::thread::sleep(Duration::from_millis(2));
        }
    }

    #[test]
    fn a_held_video_is_not_decoded_over_and_over() {
        let hub = LiveHub::new();
        let decoded = Arc::new(AtomicUsize::new(0));
        let open = opener(Arc::default(), Arc::clone(&decoded));
        let path = Path::new("/live-held.mp4");
        frame_when_ready(&hub, path, held(1.0, (64, 36)), &open);
        let after_first = decoded.load(Ordering::SeqCst);
        for _ in 0..20 {
            ask_hub(&hub, path, held(1.0, (64, 36)), &open);
            std::thread::sleep(Duration::from_millis(5));
        }
        assert!(
            decoded.load(Ordering::SeqCst) <= after_first + 1,
            "a paused video decodes nothing more"
        );
    }

    #[test]
    fn the_operator_going_back_moves_the_decoder_back() {
        let hub = LiveHub::new();
        let open = opener(Arc::default(), Arc::default());
        let path = Path::new("/live-back.mp4");
        frame_when_ready(&hub, path, held(20.0, (64, 36)), &open);
        let earlier = frame_when_ready(&hub, path, held(3.0, (64, 36)), &open);
        assert_eq!((earlier.presentation_seconds * 30.0).round(), 90.0);
    }

    /// Sent past its end — a clock that ran on, the slider dragged to the
    /// very end — and then started again: it shows the beginning, rather than
    /// holding nothing for good.
    #[test]
    fn a_video_sent_past_its_end_comes_back_when_it_starts_again() {
        let hub = LiveHub::new();
        let decoded = Arc::new(AtomicUsize::new(0));
        // Ten seconds long.
        let open: Opener = Arc::new(move |_url: &str, bounds: (u32, u32)| {
            Ok(Box::new(Counting {
                next: 0,
                frames: 300,
                size: bounds,
                decoded: Arc::clone(&decoded),
            }) as Box<dyn VideoDecoder>)
        });
        let path = Path::new("/live-past-the-end.mp4");
        frame_when_ready(&hub, path, held(5.0, (64, 36)), &open);
        // Long enough that the ask at 5 s no longer counts, and the decoder
        // goes past the end and finds nothing there.
        let past = Instant::now() + FRESH * 3;
        while Instant::now() < past {
            ask_hub(&hub, path, held(12.0, (64, 36)), &open);
            std::thread::sleep(Duration::from_millis(2));
        }
        let start = frame_when_ready(&hub, path, held(0.0, (64, 36)), &open);
        assert_eq!((start.presentation_seconds * 30.0).round(), 0.0);
    }

    #[test]
    fn a_moment_is_ready_once_its_frame_is_decoded() {
        let hub = LiveHub::new();
        let open = opener(Arc::default(), Arc::default());
        let path = Path::new("/live-ready.mp4");
        assert_eq!(hub.readiness(path, 4.0), Readiness::Unasked);
        ask_hub(&hub, path, held(4.0, (64, 36)), &open);
        frame_when_ready(&hub, path, held(4.0, (64, 36)), &open);
        assert_eq!(hub.readiness(path, 4.0), Readiness::Ready);
        assert_eq!(
            hub.readiness(path, 40.0),
            Readiness::Preparing,
            "somewhere it has not got to"
        );
    }

    #[test]
    fn nobody_asking_lets_the_decoder_go() {
        let hub = LiveHub::new();
        let open = opener(Arc::default(), Arc::default());
        let path = Path::new("/live-idle.mp4");
        frame_when_ready(&hub, path, held(0.0, (64, 36)), &open);
        assert!(hub.is_decoding(path));
        let deadline = Instant::now() + KEEP_FOR + Duration::from_secs(3);
        while hub.is_decoding(path) {
            assert!(
                Instant::now() < deadline,
                "still decoding with nobody asking"
            );
            std::thread::sleep(Duration::from_millis(50));
        }
    }

    #[test]
    fn the_decoder_aims_from_the_picture_furthest_behind_to_the_one_furthest_ahead() {
        let start = Instant::now();
        let mut inner = Entry::new(
            Path::new("/aim.mp4"),
            "x",
            &opener(Arc::default(), Arc::default()),
        )
        .inner
        .into_inner()
        .unwrap();
        inner.record(held(10.0, (1920, 1080)), start);
        inner.record(held(10.1, (1280, 720)), start);
        inner.record(held(9.95, (2000, 500)), start);
        let aim = inner.aim(start).expect("asked");
        assert_eq!(aim.floor, 9.95);
        assert_eq!(aim.target, 10.1);
        assert_eq!(aim.bounds, (2000, 1080));
        // A running ask moves on with the time since it was made.
        inner.record(
            Ask {
                playing: true,
                rate: 2.0,
                ..held(10.1, (64, 36))
            },
            start,
        );
        let later = inner
            .aim(start + Duration::from_millis(100))
            .expect("asked");
        assert!((later.target - 10.3).abs() < 1e-9);
        // Nobody asked lately: no aim at all.
        assert_eq!(inner.aim(start + FRESH * 2), None);
    }

    #[test]
    fn the_decoder_seeks_steps_or_holds_by_where_the_pictures_are() {
        let aim = |floor: f64, target: f64| Aim {
            floor,
            target,
            playing: true,
            bounds: (64, 36),
        };
        let frame = 1.0 / 30.0;
        assert_eq!(
            decide(None, None, true, &aim(4.0, 4.1), false, 0.0, frame),
            Step::Decode
        );
        assert_eq!(
            decide(None, None, true, &aim(4.0, 4.1), true, 4.0, frame),
            Step::Hold
        );
        assert_eq!(
            decide(
                Some(3.9),
                Some(4.0),
                true,
                &aim(4.0, 4.1),
                false,
                0.0,
                frame
            ),
            Step::Decode,
            "behind the panel furthest ahead"
        );
        assert_eq!(
            decide(
                Some(3.9),
                Some(4.1),
                true,
                &aim(4.0, 4.1),
                false,
                0.0,
                frame
            ),
            Step::Hold,
            "far enough ahead"
        );
        assert_eq!(
            decide(
                Some(3.9),
                Some(4.0),
                false,
                &aim(4.0, 4.1),
                false,
                0.0,
                frame
            ),
            Step::Hold,
            "never more than it keeps"
        );
        assert_eq!(
            decide(
                Some(10.0),
                Some(10.2),
                true,
                &aim(2.0, 2.1),
                false,
                0.0,
                frame
            ),
            Step::Seek(2.0),
            "the operator went back"
        );
        assert_eq!(
            decide(
                Some(1.0),
                Some(1.2),
                true,
                &aim(30.0, 30.1),
                false,
                0.0,
                frame
            ),
            Step::Seek(30.0),
            "the operator went forward"
        );
        assert_eq!(
            decide(None, None, true, &aim(0.0, 0.1), true, 12.0, frame),
            Step::Seek(0.0),
            "sent past the end, and the video started again"
        );
        assert_eq!(
            decide(None, None, true, &aim(12.0, 12.1), true, 12.0, frame),
            Step::Hold,
            "still past the end: nothing more to decode"
        );
    }

    #[test]
    fn a_large_picture_keeps_fewer_frames() {
        assert_eq!(most_frames(1920 * 1080 * 4), MAX_FRAMES);
        assert_eq!(most_frames(3840 * 2160 * 4), 3);
        assert_eq!(most_frames(64 * 36 * 4), MAX_FRAMES);
    }

    #[test]
    fn a_bigger_picture_reopens_the_decoder_and_a_smaller_one_mostly_does_not() {
        assert!(!outgrown((1920, 1080), (1920, 1080)));
        assert!(
            outgrown((960, 540), (1920, 1080)),
            "the output window opened"
        );
        assert!(!outgrown((1920, 1080), (1280, 720)), "still worth keeping");
        assert!(outgrown((1920, 1080), (960, 540)), "only the preview left");
    }

    #[test]
    fn the_frame_for_a_moment_is_the_last_one_before_it() {
        let frame = |seconds: f64| {
            Arc::new(VideoFrame {
                width: 1,
                height: 1,
                bgra: vec![0; 4],
                presentation_seconds: seconds,
            })
        };
        let frames: VecDeque<_> = [1.0, 1.04, 1.08].into_iter().map(frame).collect();
        let at = |seconds: f64| pick(&frames, seconds).map(|frame| frame.presentation_seconds);
        assert_eq!(at(1.05), Some(1.04));
        assert_eq!(at(1.08), Some(1.08));
        assert_eq!(at(0.5), Some(1.0), "the first, when all are after it");
        assert_eq!(at(9.0), Some(1.08));

        let mut kept = frames.clone();
        evict(&mut kept, 1.05);
        assert_eq!(kept.len(), 2, "the frame on screen at the floor stays");
        evict(&mut kept, 9.0);
        assert_eq!(kept.len(), 1, "the last frame always stays");
    }
}
