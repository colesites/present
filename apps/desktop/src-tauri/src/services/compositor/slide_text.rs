//! Slide text that is not a slide element: scripture, and a library slide
//! with no authored elements.
//!
//! The audience window draws both without elements, so a compositor that only
//! draws elements drew neither — every Bible verse was missing from the stream
//! (known-issues §14). The window chooses between them in `OutputWindow.tsx`:
//!
//! ```text
//! show text ─┬─ scripture: id, no elements, some text ─► ScriptureTextLayer
//!            └─ otherwise ─► CanvasSlideLayer ─┬─ visible elements ─► the elements
//!                                               └─ none, some text  ─► one line of text
//! ```
//!
//! **Pixels here are CSS pixels.** Both layers are laid out in the audience
//! window's viewport, and the frame is taken to be that viewport — true for a
//! 1920×1080 output on a 1920×1080 projector, which is the configuration this
//! app ships with by default.

use cosmic_text::{Align, Weight};
use tiny_skia::{Color, PixmapMut};

use crate::services::output::{LibraryStyle, OutputScene, ScriptureStyle};

use super::geometry::Viewport;
use super::text::{self, Shadow, TextStyle};

/// `p-12`.
pub const SCRIPTURE_PADDING: f32 = 48.0;
/// `leading-relaxed`.
pub const SCRIPTURE_LINE_HEIGHT: f32 = 1.625;
/// The footer's `mt-4`.
pub const FOOTER_GAP: f32 = 16.0;
/// Preflight's `html { line-height: 1.5 }`, which the footer inherits.
pub const FOOTER_LINE_HEIGHT: f32 = 1.5;
/// `tracking-wide`.
pub const FOOTER_LETTER_SPACING_EM: f32 = 0.025;

/// `AutoFitText`'s search: ten halvings between 10 px and 500 px.
pub const FIT_MIN: f32 = 10.0;
pub const FIT_MAX: f32 = 500.0;
pub const FIT_ITERATIONS: usize = 10;

/// `drop-shadow-[0_2px_4px_rgba(0,0,0,0.8)]` on the verse. A CSS shadow's blur
/// length is twice the Gaussian's deviation.
fn verse_shadow() -> Shadow {
    Shadow {
        dx: 0.0,
        dy: 2.0,
        sigma: 2.0,
        color: Color::from_rgba8(0, 0, 0, 204),
    }
}

/// Tailwind 4's `drop-shadow-md` on the footer: `0 3px 3px rgb(0 0 0 / 0.12)`.
fn footer_shadow() -> Shadow {
    Shadow {
        dx: 0.0,
        dy: 3.0,
        sigma: 1.5,
        color: Color::from_rgba8(0, 0, 0, 31),
    }
}

/// What the window draws when a scene arrives without a style. The initial
/// state in `OutputWindow.tsx`.
fn default_scripture_style() -> ScriptureStyle {
    ScriptureStyle {
        font_size: 96.0,
        footer_font_size: 70.0,
        font_family: "Inter".to_owned(),
        font_weight: "400".to_owned(),
        text_align: "left".to_owned(),
        vertical_align: "middle".to_owned(),
        footer_align: "center".to_owned(),
        footer_position: "bottom".to_owned(),
    }
}

fn default_library_style() -> LibraryStyle {
    LibraryStyle {
        font_family: "Inter".to_owned(),
        font_size: 72.0,
        font_bold: false,
        font_italic: false,
        font_underline: false,
    }
}

/// Which of the two layers, if either, a scene's text goes through.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SlideTextLayer {
    Scripture,
    /// One centred line: visible elements are none, and there is text.
    PlainText,
    /// The elements, or nothing.
    Elements,
}

pub fn layer_for(scene: &OutputScene) -> SlideTextLayer {
    let has_text = scene
        .slide_text
        .as_deref()
        .is_some_and(|text| !text.trim().is_empty());
    let elements = scene.slide_elements().unwrap_or_default();

    // `renderableSlideElements` is the array before visibility is considered.
    let is_scripture = scene
        .active_slide_id
        .as_deref()
        .is_some_and(|id| id.starts_with("scripture:"));
    if is_scripture && elements.is_empty() && has_text {
        return SlideTextLayer::Scripture;
    }

    // `CanvasSlideLayer` falls back to the text when no element is visible,
    // whatever types the hidden ones were.
    if has_text && !elements.iter().any(|element| element.is_visible()) {
        return SlideTextLayer::PlainText;
    }
    SlideTextLayer::Elements
}

/// `AutoFitText`'s search, over a measurement of the text at a size.
///
/// `fits(size)` answers whether text set at `size` fits. The result is capped at
/// `max_font_size` when that is a positive number — a `0` or `NaN` cap is falsy
/// in the JavaScript and caps nothing.
pub fn fit_font_size(fits: impl Fn(f32) -> bool, max_font_size: f32) -> f32 {
    let (mut low, mut high, mut best) = (FIT_MIN, FIT_MAX, FIT_MIN);
    for _ in 0..FIT_ITERATIONS {
        let middle = (low + high) / 2.0;
        if fits(middle) {
            best = middle;
            low = middle;
        } else {
            high = middle;
        }
    }
    let capped = if max_font_size > 0.0 && best > max_font_size {
        max_font_size
    } else {
        best
    };
    capped.max(1.0)
}

/// CSS `white-space: pre-line`: runs of spaces and tabs collapse to one, spaces
/// either side of a line break go, and the line breaks stay.
pub fn pre_line(text: &str) -> String {
    text.replace("\r\n", "\n")
        .split('\n')
        .map(|line| {
            line.split([' ', '\t'])
                .filter(|word| !word.is_empty())
                .collect::<Vec<_>>()
                .join(" ")
        })
        .collect::<Vec<_>>()
        .join("\n")
}

fn align_of(value: &str) -> Align {
    match value.trim() {
        "center" => Align::Center,
        "right" => Align::Right,
        _ => Align::Left,
    }
}

fn weight_of(value: &str) -> Weight {
    match value.trim().to_ascii_lowercase().as_str() {
        "bold" => Weight::BOLD,
        "normal" | "" => Weight::NORMAL,
        numeric => numeric.parse::<u16>().map(Weight).unwrap_or(Weight::NORMAL),
    }
}

/// Where a block of `text_height` sits in a box of `box_height`.
fn vertical_start(align: &str, box_height: f32, text_height: f32) -> f32 {
    match align.trim() {
        "top" => 0.0,
        "bottom" => box_height - text_height,
        // The layer maps anything but top and bottom to centre.
        _ => (box_height - text_height) / 2.0,
    }
}

/// `ScriptureTextLayer`, in a frame taken to be the audience window.
pub fn draw_scripture(
    pixmap: &mut PixmapMut<'_>,
    text: &str,
    footer: Option<&str>,
    style: Option<&ScriptureStyle>,
) {
    let fallback = default_scripture_style();
    let style = style.unwrap_or(&fallback);
    let (frame_width, frame_height) = (pixmap.width() as f32, pixmap.height() as f32);
    let content_x = SCRIPTURE_PADDING;
    let content_width = (frame_width - SCRIPTURE_PADDING * 2.0).max(1.0);
    let mut body_top = SCRIPTURE_PADDING;
    let mut body_height = (frame_height - SCRIPTURE_PADDING * 2.0).max(0.0);
    let family = Some(style.font_family.clone()).filter(|name| !name.trim().is_empty());
    let weight = weight_of(&style.font_weight);

    // The footer first, because the verse gets what is left.
    if let Some(footer) = footer.map(str::trim).filter(|footer| !footer.is_empty()) {
        let font_size = if style.footer_font_size.is_finite() {
            style.footer_font_size.round().max(8.0) as f32
        } else {
            (style.font_size * 0.28).round().max(8.0) as f32
        };
        let footer_style = TextStyle {
            font_size,
            line_height: font_size * FOOTER_LINE_HEIGHT,
            family: family.clone(),
            weight,
            italic: false,
            letter_spacing_em: FOOTER_LETTER_SPACING_EM,
            align: align_of(&style.footer_align),
            wrap: true,
        };
        let upper = footer.to_uppercase();
        let (footer_height, _) = text::measure(&upper, content_width, &footer_style);
        let at_top = style.footer_position.trim() == "top";
        let footer_y = if at_top {
            SCRIPTURE_PADDING + FOOTER_GAP
        } else {
            frame_height - SCRIPTURE_PADDING - footer_height
        };
        text::draw_paragraph(
            pixmap,
            &upper,
            (content_x, footer_y, content_width),
            &footer_style,
            Color::from_rgba8(255, 255, 255, 230),
            Some(&footer_shadow()),
            None,
        );
        body_height = (body_height - footer_height - FOOTER_GAP).max(0.0);
        if at_top {
            body_top += footer_height + FOOTER_GAP;
        }
    }

    let verse = pre_line(text);
    let verse_style = |font_size: f32| TextStyle {
        font_size,
        line_height: font_size * SCRIPTURE_LINE_HEIGHT,
        family: family.clone(),
        weight,
        italic: false,
        letter_spacing_em: 0.0,
        align: align_of(&style.text_align),
        wrap: true,
    };
    let fitted = fit_font_size(
        |size| {
            let (height, width) = text::measure(&verse, content_width, &verse_style(size));
            height <= body_height && width <= content_width
        },
        style.font_size as f32,
    );

    let verse_style = verse_style(fitted);
    let (verse_height, _) = text::measure(&verse, content_width, &verse_style);
    let verse_y = body_top + vertical_start(&style.vertical_align, body_height, verse_height);
    text::draw_paragraph(
        pixmap,
        &verse,
        (content_x, verse_y, content_width),
        &verse_style,
        Color::WHITE,
        Some(&verse_shadow()),
        None,
    );
}

/// `CanvasSlideLayer`'s fallback: `fillText(text, width / 2, height / 2,
/// width * 0.9)`, white, weight 400, the library font scaled with the deck.
///
/// Canvas turns every line break into a space and never wraps, so a verse
/// typed on two lines is one line here, squeezed narrower if it is too wide —
/// which is what the window shows.
pub fn draw_plain(
    pixmap: &mut PixmapMut<'_>,
    text: &str,
    style: Option<&LibraryStyle>,
    viewport: &Viewport,
) {
    let fallback = default_library_style();
    let style = style.unwrap_or(&fallback);
    let (frame_width, frame_height) = (pixmap.width() as f32, pixmap.height() as f32);

    let scale = viewport.scale_x().min(viewport.scale_y()) as f32;
    let font_size = ((style.font_size as f32) * scale).max(12.0);
    let line = text.replace(['\n', '\r', '\t', '\u{c}'], " ");
    let text_style = TextStyle {
        font_size,
        // One line, its box as tall as the font, centred on the middle.
        line_height: font_size,
        family: Some(style.font_family.clone()).filter(|name| !name.trim().is_empty()),
        weight: Weight::NORMAL,
        italic: false,
        letter_spacing_em: 0.0,
        align: Align::Left,
        wrap: false,
    };
    let (height, width) = text::measure(&line, frame_width, &text_style);
    let centre = frame_width / 2.0;

    text::draw_paragraph(
        pixmap,
        &line,
        (
            centre - width / 2.0,
            frame_height / 2.0 - height / 2.0,
            width.max(1.0),
        ),
        &text_style,
        Color::WHITE,
        None,
        Some((frame_width * 0.9, centre)),
    );
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn scene(
        id: Option<&str>,
        text: Option<&str>,
        elements: Option<serde_json::Value>,
    ) -> OutputScene {
        OutputScene {
            active_slide_id: id.map(str::to_owned),
            slide_text: text.map(str::to_owned),
            slide_elements: elements,
            show_text: true,
            ..OutputScene::default()
        }
    }

    #[test]
    fn scripture_without_elements_goes_through_the_scripture_layer() {
        let verse = scene(Some("scripture:3"), Some("For God so loved"), None);
        assert_eq!(layer_for(&verse), SlideTextLayer::Scripture);
        let empty_array = scene(
            Some("scripture:3"),
            Some("For God so loved"),
            Some(json!([])),
        );
        assert_eq!(layer_for(&empty_array), SlideTextLayer::Scripture);
    }

    #[test]
    fn scripture_with_authored_elements_is_drawn_as_elements() {
        let authored = scene(
            Some("scripture:3"),
            Some("For God so loved"),
            Some(json!([{ "id": "a", "type": "text", "content": "x" }])),
        );
        assert_eq!(layer_for(&authored), SlideTextLayer::Elements);
    }

    #[test]
    fn scripture_with_no_text_draws_nothing() {
        assert_eq!(
            layer_for(&scene(Some("scripture:3"), Some("  "), None)),
            SlideTextLayer::Elements
        );
    }

    #[test]
    fn a_library_slide_with_only_text_falls_back_to_one_line() {
        assert_eq!(
            layer_for(&scene(Some("song:1"), Some("Amazing grace"), None)),
            SlideTextLayer::PlainText
        );
        let hidden = scene(
            Some("song:1"),
            Some("Amazing grace"),
            Some(json!([{ "id": "a", "type": "text", "content": "x", "isVisible": false }])),
        );
        assert_eq!(
            layer_for(&hidden),
            SlideTextLayer::PlainText,
            "hidden elements do not count"
        );
    }

    #[test]
    fn the_search_finds_the_largest_size_that_fits_exactly_as_the_window_does() {
        // Replays AutoFitText's loop by hand for a threshold of 137 px.
        let (mut low, mut high, mut best) = (10.0_f32, 500.0_f32, 10.0_f32);
        for _ in 0..10 {
            let middle = (low + high) / 2.0;
            if middle <= 137.0 {
                best = middle;
                low = middle;
            } else {
                high = middle;
            }
        }
        assert_eq!(fit_font_size(|size| size <= 137.0, 0.0), best);
        assert!((best - 137.0).abs() < 1.0);
    }

    #[test]
    fn the_style_size_caps_the_fit_and_zero_caps_nothing() {
        assert_eq!(fit_font_size(|_| true, 96.0), 96.0);
        let uncapped = fit_font_size(|_| true, 0.0);
        assert!(uncapped > 499.0, "{uncapped}");
        assert!(
            fit_font_size(|_| true, f32::NAN) > 499.0,
            "NaN is falsy too"
        );
    }

    #[test]
    fn nothing_fitting_leaves_the_search_at_its_floor() {
        assert_eq!(fit_font_size(|_| false, 96.0), 10.0);
    }

    #[test]
    fn pre_line_collapses_spaces_and_keeps_breaks() {
        assert_eq!(
            pre_line("  For  God\tso \n  loved   the world "),
            "For God so\nloved the world"
        );
        assert_eq!(pre_line("a\r\nb"), "a\nb");
    }

    fn ink_rows(pixmap: &tiny_skia::Pixmap) -> (u32, u32) {
        let width = pixmap.width() as usize;
        let rows: Vec<u32> = pixmap
            .pixels()
            .chunks(width)
            .enumerate()
            .filter(|(_, row)| {
                row.iter()
                    .any(|pixel| pixel.alpha() > 128 && pixel.red() > 200)
            })
            .map(|(index, _)| index as u32)
            .collect();
        (
            rows.first().copied().unwrap_or(0),
            rows.last().copied().unwrap_or(0),
        )
    }

    #[test]
    fn a_long_verse_is_shrunk_to_fit_inside_the_padding() {
        let mut pixmap = tiny_skia::Pixmap::new(640, 360).unwrap();
        let verse = "For God so loved the world, that he gave his only begotten Son, that whosoever believeth in him should not perish, but have everlasting life.";
        draw_scripture(&mut pixmap.as_mut(), verse, None, None);

        let (top, bottom) = ink_rows(&pixmap);
        assert!(bottom > top, "the verse was drawn");
        assert!(
            top as f32 >= SCRIPTURE_PADDING - 4.0,
            "inside the top padding: {top}"
        );
        assert!(
            bottom as f32 <= 360.0 - SCRIPTURE_PADDING + 4.0,
            "inside the bottom padding: {bottom}"
        );
    }

    #[test]
    fn the_footer_sits_under_the_verse_at_the_bottom_padding() {
        let mut pixmap = tiny_skia::Pixmap::new(640, 360).unwrap();
        let style = ScriptureStyle {
            font_size: 40.0,
            footer_font_size: 20.0,
            ..default_scripture_style()
        };
        draw_scripture(
            &mut pixmap.as_mut(),
            "Jesus wept.",
            Some("John 11:35 KJV"),
            Some(&style),
        );

        let (_, bottom) = ink_rows(&pixmap);
        assert!(
            bottom > 360 - 48 - 30,
            "the footer reaches down to the padding: {bottom}"
        );
        assert!(bottom <= 360 - 48 + 4, "and no further: {bottom}");
    }

    #[test]
    fn plain_text_is_one_centred_line_squeezed_to_nine_tenths() {
        let mut pixmap = tiny_skia::Pixmap::new(400, 200).unwrap();
        let viewport = Viewport::new(Some("1920x1080"), 400, 200);
        let line = "Amazing grace how sweet the sound that saved a wretch like me";
        draw_plain(&mut pixmap.as_mut(), line, None, &viewport);

        let width = pixmap.width() as usize;
        let columns: Vec<usize> = (0..width)
            .filter(|x| {
                pixmap
                    .pixels()
                    .chunks(width)
                    .any(|row| row[*x].alpha() > 128)
            })
            .collect();
        let (left, right) = (columns[0], *columns.last().unwrap());
        assert!(
            left as f32 >= 400.0 * 0.05 - 2.0,
            "squeezed in from the left: {left}"
        );
        assert!(
            right as f32 <= 400.0 * 0.95 + 2.0,
            "and from the right: {right}"
        );
        // Squeezed to fit, not cut off at the frame's edge and then shrunk: the
        // line fills nearly all of its nine tenths.
        assert!(
            (right - left) as f32 > 400.0 * 0.9 - 12.0,
            "the whole line, squeezed: {left}..{right}"
        );

        let (top, bottom) = ink_rows(&pixmap);
        assert!(bottom - top < 40, "one line, not wrapped: {top}..{bottom}");
    }
}
