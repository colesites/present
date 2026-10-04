//! The audio device, and what it is playing.
//!
//! One output stream on the chosen device. Each voice — a video's sound, the
//! backing track — has a ring of samples the engine fills and the device's own
//! thread empties; the device thread never waits on a lock, so the engine
//! being busy is a gap at worst, never a stall in the system's audio.
//!
//! **A seek is a mark in the ring.** The engine cannot empty a ring the device
//! thread is reading, so it asks for a flush and writes a mark — one frame of
//! NaN — before the new position's samples. The device thread throws away
//! what comes before the mark and plays what comes after. The clock is counted
//! from the mark: how many frames the device has taken since.

use std::str::FromStr;
use std::sync::atomic::{AtomicBool, AtomicU32, AtomicU64, Ordering};
use std::sync::Arc;

use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use rtrb::{Consumer, Producer, RingBuffer};

/// The voices one output mixes.
pub const VOICES: usize = 2;
pub const VIDEO: usize = 0;
pub const BACKING_TRACK: usize = 1;

/// How much sound each ring holds, in seconds.
const RING_SECONDS: f64 = 1.0;

/// What the engine and the device thread share about one voice.
#[derive(Default)]
pub struct VoiceShared {
    pub playing: AtomicBool,
    /// The level, as `f32` bits: 0 silent, 1 as recorded.
    gain_bits: AtomicU32,
    /// Flushes asked for, and the marks the device thread has reached.
    flushes_asked: AtomicU64,
    flushes_done: AtomicU64,
    /// Frames played since the last mark.
    consumed: AtomicU64,
}

impl VoiceShared {
    pub fn set_gain(&self, gain: f32) {
        self.gain_bits
            .store(gain.clamp(0.0, 1.0).to_bits(), Ordering::Relaxed);
    }

    fn gain(&self) -> f32 {
        f32::from_bits(self.gain_bits.load(Ordering::Relaxed))
    }

    /// Frames the device has taken since the last mark, or `None` while it
    /// has not reached it yet.
    pub fn consumed(&self) -> Option<u64> {
        let asked = self.flushes_asked.load(Ordering::Acquire);
        let done = self.flushes_done.load(Ordering::Acquire);
        (asked == done).then(|| self.consumed.load(Ordering::Acquire))
    }
}

#[derive(Default)]
struct Shared {
    voices: [VoiceShared; VOICES],
    /// The device went away or failed.
    broken: AtomicBool,
    /// Between a frame leaving the callback and being heard.
    latency_frames: AtomicU64,
    /// The last callback's length: frames taken but not yet heard.
    callback_frames: AtomicU64,
    /// Frames of the test sound still to play.
    tone_frames: AtomicU32,
}

/// The engine's end of one voice.
pub struct VoiceWriter {
    producer: Producer<f32>,
    pub channels: usize,
}

impl VoiceWriter {
    /// Room for this many more frames.
    pub fn room(&self) -> usize {
        self.producer.slots() / self.channels
    }

    /// Write as many whole frames of `samples` as fit; returns how many
    /// samples were taken.
    pub fn write(&mut self, samples: &[f32]) -> usize {
        let frames = (samples.len() / self.channels).min(self.room());
        let count = frames * self.channels;
        if count == 0 {
            return 0;
        }
        let Ok(mut chunk) = self.producer.write_chunk(count) else {
            return 0;
        };
        let (first, second) = chunk.as_mut_slices();
        first.copy_from_slice(&samples[..first.len()]);
        second.copy_from_slice(&samples[first.len()..count]);
        chunk.commit_all();
        count
    }
}

/// An open output.
pub struct Output {
    stream: cpal::Stream,
    /// The device is being fed. A paused one lets the computer sleep.
    running: bool,
    shared: Arc<Shared>,
    pub writers: [VoiceWriter; VOICES],
    pub rate: u32,
    /// The device's channels; each voice is stereo, or mono on a mono device.
    pub voice_channels: usize,
    /// The device, as `cpal` names it (`DeviceId`'s text).
    pub device_id: Option<String>,
}

impl Output {
    /// Open `device_id`, or the device called `device_label`, or the system's
    /// default output.
    pub fn open(device_id: Option<&str>, device_label: Option<&str>) -> Result<Self, String> {
        let host = cpal::default_host();
        let device = device_id
            .and_then(|id| cpal::DeviceId::from_str(id).ok())
            .and_then(|id| host.device_by_id(&id))
            .or_else(|| {
                let label = device_label?.trim();
                if label.is_empty() {
                    return None;
                }
                host.output_devices().ok()?.find(|device| {
                    device
                        .description()
                        .is_ok_and(|about| about.name() == label)
                })
            })
            .or_else(|| host.default_output_device())
            .ok_or("this computer has no audio output")?;
        let config = device
            .default_output_config()
            .map_err(|error| format!("the audio output cannot play: {error}"))?;
        let rate = config.sample_rate();
        let channels = usize::from(config.channels().max(1));
        let voice_channels = channels.min(2);
        let shared = Arc::new(Shared::default());
        for voice in &shared.voices {
            voice.set_gain(1.0);
        }

        let capacity = (f64::from(rate) * RING_SECONDS) as usize * voice_channels;
        let mut writers = Vec::with_capacity(VOICES);
        let mut readers = Vec::with_capacity(VOICES);
        for _ in 0..VOICES {
            let (producer, consumer) = RingBuffer::new(capacity);
            writers.push(VoiceWriter {
                producer,
                channels: voice_channels,
            });
            readers.push(VoiceReader {
                consumer,
                gain: 0.0,
            });
        }
        let writers: [VoiceWriter; VOICES] = writers.try_into().map_err(|_| "voices")?;
        let mut mixer = Mixer {
            readers: readers.try_into().map_err(|_| "voices")?,
            shared: shared.clone(),
            channels,
            voice_channels,
            rate,
            tone_phase: 0.0,
            frame: vec![0.0; voice_channels],
        };

        let broken = shared.clone();
        let stream = device
            .build_output_stream::<f32, _, _>(
                &config.config(),
                move |data, info| mixer.fill(data, info),
                move |error| {
                    tracing::warn!(%error, "the audio output failed");
                    broken.broken.store(true, Ordering::Release);
                },
                None,
            )
            .map_err(|error| format!("the audio output cannot be opened: {error}"))?;
        stream
            .play()
            .map_err(|error| format!("the audio output cannot start: {error}"))?;
        let device_id = device.id().ok().map(|id| id.to_string());
        tracing::info!(device = ?device_id, rate, channels, "audio output opened");
        Ok(Self {
            stream,
            running: true,
            shared,
            writers,
            rate,
            voice_channels,
            device_id,
        })
    }

    /// Start feeding the device again: quick, unlike opening it.
    pub fn resume(&mut self) {
        if self.running {
            return;
        }
        match self.stream.play() {
            Ok(()) => self.running = true,
            Err(error) => {
                tracing::warn!(%error, "the audio output could not start again");
                self.shared.broken.store(true, Ordering::Release);
            }
        }
    }

    /// Stop feeding the device, keeping it open.
    pub fn pause(&mut self) {
        if self.running && self.stream.pause().is_ok() {
            self.running = false;
        }
    }

    pub fn is_running(&self) -> bool {
        self.running
    }

    /// The test sound has not finished.
    pub fn is_sounding(&self) -> bool {
        self.shared.tone_frames.load(Ordering::Acquire) > 0
    }

    pub fn voice(&self, voice: usize) -> &VoiceShared {
        &self.shared.voices[voice]
    }

    pub fn is_broken(&self) -> bool {
        self.shared.broken.load(Ordering::Acquire)
    }

    /// Frames the device has taken that have not been heard yet.
    pub fn in_flight_frames(&self) -> u64 {
        self.shared.latency_frames.load(Ordering::Relaxed)
            + self.shared.callback_frames.load(Ordering::Relaxed)
    }

    /// Ask the device thread to drop what `voice` holds and write the mark
    /// after which its new sound begins. False when the device is not taking
    /// anything, so the mark could not be written.
    pub fn flush(&mut self, voice: usize) -> bool {
        let shared = &self.shared.voices[voice];
        shared.flushes_asked.fetch_add(1, Ordering::AcqRel);
        let mark = vec![f32::NAN; self.voice_channels];
        // The device thread empties the ring as soon as it sees the request.
        for _ in 0..200 {
            if self.writers[voice].write(&mark) == mark.len() {
                return true;
            }
            std::thread::sleep(std::time::Duration::from_millis(2));
        }
        false
    }

    /// A short tone, to hear which device the sound goes to.
    pub fn play_tone(&self) {
        self.shared.tone_frames.store(
            (f64::from(self.rate) * TONE_SECONDS) as u32,
            Ordering::Release,
        );
    }
}

const TONE_SECONDS: f64 = 0.7;
const TONE_HERTZ: f64 = 660.0;

/// The device thread's end of one voice.
struct VoiceReader {
    consumer: Consumer<f32>,
    /// Where the level is, moving towards the voice's: a level changed in
    /// one step clicks.
    gain: f32,
}

struct Mixer {
    readers: [VoiceReader; VOICES],
    shared: Arc<Shared>,
    channels: usize,
    voice_channels: usize,
    rate: u32,
    tone_phase: f64,
    frame: Vec<f32>,
}

impl Mixer {
    fn fill(&mut self, data: &mut [f32], info: &cpal::OutputCallbackInfo) {
        data.fill(0.0);
        let frames = data.len() / self.channels;
        let timestamp = info.timestamp();
        if let Some(latency) = timestamp.playback.duration_since(&timestamp.callback) {
            let latency = (latency.as_secs_f64() * f64::from(self.rate)) as u64;
            self.shared.latency_frames.store(latency, Ordering::Relaxed);
        }
        self.shared
            .callback_frames
            .store(frames as u64, Ordering::Relaxed);
        // About ten milliseconds to reach a new level.
        let step = 1.0 / (f64::from(self.rate) * 0.01) as f32;

        for (index, reader) in self.readers.iter_mut().enumerate() {
            let shared = &self.shared.voices[index];
            discard_to_mark(reader, shared, self.voice_channels);
            if shared.flushes_asked.load(Ordering::Acquire)
                != shared.flushes_done.load(Ordering::Acquire)
            {
                continue;
            }
            let target = shared.gain();
            if !shared.playing.load(Ordering::Acquire) {
                reader.gain = 0.0;
                continue;
            }
            let mut played = 0u64;
            for out in data.chunks_exact_mut(self.channels) {
                if reader.consumer.slots() < self.voice_channels {
                    break;
                }
                let mut marked = false;
                for sample in self.frame.iter_mut() {
                    *sample = reader.consumer.pop().unwrap_or(0.0);
                    marked |= sample.is_nan();
                }
                if marked {
                    // A seek was asked for and marked in the same instant:
                    // what follows is the new position's, counted afresh.
                    shared.flushes_done.fetch_add(1, Ordering::AcqRel);
                    shared.consumed.store(0, Ordering::Release);
                    played = 0;
                    break;
                }
                reader.gain += (target - reader.gain).clamp(-step, step);
                if self.voice_channels == 1 {
                    for channel in out.iter_mut() {
                        *channel += self.frame[0] * reader.gain;
                    }
                } else {
                    out[0] += self.frame[0] * reader.gain;
                    out[1] += self.frame[1] * reader.gain;
                }
                played += 1;
            }
            shared.consumed.fetch_add(played, Ordering::AcqRel);
        }

        let tone = self.shared.tone_frames.load(Ordering::Acquire);
        if tone > 0 {
            let total = (f64::from(self.rate) * TONE_SECONDS) as u32;
            let take = tone.min(frames as u32);
            for (index, out) in data
                .chunks_exact_mut(self.channels)
                .take(take as usize)
                .enumerate()
            {
                let at = f64::from(total - tone) + index as f64;
                // Faded in and out over 30 ms, so it does not click.
                let fade = (at.min(f64::from(total) - at) / (f64::from(self.rate) * 0.03)).min(1.0);
                let value = (self.tone_phase.sin() * 0.25 * fade) as f32;
                self.tone_phase += std::f64::consts::TAU * TONE_HERTZ / f64::from(self.rate);
                for channel in out.iter_mut() {
                    *channel += value;
                }
            }
            self.tone_phase %= std::f64::consts::TAU;
            self.shared
                .tone_frames
                .store(tone - take, Ordering::Release);
        }

        for sample in data.iter_mut() {
            *sample = sample.clamp(-1.0, 1.0);
        }
    }
}

/// While a flush is asked for, drop everything up to and including its mark.
fn discard_to_mark(reader: &mut VoiceReader, shared: &VoiceShared, channels: usize) {
    while shared.flushes_asked.load(Ordering::Acquire)
        != shared.flushes_done.load(Ordering::Acquire)
    {
        let available = reader.consumer.slots();
        if available < channels {
            return;
        }
        let Ok(chunk) = reader.consumer.read_chunk(available - available % channels) else {
            return;
        };
        let (first, second) = chunk.as_slices();
        let mark = first
            .iter()
            .chain(second.iter())
            .position(|sample| sample.is_nan());
        match mark {
            Some(at) => {
                // The mark is one whole frame.
                chunk.commit(at - at % channels + channels);
                shared.flushes_done.fetch_add(1, Ordering::AcqRel);
                shared.consumed.store(0, Ordering::Release);
                reader.gain = 0.0;
            }
            None => chunk.commit_all(),
        }
    }
}

/// An audio device, as Settings lists it.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AudioDevice {
    /// Stable across restarts and reconnections: the system's own id.
    pub id: String,
    pub label: String,
    pub is_default: bool,
}

/// The computer's audio devices, as the system names them.
#[derive(Debug, Clone, PartialEq, Eq, Default, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AudioDevices {
    pub outputs: Vec<AudioDevice>,
    pub inputs: Vec<AudioDevice>,
}

pub fn devices() -> AudioDevices {
    let host = cpal::default_host();
    let id_of = |device: &cpal::Device| device.id().ok().map(|id| id.to_string());
    let default_output = host.default_output_device().as_ref().and_then(id_of);
    let default_input = host.default_input_device().as_ref().and_then(id_of);
    let list = |devices: Option<Vec<cpal::Device>>, default: &Option<String>| {
        devices
            .unwrap_or_default()
            .iter()
            .filter_map(|device| {
                let id = id_of(device)?;
                let label = device.description().ok()?.name().trim().to_owned();
                Some(AudioDevice {
                    is_default: default.as_deref() == Some(id.as_str()),
                    label: if label.is_empty() { id.clone() } else { label },
                    id,
                })
            })
            .collect()
    };
    AudioDevices {
        outputs: list(
            host.output_devices().ok().map(Iterator::collect),
            &default_output,
        ),
        inputs: list(
            host.input_devices().ok().map(Iterator::collect),
            &default_input,
        ),
    }
}

/// The system's default output, by id: watched, so the sound follows it.
pub fn default_output_id() -> Option<String> {
    cpal::default_host()
        .default_output_device()
        .and_then(|device| device.id().ok())
        .map(|id| id.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The default device opens and takes what a voice is given, silently.
    /// `cargo test sound -- --ignored` on a machine with an audio output.
    #[test]
    #[ignore = "opens this computer's audio output"]
    fn the_default_output_takes_a_voices_sound() {
        let mut output = Output::open(None, None).expect("an audio output");
        output.voice(VIDEO).set_gain(0.0);
        output.voice(VIDEO).playing.store(true, Ordering::Release);
        assert!(output.flush(VIDEO));
        let second = vec![0.0f32; output.rate as usize * output.voice_channels];
        let written = output.writers[VIDEO].write(&second[..second.len() / 2]);
        assert!(written > 0);
        std::thread::sleep(std::time::Duration::from_millis(300));
        let consumed = output
            .voice(VIDEO)
            .consumed()
            .expect("the mark was reached");
        assert!(consumed > 0, "the device took nothing");
        assert!(consumed <= (written / output.voice_channels) as u64);
    }
}
