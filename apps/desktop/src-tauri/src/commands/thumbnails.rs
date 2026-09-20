//! Media panel thumbnails. Tauri only: Electron drew a paused `<video>`.

use std::path::PathBuf;
use std::sync::Arc;

use tauri::{AppHandle, Manager, State};
use tokio::sync::Semaphore;

use crate::errors::{AppError, AppResult};
use crate::services::thumbnails;
use crate::state::FileState;

/// Two decodes at a time. The panel asks for every visible video at once, and
/// the decoder shares the hardware with whatever is playing live.
pub struct ThumbnailQueue(Arc<Semaphore>);

impl Default for ThumbnailQueue {
    fn default() -> Self {
        Self(Arc::new(Semaphore::new(2)))
    }
}

/// A JPEG of the video at `path`, which must be inside a media folder.
#[tauri::command]
pub async fn get_media_thumbnail(
    app: AppHandle,
    files: State<'_, FileState>,
    queue: State<'_, ThumbnailQueue>,
    path: String,
) -> AppResult<tauri::ipc::Response> {
    let path = files.resolve_existing(&path)?;
    let cache_dir: PathBuf = app
        .path()
        .app_cache_dir()
        .map_err(|error| AppError::Invalid(error.to_string()))?
        .join(thumbnails::CACHE_FOLDER);
    // A picture this video already has costs a file read, so it does not wait
    // in the queue below — which is there to stop forty-two video decoders
    // opening at once, not to ration a few kilobytes off the disk. Queuing
    // cache hits made a panel of videos that had all been seen before arrive
    // two at a time, every launch.
    let for_cache = path.clone();
    let cache_for_read = cache_dir.clone();
    if let Ok(Some(bytes)) =
        tauri::async_runtime::spawn_blocking(move || thumbnails::cached(&for_cache, &cache_for_read))
            .await
    {
        return Ok(tauri::ipc::Response::new(bytes));
    }

    let _permit = Arc::clone(&queue.0)
        .acquire_owned()
        .await
        .map_err(|error| AppError::Invalid(error.to_string()))?;
    let bytes =
        tauri::async_runtime::spawn_blocking(move || thumbnails::thumbnail(&path, &cache_dir))
            .await
            .map_err(|error| AppError::Invalid(error.to_string()))??;
    Ok(tauri::ipc::Response::new(bytes))
}
