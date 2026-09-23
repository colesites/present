//! The background video, at the instant a frame is being drawn.
//!
//! The NDI stream is a mirror, and it keeps time the way the audience window's
//! own `<video>` does (`OutputWindow.tsx:437`): it plays on its own clock and
//! is corrected only when the operator's player says it has drifted by more
//! than `MIRROR_DRIFT_TOLERANCE`. It does not re-anchor on every position
//! report. Reports arrive about ten times a second and a few tens of
//! milliseconds stale, so following each one would step the video back and
//! forward ten times a second — a judder on the stream that the projector,
//! playing freely, does not have.
//!
//! The decoder is pulled, never pushed (ADR-002): this decides which frame is
//! due and asks for exactly that. **It never waits for one** once a frame is
//! on screen: a decoder that cannot keep up (4K on a slow machine) leaves the
//! video showing its latest frame while the slide and the stream keep their
//! rate. Waiting instead stalled the whole stream, and the catching up that
//! followed stalled it again, down to two frames a second.

use std::sync::mpsc::{self, Receiver, TryRecvError};
use std::sync::Arc;
use std::time::{Duration, Instant};

use crate::services::output::{MediaKind, OutputScene};
use crate::services::playback::MIRROR_DRIFT_TOLERANCE;
use crate::services::video::{Polled, VideoDecoder, VideoFrame};

/// Decode forward while the frame on hand is more than this far behind.
///
/// Half of one frame of the 30 fps stream. A 30 fps video then decodes exactly
/// one frame per stream frame, a 60 fps video two, and a 24 fps video
/// occasionally none — each the right answer.
pub const ADVANCE_WHEN_BEHIND: f64 = 1.0 / 60.0;

/// Further behind than this, seeking is cheaper than decoding forward.
pub const SEEK_WHEN_BEHIND: f64 = 1.0;

/// The most frames decoded for one stream frame before seeking instead. Bounds
/// what one frame can cost.
pub const MAX_DECODES_PER_FRAME: usize = 8;

/// Where the video was known to be, and when.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Anchor {
    pub seconds: f64,
    pub playing: bool,
    pub at: Instant,
}

/// Where the video should be at `now`.
///
/// A looping video wraps here when its duration is known, so the decoder is
/// simply asked for an earlier position and seeks to it.
pub fn target_seconds(anchor: &Anchor, now: Instant, looping: bool, duration: Option<f64>) -> f64 {
    let elapsed = if anchor.playing {
        now.saturating_duration_since(anchor.at).as_secs_f64()
    } else {
        0.0
    };
    let mut seconds = anchor.seconds + elapsed;
    if !seconds.is_finite() || seconds < 0.0 {
        seconds = 0.0;
    }
    if let Some(duration) = duration.filter(|value| value.is_finite() && *value > 0.0) {
        seconds = if looping {
            seconds % duration
        } else {
            seconds.min(duration)
        };
    }
    seconds
}

/// Whether a fresh position report should move the anchor.
///
/// Only when play state changed, or when the report disagrees with where this
/// clock already has the video by more than the mirror tolerance — which is a
/// seek, not the ordinary lag of a report.
pub fn should_reanchor(predicted: f64, reported: f64, was_playing: bool, playing: bool) -> bool {
    was_playing != playing || (reported - predicted).abs() > MIRROR_DRIFT_TOLERANCE
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub enum Step {
    /// The frame on hand is the right one.
    Hold,
    /// Decode the next frame.
    Advance,
    /// Jump to this position.
    Seek(f64),
}

pub fn next_step(current: Option<f64>, target: f64) -> Step {
    match current {
        None if target > MIRROR_DRIFT_TOLERANCE => Step::Seek(target),
        None => Step::Advance,
        // Ahead of where it should be: the operator went backwards, or the
        // video wrapped.
        Some(shown) if shown - target > MIRROR_DRIFT_TOLERANCE => Step::Seek(target),
        Some(shown) if target - shown > SEEK_WHEN_BEHIND => Step::Seek(target),
        Some(shown) if target - shown > ADVANCE_WHEN_BEHIND => Step::Advance,
        Some(_) => Step::Hold,
    }
}

/// Opens a video for a URL at a size. Where the file scope is checked.
///
/// Owned and shareable, because opening happens on a thread of its own: a
/// video's first frame is decoded as it opens, and the stream cannot wait for
/// that inside its 33 ms.
pub type Opener =
    Arc<dyn Fn(&str, (u32, u32)) -> Result<Box<dyn VideoDecoder>, String> + Send + Sync>;

/// A video being opened, which the stream does not wait for.
struct Opening {
    url: String,
    size: (u32, u32),
    decoder: Receiver<Result<Box<dyn VideoDecoder>, String>>,
}

struct Playing {
    url: String,
    size: (u32, u32),
    decoder: Box<dyn VideoDecoder>,
    frame: Option<VideoFrame>,
    anchor: Anchor,
    /// The last position report seen, to tell a fresh report from a repeat.
    last_reported: f64,
    /// Where a seek was asked for whose first frame has not arrived, if one
    /// is on its way. The frame on hand is from before it, and is no reason to
    /// seek again.
    ///
    /// When it was asked for, and not merely "yes": a report that moved the
    /// anchor used to cancel this, and the next frame asked for another seek
    /// to almost the same place. The decoder was told to seek faster than it
    /// could answer, so it never delivered a frame at all and the background
    /// held whatever it had — for the rest of the service. Now a seek is
    /// waited for while it is still going roughly where the stream wants to
    /// be, and replaced when the operator has gone somewhere else.
    awaiting_seek: Option<(f64, Instant)>,
    /// When decoding last failed, if it has.
    ///
    /// Holds whatever frame was on hand rather than retrying thirty times a
    /// second — but not for ever. It used to be a plain flag that nothing
    /// cleared, so one failed seek left the background frozen on one frame for
    /// the rest of the service, on the stream and in the operator's preview.
    /// A video that stops decoding is re-opened after [`RECOVER_AFTER`].
    broken_at: Option<Instant>,
}

/// How long a video that stopped decoding is left alone before it is opened
/// again. Long enough not to thrash a file that is genuinely unreadable,
/// short enough that a congregation sees a background come back.
const RECOVER_AFTER: Duration = Duration::from_secs(2);

/// How long a seek is given to produce its frame before it is asked again.
///
/// Long enough that a 4K seek on a slow disk is waited for rather than
/// cancelled — cancelling it is what wedged the decoder — and short enough
/// that one lost in an error never leaves the background still.
const SEEK_PATIENCE: Duration = Duration::from_millis(1500);

/// One background video, followed across frames.
#[derive(Default)]
pub struct VideoFeed {
    playing: Option<Playing>,
    /// Being opened on another thread; there is no frame until it arrives.
    opening: Option<Opening>,
    /// A video that would not open, so it is not re-opened every frame.
    refused: Option<(String, (u32, u32))>,
}

impl VideoFeed {
    pub fn new() -> Self {
        Self::default()
    }

    /// Whether a video is being opened: there is no frame yet, and that is
    /// not a failure.
    pub fn is_opening(&self) -> bool {
        self.opening.is_some()
    }

    /// Open a video on a thread of its own. The stream draws on meanwhile.
    fn start_opening(&mut self, url: &str, size: (u32, u32), open: &Opener) {
        let (sender, receiver) = mpsc::channel();
        let open = Arc::clone(open);
        let path = url.to_owned();
        let started = std::thread::Builder::new()
            .name("video-open".to_owned())
            .spawn(move || {
                // Nobody is left to tell if the feed moved on; that is fine.
                let _ = sender.send(open(&path, size));
            });
        match started {
            Ok(_) => {
                self.opening = Some(Opening {
                    url: url.to_owned(),
                    size,
                    decoder: receiver,
                })
            }
            Err(error) => {
                tracing::warn!(%error, url, "could not start opening a background video");
                self.refused = Some((url.to_owned(), size));
            }
        }
    }

    /// Take the opened video if it is ready. `None` while it is not.
    fn take_opened(
        &mut self,
        url: &str,
        size: (u32, u32),
        scene: &OutputScene,
        now: Instant,
    ) -> Option<()> {
        let opened = match self.opening.as_ref()?.decoder.try_recv() {
            Ok(opened) => opened,
            Err(TryRecvError::Empty) => return None,
            // The thread went away without an answer.
            Err(TryRecvError::Disconnected) => {
                self.opening = None;
                self.refused = Some((url.to_owned(), size));
                return None;
            }
        };
        self.opening = None;
        match opened {
            Ok(decoder) => {
                self.refused = None;
                self.playing = Some(Playing {
                    url: url.to_owned(),
                    size,
                    decoder,
                    frame: None,
                    anchor: Anchor {
                        seconds: scene.video_current_time,
                        playing: scene.is_video_playing,
                        at: now,
                    },
                    last_reported: scene.video_current_time,
                    awaiting_seek: None,
                    broken_at: None,
                });
                Some(())
            }
            Err(error) => {
                tracing::warn!(%error, url, "the NDI stream could not open its background video");
                self.refused = Some((url.to_owned(), size));
                None
            }
        }
    }

    /// The video frame for `scene` at `now`, if the scene shows a video.
    ///
    /// Errors are logged, not returned: a video that will not play leaves the
    /// background empty and the slide still on the stream.
    pub fn frame_for(
        &mut self,
        scene: &OutputScene,
        now: Instant,
        size: (u32, u32),
        open: &Opener,
    ) -> Option<&VideoFrame> {
        let url = scene
            .media_url
            .as_deref()
            .filter(|url| !url.is_empty())
            .filter(|_| scene.media_type == Some(MediaKind::Video))
            .filter(|_| scene.show_media && !scene.hide_background);

        let Some(url) = url else {
            // Nothing to show: let the decoder and its file go.
            self.playing = None;
            self.opening = None;
            return None;
        };

        let current = self
            .playing
            .as_ref()
            .is_some_and(|playing| playing.url == url && playing.size == size);
        if !current {
            self.playing = None;
            let refused = self
                .refused
                .as_ref()
                .is_some_and(|(refused, at)| refused == url && *at == size);
            if refused {
                return None;
            }
            let opening = self
                .opening
                .as_ref()
                .is_some_and(|opening| opening.url == url && opening.size == size);
            if !opening {
                self.start_opening(url, size, open);
                return None;
            }
            match self.take_opened(url, size, scene, now) {
                Some(()) => {}
                // Still opening: the slide keeps going out without it.
                None => return None,
            }
        }

        let playing = self.playing.as_mut()?;
        let looping = scene.video_settings.loop_;
        let duration = playing.decoder.duration_seconds();

        // A fresh report moves the anchor only if it says the video is
        // somewhere this clock does not already have it.
        if scene.video_current_time != playing.last_reported
            || scene.is_video_playing != playing.anchor.playing
        {
            let predicted = target_seconds(&playing.anchor, now, looping, duration);
            if should_reanchor(
                predicted,
                scene.video_current_time,
                playing.anchor.playing,
                scene.is_video_playing,
            ) {
                playing.anchor = Anchor {
                    seconds: scene.video_current_time,
                    playing: scene.is_video_playing,
                    at: now,
                };
                // The seek on its way is not cancelled here: `advance`
                // replaces it only if the new target is somewhere else
                // entirely, so a run of small corrections cannot stop the
                // decoder ever answering one.
            }
            playing.last_reported = scene.video_current_time;
        }

        match playing.broken_at {
            // Long enough since it failed: let the decoder and its file go, so
            // the open path above makes a new one on the next frame.
            Some(failed_at) if now.duration_since(failed_at) >= RECOVER_AFTER => {
                tracing::info!(url, "opening the background video again");
                self.playing = None;
                return None;
            }
            Some(_) => {}
            None => {
                let target = target_seconds(&playing.anchor, now, looping, duration);
                match advance(playing, now, target) {
                    Ok(Advanced::Ended) if looping => {
                        // A loop whose length is unknown cannot wrap in
                        // `target_seconds`, and one that ends a frame early
                        // has nothing left to show. Either way it starts again.
                        playing.anchor = Anchor {
                            seconds: 0.0,
                            playing: playing.anchor.playing,
                            at: now,
                        };
                        if let Err(error) = restart(playing, now) {
                            tracing::warn!(%error, url, "the background video would not loop");
                            playing.broken_at = Some(now);
                        }
                    }
                    Ok(_) => {}
                    Err(error) => {
                        tracing::warn!(%error, url, "the background video stopped decoding");
                        playing.broken_at = Some(now);
                    }
                }
            }
        }

        self.playing.as_ref()?.frame.as_ref()
    }
}

enum Advanced {
    UpToDate,
    /// The decoder ran out of frames. The last one stays on hand.
    Ended,
}

/// What asking the decoder for a frame came to.
enum Took {
    Frame,
    /// Not decoded yet; the frame on hand stays up.
    Pending,
    Ended,
}

/// Bring the frame on hand up to `target`, as far as the decoder has frames
/// ready.
fn advance(playing: &mut Playing, now: Instant, target: f64) -> Result<Advanced, String> {
    if let Some((sought, asked_at)) = playing.awaiting_seek {
        // Where that seek was going, carried forward by the time it has been
        // waiting: a playing video's target moves on while the decoder works,
        // and that drift is not the operator going anywhere.
        let waited = now.duration_since(asked_at);
        let still_going_to = if playing.anchor.playing {
            sought + waited.as_secs_f64()
        } else {
            sought
        };
        // Somewhere else entirely, or it has had long enough: ask again.
        // Otherwise wait, because asking again for a place it is already
        // going to is how a decoder seeks for ever and shows nothing.
        if (still_going_to - target).abs() > SEEK_WHEN_BEHIND || waited > SEEK_PATIENCE {
            return seek_and_take(playing, now, target);
        }
        match take_one(playing)? {
            Took::Frame => {}
            Took::Pending => return Ok(Advanced::UpToDate),
            Took::Ended => return Ok(Advanced::Ended),
        }
    }
    let mut decodes = 0;
    loop {
        let shown = playing
            .frame
            .as_ref()
            .map(|frame| frame.presentation_seconds);
        match next_step(shown, target) {
            Step::Hold => return Ok(Advanced::UpToDate),
            Step::Seek(seconds) => return seek_and_take(playing, now, seconds),
            Step::Advance if decodes == MAX_DECODES_PER_FRAME => {
                return seek_and_take(playing, now, target)
            }
            Step::Advance => {
                decodes += 1;
                match take_one(playing)? {
                    Took::Frame => {}
                    Took::Pending => return Ok(Advanced::UpToDate),
                    Took::Ended => return Ok(Advanced::Ended),
                }
            }
        }
    }
}

fn seek_and_take(playing: &mut Playing, now: Instant, seconds: f64) -> Result<Advanced, String> {
    playing
        .decoder
        .seek(seconds)
        .map_err(|error| error.to_string())?;
    playing.awaiting_seek = Some((seconds, now));
    // Whatever is on hand stays up until the new position's frame arrives.
    Ok(match take_one(playing)? {
        Took::Ended => Advanced::Ended,
        Took::Frame | Took::Pending => Advanced::UpToDate,
    })
}

fn restart(playing: &mut Playing, now: Instant) -> Result<(), String> {
    seek_and_take(playing, now, 0.0).map(|_| ())
}

/// Take the decoder's next frame into `playing` if it is ready.
///
/// Never waits, not even for a video's first frame. The background is empty
/// for the frame or two before it arrives — at 4K, where the first frame after
/// a seek is decoded from the key frame before it, that wait was a third of a
/// second of frozen stream, lyrics and all.
fn take_one(playing: &mut Playing) -> Result<Took, String> {
    match playing
        .decoder
        .poll_frame()
        .map_err(|error| error.to_string())?
    {
        Polled::Frame(frame) if frame.is_well_formed() => {
            playing.frame = Some(frame);
            playing.awaiting_seek = None;
            Ok(Took::Frame)
        }
        Polled::Frame(_) => Err("the decoder produced a malformed frame".to_owned()),
        Polled::Pending => Ok(Took::Pending),
        Polled::Ended => {
            playing.awaiting_seek = None;
            Ok(Took::Ended)
        }
    }
}

#[cfg(test)]
mod tests {
    use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
    use std::sync::{Arc, Mutex};
    use std::time::Duration;

    use super::*;
    use crate::services::output::VideoSettings;
    use crate::services::video::VideoError;

    const EPSILON: f64 = 1e-9;
    /// One frame of the 30 fps stream, as the sender's clock spaces them.
    const STREAM_FRAME: Duration = Duration::from_micros(33_333);

    type Log = Arc<Mutex<Vec<String>>>;

    fn anchor(seconds: f64, playing: bool, at: Instant) -> Anchor {
        Anchor {
            seconds,
            playing,
            at,
        }
    }

    #[test]
    fn a_playing_video_moves_with_the_clock_and_a_paused_one_does_not() {
        let start = Instant::now();
        let later = start + Duration::from_millis(500);
        let playing = target_seconds(&anchor(10.0, true, start), later, false, None);
        assert!((playing - 10.5).abs() < EPSILON);
        assert_eq!(
            target_seconds(&anchor(10.0, false, start), later, false, None),
            10.0
        );
    }

    #[test]
    fn a_looping_video_wraps_and_a_finished_one_stops_at_its_end() {
        let start = Instant::now();
        let later = start + Duration::from_secs(3);
        let looped = target_seconds(&anchor(9.0, true, start), later, true, Some(10.0));
        assert!((looped - 2.0).abs() < EPSILON);
        assert_eq!(
            target_seconds(&anchor(9.0, true, start), later, false, Some(10.0)),
            10.0
        );
    }

    #[test]
    fn an_impossible_position_starts_from_the_beginning() {
        let now = Instant::now();
        assert_eq!(
            target_seconds(&anchor(f64::NAN, false, now), now, false, None),
            0.0
        );
        assert_eq!(
            target_seconds(&anchor(-4.0, false, now), now, false, None),
            0.0
        );
    }

    #[test]
    fn a_report_that_lags_by_less_than_the_mirror_tolerance_is_absorbed() {
        // The ordinary case, ten times a second. Re-anchoring on it would step
        // the stream backwards by the lag every time.
        assert!(!should_reanchor(12.30, 12.25, true, true));
        assert!(!should_reanchor(12.30, 12.19, true, true));
    }

    #[test]
    fn a_seek_or_a_pause_moves_the_anchor() {
        assert!(
            should_reanchor(12.30, 40.0, true, true),
            "the operator seeked"
        );
        assert!(
            should_reanchor(12.30, 12.30, true, false),
            "the operator paused"
        );
        assert!(
            should_reanchor(12.30, 12.30, false, true),
            "the operator pressed play"
        );
    }

    #[test]
    fn the_decoder_holds_steps_or_seeks_by_how_far_off_it_is() {
        assert_eq!(next_step(None, 0.0), Step::Advance);
        assert_eq!(next_step(None, 30.0), Step::Seek(30.0));
        assert_eq!(next_step(Some(10.0), 10.01), Step::Hold);
        assert_eq!(next_step(Some(10.0), 10.03), Step::Advance);
        assert_eq!(next_step(Some(10.0), 12.0), Step::Seek(12.0), "far behind");
        assert_eq!(
            next_step(Some(10.0), 2.0),
            Step::Seek(2.0),
            "went backwards"
        );
        assert_eq!(
            next_step(Some(10.1), 10.0),
            Step::Hold,
            "a hair ahead is fine"
        );
    }

    /// A 30 fps video of `frames` frames, recording what was asked of it.
    struct FakeDecoder {
        next: usize,
        frames: usize,
        knows_duration: bool,
        log: Log,
        /// Frames a poll finds ready, like a decoder working ahead. `None`
        /// decodes on every poll.
        ready: Option<Arc<AtomicUsize>>,
        /// Fails from this frame on, as a file going away mid-service does.
        fails_from: Option<usize>,
    }

    impl VideoDecoder for FakeDecoder {
        fn next_frame(&mut self) -> Result<Option<VideoFrame>, VideoError> {
            if self.fails_from.is_some_and(|from| self.next >= from) {
                self.log.lock().unwrap().push("fail".to_owned());
                return Err(VideoError::Decode("the file went away".to_owned()));
            }
            let mut log = self.log.lock().unwrap();
            if self.next >= self.frames {
                log.push("end".to_owned());
                return Ok(None);
            }
            log.push(format!("decode {}", self.next));
            let frame = VideoFrame {
                width: 2,
                height: 2,
                bgra: vec![0; 16],
                presentation_seconds: self.next as f64 / 30.0,
            };
            self.next += 1;
            Ok(Some(frame))
        }

        fn seek(&mut self, seconds: f64) -> Result<(), VideoError> {
            self.log.lock().unwrap().push(format!("seek {seconds:.2}"));
            self.next = (seconds * 30.0).round() as usize;
            Ok(())
        }

        fn duration_seconds(&self) -> Option<f64> {
            self.knows_duration.then(|| self.frames as f64 / 30.0)
        }

        fn dimensions(&self) -> (u32, u32) {
            (2, 2)
        }

        fn poll_frame(&mut self) -> Result<Polled, VideoError> {
            if let Some(ready) = &self.ready {
                let taken = ready.fetch_update(Ordering::SeqCst, Ordering::SeqCst, |count| {
                    count.checked_sub(1)
                });
                if taken.is_err() {
                    return Ok(Polled::Pending);
                }
            }
            Ok(match self.next_frame()? {
                Some(frame) => Polled::Frame(frame),
                None => Polled::Ended,
            })
        }
    }

    struct Harness {
        feed: VideoFeed,
        log: Log,
        opens: Arc<Mutex<usize>>,
        frames: usize,
        knows_duration: bool,
        ready: Option<Arc<AtomicUsize>>,
        fails_from: Option<usize>,
    }

    impl Harness {
        fn new(frames: usize) -> Self {
            Self {
                feed: VideoFeed::new(),
                log: Arc::default(),
                opens: Arc::default(),
                frames,
                knows_duration: true,
                ready: None,
                fails_from: None,
            }
        }

        /// A harness whose decoder has only `ready` frames ready at a time.
        fn working_ahead(frames: usize) -> (Self, Arc<AtomicUsize>) {
            let ready = Arc::new(AtomicUsize::new(0));
            let mut harness = Self::new(frames);
            harness.ready = Some(Arc::clone(&ready));
            (harness, ready)
        }

        fn seeks(&self) -> usize {
            self.log()
                .iter()
                .filter(|entry| entry.starts_with("seek"))
                .count()
        }

        /// The frame number shown for `scene` at `now`.
        fn shown(&mut self, scene: &OutputScene, now: Instant) -> Option<usize> {
            let (log, opens, frames, knows_duration, ready, fails_from) = (
                self.log.clone(),
                self.opens.clone(),
                self.frames,
                self.knows_duration,
                self.ready.clone(),
                self.fails_from,
            );
            let open: Opener = Arc::new(
                move |_url: &str, _size: (u32, u32)| -> Result<Box<dyn VideoDecoder>, String> {
                    *opens.lock().unwrap() += 1;
                    Ok(Box::new(FakeDecoder {
                        next: 0,
                        frames,
                        knows_duration,
                        log: log.clone(),
                        ready: ready.clone(),
                        fails_from,
                    }))
                },
            );
            // Opening happens on a thread; this one returns instantly, so the
            // tests written before it did read as they did.
            let deadline = Instant::now() + Duration::from_secs(2);
            loop {
                let shown = self
                    .feed
                    .frame_for(scene, now, (2, 2), &open)
                    .map(|frame| (frame.presentation_seconds * 30.0).round() as usize);
                if !self.feed.is_opening() || Instant::now() > deadline {
                    return shown;
                }
                std::thread::sleep(Duration::from_millis(1));
            }
        }

        fn log(&self) -> Vec<String> {
            self.log.lock().unwrap().clone()
        }
    }

    fn video_scene(time: f64, playing: bool, looping: bool) -> OutputScene {
        OutputScene {
            media_url: Some("local-media://media/loop.mp4".to_owned()),
            media_type: Some(MediaKind::Video),
            show_media: true,
            is_video_playing: playing,
            video_current_time: time,
            video_settings: VideoSettings {
                loop_: looping,
                muted: true,
            },
            ..OutputScene::default()
        }
    }

    /// The owner's report: the preview freezes on one frame after a while.
    ///
    /// It was a decode error, and the flag that recorded one was never
    /// cleared — so one bad seek held the background on a single frame for the
    /// rest of the service, on the stream as well as in the preview.
    #[test]
    fn a_video_that_stops_decoding_is_opened_again_rather_than_frozen() {
        let mut harness = Harness::new(300);
        harness.fails_from = Some(4);
        let start = Instant::now();
        let scene = video_scene(0.0, true, false);

        // It plays until the file goes away.
        let played: Vec<Option<usize>> = (0..4u32)
            .map(|tick| harness.shown(&scene, start + STREAM_FRAME * tick))
            .collect();
        assert_eq!(played, vec![Some(0), Some(1), Some(2), Some(3)]);

        // The frame on hand stays up rather than the screen going black, and
        // the decoder is not asked again thirty times a second.
        let held = harness.shown(&scene, start + STREAM_FRAME * 5);
        assert_eq!(held, Some(3), "the last good frame is held");
        let failures = |log: Vec<String>| log.iter().filter(|entry| *entry == "fail").count();
        let after_failing = failures(harness.log());
        for tick in 6..20u32 {
            assert_eq!(harness.shown(&scene, start + STREAM_FRAME * tick), Some(3));
        }
        assert_eq!(failures(harness.log()), after_failing, "it stopped asking");

        // And then it is opened again, and plays.
        let opens_before = *harness.opens.lock().unwrap();
        // It failed at the fifth frame, so the wait runs from there.
        let ready_at = start + STREAM_FRAME * 4 + RECOVER_AFTER;
        let recovered = harness.shown(&scene, ready_at + STREAM_FRAME);
        assert_eq!(
            recovered, None,
            "the frame it was holding is let go with it"
        );
        let playing_again = harness.shown(&scene, ready_at + STREAM_FRAME * 2);
        assert!(playing_again.is_some(), "a new decoder is playing it");
        assert_eq!(
            *harness.opens.lock().unwrap(),
            opens_before + 1,
            "opened once more, not on every frame"
        );
    }

    #[test]
    fn a_30_fps_video_decodes_one_frame_per_stream_frame() {
        let mut harness = Harness::new(300);
        let start = Instant::now();
        let scene = video_scene(0.0, true, false);

        let shown: Vec<usize> = (0..10u32)
            .map(|tick| {
                harness
                    .shown(&scene, start + STREAM_FRAME * tick)
                    .expect("a frame")
            })
            .collect();

        assert_eq!(
            shown,
            (0..10).collect::<Vec<_>>(),
            "no frame skipped or repeated"
        );
        assert_eq!(*harness.opens.lock().unwrap(), 1, "opened once");
        assert!(
            harness
                .log()
                .iter()
                .all(|entry| entry.starts_with("decode")),
            "{:?}",
            harness.log()
        );
    }

    #[test]
    fn lagging_position_reports_do_not_make_the_stream_judder() {
        // Reports every 100 ms, each 40 ms stale. Following each one would show
        // a frame twice and then skip one.
        let mut harness = Harness::new(300);
        let start = Instant::now();

        let shown: Vec<usize> = (0..30u32)
            .map(|tick| {
                let now = start + STREAM_FRAME * tick;
                let elapsed = now.duration_since(start).as_secs_f64();
                let reported = ((elapsed * 10.0).floor() / 10.0 - 0.04).max(0.0);
                harness
                    .shown(&video_scene(reported, true, false), now)
                    .expect("a frame")
            })
            .collect();

        assert!(
            shown.windows(2).all(|pair| pair[1] == pair[0] + 1),
            "every stream frame advances by exactly one video frame: {shown:?}"
        );
    }

    #[test]
    fn an_operator_seek_moves_the_stream_there() {
        let mut harness = Harness::new(3000);
        let start = Instant::now();
        harness.shown(&video_scene(0.0, true, false), start);

        let shown = harness
            .shown(&video_scene(40.0, true, false), start + STREAM_FRAME)
            .expect("a frame");
        assert_eq!(shown, 1200, "40 s in");
        assert!(harness.log().iter().any(|entry| entry == "seek 40.00"));
    }

    #[test]
    fn a_paused_video_holds_its_frame_without_decoding() {
        let mut harness = Harness::new(300);
        let start = Instant::now();
        let scene = video_scene(0.0, false, false);
        harness.shown(&scene, start);
        let before = harness.log().len();

        for tick in 1..10u64 {
            harness.shown(&scene, start + Duration::from_secs(tick));
        }
        assert_eq!(harness.log().len(), before);
    }

    #[test]
    fn a_looping_video_starts_again_rather_than_freezing_on_its_last_frame() {
        let mut harness = Harness::new(30);
        let start = Instant::now();
        let scene = video_scene(0.0, true, true);

        let shown: Vec<usize> = (0..45u32)
            .map(|tick| {
                harness
                    .shown(&scene, start + STREAM_FRAME * tick)
                    .expect("a frame")
            })
            .collect();

        assert_eq!(shown[44], 14, "45 frames into a 30-frame loop: {shown:?}");
        let decodes = harness
            .log()
            .iter()
            .filter(|entry| entry.starts_with("decode"))
            .count();
        assert!(
            decodes <= 47,
            "the wrap costs a seek, not a burst of decodes: {decodes} for 45 frames"
        );
    }

    #[test]
    fn a_loop_of_unknown_length_still_starts_again() {
        let mut harness = Harness::new(30);
        harness.knows_duration = false;
        let start = Instant::now();
        let scene = video_scene(0.0, true, true);

        let shown: Vec<usize> = (0..45u32)
            .map(|tick| {
                harness
                    .shown(&scene, start + STREAM_FRAME * tick)
                    .expect("a frame")
            })
            .collect();

        assert!(shown[44] < 20, "it went round again: {shown:?}");
    }

    #[test]
    fn a_decoder_that_falls_behind_leaves_its_last_frame_up_without_waiting() {
        let (mut harness, ready) = Harness::working_ahead(300);
        let start = Instant::now();
        let scene = video_scene(0.0, true, false);
        // Not even the first frame is waited for; it appears when it is ready.
        assert_eq!(harness.shown(&scene, start), None, "nothing ready yet");
        ready.store(1, Ordering::SeqCst);
        assert_eq!(harness.shown(&scene, start), Some(0));

        for tick in 1..6u32 {
            assert_eq!(
                harness.shown(&scene, start + STREAM_FRAME * tick),
                Some(0),
                "nothing ready at tick {tick}: the frame on hand stays"
            );
        }
        assert_eq!(harness.seeks(), 0, "a few frames behind is not a seek");

        ready.store(10, Ordering::SeqCst);
        assert_eq!(
            harness.shown(&scene, start + STREAM_FRAME * 6),
            Some(6),
            "caught up from what was ready"
        );
    }

    #[test]
    fn a_seek_waits_for_its_frame_rather_than_seeking_again() {
        let (mut harness, ready) = Harness::working_ahead(3000);
        let start = Instant::now();
        ready.store(1, Ordering::SeqCst);
        assert_eq!(
            harness.shown(&video_scene(0.0, true, false), start),
            Some(0)
        );

        let sought = video_scene(40.0, true, false);
        for tick in 1..40u32 {
            assert_eq!(
                harness.shown(&sought, start + STREAM_FRAME * tick),
                Some(0),
                "the old frame stays up while the seek is on its way"
            );
        }
        assert_eq!(harness.seeks(), 1, "{:?}", harness.log());

        ready.store(1, Ordering::SeqCst);
        assert_eq!(
            harness.shown(&sought, start + STREAM_FRAME * 40),
            Some(1200),
            "the seek's own frame, 40 s in"
        );
    }

    #[test]
    fn a_new_seek_replaces_one_still_on_its_way() {
        let (mut harness, ready) = Harness::working_ahead(3000);
        let start = Instant::now();
        harness.shown(&video_scene(0.0, true, false), start);
        harness.shown(&video_scene(40.0, true, false), start + STREAM_FRAME);
        harness.shown(&video_scene(80.0, true, false), start + STREAM_FRAME * 2);
        assert!(harness.log().iter().any(|entry| entry == "seek 80.00"));

        ready.store(1, Ordering::SeqCst);
        assert_eq!(
            harness.shown(&video_scene(80.0, true, false), start + STREAM_FRAME * 3),
            Some(2400)
        );
    }

    #[test]
    fn the_stream_draws_on_while_a_video_opens() {
        // A file that takes its time: opening decodes its first frame.
        let opened = Arc::new(AtomicUsize::new(0));
        let release = Arc::new(AtomicBool::new(false));
        let (opened_in_thread, release_in_thread) = (opened.clone(), release.clone());
        let open: Opener = Arc::new(move |_url: &str, _size: (u32, u32)| {
            while !release_in_thread.load(Ordering::SeqCst) {
                std::thread::sleep(Duration::from_millis(1));
            }
            opened_in_thread.fetch_add(1, Ordering::SeqCst);
            Ok(Box::new(FakeDecoder {
                next: 0,
                frames: 90,
                knows_duration: true,
                log: Arc::default(),
                ready: None,
                fails_from: None,
            }) as Box<dyn VideoDecoder>)
        });

        let mut feed = VideoFeed::new();
        let scene = video_scene(0.0, true, false);
        let started = Instant::now();
        for _ in 0..5 {
            assert!(
                feed.frame_for(&scene, Instant::now(), (2, 2), &open)
                    .is_none(),
                "no frame until the file is open"
            );
            assert!(feed.is_opening());
        }
        assert!(
            started.elapsed() < Duration::from_millis(100),
            "the stream waited {:?} for the file to open",
            started.elapsed()
        );
        assert_eq!(opened.load(Ordering::SeqCst), 0, "still opening");

        release.store(true, Ordering::SeqCst);
        let deadline = Instant::now() + Duration::from_secs(2);
        loop {
            let frame = feed.frame_for(&scene, Instant::now(), (2, 2), &open);
            if frame.is_some() {
                break;
            }
            assert!(Instant::now() < deadline, "the video never arrived");
            std::thread::sleep(Duration::from_millis(1));
        }
        assert_eq!(opened.load(Ordering::SeqCst), 1, "opened once");
    }

    #[test]
    fn a_video_that_will_not_open_is_not_retried_every_frame() {
        let attempts = Arc::new(Mutex::new(0));
        let counter = attempts.clone();
        let open: Opener = Arc::new(move |_url: &str, _size: (u32, u32)| {
            *counter.lock().unwrap() += 1;
            Err("refused by the file scope".to_owned())
        });
        let mut feed = VideoFeed::new();
        let scene = video_scene(0.0, true, false);
        let now = Instant::now();

        let deadline = Instant::now() + Duration::from_secs(2);
        for _ in 0..10 {
            assert!(feed.frame_for(&scene, now, (2, 2), &open).is_none());
            // The refusal comes back from the opening thread.
            while feed.is_opening() && Instant::now() < deadline {
                std::thread::sleep(Duration::from_millis(1));
                assert!(feed.frame_for(&scene, now, (2, 2), &open).is_none());
            }
        }
        assert_eq!(*attempts.lock().unwrap(), 1);
    }

    #[test]
    fn a_scene_without_a_visible_video_lets_the_decoder_go() {
        let mut harness = Harness::new(300);
        let now = Instant::now();
        harness.shown(&video_scene(0.0, true, false), now);

        let hidden = OutputScene {
            show_media: false,
            ..video_scene(0.0, true, false)
        };
        assert!(harness.shown(&hidden, now).is_none());
        harness.shown(&video_scene(0.0, true, false), now);
        assert_eq!(
            *harness.opens.lock().unwrap(),
            2,
            "reopened after being let go"
        );
    }
}
