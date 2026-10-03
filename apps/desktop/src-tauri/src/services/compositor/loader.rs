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
//!
//! **A `data:` URL is the one exception, because it is not a path.** A PDF's
//! pages and a PowerPoint's pictures are imported as them
//! (`import-documents.ts`, `pptx::convert`), so those slides are images with no
//! file behind them. Until this read them, a PDF was in the slide grid and
//! nowhere else: black on the screens, the preview and the stream. The bytes
//! are in the URL itself, so nothing is opened and there is no scope to check;
//! only the size is.

use base64::Engine;

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

/// The bytes a base64 `data:` URL carries, or `None` for any other URL, or one
/// whose bytes would be more than `max_bytes`.
fn data_url_bytes(url: &str, max_bytes: u64) -> Option<Vec<u8>> {
    let scheme = url.get(..5)?;
    if !scheme.eq_ignore_ascii_case("data:") {
        return None;
    }
    let (header, payload) = url[5..].split_once(',')?;
    // `data:image/png;base64,…`. One spelled out in percent-escapes is an SVG
    // or text, which nothing here decodes anyway.
    let base64 = header
        .rsplit(';')
        .next()
        .is_some_and(|last| last.trim().eq_ignore_ascii_case("base64"));
    if !base64 {
        return None;
    }
    // Four characters for every three bytes: the size is known before decoding.
    if payload.len() as u64 / 4 * 3 > max_bytes {
        tracing::warn!(
            size = payload.len(),
            "the compositor refused an oversized embedded image"
        );
        return None;
    }
    base64::engine::general_purpose::STANDARD
        .decode(payload.trim())
        .ok()
}

impl MediaLoader for ScopedMediaLoader<'_> {
    fn load(&self, url: &str) -> Option<Vec<u8>> {
        if let Some(bytes) = data_url_bytes(url, self.max_bytes) {
            return Some(bytes);
        }

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

    fn data_url(bytes: &[u8]) -> String {
        format!(
            "data:image/png;base64,{}",
            base64::engine::general_purpose::STANDARD.encode(bytes)
        )
    }

    #[test]
    fn an_imported_pdf_page_loads_from_its_data_url() {
        // A PDF's pages are imported as `data:` URLs, with nothing on disk.
        // Read as a path they loaded nothing, and the deck was black on every
        // screen while it showed in the slide grid.
        let (state, _media, _inside) = granted("data-url");
        let loader = ScopedMediaLoader::new(&state);

        let page = png_bytes();
        assert_eq!(loader.load(&data_url(&page)), Some(page));
    }

    #[test]
    fn a_pdf_page_reaches_the_frame() {
        // The whole way a PDF's page goes: a slide whose one element is a
        // picture with its bytes in its URL, as `import-documents.ts` makes
        // it, drawn through the loader the screens, the preview and NDI use.
        let state = FileState::load(&temp_dir("data-url-frame"));
        let loader = ScopedMediaLoader::new(&state);
        let mut page = image::RgbaImage::new(4, 4);
        for pixel in page.pixels_mut() {
            pixel.0 = [0, 255, 0, 255];
        }
        let mut png = std::io::Cursor::new(Vec::new());
        image::DynamicImage::ImageRgba8(page)
            .write_to(&mut png, image::ImageFormat::Png)
            .expect("encode");
        let scene = crate::services::output::OutputScene {
            show_text: true,
            presentation_slide: true,
            slide_text: Some("Page 1".to_owned()),
            slide_canvas_size: Some("1920x1080".to_owned()),
            slide_elements: Some(serde_json::json!([{
                "id": "pdf_page_1_image", "type": "image",
                "x": 0.0, "y": 0.0, "width": 1920.0, "height": 1080.0,
                "content": data_url(&png.into_inner()),
                "style": { "objectFit": "contain" }
            }])),
            ..crate::services::output::OutputScene::default()
        };

        let (frame, report) = super::super::scene::render(&scene, 64, 36, &loader).expect("frame");
        assert_eq!(report.elements_drawn, 1, "the page was drawn");
        assert_eq!(frame.pixel_at(32, 18), Some((0, 255, 0, 255)));
    }

    #[test]
    fn a_data_url_needs_no_granted_folder() {
        // The bytes are in the URL: there is no file to scope.
        let state = FileState::load(&temp_dir("data-url-ungranted"));
        let loader = ScopedMediaLoader::new(&state);

        assert!(loader.load(&data_url(&png_bytes())).is_some());
    }

    #[test]
    fn an_oversized_data_url_is_refused_before_it_is_decoded() {
        let (state, _media, _inside) = granted("data-url-oversize");
        let loader = ScopedMediaLoader::with_max_bytes(&state, 4);

        assert!(loader.load(&data_url(&png_bytes())).is_none());
    }

    #[test]
    fn a_data_url_that_is_not_base64_loads_nothing() {
        let (state, _media, _inside) = granted("data-url-text");
        let loader = ScopedMediaLoader::new(&state);

        assert!(loader.load("data:image/svg+xml,%3Csvg%2F%3E").is_none());
        assert!(loader.load("data:image/png;base64,not base64!").is_none());
        assert!(loader.load("data:").is_none());
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
