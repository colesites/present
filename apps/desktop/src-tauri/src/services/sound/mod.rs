//! The sound Present plays — the video on screen and the backing track —
//! played by the app itself.
//!
//! Until 0.4.11 the sound came from WebKit: a `<video>` in the operator window
//! decoded the video a second time, beside the FFmpeg decode that draws every
//! screen, on its own clock, and stopped whenever the element went away or
//! WebKit paused it. Two decoders of one file on two clocks drift apart; the
//! sound and the screens no longer matched, and the sound could stop while the
//! screens played on. The backing track was a WebKit `Audio` of its own.
//!
//! Now FFmpeg decodes the sound too (`decoder.rs`), it is played on the
//! system's own audio device (`output.rs`), and **the video's sound is its
//! clock**: the engine reports where the device has got to into the transport,
//! which every screen already follows. A video with no sound is timed by the
//! wall clock instead.
//!
//! The engine follows the transport (`services::playback`) — which video, run
//! or held, and where the operator put it — and the audio graph
//! (`services::audio`) for the device and the levels. It runs on its own
//! thread: decoding and opening devices never wait on a command, and a
//! command never waits on them.

pub mod clock;
pub(crate) mod decoder;
pub mod input;
pub mod output;

use std::collections::VecDeque;
use std::path::{Path, PathBuf};
use std::sync::atomic::Ordering;
use std::sync::mpsc::{self, Receiver, RecvTimeoutError, Sender};
use std::time::{Duration, Instant};

use serde::Serialize;

use crate::services::playback::MediaPlayback;

use decoder::AudioDecoder;
use output::{Output, BACKING_TRACK, VIDEO};

pub use output::{AudioDevice, AudioDevices};

/// How far the sound may be from where the transport says before it is moved
/// there. The engine's own reports keep the two within a few milliseconds, so
/// only an instruction — a seek, a stop, another video — is ever this far.
const SEEK_TOLERANCE: f64 = 0.3;

/// How far the heard position may stray from the published clock before the
/// clock is moved: under a frame, and over the device's callback steps.
const CLOCK_SLACK: f64 = 0.012;

/// How much sound is kept decoded ahead of the device.
const AHEAD_SECONDS: f64 = 0.35;

/// How often the video's position goes into the transport while it runs: as
/// often as the `<video>` element reported it.
const REPORT_EVERY: Duration = Duration::from_millis(100);

/// How often the backing track's place is told to the Audio tab.
const BACKING_REPORT_EVERY: Duration = Duration::from_millis(250);

/// How long the device is fed silence with nothing playing before it is
/// paused, so the computer can sleep. Paused, it starts again in a few
/// milliseconds; opened, the first time in a process, it takes over a second —
/// so it is opened when the engine starts and never closed for being idle.
const IDLE_PAUSE: Duration = Duration::from_secs(5);

/// How often the system's default output is checked, when that is where the
/// sound goes.
const DEFAULT_CHECK_EVERY: Duration = Duration::from_secs(2);

/// The backing track, as the Audio tab shows it.
#[derive(Debug, Clone, PartialEq, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BackingTrackState {
    pub path: Option<String>,
    pub playing: bool,
    pub position_seconds: f64,
    pub duration_seconds: Option<f64>,
}

/// Where the engine tells the rest of the app what the sound is doing.
pub trait Transport: Send + 'static {
    /// Where the video's sound is now.
    fn report_position(&self, seconds: f64);
    /// How long the video is, once its file has been read.
    fn set_duration(&self, seconds: Option<f64>);
    /// The video reached its end.
    fn ended(&self, looping: bool);
    /// Whether a video that ends starts again.
    fn looping(&self) -> bool;
    /// The backing track moved, started, stopped or ended.
    fn backing_track(&self, state: &BackingTrackState, ended: bool);
}

/// One source's level.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Level {
    pub muted: bool,
    /// 0 to 1.
    pub volume: f64,
}

impl Level {
    fn gain(self) -> f32 {
        if self.muted {
            0.0
        } else {
            self.volume.clamp(0.0, 1.0) as f32
        }
    }
}

impl Default for Level {
    fn default() -> Self {
        Self {
            muted: false,
            volume: 1.0,
        }
    }
}

/// What the engine plays on, and how loud.
#[derive(Debug, Clone, PartialEq, Default)]
pub struct Routing {
    pub video: Level,
    pub backing_track: Level,
    /// `cpal`'s id; `None` for the system default.
    pub device_id: Option<String>,
    /// The device's name, for a choice saved before ids were the system's.
    pub device_label: Option<String>,
}

/// What the Audio tab asks of the backing track.
#[derive(Debug, Clone, PartialEq)]
pub enum BackingTrackCommand {
    /// Play `path` — from its start if it is not the track already loaded,
    /// from where it was if it is.
    Play(PathBuf),
    Pause,
    Seek(f64),
    Stop,
}

enum Command {
    Follow {
        playback: MediaPlayback,
        source: Option<(String, Option<PathBuf>)>,
    },
    Routing(Routing),
    BackingTrack(BackingTrackCommand),
    TestTone,
}

/// The handle every command holds.
pub struct SoundEngine {
    commands: Sender<Command>,
}

impl SoundEngine {
    pub fn start(transport: impl Transport, routing: Routing) -> Self {
        let (commands, receiver) = mpsc::channel();
        let spawned = std::thread::Builder::new()
            .name("present-sound".into())
            .spawn(move || Engine::new(transport, routing).run(&receiver));
        if let Err(error) = spawned {
            tracing::error!(%error, "the sound engine could not start");
        }
        Self { commands }
    }

    /// The transport moved. `source` names the file of the video it is on,
    /// when the operator says which.
    pub fn follow(&self, playback: MediaPlayback, source: Option<(String, Option<PathBuf>)>) {
        let _ = self.commands.send(Command::Follow { playback, source });
    }

    pub fn set_routing(&self, routing: Routing) {
        let _ = self.commands.send(Command::Routing(routing));
    }

    pub fn backing_track(&self, command: BackingTrackCommand) {
        let _ = self.commands.send(Command::BackingTrack(command));
    }

    pub fn play_test_tone(&self) {
        let _ = self.commands.send(Command::TestTone);
    }
}

/// One file being heard: the video's sound, or the backing track.
struct Track {
    /// The video's media id, or the backing track's path.
    id: String,
    /// The file.
    path: Option<PathBuf>,
    decoder: Option<AudioDecoder>,
    duration_seconds: Option<f64>,
    /// Where the sound after the last mark begins.
    base_seconds: f64,
    /// Frames written since the last mark.
    written: u64,
    /// Decoded and not yet written.
    pending: Vec<f32>,
    /// The file has no more.
    finished: bool,
    playing: bool,
    /// For a file without sound, timed by the wall clock: when it last
    /// started running.
    running_since: Option<Instant>,
    /// How fast it plays: 1 as recorded.
    rate: f64,
}

impl Track {
    /// `path`'s sound, ready to play on `output`. Without one — no file, no
    /// sound in it, no device — it is timed by the wall clock.
    fn open(id: String, path: Option<&Path>, output: Option<&Output>) -> Self {
        let decoder = match (path, output) {
            (Some(path), Some(output)) => {
                match AudioDecoder::open(path, output.rate, output.voice_channels as u16) {
                    Ok(decoder) => decoder,
                    Err(error) => {
                        tracing::warn!(%error, "the sound could not be read; it plays without");
                        None
                    }
                }
            }
            _ => None,
        };
        Self {
            id,
            path: path.map(Path::to_owned),
            duration_seconds: decoder.as_ref().and_then(AudioDecoder::duration_seconds),
            decoder,
            base_seconds: 0.0,
            written: 0,
            pending: Vec::new(),
            finished: false,
            playing: false,
            running_since: None,
            rate: 1.0,
        }
    }

    /// Find `seconds` in the file and decode the first of the sound from
    /// there, ahead of the moment it is to be heard.
    fn prepare(&mut self, seconds: f64, rate: f64) {
        self.base_seconds = seconds.max(0.0);
        self.rate = rate;
        if let Some(decoder) = &mut self.decoder {
            if let Err(error) = decoder.set_speed(rate) {
                tracing::warn!(%error, rate, "the sound's speed could not be changed");
            }
            if let Err(error) = decoder.seek(self.base_seconds) {
                tracing::warn!(%error, seconds, "the sound could not seek");
            }
            match decoder.next_chunk() {
                Ok(Some(chunk)) => self.pending = chunk.samples,
                Ok(None) => self.finished = true,
                Err(error) => tracing::warn!(%error, "the sound could not be decoded"),
            }
        }
    }

    /// Put a prepared track on `voice`: what it held before is dropped, and
    /// this one's sound follows. False when the device would not take it.
    fn begin(&mut self, output: &mut Output, voice: usize) -> bool {
        self.written = 0;
        self.running_since = None;
        self.decoder.is_none() || output.flush(voice)
    }

    /// Where it is, as heard.
    fn position(&self, output: Option<&Output>, voice: usize) -> f64 {
        if self.decoder.is_none() {
            let running = self
                .running_since
                .map_or(0.0, |since| since.elapsed().as_secs_f64());
            return self.base_seconds + running * self.rate;
        }
        let Some(output) = output else {
            return self.base_seconds;
        };
        let Some(consumed) = output.voice(voice).consumed() else {
            // The device has not reached the new position's mark yet.
            return self.base_seconds;
        };
        let heard = consumed.saturating_sub(output.in_flight_frames());
        // Each frame heard is `rate` frames of the file: the tempo filter
        // made fewer of them, or more.
        self.base_seconds + heard as f64 / f64::from(output.rate) * self.rate
    }

    /// Play at `rate`, from where it is: the sound is found again there at
    /// the new tempo.
    fn set_rate(&mut self, rate: f64, output: Option<&mut Output>, voice: usize) {
        if (self.rate - rate).abs() < 1e-6 {
            return;
        }
        let position = self.position(output.as_deref(), voice);
        self.rate = rate;
        if let Some(decoder) = &mut self.decoder {
            if let Err(error) = decoder.set_speed(rate) {
                tracing::warn!(%error, rate, "the sound's speed could not be changed");
            }
        }
        self.seek(position, output, voice);
    }

    /// Move to `seconds`. False when the device would not take the mark.
    fn seek(&mut self, seconds: f64, output: Option<&mut Output>, voice: usize) -> bool {
        let seconds = seconds.max(0.0);
        self.pending.clear();
        self.finished = false;
        self.written = 0;
        self.base_seconds = seconds;
        self.running_since = self.playing.then(Instant::now);
        let Some(decoder) = &mut self.decoder else {
            return true;
        };
        if let Err(error) = decoder.seek(seconds) {
            tracing::warn!(%error, seconds, "the sound could not seek");
        }
        output.is_none_or(|output| output.flush(voice))
    }

    fn set_playing(&mut self, playing: bool, output: Option<&mut Output>, voice: usize) {
        if self.playing == playing {
            return;
        }
        if self.decoder.is_none() {
            // The wall clock: what ran so far becomes the base.
            if let Some(since) = self.running_since.take() {
                self.base_seconds += since.elapsed().as_secs_f64() * self.rate;
            }
            if playing {
                self.running_since = Some(Instant::now());
            }
        }
        self.playing = playing;
        if let Some(output) = output {
            output
                .voice(voice)
                .playing
                .store(playing, Ordering::Release);
            if playing {
                output.resume();
            }
        }
    }

    /// Keep the device's ring topped up.
    fn fill(&mut self, output: &mut Output, voice: usize) {
        let Some(decoder) = &mut self.decoder else {
            return;
        };
        let ahead = (f64::from(output.rate) * AHEAD_SECONDS) as u64;
        let consumed = output.voice(voice).consumed().unwrap_or(0);
        let writer = &mut output.writers[voice];
        while self.written.saturating_sub(consumed) < ahead {
            if self.pending.is_empty() {
                if self.finished {
                    return;
                }
                match decoder.next_chunk() {
                    Ok(Some(chunk)) => self.pending = chunk.samples,
                    Ok(None) => {
                        self.finished = true;
                        return;
                    }
                    Err(error) => {
                        tracing::warn!(%error, "the sound stopped decoding");
                        self.finished = true;
                        return;
                    }
                }
            }
            let taken = writer.write(&self.pending);
            if taken == 0 {
                return;
            }
            self.pending.drain(..taken);
            self.written += (taken / writer.channels) as u64;
        }
    }

    /// It is running and has reached its end: the last of its sound heard,
    /// or, without sound, its length.
    fn has_ended(&self, output: Option<&Output>, voice: usize) -> bool {
        if !self.playing {
            return false;
        }
        if self.decoder.is_some() {
            return self.finished
                && self.pending.is_empty()
                && output
                    .and_then(|output| output.voice(voice).consumed())
                    .is_some_and(|consumed| consumed >= self.written);
        }
        self.duration_seconds
            .is_some_and(|duration| self.position(output, voice) >= duration)
    }
}

struct Engine<T: Transport> {
    transport: T,
    routing: Routing,
    output: Option<Output>,
    /// The file each video is, as the operator last named it.
    source: Option<(String, Option<PathBuf>)>,
    video: Option<Track>,
    backing: Option<Track>,
    last_report: Instant,
    last_backing_report: Instant,
    idle_since: Option<Instant>,
    last_default_check: Instant,
    default_output: Option<String>,
    /// The live video's clock as last published (`clock.rs`).
    published: Option<clock::HeardClock>,
    /// The operator's changes, each waiting for its moment (`clock::GO_DELAY`).
    scheduled: VecDeque<Scheduled>,
}

/// An operator's change to the live video, made at its moment.
struct Scheduled {
    change: Change,
    /// The live video from then on, as every picture is told ahead of time.
    segment: clock::Segment,
    /// Which video it is from then on.
    media_id: Option<String>,
}

enum Change {
    /// No live video.
    Unload,
    /// Another video, opened and found its place in already, so that at its
    /// moment it only has to start.
    Load { track: Box<Track>, playing: bool },
    /// The same video, moved, started or held.
    Same {
        seek_to: Option<f64>,
        playing: bool,
        rate: f64,
    },
}

impl<T: Transport> Engine<T> {
    fn new(transport: T, routing: Routing) -> Self {
        Self {
            transport,
            routing,
            output: None,
            source: None,
            video: None,
            backing: None,
            last_report: Instant::now(),
            last_backing_report: Instant::now(),
            idle_since: None,
            last_default_check: Instant::now(),
            default_output: None,
            published: None,
            scheduled: VecDeque::new(),
        }
    }

    fn run(mut self, commands: &Receiver<Command>) {
        // Core Audio's first start in a process is slow; done here, it is not
        // done when the operator presses play.
        if self.ensure_output() {
            if let Some(output) = &mut self.output {
                output.pause();
            }
        }
        loop {
            let busy = self.output.as_ref().is_some_and(Output::is_running)
                || self.video.is_some()
                || self.backing.is_some();
            let wait = if busy {
                Duration::from_millis(10)
            } else {
                Duration::from_secs(1)
            };
            match commands.recv_timeout(wait) {
                Ok(command) => self.handle(command),
                Err(RecvTimeoutError::Timeout) => {}
                Err(RecvTimeoutError::Disconnected) => return,
            }
            while let Ok(command) = commands.try_recv() {
                self.handle(command);
            }
            self.tick();
        }
    }

    fn handle(&mut self, command: Command) {
        match command {
            Command::Follow { playback, source } => self.follow(&playback, source),
            Command::Routing(routing) => {
                let device_changed = routing.device_id != self.routing.device_id
                    || (routing.device_id.is_none()
                        && routing.device_label != self.routing.device_label);
                self.routing = routing;
                if device_changed && self.output.is_some() {
                    self.reopen_output();
                }
                self.apply_levels();
            }
            Command::BackingTrack(command) => self.backing_command(command),
            Command::TestTone => {
                if self.ensure_output() {
                    if let Some(output) = &mut self.output {
                        output.resume();
                        output.play_tone();
                    }
                    self.idle_since = None;
                }
            }
        }
    }

    /// The operator changed the live video: make the change at its moment,
    /// [`clock::GO_DELAY`] from now, and tell every picture now so that each
    /// shows it on that same frame.
    fn follow(&mut self, playback: &MediaPlayback, source: Option<(String, Option<PathBuf>)>) {
        if source.is_some() {
            self.source = source;
        }
        let now = Instant::now();
        let at = self
            .scheduled
            .back()
            .map_or(now, |last| last.segment.at + Duration::from_millis(1))
            .max(now + clock::GO_DELAY);

        // What the change starts from: the last change waiting, or what is
        // live now.
        let (before_id, before) = match self.scheduled.back() {
            Some(last) => (last.media_id.clone(), Some(last.segment.clone())),
            None => (
                self.video.as_ref().map(|video| video.id.clone()),
                self.video.as_ref().map(|video| clock::Segment {
                    path: video.path.clone(),
                    seconds: video.position(self.output.as_ref(), VIDEO),
                    playing: video.playing,
                    at: now,
                    rate: video.rate,
                }),
            ),
        };

        let scheduled = match playback.media_id.clone() {
            None if before_id.is_none() => return,
            None => Scheduled {
                change: Change::Unload,
                segment: clock::Segment {
                    path: None,
                    seconds: 0.0,
                    playing: false,
                    at,
                    rate: playback.rate,
                },
                media_id: None,
            },
            Some(media_id) if before_id.as_deref() != Some(media_id.as_str()) => {
                let path = self
                    .source
                    .as_ref()
                    .filter(|(id, _)| *id == media_id)
                    .and_then(|(_, path)| path.clone());
                if path.is_some() {
                    self.ensure_output();
                }
                let seconds = playback.position_seconds.max(0.0);
                let mut track =
                    Track::open(media_id.clone(), path.as_deref(), self.output.as_ref());
                track.prepare(seconds, playback.rate);
                if track.duration_seconds.is_some() {
                    self.transport.set_duration(track.duration_seconds);
                }
                Scheduled {
                    segment: clock::Segment {
                        path,
                        seconds,
                        playing: playback.playing,
                        at,
                        rate: playback.rate,
                    },
                    change: Change::Load {
                        track: Box::new(track),
                        playing: playback.playing,
                    },
                    media_id: Some(media_id),
                }
            }
            Some(media_id) => {
                let Some(before) = before else {
                    return;
                };
                let target = expected_position(playback);
                let seek_to =
                    ((target - before.seconds_at(now)).abs() > SEEK_TOLERANCE).then_some(target);
                let same_rate = (before.rate - playback.rate).abs() < 1e-6;
                if seek_to.is_none() && before.playing == playback.playing && same_rate {
                    return;
                }
                Scheduled {
                    segment: clock::Segment {
                        path: before.path.clone(),
                        seconds: seek_to.unwrap_or_else(|| before.seconds_at(at)),
                        playing: playback.playing,
                        at,
                        rate: playback.rate,
                    },
                    change: Change::Same {
                        seek_to,
                        playing: playback.playing,
                        rate: playback.rate,
                    },
                    media_id: Some(media_id),
                }
            }
        };
        // The device running before the moment, so the sound starts on it.
        if scheduled.segment.playing {
            if let Some(output) = &mut self.output {
                output.resume();
            }
            self.idle_since = None;
        }
        self.scheduled.push_back(scheduled);
        self.publish_scheduled();
    }

    /// Make the changes whose moment has come — ahead of it by as long as the
    /// device takes to sound, so they are heard on the frame they are seen.
    fn apply_due(&mut self, now: Instant) {
        let sounding = self.output.as_ref().map_or(Duration::ZERO, |output| {
            Duration::from_secs_f64(output.in_flight_frames() as f64 / f64::from(output.rate))
        });
        while self
            .scheduled
            .front()
            .is_some_and(|next| next.segment.at <= now + sounding)
        {
            let Some(next) = self.scheduled.pop_front() else {
                break;
            };
            self.apply(next.change);
            // The moment as it was scheduled, not the instant it was made:
            // the sound only starts being heard then.
            self.published = Some(clock::HeardClock {
                now: next.segment,
                scheduled: self
                    .scheduled
                    .iter()
                    .map(|later| later.segment.clone())
                    .collect(),
            });
            clock::publish(self.published.clone());
        }
    }

    fn apply(&mut self, change: Change) {
        match change {
            Change::Unload => self.unload_video(),
            Change::Load { track, playing } => {
                self.unload_video();
                let mut track = *track;
                if let Some(output) = &mut self.output {
                    if !track.begin(output, VIDEO) {
                        self.video = Some(track);
                        self.reopen_output();
                        return;
                    }
                }
                self.video = Some(track);
                self.set_video_playing(playing);
            }
            Change::Same {
                seek_to,
                playing,
                rate,
            } => {
                if let Some(video) = &mut self.video {
                    video.set_rate(rate, self.output.as_mut(), VIDEO);
                }
                if let Some(seconds) = seek_to {
                    self.seek_video(seconds);
                }
                self.set_video_playing(playing);
            }
        }
    }

    fn set_video_playing(&mut self, playing: bool) {
        if let Some(video) = &mut self.video {
            video.set_playing(playing, self.output.as_mut(), VIDEO);
            if playing {
                self.idle_since = None;
                self.last_report = Instant::now();
            }
        }
    }

    /// Tell every picture about the changes waiting, as soon as they are made.
    fn publish_scheduled(&mut self) {
        let now = self
            .published
            .as_ref()
            .map(|published| published.now.clone())
            .or_else(|| {
                self.video.as_ref().map(|video| clock::Segment {
                    path: video.path.clone(),
                    seconds: video.position(self.output.as_ref(), VIDEO),
                    playing: video.playing,
                    at: Instant::now(),
                    rate: video.rate,
                })
            });
        let now = now.unwrap_or(clock::Segment {
            path: None,
            seconds: 0.0,
            playing: false,
            at: Instant::now(),
            rate: 1.0,
        });
        self.published = Some(clock::HeardClock {
            now,
            scheduled: self
                .scheduled
                .iter()
                .map(|change| change.segment.clone())
                .collect(),
        });
        clock::publish(self.published.clone());
    }

    /// Make every change waiting now. For tests, which do not wait.
    #[cfg(test)]
    fn settle(&mut self) {
        while let Some(next) = self.scheduled.pop_front() {
            self.apply(next.change);
        }
    }

    fn load_video(&mut self, media_id: String, at: f64) {
        self.unload_video();
        let path = self
            .source
            .as_ref()
            .filter(|(id, _)| *id == media_id)
            .and_then(|(_, path)| path.clone());
        if path.is_some() {
            self.ensure_output();
        }
        let track = Track::open(media_id, path.as_deref(), self.output.as_ref());
        if track.duration_seconds.is_some() {
            self.transport.set_duration(track.duration_seconds);
        }
        self.video = Some(track);
        self.seek_video(at);
    }

    fn unload_video(&mut self) {
        if self.video.take().is_some() {
            if let Some(output) = &mut self.output {
                output.voice(VIDEO).playing.store(false, Ordering::Release);
                output.flush(VIDEO);
            }
        }
    }

    fn seek_video(&mut self, seconds: f64) {
        let Some(video) = &mut self.video else {
            return;
        };
        if !video.seek(seconds, self.output.as_mut(), VIDEO) {
            self.reopen_output();
        }
    }

    /// Where the video is, as heard. `None` with nothing loaded.
    fn video_position(&self) -> Option<f64> {
        Some(self.video.as_ref()?.position(self.output.as_ref(), VIDEO))
    }

    fn backing_command(&mut self, command: BackingTrackCommand) {
        match command {
            BackingTrackCommand::Play(path) => {
                let id = path.to_string_lossy().into_owned();
                if self.backing.as_ref().is_none_or(|track| track.id != id) {
                    self.unload_backing();
                    self.ensure_output();
                    let mut track = Track::open(id, Some(&path), self.output.as_ref());
                    if !track.seek(0.0, self.output.as_mut(), BACKING_TRACK) {
                        tracing::warn!("the backing track could not start on this output");
                    }
                    self.backing = Some(track);
                }
                if let Some(track) = &mut self.backing {
                    track.set_playing(true, self.output.as_mut(), BACKING_TRACK);
                    self.idle_since = None;
                }
            }
            BackingTrackCommand::Pause => {
                if let Some(track) = &mut self.backing {
                    track.set_playing(false, self.output.as_mut(), BACKING_TRACK);
                }
            }
            BackingTrackCommand::Seek(seconds) => {
                if let Some(track) = &mut self.backing {
                    track.seek(seconds, self.output.as_mut(), BACKING_TRACK);
                }
            }
            BackingTrackCommand::Stop => self.unload_backing(),
        }
        self.tell_backing(false);
    }

    fn unload_backing(&mut self) {
        if self.backing.take().is_some() {
            if let Some(output) = &mut self.output {
                output
                    .voice(BACKING_TRACK)
                    .playing
                    .store(false, Ordering::Release);
                output.flush(BACKING_TRACK);
            }
        }
    }

    fn tell_backing(&mut self, ended: bool) {
        self.last_backing_report = Instant::now();
        let state = match &self.backing {
            Some(track) => BackingTrackState {
                path: Some(track.id.clone()),
                playing: track.playing,
                position_seconds: track.position(self.output.as_ref(), BACKING_TRACK),
                duration_seconds: track.duration_seconds,
            },
            None => BackingTrackState::default(),
        };
        self.transport.backing_track(&state, ended);
    }

    fn tick(&mut self) {
        self.apply_due(Instant::now());
        if self.output.as_ref().is_some_and(Output::is_broken) {
            tracing::info!("the audio output went away; reopening");
            self.reopen_output();
        }
        self.watch_default_output();
        if let Some(output) = &mut self.output {
            if let Some(video) = &mut self.video {
                video.fill(output, VIDEO);
            }
            if let Some(backing) = &mut self.backing {
                backing.fill(output, BACKING_TRACK);
            }
        }
        self.report();
        self.check_ends();
        self.publish_clock();
        self.pause_when_idle();
    }

    /// Tell every picture of the live video where it is (`clock.rs`).
    ///
    /// Smoothed: the device takes sound a callback at a time, so the heard
    /// position moves in steps of a few milliseconds. The published clock is a
    /// line, moved only when the sound has drifted from it by more than
    /// [`CLOCK_SLACK`] — or the instant the video is held, moved or changed.
    fn publish_clock(&mut self) {
        let now = Instant::now();
        let heard = self.video.as_ref().and_then(|video| {
            Some(clock::Segment {
                path: Some(video.path.clone()?),
                seconds: video.position(self.output.as_ref(), VIDEO),
                playing: video.playing,
                at: now,
                rate: video.rate,
            })
        });
        let keep = match (
            self.published.as_ref().map(|published| &published.now),
            &heard,
        ) {
            (Some(published), Some(heard)) => {
                published.path == heard.path
                    && published.playing == heard.playing
                    && (published.rate - heard.rate).abs() < 1e-6
                    && (published.seconds_at(now) - heard.seconds).abs() <= CLOCK_SLACK
            }
            (Some(published), None) => published.path.is_none(),
            (None, None) => true,
            (None, Some(_)) => false,
        };
        if keep {
            return;
        }
        let scheduled: Vec<clock::Segment> = self
            .scheduled
            .iter()
            .map(|change| change.segment.clone())
            .collect();
        self.published = match heard {
            Some(heard) => Some(clock::HeardClock {
                now: heard,
                scheduled,
            }),
            None if scheduled.is_empty() => None,
            None => Some(clock::HeardClock {
                now: clock::Segment {
                    path: None,
                    seconds: 0.0,
                    playing: false,
                    at: now,
                    rate: 1.0,
                },
                scheduled,
            }),
        };
        clock::publish(self.published.clone());
    }

    fn report(&mut self) {
        if self.video.as_ref().is_some_and(|video| video.playing)
            && self.last_report.elapsed() >= REPORT_EVERY
        {
            self.last_report = Instant::now();
            if let Some(position) = self.video_position() {
                self.transport.report_position(position);
            }
        }
        if self.backing.as_ref().is_some_and(|track| track.playing)
            && self.last_backing_report.elapsed() >= BACKING_REPORT_EVERY
        {
            self.tell_backing(false);
        }
    }

    fn check_ends(&mut self) {
        if self
            .video
            .as_ref()
            .is_some_and(|video| video.has_ended(self.output.as_ref(), VIDEO))
        {
            let looping = self.transport.looping();
            if looping {
                self.seek_video(0.0);
            } else if let Some(video) = &mut self.video {
                video.set_playing(false, self.output.as_mut(), VIDEO);
            }
            self.transport.ended(looping);
        }
        if self
            .backing
            .as_ref()
            .is_some_and(|track| track.has_ended(self.output.as_ref(), BACKING_TRACK))
        {
            if let Some(track) = &mut self.backing {
                track.set_playing(false, self.output.as_mut(), BACKING_TRACK);
            }
            // The Audio tab moves on to the next track.
            self.tell_backing(true);
        }
    }

    fn ensure_output(&mut self) -> bool {
        if self.output.is_some() {
            return true;
        }
        match Output::open(
            self.routing.device_id.as_deref(),
            self.routing.device_label.as_deref(),
        ) {
            Ok(output) => {
                self.output = Some(output);
                self.default_output = output::default_output_id();
                self.last_default_check = Instant::now();
                self.apply_levels();
                true
            }
            Err(error) => {
                tracing::warn!(%error, "no audio output");
                false
            }
        }
    }

    /// Close the device and open the one the routing names, carrying on from
    /// where the sound had got to.
    fn reopen_output(&mut self) {
        let video = self.video.as_ref().map(|video| {
            (
                video.id.clone(),
                video.playing,
                video.position(self.output.as_ref(), VIDEO),
                video.rate,
            )
        });
        let backing = self.backing.as_ref().map(|track| {
            (
                track.id.clone(),
                track.playing,
                track.position(self.output.as_ref(), BACKING_TRACK),
            )
        });
        self.video = None;
        self.backing = None;
        self.output = None;
        if !self.ensure_output() {
            return;
        }
        if let Some((media_id, playing, position, rate)) = video {
            self.load_video(media_id, position);
            if let Some(video) = &mut self.video {
                video.set_rate(rate, self.output.as_mut(), VIDEO);
                video.set_playing(playing, self.output.as_mut(), VIDEO);
            }
        }
        if let Some((path, playing, position)) = backing {
            let mut track = Track::open(path.clone(), Some(Path::new(&path)), self.output.as_ref());
            track.seek(position, self.output.as_mut(), BACKING_TRACK);
            track.set_playing(playing, self.output.as_mut(), BACKING_TRACK);
            self.backing = Some(track);
        }
        if let Some(output) = &mut self.output {
            let any = self.video.as_ref().is_some_and(|track| track.playing)
                || self.backing.as_ref().is_some_and(|track| track.playing);
            if !any {
                output.pause();
            }
        }
    }

    fn apply_levels(&self) {
        if let Some(output) = &self.output {
            output.voice(VIDEO).set_gain(self.routing.video.gain());
            output
                .voice(BACKING_TRACK)
                .set_gain(self.routing.backing_track.gain());
        }
    }

    /// With the sound on the system default, follow the default when it moves:
    /// headphones plugged in, a display's speakers chosen in Control Center.
    fn watch_default_output(&mut self) {
        if self.output.is_none() || self.routing.device_id.is_some() {
            return;
        }
        if self.last_default_check.elapsed() < DEFAULT_CHECK_EVERY {
            return;
        }
        self.last_default_check = Instant::now();
        let now = output::default_output_id();
        if now.is_some() && now != self.default_output {
            tracing::info!(device = ?now, "the system's audio output changed; following it");
            self.reopen_output();
        }
    }

    fn pause_when_idle(&mut self) {
        let playing = self.video.as_ref().is_some_and(|track| track.playing)
            || self.backing.as_ref().is_some_and(|track| track.playing);
        let Some(output) = &mut self.output else {
            return;
        };
        if playing || output.is_sounding() || !output.is_running() {
            self.idle_since = None;
            return;
        }
        let since = *self.idle_since.get_or_insert_with(Instant::now);
        if since.elapsed() >= IDLE_PAUSE {
            output.pause();
            self.idle_since = None;
        }
    }
}

/// Where the transport says the video is now: a position it observed moves on
/// with the time since.
fn expected_position(playback: &MediaPlayback) -> f64 {
    let mut position = playback.position_seconds;
    if playback.playing {
        if let Some(sampled_at) = playback.position_sampled_at_ms {
            let now = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map_or(0.0, |elapsed| elapsed.as_secs_f64() * 1000.0);
            position += ((now - sampled_at) / 1000.0).max(0.0);
        }
    }
    position.max(0.0)
}

/// The computer's audio devices.
pub fn devices() -> AudioDevices {
    output::devices()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::{Arc, Mutex};

    #[derive(Clone, Default)]
    struct Recorded(Arc<Mutex<Vec<String>>>);

    impl Transport for Recorded {
        fn report_position(&self, seconds: f64) {
            self.0.lock().unwrap().push(format!("at {seconds:.1}"));
        }
        fn set_duration(&self, seconds: Option<f64>) {
            self.0.lock().unwrap().push(format!("duration {seconds:?}"));
        }
        fn ended(&self, looping: bool) {
            self.0.lock().unwrap().push(format!("ended {looping}"));
        }
        fn looping(&self) -> bool {
            false
        }
        fn backing_track(&self, state: &BackingTrackState, ended: bool) {
            self.0.lock().unwrap().push(format!(
                "backing {} {} {ended}",
                state.path.is_some(),
                state.playing
            ));
        }
    }

    fn playing(media_id: &str, position: f64) -> MediaPlayback {
        MediaPlayback {
            media_id: Some(media_id.into()),
            playing: true,
            position_seconds: position,
            ..MediaPlayback::default()
        }
    }

    #[test]
    fn a_report_moves_on_with_the_time_since_it_was_taken() {
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_secs_f64()
            * 1000.0;
        let mut playback = playing("clip", 10.0);
        playback.position_sampled_at_ms = Some(now - 2000.0);
        assert!((expected_position(&playback) - 12.0).abs() < 0.1);
        playback.playing = false;
        assert_eq!(
            expected_position(&playback),
            10.0,
            "a held video is where it was left"
        );
    }

    #[test]
    fn a_video_without_a_file_is_timed_by_the_clock_and_ends_at_its_length() {
        // No source named: no sound, and no device needed.
        let recorded = Recorded::default();
        let mut engine = Engine::new(recorded.clone(), Routing::default());
        engine.follow(&playing("clip", 0.0), None);
        engine.settle();
        let video = engine.video.as_mut().expect("loaded");
        assert!(video.decoder.is_none());
        video.duration_seconds = Some(0.05);
        std::thread::sleep(Duration::from_millis(80));
        engine.check_ends();
        assert_eq!(
            recorded.0.lock().unwrap().last().map(String::as_str),
            Some("ended false")
        );
        assert!(!engine.video.as_ref().unwrap().playing);
    }

    #[test]
    fn the_operator_moving_the_video_moves_the_clock() {
        let mut engine = Engine::new(Recorded::default(), Routing::default());
        engine.follow(&playing("clip", 0.0), None);
        engine.settle();
        let mut moved = playing("clip", 42.0);
        moved.position_sampled_at_ms = None;
        engine.follow(&moved, None);
        engine.settle();
        assert!((engine.video_position().unwrap() - 42.0).abs() < 0.05);
        // Its own report coming back is not a reason to move.
        let mut report = playing("clip", engine.video_position().unwrap());
        report.position_sampled_at_ms = None;
        engine.follow(&report, None);
        engine.settle();
        assert!((engine.video_position().unwrap() - 42.0).abs() < 0.05);
    }

    #[test]
    fn another_video_starts_where_the_transport_puts_it() {
        let mut engine = Engine::new(Recorded::default(), Routing::default());
        engine.follow(&playing("one", 30.0), None);
        engine.settle();
        engine.follow(&playing("two", 0.0), None);
        engine.settle();
        assert_eq!(engine.video.as_ref().unwrap().id, "two");
        assert!(engine.video_position().unwrap() < 0.05);
        engine.follow(&MediaPlayback::default(), None);
        engine.settle();
        assert!(engine.video.is_none());
    }

    #[test]
    fn the_operators_change_waits_for_its_moment_and_is_told_at_once() {
        let mut engine = Engine::new(Recorded::default(), Routing::default());
        let clicked = Instant::now();
        engine.follow(&playing("clip", 0.0), None);
        assert!(engine.video.is_none(), "not before its moment");
        let told = engine.published.as_ref().expect("told at once");
        assert_eq!(told.scheduled.len(), 1);
        assert!(told.scheduled[0].at >= clicked + clock::GO_DELAY);
        engine.apply_due(clicked + clock::GO_DELAY / 2);
        assert!(engine.video.is_none());
        engine.apply_due(clicked + clock::GO_DELAY + Duration::from_millis(5));
        assert_eq!(
            engine.video.as_ref().map(|video| video.id.as_str()),
            Some("clip")
        );
        assert!(engine.scheduled.is_empty());
    }

    #[test]
    fn a_click_that_changes_nothing_schedules_nothing() {
        let mut engine = Engine::new(Recorded::default(), Routing::default());
        engine.follow(&playing("clip", 0.0), None);
        engine.settle();
        engine.follow(&playing("clip", 0.0), None);
        assert!(engine.scheduled.is_empty());
    }

    #[test]
    fn a_level_is_nothing_when_muted() {
        assert_eq!(
            Level {
                muted: true,
                volume: 0.8
            }
            .gain(),
            0.0
        );
        assert_eq!(
            Level {
                muted: false,
                volume: 1.7
            }
            .gain(),
            1.0
        );
    }

    /// The sound's clock keeps time with the wall's, and the end of the sound
    /// is the end of the video. Silent: the level is nothing.
    #[test]
    #[ignore = "opens this computer's audio output"]
    fn the_sounds_clock_keeps_time_and_ends_with_the_sound() {
        let path = decoder::tests::tone(1.5);
        let recorded = Recorded::default();
        let silent = Level {
            muted: true,
            volume: 0.0,
        };
        let routing = Routing {
            video: silent,
            backing_track: silent,
            ..Routing::default()
        };
        let mut engine = Engine::new(recorded.clone(), routing);
        // As `run` does when the engine starts.
        assert!(engine.ensure_output());
        engine.output.as_mut().unwrap().pause();
        let started = Instant::now();
        engine.follow(
            &playing("tone", 0.0),
            Some(("tone".into(), Some(path.clone()))),
        );
        engine.settle();
        assert!(
            engine.video.as_ref().unwrap().decoder.is_some(),
            "the WAV has sound"
        );
        let mut at_one_second = None;
        while started.elapsed() < Duration::from_millis(2500) {
            engine.tick();
            if at_one_second.is_none() && started.elapsed() >= Duration::from_secs(1) {
                at_one_second = engine.video_position();
            }
            std::thread::sleep(Duration::from_millis(10));
        }
        let at = at_one_second.unwrap();
        // Behind the wall clock by the device's latency, and no more.
        assert!((0.85..=1.01).contains(&at), "heard {at} s after one second");
        let events = recorded.0.lock().unwrap().clone();
        assert!(
            events
                .iter()
                .any(|event| event.starts_with("duration Some(1.5")),
            "{events:?}"
        );
        assert_eq!(
            events.last().map(String::as_str),
            Some("ended false"),
            "{events:?}"
        );
        let _ = std::fs::remove_file(path);
    }

    /// The backing track plays beside the video, on the same device, and the
    /// Audio tab is told when it ends.
    #[test]
    #[ignore = "opens this computer's audio output"]
    fn the_backing_track_plays_to_its_end_and_says_so() {
        let path = decoder::tests::tone(0.6);
        let recorded = Recorded::default();
        let silent = Level {
            muted: true,
            volume: 0.0,
        };
        let routing = Routing {
            video: silent,
            backing_track: silent,
            ..Routing::default()
        };
        let mut engine = Engine::new(recorded.clone(), routing);
        assert!(engine.ensure_output());
        engine.backing_command(BackingTrackCommand::Play(path.clone()));
        let started = Instant::now();
        while started.elapsed() < Duration::from_millis(1500) {
            engine.tick();
            std::thread::sleep(Duration::from_millis(10));
        }
        let events = recorded.0.lock().unwrap().clone();
        assert_eq!(
            events.first().map(String::as_str),
            Some("backing true true false"),
            "{events:?}"
        );
        assert_eq!(
            events.last().map(String::as_str),
            Some("backing true false true"),
            "{events:?}"
        );
        let _ = std::fs::remove_file(path);
    }
}
