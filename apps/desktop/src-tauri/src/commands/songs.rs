//! Importing songs from other presentation software.

use serde::Serialize;
use tauri::{AppHandle, WebviewWindow};

use crate::errors::{AppError, AppResult};
use crate::services::dialog;
use crate::services::openlyrics::{self, OpenLyricsSong};
use crate::services::videopsalm;

/// Larger than any song; a file past it is not one.
const MAX_SONG_BYTES: u64 = 5 * 1024 * 1024;
/// Larger than any songbook; a file past it is not one.
const MAX_SONGBOOK_BYTES: u64 = 50 * 1024 * 1024;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportedSongFile {
    pub file_name: String,
    pub song: Option<OpenLyricsSong>,
    pub error: Option<String>,
}

fn read_text(path: &std::path::Path, most: u64, what: &str) -> AppResult<String> {
    if std::fs::metadata(path)?.len() > most {
        return Err(AppError::Invalid(format!(
            "The file is too large to be {what}."
        )));
    }
    let bytes = std::fs::read(path)?;
    String::from_utf8(bytes)
        .map_err(|_| AppError::Invalid("The file is not UTF-8 text.".to_owned()))
}

fn read_song(path: &std::path::Path) -> AppResult<OpenLyricsSong> {
    let text = read_text(path, MAX_SONG_BYTES, "a song")?;
    openlyrics::parse(text.trim_start_matches('\u{feff}'))
}

fn file_name(path: &std::path::Path) -> String {
    path.file_name()
        .map(|name| name.to_string_lossy().into_owned())
        .unwrap_or_default()
}

/// One VideoPsalm songbook file: its name and songs, or why it could not be read.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportedSongbook {
    pub file_name: String,
    /// The songbook's own name; the file's, without `.json`, when it has none.
    pub name: String,
    pub songs: Vec<OpenLyricsSong>,
    /// Songs with no words, left out.
    pub skipped: usize,
    pub error: Option<String>,
}

/// Pick VideoPsalm songbook files and read each. `None` when cancelled; a file
/// that cannot be read is reported with its error rather than failing the rest.
#[tauri::command]
pub async fn import_videopsalm_songbooks(
    app: AppHandle,
    window: WebviewWindow,
) -> AppResult<Option<Vec<ImportedSongbook>>> {
    let Some(paths) = dialog::select_videopsalm_files(&app, Some(&window))? else {
        return Ok(None);
    };
    let results = tauri::async_runtime::spawn_blocking(move || {
        paths
            .iter()
            .map(|path| {
                let file_name = file_name(path);
                let fallback_name = path
                    .file_stem()
                    .map(|stem| stem.to_string_lossy().into_owned())
                    .unwrap_or_else(|| file_name.clone());
                match read_text(path, MAX_SONGBOOK_BYTES, "a songbook")
                    .and_then(|text| videopsalm::parse(&text))
                {
                    Ok(book) => ImportedSongbook {
                        file_name,
                        name: book.name.unwrap_or(fallback_name),
                        songs: book.songs,
                        skipped: book.skipped,
                        error: None,
                    },
                    Err(error) => ImportedSongbook {
                        file_name,
                        name: fallback_name,
                        songs: Vec::new(),
                        skipped: 0,
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
                let file_name = file_name(path);
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
