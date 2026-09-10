//! Rendering the audience frame.
//!
//! The command surface for ADR-001's compositor. Thin, like the rest: it takes
//! the live scene, hands it to `services::compositor` with a scope-checked
//! media loader, and reports what came out.
//!
//! **This does not yet drive the audience window.** The output surface is still
//! the webview, exactly as ADR-001 requires until the compositor reaches parity
//! ("until the compositor exists, the output window renders in a webview
//! exactly as it does under Electron, so parity is never lost mid-migration").
//! What this gives is the frame pipeline every consumer will draw from, and a
//! way to look at its output while it is being brought up to that parity.

use serde::Serialize;
use tauri::{Manager, State};

use crate::errors::{AppError, AppResult};
use crate::services::compositor::{self, ScopedMediaLoader};
use crate::state::{FileState, OutputState};

/// The default audience frame. NDI's own default, and every projector's.
const DEFAULT_WIDTH: u32 = 1920;
const DEFAULT_HEIGHT: u32 = 1080;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RenderReport {
    pub width: u32,
    pub height: u32,
    /// How long the frame took. The number that decides whether this pipeline
    /// can feed NDI at 30 fps, so it is measured rather than assumed.
    pub duration_ms: f64,
    pub elements_drawn: usize,
    /// Left to the webview layer above: `web` elements and unknown types.
    pub elements_deferred: usize,
    pub background_media_drawn: bool,
    pub background_media_missing: bool,
    /// Where the PNG was written, when one was asked for.
    pub saved_to: Option<String>,
}

/// Render the current audience scene.
///
/// `save` writes a PNG into the app's own config directory — app-owned, so it
/// needs no grant and cannot be pointed anywhere by a caller. It is the
/// verification path: a frame somebody can actually look at.
#[tauri::command]
pub async fn render_output_frame(
    app: tauri::AppHandle,
    output: State<'_, OutputState>,
    files: State<'_, FileState>,
    width: Option<u32>,
    height: Option<u32>,
    save: Option<bool>,
) -> AppResult<RenderReport> {
    let scene = output.scene();
    let width = width.unwrap_or(DEFAULT_WIDTH);
    let height = height.unwrap_or(DEFAULT_HEIGHT);

    let loader = ScopedMediaLoader::new(&files);

    let started = std::time::Instant::now();
    let (frame, rendered) = compositor::render(&scene, width, height, &loader)
        .ok_or_else(|| AppError::Invalid(format!("cannot render a {width}x{height} frame")))?;
    let duration_ms = started.elapsed().as_secs_f64() * 1000.0;

    let saved_to = if save.unwrap_or(false) {
        write_png(&app, &frame)?
    } else {
        None
    };

    Ok(RenderReport {
        width,
        height,
        duration_ms,
        elements_drawn: rendered.elements_drawn,
        elements_deferred: rendered.elements_deferred,
        background_media_drawn: rendered.background_media_drawn,
        background_media_missing: rendered.background_media_missing,
        saved_to,
    })
}

fn write_png(app: &tauri::AppHandle, frame: &compositor::Frame) -> AppResult<Option<String>> {
    let Some(png) = frame.to_png() else {
        return Err(AppError::Invalid("could not encode the frame".to_owned()));
    };

    let dir = app
        .path()
        .app_config_dir()
        .map_err(|error| AppError::Invalid(format!("no config directory: {error}")))?;
    std::fs::create_dir_all(&dir)?;

    let path = dir.join("output-frame.png");
    std::fs::write(&path, png)?;
    Ok(Some(path.to_string_lossy().into_owned()))
}
