//! Native file dialogs.
//!
//! Ports the eight `dialog.show*` calls in `src/main/ipc/file.ipc.ts`. The
//! filters, the multi-select flags and the returned shapes are all unchanged;
//! the React panels calling these do not know which shell they are in.
//!
//! Every successful pick grants the chosen path to the file scope for this run
//! (`services/file_scope.rs`). That is the whole authorisation model: the
//! operator saw a dialog and chose the file, so the app may read it.

use std::path::{Path, PathBuf};

use base64::Engine;
use serde::Serialize;
use tauri::{AppHandle, Manager, WebviewWindow};
use tauri_plugin_dialog::DialogExt;

use crate::errors::{AppError, AppResult};
use crate::services::window_spec::WindowRole;
use crate::state::file_state::{FileState, MediaFolder};

/// Extensions accepted for a prop image (`file.ipc.ts:26`).
const PROP_IMAGE_EXTENSIONS: &[&str] = &["png", "jpg", "jpeg", "gif", "webp", "svg"];
/// Extensions accepted for a prop video (`file.ipc.ts:27`).
const PROP_VIDEO_EXTENSIONS: &[&str] = &["mp4", "webm", "mov", "avi", "mkv", "m4v"];
const IMAGE_EXTENSIONS: &[&str] = &["jpg", "jpeg", "png", "gif", "webp"];
const VIDEO_EXTENSIONS: &[&str] = &["mp4", "webm", "mov", "avi", "mkv", "m4v"];
const AUDIO_EXTENSIONS: &[&str] = &["mp3", "wav", "m4a", "aac", "ogg", "flac"];
/// Font files to install (`font.ipc.ts:21-37`).
const FONT_EXTENSIONS: &[&str] = &["ttf", "otf", "woff", "woff2"];

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PickedFile {
    pub name: String,
    pub path: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PickedImage {
    pub name: String,
    pub path: String,
    pub data_url: String,
}

/// A prop can be an image or a video, and the two are returned differently:
/// an image as a data: URL small enough to store in Convex, a video as a
/// `local-media://` URL because the bytes stay on the machine
/// (`file.ipc.ts:207-251`).
#[derive(Debug, Clone, Serialize)]
#[serde(tag = "mediaType", rename_all = "camelCase")]
pub enum PickedPropMedia {
    #[serde(rename = "image", rename_all = "camelCase")]
    Image {
        name: String,
        path: String,
        data_url: String,
    },
    #[serde(rename = "video", rename_all = "camelCase")]
    Video {
        name: String,
        path: String,
        media_url: String,
    },
}

/// A presentation file handed to the PPTX/PDF importer.
///
/// `bytes` is base64 rather than the `Uint8Array` Electron returns: a JSON
/// array of numbers would be roughly seven bytes on the wire per byte of file,
/// and a deck is tens of megabytes. The bridge in `src/renderer/tauri/` decodes
/// it before the UI sees it, so the type the React side consumes is unchanged.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PickedPresentation {
    pub name: String,
    pub path: String,
    pub bytes: String,
    pub last_modified: f64,
}

/// Dialogs are parented to the window that asked, so a modal sheet appears on
/// the right screen. Falls back to the operator window, as Electron does
/// (`file.ipc.ts:78`).
fn parent(app: &AppHandle, requester: Option<&WebviewWindow>) -> Option<WebviewWindow> {
    requester
        .cloned()
        .or_else(|| app.get_webview_window(WindowRole::Main.label()))
}

fn builder(
    app: &AppHandle,
    requester: Option<&WebviewWindow>,
) -> tauri_plugin_dialog::FileDialogBuilder<tauri::Wry> {
    let dialog = app.dialog().file();
    match parent(app, requester) {
        Some(window) => dialog.set_parent(&window),
        None => dialog,
    }
}

/// Choose a media folder. Adds it to the Media panel and to the scope, which is
/// how a folder becomes readable at all.
pub fn select_folder(
    app: &AppHandle,
    state: &FileState,
    requester: Option<&WebviewWindow>,
) -> AppResult<Option<MediaFolder>> {
    let Some(folder) = builder(app, requester).blocking_pick_folder() else {
        return Ok(None);
    };
    let path = to_path(folder)?;
    Ok(Some(state.add_folder(&path)?))
}

/// Choose several media folders at once.
///
/// A church's media does not arrive one folder at a time — backgrounds,
/// countdowns, announcements and a term's sermon series are picked together,
/// and adding them one dialog at a time is four dialogs. The single-folder
/// picker stays for the places that genuinely want one, such as choosing where
/// to import a library from.
///
/// A folder that cannot be added does not stop the others: the operator picked
/// all of them on purpose, and losing the rest because one was unreadable is
/// the wrong answer.
pub fn select_folders(
    app: &AppHandle,
    state: &FileState,
    requester: Option<&WebviewWindow>,
) -> AppResult<Vec<MediaFolder>> {
    let Some(picked) = builder(app, requester).blocking_pick_folders() else {
        return Ok(Vec::new());
    };
    let mut added = Vec::with_capacity(picked.len());
    for folder in picked {
        let path = match to_path(folder) {
            Ok(path) => path,
            Err(error) => {
                tracing::warn!(%error, "a chosen media folder could not be read");
                continue;
            }
        };
        match state.add_folder(&path) {
            Ok(folder) => added.push(folder),
            Err(error) => tracing::warn!(%error, "a chosen media folder could not be added"),
        }
    }
    Ok(added)
}

/// Choose where to write a library export. The destination is outside every
/// media folder by nature, so it gets a session grant.
pub fn select_library_export_destination(
    app: &AppHandle,
    state: &FileState,
    requester: Option<&WebviewWindow>,
    suggested_name: Option<&str>,
) -> AppResult<Option<String>> {
    let default_name = suggested_name
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_owned)
        .unwrap_or_else(|| "present-library-export".to_owned());

    let Some(destination) = builder(app, requester)
        .set_title("Export Libraries")
        .set_file_name(&default_name)
        .blocking_save_file()
    else {
        return Ok(None);
    };

    let path = to_path(destination)?;
    // The chosen path does not exist yet; the folder it will be created in
    // does, and that is what has to be reachable.
    let parent_dir = path
        .parent()
        .ok_or_else(|| AppError::Invalid("Choose a folder to export into.".to_owned()))?;
    state.grant_picked_dir(parent_dir)?;

    Ok(Some(path.display().to_string()))
}

/// Choose a folder to import a library bundle from.
pub fn select_library_import_source(
    app: &AppHandle,
    state: &FileState,
    requester: Option<&WebviewWindow>,
) -> AppResult<Option<String>> {
    let Some(folder) = builder(app, requester).blocking_pick_folder() else {
        return Ok(None);
    };
    let path = to_path(folder)?;
    Ok(Some(state.grant_picked_dir(&path)?.display().to_string()))
}

pub fn select_media_file(
    app: &AppHandle,
    state: &FileState,
    requester: Option<&WebviewWindow>,
) -> AppResult<Option<PickedFile>> {
    let mut combined = IMAGE_EXTENSIONS.to_vec();
    combined.extend_from_slice(VIDEO_EXTENSIONS);

    let picked = builder(app, requester)
        .add_filter("Media Files", &combined)
        .add_filter("Images", IMAGE_EXTENSIONS)
        .add_filter("Videos", VIDEO_EXTENSIONS)
        .blocking_pick_file();

    let Some(picked) = picked else {
        return Ok(None);
    };
    let path = state.grant_picked_file(&to_path(picked)?)?;
    Ok(Some(described(&path)))
}

/// A PowerPoint file to import (`pptx.ipc.ts:6-24`): its path, granted to the
/// scope so `parse_pptx` may read it, or `None` when cancelled.
pub fn select_pptx_file(
    app: &AppHandle,
    state: &FileState,
    requester: Option<&WebviewWindow>,
) -> AppResult<Option<String>> {
    let Some(picked) = builder(app, requester)
        .add_filter("PowerPoint Files", &["pptx"])
        .blocking_pick_file()
    else {
        return Ok(None);
    };
    Ok(Some(
        state
            .grant_picked_file(&to_path(picked)?)?
            .display()
            .to_string(),
    ))
}

/// Fonts to install. Multi-select; `None` when cancelled, as Electron returns
/// `null` rather than an empty list.
pub fn select_font_files(
    app: &AppHandle,
    state: &FileState,
    requester: Option<&WebviewWindow>,
) -> AppResult<Option<Vec<String>>> {
    let Some(picked) = builder(app, requester)
        .add_filter("Font Files", FONT_EXTENSIONS)
        .blocking_pick_files()
    else {
        return Ok(None);
    };
    if picked.is_empty() {
        return Ok(None);
    }

    let mut paths = Vec::with_capacity(picked.len());
    for entry in picked {
        paths.push(
            state
                .grant_picked_file(&to_path(entry)?)?
                .display()
                .to_string(),
        );
    }
    Ok(Some(paths))
}

/// Backing tracks for the Audio tab. Multi-select, like Electron.
pub fn select_audio_files(
    app: &AppHandle,
    state: &FileState,
    requester: Option<&WebviewWindow>,
) -> AppResult<Vec<PickedFile>> {
    let Some(picked) = builder(app, requester)
        .add_filter("Audio", AUDIO_EXTENSIONS)
        .blocking_pick_files()
    else {
        return Ok(Vec::new());
    };

    let mut files = Vec::with_capacity(picked.len());
    for entry in picked {
        let path = state.grant_picked_file(&to_path(entry)?)?;
        files.push(described(&path));
    }
    Ok(files)
}

pub fn select_prop_image(
    app: &AppHandle,
    state: &FileState,
    requester: Option<&WebviewWindow>,
) -> AppResult<Option<PickedImage>> {
    let Some(picked) = builder(app, requester)
        .add_filter("Images", PROP_IMAGE_EXTENSIONS)
        .blocking_pick_file()
    else {
        return Ok(None);
    };

    let path = state.grant_picked_file(&to_path(picked)?)?;
    Ok(Some(PickedImage {
        name: file_name(&path),
        path: path.display().to_string(),
        data_url: data_url(&path)?,
    }))
}

pub fn select_prop_media(
    app: &AppHandle,
    state: &FileState,
    requester: Option<&WebviewWindow>,
) -> AppResult<Option<PickedPropMedia>> {
    let mut combined = PROP_IMAGE_EXTENSIONS.to_vec();
    combined.extend_from_slice(PROP_VIDEO_EXTENSIONS);

    let Some(picked) = builder(app, requester)
        .add_filter("Media", &combined)
        .add_filter("Images", PROP_IMAGE_EXTENSIONS)
        .add_filter("Videos", PROP_VIDEO_EXTENSIONS)
        .blocking_pick_file()
    else {
        return Ok(None);
    };

    let path = state.grant_picked_file(&to_path(picked)?)?;
    let extension = extension_of(&path);

    if PROP_IMAGE_EXTENSIONS.contains(&extension.as_str()) {
        return Ok(Some(PickedPropMedia::Image {
            name: file_name(&path),
            path: path.display().to_string(),
            data_url: data_url(&path)?,
        }));
    }
    if PROP_VIDEO_EXTENSIONS.contains(&extension.as_str()) {
        return Ok(Some(PickedPropMedia::Video {
            name: file_name(&path),
            path: path.display().to_string(),
            media_url: crate::services::media_protocol::url_for(&path),
        }));
    }

    // The filter should have prevented this; Electron returns null here too
    // rather than guessing (`file.ipc.ts:225-227`).
    Ok(None)
}

/// OpenLyrics song files. Read by Rust itself, so nothing is granted to the
/// webview.
pub fn select_openlyrics_files(
    app: &AppHandle,
    requester: Option<&WebviewWindow>,
) -> AppResult<Option<Vec<PathBuf>>> {
    let Some(picked) = builder(app, requester)
        .add_filter("OpenLyrics songs", &["xml"])
        .blocking_pick_files()
    else {
        return Ok(None);
    };
    picked
        .into_iter()
        .map(to_path)
        .collect::<AppResult<Vec<_>>>()
        .map(Some)
}

/// VideoPsalm songbooks: the `.json` files in its backup's songbook folder.
/// Read by Rust itself, so nothing is granted to the webview.
pub fn select_videopsalm_files(
    app: &AppHandle,
    requester: Option<&WebviewWindow>,
) -> AppResult<Option<Vec<PathBuf>>> {
    let Some(picked) = builder(app, requester)
        .add_filter("VideoPsalm songbooks", &["json"])
        .blocking_pick_files()
    else {
        return Ok(None);
    };
    picked
        .into_iter()
        .map(to_path)
        .collect::<AppResult<Vec<_>>>()
        .map(Some)
}

pub fn select_presentation_files(
    app: &AppHandle,
    state: &FileState,
    requester: Option<&WebviewWindow>,
) -> AppResult<Option<Vec<PickedPresentation>>> {
    let Some(picked) = builder(app, requester)
        .add_filter("Presentation Files", &["pdf", "pptx"])
        .add_filter("PDF Files", &["pdf"])
        .add_filter("PowerPoint Files", &["pptx"])
        .blocking_pick_files()
    else {
        return Ok(None);
    };

    let mut files = Vec::with_capacity(picked.len());
    for entry in picked {
        let path = state.grant_picked_file(&to_path(entry)?)?;
        let bytes = std::fs::read(&path)?;
        let metadata = std::fs::metadata(&path)?;

        files.push(PickedPresentation {
            name: file_name(&path),
            path: path.display().to_string(),
            bytes: base64::engine::general_purpose::STANDARD.encode(&bytes),
            last_modified: modified_ms(&metadata),
        });
    }

    Ok(Some(files))
}

fn described(path: &Path) -> PickedFile {
    PickedFile {
        name: file_name(path),
        path: path.display().to_string(),
    }
}

fn file_name(path: &Path) -> String {
    path.file_name()
        .map(|name| name.to_string_lossy().into_owned())
        .unwrap_or_default()
}

fn extension_of(path: &Path) -> String {
    path.extension()
        .map(|value| value.to_string_lossy().to_lowercase())
        .unwrap_or_default()
}

/// `getImageMimeType` from `file.ipc.ts:29-33`.
fn image_mime_type(extension: &str) -> String {
    match extension {
        "svg" => "image/svg+xml".to_owned(),
        "jpg" => "image/jpeg".to_owned(),
        "" => "image/png".to_owned(),
        other => format!("image/{other}"),
    }
}

fn data_url(path: &Path) -> AppResult<String> {
    let bytes = std::fs::read(path)?;
    Ok(format!(
        "data:{};base64,{}",
        image_mime_type(&extension_of(path)),
        base64::engine::general_purpose::STANDARD.encode(&bytes)
    ))
}

fn modified_ms(metadata: &std::fs::Metadata) -> f64 {
    metadata
        .modified()
        .ok()
        .and_then(|time| time.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|elapsed| elapsed.as_millis() as f64)
        .unwrap_or(0.0)
}

/// The dialog plugin returns a `FilePath`, which is a real path on desktop and
/// a content URI on mobile. This app is desktop-only, so a URI is a bug rather
/// than a case to handle.
fn to_path(picked: tauri_plugin_dialog::FilePath) -> AppResult<PathBuf> {
    picked
        .into_path()
        .map_err(|error| AppError::Invalid(format!("Unusable file selection: {error}")))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn image_mime_types_match_the_electron_helper() {
        assert_eq!(image_mime_type("png"), "image/png");
        assert_eq!(image_mime_type("jpg"), "image/jpeg");
        assert_eq!(image_mime_type("jpeg"), "image/jpeg");
        assert_eq!(image_mime_type("svg"), "image/svg+xml");
        assert_eq!(image_mime_type("webp"), "image/webp");
        assert_eq!(image_mime_type(""), "image/png");
    }

    #[test]
    fn prop_media_serialises_with_the_shape_the_ui_expects() {
        let image = PickedPropMedia::Image {
            name: "logo.png".to_owned(),
            path: "/media/logo.png".to_owned(),
            data_url: "data:image/png;base64,AA==".to_owned(),
        };
        let json = serde_json::to_value(&image).expect("serialisable");
        assert_eq!(json["mediaType"], "image");
        assert_eq!(json["dataUrl"], "data:image/png;base64,AA==");

        let video = PickedPropMedia::Video {
            name: "clip.mp4".to_owned(),
            path: "/media/clip.mp4".to_owned(),
            media_url: "local-media://media/media/clip.mp4".to_owned(),
        };
        let json = serde_json::to_value(&video).expect("serialisable");
        assert_eq!(json["mediaType"], "video");
        assert_eq!(json["mediaUrl"], "local-media://media/media/clip.mp4");
        assert!(json.get("dataUrl").is_none());
    }
}
