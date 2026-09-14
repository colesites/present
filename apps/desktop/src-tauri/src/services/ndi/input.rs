//! Receiving an NDI source for a prop on the audience screen.
//!
//! Electron's receive loop (`ndi.service.ts:470-510`): take a frame when one
//! arrives, keep at most one every 125 ms, scale it to at most 1280 px wide,
//! encode it as a JPEG at quality 72, and hold the latest for the `ndi-frame`
//! scheme to serve. The prop is an `<img>` asking for it eight times a second.
//!
//! No Tauri types. What receives is behind [`FrameReceiver`], so the loop's
//! throttling and encoding can be tested without a source on the network.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use image::codecs::jpeg::JpegEncoder;
use image::imageops::FilterType;
use image::{ExtendedColorType, RgbImage};

use super::receiver::{Capture, Receiver};
use super::rules;

/// How long one capture waits before the loop checks whether it should stop.
///
/// Shorter than Electron's 1000 ms on purpose: stopping the receiver waits for
/// the loop, and an operator switching a prop's camera should not wait a
/// second for the old one to let go.
pub const CAPTURE_SLICE: Duration = Duration::from_millis(250);

/// The latest received frame, as the `ndi-frame` scheme serves it.
#[derive(Debug, Clone, Default)]
pub struct LatestFrame {
    pub jpeg: Option<Arc<Vec<u8>>>,
    /// Milliseconds since the epoch, as Electron's `Date.now()` stamps it.
    pub frame_at_ms: u64,
    pub last_error: Option<String>,
}

pub const CONTENT_TYPE: &str = "image/jpeg";

/// A frame of four bytes a pixel, B, G, R and then alpha or padding.
pub struct ReceivedFrame {
    pub width: u32,
    pub height: u32,
    pub bgrx: Vec<u8>,
}

pub enum Received {
    Frame(ReceivedFrame),
    Nothing,
    Lost,
}

/// Where received frames come from: an NDI receiver, or a test.
pub trait FrameReceiver: Send {
    fn receive(&mut self, timeout: Duration) -> Received;
}

impl FrameReceiver for Receiver {
    fn receive(&mut self, timeout: Duration) -> Received {
        match self.capture(timeout) {
            Capture::Video(video) => {
                if !rules::is_usable_input_frame(video.width(), video.height(), video.has_data()) {
                    return Received::Nothing;
                }
                match video.tight_pixels() {
                    Some(bgrx) => Received::Frame(ReceivedFrame {
                        width: video.width() as u32,
                        height: video.height() as u32,
                        bgrx,
                    }),
                    None => Received::Nothing,
                }
            }
            Capture::Nothing | Capture::Other => Received::Nothing,
            Capture::Error => Received::Lost,
        }
    }
}

/// The size a received frame is encoded at: at most `INPUT_MAX_WIDTH` wide,
/// its shape kept. `nativeImage.resize({ width })` in Electron.
pub fn encoded_size(width: u32, height: u32) -> (u32, u32) {
    if width <= rules::INPUT_MAX_WIDTH || width == 0 {
        return (width, height);
    }
    let scaled = (f64::from(height) * f64::from(rules::INPUT_MAX_WIDTH) / f64::from(width)).round();
    (rules::INPUT_MAX_WIDTH, (scaled as u32).max(1))
}

/// Encode a received frame as the JPEG the prop shows.
pub fn encode(frame: &ReceivedFrame) -> Option<Vec<u8>> {
    let pixels = (frame.width as usize).checked_mul(frame.height as usize)?;
    if frame.bgrx.len() < pixels.checked_mul(4)? {
        return None;
    }
    let mut rgb = Vec::with_capacity(pixels * 3);
    for pixel in frame.bgrx.chunks_exact(4).take(pixels) {
        rgb.extend_from_slice(&[pixel[2], pixel[1], pixel[0]]);
    }
    let image = RgbImage::from_raw(frame.width, frame.height, rgb)?;

    let (width, height) = encoded_size(frame.width, frame.height);
    let image = if (width, height) == (frame.width, frame.height) {
        image
    } else {
        image::imageops::resize(&image, width, height, FilterType::Triangle)
    };

    let mut jpeg = Vec::new();
    JpegEncoder::new_with_quality(&mut jpeg, rules::INPUT_JPEG_QUALITY)
        .encode(image.as_raw(), width, height, ExtendedColorType::Rgb8)
        .ok()?;
    Some(jpeg)
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |elapsed| elapsed.as_millis() as u64)
}

/// Receive until `stop` is set.
///
/// Nothing here may panic: the release profile aborts on panic.
pub fn run(mut receiver: impl FrameReceiver, latest: &Mutex<LatestFrame>, stop: &AtomicBool) {
    let mut last_kept: Option<Instant> = None;
    while !stop.load(Ordering::Relaxed) {
        match receiver.receive(CAPTURE_SLICE) {
            Received::Frame(frame) => {
                let now = Instant::now();
                if !rules::should_keep_input_frame(now, last_kept) {
                    continue;
                }
                last_kept = Some(now);
                let Some(jpeg) = encode(&frame) else {
                    continue;
                };
                if let Ok(mut latest) = latest.lock() {
                    latest.jpeg = Some(Arc::new(jpeg));
                    latest.frame_at_ms = now_ms();
                    latest.last_error = None;
                }
            }
            Received::Nothing => {}
            Received::Lost => {
                if let Ok(mut latest) = latest.lock() {
                    latest.last_error = Some("The NDI source is not responding.".to_owned());
                }
                // NDI reconnects to the source by name on its own; this only
                // stops the loop spinning while it does.
                std::thread::sleep(rules::INPUT_RETRY_DELAY);
            }
        }
    }
}

/// A running receive loop on its own thread.
pub struct InputWorker {
    stop: Arc<AtomicBool>,
    handle: Option<std::thread::JoinHandle<()>>,
}

impl InputWorker {
    pub fn spawn(
        receiver: impl FrameReceiver + 'static,
        latest: Arc<Mutex<LatestFrame>>,
    ) -> std::io::Result<Self> {
        let stop = Arc::new(AtomicBool::new(false));
        let flag = stop.clone();
        let handle = std::thread::Builder::new()
            .name("ndi-input".to_owned())
            .spawn(move || run(receiver, &latest, &flag))?;
        Ok(Self {
            stop,
            handle: Some(handle),
        })
    }

    /// Stop and wait, which destroys the receiver.
    pub fn stop(mut self) {
        self.stop.store(true, Ordering::Relaxed);
        if let Some(handle) = self.handle.take() {
            if handle.join().is_err() {
                tracing::error!("the NDI input thread did not stop cleanly");
            }
        }
    }
}

impl Drop for InputWorker {
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

    fn solid(width: u32, height: u32, bgrx: [u8; 4]) -> ReceivedFrame {
        ReceivedFrame {
            width,
            height,
            bgrx: bgrx
                .iter()
                .copied()
                .cycle()
                .take((width * height * 4) as usize)
                .collect(),
        }
    }

    #[test]
    fn a_frame_wider_than_1280_is_scaled_down_with_its_shape_kept() {
        assert_eq!(encoded_size(1920, 1080), (1280, 720));
        assert_eq!(encoded_size(3840, 2160), (1280, 720));
        assert_eq!(
            encoded_size(640, 360),
            (640, 360),
            "the proxy stream is left alone"
        );
        assert_eq!(encoded_size(1281, 1), (1280, 1));
    }

    #[test]
    fn a_frame_encodes_as_a_jpeg_of_the_right_size_and_colour() {
        let jpeg = encode(&solid(1920, 1080, [0, 0, 255, 255])).expect("jpeg");
        assert_eq!(&jpeg[..3], &[0xFF, 0xD8, 0xFF], "JPEG magic");
        let decoded = image::load_from_memory(&jpeg).expect("decodes").to_rgb8();
        assert_eq!(decoded.dimensions(), (1280, 720));
        let [r, g, b] = decoded.get_pixel(640, 360).0;
        assert!(r > 230 && g < 25 && b < 25, "red stays red: {r} {g} {b}");
    }

    #[test]
    fn a_frame_with_too_few_bytes_is_not_encoded() {
        let short = ReceivedFrame {
            width: 100,
            height: 100,
            bgrx: vec![0; 16],
        };
        assert!(encode(&short).is_none());
    }

    struct Scripted {
        events: VecDeque<Received>,
        stop: Arc<AtomicBool>,
    }

    impl FrameReceiver for Scripted {
        fn receive(&mut self, _timeout: Duration) -> Received {
            let next = self.events.pop_front().unwrap_or(Received::Nothing);
            if self.events.is_empty() {
                self.stop.store(true, Ordering::Relaxed);
            }
            next
        }
    }

    #[test]
    fn frames_arriving_faster_than_eight_a_second_are_dropped_before_encoding() {
        let stop = Arc::new(AtomicBool::new(false));
        let events = (0..5)
            .map(|shade| Received::Frame(solid(8, 8, [shade * 50, shade * 50, shade * 50, 255])))
            .collect();
        let latest = Mutex::new(LatestFrame::default());
        run(
            Scripted {
                events,
                stop: stop.clone(),
            },
            &latest,
            &stop,
        );

        let jpeg = latest
            .lock()
            .unwrap()
            .jpeg
            .clone()
            .expect("a frame was kept");
        let decoded = image::load_from_memory(&jpeg).unwrap().to_rgb8();
        assert!(
            decoded.get_pixel(4, 4).0[0] < 20,
            "only the first of five back-to-back frames was kept"
        );
    }

    #[test]
    fn a_lost_source_is_recorded_and_a_new_frame_clears_it() {
        let stop = Arc::new(AtomicBool::new(false));
        let latest = Mutex::new(LatestFrame::default());
        run(
            Scripted {
                events: VecDeque::from([Received::Lost]),
                stop: stop.clone(),
            },
            &latest,
            &stop,
        );
        assert!(latest.lock().unwrap().last_error.is_some());

        stop.store(false, Ordering::Relaxed);
        run(
            Scripted {
                events: VecDeque::from([Received::Frame(solid(8, 8, [0, 0, 0, 255]))]),
                stop: stop.clone(),
            },
            &latest,
            &stop,
        );
        let latest = latest.lock().unwrap();
        assert!(latest.last_error.is_none());
        assert!(latest.jpeg.is_some());
        assert!(latest.frame_at_ms > 0);
    }
}
