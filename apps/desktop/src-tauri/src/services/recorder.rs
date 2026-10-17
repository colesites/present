//! The microphone, recorded into named tracks.
//!
//! The recording window is the only place this is used. Capture stays at the
//! device's own rate and channel count (the first two channels, when a device
//! has more) so a take is not reduced on the way in. Export — from Share, not
//! from the window — chooses AAC, MP3, AIFF or WAVE, and a quality, and
//! whether the tracks are written separately or mixed into one file. Mixed
//! tracks start together: a shorter one is silence after it ends.
//!
//! Pause keeps what has been captured and record continues that same take.
//! Stop finishes it. Recording a finished track again replaces it, and only
//! once the new take has actually been read, so a microphone that never
//! starts does not wipe the one already there.
//!
//! The audio callback never takes the session lock. It appends to a buffer
//! the capture owns, and stopping joins the thread that owns the stream
//! before that buffer is read.

use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use std::str::FromStr;

use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use cpal::FromSample;
use serde::Serialize;

/// Where an export is written.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Format {
    /// MPEG-4 AAC, in an `.m4a` file. Encoded by the Mac.
    Aac,
    /// MPEG Layer 3.
    Mp3,
    /// Uncompressed, big-endian.
    Aiff,
    /// Uncompressed, little-endian.
    Wave,
}

impl Format {
    pub fn extension(self) -> &'static str {
        match self {
            Self::Aac => "m4a",
            Self::Mp3 => "mp3",
            Self::Aiff => "aiff",
            Self::Wave => "wav",
        }
    }

    pub fn label(self) -> &'static str {
        match self {
            Self::Aac => "AAC audio",
            Self::Mp3 => "MP3 audio",
            Self::Aiff => "AIFF audio",
            Self::Wave => "WAVE audio",
        }
    }

    fn compressed(self) -> bool {
        matches!(self, Self::Aac | Self::Mp3)
    }
}

/// How much of the recording an export keeps.
///
/// AAC and MP3 use the bit rate. AIFF and WAVE use the sample rate instead,
/// since they are not compressed: low is 22 kHz mono, medium is 44.1 kHz,
/// high is 48 kHz, and highest is 48 kHz at 24-bit.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Quality {
    Low,
    Medium,
    High,
    Highest,
}

impl Quality {
    fn pcm(self) -> (u32, u16, u16) {
        match self {
            Self::Low => (22_050, 1, 16),
            Self::Medium => (44_100, 2, 16),
            Self::High => (48_000, 2, 16),
            Self::Highest => (48_000, 2, 24),
        }
    }

    /// AAC and MP3, in bits per second.
    fn bits_per_second(self) -> u32 {
        match self {
            Self::Low => 64_000,
            Self::Medium => 128_000,
            Self::High => 192_000,
            Self::Highest => 256_000,
        }
    }
}

/// One take, as the window draws it.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TrackView {
    pub id: u64,
    pub name: String,
    pub seconds: f64,
    pub recording: bool,
    pub paused: bool,
    /// Loudest sample in each slice of the take, 0 to 1. Short enough to draw.
    pub peaks: Vec<f32>,
}

/// What the window draws.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Snapshot {
    pub input_id: Option<String>,
    pub tracks: Vec<TrackView>,
    pub recording_track_id: Option<u64>,
    pub paused_track_id: Option<u64>,
    pub level: f32,
    /// Set when the microphone stops on its own. Written for the operator.
    pub warning: Option<String>,
    /// Share ▸ Export Recording was chosen. The window opens its options and
    /// then clears this.
    pub export_requested: bool,
    /// The formats this computer can write. AAC is a Mac; MP3, AIFF and WAVE
    /// are everywhere.
    pub formats: Vec<&'static str>,
}

#[derive(Clone)]
pub struct Recorder {
    gate: Arc<Mutex<()>>,
    inner: Arc<Mutex<Session>>,
    /// Set when the window closes, so a take that was still opening — the
    /// permission dialog can outlive the window — is not left running.
    closed: Arc<AtomicBool>,
}

struct Session {
    input_id: Option<String>,
    tracks: Vec<Track>,
    recording: Option<Recording>,
    /// The take pause held. Record on this track continues it.
    paused: Option<u64>,
    next_id: u64,
    warning: Option<String>,
    export_requested: bool,
}

#[derive(Clone)]
struct Track {
    id: u64,
    name: String,
    /// Interleaved, `channels` wide, at `rate`.
    samples: Vec<f32>,
    channels: u16,
    rate: u32,
}

struct Recording {
    track_id: u64,
    capture: Capture,
    /// The samples join the take already stored. A fresh recording replaces it.
    append: bool,
}

struct Capture {
    stop: Arc<AtomicBool>,
    thread: Option<std::thread::JoinHandle<()>>,
    buffer: Arc<Mutex<Vec<f32>>>,
    peak: Arc<AtomicU32>,
    failed: Arc<Mutex<Option<String>>>,
    channels: u16,
    rate: u32,
}

impl Drop for Capture {
    fn drop(&mut self) {
        self.stop.store(true, Ordering::Release);
        if let Some(thread) = self.thread.take() {
            let _ = thread.join();
        }
    }
}

impl Capture {
    fn finish(mut self) -> Finished {
        self.stop.store(true, Ordering::Release);
        if let Some(thread) = self.thread.take() {
            let _ = thread.join();
        }
        let samples = std::mem::take(&mut *lock(&self.buffer));
        let warning = lock(&self.failed).clone();
        Finished {
            samples,
            channels: self.channels,
            rate: self.rate,
            warning,
        }
    }
}

struct Finished {
    samples: Vec<f32>,
    channels: u16,
    rate: u32,
    warning: Option<String>,
}

impl Recorder {
    pub fn new() -> Self {
        Self {
            gate: Arc::new(Mutex::new(())),
            inner: Arc::new(Mutex::new(Session::new())),
            closed: Arc::new(AtomicBool::new(false)),
        }
    }

    /// The window has gone. Keep the takes, and do not leave the microphone open.
    pub fn suspend(&self) {
        self.closed.store(true, Ordering::Release);
        self.stop();
    }

    /// File ▸ New Recording. A take opened for a window that has since closed
    /// is dropped instead of recorded into a window nobody is looking at.
    pub fn resume(&self) {
        self.closed.store(false, Ordering::Release);
    }

    /// Share ▸ Export Recording. The window reads this from the next snapshot
    /// if it was not open in time to hear the menu.
    pub fn request_export(&self) {
        lock(&self.inner).export_requested = true;
    }

    pub fn acknowledge_export(&self) {
        lock(&self.inner).export_requested = false;
    }

    pub fn snapshot(&self) -> Snapshot {
        let session = lock(&self.inner);
        let Session {
            input_id,
            tracks,
            recording,
            paused,
            warning,
            export_requested,
            ..
        } = &*session;
        let live = recording.as_ref().map(|recording| {
            let level = f32::from_bits(recording.capture.peak.swap(0, Ordering::Relaxed));
            let failed = lock(&recording.capture.failed).clone();
            (recording.track_id, level, failed)
        });
        Snapshot {
            input_id: input_id.clone(),
            recording_track_id: live.as_ref().map(|live| live.0),
            paused_track_id: *paused,
            level: live
                .as_ref()
                .map(|live| live.1.clamp(0.0, 1.0))
                .unwrap_or(0.0),
            warning: live
                .as_ref()
                .and_then(|live| live.2.clone())
                .or_else(|| warning.clone()),
            export_requested: *export_requested,
            formats: export_formats(),
            tracks: tracks
                .iter()
                .map(|track| {
                    let active = recording
                        .as_ref()
                        .filter(|recording| recording.track_id == track.id);
                    let (seconds, peaks) = match active {
                        Some(recording) => {
                            let samples = lock(&recording.capture.buffer);
                            let live_seconds = seconds(
                                samples.len(),
                                recording.capture.channels,
                                recording.capture.rate,
                            );
                            if recording.append {
                                (
                                    seconds_of(track) + live_seconds,
                                    waveform(&[
                                        (&track.samples, track.channels, track.rate),
                                        (
                                            &samples,
                                            recording.capture.channels,
                                            recording.capture.rate,
                                        ),
                                    ]),
                                )
                            } else {
                                (
                                    live_seconds,
                                    waveform(&[(
                                        &samples,
                                        recording.capture.channels,
                                        recording.capture.rate,
                                    )]),
                                )
                            }
                        }
                        None => (
                            seconds_of(track),
                            waveform(&[(&track.samples, track.channels, track.rate)]),
                        ),
                    };
                    TrackView {
                        id: track.id,
                        name: track.name.clone(),
                        seconds,
                        recording: active.is_some(),
                        paused: *paused == Some(track.id),
                        peaks,
                    }
                })
                .collect(),
        }
    }

    /// `None` follows the system's default microphone.
    pub fn set_input(&self, device_id: Option<String>) -> Result<(), String> {
        let _gate = lock(&self.gate);
        self.commit();
        lock(&self.inner).input_id = device_id.filter(|id| !id.trim().is_empty());
        Ok(())
    }

    pub fn add_track(&self) -> TrackView {
        let _gate = lock(&self.gate);
        let mut session = lock(&self.inner);
        let id = session.next_id;
        session.next_id += 1;
        let name = next_name(&session.tracks);
        session.tracks.push(Track::empty(id, name));
        view(&session.tracks[session.tracks.len() - 1], false, 0.0)
    }

    pub fn rename_track(&self, id: u64, name: String) -> Result<(), String> {
        let name = name.trim();
        if name.is_empty() {
            return Err("Give the track a name.".to_owned());
        }
        let mut session = lock(&self.inner);
        let track = session
            .tracks
            .iter_mut()
            .find(|track| track.id == id)
            .ok_or_else(|| "That track is no longer there.".to_owned())?;
        track.name = name.to_owned();
        Ok(())
    }

    pub fn remove_track(&self, id: u64) -> Result<(), String> {
        let _gate = lock(&self.gate);
        {
            let session = lock(&self.inner);
            if session
                .recording
                .as_ref()
                .is_some_and(|recording| recording.track_id == id)
            {
                drop(session);
                self.commit();
            }
        }
        let mut session = lock(&self.inner);
        session.tracks.retain(|track| track.id != id);
        if session.paused == Some(id) {
            session.paused = None;
        }
        if session.tracks.is_empty() {
            let id = session.next_id;
            session.next_id += 1;
            session.tracks.push(Track::empty(id, "Track 1".to_owned()));
        }
        Ok(())
    }

    /// Record `id`. A paused take on that track is continued. A finished take
    /// is replaced once the new one has been read. A take already in progress
    /// on another track is kept first.
    pub fn start(&self, id: u64) -> Result<(), String> {
        if self.closed.load(Ordering::Acquire) {
            return Err("Open the recording window and try again.".to_owned());
        }
        let device_id = {
            let _gate = lock(&self.gate);
            {
                let session = lock(&self.inner);
                if session
                    .recording
                    .as_ref()
                    .is_some_and(|recording| recording.track_id == id)
                {
                    return Ok(());
                }
            }
            self.commit();
            let session = lock(&self.inner);
            if !session.tracks.iter().any(|track| track.id == id) {
                return Err("That track is no longer there.".to_owned());
            }
            session.input_id.clone()
        };
        // The permission dialog runs on the main thread. The gate is not held
        // across it, or closing the window there would wait forever.
        let capture = Capture::open(device_id.as_deref())?;
        let _gate = lock(&self.gate);
        if self.closed.load(Ordering::Acquire) {
            return Ok(());
        }
        let mut session = lock(&self.inner);
        if !session.tracks.iter().any(|track| track.id == id) {
            return Err("That track is no longer there.".to_owned());
        }
        let append = session.paused == Some(id);
        session.paused = None;
        session.warning = None;
        session.recording = Some(Recording {
            track_id: id,
            capture,
            append,
        });
        Ok(())
    }

    /// Hold the take that is in progress. Record again continues it.
    pub fn pause(&self) -> Result<(), String> {
        let _gate = lock(&self.gate);
        let id = {
            let session = lock(&self.inner);
            match session.recording.as_ref() {
                Some(recording) => recording.track_id,
                None => return Ok(()),
            }
        };
        self.commit();
        lock(&self.inner).paused = Some(id);
        Ok(())
    }

    /// Finish the take that is in progress, or the one that is paused.
    /// Recording it again starts over.
    pub fn stop(&self) {
        let _gate = lock(&self.gate);
        self.commit();
        lock(&self.inner).paused = None;
    }

    /// The takes to write, copied so the dialog can wait without holding them.
    ///
    /// `track` is one take. `None` with `separate` is every take that has
    /// sound. `None` without `separate` mixes those takes into one.
    pub fn prepare_export(
        &self,
        format: Format,
        quality: Quality,
        track: Option<u64>,
        separate: bool,
    ) -> Result<Vec<Prepared>, String> {
        let _gate = lock(&self.gate);
        let chosen = {
            let session = lock(&self.inner);
            if session.recording.is_some() {
                return Err("Pause or stop the recording before exporting.".to_owned());
            }
            let tracks: Vec<Track> = match track {
                Some(id) => vec![session
                    .tracks
                    .iter()
                    .find(|track| track.id == id)
                    .ok_or_else(|| "That track is no longer there.".to_owned())?
                    .clone()],
                None => session
                    .tracks
                    .iter()
                    .filter(|track| !track.samples.is_empty())
                    .cloned()
                    .collect(),
            };
            tracks
        };
        if chosen.is_empty() || chosen.iter().all(|track| track.samples.is_empty()) {
            return Err("Record something before exporting.".to_owned());
        }
        let (rate, channels, bits) = if format.compressed() {
            (44_100, 2, 16)
        } else {
            quality.pcm()
        };
        let bitrate = quality.bits_per_second();
        let rendered: Vec<Prepared> = chosen
            .iter()
            .filter(|track| !track.samples.is_empty())
            .map(|track| Prepared {
                name: track.name.clone(),
                channels,
                rate,
                bits,
                format,
                bitrate,
                samples: render(&track.samples, track.channels, track.rate, channels, rate),
            })
            .collect();
        if separate || track.is_some() {
            return Ok(rendered);
        }
        let name = if rendered.len() == 1 {
            rendered[0].name.clone()
        } else {
            "Recording".to_owned()
        };
        Ok(vec![Prepared {
            name,
            channels,
            rate,
            bits,
            format,
            bitrate,
            samples: mix(&rendered
                .iter()
                .map(|take| take.samples.clone())
                .collect::<Vec<_>>()),
        }])
    }

    /// A path in `directory` for `name`, leaving a file that is already there alone.
    pub fn file_in(directory: &Path, name: &str, extension: &str) -> PathBuf {
        available_file(directory, &file_stem(name), extension)
    }

    pub fn write_one(path: &Path, take: &Prepared) -> Result<(), String> {
        let bytes = encode(take)?;
        std::fs::write(path, bytes).map_err(|error| {
            tracing::warn!(%error, "could not write the recording");
            "The recording could not be saved.".to_owned()
        })
    }

    /// Stop, and store what was captured onto its track. The previous take is
    /// replaced only once this one has been read, so a microphone that never
    /// starts does not wipe it.
    fn commit(&self) {
        let recording = lock(&self.inner).recording.take();
        let Some(recording) = recording else {
            return;
        };
        let finished = recording.capture.finish();
        let mut session = lock(&self.inner);
        if let Some(warning) = finished.warning {
            session.warning = Some(warning);
        }
        if let Some(track) = session
            .tracks
            .iter_mut()
            .find(|track| track.id == recording.track_id)
        {
            store(
                track,
                &finished.samples,
                finished.channels,
                finished.rate,
                recording.append,
            );
        }
    }
}

impl Session {
    fn new() -> Self {
        Self {
            input_id: None,
            tracks: vec![Track::empty(1, "Track 1".to_owned())],
            recording: None,
            paused: None,
            next_id: 2,
            warning: None,
            export_requested: false,
        }
    }
}

impl Track {
    fn empty(id: u64, name: String) -> Self {
        Self {
            id,
            name,
            samples: Vec::new(),
            channels: 1,
            rate: 48_000,
        }
    }
}

pub struct Prepared {
    pub name: String,
    pub samples: Vec<f32>,
    pub channels: u16,
    pub rate: u32,
    pub bits: u16,
    pub format: Format,
    /// AAC and MP3, in bits per second. Unused for AIFF and WAVE.
    pub bitrate: u32,
}

impl Prepared {
    pub fn suggested_file_name(&self) -> String {
        format!("{}.{}", file_stem(&self.name), self.format.extension())
    }
}

fn export_formats() -> Vec<&'static str> {
    #[cfg(target_os = "macos")]
    {
        vec!["aac", "mp3", "aiff", "wave"]
    }
    #[cfg(not(target_os = "macos"))]
    {
        vec!["mp3", "aiff", "wave"]
    }
}

fn view(track: &Track, recording: bool, seconds: f64) -> TrackView {
    TrackView {
        id: track.id,
        name: track.name.clone(),
        seconds: if recording {
            seconds
        } else {
            seconds_of(track)
        },
        recording,
        paused: false,
        peaks: Vec::new(),
    }
}

/// How many slices of a take the window draws.
const PEAKS: usize = 240;

fn waveform(parts: &[(&[f32], u16, u32)]) -> Vec<f32> {
    let total: f64 = parts
        .iter()
        .map(|(samples, channels, rate)| seconds(samples.len(), *channels, *rate))
        .sum();
    if total <= 0.0 {
        return Vec::new();
    }
    let mut out = Vec::with_capacity(PEAKS);
    for (samples, channels, rate) in parts {
        if samples.is_empty() {
            continue;
        }
        let share = seconds(samples.len(), *channels, *rate) / total;
        let count = ((share * PEAKS as f64).round() as usize).max(1);
        out.extend(peak_buckets(samples, *channels, count));
    }
    out
}

fn peak_buckets(samples: &[f32], channels: u16, count: usize) -> Vec<f32> {
    let channels = usize::from(channels.max(1));
    let frames = samples.len() / channels;
    if frames == 0 || count == 0 {
        return Vec::new();
    }
    let mut out = vec![0.0; count];
    let step = (frames / (count * 8)).max(1);
    let mut frame = 0;
    while frame < frames {
        let bucket = (frame * count / frames).min(count - 1);
        let base = frame * channels;
        let mut peak = 0.0f32;
        for channel in 0..channels {
            if let Some(sample) = samples.get(base + channel) {
                peak = peak.max(sample.abs());
            }
        }
        if peak > out[bucket] {
            out[bucket] = peak.min(1.0);
        }
        frame += step;
    }
    out
}

fn store(track: &mut Track, samples: &[f32], channels: u16, rate: u32, append: bool) {
    if samples.is_empty() {
        return;
    }
    let same = track.rate == rate && track.channels == channels;
    if append && !track.samples.is_empty() && same {
        track.samples.extend_from_slice(samples);
        return;
    }
    if append && !track.samples.is_empty() {
        track
            .samples
            .extend(render(samples, channels, rate, track.channels, track.rate));
        return;
    }
    track.samples = samples.to_vec();
    track.channels = channels;
    track.rate = rate;
}

fn seconds_of(track: &Track) -> f64 {
    seconds(track.samples.len(), track.channels, track.rate)
}

fn seconds(samples: usize, channels: u16, rate: u32) -> f64 {
    if channels == 0 || rate == 0 {
        return 0.0;
    }
    samples as f64 / f64::from(channels) / f64::from(rate)
}

fn next_name(tracks: &[Track]) -> String {
    let mut n = tracks.len() + 1;
    loop {
        let name = format!("Track {n}");
        if !tracks.iter().any(|track| track.name == name) {
            return name;
        }
        n += 1;
    }
}

fn lock<T>(mutex: &Mutex<T>) -> std::sync::MutexGuard<'_, T> {
    mutex
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}

impl Capture {
    fn open(device_id: Option<&str>) -> Result<Self, String> {
        use crate::services::permissions::{self, MediaKind};
        let access = permissions::request(MediaKind::Microphone);
        if !access.granted {
            return Err(match access.status.as_str() {
                "restricted" => "This Mac doesn't allow apps to use the microphone (Screen Time or a device profile).".to_owned(),
                _ => "Present isn't allowed to use the microphone. Turn it on in System Settings > Privacy & Security > Microphone, then try again.".to_owned(),
            });
        }

        let stop = Arc::new(AtomicBool::new(false));
        let buffer = Arc::new(Mutex::new(Vec::<f32>::new()));
        let peak = Arc::new(AtomicU32::new(0));
        let failed = Arc::new(Mutex::new(None));
        let (ready, started) = std::sync::mpsc::channel::<Result<(u16, u32), String>>();
        let stopping = Arc::clone(&stop);
        let captured = Arc::clone(&buffer);
        let level = Arc::clone(&peak);
        let fault = Arc::clone(&failed);
        let device_id = device_id.map(str::to_owned);
        let thread = std::thread::Builder::new()
            .name("present-recorder".into())
            .spawn(move || {
                let opened = open_stream(device_id.as_deref(), &captured, &level, &fault);
                let (stream, channels, rate) = match opened {
                    Ok(opened) => opened,
                    Err(error) => {
                        let _ = ready.send(Err(error));
                        return;
                    }
                };
                let _ = ready.send(Ok((channels, rate)));
                while !stopping.load(Ordering::Acquire) {
                    std::thread::sleep(Duration::from_millis(50));
                }
                drop(stream);
            })
            .map_err(|error| {
                tracing::warn!(%error, "the recording thread did not start");
                "The microphone could not be opened.".to_owned()
            })?;
        match started.recv_timeout(Duration::from_secs(10)) {
            Ok(Ok((channels, rate))) => Ok(Self {
                stop,
                thread: Some(thread),
                buffer,
                peak,
                failed,
                channels,
                rate,
            }),
            Ok(Err(error)) => {
                stop.store(true, Ordering::Release);
                let _ = thread.join();
                Err(error)
            }
            Err(_) => {
                stop.store(true, Ordering::Release);
                let _ = thread.join();
                Err("The microphone did not start.".to_owned())
            }
        }
    }
}

type Opened = (cpal::Stream, u16, u32);

fn open_stream(
    device_id: Option<&str>,
    buffer: &Arc<Mutex<Vec<f32>>>,
    peak: &Arc<AtomicU32>,
    failed: &Arc<Mutex<Option<String>>>,
) -> Result<Opened, String> {
    let host = cpal::default_host();
    let device = device_id
        .and_then(|id| cpal::DeviceId::from_str(id).ok())
        .and_then(|id| host.device_by_id(&id))
        .or_else(|| host.default_input_device())
        .ok_or_else(|| "This computer has no microphone.".to_owned())?;
    let config = device
        .default_input_config()
        .map_err(|error| plain_open_error(&error))?;
    let rate = config.sample_rate();
    let device_channels = usize::from(config.channels().max(1));
    // An interface with many channels records its first pair. The rest is
    // other inputs the operator did not ask to mix in.
    let keep = u16::try_from(device_channels.min(2)).unwrap_or(1);
    let buffer = Arc::clone(buffer);
    let peak = Arc::clone(peak);
    let failed = Arc::clone(failed);
    let report = move |error: cpal::StreamError| {
        tracing::warn!(%error, "the recording microphone failed");
        *lock(&failed) =
            Some("The microphone stopped. Check that it is still connected.".to_owned());
    };
    let stream = match config.sample_format() {
        cpal::SampleFormat::F32 => build::<f32>(
            &device,
            &config,
            device_channels,
            keep,
            buffer,
            peak,
            report,
        ),
        cpal::SampleFormat::I16 => build::<i16>(
            &device,
            &config,
            device_channels,
            keep,
            buffer,
            peak,
            report,
        ),
        cpal::SampleFormat::I32 => build::<i32>(
            &device,
            &config,
            device_channels,
            keep,
            buffer,
            peak,
            report,
        ),
        cpal::SampleFormat::U16 => build::<u16>(
            &device,
            &config,
            device_channels,
            keep,
            buffer,
            peak,
            report,
        ),
        cpal::SampleFormat::F64 => build::<f64>(
            &device,
            &config,
            device_channels,
            keep,
            buffer,
            peak,
            report,
        ),
        other => {
            tracing::warn!(format = %other, "the microphone's samples are not ones this records");
            return Err(
                "The microphone could not be opened. Its sound is in a form this does not record."
                    .to_owned(),
            );
        }
    }
    .map_err(|error| plain_open_error(&error))?;
    stream.play().map_err(|error| plain_open_error(&error))?;
    tracing::info!(rate, channels = keep, "recording microphone opened");
    Ok((stream, keep, rate))
}

fn plain_open_error(error: &impl std::fmt::Display) -> String {
    tracing::warn!(%error, "could not open the recording microphone");
    "The microphone could not be opened. Check that it is connected and that Present is allowed to use it.".to_owned()
}

fn build<T>(
    device: &cpal::Device,
    config: &cpal::SupportedStreamConfig,
    device_channels: usize,
    keep: u16,
    buffer: Arc<Mutex<Vec<f32>>>,
    peak: Arc<AtomicU32>,
    report: impl FnMut(cpal::StreamError) + Send + 'static,
) -> Result<cpal::Stream, cpal::BuildStreamError>
where
    T: cpal::SizedSample,
    f32: FromSample<T>,
{
    let keep = usize::from(keep);
    device.build_input_stream(
        &config.config(),
        move |data: &[T], _| {
            let mut guard = lock(&buffer);
            for frame in data.chunks_exact(device_channels) {
                for sample in frame.iter().take(keep) {
                    let value = finite(sample.to_sample::<f32>());
                    note_peak(&peak, value);
                    guard.push(value);
                }
            }
        },
        report,
        None,
    )
}

fn finite(sample: f32) -> f32 {
    if sample.is_finite() {
        sample
    } else {
        0.0
    }
}

fn note_peak(peak: &AtomicU32, sample: f32) {
    let level = sample.abs();
    let bits = level.to_bits();
    let mut current = peak.load(Ordering::Relaxed);
    while f32::from_bits(current) < level {
        match peak.compare_exchange_weak(current, bits, Ordering::Relaxed, Ordering::Relaxed) {
            Ok(_) => break,
            Err(seen) => current = seen,
        }
    }
}

fn render(
    samples: &[f32],
    from_channels: u16,
    from_rate: u32,
    channels: u16,
    rate: u32,
) -> Vec<f32> {
    let fitted = fit_channels(
        samples,
        usize::from(from_channels.max(1)),
        usize::from(channels.max(1)),
    );
    let mut rendered = resample(
        &fitted,
        usize::from(channels.max(1)),
        from_rate.max(1),
        rate.max(1),
    );
    for sample in &mut rendered {
        *sample = finite(*sample).clamp(-1.0, 1.0);
    }
    rendered
}

fn fit_channels(samples: &[f32], from: usize, to: usize) -> Vec<f32> {
    if from == 0 || to == 0 || samples.is_empty() {
        return Vec::new();
    }
    if from == to {
        return samples.to_vec();
    }
    let mut out = Vec::with_capacity(samples.len() / from * to);
    for frame in samples.chunks_exact(from) {
        if to == 1 {
            let sum: f32 = frame.iter().copied().map(finite).sum();
            out.push(sum / from as f32);
        } else if from == 1 {
            let sample = finite(frame[0]);
            out.extend(std::iter::repeat_n(sample, to));
        } else {
            out.extend(frame.iter().take(to).copied().map(finite));
        }
    }
    out
}

fn resample(samples: &[f32], channels: usize, in_rate: u32, out_rate: u32) -> Vec<f32> {
    if channels == 0 || in_rate == 0 || out_rate == 0 || samples.is_empty() {
        return Vec::new();
    }
    if in_rate == out_rate {
        return samples.to_vec();
    }
    let in_frames = samples.len() / channels;
    if in_frames == 0 {
        return Vec::new();
    }
    let out_frames =
        ((in_frames as u128) * u128::from(out_rate) / u128::from(in_rate)).max(1) as usize;
    let mut out = vec![0.0; out_frames * channels];
    for index in 0..out_frames {
        let position = index as f64 * f64::from(in_rate) / f64::from(out_rate);
        let left = (position.floor() as usize).min(in_frames - 1);
        let right = (left + 1).min(in_frames - 1);
        let fraction = (position - left as f64) as f32;
        for channel in 0..channels {
            let start = samples[left * channels + channel];
            let end = samples[right * channels + channel];
            out[index * channels + channel] = start + (end - start) * fraction;
        }
    }
    out
}

/// Sum from the first sample. A peak past full scale is brought back to just
/// under it, so two loud takes do not distort; a quieter mix is left as it was.
fn mix(takes: &[Vec<f32>]) -> Vec<f32> {
    let length = takes.iter().map(Vec::len).max().unwrap_or(0);
    let mut mixed = vec![0.0; length];
    for take in takes {
        for (index, sample) in take.iter().enumerate() {
            mixed[index] += finite(*sample);
        }
    }
    let peak = mixed.iter().map(|sample| sample.abs()).fold(0.0, f32::max);
    if peak > 1.0 {
        let scale = 0.98 / peak;
        for sample in &mut mixed {
            *sample *= scale;
        }
    }
    mixed
}

fn encode_wav(samples: &[f32], channels: u16, rate: u32, bits: u16) -> std::io::Result<Vec<u8>> {
    let channels = channels.max(1);
    let bytes_per_sample = usize::from(bits / 8);
    let data_len = samples.len().checked_mul(bytes_per_sample).ok_or_else(|| {
        std::io::Error::new(std::io::ErrorKind::InvalidData, "recording is too long")
    })?;
    let data_len = u32::try_from(data_len).map_err(|_| {
        std::io::Error::new(std::io::ErrorKind::InvalidData, "recording is too long")
    })?;
    let block = u16::from(channels) * (bits / 8);
    let byte_rate = rate.saturating_mul(u32::from(block));
    let mut bytes = Vec::with_capacity(44 + data_len as usize);
    bytes.extend_from_slice(b"RIFF");
    bytes.extend_from_slice(&(36 + data_len).to_le_bytes());
    bytes.extend_from_slice(b"WAVE");
    bytes.extend_from_slice(b"fmt ");
    bytes.extend_from_slice(&16u32.to_le_bytes());
    bytes.extend_from_slice(&1u16.to_le_bytes());
    bytes.extend_from_slice(&channels.to_le_bytes());
    bytes.extend_from_slice(&rate.to_le_bytes());
    bytes.extend_from_slice(&byte_rate.to_le_bytes());
    bytes.extend_from_slice(&block.to_le_bytes());
    bytes.extend_from_slice(&bits.to_le_bytes());
    bytes.extend_from_slice(b"data");
    bytes.extend_from_slice(&data_len.to_le_bytes());
    match bits {
        16 => {
            for sample in samples {
                let value = (finite(*sample).clamp(-1.0, 1.0) * 32767.0).round() as i16;
                bytes.extend_from_slice(&value.to_le_bytes());
            }
        }
        24 => {
            for sample in samples {
                let value = (finite(*sample).clamp(-1.0, 1.0) * 8_388_607.0).round() as i32;
                bytes.extend_from_slice(&value.to_le_bytes()[..3]);
            }
        }
        _ => {
            return Err(std::io::Error::new(
                std::io::ErrorKind::InvalidData,
                "unsupported recording",
            ))
        }
    }
    Ok(bytes)
}

pub(crate) fn file_stem(name: &str) -> String {
    let mut stem = String::new();
    for ch in name.chars() {
        if ch.is_alphanumeric() || ch == ' ' || ch == '-' || ch == '_' {
            stem.push(ch);
        }
    }
    let stem = stem.split_whitespace().collect::<Vec<_>>().join(" ");
    let stem = if stem.is_empty() {
        "Recording".to_owned()
    } else {
        stem
    };
    match stem.to_ascii_uppercase().as_str() {
        "CON" | "PRN" | "AUX" | "NUL" | "COM1" | "LPT1" => format!("{stem} recording"),
        _ => stem,
    }
}

fn available_file(directory: &Path, stem: &str, extension: &str) -> PathBuf {
    let first = directory.join(format!("{stem}.{extension}"));
    if !first.exists() {
        return first;
    }
    for n in 2..10_000 {
        let candidate = directory.join(format!("{stem} {n}.{extension}"));
        if !candidate.exists() {
            return candidate;
        }
    }
    directory.join(format!("{stem}-{}.{extension}", std::process::id()))
}

fn encode(take: &Prepared) -> Result<Vec<u8>, String> {
    match take.format {
        Format::Wave => encode_wav(&take.samples, take.channels, take.rate, take.bits)
            .map_err(|_| "The recording could not be saved as WAVE.".to_owned()),
        Format::Aiff => encode_aiff(&take.samples, take.channels, take.rate, take.bits)
            .map_err(|_| "The recording could not be saved as AIFF.".to_owned()),
        Format::Aac => encode_aac(&take.samples, take.channels, take.rate, take.bitrate),
        Format::Mp3 => encode_mp3(&take.samples, take.channels, take.rate, take.bitrate / 1000),
    }
}

fn encode_aiff(samples: &[f32], channels: u16, rate: u32, bits: u16) -> std::io::Result<Vec<u8>> {
    let channels = channels.max(1);
    let frames = samples.len() / usize::from(channels);
    let bytes_per_sample = usize::from(bits / 8);
    let data_len = frames
        .checked_mul(usize::from(channels))
        .and_then(|samples| samples.checked_mul(bytes_per_sample))
        .ok_or_else(|| {
            std::io::Error::new(std::io::ErrorKind::InvalidData, "recording is too long")
        })?;
    let data_len = u32::try_from(data_len).map_err(|_| {
        std::io::Error::new(std::io::ErrorKind::InvalidData, "recording is too long")
    })?;
    // FORM + AIFF + COMM(26) + SSND header(16) + samples. The chunk sizes
    // exclude the 8-byte header of the chunk they belong to.
    let form_size = 4 + 26 + 16 + data_len;
    let mut bytes = Vec::with_capacity(8 + form_size as usize);
    bytes.extend_from_slice(b"FORM");
    bytes.extend_from_slice(&form_size.to_be_bytes());
    bytes.extend_from_slice(b"AIFF");
    bytes.extend_from_slice(b"COMM");
    bytes.extend_from_slice(&18u32.to_be_bytes());
    bytes.extend_from_slice(&channels.to_be_bytes());
    bytes.extend_from_slice(&(frames as u32).to_be_bytes());
    bytes.extend_from_slice(&bits.to_be_bytes());
    bytes.extend_from_slice(&extended80(f64::from(rate)));
    bytes.extend_from_slice(b"SSND");
    bytes.extend_from_slice(&(8 + data_len).to_be_bytes());
    bytes.extend_from_slice(&0u32.to_be_bytes());
    bytes.extend_from_slice(&0u32.to_be_bytes());
    match bits {
        16 => {
            for sample in samples {
                let value = (finite(*sample).clamp(-1.0, 1.0) * 32_767.0).round() as i16;
                bytes.extend_from_slice(&value.to_be_bytes());
            }
        }
        24 => {
            for sample in samples {
                let value = (finite(*sample).clamp(-1.0, 1.0) * 8_388_607.0).round() as i32;
                bytes.extend_from_slice(&value.to_be_bytes()[1..4]);
            }
        }
        _ => {
            return Err(std::io::Error::new(
                std::io::ErrorKind::InvalidData,
                "unsupported recording",
            ))
        }
    }
    Ok(bytes)
}

/// An 80-bit extended float, which is how AIFF stores its sample rate.
fn extended80(value: f64) -> [u8; 10] {
    if value == 0.0 || !value.is_finite() {
        return [0; 10];
    }
    let bits = value.to_bits();
    let sign = ((bits >> 63) as u16) << 15;
    let exponent = ((bits >> 52) & 0x7ff) as i32;
    if exponent == 0 {
        return [0; 10];
    }
    let mantissa = (bits & 0x000f_ffff_ffff_ffff) | (1 << 52);
    let exponent = exponent - 1023 + 16_383;
    let mantissa = mantissa << 11;
    let mut out = [0u8; 10];
    out[..2].copy_from_slice(&(sign | exponent as u16).to_be_bytes());
    out[2..].copy_from_slice(&mantissa.to_be_bytes());
    out
}

fn encode_mp3(samples: &[f32], channels: u16, rate: u32, kbps: u32) -> Result<Vec<u8>, String> {
    use mp3lame_encoder::{Bitrate, Builder, FlushNoGap, Quality};

    let channels = if channels <= 1 { 1 } else { 2 };
    let bitrate = match kbps {
        64 => Bitrate::Kbps64,
        128 => Bitrate::Kbps128,
        192 => Bitrate::Kbps192,
        256 => Bitrate::Kbps256,
        _ => Bitrate::Kbps128,
    };
    let mut encoder = Builder::new()
        .ok_or_else(|| "This recording could not be saved as MP3.".to_owned())?
        .with_num_channels(channels)
        .and_then(|builder| builder.with_sample_rate(rate))
        .and_then(|builder| builder.with_brate(bitrate))
        .and_then(|builder| builder.with_quality(Quality::NearBest))
        .and_then(|builder| builder.build())
        .map_err(|error| {
            tracing::warn!(%error, "the MP3 encoder did not start");
            "This recording could not be saved as MP3.".to_owned()
        })?;
    let frames = samples.len() / usize::from(channels);
    let mut out = Vec::new();
    let mut start = 0;
    let chunk = 1152 * 16;
    while start < frames {
        let end = (start + chunk).min(frames);
        let slice = &samples[start * usize::from(channels)..end * usize::from(channels)];
        let written = encode_mp3_chunk(&mut encoder, slice, channels, end - start)?;
        out.extend_from_slice(&written);
        start = end;
    }
    let mut tail = vec![std::mem::MaybeUninit::<u8>::uninit(); 8192];
    let flushed = encoder.flush::<FlushNoGap>(&mut tail).map_err(|error| {
        tracing::warn!(%error, "the MP3 encoder did not finish");
        "This recording could not be saved as MP3.".to_owned()
    })?;
    // `flushed` is how many bytes of `tail` LAME initialised.
    out.extend(
        tail.into_iter()
            .take(flushed)
            .map(|byte| unsafe { byte.assume_init() }),
    );
    if out.is_empty() {
        return Err("This recording could not be saved as MP3.".to_owned());
    }
    Ok(out)
}

fn encode_mp3_chunk(
    encoder: &mut mp3lame_encoder::Encoder,
    slice: &[f32],
    channels: u8,
    frames: usize,
) -> Result<Vec<u8>, String> {
    use mp3lame_encoder::{InterleavedPcm, MonoPcm};

    let mut buffer = vec![
        std::mem::MaybeUninit::<u8>::uninit();
        mp3lame_encoder::max_required_buffer_size(frames)
    ];
    let written = if channels == 1 {
        encoder.encode(MonoPcm(slice), &mut buffer)
    } else {
        encoder.encode(InterleavedPcm(slice), &mut buffer)
    }
    .map_err(|error| {
        tracing::warn!(%error, "the MP3 encoder rejected the sound");
        "This recording could not be saved as MP3.".to_owned()
    })?;
    // `written` is how many bytes of `buffer` LAME initialised.
    Ok(buffer
        .into_iter()
        .take(written)
        .map(|byte| unsafe { byte.assume_init() })
        .collect())
}

fn encode_aac(samples: &[f32], channels: u16, rate: u32, bitrate: u32) -> Result<Vec<u8>, String> {
    #[cfg(target_os = "macos")]
    {
        encode_aac_macos(samples, channels, rate, bitrate)
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = (samples, channels, rate, bitrate);
        Err("AAC export is available on a Mac.".to_owned())
    }
}

#[cfg(target_os = "macos")]
fn encode_aac_macos(
    samples: &[f32],
    channels: u16,
    rate: u32,
    bitrate: u32,
) -> Result<Vec<u8>, String> {
    let channels = channels.max(1);
    let path = std::env::temp_dir().join(format!(
        "present-{}-{}.m4a",
        std::process::id(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|duration| duration.as_nanos())
            .unwrap_or(0)
    ));
    let written = aac_write(&path, samples, channels, rate, bitrate);
    let bytes = written.and_then(|_| {
        std::fs::read(&path).map_err(|error| {
            tracing::warn!(%error, "could not read the AAC file back");
            "This recording could not be saved as AAC.".to_owned()
        })
    });
    let _ = std::fs::remove_file(&path);
    bytes
}

#[cfg(target_os = "macos")]
fn aac_write(
    path: &Path,
    samples: &[f32],
    channels: u16,
    rate: u32,
    bitrate: u32,
) -> Result<(), String> {
    use std::os::unix::ffi::OsStrExt;

    let failed = || "This recording could not be saved as AAC.".to_owned();
    let bytes = path.as_os_str().as_bytes();
    // AudioToolbox takes a filesystem URL and a client buffer that stays
    // alive for each write. The URL comes back with one retain, which is
    // released once the file has been created from it. Each status is checked
    // before the next call uses the pointer it returned.
    let url = unsafe {
        CFURLCreateFromFileSystemRepresentation(
            std::ptr::null(),
            bytes.as_ptr(),
            bytes.len() as isize,
            0,
        )
    };
    if url.is_null() {
        return Err(failed());
    }
    let output = AudioStreamBasicDescription {
        sample_rate: f64::from(rate),
        format_id: AUDIO_FORMAT_MPEG4_AAC,
        format_flags: 0,
        bytes_per_packet: 0,
        frames_per_packet: 1024,
        bytes_per_frame: 0,
        channels_per_frame: u32::from(channels),
        bits_per_channel: 0,
        reserved: 0,
    };
    let mut file = std::ptr::null_mut();
    let created = unsafe {
        ExtAudioFileCreateWithURL(url, AUDIO_FILE_M4A, &output, std::ptr::null(), 1, &mut file)
    };
    unsafe { CFRelease(url) };
    if created != 0 || file.is_null() {
        tracing::warn!(status = created, "AAC file was not created");
        return Err(failed());
    }
    let file = AacFile(file);
    let client = AudioStreamBasicDescription {
        sample_rate: f64::from(rate),
        format_id: AUDIO_FORMAT_LINEAR_PCM,
        format_flags: FORMAT_FLAG_IS_FLOAT | FORMAT_FLAG_IS_PACKED,
        bytes_per_packet: u32::from(channels) * 4,
        frames_per_packet: 1,
        bytes_per_frame: u32::from(channels) * 4,
        channels_per_frame: u32::from(channels),
        bits_per_channel: 32,
        reserved: 0,
    };
    let set = unsafe {
        ExtAudioFileSetProperty(
            file.0,
            EXT_CLIENT_DATA_FORMAT,
            std::mem::size_of::<AudioStreamBasicDescription>() as u32,
            &client as *const AudioStreamBasicDescription as *const std::ffi::c_void,
        )
    };
    if set != 0 {
        tracing::warn!(status = set, "AAC client format was rejected");
        return Err(failed());
    }
    let mut converter: *mut std::ffi::c_void = std::ptr::null_mut();
    let mut size = std::mem::size_of::<*mut std::ffi::c_void>() as u32;
    let got = unsafe {
        ExtAudioFileGetProperty(
            file.0,
            EXT_AUDIO_CONVERTER,
            &mut size,
            &mut converter as *mut *mut std::ffi::c_void as *mut std::ffi::c_void,
        )
    };
    if got == 0 && !converter.is_null() {
        let status = unsafe {
            AudioConverterSetProperty(
                converter,
                CONVERTER_ENCODE_BITRATE,
                std::mem::size_of::<u32>() as u32,
                &bitrate as *const u32 as *const std::ffi::c_void,
            )
        };
        if status != 0 {
            tracing::warn!(status, bitrate, "AAC bit rate was not applied");
        }
    }
    let frame_channels = usize::from(channels);
    let frames = samples.len() / frame_channels;
    let mut offset = 0;
    while offset < frames {
        let count = (frames - offset).min(4096);
        let list = AudioBufferList {
            number_buffers: 1,
            buffers: [AudioBuffer {
                number_channels: u32::from(channels),
                data_byte_size: (count * frame_channels * 4) as u32,
                data: samples[offset * frame_channels..].as_ptr() as *mut u8,
            }],
        };
        let status = unsafe { ExtAudioFileWrite(file.0, count as u32, &list) };
        if status != 0 {
            tracing::warn!(status, "AAC write failed");
            return Err(failed());
        }
        offset += count;
    }
    drop(file);
    Ok(())
}

#[cfg(target_os = "macos")]
struct AacFile(*mut std::ffi::c_void);

#[cfg(target_os = "macos")]
impl Drop for AacFile {
    fn drop(&mut self) {
        if !self.0.is_null() {
            unsafe { ExtAudioFileDispose(self.0) };
            self.0 = std::ptr::null_mut();
        }
    }
}

#[cfg(target_os = "macos")]
const AUDIO_FORMAT_LINEAR_PCM: u32 = 0x6c70_636d;
#[cfg(target_os = "macos")]
const AUDIO_FORMAT_MPEG4_AAC: u32 = 0x6161_6320;
#[cfg(target_os = "macos")]
const AUDIO_FILE_M4A: u32 = 0x6d34_6166;
#[cfg(target_os = "macos")]
const FORMAT_FLAG_IS_FLOAT: u32 = 1;
#[cfg(target_os = "macos")]
const FORMAT_FLAG_IS_PACKED: u32 = 8;
#[cfg(target_os = "macos")]
const EXT_CLIENT_DATA_FORMAT: u32 = 0x6366_6d74;
#[cfg(target_os = "macos")]
const EXT_AUDIO_CONVERTER: u32 = 0x6163_6e76;
#[cfg(target_os = "macos")]
const CONVERTER_ENCODE_BITRATE: u32 = 0x6272_6174;

#[cfg(target_os = "macos")]
#[repr(C)]
struct AudioStreamBasicDescription {
    sample_rate: f64,
    format_id: u32,
    format_flags: u32,
    bytes_per_packet: u32,
    frames_per_packet: u32,
    bytes_per_frame: u32,
    channels_per_frame: u32,
    bits_per_channel: u32,
    reserved: u32,
}

#[cfg(target_os = "macos")]
#[repr(C)]
struct AudioBuffer {
    number_channels: u32,
    data_byte_size: u32,
    data: *mut u8,
}

#[cfg(target_os = "macos")]
#[repr(C)]
struct AudioBufferList {
    number_buffers: u32,
    buffers: [AudioBuffer; 1],
}

#[cfg(target_os = "macos")]
#[link(name = "AudioToolbox", kind = "framework")]
#[link(name = "CoreFoundation", kind = "framework")]
extern "C" {
    fn CFURLCreateFromFileSystemRepresentation(
        allocator: *const std::ffi::c_void,
        buffer: *const u8,
        buf_len: isize,
        is_directory: u8,
    ) -> *mut std::ffi::c_void;
    fn CFRelease(item: *const std::ffi::c_void);
    fn ExtAudioFileCreateWithURL(
        url: *const std::ffi::c_void,
        file_type: u32,
        stream: *const AudioStreamBasicDescription,
        layout: *const std::ffi::c_void,
        flags: u32,
        file: *mut *mut std::ffi::c_void,
    ) -> i32;
    fn ExtAudioFileSetProperty(
        file: *mut std::ffi::c_void,
        property: u32,
        size: u32,
        data: *const std::ffi::c_void,
    ) -> i32;
    fn ExtAudioFileGetProperty(
        file: *mut std::ffi::c_void,
        property: u32,
        size: *mut u32,
        data: *mut std::ffi::c_void,
    ) -> i32;
    fn ExtAudioFileWrite(
        file: *mut std::ffi::c_void,
        frames: u32,
        data: *const AudioBufferList,
    ) -> i32;
    fn ExtAudioFileDispose(file: *mut std::ffi::c_void) -> i32;
    fn AudioConverterSetProperty(
        converter: *mut std::ffi::c_void,
        property: u32,
        size: u32,
        data: *const std::ffi::c_void,
    ) -> i32;
}

#[cfg(test)]
mod tests {
    use super::*;

    fn take(samples: Vec<f32>, channels: u16, rate: u32) -> Track {
        Track {
            id: 1,
            name: "Take".into(),
            samples,
            channels,
            rate,
        }
    }

    #[test]
    fn a_quiet_mix_is_not_made_louder() {
        let mixed = mix(&[vec![0.25], vec![0.0]]);
        assert!((mixed[0] - 0.25).abs() < 1e-6);
    }

    #[test]
    fn stacked_takes_are_pulled_back_under_full_scale() {
        let mixed = mix(&[vec![1.0, 0.0], vec![1.0]]);
        assert_eq!(mixed.len(), 2, "the longer take sets the length");
        assert!((mixed[0] - 0.98).abs() < 1e-5);
        assert!((mixed[1] - 0.0).abs() < 1e-5);
    }

    #[test]
    fn a_second_at_48_khz_becomes_a_second_at_22_khz_mono() {
        let samples: Vec<f32> = (0..48_000)
            .map(|index| (index as f32 / 100.0).sin())
            .collect();
        let stereo: Vec<f32> = samples
            .iter()
            .flat_map(|sample| [*sample, *sample])
            .collect();
        let track = take(stereo, 2, 48_000);
        let rendered = render(&track.samples, track.channels, track.rate, 1, 22_050);
        assert!(
            (rendered.len() as i64 - 22_050).abs() < 2,
            "{} samples",
            rendered.len()
        );
        assert!(rendered
            .iter()
            .all(|sample| sample.is_finite() && sample.abs() <= 1.0));
    }

    #[test]
    fn wav_is_16_bit_mono_with_the_samples_it_was_given() {
        let bytes = encode_wav(&[1.0, -1.0], 1, 22_050, 16).unwrap();
        assert_eq!(&bytes[0..4], b"RIFF");
        assert_eq!(&bytes[8..12], b"WAVE");
        assert_eq!(u16::from_le_bytes([bytes[22], bytes[23]]), 1, "channels");
        assert_eq!(
            u32::from_le_bytes(bytes[24..28].try_into().unwrap()),
            22_050
        );
        assert_eq!(u16::from_le_bytes([bytes[34], bytes[35]]), 16, "bits");
        assert_eq!(&bytes[36..40], b"data");
        assert_eq!(bytes.len(), 44 + 4);
        assert_eq!(i16::from_le_bytes([bytes[44], bytes[45]]), 32767);
        assert_eq!(i16::from_le_bytes([bytes[46], bytes[47]]), -32767);
    }

    #[test]
    fn wav_24_bit_stereo_is_three_bytes_a_sample() {
        let bytes = encode_wav(&[0.0, 0.0, 1.0, -1.0], 2, 48_000, 24).unwrap();
        assert_eq!(u16::from_le_bytes([bytes[34], bytes[35]]), 24);
        assert_eq!(bytes.len(), 44 + 12);
        assert_eq!(&bytes[50..53], &8_388_607i32.to_le_bytes()[..3]);
    }

    #[test]
    fn every_platform_can_write_a_wave_and_aac_is_a_mac() {
        let formats = export_formats();
        assert!(formats.contains(&"mp3"));
        assert!(formats.contains(&"aiff"));
        assert!(formats.contains(&"wave"));
        #[cfg(target_os = "macos")]
        assert!(formats.contains(&"aac"));
        #[cfg(not(target_os = "macos"))]
        assert!(!formats.contains(&"aac"));
    }

    #[test]
    fn a_name_cannot_become_a_path() {
        assert_eq!(file_stem("  Verse / 1? "), "Verse 1");
        assert_eq!(file_stem("..."), "Recording");
        assert_eq!(file_stem("CON"), "CON recording");
    }

    #[test]
    fn pausing_appends_and_recording_again_replaces() {
        let mut track = take(vec![0.2, 0.2], 1, 48_000);
        store(&mut track, &[], 1, 48_000, true);
        assert_eq!(
            track.samples,
            vec![0.2, 0.2],
            "an empty pause leaves the take"
        );
        store(&mut track, &[0.5], 1, 48_000, true);
        assert_eq!(track.samples, vec![0.2, 0.2, 0.5]);
        store(&mut track, &[0.1], 1, 48_000, false);
        assert_eq!(track.samples, vec![0.1]);
    }

    #[test]
    fn aiff_is_big_endian_with_the_samples_it_was_given() {
        let bytes = encode_aiff(&[1.0, -1.0], 1, 44_100, 16).unwrap();
        assert_eq!(&bytes[0..4], b"FORM");
        assert_eq!(&bytes[8..12], b"AIFF");
        assert_eq!(&bytes[12..16], b"COMM");
        assert_eq!(u16::from_be_bytes([bytes[20], bytes[21]]), 1, "channels");
        assert_eq!(u16::from_be_bytes([bytes[26], bytes[27]]), 16, "bits");
        assert_eq!(&bytes[38..42], b"SSND");
        assert_eq!(i16::from_be_bytes([bytes[54], bytes[55]]), 32_767);
        assert_eq!(i16::from_be_bytes([bytes[56], bytes[57]]), -32_767);
    }

    #[test]
    fn mp3_of_a_tone_starts_with_a_frame() {
        let frames = 1152 * 4;
        let samples: Vec<f32> = (0..frames)
            .flat_map(|index| {
                let sample = (index as f32 * 0.08).sin() * 0.4;
                [sample, sample]
            })
            .collect();
        let bytes = encode_mp3(&samples, 2, 44_100, 128).unwrap();
        assert!(bytes.len() > 100, "{}", bytes.len());
        assert!(
            bytes
                .windows(2)
                .any(|pair| pair[0] == 0xff && pair[1] & 0xe0 == 0xe0),
            "no MP3 frame"
        );
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn aac_of_a_tone_is_an_m4a() {
        let frames = 2048;
        let samples: Vec<f32> = (0..frames)
            .flat_map(|index| {
                let sample = (index as f32 * 0.08).sin() * 0.4;
                [sample, sample]
            })
            .collect();
        let bytes = encode_aac(&samples, 2, 44_100, 128_000).unwrap();
        assert!(bytes.len() > 32, "{}", bytes.len());
        assert!(bytes.windows(4).any(|mark| mark == b"ftyp"), "not an m4a");
    }

    #[test]
    fn recording_again_replaces_the_take_only_after_it_is_read() {
        let recorder = Recorder::new();
        {
            let mut session = lock(&recorder.inner);
            session.tracks[0].samples = vec![0.2, 0.2];
            session.tracks[0].channels = 1;
            session.tracks[0].rate = 48_000;
        }
        // commit with nothing recording leaves the take.
        recorder.commit();
        assert_eq!(lock(&recorder.inner).tracks[0].samples, vec![0.2, 0.2]);
    }
}
