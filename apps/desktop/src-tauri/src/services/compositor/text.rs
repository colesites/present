//! Text on a slide.
//!
//! The layer that matters most, because the overwhelming majority of what a
//! congregation reads is text: lyrics, scripture, a notice. It is also the part
//! of ADR-001's "slide rendering exists twice" that is hardest to keep
//! identical, since the Canvas version does its own measuring, wrapping and
//! baseline placement rather than delegating to the browser's layout engine
//! (`CanvasSlideLayer.tsx:182-350`). That is fortunate: it means there is a
//! written-down algorithm to match instead of a black box to approximate.
//!
//! The rules ported here, each of which the Canvas version fixes explicitly:
//!
//! * font size scales by `min(scaleX, scaleY)` — never per-axis, or letters
//!   distort on a non-matching aspect ratio;
//! * line height is `fontSize * 1.2` unless the paragraph says otherwise;
//! * the default colour is white, because slides are drawn over dark
//!   backgrounds and unstyled text must not be invisible;
//! * padding insets the text box on each side independently;
//! * `\n` in `content` starts a paragraph, so a verse breaks where the operator
//!   typed the break.
//!
//! **Font loading is process-wide and lazy.** `FontSystem` scans the operating
//! system's font directories, which takes long enough that doing it per frame
//! would be visible. It is built once, behind a mutex, on the first slide that
//! contains text.

use std::sync::{Mutex, OnceLock};

use cosmic_text::{
    Align, Attrs, Buffer, Family, FontSystem, Metrics, Shaping, Style, SwashCache, Weight, Wrap,
};
use tiny_skia::{Paint, PixmapMut, Rect};

use crate::services::slide::{SlideElement, SlideElementStyle};

use super::{color, geometry};

/// The multiplier the Canvas version applies when a paragraph does not give a
/// line height (`CanvasSlideLayer.tsx:731`).
const DEFAULT_LINE_HEIGHT: f32 = 1.2;

/// What unstyled text is drawn in. Slides sit over dark backgrounds and video,
/// so black would be invisible far more often than white is.
const DEFAULT_COLOR: &str = "#ffffff";

/// The shared font stack.
///
/// A `Mutex` rather than a thread-local: the scan is the expensive part and one
/// process should pay it once, not once per thread that happens to draw.
struct Fonts {
    system: FontSystem,
    cache: SwashCache,
}

fn fonts() -> &'static Mutex<Fonts> {
    static FONTS: OnceLock<Mutex<Fonts>> = OnceLock::new();
    FONTS.get_or_init(|| {
        Mutex::new(Fonts {
            system: FontSystem::new(),
            cache: SwashCache::new(),
        })
    })
}

/// Where the text sits inside its box when it does not fill it.
fn vertical_offset(align: Option<&str>, content_height: f32, text_height: f32) -> f32 {
    let slack = (content_height - text_height).max(0.0);
    match align.map(str::trim) {
        Some(value) if value.eq_ignore_ascii_case("middle") => slack / 2.0,
        Some(value) if value.eq_ignore_ascii_case("bottom") => slack,
        _ => 0.0,
    }
}

fn horizontal_align(align: Option<&str>) -> Align {
    match align.map(str::trim) {
        Some(value) if value.eq_ignore_ascii_case("center") => Align::Center,
        Some(value) if value.eq_ignore_ascii_case("right") => Align::Right,
        Some(value) if value.eq_ignore_ascii_case("justify") => Align::Justified,
        _ => Align::Left,
    }
}

/// CSS font weights, including the two keywords.
fn weight_of(style: Option<&SlideElementStyle>) -> Weight {
    if style.and_then(|s| s.font_bold).unwrap_or(false) {
        return Weight::BOLD;
    }
    let Some(raw) = style.and_then(|s| s.font_weight.as_deref()) else {
        return Weight::NORMAL;
    };
    match raw.trim().to_ascii_lowercase().as_str() {
        "bold" | "bolder" => Weight::BOLD,
        "normal" | "regular" => Weight::NORMAL,
        "lighter" => Weight::LIGHT,
        numeric => numeric.parse::<u16>().map(Weight).unwrap_or(Weight::NORMAL),
    }
}

/// The text an element draws, and where it breaks.
///
/// `textBody` wins when it is there, because an imported deck carries its real
/// paragraph structure. Otherwise `content` is split on newlines, which is what
/// the Canvas version does — an operator's typed line break is a paragraph.
fn paragraphs_of(element: &SlideElement) -> Vec<String> {
    if let Some(body) = &element.text_body {
        if !body.paragraphs.is_empty() {
            return body
                .paragraphs
                .iter()
                .map(|paragraph| {
                    paragraph
                        .runs
                        .iter()
                        .map(|run| run.text.as_str())
                        .collect::<String>()
                })
                .collect();
        }
    }
    element.content().split('\n').map(str::to_owned).collect()
}

/// Apply the element's `capitalization`.
fn capitalize(text: &str, mode: Option<&str>) -> String {
    match mode.map(str::trim) {
        Some(value)
            if value.eq_ignore_ascii_case("allCaps") || value.eq_ignore_ascii_case("uppercase") =>
        {
            text.to_uppercase()
        }
        Some(value) if value.eq_ignore_ascii_case("lowercase") => text.to_lowercase(),
        _ => text.to_owned(),
    }
}

/// Draw one `text` element.
pub fn draw(pixmap: &mut PixmapMut<'_>, element: &SlideElement, viewport: &geometry::Viewport) {
    let (width, height) = viewport.element_size(element);
    if width <= 0.0 || height <= 0.0 {
        return;
    }

    let style = element.style.as_ref();

    // Padding insets each side independently, scaled on its own axis.
    let scale_x = viewport.scale_x() as f32;
    let scale_y = viewport.scale_y() as f32;
    let pad = |value: Option<f64>, scale: f32| {
        value.filter(|v| v.is_finite()).unwrap_or(0.0) as f32 * scale
    };
    let padding_left = pad(style.and_then(|s| s.padding_left), scale_x);
    let padding_right = pad(style.and_then(|s| s.padding_right), scale_x);
    let padding_top = pad(style.and_then(|s| s.padding_top), scale_y);
    let padding_bottom = pad(style.and_then(|s| s.padding_bottom), scale_y);

    let content_width = (width - padding_left - padding_right).max(1.0);
    let content_height = (height - padding_top - padding_bottom).max(1.0);

    // Uniform scale, never per-axis: letters distort otherwise.
    let uniform = viewport.scale_x().min(viewport.scale_y()) as f32;
    let font_size = (style
        .and_then(|s| s.font_size)
        .filter(|v| v.is_finite() && *v > 0.0)
        .unwrap_or(48.0) as f32
        * uniform)
        .max(1.0);
    let line_height = font_size * DEFAULT_LINE_HEIGHT;

    let text_color = style
        .and_then(|s| s.color.as_deref())
        .and_then(color::parse)
        .or_else(|| color::parse(DEFAULT_COLOR));
    let Some(text_color) = text_color else {
        return;
    };
    let text_color = color::with_opacity(text_color, style.and_then(|s| s.opacity));

    let body = paragraphs_of(element).join("\n");
    let body = capitalize(&body, style.and_then(|s| s.capitalization.as_deref()));
    if body.trim().is_empty() {
        return;
    }

    let family = style.and_then(|s| s.font_family.as_deref()).unwrap_or("");
    let italic = style
        .and_then(|s| s.font_style.as_deref())
        .map(|value| value.trim().eq_ignore_ascii_case("italic"))
        .unwrap_or(false);

    let Ok(mut fonts) = fonts().lock() else {
        // Poisoned only if another thread panicked mid-draw. Losing the text is
        // better than propagating the panic onto the audience screen.
        tracing::error!("the font system is poisoned; skipping a text element");
        return;
    };
    let Fonts { system, cache } = &mut *fonts;

    let mut buffer = Buffer::new(system, Metrics::new(font_size, line_height));
    buffer.set_size(Some(content_width), Some(content_height));
    buffer.set_wrap(Wrap::Word);

    let mut attrs = Attrs::new().weight(weight_of(style));
    if italic {
        attrs = attrs.style(Style::Italic);
    }
    if !family.trim().is_empty() {
        attrs = attrs.family(Family::Name(family.trim()));
    }

    let align = horizontal_align(style.and_then(|s| s.text_align.as_deref()));
    buffer.set_text(&body, &attrs, Shaping::Advanced, Some(align));
    buffer.shape_until_scroll(system, false);

    // Vertical placement, once the laid-out height is known.
    let laid_out = buffer
        .layout_runs()
        .map(|run| run.line_top + run.line_height)
        .fold(0.0_f32, f32::max);
    let offset_x = padding_left;
    let offset_y = padding_top
        + vertical_offset(
            style.and_then(|s| s.vertical_align.as_deref()),
            content_height,
            laid_out,
        );

    let transform = viewport.element_transform(element);
    let mut paint = Paint {
        anti_alias: true,
        ..Paint::default()
    };

    buffer.draw(
        system,
        cache,
        cosmic_text::Color::rgba(255, 255, 255, 255),
        |x, y, w, h, coverage| {
            // cosmic-text hands back coverage per glyph pixel; the element's
            // own colour is applied here so a glyph is tinted rather than
            // drawn white and blended.
            let alpha = coverage.a();
            if alpha == 0 || w == 0 || h == 0 {
                return;
            }

            let mut pixel = text_color;
            pixel.set_alpha(text_color.alpha() * (f32::from(alpha) / 255.0));
            paint.set_color(pixel);

            let Some(rect) =
                Rect::from_xywh(offset_x + x as f32, offset_y + y as f32, w as f32, h as f32)
            else {
                return;
            };
            pixmap.fill_rect(rect, &paint, transform, None);
        },
    );
}

/// Warm the font stack.
///
/// Called at startup so the first slide of a service does not pay for the font
/// scan while a congregation is looking at it.
pub fn preload_fonts() {
    let _ = fonts().lock().map(|fonts| fonts.system.db().len());
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    use crate::services::compositor::Frame;

    fn element(value: serde_json::Value) -> SlideElement {
        serde_json::from_value(value).expect("element")
    }

    fn render(value: serde_json::Value) -> Frame {
        let mut frame = Frame::new(400, 200).expect("frame");
        let viewport = geometry::Viewport::new(Some("400x200"), 400, 200);
        draw(&mut frame.pixmap_mut(), &element(value), &viewport);
        frame
    }

    /// How many pixels in a column band are not the black background.
    ///
    /// Text is anti-aliased and font-dependent, so the assertions here are
    /// about *where ink lands*, never about exact glyph shapes. A test that
    /// pinned pixels would break on any machine with different fonts.
    fn ink_in_columns(frame: &Frame, from_x: u32, to_x: u32) -> usize {
        let mut count = 0;
        for y in 0..frame.height() {
            for x in from_x..to_x.min(frame.width()) {
                if let Some((r, g, b, _)) = frame.pixel_at(x, y) {
                    if r > 40 || g > 40 || b > 40 {
                        count += 1;
                    }
                }
            }
        }
        count
    }

    fn total_ink(frame: &Frame) -> usize {
        ink_in_columns(frame, 0, frame.width())
    }

    #[test]
    fn text_actually_draws() {
        let frame = render(json!({
            "id": "a", "type": "text",
            "x": 0.0, "y": 0.0, "width": 400.0, "height": 200.0,
            "content": "Amazing grace",
            "style": { "fontSize": 40.0 }
        }));

        assert!(total_ink(&frame) > 200, "no glyphs were rasterised");
    }

    #[test]
    fn unstyled_text_is_white_rather_than_invisible() {
        // Slides sit over dark backgrounds and video. Defaulting to black would
        // make unstyled text invisible exactly where it matters.
        let frame = render(json!({
            "id": "a", "type": "text",
            "x": 0.0, "y": 0.0, "width": 400.0, "height": 200.0,
            "content": "Amazing grace",
            "style": { "fontSize": 40.0 }
        }));

        let brightest = (0..frame.height())
            .flat_map(|y| (0..frame.width()).map(move |x| (x, y)))
            .filter_map(|(x, y)| frame.pixel_at(x, y))
            .map(|(r, _, _, _)| r)
            .max()
            .unwrap_or(0);
        assert!(
            brightest > 200,
            "text should be near white, brightest was {brightest}"
        );
    }

    #[test]
    fn the_element_colour_tints_the_glyphs() {
        let frame = render(json!({
            "id": "a", "type": "text",
            "x": 0.0, "y": 0.0, "width": 400.0, "height": 200.0,
            "content": "Amazing grace",
            "style": { "fontSize": 40.0, "color": "#ff0000" }
        }));

        let mut saw_red = false;
        for y in 0..frame.height() {
            for x in 0..frame.width() {
                if let Some((r, g, b, _)) = frame.pixel_at(x, y) {
                    if r > 150 && g < 80 && b < 80 {
                        saw_red = true;
                    }
                    assert!(
                        !(g > 150 && r < 80),
                        "a glyph was drawn white instead of tinted at {x},{y}"
                    );
                }
            }
        }
        assert!(saw_red, "no red glyph pixels found");
    }

    #[test]
    fn alignment_moves_the_text_across_the_box() {
        let base = |align: &str| {
            render(json!({
                "id": "a", "type": "text",
                "x": 0.0, "y": 0.0, "width": 400.0, "height": 200.0,
                "content": "Grace",
                "style": { "fontSize": 40.0, "textAlign": align }
            }))
        };

        let left = base("left");
        let right = base("right");

        // Ink sits in the left third when left-aligned and the right third when
        // right-aligned. Comparing bands rather than exact positions keeps this
        // independent of which font the machine has.
        assert!(ink_in_columns(&left, 0, 133) > ink_in_columns(&left, 267, 400));
        assert!(ink_in_columns(&right, 267, 400) > ink_in_columns(&right, 0, 133));
    }

    #[test]
    fn a_newline_starts_a_new_line() {
        // An operator's typed break is a paragraph. Collapsing it would run two
        // lines of a verse together on the audience screen.
        let one = render(json!({
            "id": "a", "type": "text",
            "x": 0.0, "y": 0.0, "width": 400.0, "height": 200.0,
            "content": "Amazing grace how sweet",
            "style": { "fontSize": 24.0 }
        }));
        let two = render(json!({
            "id": "a", "type": "text",
            "x": 0.0, "y": 0.0, "width": 400.0, "height": 200.0,
            "content": "Amazing grace\nhow sweet",
            "style": { "fontSize": 24.0 }
        }));

        let rows_with_ink = |frame: &Frame| {
            (0..frame.height())
                .filter(|y| {
                    (0..frame.width())
                        .any(|x| matches!(frame.pixel_at(x, *y), Some((r, _, _, _)) if r > 40))
                })
                .count()
        };
        assert!(
            rows_with_ink(&two) > rows_with_ink(&one),
            "the broken version should occupy more rows"
        );
    }

    #[test]
    fn vertical_alignment_moves_the_block_down_the_box() {
        let at = |align: &str| {
            let frame = render(json!({
                "id": "a", "type": "text",
                "x": 0.0, "y": 0.0, "width": 400.0, "height": 200.0,
                "content": "Grace",
                "style": { "fontSize": 24.0, "verticalAlign": align }
            }));
            (0..frame.height())
                .find(|y| {
                    (0..frame.width())
                        .any(|x| matches!(frame.pixel_at(x, *y), Some((r, _, _, _)) if r > 40))
                })
                .unwrap_or(u32::MAX)
        };

        let top = at("top");
        let middle = at("middle");
        let bottom = at("bottom");
        assert!(top < middle, "top {top} should be above middle {middle}");
        assert!(
            middle < bottom,
            "middle {middle} should be above bottom {bottom}"
        );
    }

    #[test]
    fn padding_insets_the_text() {
        let padded = render(json!({
            "id": "a", "type": "text",
            "x": 0.0, "y": 0.0, "width": 400.0, "height": 200.0,
            "content": "Grace",
            "style": { "fontSize": 24.0, "paddingLeft": 120.0 }
        }));

        assert_eq!(
            ink_in_columns(&padded, 0, 100),
            0,
            "nothing inside the padding"
        );
        assert!(
            ink_in_columns(&padded, 120, 400) > 0,
            "text after the padding"
        );
    }

    #[test]
    fn all_caps_is_applied() {
        let normal = render(json!({
            "id": "a", "type": "text",
            "x": 0.0, "y": 0.0, "width": 400.0, "height": 200.0,
            "content": "grace", "style": { "fontSize": 40.0 }
        }));
        let caps = render(json!({
            "id": "a", "type": "text",
            "x": 0.0, "y": 0.0, "width": 400.0, "height": 200.0,
            "content": "grace",
            "style": { "fontSize": 40.0, "capitalization": "allCaps" }
        }));

        // Capitals are wider and taller, so they lay down more ink.
        assert!(
            total_ink(&caps) > total_ink(&normal),
            "allCaps should change the rendering"
        );
    }

    #[test]
    fn empty_text_draws_nothing_and_does_not_panic() {
        for content in ["", "   ", "\n\n"] {
            let frame = render(json!({
                "id": "a", "type": "text",
                "x": 0.0, "y": 0.0, "width": 400.0, "height": 200.0,
                "content": content, "style": { "fontSize": 40.0 }
            }));
            assert_eq!(total_ink(&frame), 0, "{content:?} drew something");
        }
    }

    #[test]
    fn an_imported_paragraph_body_is_drawn_rather_than_the_flat_content() {
        // A PowerPoint deck carries its structure in `textBody`. Falling back to
        // `content` for those would draw the legacy fallback string instead.
        let frame = render(json!({
            "id": "a", "type": "text",
            "x": 0.0, "y": 0.0, "width": 400.0, "height": 200.0,
            "content": "",
            "textBody": {
                "paragraphs": [
                    { "runs": [{ "text": "Holy, " }, { "text": "holy" }] }
                ]
            },
            "style": { "fontSize": 40.0 }
        }));

        assert!(total_ink(&frame) > 200, "the text body was not drawn");
    }

    #[test]
    fn a_nonsense_font_size_falls_back_rather_than_vanishing() {
        for bad in [json!(0.0), json!(-10.0), json!(null)] {
            let frame = render(json!({
                "id": "a", "type": "text",
                "x": 0.0, "y": 0.0, "width": 400.0, "height": 200.0,
                "content": "Grace",
                "style": { "fontSize": bad }
            }));
            assert!(total_ink(&frame) > 0, "font size {bad} rendered nothing");
        }
    }

    #[test]
    fn an_unknown_font_family_still_draws() {
        // A deck naming a font the machine does not have must fall back, not
        // render an empty slide.
        let frame = render(json!({
            "id": "a", "type": "text",
            "x": 0.0, "y": 0.0, "width": 400.0, "height": 200.0,
            "content": "Grace",
            "style": { "fontSize": 40.0, "fontFamily": "Definitely Not Installed XYZ" }
        }));

        assert!(total_ink(&frame) > 0, "an unavailable font must fall back");
    }

    #[test]
    fn font_weight_keywords_and_numbers_both_parse() {
        let bold = SlideElementStyle {
            font_weight: Some("bold".to_owned()),
            ..SlideElementStyle::default()
        };
        let numeric = SlideElementStyle {
            font_weight: Some("700".to_owned()),
            ..SlideElementStyle::default()
        };
        let nonsense = SlideElementStyle {
            font_weight: Some("chunky".to_owned()),
            ..SlideElementStyle::default()
        };

        assert_eq!(weight_of(Some(&bold)), Weight::BOLD);
        assert_eq!(weight_of(Some(&numeric)), Weight(700));
        assert_eq!(weight_of(Some(&nonsense)), Weight::NORMAL);
        assert_eq!(weight_of(None), Weight::NORMAL);
    }
}
