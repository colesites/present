//! The projection settings and what this computer can do for them
//! (`services::projection`).

use serde::Serialize;

use crate::errors::AppResult;
use crate::services::projection::{self, capabilities::Capabilities, ProjectionSettings};

/// The settings, and what is in force now: the resolution and frame rate the
/// automatic adjustment has stepped them to.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectionStatus {
    pub settings: ProjectionSettings,
    pub resolution: projection::Resolution,
    pub frame_rate: projection::FrameRate,
    /// Steps below the operator's settings.
    pub adjusted_by: u8,
}

fn status(settings: ProjectionSettings) -> ProjectionStatus {
    let (resolution, frame_rate) = settings.effective();
    ProjectionStatus {
        settings,
        resolution,
        frame_rate,
        adjusted_by: if settings.auto_adjust {
            projection::adjust::level()
        } else {
            0
        },
    }
}

#[tauri::command]
pub fn get_projection_settings() -> ProjectionStatus {
    status(projection::settings())
}

#[tauri::command]
pub fn set_projection_settings(settings: ProjectionSettings) -> AppResult<ProjectionStatus> {
    Ok(status(projection::set(settings)?))
}

/// GPUs, which codecs they decode, and the displays. Off the main thread: the
/// first ask opens Metal and VideoToolbox.
#[tauri::command]
pub async fn get_projection_capabilities() -> Capabilities {
    tauri::async_runtime::spawn_blocking(projection::capabilities::capabilities)
        .await
        .unwrap_or_else(|_| Capabilities {
            gpus: Vec::new(),
            decoding: Vec::new(),
            displays: Vec::new(),
            layers: false,
        })
}
