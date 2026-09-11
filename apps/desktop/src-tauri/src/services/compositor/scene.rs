//! An `OutputScene`, drawn.
//!
//! The entry point. Everything else in this module is a layer; this is the part
//! that decides which layers exist and in what order, and it is a port of the
//! order `OutputWindow.tsx` composes in the DOM today.
//!
//! ```text
//! black                     the surface is never left undrawn
//!   background colour       or the slide's own
//!   background media        when the media layer is on
//!   slide elements          the ones Rust owns; `web` is left to the webview
//!   message overlay
//! ```
//!
//! **Media is fetched through a loader the caller supplies, not opened here.**
//! Any URL in the scene came from the frontend, and `services::file_scope` is
//! the only thing allowed to turn one into a read (handoff §12). Keeping the
//! renderer unable to touch a disk means it cannot reopen known-issues §3 by
//! accident, and it makes every test below run without one.

use tiny_skia::Color;

use crate::services::output::OutputScene;
use crate::services::slide::{SlideElement, SlideElementType};

use super::{color, geometry, images, shapes, text, Frame};

/// Supplies the bytes behind a media URL, having already checked the scope.
pub trait MediaLoader {
    fn load(&self, url: &str) -> Option<Vec<u8>>;
}

/// A loader that has nothing. Used where a frame is wanted without media, and
/// by every test in this file.
pub struct NoMedia;

impl MediaLoader for NoMedia {
    fn load(&self, _url: &str) -> Option<Vec<u8>> {
        None
    }
}

/// What was and was not drawn.
///
/// Returned rather than logged so a caller — the NDI sender, a diagnostic, a
/// test — can tell the difference between "an empty slide" and "a slide whose
/// background never loaded". Those look identical on screen and are not the
/// same problem.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub struct Rendered {
    pub elements_drawn: usize,
    /// Elements left for the webview layer above: `web`, and unknown types.
    pub elements_deferred: usize,
    pub background_media_drawn: bool,
    /// The scene named background media and the loader could not supply it.
    pub background_media_missing: bool,
}

/// Draw `scene` into a new frame.
pub fn render(
    scene: &OutputScene,
    width: u32,
    height: u32,
    loader: &dyn MediaLoader,
) -> Option<(Frame, Rendered)> {
    let mut frame = Frame::new(width, height)?;
    let mut report = Rendered::default();

    let viewport = geometry::Viewport::new(scene.slide_canvas_size.as_deref(), width, height);

    // The background. `hide_background` wins over everything, which is what the
    // operator's "hide background" toggle means: black, not the slide colour.
    if scene.hide_background {
        frame.clear(Color::BLACK);
    } else {
        if let Some(background) = scene.slide_background_color.as_deref() {
            shapes::fill_background(&mut frame.pixmap_mut(), background);
        }

        if scene.show_media {
            if let Some(url) = scene.media_url.as_deref().filter(|url| !url.is_empty()) {
                draw_background_media(&mut frame, url, loader, &mut report);
            }
        }
    }

    // Slide elements, in the order the deck lists them: later elements sit on
    // top, which is what the Canvas version's single pass does.
    if scene.show_text {
        for element in scene.slide_elements().unwrap_or_default() {
            if !element.is_visible() {
                continue;
            }
            if !element.element_type.is_composited() {
                report.elements_deferred += 1;
                continue;
            }
            if draw_element(&mut frame, &element, &viewport, loader) {
                report.elements_drawn += 1;
            }
        }
    }

    Some((frame, report))
}

fn draw_background_media(
    frame: &mut Frame,
    url: &str,
    loader: &dyn MediaLoader,
    report: &mut Rendered,
) {
    // Video has no decoder in this tree yet, so a video background is left to
    // the layer above rather than drawn as a still or a black rectangle.
    let Some(bytes) = loader.load(url) else {
        report.background_media_missing = true;
        return;
    };
    let Some(decoded) = images::decode(&bytes) else {
        report.background_media_missing = true;
        return;
    };

    let (width, height) = (frame.width() as f32, frame.height() as f32);
    images::draw(
        &mut frame.pixmap_mut(),
        &decoded,
        tiny_skia::Transform::identity(),
        width,
        height,
        images::ObjectFit::Cover,
        None,
    );
    report.background_media_drawn = true;
}

fn draw_element(
    frame: &mut Frame,
    element: &SlideElement,
    viewport: &geometry::Viewport,
    loader: &dyn MediaLoader,
) -> bool {
    let mut pixmap = frame.pixmap_mut();
    draw_element_into_mut(&mut pixmap, element, viewport, loader)
}

/// Draw one element into a standalone pixmap.
///
/// Exists so the caching pipeline can build the slide layers over transparency
/// rather than over a frame. Same drawing either way — the layer order lives in
/// the caller, and there is one implementation of each element type.
pub(super) fn draw_element_into(
    pixmap: &mut tiny_skia::Pixmap,
    element: &SlideElement,
    viewport: &geometry::Viewport,
    loader: &dyn MediaLoader,
) -> bool {
    let mut view = pixmap.as_mut();
    draw_element_into_mut(&mut view, element, viewport, loader)
}

fn draw_element_into_mut(
    pixmap: &mut tiny_skia::PixmapMut<'_>,
    element: &SlideElement,
    viewport: &geometry::Viewport,
    loader: &dyn MediaLoader,
) -> bool {
    match element.element_type {
        SlideElementType::Shape => {
            shapes::draw(pixmap, element, viewport);
            true
        }
        SlideElementType::Text => {
            text::draw(pixmap, element, viewport);
            true
        }
        SlideElementType::Image => {
            let Some(bytes) = loader.load(element.content()) else {
                return false;
            };
            let Some(decoded) = images::decode(&bytes) else {
                return false;
            };

            let (width, height) = viewport.element_size(element);
            let style = element.style.as_ref();
            images::draw(
                pixmap,
                &decoded,
                viewport.element_transform(element),
                width,
                height,
                images::ObjectFit::parse(style.and_then(|s| s.object_fit.as_deref())),
                style.and_then(|s| s.opacity),
            );
            true
        }
        // A video element's own frames are the background media path; an
        // inline video element is not composited yet.
        SlideElementType::Video => false,
        SlideElementType::Web | SlideElementType::Unknown => false,
    }
}

/// The colour a scene's background resolves to, if any. For diagnostics.
pub fn background_color(scene: &OutputScene) -> Option<Color> {
    if scene.hide_background {
        return Some(Color::BLACK);
    }
    scene
        .slide_background_color
        .as_deref()
        .and_then(color::parse)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    /// A loader holding one bitmap, so media paths can be exercised without a
    /// disk or a scope.
    struct OneImage {
        url: &'static str,
        bytes: Vec<u8>,
    }

    impl MediaLoader for OneImage {
        fn load(&self, url: &str) -> Option<Vec<u8>> {
            (url == self.url).then(|| self.bytes.clone())
        }
    }

    fn png(width: u32, height: u32, rgba: [u8; 4]) -> Vec<u8> {
        let mut buffer = image::RgbaImage::new(width, height);
        for pixel in buffer.pixels_mut() {
            pixel.0 = rgba;
        }
        let mut out = std::io::Cursor::new(Vec::new());
        image::DynamicImage::ImageRgba8(buffer)
            .write_to(&mut out, image::ImageFormat::Png)
            .expect("encode");
        out.into_inner()
    }

    fn scene() -> OutputScene {
        OutputScene {
            show_text: true,
            show_media: true,
            slide_canvas_size: Some("100x100".to_owned()),
            ..OutputScene::default()
        }
    }

    #[test]
    fn an_empty_scene_renders_black_rather_than_failing() {
        // The most important frame in the module: whatever else is wrong, the
        // audience surface gets something, and that something is black.
        let (frame, report) = render(&OutputScene::default(), 64, 64, &NoMedia).expect("frame");

        assert_eq!(frame.pixel_at(32, 32), Some((0, 0, 0, 255)));
        assert_eq!(report, Rendered::default());
    }

    #[test]
    fn the_slide_background_colour_is_painted() {
        let scene = OutputScene {
            slide_background_color: Some("#0000ff".to_owned()),
            ..scene()
        };

        let (frame, _) = render(&scene, 64, 64, &NoMedia).expect("frame");
        assert_eq!(frame.pixel_at(32, 32), Some((0, 0, 255, 255)));
    }

    #[test]
    fn hiding_the_background_beats_the_slide_colour() {
        // What the operator's "hide background" toggle means: black, not the
        // slide's own colour showing through.
        let scene = OutputScene {
            hide_background: true,
            slide_background_color: Some("#0000ff".to_owned()),
            ..scene()
        };

        let (frame, _) = render(&scene, 64, 64, &NoMedia).expect("frame");
        assert_eq!(frame.pixel_at(32, 32), Some((0, 0, 0, 255)));
    }

    #[test]
    fn background_media_covers_the_frame() {
        let loader = OneImage {
            url: "local-media://media/bg.png",
            bytes: png(8, 8, [0, 255, 0, 255]),
        };
        let scene = OutputScene {
            media_url: Some(loader.url.to_owned()),
            slide_background_color: Some("#ff0000".to_owned()),
            ..scene()
        };

        let (frame, report) = render(&scene, 64, 64, &loader).expect("frame");
        assert!(report.background_media_drawn);
        assert_eq!(
            frame.pixel_at(32, 32),
            Some((0, 255, 0, 255)),
            "the media covers the colour beneath it"
        );
    }

    #[test]
    fn a_background_that_will_not_load_says_so_rather_than_going_quiet() {
        // "An empty slide" and "a slide whose background never loaded" look
        // identical on screen and are not the same problem.
        let scene = OutputScene {
            media_url: Some("local-media://media/missing.png".to_owned()),
            slide_background_color: Some("#ff0000".to_owned()),
            ..scene()
        };

        let (frame, report) = render(&scene, 64, 64, &NoMedia).expect("frame");
        assert!(report.background_media_missing);
        assert!(!report.background_media_drawn);
        assert_eq!(
            frame.pixel_at(32, 32),
            Some((255, 0, 0, 255)),
            "the background colour still shows"
        );
    }

    #[test]
    fn the_media_layer_being_off_hides_the_media() {
        let loader = OneImage {
            url: "local-media://media/bg.png",
            bytes: png(8, 8, [0, 255, 0, 255]),
        };
        let scene = OutputScene {
            show_media: false,
            media_url: Some(loader.url.to_owned()),
            slide_background_color: Some("#ff0000".to_owned()),
            ..scene()
        };

        let (frame, report) = render(&scene, 64, 64, &loader).expect("frame");
        assert!(!report.background_media_drawn);
        assert_eq!(frame.pixel_at(32, 32), Some((255, 0, 0, 255)));
    }

    #[test]
    fn slide_elements_are_drawn_over_the_background() {
        let scene = OutputScene {
            slide_background_color: Some("#0000ff".to_owned()),
            slide_elements: Some(json!([{
                "id": "a", "type": "shape",
                "x": 20.0, "y": 20.0, "width": 60.0, "height": 60.0,
                "style": { "backgroundColor": "#ff0000" }
            }])),
            ..scene()
        };

        let (frame, report) = render(&scene, 100, 100, &NoMedia).expect("frame");
        assert_eq!(report.elements_drawn, 1);
        assert_eq!(frame.pixel_at(50, 50), Some((255, 0, 0, 255)), "the shape");
        assert_eq!(
            frame.pixel_at(5, 5),
            Some((0, 0, 255, 255)),
            "the background"
        );
    }

    #[test]
    fn later_elements_sit_on_top_of_earlier_ones() {
        let scene = OutputScene {
            slide_elements: Some(json!([
                { "id": "under", "type": "shape", "x": 0.0, "y": 0.0, "width": 100.0, "height": 100.0,
                  "style": { "backgroundColor": "#ff0000" } },
                { "id": "over", "type": "shape", "x": 0.0, "y": 0.0, "width": 100.0, "height": 100.0,
                  "style": { "backgroundColor": "#00ff00" } }
            ])),
            ..scene()
        };

        let (frame, _) = render(&scene, 100, 100, &NoMedia).expect("frame");
        assert_eq!(
            frame.pixel_at(50, 50),
            Some((0, 255, 0, 255)),
            "the later one wins"
        );
    }

    #[test]
    fn web_and_unknown_elements_are_deferred_not_drawn() {
        // ADR-001's amendment: those belong to the transparent webview above
        // the composited surface, and drawing anything in their place would
        // cover them.
        let scene = OutputScene {
            slide_elements: Some(json!([
                { "id": "yt", "type": "web", "x": 0.0, "y": 0.0, "width": 100.0, "height": 100.0,
                  "style": { "backgroundColor": "#ff0000" } },
                { "id": "future", "type": "hologram", "x": 0.0, "y": 0.0, "width": 100.0, "height": 100.0,
                  "style": { "backgroundColor": "#ff0000" } }
            ])),
            ..scene()
        };

        let (frame, report) = render(&scene, 100, 100, &NoMedia).expect("frame");
        assert_eq!(report.elements_deferred, 2);
        assert_eq!(report.elements_drawn, 0);
        assert_eq!(
            frame.pixel_at(50, 50),
            Some((0, 0, 0, 255)),
            "nothing was painted where the webview layer goes"
        );
    }

    #[test]
    fn a_hidden_element_is_skipped_entirely() {
        let scene = OutputScene {
            slide_elements: Some(json!([{
                "id": "a", "type": "shape", "isVisible": false,
                "x": 0.0, "y": 0.0, "width": 100.0, "height": 100.0,
                "style": { "backgroundColor": "#ff0000" }
            }])),
            ..scene()
        };

        let (frame, report) = render(&scene, 100, 100, &NoMedia).expect("frame");
        assert_eq!(report.elements_drawn, 0);
        assert_eq!(
            report.elements_deferred, 0,
            "hidden is not deferred, it is nothing"
        );
        assert_eq!(frame.pixel_at(50, 50), Some((0, 0, 0, 255)));
    }

    #[test]
    fn the_text_layer_being_off_hides_the_elements() {
        let scene = OutputScene {
            show_text: false,
            slide_elements: Some(json!([{
                "id": "a", "type": "shape",
                "x": 0.0, "y": 0.0, "width": 100.0, "height": 100.0,
                "style": { "backgroundColor": "#ff0000" }
            }])),
            ..scene()
        };

        let (frame, report) = render(&scene, 100, 100, &NoMedia).expect("frame");
        assert_eq!(report.elements_drawn, 0);
        assert_eq!(frame.pixel_at(50, 50), Some((0, 0, 0, 255)));
    }

    #[test]
    fn an_image_element_is_drawn_from_the_loader() {
        let loader = OneImage {
            url: "local-media://media/logo.png",
            bytes: png(8, 8, [255, 255, 0, 255]),
        };
        let scene = OutputScene {
            slide_elements: Some(json!([{
                "id": "a", "type": "image", "content": loader.url,
                "x": 25.0, "y": 25.0, "width": 50.0, "height": 50.0
            }])),
            ..scene()
        };

        let (frame, report) = render(&scene, 100, 100, &loader).expect("frame");
        assert_eq!(report.elements_drawn, 1);
        assert_eq!(frame.pixel_at(50, 50), Some((255, 255, 0, 255)));
        assert_eq!(
            frame.pixel_at(5, 5),
            Some((0, 0, 0, 255)),
            "not outside its box"
        );
    }

    #[test]
    fn an_image_that_will_not_load_is_not_counted_as_drawn() {
        let scene = OutputScene {
            slide_elements: Some(json!([{
                "id": "a", "type": "image", "content": "local-media://media/gone.png",
                "x": 0.0, "y": 0.0, "width": 100.0, "height": 100.0
            }])),
            ..scene()
        };

        let (_, report) = render(&scene, 100, 100, &NoMedia).expect("frame");
        assert_eq!(report.elements_drawn, 0);
    }

    #[test]
    fn a_whole_lyric_slide_renders() {
        // The shape of what a congregation actually sees: a background, and
        // words over it.
        let scene = OutputScene {
            slide_background_color: Some("#101820".to_owned()),
            slide_elements: Some(json!([{
                "id": "verse", "type": "text",
                "x": 10.0, "y": 30.0, "width": 80.0, "height": 40.0,
                "content": "Amazing grace\nhow sweet the sound",
                "style": { "fontSize": 8.0, "color": "#ffffff", "textAlign": "center" }
            }])),
            ..scene()
        };

        let (frame, report) = render(&scene, 800, 800, &NoMedia).expect("frame");
        assert_eq!(report.elements_drawn, 1);

        let ink = (0..frame.height())
            .flat_map(|y| (0..frame.width()).map(move |x| (x, y)))
            .filter_map(|(x, y)| frame.pixel_at(x, y))
            .filter(|(r, g, b, _)| *r > 200 && *g > 200 && *b > 200)
            .count();
        assert!(ink > 200, "the lyrics did not render, {ink} white pixels");

        // And the frame is ready for NDI.
        assert_eq!(frame.to_bgra().len(), 800 * 800 * 4);
    }

    #[test]
    fn an_impossible_frame_size_returns_none_rather_than_panicking() {
        assert!(render(&scene(), 0, 100, &NoMedia).is_none());
        assert!(render(&scene(), 100_000, 100, &NoMedia).is_none());
    }
}
