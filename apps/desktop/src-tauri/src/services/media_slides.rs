//! The slides of a PowerPoint or PDF kept in the Media panel.
//!
//! The document itself stays in its media folder, as an image or a video does.
//! What the importer made of it — the deck as `ServicePresentation` JSON, its
//! pictures already beside imported decks' — is kept here once, named by the
//! document's content, and every service that uses it reads this one copy.
//!
//! Named by content rather than by path so a file renamed or moved between
//! media folders keeps its slides, and the same file in two folders is
//! converted once.
//!
//! No Tauri types.

use std::path::{Path, PathBuf};

use crate::errors::{AppError, AppResult};

/// The folder, under the app's data directory.
pub const FOLDER: &str = "media-slides";

/// Where the decks are kept.
pub struct MediaSlides(pub PathBuf);

/// The id of the document at `path`: its content, hashed.
pub fn deck_id(path: &Path) -> AppResult<String> {
    let mut hasher = blake3::Hasher::new();
    std::io::copy(&mut std::fs::File::open(path)?, &mut hasher)?;
    Ok(hasher.finalize().to_hex()[..32].to_owned())
}

/// An id `deck_id` could have made, so one sent from the webview can never
/// name a file outside the folder.
fn checked(id: &str) -> AppResult<&str> {
    if id.len() == 32 && id.bytes().all(|byte| byte.is_ascii_hexdigit()) {
        Ok(id)
    } else {
        Err(AppError::Invalid(
            "That is not a slides document's id.".to_owned(),
        ))
    }
}

fn file(directory: &Path, id: &str) -> AppResult<PathBuf> {
    Ok(directory.join(format!("{}.json", checked(id)?)))
}

/// The deck kept for `id`, or `None` when it has not been converted yet.
pub fn read(directory: &Path, id: &str) -> AppResult<Option<serde_json::Value>> {
    let path = file(directory, id)?;
    let bytes = match std::fs::read(&path) {
        Ok(bytes) => bytes,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(error) => return Err(error.into()),
    };
    // A file cut short by a crash is a deck to convert again, not an error.
    Ok(serde_json::from_slice(&bytes).ok())
}

/// Keep `deck` for `id`. Written beside and renamed into place, so a reader
/// never sees half of it.
pub fn write(directory: &Path, id: &str, deck: &serde_json::Value) -> AppResult<()> {
    let path = file(directory, id)?;
    std::fs::create_dir_all(directory)?;
    let partial = path.with_extension("json.partial");
    let bytes = serde_json::to_vec(deck).map_err(|error| AppError::Invalid(error.to_string()))?;
    std::fs::write(&partial, bytes)?;
    std::fs::rename(&partial, &path)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn folder(name: &str) -> PathBuf {
        let folder = std::env::temp_dir().join(format!(
            "present-media-slides-{name}-{}",
            std::process::id()
        ));
        let _ = std::fs::remove_dir_all(&folder);
        std::fs::create_dir_all(&folder).expect("a folder");
        folder
    }

    #[test]
    fn a_deck_is_kept_by_its_documents_content() {
        let directory = folder("content");
        let first = directory.join("Sunday.pdf");
        let renamed = directory.join("Sunday (renamed).pdf");
        std::fs::write(&first, b"%PDF-1.7 the same bytes").expect("written");
        std::fs::write(&renamed, b"%PDF-1.7 the same bytes").expect("written");
        let id = deck_id(&first).expect("hashed");
        assert_eq!(id, deck_id(&renamed).expect("hashed"));

        let store = directory.join(FOLDER);
        assert!(read(&store, &id).expect("read").is_none());
        let deck = serde_json::json!({ "title": "Sunday", "sourceType": "pdf", "slides": [] });
        write(&store, &id, &deck).expect("written");
        assert_eq!(read(&store, &id).expect("read"), Some(deck));
    }

    #[test]
    fn an_id_cannot_name_another_file() {
        let directory = folder("id");
        assert!(read(&directory, "../../etc/passwd").is_err());
        assert!(write(&directory, "../x", &serde_json::Value::Null).is_err());
    }
}
