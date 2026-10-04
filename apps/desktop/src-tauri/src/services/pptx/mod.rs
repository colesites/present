//! Importing PowerPoint files.
//!
//! A deck is read whole — themes, masters, layouts and slides — into the
//! elements Present draws, with every rule PowerPoint applies resolved here:
//! inheritance from layouts and masters, theme colours and fonts, group
//! transforms, shape geometry, fills, outlines and text styles. The renderers
//! only draw paths, fills, pictures and styled words.
//!
//! This replaced a port of a `python-pptx` script that kept a fraction of each
//! slide (every shape read as a text box, groups placed off the slide, line
//! breaks dropped) and whose tests required that output exactly.

use std::path::Path;

use serde_json::{json, Value};

use crate::errors::{AppError, AppResult};

mod color;
pub mod deck;
pub mod fill;
pub mod fonts;
pub mod geometry;
pub mod media;
pub mod package;
mod picture;
mod text;
mod theme;
mod xml;

pub use deck::{DataUrls, EmbeddedFontPart, MediaSink};

/// A presentation as the renderer receives it (`ParsedPptxPresentation`),
/// its pictures stored through `sink`.
pub fn import_with(
    path: &Path,
    sink: &mut dyn MediaSink,
) -> AppResult<(Value, package::Package, Vec<EmbeddedFontPart>)> {
    let file = std::fs::File::open(path)?;
    let package = package::Package::open(std::io::BufReader::new(file))?;
    let deck = deck::read(&package, sink)?;
    let presentation = json!({
        "title": title_from_path(path),
        "slideWidthPx": deck::CANVAS_WIDTH,
        "slideHeightPx": deck::CANVAS_HEIGHT,
        "slides": deck.slides,
    });
    Ok((presentation, package, deck.fonts))
}

/// A presentation with its pictures inline, as `data:` URLs.
pub fn import(path: &Path) -> AppResult<Value> {
    import_with(path, &mut DataUrls::default()).map(|(presentation, _, _)| presentation)
}

/// `import`, with the message the renderer shows when it fails.
pub fn import_for_renderer(path: &Path) -> AppResult<Value> {
    import(path).map_err(|error| {
        AppError::Invalid(format!(
            "[pptx] Could not import this PowerPoint file. {error}"
        ))
    })
}

fn title_from_path(path: &Path) -> String {
    path.file_stem()
        .and_then(|stem| stem.to_str())
        .map(str::trim)
        .filter(|stem| !stem.is_empty())
        .unwrap_or("Imported presentation")
        .to_owned()
}

#[cfg(test)]
mod tests {
    use std::path::PathBuf;

    use super::*;

    fn fixtures() -> PathBuf {
        PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../tests/fixtures/pptx")
    }

    fn slides(name: &str) -> Vec<Value> {
        let deck = import(&fixtures().join(name)).expect("imports");
        deck["slides"].as_array().expect("slides").clone()
    }

    fn texts(slide: &Value) -> Vec<&Value> {
        slide["elements"]
            .as_array()
            .expect("elements")
            .iter()
            .filter(|element| element["type"] == "text")
            .collect()
    }

    #[test]
    fn grouped_shapes_stay_on_the_slide() {
        // The old importer put "grouped A" at x 2016 on a slide 1920 wide.
        for slide in slides("shapes-tables-groups.pptx") {
            for element in slide["elements"].as_array().unwrap() {
                let x = element["x"].as_f64().unwrap();
                let width = element["width"].as_f64().unwrap();
                assert!(
                    x >= -1.0 && x + width <= 1921.0,
                    "{} is off the slide: x {x}, width {width}",
                    element["id"]
                );
            }
        }
    }

    #[test]
    fn a_line_break_inside_a_paragraph_is_kept() {
        let all: Vec<Value> = slides("text-and-theme.pptx");
        let contents: Vec<&str> = all
            .iter()
            .flat_map(|slide| texts(slide))
            .filter_map(|text| text["content"].as_str())
            .collect();
        assert!(
            contents
                .iter()
                .any(|content| content.contains("before\nafter")),
            "{contents:?}"
        );
    }

    #[test]
    fn line_spacing_in_points_is_pixels_not_emu() {
        for slide in slides("text-and-theme.pptx") {
            for text in texts(&slide) {
                for paragraph in text["textBody"]["paragraphs"].as_array().unwrap() {
                    let line_height = paragraph["lineHeight"].as_f64().unwrap();
                    assert!(line_height < 500.0, "a line {line_height} pixels tall");
                }
            }
        }
    }

    #[test]
    fn shapes_are_drawn_with_their_geometry_and_fill() {
        let all = slides("shapes-tables-groups.pptx");
        let shapes: Vec<&Value> = all
            .iter()
            .flat_map(|slide| slide["elements"].as_array().unwrap())
            .filter(|element| element["type"] == "shape")
            .collect();
        assert!(!shapes.is_empty());
        for shape in shapes {
            let paths = shape["geometry"]["paths"].as_array().expect("paths");
            assert!(paths
                .iter()
                .all(|path| path["d"].as_str().is_some_and(|d| d.starts_with('M'))));
        }
    }

    #[test]
    fn a_table_becomes_cells() {
        let all = slides("shapes-tables-groups.pptx");
        let cells: Vec<&str> = all
            .iter()
            .flat_map(|slide| texts(slide))
            .filter_map(|text| text["content"].as_str())
            .filter(|content| content.starts_with('r') && content.contains('c'))
            .collect();
        // The first cell spans two columns and holds two paragraphs; the last
        // is empty, and the merged-over cell draws nothing of its own.
        assert_eq!(
            cells,
            ["r0c0\nr0c1", "r0c2", "r1c0", "r1c1", "r1c2", "r2c0", "r2c1"]
        );
    }

    #[test]
    fn every_fixture_imports() {
        let mut checked = 0;
        for entry in std::fs::read_dir(fixtures()).unwrap() {
            let path = entry.unwrap().path();
            if path.extension().and_then(|ext| ext.to_str()) != Some("pptx") {
                continue;
            }
            import(&path).unwrap_or_else(|error| panic!("{}: {error}", path.display()));
            checked += 1;
        }
        assert_eq!(checked, 4);
    }

    /// Every deck in `PPTX_CORPUS` imports: `PPTX_CORPUS=~/Downloads cargo
    /// test pptx::tests::corpus -- --ignored --nocapture`.
    #[test]
    #[ignore = "reads decks from PPTX_CORPUS"]
    fn corpus() {
        let Ok(directory) = std::env::var("PPTX_CORPUS") else {
            return;
        };
        for entry in std::fs::read_dir(directory).unwrap() {
            let path = entry.unwrap().path();
            if path.extension().and_then(|ext| ext.to_str()) != Some("pptx") {
                continue;
            }
            match import(&path) {
                Ok(deck) => {
                    let slides = deck["slides"].as_array().unwrap();
                    let elements: usize = slides
                        .iter()
                        .map(|slide| slide["elements"].as_array().unwrap().len())
                        .sum();
                    println!(
                        "{:60} {:3} slides {:5} elements",
                        path.file_name().unwrap().to_string_lossy(),
                        slides.len(),
                        elements
                    );
                }
                Err(error) => panic!("{}: {error}", path.display()),
            }
        }
    }

    /// Every deck in `PPTX_CORPUS` as the importer makes it, pictures inline,
    /// into `PPTX_EXPORT_OUT`: for a page that draws them with the canvas
    /// renderer beside the compositor's pictures (`render_corpus`).
    #[test]
    #[ignore = "reads decks from PPTX_CORPUS and writes JSON to PPTX_EXPORT_OUT"]
    fn export_corpus() {
        let (Ok(directory), Ok(out)) = (
            std::env::var("PPTX_CORPUS"),
            std::env::var("PPTX_EXPORT_OUT"),
        ) else {
            return;
        };
        let only = std::env::var("PPTX_ONLY").ok();
        std::fs::create_dir_all(&out).unwrap();
        let mut names = Vec::new();
        for entry in std::fs::read_dir(directory).unwrap() {
            let path = entry.unwrap().path();
            if path.extension().and_then(|ext| ext.to_str()) != Some("pptx") {
                continue;
            }
            let stem = path.file_stem().unwrap().to_string_lossy().to_string();
            if only
                .as_deref()
                .is_some_and(|only| !only.split('|').any(|one| stem.contains(one)))
            {
                continue;
            }
            let deck = import(&path).unwrap();
            let name = stem.replace(' ', "_");
            std::fs::write(format!("{out}/{name}.json"), deck.to_string()).unwrap();
            names.push(serde_json::json!({ "name": name, "slides": deck["slides"].as_array().unwrap().len() }));
        }
        std::fs::write(
            format!("{out}/index.json"),
            serde_json::Value::Array(names).to_string(),
        )
        .unwrap();
    }

    /// Every slide of every deck in `PPTX_CORPUS` drawn by the compositor, as
    /// the screens draw it, into `PPTX_RENDER_OUT`: for looking at.
    #[test]
    #[ignore = "reads decks from PPTX_CORPUS and writes PNGs to PPTX_RENDER_OUT"]
    fn render_corpus() {
        use crate::services::compositor::{self, ScopedMediaLoader};
        use crate::services::output::OutputScene;

        let (Ok(directory), Ok(out)) = (
            std::env::var("PPTX_CORPUS"),
            std::env::var("PPTX_RENDER_OUT"),
        ) else {
            return;
        };
        let only = std::env::var("PPTX_ONLY").ok();
        std::fs::create_dir_all(&out).unwrap();
        let state =
            crate::state::FileState::load(&std::env::temp_dir().join("present-pptx-render"));
        let loader = ScopedMediaLoader::new(&state);
        for entry in std::fs::read_dir(directory).unwrap() {
            let path = entry.unwrap().path();
            if path.extension().and_then(|ext| ext.to_str()) != Some("pptx") {
                continue;
            }
            let stem = path.file_stem().unwrap().to_string_lossy().to_string();
            if only
                .as_deref()
                .is_some_and(|only| !only.split('|').any(|one| stem.contains(one)))
            {
                continue;
            }
            let deck = import(&path).unwrap();
            for (index, slide) in deck["slides"].as_array().unwrap().iter().enumerate() {
                let scene = OutputScene {
                    show_text: true,
                    presentation_slide: true,
                    slide_canvas_size: Some("1920x1080".to_owned()),
                    slide_elements: Some(slide["elements"].clone()),
                    slide_background_color: slide["backgroundColor"].as_str().map(str::to_owned),
                    ..OutputScene::default()
                };
                let (frame, _) = compositor::render(&scene, 960, 540, &loader).expect("frame");
                let rgba: Vec<u8> = frame
                    .pixmap()
                    .pixels()
                    .iter()
                    .flat_map(|pixel| {
                        let color = pixel.demultiply();
                        [color.red(), color.green(), color.blue(), color.alpha()]
                    })
                    .collect();
                let image = image::RgbaImage::from_raw(960, 540, rgba).unwrap();
                let name = format!("{out}/{}-{:02}.png", stem.replace(' ', "_"), index + 1);
                image.save(&name).unwrap();
            }
            println!("rendered {stem}");
        }
    }

    /// Every picture a deck imports is one: a background from the theme's
    /// styles once brought the slide's layout in as a picture.
    #[test]
    #[ignore = "reads decks from PPTX_CORPUS"]
    fn every_picture_imported_is_a_picture() {
        use base64::Engine;
        let Ok(directory) = std::env::var("PPTX_CORPUS") else {
            return;
        };
        for entry in std::fs::read_dir(directory).unwrap() {
            let path = entry.unwrap().path();
            if path.extension().and_then(|ext| ext.to_str()) != Some("pptx") {
                continue;
            }
            let deck = import(&path).unwrap();
            for slide in deck["slides"].as_array().unwrap() {
                for element in slide["elements"].as_array().unwrap() {
                    let Some(url) = element["content"]
                        .as_str()
                        .filter(|_| element["type"] == "image")
                    else {
                        continue;
                    };
                    let Some((_, data)) = url.split_once(";base64,") else {
                        continue;
                    };
                    let bytes = base64::engine::general_purpose::STANDARD
                        .decode(data)
                        .unwrap();
                    assert!(
                        !bytes.starts_with(b"<?xml")
                            || String::from_utf8_lossy(&bytes[..bytes.len().min(4096)])
                                .contains("<svg"),
                        "{}: {} is a part of the deck, not a picture",
                        path.display(),
                        element["id"]
                    );
                }
            }
        }
    }

    #[test]
    fn a_file_that_is_not_a_presentation_is_refused_with_a_reason() {
        let directory = std::env::temp_dir().join(format!("present-pptx-{}", std::process::id()));
        std::fs::create_dir_all(&directory).unwrap();
        let path = directory.join("not.pptx");
        std::fs::write(&path, b"plain text").unwrap();
        let error = import_for_renderer(&path).unwrap_err().to_string();
        assert!(error.contains("[pptx]"), "{error}");
        let _ = std::fs::remove_dir_all(directory);
    }
}
