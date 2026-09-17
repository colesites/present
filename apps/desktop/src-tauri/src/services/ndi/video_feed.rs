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

use std::time::Instant;

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
pub type Opener<'a> = dyn Fn(&str, (u32, u32)) -> Result<Box<dyn VideoDecoder>, String> + 'a;

struct Playing {
    url: String,
    size: (u32, u32),
    decoder: Box<dyn VideoDecoder>,
    frame: Option<VideoFrame>,
    anchor: Anchor,
    /// The last position report seen, to tell a fresh report from a repeat.
    last_reported: f64,
    /// A seek was asked for and its first frame has not arrived: the frame on
    /// hand is from before it, and is no reason to seek again.
    awaiting_seek: bool,
    /// Decoding failed. Holds whatever frame was on hand rather than retrying
    /// thirty times a second; a different video starts afresh.
    broken: bool,
}

/// One background video, followed across frames.
#[derive(Default)]
pub struct VideoFeed {
    playing: Option<Playing>,
    /// A video that would not open, so it is not re-opened every frame.
    refused: Option<(String, (u32, u32))>,
}

impl VideoFeed {
    pub fn new() -> Self {
        Self::default()
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
        open: &Opener<'_>,
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
            match open(url, size) {
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
                        awaiting_seek: false,
                        broken: false,
                    });
                }
                Err(error) => {
                    tracing::warn!(%error, url, "the NDI stream could not open its background video");
                    self.refused = Some((url.to_owned(), size));
                    return None;
                }
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
                // A seek still on its way is for the old place.
                playing.awaiting_seek = false;
            }
            playing.last_reported = scene.video_current_time;
        }

        if !playing.broken {
            let target = target_seconds(&playing.anchor, now, looping, duration);
            match advance(playing, target) {
                Ok(Advanced::Ended) if looping && duration.is_none() => {
                    // A loop with no known length cannot wrap in
                    // `target_seconds`, so it starts again from here.
                    playing.anchor = Anchor {
                        seconds: 0.0,
                        playing: playing.anchor.playing,
                        at: now,
                    };
                    if let Err(error) = restart(playing) {
                        tracing::warn!(%error, url, "the NDI stream's background video would not loop");
                        playing.broken = true;
                    }
                }
                Ok(_) => {}
                Err(error) => {
                    tracing::warn!(%error, url, "the NDI stream's background video stopped decoding");
                    playing.broken = true;
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
fn advance(playing: &mut Playing, target: f64) -> Result<Advanced, String> {
    if playing.awaiting_seek {
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
            Step::Seek(seconds) => return seek_and_take(playing, seconds),
            Step::Advance if decodes == MAX_DECODES_PER_FRAME => {
                return seek_and_take(playing, target)
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

fn seek_and_take(playing: &mut Playing, seconds: f64) -> Result<Advanced, String> {
    playing
        .decoder
        .seek(seconds)
        .map_err(|error| error.to_string())?;
    playing.awaiting_seek = true;
    // Whatever is on hand stays up until the new position's frame arrives.
    Ok(match take_one(playing)? {
        Took::Ended => Advanced::Ended,
        Took::Frame | Took::Pending => Advanced::UpToDate,
    })
}

fn restart(playing: &mut Playing) -> Result<(), String> {
    seek_and_take(playing, 0.0).map(|_| ())
}

/// Take the decoder's next frame into `playing` if it is ready.
///
/// With nothing on screen yet it waits: an empty background for a frame or
/// two would flash on the stream as a video starts.
fn take_one(playing: &mut Playing) -> Result<Took, String> {
    let polled = if playing.frame.is_none() {
        playing.decoder.next_frame().map(|frame| match frame {
            Some(frame) => Polled::Frame(frame),
            None => Polled::Ended,
        })
    } else {
        playing.decoder.poll_frame()
    };
    match polled.map_err(|error| error.to_string())? {
        Polled::Frame(frame) if frame.is_well_formed() => {
            playing.frame = Some(frame);
            playing.awaiting_seek = false;
            Ok(Took::Frame)
        }
        Polled::Frame(_) => Err("the decoder produced a malformed frame".to_owned()),
        Polled::Pending => Ok(Took::Pending),
        Polled::Ended => {
            playing.awaiting_seek = false;
            Ok(Took::Ended)
        }
    }
}

#[cfg(test)]
mod tests {
    use std::sync::atomic::{AtomicUsize, Ordering};
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
    }

    impl VideoDecoder for FakeDecoder {
        fn next_frame(&mut self) -> Result<Option<VideoFrame>, VideoError> {
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
            let (log, opens, frames, knows_duration, ready) = (
                self.log.clone(),
                self.opens.clone(),
                self.frames,
                self.knows_duration,
                self.ready.clone(),
            );
            let open =
                move |_url: &str, _size: (u32, u32)| -> Result<Box<dyn VideoDecoder>, String> {
                    *opens.lock().unwrap() += 1;
                    Ok(Box::new(FakeDecoder {
                        next: 0,
                        frames,
                        knows_duration,
                        log: log.clone(),
                        ready: ready.clone(),
                    }))
                };
            self.feed
                .frame_for(scene, now, (2, 2), &open)
                .map(|frame| (frame.presentation_seconds * 30.0).round() as usize)
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
        // The first frame is waited for, so the background never flashes empty.
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
    fn a_video_that_will_not_open_is_not_retried_every_frame() {
        let attempts = Arc::new(Mutex::new(0));
        let counter = attempts.clone();
        let open = move |_url: &str, _size: (u32, u32)| -> Result<Box<dyn VideoDecoder>, String> {
            *counter.lock().unwrap() += 1;
            Err("refused by the file scope".to_owned())
        };
        let mut feed = VideoFeed::new();
        let scene = video_scene(0.0, true, false);
        let now = Instant::now();

        for _ in 0..10 {
            assert!(feed.frame_for(&scene, now, (2, 2), &open).is_none());
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
