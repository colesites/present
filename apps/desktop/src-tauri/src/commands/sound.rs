//! The sound engine's command surface, and its line back into the transport.
//!
//! `services::sound` reports where the sound is through [`AppTransport`], into
//! the same transport and the same `playback:changed` event the `<video>`
//! element's reports used to reach, so everything that followed the element
//! follows the sound unchanged.

use std::path::PathBuf;

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, State};

use crate::errors::AppResult;
use crate::services::audio::{AudioGraph, AudioSource, AudioSurface};
use crate::services::media_protocol;
use crate::services::sound::{
    self, AudioDevices, BackingTrackCommand, BackingTrackState, Level, Routing, SoundEngine,
    Transport,
};
use crate::state::{OutputState, PlaybackState};

use super::playback::broadcast_playback;

/// Emitted when the backing track starts, stops, moves on or ends.
pub const BACKING_TRACK_EVENT: &str = "backing-track:changed";

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct BackingTrackEvent {
    #[serde(flatten)]
    state: BackingTrackState,
    /// It played to its end: the Audio tab moves on to the next.
    ended: bool,
}

pub struct AppTransport {
    pub app: AppHandle,
}

/// The backing track as it was last told, for an Audio tab opened while it
/// plays.
#[derive(Default)]
pub struct BackingTrackNow(std::sync::Mutex<BackingTrackState>);

fn now_ms() -> f64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_or(0.0, |elapsed| elapsed.as_secs_f64() * 1000.0)
}

impl Transport for AppTransport {
    fn report_position(&self, seconds: f64) {
        let state = self.app.state::<PlaybackState>();
        let changed = state.update(|playback| playback.report_position(seconds, Some(now_ms())));
        broadcast_playback(&self.app, changed);
    }

    fn set_duration(&self, seconds: Option<f64>) {
        let state = self.app.state::<PlaybackState>();
        let changed = state.update(|playback| playback.set_duration(seconds));
        broadcast_playback(&self.app, changed);
    }

    fn ended(&self, looping: bool) {
        let state = self.app.state::<PlaybackState>();
        let changed = state.update(|playback| playback.ended(looping));
        broadcast_playback(&self.app, changed);
    }

    fn looping(&self) -> bool {
        self.app.state::<OutputState>().scene().video_settings.loop_
    }

    fn backing_track(&self, state: &BackingTrackState, ended: bool) {
        if let Some(now) = self.app.try_state::<BackingTrackNow>() {
            *now.0
                .lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner()) = state.clone();
        }
        if let Err(error) = self.app.emit(
            BACKING_TRACK_EVENT,
            BackingTrackEvent {
                state: state.clone(),
                ended,
            },
        ) {
            tracing::warn!(%error, "could not tell the Audio tab about the backing track");
        }
    }
}

/// What the graph asks of the sound: the device, and each source's level.
pub fn routing(graph: &AudioGraph) -> Routing {
    let level = |source| {
        let routing = graph.routing(source, AudioSurface::Operator);
        Level {
            muted: routing.muted || !routing.audible,
            volume: routing.volume,
        }
    };
    Routing {
        video: level(AudioSource::PresentationVideo),
        backing_track: level(AudioSource::BackingTrack),
        device_id: graph.sink.device_id.clone(),
        device_label: Some(graph.sink.device_label.trim().to_owned())
            .filter(|label| !label.is_empty()),
    }
}

/// The file a media item's URL names, if it is one on this computer.
pub fn source_path(url: &str) -> Option<PathBuf> {
    let url = url.trim();
    if url.starts_with('/') {
        return Some(PathBuf::from(url));
    }
    let scheme = url.split_once("://")?.0.to_ascii_lowercase();
    let local = scheme == "local-media"
        || scheme == "file"
        || url
            .to_ascii_lowercase()
            .starts_with("http://local-media.localhost/");
    local.then(|| media_protocol::path_from_uri(url)).flatten()
}

#[tauri::command]
pub async fn list_audio_devices() -> AppResult<AudioDevices> {
    // Core Audio answers quickly, but off the async runtime's threads all the
    // same: a device being plugged in can hold it up.
    Ok(tauri::async_runtime::spawn_blocking(sound::devices)
        .await
        .unwrap_or_default())
}

#[tauri::command]
pub async fn play_test_sound(engine: State<'_, SoundEngine>) -> AppResult<()> {
    engine.play_test_tone();
    Ok(())
}

/// The microphone being listened to: one at a time, by session, so a stop
/// that arrives late does not end the session that replaced it.
#[derive(Default)]
pub struct MicrophoneState(std::sync::Mutex<Option<(u32, sound::input::Microphone)>>);

static NEXT_MICROPHONE_SESSION: std::sync::atomic::AtomicU32 = std::sync::atomic::AtomicU32::new(1);

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MicrophoneStarted {
    pub session: u32,
    /// What `on_audio` carries: 16-bit little-endian mono at this rate.
    pub sample_rate: u32,
    /// The device, as the system names it.
    pub label: String,
}

/// Listen to `device_id` (the system's id, from `list_audio_devices`), or the
/// default microphone. `on_audio` receives the samples as raw bytes, about
/// twenty times a second, until `stop_microphone`.
#[tauri::command]
pub async fn start_microphone(
    state: State<'_, MicrophoneState>,
    device_id: Option<String>,
    on_audio: tauri::ipc::Channel,
) -> AppResult<MicrophoneStarted> {
    let device_id = device_id.filter(|id| !id.trim().is_empty());
    let microphone = tauri::async_runtime::spawn_blocking(move || {
        // Asked here, before the device is opened: the first time, this is
        // the system's prompt. Opened without it, a refused microphone gives
        // silence rather than an error, and nothing would say why.
        use crate::services::permissions::{self, MediaKind};
        let access = permissions::request(MediaKind::Microphone);
        if !access.granted {
            return Err(match access.status.as_str() {
                "restricted" => "This Mac does not allow apps to use the microphone (Screen Time or a device profile).".to_owned(),
                _ => "Present is not allowed to use the microphone. Turn it on in System Settings > Privacy & Security > Microphone, then try again.".to_owned(),
            });
        }
        sound::input::Microphone::open(device_id.as_deref(), move |bytes| {
            let _ = on_audio.send(tauri::ipc::InvokeResponseBody::Raw(bytes));
        })
    })
    .await
    .map_err(|error| crate::errors::AppError::Invalid(error.to_string()))?
    .map_err(crate::errors::AppError::Invalid)?;
    let session = NEXT_MICROPHONE_SESSION.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
    let label = microphone.label.clone();
    let replaced = state
        .0
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
        .replace((session, microphone));
    // Closed off the lock: stopping waits for its thread.
    drop(replaced);
    Ok(MicrophoneStarted {
        session,
        sample_rate: sound::input::RATE,
        label,
    })
}

#[tauri::command]
pub async fn stop_microphone(state: State<'_, MicrophoneState>, session: u32) -> AppResult<()> {
    let stopped = {
        let mut current = state
            .0
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        if current.as_ref().is_some_and(|(id, _)| *id == session) {
            current.take()
        } else {
            None
        }
    };
    drop(stopped);
    Ok(())
}

#[tauri::command]
pub async fn get_backing_track(now: State<'_, BackingTrackNow>) -> AppResult<BackingTrackState> {
    Ok(now
        .0
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
        .clone())
}

/// Play a backing track: from its start, or from where it was paused.
#[tauri::command]
pub async fn backing_track_play(engine: State<'_, SoundEngine>, path: String) -> AppResult<()> {
    let path = source_path(&path).ok_or_else(|| {
        crate::errors::AppError::Invalid(format!("not a file on this computer: {path}"))
    })?;
    engine.backing_track(BackingTrackCommand::Play(path));
    Ok(())
}

#[tauri::command]
pub async fn backing_track_pause(engine: State<'_, SoundEngine>) -> AppResult<()> {
    engine.backing_track(BackingTrackCommand::Pause);
    Ok(())
}

#[tauri::command]
pub async fn backing_track_seek(engine: State<'_, SoundEngine>, seconds: f64) -> AppResult<()> {
    engine.backing_track(BackingTrackCommand::Seek(seconds));
    Ok(())
}

#[tauri::command]
pub async fn backing_track_stop(engine: State<'_, SoundEngine>) -> AppResult<()> {
    engine.backing_track(BackingTrackCommand::Stop);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_files_on_this_computer_are_played() {
        assert_eq!(
            source_path("local-media://media/Users/me/Videos/Intro%20loop.mp4"),
            Some(PathBuf::from("/Users/me/Videos/Intro loop.mp4"))
        );
        assert_eq!(
            source_path("/Users/me/clip.mov"),
            Some(PathBuf::from("/Users/me/clip.mov"))
        );
        assert_eq!(source_path("https://example.com/clip.mp4"), None);
        assert_eq!(source_path("youtube:abc"), None);
    }
}
