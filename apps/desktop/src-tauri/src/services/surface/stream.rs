//! What the native audience view draws: the scene on screen, as the audience
//! window would draw it.
//!
//! The program column is already folded into that scene by the operator
//! window (`App.tsx:535-546`), so unlike the NDI stream nothing is projected
//! here. The size is the window's own, in CSS pixels, which is what the
//! compositor's text layers take a pixel to be.

use std::sync::Arc;
use std::time::Instant;

use tauri::{AppHandle, Manager};

use crate::services::compositor::{SceneCompositor, ScopedMediaLoader};
use crate::services::media_protocol;
use crate::services::output::OutputScene;
use crate::services::video::{self, VideoDecoder};
use crate::state::{FileState, OutputState};

use super::SurfaceSource;
use crate::services::ndi::video_feed::{Opener, VideoFeed};

pub struct AppSurfaceSource {
    app: AppHandle,
    compositor: SceneCompositor,
    video: VideoFeed,
    /// Opening a video, on its own thread (`video_feed.rs`).
    open: Opener,
    /// What the last presented frame was drawn from, so an unchanged slide is
    /// not handed to the view again.
    last: Option<(OutputScene, Option<f64>, (u32, u32))>,
}

impl AppSurfaceSource {
    pub fn new(app: AppHandle) -> Self {
        let app_for_opening = app.clone();
        Self {
            app,
            compositor: SceneCompositor::new(1920, 1080),
            video: VideoFeed::new(),
            open: scoped_opener(app_for_opening),
            last: None,
        }
    }
}

impl SurfaceSource for AppSurfaceSource {
    fn render(&mut self, size: (u32, u32), out: &mut Vec<u8>) -> Result<bool, String> {
        let Self {
            app,
            compositor,
            video,
            open,
            last,
        } = self;
        let (Some(output), Some(files)) =
            (app.try_state::<OutputState>(), app.try_state::<FileState>())
        else {
            return Err("the app is still starting".to_owned());
        };

        let scene = output.on_screen();
        compositor.resize(size.0, size.1);
        let frame = video.frame_for(&scene, Instant::now(), size, open);
        let shown = frame.map(|frame| frame.presentation_seconds);

        let unchanged =
            last.as_ref()
                .is_some_and(|(previous_scene, previous_video, previous_size)| {
                    *previous_size == size
                        && *previous_video == shown
                        && !previous_scene.draws_differently(&scene)
                });
        if unchanged {
            return Ok(false);
        }

        let loader = ScopedMediaLoader::new(&files);
        let (rendered, _) = compositor.render(&scene, frame, &loader).ok_or_else(|| {
            format!(
                "the compositor could not draw a {}x{} frame",
                size.0, size.1
            )
        })?;
        rendered.write_bgra_premultiplied(out);
        *last = Some((scene, shown, size));
        Ok(true)
    }
}

/// An opener that resolves a URL through the file scope, wherever it runs.
///
/// It holds an `AppHandle` and looks the state up again inside, because a
/// `State<'_, T>` cannot cross to the thread the video is opened on.
fn scoped_opener(app: AppHandle) -> Opener {
    Arc::new(move |url: &str, size: (u32, u32)| {
        let files = app
            .try_state::<FileState>()
            .ok_or_else(|| "the app is still starting".to_owned())?;
        open_scoped(&files, url, size)
    })
}

fn open_scoped(
    files: &FileState,
    url: &str,
    size: (u32, u32),
) -> Result<Box<dyn VideoDecoder>, String> {
    let path =
        media_protocol::path_from_uri(url).ok_or_else(|| format!("not a media URL: {url}"))?;
    let resolved = files
        .resolve_existing(&path.to_string_lossy())
        .map_err(|error| error.to_string())?;
    video::open_contained(&resolved, size).map_err(|error| error.to_string())
}
