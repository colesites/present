//! A screen's NDI output: an audience screen's picture, sent as a source on
//! the network, for a streaming computer or a switcher.
//!
//! Beside the NDI output in Connections, which sends what the NDI look says.
//! This one sends a screen as Screen Configuration has it: its picture, its
//! colour, and for its own output the part it shows, the target, the colour
//! adjustments and the corner pin, as a display output would show it.

use std::time::Instant;

use tauri::{AppHandle, Manager};

use crate::services::compositor::{SceneCompositor, ScopedMediaLoader};
use crate::services::screen_picture::{arrange, plan};
use crate::services::screens::{OutputTarget, FALLBACK_SIZE};
use crate::state::{DisplayState, FileState, OutputState};

use super::output::FrameSource;
use super::stream::scoped_opener;
use super::video_feed::{Opener, RegionVideos, VideoFeed};

pub struct ScreenFrameSource {
    app: AppHandle,
    screen: String,
    output: String,
    compositor: SceneCompositor,
    video: VideoFeed,
    regions: RegionVideos,
    open: Opener,
    canvas: Vec<u8>,
}

impl ScreenFrameSource {
    pub fn new(app: AppHandle, screen: &str, output: &str) -> Self {
        let opener = scoped_opener(app.clone());
        Self {
            app,
            screen: screen.to_owned(),
            output: output.to_owned(),
            compositor: SceneCompositor::new(FALLBACK_SIZE.0, FALLBACK_SIZE.1),
            video: VideoFeed::new(),
            regions: RegionVideos::new(),
            open: opener,
            canvas: Vec::new(),
        }
    }
}

impl FrameSource for ScreenFrameSource {
    fn render(&mut self, out: &mut Vec<u8>) -> Result<(u32, u32), String> {
        let (Some(output_state), Some(files), Some(displays)) = (
            self.app.try_state::<OutputState>(),
            self.app.try_state::<FileState>(),
            self.app.try_state::<DisplayState>(),
        ) else {
            return Err("the app is still starting".to_owned());
        };
        let screen = displays
            .screen(&self.screen)
            .ok_or_else(|| format!("screen {} is no longer set up", self.screen))?;
        let output = screen
            .output(&self.output)
            .ok_or_else(|| format!("output {} is no longer set up", self.output))?;

        // An NDI output's own size: a custom target's, or 1080p.
        let size = match output.target {
            OutputTarget::Custom { width, height, .. } => (width, height),
            OutputTarget::Full => FALLBACK_SIZE,
        };
        let laid = plan(&screen, &[(self.output.clone(), size, 1.0)]);
        let base = screen
            .color
            .as_deref()
            .and_then(crate::services::compositor::color::parse)
            .unwrap_or(tiny_skia::Color::BLACK);
        self.compositor.set_base(base);
        self.compositor.resize(laid.canvas.0, laid.canvas.1);

        let scene = output_state.on_screen();
        let now = Instant::now();
        let frame = self.video.frame_for(&scene, now, laid.canvas, &self.open);
        let region_frames = self
            .regions
            .frames_for(&scene, now, laid.canvas, &self.open);
        let loader = ScopedMediaLoader::new(&files);
        let (rendered, _) = self
            .compositor
            .render_with_regions(&scene, frame, &region_frames, &loader)
            .ok_or_else(|| "the compositor could not draw the screen".to_owned())?;

        let arrangement = laid
            .arrangements
            .iter()
            .find(|(id, _)| *id == self.output)
            .map(|(_, arrangement)| *arrangement)
            .filter(|arrangement| !arrangement.is_identity());
        match arrangement {
            Some(arrangement) => {
                rendered.write_bgra(&mut self.canvas);
                arrange(&self.canvas, laid.canvas, out, size, &arrangement);
                Ok(size)
            }
            None => {
                rendered.write_bgra(out);
                Ok(laid.canvas)
            }
        }
    }
}
