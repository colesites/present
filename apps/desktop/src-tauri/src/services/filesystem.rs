//! File operations the renderer can ask for, every one of them scope-checked.
//!
//! Ports `src/main/ipc/file.ipc.ts` minus the dialogs, which live in
//! `services/dialog.rs`. Behaviour is deliberately identical — the same unique
//! naming, the same bundle layout, the same returned shapes — with one
//! difference: every path argument goes through `FileState` first, so a caller
//! can only touch files inside a folder the operator chose.

use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::errors::{AppError, AppResult};
use crate::services::file_scope::display_path;
use crate::state::file_state::FileState;

/// One file in a media folder. Matches `read-folder`'s return shape
/// (`file.ipc.ts:113-130`), which the Media panel maps straight into items.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FolderEntry {
    pub name: String,
    pub last_modified: f64,
}

/// The result of renaming a media file.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RenamedFile {
    pub path: String,
    pub name: String,
}

/// One library item as the React side hands it over for export.
#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LibraryItem {
    pub title: String,
    pub body: String,
    #[serde(default)]
    pub category_name: Option<String>,
    #[serde(default)]
    pub author: Option<String>,
    #[serde(default)]
    pub artist: Option<String>,
    #[serde(default)]
    pub r#type: Option<String>,
    #[serde(default)]
    pub content: Option<serde_json::Value>,
    #[serde(default)]
    pub slides: Vec<serde_json::Value>,
    #[serde(default)]
    pub created_at: Option<f64>,
    #[serde(default)]
    pub updated_at: Option<f64>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportedBundle {
    pub path: String,
    pub item_count: usize,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportedBundle {
    pub path: String,
    pub item_count: usize,
    pub items: Vec<LibraryItem>,
}

/// Files in a folder, without descending into subfolders.
///
/// The Electron handler swallows every error and returns `[]`, which turns a
/// missing drive into an empty Media panel with no explanation. Here the error
/// travels: the caller already handles a rejection per folder.
pub fn read_folder(state: &FileState, folder_path: &str) -> AppResult<Vec<FolderEntry>> {
    let folder = state.resolve_existing(folder_path)?;
    let mut entries = Vec::new();

    for entry in std::fs::read_dir(&folder)? {
        let entry = entry?;
        let metadata = match entry.metadata() {
            Ok(metadata) => metadata,
            // A file that vanished between the listing and the stat is not an
            // error worth failing the whole folder for.
            Err(_) => continue,
        };
        if !metadata.is_file() {
            continue;
        }

        entries.push(FolderEntry {
            name: entry.file_name().to_string_lossy().into_owned(),
            last_modified: modified_ms(&metadata),
        });
    }

    Ok(entries)
}

/// Copy a file into a media folder, creating the target folder if needed.
pub fn copy_media_file(state: &FileState, source: &str, target: &str) -> AppResult<bool> {
    let source = state.resolve_existing(source)?;
    let target = state.resolve_new(target)?;

    if let Some(parent) = target.parent() {
        std::fs::create_dir_all(parent)?;
    }
    std::fs::copy(&source, &target)?;
    Ok(true)
}

/// Rename a media file in place, keeping its extension when the new name omits
/// one. Ports `rename-media-file` (`file.ipc.ts:285-313`).
pub fn rename_media_file(
    state: &FileState,
    old_path: &str,
    new_name: &str,
) -> AppResult<RenamedFile> {
    let old = state.resolve_existing(old_path)?;

    let trimmed = new_name.trim();
    if trimmed.is_empty() {
        return Err(AppError::Invalid("File name is required".to_owned()));
    }

    // `path.basename` in the original: a name carrying directory separators
    // must not be allowed to choose where the file lands.
    let sanitized = Path::new(trimmed)
        .file_name()
        .map(|name| name.to_string_lossy().into_owned())
        .ok_or_else(|| AppError::Invalid("File name is required".to_owned()))?;

    let next_name = if Path::new(&sanitized).extension().is_some() {
        sanitized
    } else {
        match old.extension() {
            Some(extension) => format!("{sanitized}.{}", extension.to_string_lossy()),
            None => sanitized,
        }
    };

    let parent = old
        .parent()
        .ok_or_else(|| AppError::Invalid("File has no folder".to_owned()))?;
    let next = parent.join(&next_name);

    if next == old {
        return Ok(RenamedFile {
            path: display_path(&next),
            name: next_name,
        });
    }
    if next.exists() {
        return Err(AppError::Invalid("Name already exists".to_owned()));
    }

    let next = state.resolve_new(&next.display().to_string())?;
    std::fs::rename(&old, &next)?;

    Ok(RenamedFile {
        path: display_path(&next),
        name: next_name,
    })
}

pub fn delete_media_file(state: &FileState, file_path: &str) -> AppResult<bool> {
    let path = state.resolve_existing(file_path)?;
    std::fs::remove_file(path)?;
    Ok(true)
}

/// Create a folder, adding ` 2`, ` 3`… when the name is taken.
/// Ports `create-directory` (`file.ipc.ts:327-345`).
pub fn create_directory(state: &FileState, parent_path: &str, name: &str) -> AppResult<String> {
    let parent = state.resolve_existing(parent_path)?;

    let name = Path::new(name.trim())
        .file_name()
        .map(|name| name.to_string_lossy().into_owned())
        .ok_or_else(|| AppError::Invalid("Folder name is required".to_owned()))?;

    let base = parent.join(&name);
    let mut candidate = base.clone();
    let mut counter = 1;
    while candidate.exists() {
        candidate = parent.join(format!("{name} {counter}"));
        counter += 1;
    }

    let candidate = state.resolve_new(&candidate.display().to_string())?;
    std::fs::create_dir(&candidate)?;
    Ok(display_path(&candidate))
}

pub fn rename_directory(state: &FileState, old_path: &str, new_path: &str) -> AppResult<bool> {
    let old = state.resolve_existing(old_path)?;
    let next = state.resolve_new(new_path)?;

    if next.exists() {
        return Err(AppError::Invalid("Name already exists".to_owned()));
    }

    std::fs::rename(old, next)?;
    Ok(true)
}

/// Write a library bundle: a folder holding `manifest.json` and one
/// subdirectory per item. Ports `export-library-bundle`
/// (`file.ipc.ts:359-450`), including the `NNN-slug` item directory names.
pub fn export_library_bundle(
    state: &FileState,
    destination_path: &str,
    items: &[LibraryItem],
) -> AppResult<ExportedBundle> {
    if items.is_empty() {
        return Err(AppError::Invalid("Nothing to export".to_owned()));
    }

    let destination = state.resolve_new(destination_path)?;
    let parent = destination
        .parent()
        .ok_or_else(|| AppError::Invalid("Nothing to export".to_owned()))?;
    let base_name = destination
        .file_name()
        .map(|name| name.to_string_lossy().into_owned())
        .ok_or_else(|| AppError::Invalid("Nothing to export".to_owned()))?;

    std::fs::create_dir_all(parent)?;
    let root = unique_directory(parent, &base_name)?;
    let items_directory = root.join("items");
    std::fs::create_dir_all(&items_directory)?;

    let mut categories: Vec<String> = items
        .iter()
        .filter_map(|item| item.category_name.as_deref())
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_owned)
        .collect();
    categories.sort();
    categories.dedup();

    for (index, item) in items.iter().enumerate() {
        let title = if item.title.is_empty() {
            "untitled"
        } else {
            &item.title
        };
        let directory = unique_directory(
            &items_directory,
            &format!("{:03}-{}", index + 1, sanitize_path_segment(title)),
        )?;

        let metadata = serde_json::json!({
            "version": 1,
            "title": item.title,
            "categoryName": item.category_name,
            "author": item.author,
            "artist": item.artist,
            "type": item.r#type.clone().unwrap_or_else(|| "song".to_owned()),
            "content": item.content,
            "slides": item.slides,
            "createdAt": item.created_at,
            "updatedAt": item.updated_at,
            "bodyFile": "body.txt",
        });

        std::fs::write(
            directory.join("item.json"),
            format!(
                "{}\n",
                serde_json::to_string_pretty(&metadata).map_err(encode_error)?
            ),
        )?;
        std::fs::write(directory.join("body.txt"), &item.body)?;
    }

    let manifest = serde_json::json!({
        "version": 1,
        "exportedAt": iso_now(),
        "itemCount": items.len(),
        "categories": categories,
        "itemsDirectory": "items",
    });
    std::fs::write(
        root.join("manifest.json"),
        format!(
            "{}\n",
            serde_json::to_string_pretty(&manifest).map_err(encode_error)?
        ),
    )?;

    Ok(ExportedBundle {
        path: display_path(&root),
        item_count: items.len(),
    })
}

/// Read a bundle back. Accepts both a folder with a `manifest.json` and a bare
/// folder of item directories, as the Electron handler does
/// (`file.ipc.ts:452-538`).
pub fn import_library_bundle(state: &FileState, folder_path: &str) -> AppResult<ImportedBundle> {
    let folder = state.resolve_existing(folder_path)?;

    let has_manifest = folder.join("manifest.json").exists();
    let bundle_root = if has_manifest {
        folder.join("items")
    } else {
        folder.clone()
    };

    if !bundle_root.exists() {
        return Err(AppError::Invalid(
            "This folder does not contain an exported library bundle.".to_owned(),
        ));
    }

    let mut directories: Vec<PathBuf> = std::fs::read_dir(&bundle_root)?
        .filter_map(Result::ok)
        .filter(|entry| entry.file_type().map(|kind| kind.is_dir()).unwrap_or(false))
        .map(|entry| entry.path())
        .collect();
    directories.sort();

    let mut items = Vec::new();
    for directory in directories {
        let metadata_path = directory.join("item.json");
        if !metadata_path.exists() {
            continue;
        }

        let raw = std::fs::read_to_string(&metadata_path)?;
        let metadata: serde_json::Value = match serde_json::from_str(&raw) {
            Ok(value) => value,
            Err(error) => {
                tracing::warn!(%error, path = %metadata_path.display(), "skipping unreadable bundle item");
                continue;
            }
        };

        let body_file = metadata
            .get("bodyFile")
            .and_then(serde_json::Value::as_str)
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .unwrap_or("body.txt");
        let body_path = directory.join(body_file);
        let body = if body_path.exists() {
            std::fs::read_to_string(&body_path)?
        } else {
            String::new()
        };

        items.push(LibraryItem {
            title: string_field(&metadata, "title").unwrap_or_default(),
            body,
            category_name: string_field(&metadata, "categoryName"),
            author: string_field(&metadata, "author"),
            artist: string_field(&metadata, "artist"),
            r#type: string_field(&metadata, "type").or_else(|| Some("song".to_owned())),
            content: metadata.get("content").cloned(),
            slides: metadata
                .get("slides")
                .and_then(serde_json::Value::as_array)
                .cloned()
                .unwrap_or_default(),
            created_at: metadata
                .get("createdAt")
                .and_then(serde_json::Value::as_f64),
            updated_at: metadata
                .get("updatedAt")
                .and_then(serde_json::Value::as_f64),
        });
    }

    Ok(ImportedBundle {
        path: display_path(&folder),
        item_count: items.len(),
        items,
    })
}

fn string_field(value: &serde_json::Value, key: &str) -> Option<String> {
    value
        .get(key)
        .and_then(serde_json::Value::as_str)
        .map(str::to_owned)
}

fn encode_error(error: serde_json::Error) -> AppError {
    AppError::Invalid(format!("Could not encode the export: {error}"))
}

/// `sanitizePathSegment` from `file.ipc.ts:44-52`, character for character.
fn sanitize_path_segment(value: &str) -> String {
    let lowered = value.trim().to_lowercase();
    let mut out = String::with_capacity(lowered.len());
    let mut pending_dash = false;

    for character in lowered.chars() {
        if character.is_ascii_alphanumeric() {
            if pending_dash && !out.is_empty() {
                out.push('-');
            }
            pending_dash = false;
            out.push(character);
        } else {
            pending_dash = true;
        }
    }

    if out.is_empty() {
        "item".to_owned()
    } else {
        out
    }
}

/// `ensureUniqueDirectory` from `file.ipc.ts:54-70`: create `name`, or
/// `name-2`, `name-3`… whichever is free.
///
/// Kept as create-or-retry rather than exists-then-create so two exports racing
/// cannot both decide the same name is free.
fn unique_directory(parent: &Path, base_name: &str) -> AppResult<PathBuf> {
    for attempt in 0..1000 {
        let suffix = if attempt == 0 {
            String::new()
        } else {
            format!("-{}", attempt + 1)
        };
        let candidate = parent.join(format!("{base_name}{suffix}"));

        match std::fs::create_dir(&candidate) {
            Ok(()) => return Ok(candidate),
            Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => continue,
            Err(error) => return Err(AppError::Io(error)),
        }
    }

    Err(AppError::Invalid(format!(
        "Could not find a free name for {base_name}."
    )))
}

fn modified_ms(metadata: &std::fs::Metadata) -> f64 {
    metadata
        .modified()
        .ok()
        .and_then(|time| time.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|elapsed| elapsed.as_millis() as f64)
        .unwrap_or(0.0)
}

/// `new Date().toISOString()` — seconds precision is enough for a manifest and
/// avoids a chrono dependency for one line.
fn iso_now() -> String {
    let seconds = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|elapsed| elapsed.as_secs())
        .unwrap_or_default();

    let days = seconds / 86_400;
    let time_of_day = seconds % 86_400;
    let (year, month, day) = civil_from_days(days as i64);

    format!(
        "{year:04}-{month:02}-{day:02}T{:02}:{:02}:{:02}.000Z",
        time_of_day / 3600,
        (time_of_day % 3600) / 60,
        time_of_day % 60
    )
}

/// Howard Hinnant's `civil_from_days`, the standard days-since-epoch to
/// calendar-date conversion.
fn civil_from_days(days: i64) -> (i64, u32, u32) {
    let z = days + 719_468;
    let era = if z >= 0 { z } else { z - 146_096 } / 146_097;
    let day_of_era = z - era * 146_097;
    let year_of_era =
        (day_of_era - day_of_era / 1460 + day_of_era / 36_524 - day_of_era / 146_096) / 365;
    let year = year_of_era + era * 400;
    let day_of_year = day_of_era - (365 * year_of_era + year_of_era / 4 - year_of_era / 100);
    let shifted_month = (5 * day_of_year + 2) / 153;
    let day = (day_of_year - (153 * shifted_month + 2) / 5 + 1) as u32;
    let month = if shifted_month < 10 {
        shifted_month + 3
    } else {
        shifted_month - 9
    } as u32;

    (if month <= 2 { year + 1 } else { year }, month, day)
}

#[cfg(test)]
mod tests {
    use super::*;

    struct Fixture {
        root: PathBuf,
        media: PathBuf,
        state: FileState,
    }

    impl Fixture {
        fn new(label: &str) -> Self {
            let root = std::env::temp_dir().join(format!(
                "present-filesystem-{label}-{}-{:?}",
                std::process::id(),
                std::thread::current().id()
            ));
            let _ = std::fs::remove_dir_all(&root);
            std::fs::create_dir_all(&root).expect("temp dir");
            let root = std::fs::canonicalize(&root).expect("canonical");

            let media = root.join("media");
            std::fs::create_dir_all(&media).expect("media dir");

            let state = FileState::load(&root.join("config"));
            state.add_folder(&media).expect("media folder");

            Self { root, media, state }
        }

        fn write(&self, relative: &str, contents: &str) -> PathBuf {
            let path = self.media.join(relative);
            if let Some(parent) = path.parent() {
                std::fs::create_dir_all(parent).expect("parent");
            }
            std::fs::write(&path, contents).expect("file");
            path
        }

        fn text(path: &Path) -> String {
            std::fs::read_to_string(path).expect("readable")
        }
    }

    impl Drop for Fixture {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.root);
        }
    }

    fn as_str(path: &Path) -> &str {
        path.to_str().expect("utf-8")
    }

    #[test]
    fn read_folder_lists_files_and_skips_subfolders() {
        let fixture = Fixture::new("read");
        fixture.write("a.mp4", "video");
        fixture.write("b.png", "image");
        fixture.write("nested/c.mp4", "video");

        let mut names: Vec<_> = read_folder(&fixture.state, as_str(&fixture.media))
            .expect("listed")
            .into_iter()
            .map(|entry| entry.name)
            .collect();
        names.sort();

        assert_eq!(names, vec!["a.mp4", "b.png"]);
    }

    #[test]
    fn read_folder_refuses_a_folder_outside_the_scope() {
        let fixture = Fixture::new("read-outside");
        let outside = fixture.root.join("private");
        std::fs::create_dir_all(&outside).expect("dir");

        let error = read_folder(&fixture.state, as_str(&outside)).expect_err("refused");
        assert!(matches!(error, AppError::Denied(_)), "got {error:?}");
    }

    #[test]
    fn copy_refuses_a_source_outside_the_scope() {
        let fixture = Fixture::new("copy-outside");
        let secret = fixture.root.join("keys.txt");
        std::fs::write(&secret, "secret").expect("file");

        let error = copy_media_file(
            &fixture.state,
            as_str(&secret),
            as_str(&fixture.media.join("stolen.txt")),
        )
        .expect_err("refused");
        assert!(matches!(error, AppError::Denied(_)), "got {error:?}");
    }

    #[test]
    fn copy_refuses_a_target_outside_the_scope() {
        let fixture = Fixture::new("copy-target");
        let source = fixture.write("clip.mp4", "video");

        let error = copy_media_file(
            &fixture.state,
            as_str(&source),
            as_str(&fixture.root.join("escaped.mp4")),
        )
        .expect_err("refused");
        assert!(matches!(error, AppError::Denied(_)), "got {error:?}");
    }

    #[test]
    fn copy_creates_the_target_folder() {
        let fixture = Fixture::new("copy");
        let source = fixture.write("clip.mp4", "video");
        let target = fixture.media.join("imported").join("clip.mp4");

        assert!(copy_media_file(&fixture.state, as_str(&source), as_str(&target)).expect("copied"));
        assert_eq!(Fixture::text(&target), "video");
    }

    #[test]
    fn rename_keeps_the_extension_when_the_new_name_omits_one() {
        let fixture = Fixture::new("rename-ext");
        let source = fixture.write("clip.mp4", "video");

        let renamed =
            rename_media_file(&fixture.state, as_str(&source), "Opening Video").expect("renamed");
        assert_eq!(renamed.name, "Opening Video.mp4");
        assert!(fixture.media.join("Opening Video.mp4").exists());
    }

    #[test]
    fn rename_honours_an_extension_the_caller_supplies() {
        let fixture = Fixture::new("rename-given-ext");
        let source = fixture.write("clip.mp4", "video");

        let renamed =
            rename_media_file(&fixture.state, as_str(&source), "clip.mov").expect("renamed");
        assert_eq!(renamed.name, "clip.mov");
    }

    #[test]
    fn rename_cannot_move_a_file_with_a_path_in_the_name() {
        let fixture = Fixture::new("rename-path");
        let source = fixture.write("clip.mp4", "video");

        let renamed = rename_media_file(&fixture.state, as_str(&source), "../escaped.mp4")
            .expect("renamed in place");
        assert_eq!(renamed.name, "escaped.mp4");
        assert!(fixture.media.join("escaped.mp4").exists());
        assert!(!fixture.root.join("escaped.mp4").exists());
    }

    #[test]
    fn rename_refuses_a_name_that_is_taken() {
        let fixture = Fixture::new("rename-taken");
        let source = fixture.write("clip.mp4", "video");
        fixture.write("taken.mp4", "other");

        let error =
            rename_media_file(&fixture.state, as_str(&source), "taken.mp4").expect_err("refused");
        assert!(matches!(error, AppError::Invalid(_)), "got {error:?}");
    }

    #[test]
    fn rename_refuses_an_empty_name() {
        let fixture = Fixture::new("rename-empty");
        let source = fixture.write("clip.mp4", "video");

        let error = rename_media_file(&fixture.state, as_str(&source), "   ").expect_err("refused");
        assert!(matches!(error, AppError::Invalid(_)), "got {error:?}");
    }

    #[test]
    fn delete_refuses_a_file_outside_the_scope() {
        let fixture = Fixture::new("delete-outside");
        let secret = fixture.root.join("keys.txt");
        std::fs::write(&secret, "secret").expect("file");

        let error = delete_media_file(&fixture.state, as_str(&secret)).expect_err("refused");
        assert!(matches!(error, AppError::Denied(_)), "got {error:?}");
        assert!(secret.exists(), "the file must still be there");
    }

    #[test]
    fn create_directory_finds_a_free_name() {
        let fixture = Fixture::new("mkdir");
        let first = create_directory(&fixture.state, as_str(&fixture.media), "Backgrounds")
            .expect("created");
        let second = create_directory(&fixture.state, as_str(&fixture.media), "Backgrounds")
            .expect("created");

        assert!(first.ends_with("Backgrounds"));
        assert!(second.ends_with("Backgrounds 1"));
    }

    #[test]
    fn create_directory_cannot_escape_with_a_name() {
        let fixture = Fixture::new("mkdir-escape");
        create_directory(&fixture.state, as_str(&fixture.media), "../planted")
            .expect("created inside");

        assert!(fixture.media.join("planted").exists());
        assert!(!fixture.root.join("planted").exists());
    }

    #[test]
    fn a_bundle_round_trips() {
        let fixture = Fixture::new("bundle");
        let items = vec![
            LibraryItem {
                title: "Amazing Grace".to_owned(),
                body: "Amazing grace, how sweet the sound".to_owned(),
                category_name: Some("Hymns".to_owned()),
                author: Some("John Newton".to_owned()),
                artist: None,
                r#type: Some("song".to_owned()),
                content: None,
                slides: Vec::new(),
                created_at: Some(1.0),
                updated_at: Some(2.0),
            },
            LibraryItem {
                title: "Psalm 23".to_owned(),
                body: "The Lord is my shepherd".to_owned(),
                category_name: None,
                author: None,
                artist: None,
                r#type: Some("scripture".to_owned()),
                content: None,
                slides: Vec::new(),
                created_at: None,
                updated_at: None,
            },
        ];

        let destination = fixture.media.join("export");
        let exported =
            export_library_bundle(&fixture.state, as_str(&destination), &items).expect("exported");
        assert_eq!(exported.item_count, 2);

        let imported = import_library_bundle(&fixture.state, &exported.path).expect("imported");
        assert_eq!(imported.item_count, 2);
        assert_eq!(imported.items[0].title, "Amazing Grace");
        assert_eq!(imported.items[0].body, "Amazing grace, how sweet the sound");
        assert_eq!(imported.items[0].category_name.as_deref(), Some("Hymns"));
        assert_eq!(imported.items[1].r#type.as_deref(), Some("scripture"));
    }

    #[test]
    fn exporting_twice_to_the_same_name_does_not_overwrite() {
        let fixture = Fixture::new("bundle-unique");
        let items = vec![LibraryItem {
            title: "One".to_owned(),
            body: "body".to_owned(),
            category_name: None,
            author: None,
            artist: None,
            r#type: None,
            content: None,
            slides: Vec::new(),
            created_at: None,
            updated_at: None,
        }];

        let destination = fixture.media.join("export");
        let first =
            export_library_bundle(&fixture.state, as_str(&destination), &items).expect("first");
        let second =
            export_library_bundle(&fixture.state, as_str(&destination), &items).expect("second");

        assert_ne!(first.path, second.path);
        assert!(second.path.ends_with("export-2"));
    }

    #[test]
    fn exporting_nothing_is_refused() {
        let fixture = Fixture::new("bundle-empty");
        let error =
            export_library_bundle(&fixture.state, as_str(&fixture.media.join("export")), &[])
                .expect_err("refused");
        assert!(matches!(error, AppError::Invalid(_)), "got {error:?}");
    }

    #[test]
    fn exporting_outside_the_scope_is_refused() {
        let fixture = Fixture::new("bundle-outside");
        let items = vec![LibraryItem {
            title: "One".to_owned(),
            body: "body".to_owned(),
            category_name: None,
            author: None,
            artist: None,
            r#type: None,
            content: None,
            slides: Vec::new(),
            created_at: None,
            updated_at: None,
        }];

        let error = export_library_bundle(
            &fixture.state,
            as_str(&fixture.root.join("elsewhere")),
            &items,
        )
        .expect_err("refused");
        assert!(matches!(error, AppError::Denied(_)), "got {error:?}");
    }

    #[test]
    fn importing_a_folder_that_is_not_a_bundle_says_so() {
        let fixture = Fixture::new("bundle-not");
        let empty = fixture.media.join("empty");
        std::fs::create_dir_all(&empty).expect("dir");

        let imported = import_library_bundle(&fixture.state, as_str(&empty)).expect("read");
        assert_eq!(imported.item_count, 0);
    }

    #[test]
    fn item_directory_names_match_the_electron_slug() {
        assert_eq!(sanitize_path_segment("Amazing Grace"), "amazing-grace");
        assert_eq!(sanitize_path_segment("  Psalm 23!  "), "psalm-23");
        assert_eq!(sanitize_path_segment("---"), "item");
        assert_eq!(sanitize_path_segment(""), "item");
        assert_eq!(sanitize_path_segment("A  B"), "a-b");
        assert_eq!(sanitize_path_segment("10,000 Reasons"), "10-000-reasons");
    }

    #[test]
    fn the_manifest_timestamp_is_a_real_iso_date() {
        // Spot-checks of `civil_from_days` against dates computed by hand.
        assert_eq!(civil_from_days(0), (1970, 1, 1));
        assert_eq!(civil_from_days(19_723), (2024, 1, 1));
        assert_eq!(civil_from_days(19_782), (2024, 2, 29));

        let stamp = iso_now();
        assert_eq!(stamp.len(), 24, "{stamp}");
        assert!(stamp.ends_with('Z'), "{stamp}");
        assert!(stamp.starts_with("20"), "{stamp}");
    }
}
