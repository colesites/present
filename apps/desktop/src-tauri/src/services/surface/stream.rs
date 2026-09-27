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
use crate::services::screens::OutputTarget;
use crate::services::video::{self, VideoDecoder};
use crate::state::{DisplayState, FileState, OutputState};

use super::SurfaceSource;
use crate::services::ndi::video_feed::{Opener, RegionVideos, VideoFeed};

pub struct AppSurfaceSource {
    app: AppHandle,
    /// Which audience screen this is (`services/screens.rs`): its size, fit
    /// and colour are read each frame, so a change in Screen Configuration
    /// shows at once.
    screen: String,
    compositor: SceneCompositor,
    video: VideoFeed,
    /// The videos playing in screen composer regions.
    regions: RegionVideos,
    /// Opening a video, on its own thread (`video_feed.rs`).
    open: Opener,
    /// What the last presented frame was drawn from, so an unchanged slide is
    /// not handed to the view again.
    last: Option<(OutputScene, Option<f64>, (u32, u32))>,
}

impl AppSurfaceSource {
    pub fn new(app: AppHandle, screen: &str) -> Self {
        let app_for_opening = app.clone();
        Self {
            app,
            screen: screen.to_owned(),
            compositor: SceneCompositor::new(1920, 1080),
            video: VideoFeed::new(),
            regions: RegionVideos::new(),
            open: scoped_opener(app_for_opening),
            last: None,
        }
    }
}

impl SurfaceSource for AppSurfaceSource {
    fn canvas(&mut self, window: (u32, u32)) -> ((u32, u32), bool) {
        let Some(screen) = self
            .app
            .try_state::<DisplayState>()
            .and_then(|displays| displays.screen(&self.screen))
        else {
            return (window, false);
        };
        let base = screen
            .color
            .as_deref()
            .and_then(crate::services::compositor::color::parse)
            .unwrap_or(tiny_skia::Color::BLACK);
        if self.compositor.set_base(base) {
            // The scene has not changed, but the picture has.
            self.last = None;
        }
        let size = screen.size.map_or(window, |size| (size.width, size.height));
        (size, screen.target == OutputTarget::Fit)
    }

    fn render(&mut self, size: (u32, u32), out: &mut Vec<u8>) -> Result<bool, String> {
        let Self {
            app,
            screen: _,
            compositor,
            video,
            regions,
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
        let now = Instant::now();
        let frame = video.frame_for(&scene, now, size, open);
        let shown = frame.map(|frame| frame.presentation_seconds);
        let region_frames = regions.frames_for(&scene, now, size, open);

        // A transition or a scrolling message moves while the scene stands
        // still, so "unchanged" is the compositor's to say, not just the scene's.
        let unchanged =
            !compositor.needs_drawing(last.as_ref(), &scene, shown, &region_frames, size);
        if unchanged {
            return Ok(false);
        }

        let loader = ScopedMediaLoader::new(&files);
        let (rendered, _) = compositor
            .render_with_regions(&scene, frame, &region_frames, &loader)
            .ok_or_else(|| {
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
