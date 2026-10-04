//! Where an imported deck's pictures are kept: files in the app's data
//! folder, named by what is in them, rather than `data:` URLs inside the
//! service. A service of PDF pages or photo-heavy slides was megabytes of
//! base64 that every save wrote, every slide change sent to every screen and
//! every render of the operator window compared; as files they are a path.

use std::collections::HashMap;
use std::path::{Path, PathBuf};

use crate::services::media_protocol;

use super::deck::MediaSink;

/// The folder, under the app's data folder.
pub const FOLDER: &str = "imported-media";

/// The app's imported-media folder, as the app was started with it.
pub struct ImportedMedia(pub PathBuf);

/// Pictures written into `directory`, each once.
pub struct FileSink {
    directory: PathBuf,
    stored: HashMap<String, String>,
}

impl FileSink {
    pub fn new(directory: &Path) -> Self {
        Self {
            directory: directory.to_owned(),
            stored: HashMap::new(),
        }
    }
}

/// Write `bytes` into `directory` under a name from their contents, unless
/// they are already there, and return the URL the screens read it by.
pub fn save(directory: &Path, bytes: &[u8], extension: &str) -> std::io::Result<String> {
    std::fs::create_dir_all(directory)?;
    let hash = blake3::hash(bytes).to_hex();
    let extension: String = extension
        .chars()
        .filter(char::is_ascii_alphanumeric)
        .take(5)
        .collect();
    let path = directory.join(format!(
        "{}.{}",
        &hash[..32],
        if extension.is_empty() {
            "bin"
        } else {
            &extension
        }
    ));
    if !path.exists() {
        std::fs::write(&path, bytes)?;
    }
    Ok(media_protocol::url_for(&path))
}

impl MediaSink for FileSink {
    fn store(&mut self, part: &str, bytes: &[u8], extension: &str) -> Option<String> {
        if let Some(url) = self.stored.get(part) {
            return Some(url.clone());
        }
        match save(&self.directory, bytes, extension) {
            Ok(url) => {
                self.stored.insert(part.to_owned(), url.clone());
                Some(url)
            }
            Err(error) => {
                tracing::warn!(%error, part, "an imported picture could not be saved");
                None
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_same_picture_is_written_once_and_named_by_what_is_in_it() {
        let directory =
            std::env::temp_dir().join(format!("present-imported-media-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&directory);
        let mut sink = FileSink::new(&directory);
        let first = sink
            .store("/ppt/media/image1.png", b"picture", "png")
            .unwrap();
        let again = sink
            .store("/ppt/media/image9.png", b"picture", "png")
            .unwrap();
        assert_eq!(first, again, "one file for the same bytes");
        assert!(
            first.contains(FOLDER) || first.contains("present-imported-media"),
            "{first}"
        );
        assert_eq!(std::fs::read_dir(&directory).unwrap().count(), 1);
        let _ = std::fs::remove_dir_all(directory);
    }
}
