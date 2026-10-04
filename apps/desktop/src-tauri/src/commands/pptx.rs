//! PowerPoint import. Replaces `open-pptx` and `parse-pptx`, on
//! `window.pptxAPI` as before — without the Python the Electron build needed.

use base64::Engine;
use tauri::{AppHandle, Manager, State, WebviewWindow};

use crate::errors::{AppError, AppResult};
use crate::services::pptx::media::{self, FileSink, ImportedMedia};
use crate::services::{dialog, pptx};
use crate::state::FileState;

#[tauri::command]
pub async fn open_pptx(
    app: AppHandle,
    window: WebviewWindow,
    state: State<'_, FileState>,
) -> AppResult<Option<String>> {
    dialog::select_pptx_file(&app, &state, Some(&window))
}

/// The deck at `file_path` as `ParsedPptxPresentation`, its pictures saved
/// in the app's imported-media folder. Only a file the operator picked — here
/// or through the presentation picker — can be read.
///
/// The fonts it embeds are installed among the app's own fonts, loaded for
/// the screens, and its text pointed at them.
#[tauri::command]
pub async fn parse_pptx(
    app: AppHandle,
    state: State<'_, FileState>,
    imported: State<'_, ImportedMedia>,
    file_path: String,
) -> AppResult<serde_json::Value> {
    let path = state.resolve_existing(&file_path)?;
    let directory = imported.0.clone();
    tauri::async_runtime::spawn_blocking(move || import_deck(&app, &path, &directory))
        .await
        .map_err(|error| AppError::Invalid(error.to_string()))?
}

/// The deck as pictures: each slide drawn by the compositor — the renderer
/// that draws the screens — at 1920×1080, saved beside the deck's own
/// pictures. PowerPoint as Images, for a deck that should look exactly as it
/// imported and never be edited.
///
/// `{ title, slides: [{ title, url }] }`.
#[tauri::command]
pub async fn render_pptx_images(
    app: AppHandle,
    state: State<'_, FileState>,
    imported: State<'_, ImportedMedia>,
    file_path: String,
) -> AppResult<serde_json::Value> {
    let path = state.resolve_existing(&file_path)?;
    let directory = imported.0.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let presentation = import_deck(&app, &path, &directory)?;
        let files = app.state::<FileState>();
        let loader = crate::services::compositor::ScopedMediaLoader::new(&files);
        let mut slides = Vec::new();
        for (index, slide) in presentation["slides"]
            .as_array()
            .map(Vec::as_slice)
            .unwrap_or_default()
            .iter()
            .enumerate()
        {
            let png = render_slide(slide, &loader)?;
            let url = media::save(&directory, &png, "png").map_err(AppError::from)?;
            let title = slide["title"]
                .as_str()
                .filter(|title| !title.trim().is_empty())
                .map_or_else(|| format!("Slide {}", index + 1), str::to_owned);
            slides.push(serde_json::json!({ "title": title, "url": url }));
        }
        Ok(serde_json::json!({ "title": presentation["title"], "slides": slides }))
    })
    .await
    .map_err(|error| AppError::Invalid(error.to_string()))?
}

/// The deck at `path`, its pictures in `directory` and its fonts installed.
fn import_deck(
    app: &AppHandle,
    path: &std::path::Path,
    directory: &std::path::Path,
) -> AppResult<serde_json::Value> {
    let font_directory = app
        .path()
        .app_data_dir()
        .map(|data| data.join(crate::services::fonts::CUSTOM_FONT_DIRECTORY))
        .ok();
    let mut sink = FileSink::new(directory);
    let (mut presentation, package, embedded) =
        pptx::import_with(path, &mut sink).map_err(|error| {
            AppError::Invalid(format!(
                "[pptx] Could not import this PowerPoint file. {error}"
            ))
        })?;
    if let Some(font_directory) = font_directory.filter(|_| !embedded.is_empty()) {
        let installed = pptx::fonts::install(&package, &embedded, &font_directory);
        pptx::fonts::rename(&mut presentation, &installed);
        let paths: Vec<std::path::PathBuf> = installed.into_iter().map(|font| font.path).collect();
        crate::services::compositor::text::load_font_files(&paths);
    }
    Ok(presentation)
}

/// One slide drawn as the screens draw it, as a PNG.
fn render_slide(
    slide: &serde_json::Value,
    loader: &dyn crate::services::compositor::MediaLoader,
) -> AppResult<Vec<u8>> {
    use crate::services::output::OutputScene;
    const WIDTH: u32 = 1920;
    const HEIGHT: u32 = 1080;
    let scene = OutputScene {
        show_text: true,
        presentation_slide: true,
        slide_canvas_size: Some(format!("{WIDTH}x{HEIGHT}")),
        slide_elements: Some(slide["elements"].clone()),
        slide_background_color: slide["backgroundColor"].as_str().map(str::to_owned),
        ..OutputScene::default()
    };
    let (frame, _) = crate::services::compositor::render(&scene, WIDTH, HEIGHT, loader)
        .ok_or_else(|| AppError::Invalid("[pptx] A slide could not be drawn.".to_owned()))?;
    let rgba: Vec<u8> = frame
        .pixmap()
        .pixels()
        .iter()
        .flat_map(|pixel| {
            let color = pixel.demultiply();
            [color.red(), color.green(), color.blue(), 255]
        })
        .collect();
    let image = image::RgbaImage::from_raw(WIDTH, HEIGHT, rgba)
        .ok_or_else(|| AppError::Invalid("[pptx] A slide could not be drawn.".to_owned()))?;
    let mut png = Vec::new();
    image
        .write_to(&mut std::io::Cursor::new(&mut png), image::ImageFormat::Png)
        .map_err(|error| {
            AppError::Invalid(format!("[pptx] A slide could not be saved: {error}"))
        })?;
    Ok(png)
}

/// A picture an import made — a PDF's page — saved beside a deck's, and the
/// URL to draw it from.
#[tauri::command]
pub async fn save_imported_media(
    imported: State<'_, ImportedMedia>,
    data: String,
    extension: String,
) -> AppResult<String> {
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(data.trim())
        .map_err(|error| AppError::Invalid(format!("The picture is not base64: {error}")))?;
    let directory = imported.0.clone();
    tauri::async_runtime::spawn_blocking(move || media::save(&directory, &bytes, &extension))
        .await
        .map_err(|error| AppError::Invalid(error.to_string()))?
        .map_err(AppError::from)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// PowerPoint as Images: every slide of a deck comes out as a full-size
    /// picture, drawn by the compositor, with something on it.
    #[test]
    fn each_slide_is_drawn_as_a_picture() {
        let path = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("../tests/fixtures/pptx/shapes-tables-groups.pptx");
        let deck = pptx::import(&path).expect("imports");
        let slides = deck["slides"].as_array().expect("slides");
        assert!(!slides.is_empty());
        for slide in slides {
            let png = render_slide(slide, &crate::services::compositor::NoMedia).expect("drawn");
            let picture = image::load_from_memory(&png).expect("a PNG").to_rgba8();
            assert_eq!(picture.dimensions(), (1920, 1080));
            let first = picture.get_pixel(0, 0);
            assert!(
                picture.pixels().any(|pixel| pixel != first),
                "the slide has something on it"
            );
        }
    }
}
