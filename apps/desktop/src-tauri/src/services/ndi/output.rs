//! The NDI send loop: render a frame, send it, account for it.
//!
//! Electron's loop is a 33 ms `setInterval` around `capturePage()`
//! (`ndi.service.ts:325-360`). This is a thread instead, because the pacing is
//! already done: a sender created with `clock_video` blocks in `send` until
//! the frame is due, measured at 30.0 fps watched and 30.4 fps unwatched
//! (`tests/ndi_loopback.rs`). The loop renders, hands the frame over, and the
//! SDK decides when the next one starts.
//!
//! No Tauri types. What to draw and where to send it are both behind traits,
//! so the loop's accounting can be tested without a runtime or a webview.
//!
//! **Nothing here may panic.** The release profile aborts on panic, so a panic
//! on this thread takes the whole app down mid-service rather than just the
//! stream.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use serde::Serialize;

use super::rules;
use super::sender::{SendError, Sender};

/// Draws one frame of BGRA into a buffer it is handed.
pub trait FrameSource: Send {
    /// Fill `out` with a frame and return its size, or say why it could not.
    fn render(&mut self, out: &mut Vec<u8>) -> Result<(u32, u32), String>;
}

/// Where frames go. The NDI sender, or a test.
pub trait FrameSink: Send {
    fn send_bgra(&mut self, width: u32, height: u32, bgra: &[u8]) -> Result<(), SendError>;
    fn connections(&self) -> u32;
}

impl FrameSink for Sender {
    fn send_bgra(&mut self, width: u32, height: u32, bgra: &[u8]) -> Result<(), SendError> {
        Sender::send_bgra(self, width, height, bgra)
    }

    fn connections(&self) -> u32 {
        Sender::connections(self, Duration::ZERO)
    }
}

/// `getNdiStatus`, in the shape Settings already reads, plus what the Rust
/// sender can say that `capturePage` could not.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NdiStatus {
    pub running: bool,
    pub source_name: String,
    pub group_name: String,
    pub last_error: Option<String>,
    pub library_loaded: bool,
    pub frames_sent: u64,
    /// The last frame sent was not freshly rendered.
    pub using_fallback_frame: bool,
    /// Receivers connected, refreshed about once a second.
    pub connections: u32,
    pub library_version: Option<String>,
    /// How long the last frame took to render, before the SDK's clock.
    pub frame_ms: Option<f64>,
}

impl Default for NdiStatus {
    fn default() -> Self {
        Self {
            running: false,
            source_name: rules::DEFAULT_SOURCE_NAME.to_owned(),
            group_name: rules::DEFAULT_GROUP_NAME.to_owned(),
            last_error: None,
            library_loaded: false,
            frames_sent: 0,
            using_fallback_frame: false,
            connections: 0,
            library_version: None,
            frame_ms: None,
        }
    }
}

/// The frame a stream falls back to before anything has rendered.
pub const FALLBACK_SIZE: (u32, u32) = (1920, 1080);

/// One frame of the stream's clock. Used only if the SDK stops pacing.
const FRAME_INTERVAL: Duration = Duration::from_micros(33_333);

/// How often the connection count is asked for.
const CONNECTIONS_EVERY: u64 = 30;

/// Run until `stop` is set.
///
/// A frame that fails to render is not a gap in the stream. The last good
/// frame is sent again, and before there is one, opaque black. Electron sends
/// a zeroed — transparent — 1280×720 frame instead; on a switcher keying the
/// stream that shows whatever is underneath, which is not a failure a
/// livestream should have. Either way `usingFallbackFrame` says so.
pub fn run(
    mut source: impl FrameSource,
    mut sink: impl FrameSink,
    status: &Mutex<NdiStatus>,
    stop: &AtomicBool,
) {
    let mut rendering = Vec::new();
    let mut good = Vec::new();
    let mut good_size: Option<(u32, u32)> = None;
    let mut logged_render_failure = false;
    let mut frames: u64 = 0;
    let mut previous_start: Option<Instant> = None;

    while !stop.load(Ordering::Relaxed) {
        let started = Instant::now();

        // The SDK's clock is what paces this loop. If a runtime ever returns
        // from `send` without waiting, do not spin a core rendering frames
        // faster than anyone can receive them.
        if let Some(previous) = previous_start {
            let since = started.saturating_duration_since(previous);
            if since < FRAME_INTERVAL / 2 {
                std::thread::sleep(FRAME_INTERVAL - since);
            }
        }
        previous_start = Some(Instant::now());

        let rendered = source.render(&mut rendering);
        let render_ms = started.elapsed().as_secs_f64() * 1000.0;

        let (fallback, error) = match rendered {
            Ok(size) if valid_frame(size, &rendering) => {
                std::mem::swap(&mut rendering, &mut good);
                good_size = Some(size);
                logged_render_failure = false;
                (false, None)
            }
            Ok((width, height)) => (
                true,
                Some(format!(
                    "a {width}x{height} frame arrived with {} bytes",
                    rendering.len()
                )),
            ),
            Err(error) => (true, Some(error)),
        };

        if let Some(error) = error.as_deref() {
            if !logged_render_failure {
                tracing::error!(
                    error,
                    "an NDI frame could not be rendered; resending the last one"
                );
                logged_render_failure = true;
            }
        }

        let size = match good_size {
            Some(size) => size,
            None => {
                black_frame(&mut good, FALLBACK_SIZE);
                good_size = Some(FALLBACK_SIZE);
                FALLBACK_SIZE
            }
        };

        let sent = sink.send_bgra(size.0, size.1, &good);
        frames += 1;
        let connections = (frames % CONNECTIONS_EVERY == 1).then(|| sink.connections());

        let Ok(mut status) = status.lock() else {
            // A poisoned status is a bug elsewhere; the stream carries on.
            continue;
        };
        match sent {
            Ok(()) => {
                status.frames_sent += 1;
                status.using_fallback_frame = fallback;
                status.last_error = error;
            }
            Err(send_error) => {
                status.last_error = Some(send_error.to_string());
                status.using_fallback_frame = true;
            }
        }
        status.frame_ms = Some(render_ms);
        if let Some(connections) = connections {
            status.connections = connections;
        }
    }
}

fn valid_frame((width, height): (u32, u32), bgra: &[u8]) -> bool {
    width > 0 && height > 0 && bgra.len() == width as usize * height as usize * 4
}

fn black_frame(buffer: &mut Vec<u8>, (width, height): (u32, u32)) {
    buffer.clear();
    buffer.reserve(width as usize * height as usize * 4);
    for _ in 0..(width as usize * height as usize) {
        buffer.extend_from_slice(&[0, 0, 0, 255]);
    }
}

/// A running send loop on its own thread.
pub struct OutputWorker {
    stop: Arc<AtomicBool>,
    handle: Option<std::thread::JoinHandle<()>>,
}

impl OutputWorker {
    pub fn spawn<S, K>(source: S, sink: K, status: Arc<Mutex<NdiStatus>>) -> std::io::Result<Self>
    where
        S: FrameSource + 'static,
        K: FrameSink + 'static,
    {
        let stop = Arc::new(AtomicBool::new(false));
        let flag = stop.clone();
        let handle = std::thread::Builder::new()
            .name("ndi-output".to_owned())
            .spawn(move || {
                run(source, sink, &status, &flag);
                if let Ok(mut status) = status.lock() {
                    status.running = false;
                    status.connections = 0;
                }
            })?;
        Ok(Self {
            stop,
            handle: Some(handle),
        })
    }

    /// Stop and wait for the thread, which destroys the sender — the source
    /// leaves the network at once rather than timing out on every receiver.
    pub fn stop(mut self) {
        self.stop.store(true, Ordering::Relaxed);
        if let Some(handle) = self.handle.take() {
            if handle.join().is_err() {
                tracing::error!("the NDI output thread did not stop cleanly");
            }
        }
    }
}

impl Drop for OutputWorker {
    fn drop(&mut self) {
        self.stop.store(true, Ordering::Relaxed);
        if let Some(handle) = self.handle.take() {
            let _ = handle.join();
        }
    }
}

#[cfg(test)]
mod tests {
    use std::collections::VecDeque;

    use super::*;

    /// Renders what it is told to, frame by frame, then stops the loop.
    struct Script {
        frames: VecDeque<Result<(u32, u32, u8), String>>,
        stop: Arc<AtomicBool>,
    }

    impl FrameSource for Script {
        fn render(&mut self, out: &mut Vec<u8>) -> Result<(u32, u32), String> {
            let next = self.frames.pop_front();
            if self.frames.is_empty() {
                self.stop.store(true, Ordering::Relaxed);
            }
            match next {
                Some(Ok((width, height, shade))) => {
                    out.clear();
                    out.resize(width as usize * height as usize * 4, shade);
                    Ok((width, height))
                }
                Some(Err(error)) => {
                    // A failed render may leave the buffer half-written.
                    out.clear();
                    out.push(99);
                    Err(error)
                }
                None => Err("nothing scripted".to_owned()),
            }
        }
    }

    /// Width, height and the bytes of one frame handed to the sink.
    type SentFrame = (u32, u32, Vec<u8>);

    #[derive(Default)]
    struct Recorder {
        sent: Arc<Mutex<Vec<SentFrame>>>,
    }

    impl FrameSink for Recorder {
        fn send_bgra(&mut self, width: u32, height: u32, bgra: &[u8]) -> Result<(), SendError> {
            self.sent
                .lock()
                .unwrap()
                .push((width, height, bgra.to_vec()));
            Ok(())
        }

        fn connections(&self) -> u32 {
            2
        }
    }

    fn run_script(frames: Vec<Result<(u32, u32, u8), String>>) -> (Vec<SentFrame>, NdiStatus) {
        let stop = Arc::new(AtomicBool::new(false));
        let source = Script {
            frames: frames.into(),
            stop: stop.clone(),
        };
        let recorder = Recorder::default();
        let sent = recorder.sent.clone();
        let status = Mutex::new(NdiStatus::default());
        run(source, recorder, &status, &stop);
        let sent = sent.lock().unwrap().clone();
        let status = status.lock().unwrap().clone();
        (sent, status)
    }

    #[test]
    fn every_rendered_frame_is_sent_and_counted() {
        let (sent, status) = run_script(vec![Ok((2, 2, 10)), Ok((2, 2, 20)), Ok((2, 2, 30))]);
        let shades: Vec<u8> = sent.iter().map(|(_, _, bytes)| bytes[0]).collect();
        assert_eq!(shades, [10, 20, 30]);
        assert_eq!(status.frames_sent, 3);
        assert!(!status.using_fallback_frame);
        assert_eq!(status.last_error, None);
        assert_eq!(status.connections, 2);
        assert!(status.frame_ms.is_some());
    }

    #[test]
    fn a_failed_render_resends_the_last_good_frame_rather_than_leaving_a_gap() {
        let (sent, status) = run_script(vec![
            Ok((2, 2, 10)),
            Err("the scene could not be drawn".to_owned()),
        ]);
        assert_eq!(sent.len(), 2, "the stream did not skip a frame");
        assert_eq!(
            sent[1],
            (2, 2, vec![10; 16]),
            "the good frame, not the half-written one"
        );
        assert!(status.using_fallback_frame);
        assert_eq!(
            status.last_error.as_deref(),
            Some("the scene could not be drawn")
        );
    }

    #[test]
    fn recovering_clears_the_fallback_and_the_error() {
        let (_, status) = run_script(vec![Ok((2, 2, 10)), Err("once".to_owned()), Ok((2, 2, 30))]);
        assert!(!status.using_fallback_frame);
        assert_eq!(status.last_error, None);
    }

    #[test]
    fn a_stream_that_has_never_rendered_sends_opaque_black() {
        let (sent, status) = run_script(vec![Err("no scene yet".to_owned())]);
        let (width, height, bytes) = &sent[0];
        assert_eq!((*width, *height), FALLBACK_SIZE);
        assert_eq!(&bytes[..8], &[0, 0, 0, 255, 0, 0, 0, 255]);
        assert!(bytes.chunks_exact(4).all(|pixel| pixel == [0, 0, 0, 255]));
        assert!(status.using_fallback_frame);
    }

    #[test]
    fn a_frame_whose_bytes_do_not_match_its_size_is_not_sent() {
        struct Liar(Arc<AtomicBool>);
        impl FrameSource for Liar {
            fn render(&mut self, out: &mut Vec<u8>) -> Result<(u32, u32), String> {
                self.0.store(true, Ordering::Relaxed);
                out.clear();
                out.extend_from_slice(&[1, 2, 3]);
                Ok((1920, 1080))
            }
        }
        let stop = Arc::new(AtomicBool::new(false));
        let recorder = Recorder::default();
        let sent = recorder.sent.clone();
        let status = Mutex::new(NdiStatus::default());
        run(Liar(stop.clone()), recorder, &status, &stop);

        let sent = sent.lock().unwrap();
        assert_eq!(
            sent[0].2.len(),
            1920 * 1080 * 4,
            "black, at a size NDI accepts"
        );
        assert!(status.lock().unwrap().using_fallback_frame);
    }

    #[test]
    fn the_status_serialises_the_way_settings_reads_it() {
        let json = serde_json::to_value(NdiStatus::default()).unwrap();
        for key in [
            "running",
            "sourceName",
            "groupName",
            "lastError",
            "libraryLoaded",
            "framesSent",
            "usingFallbackFrame",
        ] {
            assert!(json.get(key).is_some(), "Settings reads `{key}`");
        }
        assert_eq!(json["sourceName"], "Present Main Output");
        assert_eq!(json["groupName"], "Public");
        assert!(json["lastError"].is_null());
    }

    #[test]
    fn a_worker_stops_when_asked_and_says_it_is_not_running() {
        struct Forever;
        impl FrameSource for Forever {
            fn render(&mut self, out: &mut Vec<u8>) -> Result<(u32, u32), String> {
                out.clear();
                out.resize(16, 0);
                std::thread::sleep(Duration::from_millis(5));
                Ok((2, 2))
            }
        }
        let status = Arc::new(Mutex::new(NdiStatus {
            running: true,
            ..NdiStatus::default()
        }));
        let worker =
            OutputWorker::spawn(Forever, Recorder::default(), status.clone()).expect("spawn");
        std::thread::sleep(Duration::from_millis(60));
        worker.stop();

        let status = status.lock().unwrap();
        assert!(!status.running);
        assert!(status.frames_sent > 0);
    }
}
