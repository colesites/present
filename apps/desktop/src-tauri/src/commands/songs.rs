//! Importing songs from other presentation software.

use serde::Serialize;
use tauri::{AppHandle, WebviewWindow};

use crate::errors::{AppError, AppResult};
use crate::services::dialog;
use crate::services::openlyrics::{self, OpenLyricsSong};

/// Larger than any song; a file past it is not one.
const MAX_SONG_BYTES: u64 = 5 * 1024 * 1024;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportedSongFile {
    pub file_name: String,
    pub song: Option<OpenLyricsSong>,
    pub error: Option<String>,
}

fn read_song(path: &std::path::Path) -> AppResult<OpenLyricsSong> {
    if std::fs::metadata(path)?.len() > MAX_SONG_BYTES {
        return Err(AppError::Invalid(
            "The file is too large to be a song.".to_owned(),
        ));
    }
    let bytes = std::fs::read(path)?;
    let text = String::from_utf8(bytes)
        .map_err(|_| AppError::Invalid("The file is not UTF-8 text.".to_owned()))?;
    openlyrics::parse(text.trim_start_matches('\u{feff}'))
}

/// Pick OpenLyrics files and read each. `None` when cancelled; a file that
/// cannot be read is reported with its error rather than failing the rest.
#[tauri::command]
pub async fn import_openlyrics_songs(
    app: AppHandle,
    window: WebviewWindow,
) -> AppResult<Option<Vec<ImportedSongFile>>> {
    let Some(paths) = dialog::select_openlyrics_files(&app, Some(&window))? else {
        return Ok(None);
    };
    let results = tauri::async_runtime::spawn_blocking(move || {
        paths
            .iter()
            .map(|path| {
                let file_name = path
                    .file_name()
                    .map(|name| name.to_string_lossy().into_owned())
                    .unwrap_or_default();
                match read_song(path) {
                    Ok(song) => ImportedSongFile {
                        file_name,
                        song: Some(song),
                        error: None,
                    },
                    Err(error) => ImportedSongFile {
                        file_name,
                        song: None,
                        error: Some(error.to_string()),
                    },
                }
            })
            .collect()
    })
    .await
    .map_err(|error| AppError::Invalid(error.to_string()))?;
    Ok(Some(results))
}
