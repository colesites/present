//! Getting the bytes behind a scene's media URL, safely.
//!
//! The renderer takes a [`MediaLoader`](super::MediaLoader) rather than opening
//! files itself, and this is the implementation that touches a disk. It exists
//! as its own type for one reason: **every path here came from the frontend**,
//! and `services::file_scope` is the only thing allowed to turn one of those
//! into a read.
//!
//! handoff §12 states the rule and known-issues §3 is what happens without it —
//! `local-media://` could read any file on disk until Stage 3 closed it. A
//! compositor that called `std::fs::read` on a scene URL would reopen exactly
//! that hole, from a new direction and with no HTTP response for anyone to
//! notice the 403 missing from.
//!
//! So this goes through `FileState`, the same as the protocol handler, and a
//! URL outside the granted folders yields `None` — the frame renders without
//! it rather than the read succeeding.

use crate::services::media_protocol;
use crate::state::FileState;

use super::scene::MediaLoader;

/// Reads media through the granted-folder scope.
pub struct ScopedMediaLoader<'a> {
    state: &'a FileState,
    /// Refuse anything larger than this. A scene URL is operator-chosen, but a
    /// deck imported from elsewhere is not, and decoding a two-gigabyte "image"
    /// during a service is not a failure anyone can recover from.
    max_bytes: u64,
}

/// 256 MiB. Larger than any real slide background, small enough that a bad one
/// cannot exhaust a laptop's memory mid-service.
const DEFAULT_MAX_BYTES: u64 = 256 * 1024 * 1024;

impl<'a> ScopedMediaLoader<'a> {
    pub fn new(state: &'a FileState) -> Self {
        Self {
            state,
            max_bytes: DEFAULT_MAX_BYTES,
        }
    }

    pub fn with_max_bytes(state: &'a FileState, max_bytes: u64) -> Self {
        Self { state, max_bytes }
    }
}

impl MediaLoader for ScopedMediaLoader<'_> {
    fn load(&self, url: &str) -> Option<Vec<u8>> {
        // `local-media://…` and the Windows `http://local-media.localhost/…`
        // form both go through the same parser the protocol handler uses, so
        // the two cannot drift into disagreeing about what a URL means.
        let path = media_protocol::path_from_uri(url)
            .or_else(|| Some(std::path::PathBuf::from(url.strip_prefix("file://")?)))?;

        // THE check. Not `std::fs::read`.
        let resolved = match self.state.resolve_existing(&path.to_string_lossy()) {
            Ok(resolved) => resolved,
            Err(error) => {
                tracing::warn!(%error, url, "the compositor was refused a media path");
                return None;
            }
        };

        let metadata = std::fs::metadata(&resolved).ok()?;
        if metadata.len() > self.max_bytes {
            tracing::warn!(
                url,
                size = metadata.len(),
                "the compositor refused an oversized media file"
            );
            return None;
        }

        std::fs::read(&resolved).ok()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    fn temp_dir(label: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "present-compositor-loader-{label}-{}-{:?}",
            std::process::id(),
            std::thread::current().id()
        ));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).expect("temp dir");
        dir
    }

    fn png_bytes() -> Vec<u8> {
        let buffer = image::RgbaImage::new(2, 2);
        let mut out = std::io::Cursor::new(Vec::new());
        image::DynamicImage::ImageRgba8(buffer)
            .write_to(&mut out, image::ImageFormat::Png)
            .expect("encode");
        out.into_inner()
    }

    /// A `FileState` with `media` granted and a file inside it.
    fn granted(label: &str) -> (FileState, PathBuf, PathBuf) {
        let config = temp_dir(&format!("{label}-config"));
        let media = temp_dir(&format!("{label}-media"));
        let inside = media.join("bg.png");
        std::fs::write(&inside, png_bytes()).expect("write");

        let state = FileState::load(&config);
        state.add_folder(&media).expect("grant");
        (state, media, inside)
    }

    #[test]
    fn a_file_in_a_granted_folder_loads() {
        let (state, _media, inside) = granted("inside");
        let loader = ScopedMediaLoader::new(&state);

        let url = media_protocol::url_for(&inside);
        assert!(
            loader.load(&url).is_some(),
            "a granted file should load: {url}"
        );
    }

    #[test]
    fn a_file_outside_the_scope_is_refused() {
        // known-issues §3, from the compositor's direction. A renderer calling
        // `std::fs::read` on a scene URL would reopen it with no HTTP response
        // for anyone to notice the missing 403 on.
        let (state, _media, _inside) = granted("outside");
        let loader = ScopedMediaLoader::new(&state);

        let outside = temp_dir("outside-elsewhere").join("secret.png");
        std::fs::write(&outside, png_bytes()).expect("write");

        assert!(
            loader.load(&media_protocol::url_for(&outside)).is_none(),
            "a file outside every granted folder must not load"
        );
    }

    #[test]
    fn a_traversal_out_of_a_granted_folder_is_refused() {
        let (state, media, _inside) = granted("traversal");
        let loader = ScopedMediaLoader::new(&state);

        let escape = temp_dir("traversal-elsewhere").join("secret.png");
        std::fs::write(&escape, png_bytes()).expect("write");

        // Reach out of the granted folder and back down to the other file.
        let traversal = media.join("..").join(
            escape
                .parent()
                .and_then(|p| p.file_name())
                .expect("parent name"),
        );
        let traversal = traversal.join("secret.png");

        assert!(
            loader.load(&media_protocol::url_for(&traversal)).is_none(),
            "traversal out of the scope must be refused"
        );
    }

    #[test]
    fn an_oversized_file_is_refused_before_it_is_read() {
        // Decoding a two-gigabyte "image" during a service is not a failure
        // anyone can recover from.
        let (state, _media, inside) = granted("oversize");
        let loader = ScopedMediaLoader::with_max_bytes(&state, 4);

        assert!(loader.load(&media_protocol::url_for(&inside)).is_none());
    }

    #[test]
    fn a_url_that_is_not_media_loads_nothing() {
        let (state, _media, _inside) = granted("nonsense");
        let loader = ScopedMediaLoader::new(&state);

        assert!(loader.load("https://example.com/bg.png").is_none());
        assert!(loader.load("").is_none());
        assert!(loader.load("not a url").is_none());
    }
}
