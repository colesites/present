//! Words with a look of their own, run by run: an imported PowerPoint text
//! box (`textBody`).
//!
//! The plain path (`text.rs`) draws an element in one style, which is what a
//! lyric or a verse is. A PowerPoint box mixes them — a bold word, a coloured
//! one, a heading and its body — and drawing all of it in the first run's
//! style lost every one of those on the screens while the slide grid showed
//! them. Here each paragraph is laid out with its runs as spans, each in its
//! own font, size, weight and colour, at its own alignment, with its bullet
//! hanging in its indent and the spacing PowerPoint puts around it.
//!
//! Words that run past their box are drawn, as PowerPoint draws them, rather
//! than cut off at its edge.

use cosmic_text::{Align, Attrs, Buffer, Color, Family, Metrics, Shaping, Style, Weight, Wrap};
use tiny_skia::PixmapMut;

use crate::services::slide::{SlideElement, SlideTextParagraph, SlideTextRun};

use super::{color, geometry};

/// The most a box's words may reach beyond it, as multiples of its height:
/// enough for any real overflow, and a bound on the scratch for a broken one.
const MAX_OVERFLOW: f32 = 3.0;

/// Whether the element's words are a styled text body this draws.
pub fn applies(element: &SlideElement) -> bool {
    element.text_body.as_ref().is_some_and(|body| {
        body.paragraphs
            .iter()
            .any(|paragraph| paragraph.runs.iter().any(|run| run.font_size.is_some()))
    })
}

struct Laid {
    buffer: Buffer,
    /// Where the text of the paragraph starts, from the content's left.
    left: f32,
    height: f32,
    space_before: f32,
    space_after: f32,
    bullet: Option<(Buffer, f32)>,
    /// Each run's underline, strike and highlight, by span index.
    decorations: Vec<RunDecoration>,
}

#[derive(Debug, Clone, Copy, Default)]
struct RunDecoration {
    underline: bool,
    strike: bool,
    highlight: Option<tiny_skia::Color>,
    color: Option<tiny_skia::Color>,
    size: f32,
}

fn extra_f32(map: &serde_json::Map<String, serde_json::Value>, key: &str) -> Option<f32> {
    map.get(key)
        .and_then(serde_json::Value::as_f64)
        .filter(|value| value.is_finite())
        .map(|value| value as f32)
}

fn weight(run: &SlideTextRun) -> Weight {
    match run.font_weight.as_deref().map(str::trim) {
        Some("bold" | "bolder") => Weight::BOLD,
        Some(value) => value.parse::<u16>().map(Weight).unwrap_or(Weight::NORMAL),
        None => Weight::NORMAL,
    }
}

fn align(paragraph: &SlideTextParagraph) -> Align {
    match paragraph.alignment.as_deref() {
        Some("center") => Align::Center,
        Some("right") => Align::Right,
        Some("justify") => Align::Justified,
        _ => Align::Left,
    }
}

fn ink(value: Option<&str>) -> Option<tiny_skia::Color> {
    value.and_then(color::parse)
}

fn to_cosmic(color: tiny_skia::Color) -> Color {
    let c = color.to_color_u8();
    Color::rgba(c.red(), c.green(), c.blue(), c.alpha())
}

/// Draw the element's text body. The caller has checked [`applies`].
pub fn draw(pixmap: &mut PixmapMut<'_>, element: &SlideElement, viewport: &geometry::Viewport) {
    let Some(body) = element.text_body.as_ref() else {
        return;
    };
    let (width, height) = viewport.element_size(element);
    if width <= 0.0 || height <= 0.0 {
        return;
    }
    let (scale_x, scale_y) = (viewport.scale_x() as f32, viewport.scale_y() as f32);
    let uniform = scale_x.min(scale_y);
    let inset = |value: Option<f64>, scale: f32| {
        value.filter(|v| v.is_finite()).unwrap_or(0.0) as f32 * scale
    };
    let (left, right) = (
        inset(body.inset_left, scale_x),
        inset(body.inset_right, scale_x),
    );
    let (top, bottom) = (
        inset(body.inset_top, scale_y),
        inset(body.inset_bottom, scale_y),
    );
    let content_width = (width - left - right).max(1.0);
    let content_height = (height - top - bottom).max(1.0);
    let wrap = body.wrap.unwrap_or(true);
    let opacity = element.style.as_ref().and_then(|style| style.opacity);

    let Ok(mut fonts) = super::text::fonts().lock() else {
        tracing::error!("the font system is poisoned; skipping a text body");
        return;
    };
    let super::text::Fonts {
        system,
        cache,
        optical,
    } = &mut *fonts;

    let laid: Vec<Laid> = body
        .paragraphs
        .iter()
        .map(|paragraph| {
            lay_out(
                system,
                optical,
                paragraph,
                uniform,
                content_width,
                wrap,
                opacity,
            )
        })
        .collect();
    let total: f32 = laid
        .iter()
        .map(|paragraph| paragraph.space_before + paragraph.height + paragraph.space_after)
        .sum();

    // Where the block starts in the box: its anchor, overflowing both ways
    // from the middle, upwards from the bottom.
    let slack = content_height - total;
    let start = top
        + match body.vertical_align.as_deref() {
            Some("middle") => slack / 2.0,
            Some("bottom") => slack,
            _ => 0.0,
        };
    let block_top = start.min(0.0).max(-height * MAX_OVERFLOW).floor();
    let block_bottom = (start + total)
        .max(height)
        .min(height * (1.0 + MAX_OVERFLOW))
        .ceil();
    let scratch_height = (block_bottom - block_top).max(1.0) as u32;
    let scratch_width = width.ceil().max(1.0) as u32;
    let Some(mut scratch) = tiny_skia::Pixmap::new(scratch_width, scratch_height) else {
        return;
    };
    let mut bounds = super::text::InkBounds::default();
    let stride = scratch.width() as i32;
    let (scratch_w, scratch_h) = (scratch.width() as i32, scratch.height() as i32);

    let mut y = start - block_top;
    for mut paragraph in laid {
        y += paragraph.space_before;
        let origin_x = left + paragraph.left;
        let origin_y = y;

        // Highlights first, under the words.
        let spans = run_spans(&paragraph.buffer);
        for (line_top, line_height, from, to, index) in &spans {
            let Some(decoration) = paragraph.decorations.get(*index) else {
                continue;
            };
            if let Some(highlight) = decoration.highlight {
                fill_rect(
                    &mut scratch,
                    &mut bounds,
                    (
                        origin_x + from,
                        origin_y + line_top,
                        to - from,
                        *line_height,
                    ),
                    highlight,
                );
            }
        }

        paragraph.buffer.draw(
            system,
            cache,
            Color::rgba(0, 0, 0, 255),
            |x, y_glyph, w, h, glyph| {
                let alpha = glyph.a();
                if alpha == 0 {
                    return;
                }
                for row in 0..h as i32 {
                    for col in 0..w as i32 {
                        let px = (origin_x as i32) + x + col;
                        let py = (origin_y as i32) + y_glyph + row;
                        if px < 0 || py < 0 || px >= scratch_w || py >= scratch_h {
                            continue;
                        }
                        bounds.include(px, py);
                        super::text::blend(
                            &mut scratch,
                            (py * stride + px) as usize,
                            glyph.r(),
                            glyph.g(),
                            glyph.b(),
                            f32::from(alpha) / 255.0,
                        );
                    }
                }
            },
        );

        // Underline and strike, each run in its own colour and size.
        for (_, _, from, to, index) in &spans {
            let Some(decoration) = paragraph.decorations.get(*index) else {
                continue;
            };
            if !decoration.underline && !decoration.strike {
                continue;
            }
            let baseline = spans_baseline(&paragraph.buffer, *index);
            let Some(baseline) = baseline else {
                continue;
            };
            let thickness = (decoration.size * 0.06).max(1.0);
            let color = decoration.color.unwrap_or(tiny_skia::Color::BLACK);
            if decoration.underline {
                fill_rect(
                    &mut scratch,
                    &mut bounds,
                    (
                        origin_x + from,
                        origin_y + baseline + decoration.size * 0.08,
                        to - from,
                        thickness,
                    ),
                    color,
                );
            }
            if decoration.strike {
                fill_rect(
                    &mut scratch,
                    &mut bounds,
                    (
                        origin_x + from,
                        origin_y + baseline - decoration.size * 0.28,
                        to - from,
                        thickness,
                    ),
                    color,
                );
            }
        }

        // The bullet, on the first line's baseline.
        if let Some((mut bullet, bullet_left)) = paragraph.bullet.take() {
            let first_baseline = paragraph
                .buffer
                .layout_runs()
                .next()
                .map_or(0.0, |run| run.line_y);
            let bullet_baseline = bullet.layout_runs().next().map_or(0.0, |run| run.line_y);
            let bx = left + bullet_left;
            let by = origin_y + first_baseline - bullet_baseline;
            bullet.draw(
                system,
                cache,
                Color::rgba(0, 0, 0, 255),
                |x, y_glyph, w, h, glyph| {
                    let alpha = glyph.a();
                    if alpha == 0 {
                        return;
                    }
                    for row in 0..h as i32 {
                        for col in 0..w as i32 {
                            let px = bx as i32 + x + col;
                            let py = by as i32 + y_glyph + row;
                            if px < 0 || py < 0 || px >= scratch_w || py >= scratch_h {
                                continue;
                            }
                            bounds.include(px, py);
                            super::text::blend(
                                &mut scratch,
                                (py * stride + px) as usize,
                                glyph.r(),
                                glyph.g(),
                                glyph.b(),
                                f32::from(alpha) / 255.0,
                            );
                        }
                    }
                },
            );
        }

        y += paragraph.height + paragraph.space_after;
    }
    drop(fonts);

    let transform = viewport
        .element_transform(element)
        .pre_translate(0.0, block_top);
    super::text::composite(pixmap, &scratch, bounds, transform);
}

/// One paragraph laid out at `content_width`.
fn lay_out(
    system: &mut cosmic_text::FontSystem,
    optical: &mut super::optical_size::OpticalSizes,
    paragraph: &SlideTextParagraph,
    uniform: f32,
    content_width: f32,
    wrap: bool,
    opacity: Option<f64>,
) -> Laid {
    let margin = extra_f32(&paragraph.extra, "marginLeft").unwrap_or(0.0) * uniform;
    let indent = extra_f32(&paragraph.extra, "indent").unwrap_or(0.0) * uniform;
    let line_height = paragraph
        .line_height
        .filter(|value| value.is_finite() && *value > 0.0);
    let size_of = |run: &SlideTextRun| {
        (run.font_size
            .filter(|v| v.is_finite() && *v > 0.0)
            .unwrap_or(18.0) as f32
            * uniform)
            .max(1.0)
    };
    let metrics_for = |size: f32| {
        let height = match line_height {
            Some(value) if value <= 4.0 => size * value as f32,
            Some(value) => value as f32 * uniform,
            None => size * 1.2,
        };
        Metrics::new(size, height.max(1.0))
    };

    // Families are resolved first: the spans borrow them.
    let families: Vec<Option<String>> = paragraph
        .runs
        .iter()
        .map(|run| {
            let italic = run.font_style.as_deref() == Some("italic");
            super::text::resolve_family(
                system,
                optical,
                run.font_family.as_deref(),
                weight(run),
                italic,
                size_of(run),
            )
        })
        .collect();

    let first_size = paragraph.runs.first().map_or(18.0 * uniform, size_of);
    let default_metrics = metrics_for(first_size);

    let mut decorations = Vec::with_capacity(paragraph.runs.len());
    let mut spans: Vec<(&str, Attrs)> = Vec::with_capacity(paragraph.runs.len());
    for (index, run) in paragraph.runs.iter().enumerate() {
        let size = size_of(run);
        let run_color = ink(run.color.as_deref()).map(|c| color::with_opacity(c, opacity));
        let mut attrs = Attrs::new()
            .weight(weight(run))
            .metrics(metrics_for(size))
            .metadata(index);
        if run.font_style.as_deref() == Some("italic") {
            attrs = attrs.style(Style::Italic);
        }
        if let Some(family) = families[index].as_deref() {
            attrs = attrs.family(Family::Name(family));
        }
        if let Some(color) = run_color {
            attrs = attrs.color(to_cosmic(color));
        }
        if let Some(spacing) = run
            .letter_spacing
            .filter(|value| *value != 0.0 && value.is_finite())
        {
            attrs = attrs.letter_spacing((spacing as f32 * uniform / size).clamp(-0.5, 2.0));
        }
        decorations.push(RunDecoration {
            underline: run.underline == Some(true),
            strike: run.extra.get("strike").and_then(serde_json::Value::as_bool) == Some(true),
            highlight: run
                .extra
                .get("highlight")
                .and_then(serde_json::Value::as_str)
                .and_then(color::parse),
            color: run_color,
            size,
        });
        spans.push((run.text.as_str(), attrs));
    }

    // The bullet hangs in the indent; the words start at the margin, or after
    // the bullet if it reaches further.
    let bullet = paragraph.extra.get("bullet").and_then(|bullet| {
        let text = bullet.get("text")?.as_str()?;
        let size = bullet
            .get("fontSize")
            .and_then(serde_json::Value::as_f64)
            .map_or(first_size, |size| (size as f32 * uniform).max(1.0));
        let family = bullet.get("fontFamily").and_then(serde_json::Value::as_str);
        let family =
            super::text::resolve_family(system, optical, family, Weight::NORMAL, false, size);
        let mut attrs = Attrs::new();
        if let Some(family) = family.as_deref() {
            attrs = attrs.family(Family::Name(family));
        }
        if let Some(color) = bullet
            .get("color")
            .and_then(serde_json::Value::as_str)
            .and_then(color::parse)
        {
            attrs = attrs.color(to_cosmic(color::with_opacity(color, opacity)));
        }
        let mut buffer = Buffer::new(system, metrics_for(size));
        buffer.set_size(None, None);
        buffer.set_text(text, &attrs, Shaping::Advanced, None);
        buffer.shape_until_scroll(system, false);
        let width = buffer
            .layout_runs()
            .map(|run| run.line_w)
            .fold(0.0, f32::max);
        Some((buffer, (margin + indent).max(0.0), width))
    });
    let text_left = match &bullet {
        Some((_, bullet_left, bullet_width)) => {
            margin.max(bullet_left + bullet_width + first_size * 0.25)
        }
        None => (margin + indent.min(0.0)).max(0.0),
    };

    let mut buffer = Buffer::new(system, default_metrics);
    let available = (content_width - text_left).max(1.0);
    buffer.set_size(wrap.then_some(available), None);
    buffer.set_wrap(if wrap { Wrap::WordOrGlyph } else { Wrap::None });
    let default_attrs = Attrs::new().metrics(default_metrics);
    buffer.set_rich_text(
        spans,
        &default_attrs,
        Shaping::Advanced,
        Some(align(paragraph)),
    );
    buffer.shape_until_scroll(system, false);
    let height = buffer
        .layout_runs()
        .map(|run| run.line_top + run.line_height)
        .fold(0.0_f32, f32::max)
        .max(default_metrics.line_height);

    Laid {
        buffer,
        left: text_left,
        height,
        space_before: paragraph.space_before.unwrap_or(0.0).max(0.0) as f32 * uniform,
        space_after: paragraph.space_after.unwrap_or(0.0).max(0.0) as f32 * uniform,
        bullet: bullet.map(|(buffer, left, _)| (buffer, left)),
        decorations,
    }
}

/// Each laid-out line's stretches of one run: its top, height, left and right,
/// and the run.
fn run_spans(buffer: &Buffer) -> Vec<(f32, f32, f32, f32, usize)> {
    let mut spans = Vec::new();
    for run in buffer.layout_runs() {
        let mut current: Option<(f32, f32, usize)> = None;
        for glyph in run.glyphs {
            let (low, high) = (glyph.x, glyph.x + glyph.w);
            current = match current {
                Some((from, to, index)) if index == glyph.metadata => {
                    Some((from.min(low), to.max(high), index))
                }
                Some((from, to, index)) => {
                    spans.push((run.line_top, run.line_height, from, to, index));
                    Some((low, high, glyph.metadata))
                }
                None => Some((low, high, glyph.metadata)),
            };
        }
        if let Some((from, to, index)) = current {
            spans.push((run.line_top, run.line_height, from, to, index));
        }
    }
    spans
}

/// The baseline of the first line a run is on.
fn spans_baseline(buffer: &Buffer, index: usize) -> Option<f32> {
    buffer
        .layout_runs()
        .find(|run| run.glyphs.iter().any(|glyph| glyph.metadata == index))
        .map(|run| run.line_y)
}

fn fill_rect(
    scratch: &mut tiny_skia::Pixmap,
    bounds: &mut super::text::InkBounds,
    (x, y, w, h): (f32, f32, f32, f32),
    color: tiny_skia::Color,
) {
    let c = color.to_color_u8();
    let alpha = f32::from(c.alpha()) / 255.0;
    if alpha <= 0.0 {
        return;
    }
    let stride = scratch.width() as i32;
    let (max_x, max_y) = (scratch.width() as i32, scratch.height() as i32);
    for py in (y.round() as i32).max(0)
        ..((y + h).round() as i32)
            .max(y.round() as i32 + 1)
            .min(max_y)
    {
        for px in (x.floor() as i32).max(0)..((x + w).ceil() as i32).min(max_x) {
            bounds.include(px, py);
            super::text::blend(
                scratch,
                (py * stride + px) as usize,
                c.red(),
                c.green(),
                c.blue(),
                alpha,
            );
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::services::compositor::geometry::Viewport;
    use serde_json::json;

    fn element(body: serde_json::Value) -> SlideElement {
        serde_json::from_value(json!({
            "id": "t", "type": "text", "x": 0, "y": 0, "width": 400, "height": 200,
            "content": "", "textBody": body
        }))
        .expect("element")
    }

    fn ink_rows(
        pixmap: &tiny_skia::Pixmap,
        pick: impl Fn(&tiny_skia::PremultipliedColorU8) -> bool,
    ) -> Vec<u32> {
        let width = pixmap.width();
        let mut rows: Vec<u32> = pixmap
            .pixels()
            .iter()
            .enumerate()
            .filter(|(_, pixel)| pick(pixel))
            .map(|(index, _)| index as u32 / width)
            .collect();
        rows.dedup();
        rows
    }

    #[test]
    fn each_run_keeps_its_own_colour() {
        let element = element(json!({
            "insetLeft": 0, "insetTop": 0, "insetRight": 0, "insetBottom": 0,
            "verticalAlign": "top",
            "paragraphs": [{ "alignment": "left", "lineHeight": 1.2, "runs": [
                { "text": "RED ", "fontSize": 40, "color": "#ff0000" },
                { "text": "BLUE", "fontSize": 40, "color": "#0000ff" }
            ]}]
        }));
        assert!(applies(&element));
        let mut pixmap = tiny_skia::Pixmap::new(400, 200).expect("pixmap");
        draw(
            &mut pixmap.as_mut(),
            &element,
            &Viewport::new(Some("400x200"), 400, 200),
        );
        let red = pixmap
            .pixels()
            .iter()
            .filter(|p| p.red() > 150 && p.blue() < 80 && p.alpha() > 150)
            .count();
        let blue = pixmap
            .pixels()
            .iter()
            .filter(|p| p.blue() > 150 && p.red() < 80 && p.alpha() > 150)
            .count();
        assert!(red > 50 && blue > 50, "red {red}, blue {blue}");
    }

    #[test]
    fn a_line_break_starts_a_new_line() {
        let element = element(json!({
            "insetLeft": 0, "insetTop": 0, "insetRight": 0, "insetBottom": 0,
            "paragraphs": [{ "lineHeight": 1.2, "runs": [
                { "text": "ONE", "fontSize": 40, "color": "#000000" },
                { "text": "\n", "fontSize": 40, "color": "#000000" },
                { "text": "TWO", "fontSize": 40, "color": "#000000" }
            ]}]
        }));
        let mut pixmap = tiny_skia::Pixmap::new(400, 200).expect("pixmap");
        draw(
            &mut pixmap.as_mut(),
            &element,
            &Viewport::new(Some("400x200"), 400, 200),
        );
        let rows = ink_rows(&pixmap, |p| p.alpha() > 128);
        let first = *rows.first().expect("ink");
        let last = *rows.last().expect("ink");
        assert!(last - first > 60, "two lines of 40px: rows {first}..{last}");
    }

    #[test]
    fn words_past_the_box_are_drawn_not_cut() {
        let element: SlideElement = serde_json::from_value(json!({
            "id": "t", "type": "text", "x": 0, "y": 0, "width": 400, "height": 40,
            "content": "", "textBody": {
                "insetLeft": 0, "insetTop": 0, "insetRight": 0, "insetBottom": 0,
                "paragraphs": [
                    { "lineHeight": 1.2, "runs": [{ "text": "ONE", "fontSize": 30, "color": "#000000" }] },
                    { "lineHeight": 1.2, "runs": [{ "text": "TWO", "fontSize": 30, "color": "#000000" }] },
                    { "lineHeight": 1.2, "runs": [{ "text": "THREE", "fontSize": 30, "color": "#000000" }] }
                ]
            }
        }))
        .expect("element");
        let mut pixmap = tiny_skia::Pixmap::new(400, 200).expect("pixmap");
        draw(
            &mut pixmap.as_mut(),
            &element,
            &Viewport::new(Some("400x200"), 400, 200),
        );
        let rows = ink_rows(&pixmap, |p| p.alpha() > 128);
        assert!(
            *rows.last().expect("ink") > 80,
            "the third line, below the 40px box"
        );
    }

    #[test]
    fn a_bullet_hangs_in_the_indent() {
        let element = element(json!({
            "insetLeft": 0, "insetTop": 0, "insetRight": 0, "insetBottom": 0,
            "paragraphs": [{ "lineHeight": 1.2, "marginLeft": 60, "indent": -60,
                "bullet": { "text": "•", "color": "#ff0000", "fontSize": 40 },
                "runs": [{ "text": "Item", "fontSize": 40, "color": "#000000" }] }]
        }));
        let mut pixmap = tiny_skia::Pixmap::new(400, 200).expect("pixmap");
        draw(
            &mut pixmap.as_mut(),
            &element,
            &Viewport::new(Some("400x200"), 400, 200),
        );
        let width = pixmap.width() as usize;
        let red_columns: Vec<usize> = pixmap
            .pixels()
            .iter()
            .enumerate()
            .filter(|(_, p)| p.red() > 150 && p.green() < 80 && p.alpha() > 150)
            .map(|(index, _)| index % width)
            .collect();
        let black_columns: Vec<usize> = pixmap
            .pixels()
            .iter()
            .enumerate()
            .filter(|(_, p)| p.red() < 60 && p.alpha() > 200)
            .map(|(index, _)| index % width)
            .collect();
        assert!(!red_columns.is_empty(), "the bullet is drawn");
        assert!(
            red_columns.iter().max() < black_columns.iter().min(),
            "the bullet before the words"
        );
        assert!(
            *black_columns.iter().min().unwrap() >= 55,
            "the words at the margin"
        );
    }
}
