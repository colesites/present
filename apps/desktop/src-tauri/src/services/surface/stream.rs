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
use crate::services::screen_picture::{self, Arrangement, Plan};
use crate::services::screens::screen_for_label;
use crate::services::video::{self, VideoDecoder};
use crate::state::output_state::{Drawn, SceneCache};
use crate::state::{DisplayState, FileState, LooksState, OutputState};

use super::{OutputView, SurfaceSource};
use crate::services::ndi::video_feed::{Opener, RegionVideos, VideoFeed, Waiting};

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
    last: Option<Drawn>,
    /// The scene, worked out again only when it changes.
    scene: SceneCache,
    /// The screen laid out over its windows, as of the last render.
    plan: Option<Plan>,
    /// Which output each window is.
    outputs: Vec<(String, String)>,
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
            scene: SceneCache::new(),
            plan: None,
            outputs: Vec::new(),
        }
    }
}

impl SurfaceSource for AppSurfaceSource {
    fn render(&mut self, views: &[OutputView], out: &mut Vec<u8>) -> Result<bool, String> {
        let screen = self
            .app
            .try_state::<DisplayState>()
            .and_then(|displays| displays.screen(&self.screen))
            .ok_or_else(|| format!("screen {} is no longer set up", self.screen))?;

        // The screen over its windows, from what Screen Configuration says
        // now: a change there shows at once.
        self.outputs = views
            .iter()
            .filter_map(|view| {
                let (_, output) = screen_for_label(&view.label)?;
                Some((view.label.clone(), output.to_owned()))
            })
            .collect();
        let sizes: Vec<(String, (u32, u32), f64)> = views
            .iter()
            .zip(&self.outputs)
            .map(|(view, (_, output))| (output.clone(), view.size, view.scale))
            .collect();
        let plan = screen_picture::plan(&screen, &sizes);
        let base = screen
            .color
            .as_deref()
            .and_then(crate::services::compositor::color::parse)
            .unwrap_or(tiny_skia::Color::BLACK);
        if self.compositor.set_base(base) || self.plan.as_ref() != Some(&plan) {
            // The scene has not changed, but the picture has.
            self.last = None;
        }
        let size = plan.canvas;
        self.plan = Some(plan);

        let Self {
            app,
            screen: screen_id,
            compositor,
            video,
            regions,
            open,
            last,
            scene: scene_cache,
            ..
        } = self;
        let (Some(output), Some(files)) =
            (app.try_state::<OutputState>(), app.try_state::<FileState>())
        else {
            return Err("the app is still starting".to_owned());
        };

        // Through its own column of the live look, for a screen added beside
        // the Screen: a change in Looks shows at once.
        let looks = app.try_state::<LooksState>();
        let scene = scene_cache.for_screen(&output, looks.as_deref(), screen_id);
        compositor.resize(size.0, size.1);
        let now = Instant::now();
        let frame = match video.frame_or_wait(&scene, now, size, open) {
            Ok(frame) => frame,
            // The scene's new video has not given its first frame yet: the
            // screen keeps the picture it has until it does, and cuts to the
            // video then, rather than going black while the file opens.
            Err(Waiting) if last.is_some() => return Ok(false),
            Err(Waiting) => None,
        };
        let shown = frame.map(|frame| frame.presentation_seconds);
        let region_frames = regions.frames_for(&scene, now, size, open);

        // A transition or a scrolling message moves while the scene stands
        // still, so "unchanged" is the compositor's to say, not just the scene's.
        let drawn = last
            .as_ref()
            .map(|(scene, video, size)| (scene.as_ref(), *video, *size));
        let unchanged = !compositor.needs_drawing(drawn, &scene, shown, &region_frames, size);
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

    fn canvas_size(&self) -> (u32, u32) {
        self.plan.as_ref().map_or((1920, 1080), |plan| plan.canvas)
    }

    fn arrangement(&self, label: &str) -> Option<Arrangement> {
        let (_, output) = self.outputs.iter().find(|(each, _)| each == label)?;
        self.plan
            .as_ref()?
            .arrangements
            .iter()
            .find(|(id, _)| id == output)
            .map(|(_, arrangement)| *arrangement)
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
