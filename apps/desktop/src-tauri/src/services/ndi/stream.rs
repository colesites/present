//! The frames the running app sends: what is on screen, through the NDI look,
//! drawn by the compositor.
//!
//! This is where ADR-001 pays off. Electron's frame is a screenshot of the
//! audience window, so it exists only while that window is open — with the
//! window closed Electron sends a blank placeholder (`ndi.service.ts:330-333`).
//! These frames come from the scene, so the stream shows the service whether
//! or not a projector window is open.

use std::time::Instant;

use tauri::{AppHandle, Manager};

use crate::services::compositor::{SceneCompositor, ScopedMediaLoader};
use crate::services::display::ScreenRole;
use crate::services::media_protocol;
use crate::services::video::{self, VideoDecoder};
use crate::state::{DisplayState, FileState, LooksState, OutputState};

use super::look::scene_for_ndi;
use super::output::{FrameSource, FALLBACK_SIZE};
use super::video_feed::VideoFeed;

pub struct AppFrameSource {
    app: AppHandle,
    compositor: SceneCompositor,
    video: VideoFeed,
}

impl AppFrameSource {
    pub fn new(app: AppHandle) -> Self {
        let (width, height) = FALLBACK_SIZE;
        Self {
            app,
            compositor: SceneCompositor::new(width, height),
            video: VideoFeed::new(),
        }
    }
}

impl FrameSource for AppFrameSource {
    fn render(&mut self, out: &mut Vec<u8>) -> Result<(u32, u32), String> {
        let Self {
            app,
            compositor,
            video,
        } = self;

        // `try_state`, never `state`: the latter panics when the state is not
        // managed yet, and a panic here aborts the app.
        let (Some(output), Some(looks), Some(files), Some(displays)) = (
            app.try_state::<OutputState>(),
            app.try_state::<LooksState>(),
            app.try_state::<FileState>(),
            app.try_state::<DisplayState>(),
        ) else {
            return Err("the app is still starting".to_owned());
        };

        // The stream is the size the audience output is set to. NDI's own
        // default, and Electron's frame, which was the audience window's.
        let resolution = displays.snapshot().resolution_for(ScreenRole::Audience);
        let size = (resolution.width, resolution.height);
        compositor.resize(size.0, size.1);

        let looks = looks.snapshot();
        let scene = scene_for_ndi(&output.on_screen(), &looks.live_look().targets.ndi);

        let files: &FileState = &files;
        let open = |url: &str, size: (u32, u32)| open_scoped(files, url, size);
        let frame = video.frame_for(&scene, Instant::now(), size, &open);

        let loader = ScopedMediaLoader::new(files);
        let (rendered, _) = compositor.render(&scene, frame, &loader).ok_or_else(|| {
            format!(
                "the compositor could not draw a {}x{} frame",
                size.0, size.1
            )
        })?;
        rendered.write_bgra(out);
        Ok(size)
    }
}

/// Open a scene's video through the file scope. Every URL in a scene came from
/// the frontend; `FileState` is the only thing allowed to turn one into a read
/// (known-issues §3).
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
    video::open_scaled(&resolved, Some(size)).map_err(|error| error.to_string())
}
