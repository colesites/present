//! The recording window.
//!
//! Thin on purpose: the takes live in [`crate::services::recorder`], and the
//! dialogs are the same ones every other export uses. Each command is `async`
//! because a dialog, and opening a microphone, must not block the webview.

use tauri::{AppHandle, State, WebviewWindow};

use crate::errors::{AppError, AppResult};
use crate::services::dialog;
use crate::services::recorder::{Format, Quality, Recorder, Snapshot, TrackView};
use crate::state::FileState;

fn user(error: String) -> AppError {
    AppError::User(error)
}

fn quality(name: &str) -> AppResult<Quality> {
    match name {
        "low" => Ok(Quality::Low),
        "medium" => Ok(Quality::Medium),
        "high" => Ok(Quality::High),
        "highest" => Ok(Quality::Highest),
        _ => Err(AppError::User(
            "Choose a low, medium, high or highest export.".to_owned(),
        )),
    }
}

fn format(name: &str) -> AppResult<Format> {
    match name {
        "aac" => Ok(Format::Aac),
        "mp3" => Ok(Format::Mp3),
        "aiff" => Ok(Format::Aiff),
        "wave" | "wav" => Ok(Format::Wave),
        _ => Err(AppError::User("Choose AAC, MP3, AIFF or WAVE.".to_owned())),
    }
}

#[tauri::command]
pub async fn recorder_snapshot(recorder: State<'_, Recorder>) -> AppResult<Snapshot> {
    Ok(recorder.snapshot())
}

#[tauri::command]
pub async fn recorder_set_input(
    recorder: State<'_, Recorder>,
    device_id: Option<String>,
) -> AppResult<()> {
    let recorder = recorder.inner().clone();
    tauri::async_runtime::spawn_blocking(move || recorder.set_input(device_id))
        .await
        .map_err(|_| AppError::User("The microphone could not be changed.".to_owned()))?
        .map_err(user)
}

#[tauri::command]
pub async fn recorder_add_track(recorder: State<'_, Recorder>) -> AppResult<TrackView> {
    Ok(recorder.add_track())
}

#[tauri::command]
pub async fn recorder_rename_track(
    recorder: State<'_, Recorder>,
    track_id: u64,
    name: String,
) -> AppResult<()> {
    recorder.rename_track(track_id, name).map_err(user)
}

#[tauri::command]
pub async fn recorder_remove_track(recorder: State<'_, Recorder>, track_id: u64) -> AppResult<()> {
    let recorder = recorder.inner().clone();
    tauri::async_runtime::spawn_blocking(move || recorder.remove_track(track_id))
        .await
        .map_err(|_| AppError::User("The track could not be removed.".to_owned()))?
        .map_err(user)
}

#[tauri::command]
pub async fn recorder_start(recorder: State<'_, Recorder>, track_id: u64) -> AppResult<()> {
    let recorder = recorder.inner().clone();
    tauri::async_runtime::spawn_blocking(move || recorder.start(track_id))
        .await
        .map_err(|_| AppError::User("The microphone could not be opened.".to_owned()))?
        .map_err(user)
}

#[tauri::command]
pub async fn recorder_pause(recorder: State<'_, Recorder>) -> AppResult<()> {
    let recorder = recorder.inner().clone();
    tauri::async_runtime::spawn_blocking(move || recorder.pause())
        .await
        .map_err(|_| AppError::User("The recording could not be paused.".to_owned()))?
        .map_err(user)
}

#[tauri::command]
pub async fn recorder_stop(recorder: State<'_, Recorder>) -> AppResult<()> {
    let recorder = recorder.inner().clone();
    tauri::async_runtime::spawn_blocking(move || recorder.stop())
        .await
        .map_err(|_| AppError::User("The recording could not be stopped.".to_owned()))?;
    Ok(())
}

#[tauri::command]
pub async fn recorder_acknowledge_export(recorder: State<'_, Recorder>) -> AppResult<()> {
    recorder.acknowledge_export();
    Ok(())
}

/// `scope` is `mix` (one file of every track), `separate` (one file each) or
/// `track` (the track `track_id` names). An empty list is a cancelled dialog.
#[tauri::command]
pub async fn recorder_export(
    app: AppHandle,
    window: WebviewWindow,
    recorder: State<'_, Recorder>,
    files: State<'_, FileState>,
    quality_name: String,
    format_name: String,
    file_name: String,
    scope: String,
    track_id: Option<u64>,
) -> AppResult<Vec<String>> {
    let quality = quality(&quality_name)?;
    let format = format(&format_name)?;
    let separate = match scope.as_str() {
        "mix" => false,
        "separate" => true,
        "track" => false,
        _ => {
            return Err(AppError::User(
                "Choose one track, each track, or all of them as one.".to_owned(),
            ))
        }
    };
    let track = if scope == "track" {
        Some(track_id.ok_or_else(|| AppError::User("Choose a track to export.".to_owned()))?)
    } else {
        None
    };
    let recorder = recorder.inner().clone();
    let prepared = tauri::async_runtime::spawn_blocking(move || {
        recorder.prepare_export(format, quality, track, separate)
    })
    .await
    .map_err(|_| AppError::User("The recording could not be exported.".to_owned()))?
    .map_err(user)?;
    let extension = format.extension();
    let label = format.label();
    let suggested = {
        let stem = crate::services::recorder::file_stem(if file_name.trim().is_empty() {
            &prepared[0].name
        } else {
            &file_name
        });
        format!("{stem}.{extension}")
    };
    if separate {
        let Some(folder) = dialog::select_recording_folder(&app, &files, Some(&window))? else {
            return Ok(Vec::new());
        };
        let mut written = Vec::with_capacity(prepared.len());
        for take in prepared {
            let path = Recorder::file_in(&folder, &take.name, extension);
            let resolved = files.resolve_new(&path.display().to_string())?;
            let saved = tauri::async_runtime::spawn_blocking(move || {
                Recorder::write_one(&resolved, &take).map(|()| resolved)
            })
            .await
            .map_err(|_| AppError::User("The recording could not be saved.".to_owned()))?
            .map_err(user)?;
            written.push(saved.display().to_string());
        }
        Ok(written)
    } else {
        let Some(path) = dialog::select_recording_file(
            &app,
            &files,
            Some(&window),
            &suggested,
            extension,
            label,
        )?
        else {
            return Ok(Vec::new());
        };
        let resolved = files.resolve_new(&path.display().to_string())?;
        let take = prepared
            .into_iter()
            .next()
            .ok_or_else(|| AppError::User("Record something before exporting.".to_owned()))?;
        let saved = tauri::async_runtime::spawn_blocking(move || {
            Recorder::write_one(&resolved, &take).map(|()| resolved)
        })
        .await
        .map_err(|_| AppError::User("The recording could not be saved.".to_owned()))?
        .map_err(user)?;
        Ok(vec![saved.display().to_string()])
    }
}
