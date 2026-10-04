//! The webview's video players (`services::media_frames`).

use std::time::Instant;

use serde::Deserialize;
use tauri::State;

use crate::errors::AppResult;
use crate::services::media_frames::Clock;
use crate::state::MediaFramesState;

/// How a player keeps time, as a panel says it.
#[derive(Debug, Clone, Deserialize)]
#[serde(tag = "mode", rename_all = "camelCase")]
pub enum ClockArg {
    /// With the scene, for the video on screen.
    Scene,
    /// The operator's own preview.
    #[serde(rename_all = "camelCase")]
    Local {
        playing: bool,
        position_seconds: f64,
        #[serde(default)]
        r#loop: bool,
        #[serde(default = "normal_rate")]
        rate: f64,
    },
    /// Round and round from the start: a prop.
    Loop,
}

fn normal_rate() -> f64 {
    1.0
}

impl From<ClockArg> for Clock {
    fn from(clock: ClockArg) -> Self {
        match clock {
            ClockArg::Scene => Self::Scene,
            ClockArg::Local {
                playing,
                position_seconds,
                r#loop,
                rate,
            } => Self::Local {
                playing,
                position: if position_seconds.is_finite() {
                    position_seconds.max(0.0)
                } else {
                    0.0
                },
                at: Instant::now(),
                looping: r#loop,
                rate: if rate.is_finite() {
                    rate.clamp(0.25, 4.0)
                } else {
                    1.0
                },
            },
            ClockArg::Loop => Self::Loop,
        }
    }
}

/// Show `url` in player `id`, its frames at `media-frame://frame/<id>`.
#[tauri::command]
pub async fn set_media_frames(
    state: State<'_, MediaFramesState>,
    id: String,
    url: String,
    clock: ClockArg,
) -> AppResult<()> {
    state.set(&id, url, clock.into());
    Ok(())
}

#[tauri::command]
pub async fn remove_media_frames(state: State<'_, MediaFramesState>, id: String) -> AppResult<()> {
    state.remove(&id);
    Ok(())
}

/// How long a video file is, when its container says.
#[tauri::command]
pub async fn media_duration(url: String) -> AppResult<Option<f64>> {
    Ok(tauri::async_runtime::spawn_blocking(move || {
        let path = super::sound::source_path(&url)?;
        crate::services::video::ffmpeg::init();
        let input = ffmpeg_next::format::input(&path).ok()?;
        let duration = input.duration();
        (duration > 0).then(|| duration as f64 / f64::from(ffmpeg_next::ffi::AV_TIME_BASE))
    })
    .await
    .ok()
    .flatten())
}
