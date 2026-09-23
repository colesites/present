//! Decoding ahead, on a thread of its own.
//!
//! The compositor asks for a video's next frame inside its own 33 ms. A decoder
//! that only works when asked spends that time waiting on the GPU and
//! converting colour, while the compositor sits idle — and FFmpeg decodes only
//! when asked. AVFoundation's reader decoded ahead by itself, which is most of
//! why it kept a 4K stream at 30 fps where FFmpeg alone did not (ADR-003).
//!
//! `ReadAhead` gives any decoder that: a worker keeps up to `AHEAD` frames
//! ready, so the compositor's request usually just takes one. The decoder's
//! contract does not change — `next_frame` still blocks when nothing is ready,
//! and a seek means no frame from before it is handed out.
//!
//! The worker starts on the first request, so a decoder opened and dropped
//! unused costs nothing.

use std::collections::VecDeque;
use std::sync::{Arc, Condvar, Mutex, MutexGuard, PoisonError};

use super::{Polled, VideoDecoder, VideoError, VideoFrame};

/// Frames kept ready. Two 1080p frames are 16 MB.
pub const AHEAD: usize = 2;

#[derive(Default)]
struct Queue {
    frames: VecDeque<VideoFrame>,
    /// The decoder ran out at the current position.
    ended: bool,
    /// The decoder failed at the current position.
    error: Option<VideoError>,
    /// A seek the worker has not started yet.
    seek: Option<f64>,
    /// The caller has gone.
    closed: bool,
}

#[derive(Default)]
struct Shared {
    queue: Mutex<Queue>,
    changed: Condvar,
}

impl Shared {
    fn lock(&self) -> MutexGuard<'_, Queue> {
        self.queue.lock().unwrap_or_else(PoisonError::into_inner)
    }

    fn wait<'a>(&self, queue: MutexGuard<'a, Queue>) -> MutexGuard<'a, Queue> {
        self.changed
            .wait(queue)
            .unwrap_or_else(PoisonError::into_inner)
    }
}

pub struct ReadAhead {
    shared: Arc<Shared>,
    /// The decoder, until the worker takes it.
    idle: Option<Box<dyn VideoDecoder>>,
    dimensions: (u32, u32),
    duration_seconds: Option<f64>,
}

impl ReadAhead {
    pub fn new(decoder: Box<dyn VideoDecoder>) -> Self {
        Self {
            shared: Arc::default(),
            dimensions: decoder.dimensions(),
            duration_seconds: decoder.duration_seconds(),
            idle: Some(decoder),
        }
    }

    fn start(&mut self) {
        let Some(decoder) = self.idle.take() else {
            return;
        };
        let shared = Arc::clone(&self.shared);
        let started = std::thread::Builder::new()
            .name("video-decode".to_owned())
            .spawn(move || work(decoder, &shared));
        if let Err(error) = started {
            self.shared.lock().error = Some(VideoError::Decode(format!(
                "could not start a decoding thread: {error}"
            )));
        }
    }
}

impl VideoDecoder for ReadAhead {
    fn next_frame(&mut self) -> Result<Option<VideoFrame>, VideoError> {
        self.start();
        let mut queue = self.shared.lock();
        loop {
            if let Some(frame) = queue.frames.pop_front() {
                // There is room ahead again.
                self.shared.changed.notify_all();
                return Ok(Some(frame));
            }
            // An end or an error belongs to the position before a pending seek.
            if queue.seek.is_none() {
                if let Some(error) = &queue.error {
                    return Err(error.clone());
                }
                if queue.ended {
                    return Ok(None);
                }
            }
            queue = self.shared.wait(queue);
        }
    }

    fn poll_frame(&mut self) -> Result<Polled, VideoError> {
        self.start();
        let mut queue = self.shared.lock();
        if let Some(frame) = queue.frames.pop_front() {
            drop(queue);
            self.shared.changed.notify_all();
            return Ok(Polled::Frame(frame));
        }
        if queue.seek.is_none() {
            if let Some(error) = &queue.error {
                return Err(error.clone());
            }
            if queue.ended {
                return Ok(Polled::Ended);
            }
        }
        Ok(Polled::Pending)
    }

    fn seek(&mut self, seconds: f64) -> Result<(), VideoError> {
        if !seconds.is_finite() || seconds < 0.0 {
            return Err(VideoError::Decode(format!("cannot seek to {seconds}")));
        }
        {
            let mut queue = self.shared.lock();
            queue.frames.clear();
            queue.ended = false;
            queue.error = None;
            queue.seek = Some(seconds);
        }
        self.shared.changed.notify_all();
        self.start();
        Ok(())
    }

    fn duration_seconds(&self) -> Option<f64> {
        self.duration_seconds
    }

    fn dimensions(&self) -> (u32, u32) {
        self.dimensions
    }
}

impl Drop for ReadAhead {
    fn drop(&mut self) {
        self.shared.lock().closed = true;
        self.shared.changed.notify_all();
    }
}

/// Tells a waiting caller if the worker stops unexpectedly (a panic in a debug
/// build), rather than leaving it waiting for ever.
struct Stopped<'a>(&'a Shared);

impl Drop for Stopped<'_> {
    fn drop(&mut self) {
        if std::thread::panicking() {
            self.0.lock().error =
                Some(VideoError::Decode("the decoding thread stopped".to_owned()));
            self.0.changed.notify_all();
        }
    }
}

fn work(mut decoder: Box<dyn VideoDecoder>, shared: &Shared) {
    let _stopped = Stopped(shared);
    loop {
        let seek = {
            let mut queue = shared.lock();
            loop {
                if queue.closed {
                    return;
                }
                let room = queue.frames.len() < AHEAD && !queue.ended && queue.error.is_none();
                if queue.seek.is_some() || room {
                    break;
                }
                queue = shared.wait(queue);
            }
            queue.seek.take()
        };

        // The decoder runs with the lock released, so the caller can take a
        // frame or ask for a seek meanwhile.
        if let Some(seconds) = seek {
            let result = decoder.seek(seconds);
            let mut queue = shared.lock();
            if let (Err(error), None) = (result, queue.seek) {
                queue.error = Some(error);
                drop(queue);
                shared.changed.notify_all();
            }
            continue;
        }

        let result = decoder.next_frame();
        let mut queue = shared.lock();
        if queue.seek.is_some() {
            // Decoded for the position before the seek.
            continue;
        }
        match result {
            Ok(Some(frame)) => queue.frames.push_back(frame),
            Ok(None) => queue.ended = true,
            Err(error) => queue.error = Some(error),
        }
        drop(queue);
        shared.changed.notify_all();
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
    use std::time::{Duration, Instant};

    const FPS: f64 = 30.0;

    /// Frames numbered by position; optionally failing at one of them.
    struct Fake {
        next: usize,
        frames: usize,
        fail_at: Option<usize>,
        delay: Duration,
        decodes: Arc<AtomicUsize>,
        dropped: Arc<AtomicBool>,
    }

    impl Fake {
        fn new(frames: usize) -> Self {
            Self {
                next: 0,
                frames,
                fail_at: None,
                delay: Duration::ZERO,
                decodes: Arc::default(),
                dropped: Arc::default(),
            }
        }
    }

    impl VideoDecoder for Fake {
        fn next_frame(&mut self) -> Result<Option<VideoFrame>, VideoError> {
            std::thread::sleep(self.delay);
            self.decodes.fetch_add(1, Ordering::SeqCst);
            if Some(self.next) == self.fail_at {
                return Err(VideoError::Decode(format!(
                    "frame {} is damaged",
                    self.next
                )));
            }
            if self.next >= self.frames {
                return Ok(None);
            }
            let frame = VideoFrame {
                width: 1,
                height: 1,
                bgra: vec![0; 4],
                presentation_seconds: self.next as f64 / FPS,
            };
            self.next += 1;
            Ok(Some(frame))
        }

        fn seek(&mut self, seconds: f64) -> Result<(), VideoError> {
            self.next = (seconds * FPS).round() as usize;
            Ok(())
        }

        fn duration_seconds(&self) -> Option<f64> {
            Some(self.frames as f64 / FPS)
        }

        fn dimensions(&self) -> (u32, u32) {
            (1, 1)
        }
    }

    impl Drop for Fake {
        fn drop(&mut self) {
            self.dropped.store(true, Ordering::SeqCst);
        }
    }

    fn index(frame: &VideoFrame) -> usize {
        (frame.presentation_seconds * FPS).round() as usize
    }

    fn eventually(what: &str, mut condition: impl FnMut() -> bool) {
        let deadline = Instant::now() + Duration::from_secs(5);
        while !condition() {
            assert!(Instant::now() < deadline, "timed out waiting: {what}");
            std::thread::sleep(Duration::from_millis(5));
        }
    }

    #[test]
    fn frames_arrive_in_order_and_then_the_end_stays() {
        let mut ahead = ReadAhead::new(Box::new(Fake::new(5)));
        assert_eq!(ahead.dimensions(), (1, 1));
        assert_eq!(ahead.duration_seconds(), Some(5.0 / FPS));
        for expected in 0..5 {
            let frame = ahead.next_frame().unwrap().expect("a frame");
            assert_eq!(index(&frame), expected);
        }
        assert!(ahead.next_frame().unwrap().is_none());
        assert!(ahead.next_frame().unwrap().is_none());
    }

    #[test]
    fn nothing_is_decoded_until_a_frame_is_asked_for() {
        let fake = Fake::new(100);
        let decodes = Arc::clone(&fake.decodes);
        let ahead = ReadAhead::new(Box::new(fake));
        std::thread::sleep(Duration::from_millis(50));
        assert_eq!(decodes.load(Ordering::SeqCst), 0);
        drop(ahead);
    }

    #[test]
    fn it_decodes_only_a_few_frames_ahead() {
        let fake = Fake::new(100);
        let decodes = Arc::clone(&fake.decodes);
        let mut ahead = ReadAhead::new(Box::new(fake));
        ahead.next_frame().unwrap().expect("a frame");
        eventually("the queue to fill", || {
            decodes.load(Ordering::SeqCst) > AHEAD
        });
        std::thread::sleep(Duration::from_millis(50));
        assert_eq!(decodes.load(Ordering::SeqCst), 1 + AHEAD);
    }

    #[test]
    fn a_seek_hands_out_nothing_decoded_before_it() {
        let mut fake = Fake::new(300);
        // Slow enough that a decode is often in flight when the seek lands.
        fake.delay = Duration::from_millis(2);
        let mut ahead = ReadAhead::new(Box::new(fake));
        for round in 0..20 {
            ahead.next_frame().unwrap().expect("a frame");
            let target = 10 + round * 7;
            ahead.seek(target as f64 / FPS).unwrap();
            let frame = ahead.next_frame().unwrap().expect("a frame after the seek");
            assert_eq!(index(&frame), target, "round {round}");
            let next = ahead.next_frame().unwrap().expect("the one after");
            assert_eq!(index(&next), target + 1);
        }
    }

    #[test]
    fn a_seek_after_the_end_starts_again() {
        let mut ahead = ReadAhead::new(Box::new(Fake::new(3)));
        while ahead.next_frame().unwrap().is_some() {}
        ahead.seek(0.0).unwrap();
        let frame = ahead.next_frame().unwrap().expect("the first frame again");
        assert_eq!(index(&frame), 0);
    }

    #[test]
    fn an_error_follows_the_frames_before_it_and_a_seek_clears_it() {
        let mut fake = Fake::new(10);
        fake.fail_at = Some(2);
        let mut ahead = ReadAhead::new(Box::new(fake));
        assert_eq!(index(&ahead.next_frame().unwrap().unwrap()), 0);
        assert_eq!(index(&ahead.next_frame().unwrap().unwrap()), 1);
        assert!(ahead.next_frame().is_err());
        assert!(ahead.next_frame().is_err(), "it stays failed");

        ahead.seek(5.0 / FPS).unwrap();
        assert_eq!(index(&ahead.next_frame().unwrap().unwrap()), 5);
    }

    #[test]
    fn polling_never_waits_and_finds_the_frame_once_it_is_ready() {
        let mut fake = Fake::new(3);
        fake.delay = Duration::from_millis(200);
        let mut ahead = ReadAhead::new(Box::new(fake));
        let started = Instant::now();
        assert_eq!(ahead.poll_frame().unwrap(), Polled::Pending);
        assert!(started.elapsed() < Duration::from_millis(100));

        let deadline = Instant::now() + Duration::from_secs(5);
        let frame = loop {
            match ahead.poll_frame().unwrap() {
                Polled::Frame(frame) => break frame,
                Polled::Pending => {
                    assert!(Instant::now() < deadline, "no frame arrived");
                    std::thread::sleep(Duration::from_millis(5));
                }
                Polled::Ended => panic!("ended early"),
            }
        };
        assert_eq!(index(&frame), 0);

        ahead.seek(3.0 / FPS).unwrap();
        assert_eq!(
            ahead.poll_frame().unwrap(),
            Polled::Pending,
            "the end is not reported before the seek has happened"
        );
        eventually("the end after the seek", || {
            ahead.poll_frame().unwrap() == Polled::Ended
        });
    }

    #[test]
    fn an_impossible_seek_is_refused_at_once() {
        let mut ahead = ReadAhead::new(Box::new(Fake::new(3)));
        assert!(ahead.seek(-1.0).is_err());
        assert!(ahead.seek(f64::NAN).is_err());
    }

    #[test]
    fn dropping_it_stops_the_worker_and_frees_the_decoder() {
        let fake = Fake::new(1_000_000);
        let dropped = Arc::clone(&fake.dropped);
        let mut ahead = ReadAhead::new(Box::new(fake));
        ahead.next_frame().unwrap().expect("a frame");
        drop(ahead);
        eventually("the decoder to be dropped", || {
            dropped.load(Ordering::SeqCst)
        });
    }

    #[test]
    fn a_decoder_dropped_unused_is_freed_at_once() {
        let fake = Fake::new(10);
        let dropped = Arc::clone(&fake.dropped);
        drop(ReadAhead::new(Box::new(fake)));
        assert!(dropped.load(Ordering::SeqCst));
    }
}
