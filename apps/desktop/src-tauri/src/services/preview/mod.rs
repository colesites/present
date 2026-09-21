//! The operator's preview, drawn by the compositor instead of the webview.
//!
//! ADR-001 said one frame pipeline should feed every consumer. It fed two —
//! the audience surface and NDI — while the operator's own preview stayed a
//! `<video>` element in WebKit. That split is why an MKV plays for the
//! congregation and is black for the operator, and why a video playing on
//! screen is decoded twice on one machine.
//!
//! This is the third consumer. It draws what `services::output` says is on
//! screen, at whatever size the preview is on screen, and hands it back as a
//! JPEG for an `<img>` — the same shape as the NDI prop frames
//! (`state::ndi_input_state`), which is a pattern this webview is already
//! known to keep up with.
//!
//! **Small on purpose.** A preview is a few hundred pixels across, so the
//! video is decoded at that size and the whole frame costs a fraction of the
//! audience one. Nothing here is on the audience path: if it fails, the
//! preview is blank and the service is not affected.

use std::sync::Arc;
use std::time::Instant;

use tauri::{AppHandle, Manager};

use crate::services::compositor::{SceneCompositor, ScopedMediaLoader};
use crate::services::media_protocol;
use crate::services::ndi::video_feed::{Opener, VideoFeed};
use crate::services::output::OutputScene;
use crate::services::thumbnails;
use crate::services::video::{self, VideoDecoder};
use crate::state::{FileState, OutputState};

/// The largest preview that will be drawn, per side.
///
/// A preview is a panel, not a projector. This is well above any of them and
/// keeps a bad query string from asking for an 8K frame thirty times a second.
pub const MAX_SIDE: u32 = 1280;
/// The smallest, so a zero or a stray character cannot ask for nothing.
pub const MIN_SIDE: u32 = 16;

/// What a request asked to be drawn, once it has been checked.
pub fn requested_size(width: Option<u32>, height: Option<u32>) -> (u32, u32) {
    let width = width.unwrap_or(640).clamp(MIN_SIDE, MAX_SIDE);
    let height = height.unwrap_or_else(|| width * 9 / 16).clamp(MIN_SIDE, MAX_SIDE);
    (width, height)
}

/// Draws the scene on screen, for the operator to look at.
pub struct PreviewSource {
    app: AppHandle,
    compositor: SceneCompositor,
    video: VideoFeed,
    /// Opening a video, on its own thread (`ndi/video_feed.rs`).
    open: Opener,
    /// What the last JPEG was drawn from, so an unchanged scene is encoded
    /// once however often it is asked for.
    last: Option<(OutputScene, Option<f64>, (u32, u32))>,
    picture: Vec<u8>,
}

impl PreviewSource {
    pub fn new(app: AppHandle) -> Self {
        let open = scoped_opener(app.clone());
        Self {
            app,
            compositor: SceneCompositor::new(640, 360),
            video: VideoFeed::default(),
            open,
            last: None,
            picture: Vec::new(),
        }
    }

    /// The scene on screen at `size`, as a JPEG.
    ///
    /// The same bytes come back while nothing has changed: the `<img>` asks on
    /// a timer whether or not anything moved, and a still slide should not be
    /// redrawn and re-encoded thirty times a second.
    pub fn frame(&mut self, size: (u32, u32)) -> Result<&[u8], String> {
        let (Some(output), Some(files)) = (
            self.app.try_state::<OutputState>(),
            self.app.try_state::<FileState>(),
        ) else {
            return Err("the app is still starting".to_owned());
        };

        let scene = output.on_screen();
        let frame = self
            .video
            .frame_for(&scene, Instant::now(), size, &self.open);
        let shown = frame.map(|frame| frame.presentation_seconds);
        let unchanged = self
            .last
            .as_ref()
            .is_some_and(|(previous_scene, previous_video, previous_size)| {
                *previous_size == size
                    && *previous_video == shown
                    && !previous_scene.draws_differently(&scene)
            });
        if unchanged && !self.picture.is_empty() {
            return Ok(&self.picture);
        }

        self.compositor.resize(size.0, size.1);
        let loader = ScopedMediaLoader::new(&files);
        let (rendered, _) = self
            .compositor
            .render(&scene, frame, &loader)
            .ok_or_else(|| format!("could not draw a {}x{} preview", size.0, size.1))?;

        let mut bgra = Vec::new();
        rendered.write_bgra(&mut bgra);
        self.picture =
            thumbnails::encode_jpeg(size.0, size.1, &bgra).map_err(|error| error.to_string())?;
        self.last = Some((scene, shown, size));
        Ok(&self.picture)
    }
}

/// An opener that resolves a URL through the file scope, wherever it runs.
///
/// The same shape as `surface/stream.rs`: it holds an `AppHandle` and looks
/// the state up inside, because a `State<'_, T>` cannot cross to the thread
/// the video is opened on.
fn scoped_opener(app: AppHandle) -> Opener {
    Arc::new(move |url: &str, size: (u32, u32)| {
        let files = app
            .try_state::<FileState>()
            .ok_or_else(|| "the app is still starting".to_owned())?;
        let path =
            media_protocol::path_from_uri(url).ok_or_else(|| format!("not a media URL: {url}"))?;
        let resolved = files
            .resolve_existing(&path.to_string_lossy())
            .map_err(|error| error.to_string())?;
        let decoder: Box<dyn VideoDecoder> =
            video::open_contained(&resolved, size).map_err(|error| error.to_string())?;
        Ok(decoder)
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_preview_is_a_panel_and_never_a_projector() {
        assert_eq!(requested_size(Some(640), Some(360)), (640, 360));
        assert_eq!(requested_size(None, None), (640, 360), "a sensible default");
        assert_eq!(
            requested_size(Some(480), None),
            (480, 270),
            "16:9 from the width alone"
        );
        assert_eq!(
            requested_size(Some(7680), Some(4320)),
            (MAX_SIDE, MAX_SIDE),
            "an 8K preview is a mistake or an attack, not a request"
        );
        assert_eq!(
            requested_size(Some(0), Some(0)),
            (MIN_SIDE, MIN_SIDE),
            "nothing is not a size"
        );
    }
}
