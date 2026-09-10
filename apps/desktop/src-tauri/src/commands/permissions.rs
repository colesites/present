//! Microphone and camera commands.
//!
//! Replaces `request-microphone-access` and `request-camera-access`
//! (`permissions.ipc.ts`). `get_*_access_status` has no Electron counterpart —
//! the renderer could only ever ask by prompting — and exists because a status
//! read is free while a prompt is a modal interruption.

use crate::errors::AppResult;
use crate::services::permissions::{self, MediaAccessResult, MediaKind};

/// Prompts only when macOS has not already settled the answer.
#[tauri::command]
pub async fn request_microphone_access() -> AppResult<MediaAccessResult> {
    Ok(permissions::request(MediaKind::Microphone))
}

#[tauri::command]
pub async fn request_camera_access() -> AppResult<MediaAccessResult> {
    Ok(permissions::request(MediaKind::Camera))
}

#[tauri::command]
pub async fn get_microphone_access_status() -> AppResult<MediaAccessResult> {
    Ok(permissions::status(MediaKind::Microphone))
}

#[tauri::command]
pub async fn get_camera_access_status() -> AppResult<MediaAccessResult> {
    Ok(permissions::status(MediaKind::Camera))
}
