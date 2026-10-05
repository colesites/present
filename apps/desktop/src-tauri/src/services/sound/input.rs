//! The microphone the agents listen through, captured by the app itself.
//!
//! The webview used to open it (`getUserMedia`), which meant WebKit's own
//! device list — empty until a page had opened a microphone, under ids of its
//! own — and WebKit's audio graph to turn it into the 16 kHz, 16-bit samples
//! the transcription service takes. Now the system's device is opened here,
//! by the id Settings shows (`output::devices`), and FFmpeg's resampler makes
//! the samples. The caller gets them about twenty times a second.

use std::str::FromStr;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc;
use std::sync::Arc;
use std::time::Duration;

use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use ffmpeg_next as ff;
use rtrb::RingBuffer;

/// What the transcription service takes: 16 kHz, one channel.
pub const RATE: u32 = 16_000;

/// How often what has been captured is looked at.
const CHUNK_EVERY: Duration = Duration::from_millis(50);

/// What is handed on at a time: 100 ms of sound, 1,600 samples.
///
/// The transcription service takes between 50 ms and a second per message,
/// and refuses the session otherwise. Handed on as captured, every 50 ms by
/// the clock, a message held only what the device had delivered by then —
/// four of its 512-frame callbacks, 46 ms — and AssemblyAI ended every
/// session at its first message ("Input Duration Violation: 46.4375 ms").
pub const CHUNK_BYTES: usize = (RATE as usize / 10) * 2;

/// Converted sound, gathered into whole chunks of [`CHUNK_BYTES`].
#[derive(Default)]
struct Chunker {
    pending: Vec<u8>,
}

impl Chunker {
    fn push(&mut self, bytes: &[u8]) -> Vec<Vec<u8>> {
        self.pending.extend_from_slice(bytes);
        let mut chunks = Vec::new();
        while self.pending.len() >= CHUNK_BYTES {
            chunks.push(self.pending.drain(..CHUNK_BYTES).collect());
        }
        chunks
    }
}

/// A microphone being listened to. Dropping it stops it.
pub struct Microphone {
    stop: Arc<AtomicBool>,
    thread: Option<std::thread::JoinHandle<()>>,
    /// The device, as the system names it.
    pub label: String,
}

impl Drop for Microphone {
    fn drop(&mut self) {
        self.stop.store(true, Ordering::Release);
        if let Some(thread) = self.thread.take() {
            let _ = thread.join();
        }
    }
}

impl Microphone {
    /// Open `device_id`, or the system's default microphone, and hand
    /// `deliver` 16 kHz mono 16-bit little-endian samples until dropped.
    pub fn open(
        device_id: Option<&str>,
        mut deliver: impl FnMut(Vec<u8>) + Send + 'static,
    ) -> Result<Self, String> {
        let stop = Arc::new(AtomicBool::new(false));
        let (ready, started) = mpsc::channel::<Result<String, String>>();
        let device_id = device_id.map(str::to_owned);
        let stopping = stop.clone();
        // The stream lives and dies on this thread: a Core Audio stream is not
        // one to hand between threads.
        let thread = std::thread::Builder::new()
            .name("present-microphone".into())
            .spawn(move || {
                let opened = open_stream(device_id.as_deref());
                let (stream, label, mut consumer, rate) = match opened {
                    Ok(opened) => opened,
                    Err(error) => {
                        let _ = ready.send(Err(error));
                        return;
                    }
                };
                let mut converter = match Converter::new(rate) {
                    Ok(converter) => converter,
                    Err(error) => {
                        let _ = ready.send(Err(error));
                        return;
                    }
                };
                let _ = ready.send(Ok(label));
                let mut captured = Vec::new();
                let mut chunker = Chunker::default();
                while !stopping.load(Ordering::Acquire) {
                    std::thread::sleep(CHUNK_EVERY);
                    captured.clear();
                    while let Ok(sample) = consumer.pop() {
                        captured.push(sample);
                    }
                    if captured.is_empty() {
                        continue;
                    }
                    match converter.convert(&captured) {
                        Ok(bytes) => {
                            for chunk in chunker.push(&bytes) {
                                deliver(chunk);
                            }
                        }
                        Err(error) => {
                            tracing::warn!(%error, "the microphone's sound could not be converted");
                            break;
                        }
                    }
                }
                drop(stream);
            })
            .map_err(|error| format!("the microphone could not start: {error}"))?;
        match started.recv_timeout(Duration::from_secs(10)) {
            Ok(Ok(label)) => Ok(Self {
                stop,
                thread: Some(thread),
                label,
            }),
            Ok(Err(error)) => {
                let _ = thread.join();
                Err(error)
            }
            Err(_) => {
                stop.store(true, Ordering::Release);
                Err("the microphone did not start".to_owned())
            }
        }
    }
}

type Opened = (cpal::Stream, String, rtrb::Consumer<f32>, u32);

/// The device's stream, mixed to one channel into a ring the converter reads.
fn open_stream(device_id: Option<&str>) -> Result<Opened, String> {
    let host = cpal::default_host();
    let device = device_id
        .and_then(|id| cpal::DeviceId::from_str(id).ok())
        .and_then(|id| host.device_by_id(&id))
        .or_else(|| host.default_input_device())
        .ok_or("this computer has no microphone")?;
    let label = device
        .description()
        .map(|about| about.name().to_owned())
        .unwrap_or_else(|_| "Microphone".to_owned());
    let config = device
        .default_input_config()
        .map_err(|error| format!("the microphone cannot be read: {error}"))?;
    let rate = config.sample_rate();
    let channels = usize::from(config.channels().max(1));
    // Two seconds of room: the converter takes it every 50 ms.
    let (mut producer, consumer) = RingBuffer::<f32>::new(rate as usize * 2);
    let error = |error: cpal::StreamError| tracing::warn!(%error, "the microphone failed");
    let stream = match config.sample_format() {
        cpal::SampleFormat::F32 => device.build_input_stream::<f32, _, _>(
            &config.config(),
            move |data, _| {
                for frame in data.chunks_exact(channels) {
                    let _ = producer.push(frame.iter().sum::<f32>() / channels as f32);
                }
            },
            error,
            None,
        ),
        cpal::SampleFormat::I16 => device.build_input_stream::<i16, _, _>(
            &config.config(),
            move |data, _| {
                for frame in data.chunks_exact(channels) {
                    let sum: f32 = frame
                        .iter()
                        .map(|&sample| f32::from(sample) / 32_768.0)
                        .sum();
                    let _ = producer.push(sum / channels as f32);
                }
            },
            error,
            None,
        ),
        other => {
            return Err(format!(
                "the microphone's samples ({other}) are not ones this reads"
            ))
        }
    }
    .map_err(|error| format!("the microphone cannot be opened: {error}"))?;
    stream
        .play()
        .map_err(|error| format!("the microphone cannot start: {error}"))?;
    tracing::info!(device = label, rate, channels, "microphone opened");
    Ok((stream, label, consumer, rate))
}

/// The device's rate, as floats, to 16 kHz 16-bit: FFmpeg's resampler.
struct Converter {
    context: ff::software::resampling::Context,
}

impl Converter {
    fn new(rate: u32) -> Result<Self, String> {
        crate::services::video::ffmpeg::init();
        let context = ff::software::resampling::Context::get(
            ff::format::Sample::F32(ff::format::sample::Type::Packed),
            ff::ChannelLayout::MONO,
            rate,
            ff::format::Sample::I16(ff::format::sample::Type::Packed),
            ff::ChannelLayout::MONO,
            RATE,
        )
        .map_err(|error| format!("the microphone's sound cannot be converted: {error}"))?;
        Ok(Self { context })
    }

    fn convert(&mut self, samples: &[f32]) -> Result<Vec<u8>, String> {
        // SAFETY: the context is live; `input` holds `samples.len()` floats
        // and `out` room for `capacity` 16-bit samples, one plane each.
        unsafe {
            let context = self.context.as_mut_ptr();
            let capacity = ff::ffi::swr_get_out_samples(context, samples.len() as i32).max(0);
            let mut out = vec![0i16; capacity as usize];
            let out_planes = [out.as_mut_ptr().cast::<u8>()];
            let in_planes = [samples.as_ptr().cast::<u8>()];
            let written = ff::ffi::swr_convert(
                context,
                out_planes.as_ptr(),
                capacity,
                in_planes.as_ptr(),
                samples.len() as i32,
            );
            if written < 0 {
                return Err(ff::Error::from(written).to_string());
            }
            out.truncate(written as usize);
            Ok(out.iter().flat_map(|sample| sample.to_le_bytes()).collect())
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sound_is_handed_on_in_whole_100_ms_chunks() {
        let mut chunker = Chunker::default();
        let mut chunks = Vec::new();
        // What the device delivered between two looks: 46 ms at a time.
        for _ in 0..20 {
            chunks.extend(chunker.push(&vec![0u8; 743 * 2]));
        }
        assert!(!chunks.is_empty());
        for chunk in &chunks {
            assert_eq!(chunk.len(), CHUNK_BYTES, "every message is 100 ms");
        }
        let milliseconds = CHUNK_BYTES as f64 / 2.0 / f64::from(RATE) * 1000.0;
        assert!((50.0..=1000.0).contains(&milliseconds), "{milliseconds} ms");
    }

    #[test]
    fn a_second_at_48_khz_becomes_a_second_at_16() {
        let mut converter = Converter::new(48_000).unwrap();
        let tone: Vec<f32> = (0..48_000)
            .map(|index| (index as f32 / 48_000.0 * 440.0 * std::f32::consts::TAU).sin() * 0.5)
            .collect();
        let mut bytes = 0;
        for chunk in tone.chunks(2_400) {
            bytes += converter.convert(chunk).unwrap().len();
        }
        let samples = bytes / 2;
        assert!((samples as i64 - 16_000).abs() < 100, "{samples} samples");
    }

    /// The default microphone opens and sends something. Silence counts: a
    /// machine without permission still gets samples, all zero.
    #[test]
    #[ignore = "opens this computer's microphone"]
    fn the_default_microphone_sends_samples() {
        let (sent, received) = mpsc::channel();
        let microphone = Microphone::open(None, move |bytes| {
            let _ = sent.send(bytes.len());
        })
        .expect("a microphone");
        let first = received
            .recv_timeout(Duration::from_secs(3))
            .expect("samples");
        assert!(first > 0);
        drop(microphone);
    }
}
