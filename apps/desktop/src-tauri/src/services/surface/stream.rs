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

use crate::services::compositor::ScopedMediaLoader;
use crate::services::media_protocol;
use crate::services::screen_picture::{self, Arrangement, Plan};
use crate::services::screens::screen_for_label;
use crate::services::video::{self, VideoDecoder};
use crate::state::output_state::SceneCache;
use crate::state::{DisplayState, FileState, LooksState, OutputState};

use super::layered::{Drew, Layers, ScreenRenderer};
use super::{OutputView, SurfaceSource};
use crate::services::ndi::video_feed::Opener;

pub struct AppSurfaceSource {
    app: AppHandle,
    /// Which audience screen this is (`services/screens.rs`): its size, fit
    /// and colour are read each frame, so a change in Screen Configuration
    /// shows at once.
    screen: String,
    /// The screen's picture: as layers the window server puts together where
    /// it can be, whole where it cannot (`layered.rs`).
    renderer: ScreenRenderer,
    /// Opening a video, on its own thread (`video_feed.rs`).
    open: Opener,
    /// The last render's layers, for the loop to take.
    layers: Option<Layers>,
    /// The size the last render drew at: the plan's canvas, within the
    /// projection resolution.
    canvas: (u32, u32),
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
            renderer: ScreenRenderer::new(1920, 1080),
            open: scoped_opener(app_for_opening),
            layers: None,
            canvas: (1920, 1080),
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
        if self.renderer.set_base(base) || self.plan.as_ref() != Some(&plan) {
            // The scene has not changed, but the picture has.
            self.renderer.invalidate();
        }
        // No larger than the operator's projection resolution allows: the
        // views scale the picture to the window, as they always have.
        let projection = crate::services::projection::settings();
        let size = projection.canvas_for(plan.canvas);
        self.canvas = size;
        // Layers only where every window shows the whole picture and can show
        // layers, and the operator has not asked for whole pictures.
        let layers = !views.is_empty()
            && views.iter().all(|view| view.layers)
            && plan
                .arrangements
                .iter()
                .all(|(_, arrangement)| arrangement.is_identity())
            && projection.layers_allowed();
        self.plan = Some(plan);

        let Self {
            app,
            screen: screen_id,
            renderer,
            open,
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
        let loader = ScopedMediaLoader::new(&files);
        let drew = renderer.render(&scene, size, Instant::now(), open, &loader, layers, out)?;
        Ok(match drew {
            Drew::Unchanged => false,
            Drew::Whole => true,
            Drew::Layers(layers) => {
                self.layers = Some(layers);
                true
            }
        })
    }

    fn take_layers(&mut self) -> Option<Layers> {
        self.layers.take()
    }

    fn busy(&self) -> bool {
        self.renderer.busy()
    }

    fn canvas_size(&self) -> (u32, u32) {
        self.canvas
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
