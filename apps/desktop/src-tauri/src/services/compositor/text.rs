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
use tiny_skia::{PixmapMut, Transform};

use crate::services::slide::{SlideElement, SlideElementStyle};

use super::optical_size::OpticalSizes;
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
pub(super) struct Fonts {
    pub(super) system: FontSystem,
    pub(super) cache: SwashCache,
    /// Variable fonts instanced at the optical size they are drawn at.
    pub(super) optical: OpticalSizes,
}

pub(super) fn fonts() -> &'static Mutex<Fonts> {
    static FONTS: OnceLock<Mutex<Fonts>> = OnceLock::new();
    FONTS.get_or_init(|| {
        Mutex::new(Fonts {
            system: FontSystem::new(),
            cache: SwashCache::new(),
            optical: OpticalSizes::default(),
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
pub(super) fn paragraphs_of(element: &SlideElement) -> Vec<String> {
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
        Some(value)
            if value.eq_ignore_ascii_case("titleCase")
                || value.eq_ignore_ascii_case("capitalize") =>
        {
            title_case(text)
        }
        Some(value) if value.eq_ignore_ascii_case("lineStart") => text
            .split('\n')
            .map(first_letter_upper)
            .collect::<Vec<_>>()
            .join("\n"),
        _ => text.to_owned(),
    }
}

/// Each word's first letter in capitals, as `applyCapitalization`'s
/// `titleCase` does: a letter that follows anything but a letter, a digit or
/// an apostrophe, so "it's" is "It's".
fn title_case(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    let mut in_word = false;
    for character in text.chars() {
        if character.is_alphabetic() && !in_word {
            out.extend(character.to_uppercase());
        } else {
            out.push(character);
        }
        in_word = character.is_alphanumeric() || matches!(character, '\'' | '\u{2019}');
    }
    out
}

/// The first letter of a line in capitals, whatever comes before it.
fn first_letter_upper(line: &str) -> String {
    match line
        .char_indices()
        .find(|(_, character)| character.is_alphabetic())
    {
        Some((index, character)) => {
            let mut out = String::with_capacity(line.len());
            out.push_str(&line[..index]);
            out.extend(character.to_uppercase());
            out.push_str(&line[index + character.len_utf8()..]);
            out
        }
        None => line.to_owned(),
    }
}

/// A number the style carries that this build does not model as a field.
fn extra_number(style: Option<&SlideElementStyle>, key: &str) -> Option<f32> {
    style?
        .extra
        .get(key)?
        .as_f64()
        .filter(|value| value.is_finite())
        .map(|value| value as f32)
}

/// Draw one `text` element.
/// A run of text and the box it goes in, in frame pixels.
///
/// The shape both callers reduce to. A slide element resolves its style and
/// geometry into one of these; an overlay builds one directly, because an
/// overlay is positioned against the frame rather than against a deck's canvas
/// and inventing a `SlideElement` to carry that would be a lie about where the
/// numbers came from.
#[derive(Debug, Clone)]
pub struct TextBox {
    pub x: f32,
    pub y: f32,
    pub width: f32,
    pub height: f32,
    pub font_size: f32,
    pub line_height: f32,
    pub family: Option<String>,
    pub weight: Weight,
    pub italic: bool,
    pub color: tiny_skia::Color,
    pub align: Align,
    /// `top`, `middle` or `bottom`; anything else reads as `top`.
    pub vertical_align: Option<String>,
    /// Applied to the whole box after laying out, for rotation and flip.
    pub transform: Transform,
}

impl TextBox {
    /// A box with this application's defaults: white, left-aligned, upright.
    pub fn new(x: f32, y: f32, width: f32, height: f32, font_size: f32) -> Self {
        Self {
            x,
            y,
            width,
            height,
            font_size,
            line_height: font_size * DEFAULT_LINE_HEIGHT,
            family: None,
            weight: Weight::NORMAL,
            italic: false,
            color: color::parse(DEFAULT_COLOR).unwrap_or(tiny_skia::Color::WHITE),
            align: Align::Left,
            vertical_align: None,
            transform: Transform::identity(),
        }
    }

    pub fn centred(mut self) -> Self {
        self.align = Align::Center;
        self.vertical_align = Some("middle".to_owned());
        self
    }

    pub fn with_color(mut self, color: tiny_skia::Color) -> Self {
        self.color = color;
        self
    }

    pub fn with_weight(mut self, weight: Weight) -> Self {
        self.weight = weight;
        self
    }
}

/// Draw text into a box.
///
/// The one rasterisation path. Glyphs go into a scratch pixmap and are
/// composited once — see the note in the element path for why that is the
/// difference between a frame budget and a slideshow.
pub fn draw_box(pixmap: &mut PixmapMut<'_>, text: &str, spec: &TextBox) {
    if spec.width <= 0.0 || spec.height <= 0.0 || text.trim().is_empty() {
        return;
    }

    let Ok(mut fonts) = fonts().lock() else {
        tracing::error!("the font system is poisoned; skipping text");
        return;
    };
    let Fonts {
        system,
        cache,
        optical,
    } = &mut *fonts;

    let font_size = spec.font_size.max(1.0);
    let line_height = if spec.line_height > 0.0 {
        spec.line_height
    } else {
        font_size * DEFAULT_LINE_HEIGHT
    };

    let mut buffer = Buffer::new(system, Metrics::new(font_size, line_height));
    buffer.set_size(Some(spec.width), Some(spec.height));
    buffer.set_wrap(Wrap::Word);

    let family = resolve_family(
        system,
        optical,
        spec.family.as_deref(),
        spec.weight,
        spec.italic,
        font_size,
    );
    let mut attrs = Attrs::new().weight(spec.weight);
    if spec.italic {
        attrs = attrs.style(Style::Italic);
    }
    if let Some(family) = family.as_deref() {
        attrs = attrs.family(Family::Name(family));
    }

    buffer.set_text(text, &attrs, Shaping::Advanced, Some(spec.align));
    buffer.shape_until_scroll(system, false);

    let laid_out = buffer
        .layout_runs()
        .map(|run| run.line_top + run.line_height)
        .fold(0.0_f32, f32::max);
    let offset_x = spec.x;
    let offset_y = spec.y + vertical_offset(spec.vertical_align.as_deref(), spec.height, laid_out);

    let Some(mut scratch) =
        tiny_skia::Pixmap::new((pixmap.width()).max(1), (pixmap.height()).max(1))
    else {
        return;
    };
    let scratch_width = scratch.width() as i32;
    let scratch_height = scratch.height() as i32;

    let base = spec.color.to_color_u8();
    let (base_r, base_g, base_b) = (base.red(), base.green(), base.blue());
    let base_alpha = f32::from(base.alpha()) / 255.0;
    let mut ink = InkBounds::default();

    buffer.draw(
        system,
        cache,
        cosmic_text::Color::rgba(255, 255, 255, 255),
        |x, y, w, h, coverage| {
            let alpha = coverage.a();
            if alpha == 0 {
                return;
            }
            let alpha = f32::from(alpha) / 255.0 * base_alpha;
            if alpha <= 0.0 {
                return;
            }

            for offset_row in 0..h as i32 {
                for offset_col in 0..w as i32 {
                    let px = offset_x as i32 + x + offset_col;
                    let py = offset_y as i32 + y + offset_row;
                    if px < 0 || py < 0 || px >= scratch_width || py >= scratch_height {
                        continue;
                    }
                    ink.include(px, py);
                    blend(
                        &mut scratch,
                        (py * scratch_width + px) as usize,
                        base_r,
                        base_g,
                        base_b,
                        alpha,
                    );
                }
            }
        },
    );

    composite(pixmap, &scratch, ink, spec.transform);
}

pub fn draw(pixmap: &mut PixmapMut<'_>, element: &SlideElement, viewport: &geometry::Viewport) {
    // An imported deck's words, each run in its own style.
    if super::rich_text::applies(element) {
        super::rich_text::draw(pixmap, element, viewport);
        return;
    }
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
    // Line height as a multiple of the size (`lineHeight`), 1.2 unless set.
    let line_height = font_size
        * extra_number(style, "lineHeight")
            .filter(|value| (0.5..=4.0).contains(value))
            .unwrap_or(DEFAULT_LINE_HEIGHT);

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
    let Fonts {
        system,
        cache,
        optical,
    } = &mut *fonts;

    let weight = weight_of(style);
    let family = resolve_family(system, optical, Some(family), weight, italic, font_size);
    let mut buffer = Buffer::new(system, Metrics::new(font_size, line_height));
    buffer.set_size(Some(content_width), Some(content_height));
    buffer.set_wrap(Wrap::Word);

    let mut attrs = Attrs::new().weight(weight);
    if italic {
        attrs = attrs.style(Style::Italic);
    }
    if let Some(family) = family.as_deref() {
        attrs = attrs.family(Family::Name(family));
    }
    // `letterSpacing` is in canvas pixels, as the size is; cosmic-text wants
    // it as a fraction of the size.
    if let Some(spacing) = extra_number(style, "letterSpacing").filter(|value| *value != 0.0) {
        let canvas_size = font_size / uniform.max(f32::EPSILON);
        attrs = attrs.letter_spacing((spacing / canvas_size).clamp(-0.5, 2.0));
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

    // A shadow or an outline reaches past the glyphs, so the scratch is padded
    // to hold them; the glyphs themselves are still clipped to the box.
    let effects = TextEffects::of(style, uniform, text_color);
    let pad = effects.pad();

    // Glyphs are rasterised into a scratch pixmap and composited once.
    //
    // This is the difference between a frame budget and a slideshow.
    // cosmic-text's callback fires **per glyph pixel** (`render.rs:139-153`
    // passes `w: 1, h: 1`), so painting each one with `fill_rect` meant tens of
    // thousands of paint-and-transform round trips for two lines of a verse:
    // measured at 300 ms a frame, against the 33 ms that 30 fps NDI allows.
    // Writing pixels straight into a buffer and blitting it once is one
    // composite instead.
    //
    // It is also what makes rotation correct rather than merely fast: the
    // element's transform is applied to the finished text as an image, not to
    // each glyph box separately.
    let box_width = (width.ceil() as i32).max(1);
    let box_height = (height.ceil() as i32).max(1);
    let Some(mut scratch) =
        tiny_skia::Pixmap::new((box_width + 2 * pad) as u32, (box_height + 2 * pad) as u32)
    else {
        return;
    };
    let scratch_width = scratch.width() as i32;

    let base = text_color.to_color_u8();
    let base_ink = (
        base.red(),
        base.green(),
        base.blue(),
        f32::from(base.alpha()) / 255.0,
    );
    let gradient = TextGradient::of(style, width, height);
    let mut ink = InkBounds::default();

    buffer.draw(
        system,
        cache,
        cosmic_text::Color::rgba(255, 255, 255, 255),
        |x, y, w, h, coverage| {
            let coverage = coverage.a();
            if coverage == 0 {
                return;
            }
            let coverage = f32::from(coverage) / 255.0;

            for offset_row in 0..h as i32 {
                for offset_col in 0..w as i32 {
                    let bx = offset_x as i32 + x + offset_col;
                    let by = offset_y as i32 + y + offset_row;
                    if bx < 0 || by < 0 || bx >= box_width || by >= box_height {
                        continue;
                    }
                    let (r, g, b, a) = gradient.as_ref().map_or(base_ink, |gradient| {
                        gradient.at(bx as f32 + 0.5, by as f32 + 0.5)
                    });
                    let alpha = coverage * a;
                    if alpha <= 0.0 {
                        continue;
                    }
                    let (px, py) = (bx + pad, by + pad);
                    ink.include(px, py);
                    blend(
                        &mut scratch,
                        (py * scratch_width + px) as usize,
                        r,
                        g,
                        b,
                        alpha,
                    );
                }
            }
        },
    );

    // The font system is shared by every compositor (the audience screen, the
    // preview, NDI), and nothing below needs it. Held to the end, as it was,
    // each waited for the others' shadows and composites too.
    drop(fonts);

    // Underline and strikethrough, a line under or through each laid-out
    // line of words, at the heights the canvas draws them.
    let decoration = Decoration::of(style);
    if decoration.underline || decoration.strike {
        let thickness = (font_size * 0.06).max(1.0);
        for run in buffer.layout_runs() {
            let Some((left, right)) =
                run.glyphs
                    .iter()
                    .fold(None, |span: Option<(f32, f32)>, glyph| {
                        let (low, high) = (glyph.x, glyph.x + glyph.w);
                        Some(span.map_or((low, high), |(a, b)| (a.min(low), b.max(high))))
                    })
            else {
                continue;
            };
            let mut lines = Vec::with_capacity(2);
            if decoration.underline {
                lines.push(run.line_y + (font_size * 0.08).max(1.0));
            }
            if decoration.strike {
                lines.push(run.line_y - font_size * 0.28);
            }
            for centre in lines {
                let top = (offset_y + centre - thickness / 2.0).round() as i32;
                let rows = thickness.round().max(1.0) as i32;
                let from = (offset_x + left).floor() as i32;
                let to = (offset_x + right).ceil() as i32;
                for by in top.max(0)..(top + rows).min(box_height) {
                    for bx in from.max(0)..to.min(box_width) {
                        let (r, g, b, a) = gradient.as_ref().map_or(base_ink, |gradient| {
                            gradient.at(bx as f32 + 0.5, by as f32 + 0.5)
                        });
                        if a <= 0.0 {
                            continue;
                        }
                        let (px, py) = (bx + pad, by + pad);
                        ink.include(px, py);
                        blend(&mut scratch, (py * scratch_width + px) as usize, r, g, b, a);
                    }
                }
            }
        }
    }

    if let Some(outline) = effects.outline {
        outline_under(&mut scratch, &mut ink, outline.radius, outline.color);
    }
    if let Some(shadow) = effects.shadow {
        shadow_under(&mut scratch, &mut ink, &shadow);
    }
    let transform = viewport
        .element_transform(element)
        .pre_translate(-pad as f32, -pad as f32);
    composite(pixmap, &scratch, ink, transform);
}

/// The lines drawn with the words: `fontUnderline`, or `textDecoration` naming
/// `underline` or `line-through`.
#[derive(Debug, Clone, Copy, Default)]
struct Decoration {
    underline: bool,
    strike: bool,
}

impl Decoration {
    fn of(style: Option<&SlideElementStyle>) -> Self {
        let Some(style) = style else {
            return Self::default();
        };
        let named = style
            .text_decoration
            .as_deref()
            .unwrap_or("")
            .to_ascii_lowercase();
        Self {
            underline: style.font_underline == Some(true) || named.contains("underline"),
            strike: named.contains("line-through"),
        }
    }
}

/// Words filled with a gradient (`textFillMode: "gradient"`), laid out as the
/// canvas lays it (`createTextGradient` in `CanvasSlideLayer.tsx`): a line
/// through the middle of the box at `gradientAngle` degrees (315 when unset),
/// reaching the box's longer side each way, `gradientFromColor` at its start.
#[derive(Debug, Clone, Copy)]
struct TextGradient {
    from: [f32; 4],
    to: [f32; 4],
    centre: (f32, f32),
    direction: (f32, f32),
    radius: f32,
}

impl TextGradient {
    fn of(style: Option<&SlideElementStyle>, width: f32, height: f32) -> Option<Self> {
        let style = style?;
        if style.text_fill_mode.as_deref() != Some("gradient") {
            return None;
        }
        let channels = |value: Option<&str>| -> Option<[f32; 4]> {
            let color = color::with_opacity(color::parse(value?)?, style.opacity);
            Some([
                color.red() * 255.0,
                color.green() * 255.0,
                color.blue() * 255.0,
                color.alpha(),
            ])
        };
        let from = channels(style.gradient_from_color.as_deref())?;
        let to = channels(style.gradient_to_color.as_deref())?;
        let degrees = style
            .gradient_angle
            .filter(|angle| angle.is_finite())
            .unwrap_or(315.0);
        let radians = (degrees as f32).to_radians();
        Some(Self {
            from,
            to,
            centre: (width / 2.0, height / 2.0),
            direction: (radians.cos(), radians.sin()),
            radius: width.max(height).max(1.0),
        })
    }

    /// The colour at a point in the box, as straight RGB and an alpha.
    fn at(&self, x: f32, y: f32) -> (u8, u8, u8, f32) {
        let along = (x - self.centre.0) * self.direction.0 + (y - self.centre.1) * self.direction.1;
        let t = ((along + self.radius) / (2.0 * self.radius)).clamp(0.0, 1.0);
        let mix = |index: usize| self.from[index] + (self.to[index] - self.from[index]) * t;
        let channel = |index: usize| mix(index).round().clamp(0.0, 255.0) as u8;
        (channel(0), channel(1), channel(2), mix(3).clamp(0.0, 1.0))
    }
}

/// A text element's outline: how far it reaches past the glyphs, in frame
/// pixels, and its colour.
#[derive(Debug, Clone, Copy)]
struct Outline {
    radius: f32,
    color: tiny_skia::Color,
}

/// What a text element draws around its glyphs: an outline (`strokeColor`,
/// `strokeWidth`) and a shadow (`shadow`, CSS `dx dy blur color`), both in
/// canvas pixels, as the slide grid's canvas reads them.
#[derive(Debug, Clone, Copy, Default)]
struct TextEffects {
    outline: Option<Outline>,
    shadow: Option<Shadow>,
}

impl TextEffects {
    fn of(style: Option<&SlideElementStyle>, scale: f32, text_color: tiny_skia::Color) -> Self {
        let Some(style) = style else {
            return Self::default();
        };
        let outline = style
            .stroke_width
            .filter(|width| width.is_finite() && *width > 0.0)
            .and_then(|width| {
                let color = style.stroke_color.as_deref().and_then(color::parse)?;
                // Faded with the text, as the whole element fades on the canvas.
                let color = color::with_opacity(color, style.opacity);
                Some(Outline {
                    radius: (width as f32 * scale).min(MAX_OUTLINE_PX),
                    color,
                })
            })
            .filter(|outline| outline.radius >= 0.5);
        let shadow = style
            .shadow
            .as_deref()
            .and_then(|value| parse_css_shadow(value, scale))
            .map(|mut shadow| {
                // The shadow fades with the text too.
                shadow.color.apply_opacity(text_color.alpha());
                shadow
            });
        Self { outline, shadow }
    }

    /// How far past the text box the outline and shadow can reach.
    fn pad(&self) -> i32 {
        let outline = self.outline.map_or(0.0, |outline| outline.radius);
        let shadow = self.shadow.map_or(0.0, |shadow| {
            shadow.dx.abs().max(shadow.dy.abs()) + 3.0 * shadow.sigma.max(0.0)
        });
        if outline == 0.0 && shadow == 0.0 {
            return 0;
        }
        (outline + shadow).ceil() as i32 + 2
    }
}

/// An outline wider than this is a block, not an outline. Frame pixels.
const MAX_OUTLINE_PX: f32 = 48.0;

/// A CSS shadow, `dx dy [blur] [color]` in canvas pixels, optionally inside
/// `drop-shadow(...)`, scaled to the frame. `none`, empty or unreadable is no
/// shadow. A missing colour is the canvas's default, black at 35%.
fn parse_css_shadow(value: &str, scale: f32) -> Option<Shadow> {
    let trimmed = value.trim();
    if trimmed.is_empty() || trimmed.eq_ignore_ascii_case("none") {
        return None;
    }
    let inner = match trimmed.get(..12) {
        Some(prefix) if prefix.eq_ignore_ascii_case("drop-shadow(") => {
            trimmed[12..].trim_end().trim_end_matches(')')
        }
        _ => trimmed,
    };

    let mut rest = inner.trim();
    let mut lengths: Vec<f32> = Vec::with_capacity(3);
    while lengths.len() < 3 {
        let end = rest.find(char::is_whitespace).unwrap_or(rest.len());
        let token = &rest[..end];
        let number = token.strip_suffix("px").unwrap_or(token);
        match number.parse::<f32>() {
            Ok(length) if length.is_finite() => {
                lengths.push(length);
                rest = rest[end..].trim_start();
            }
            _ => break,
        }
    }
    if lengths.len() < 2 {
        return None;
    }
    let color = if rest.is_empty() {
        tiny_skia::Color::from_rgba8(0, 0, 0, 89)
    } else {
        color::parse(rest)?
    };
    Some(Shadow {
        dx: lengths[0] * scale,
        dy: lengths[1] * scale,
        // A CSS blur length is twice the Gaussian's standard deviation.
        sigma: lengths.get(2).copied().unwrap_or(0.0).max(0.0) * scale / 2.0,
        color,
    })
}

/// The maximum over each centred window of `2 * half + 1` values, into
/// `out`: van Herk / Gil-Werman, so its cost doesn't grow with the window.
fn sliding_max(row: &[u8], half: usize, out: &mut [u8]) {
    let n = row.len();
    if n == 0 {
        return;
    }
    if half == 0 {
        out[..n].copy_from_slice(row);
        return;
    }
    let size = 2 * half + 1;
    let mut forward = vec![0u8; n];
    let mut backward = vec![0u8; n];
    for i in 0..n {
        forward[i] = if i % size == 0 {
            row[i]
        } else {
            forward[i - 1].max(row[i])
        };
    }
    for i in (0..n).rev() {
        backward[i] = if i == n - 1 || (i + 1) % size == 0 {
            row[i]
        } else {
            backward[i + 1].max(row[i])
        };
    }
    for (x, slot) in out.iter_mut().enumerate().take(n) {
        let left = x.saturating_sub(half);
        let right = (x + half).min(n - 1);
        // Within one block, or across two: the suffix of the left block and
        // the prefix of the right.
        *slot = if left / size == right / size {
            row[left..=right].iter().copied().max().unwrap_or(0)
        } else {
            backward[left].max(forward[right])
        };
    }
}

/// `over`, with `tint` at `alpha` beneath it: premultiplied source-over.
fn over_tint(
    over: tiny_skia::PremultipliedColorU8,
    tint: tiny_skia::ColorU8,
    alpha: u32,
) -> tiny_skia::PremultipliedColorU8 {
    let inverse = 255 - u32::from(over.alpha());
    let below = |channel: u8| (u32::from(channel) * alpha + 127) / 255;
    let out_alpha = (u32::from(over.alpha()) + (alpha * inverse + 127) / 255).min(255) as u8;
    let mix = |top: u8, channel: u8| {
        ((u32::from(top) + (below(channel) * inverse + 127) / 255).min(u32::from(out_alpha))) as u8
    };
    tiny_skia::PremultipliedColorU8::from_rgba(
        mix(over.red(), tint.red()),
        mix(over.green(), tint.green()),
        mix(over.blue(), tint.blue()),
        out_alpha,
    )
    .unwrap_or(over)
}

/// Grow the ink by `radius` in every direction, in `color`, under the glyphs.
///
/// A disc of that radius, as the union of centred rows: each row a sliding
/// maximum as wide as the disc is at that height. The glyphs' own
/// anti-aliasing carries over to the outline's edge.
fn outline_under(
    scratch: &mut tiny_skia::Pixmap,
    ink: &mut InkBounds,
    radius: f32,
    color: tiny_skia::Color,
) {
    let Some((left, top, right, bottom)) = ink.area else {
        return;
    };
    let reach = radius.round().max(1.0) as i32;
    let (width, height) = (scratch.width() as i32, scratch.height() as i32);
    let (left, top) = ((left - reach).max(0), (top - reach).max(0));
    let (right, bottom) = (
        (right + reach).min(width - 1),
        (bottom + reach).min(height - 1),
    );
    let (region_width, region_height) = ((right - left + 1) as usize, (bottom - top + 1) as usize);
    let at = |x: usize, y: usize| (top as usize + y) * width as usize + left as usize + x;

    let pixels = scratch.pixels();
    let mut alpha = vec![0u8; region_width * region_height];
    for y in 0..region_height {
        for x in 0..region_width {
            alpha[y * region_width + x] = pixels.get(at(x, y)).map_or(0, |pixel| pixel.alpha());
        }
    }

    let mut grown = vec![0u8; region_width * region_height];
    let mut row_max = vec![0u8; region_width];
    for dy in -reach..=reach {
        let half = f64::from(reach * reach - dy * dy).sqrt().floor() as usize;
        for y in 0..region_height as i32 {
            let source = y + dy;
            if source < 0 || source >= region_height as i32 {
                continue;
            }
            let from = source as usize * region_width;
            sliding_max(&alpha[from..from + region_width], half, &mut row_max);
            let to = y as usize * region_width;
            for (slot, value) in grown[to..to + region_width].iter_mut().zip(&row_max) {
                *slot = (*slot).max(*value);
            }
        }
    }

    let tint = color.to_color_u8();
    let pixels = scratch.pixels_mut();
    for y in 0..region_height {
        for x in 0..region_width {
            let coverage = grown[y * region_width + x];
            if coverage == 0 {
                continue;
            }
            let Some(slot) = pixels.get_mut(at(x, y)) else {
                continue;
            };
            let outline_alpha = u32::from(coverage) * u32::from(tint.alpha()) / 255;
            *slot = over_tint(*slot, tint, outline_alpha);
        }
    }
    ink.include(left, top);
    ink.include(right, bottom);
}

/// A blurred, tinted, offset copy of everything in the scratch, beneath it.
/// Drawn in the element's own space, so it turns with a rotated box.
/// A shadow's picture: the coverage of `scratch` within `area` (left, top,
/// width, height), blurred by `sigma`, tinted, as premultiplied pixels the
/// size of `area`.
///
/// Only the coverage is blurred, not four channels, and a soft shadow is
/// blurred at a fraction of the size, then smoothed back up: a blur that wide
/// has no detail finer than the pixels it drops. Blurring the tinted
/// picture at full size was most of the time a themed slide took to draw,
/// about a tenth of a second for a line of words with a soft shadow, paid on
/// every slide change and twice at the start of every transition.
fn tinted_shadow(
    scratch: &tiny_skia::Pixmap,
    (left, top, region_width, region_height): (i32, i32, usize, usize),
    sigma: f32,
    tint: tiny_skia::ColorU8,
) -> Vec<tiny_skia::PremultipliedColorU8> {
    let transparent = tiny_skia::PremultipliedColorU8::TRANSPARENT;
    let mut region = vec![transparent; region_width * region_height];
    if region.is_empty() || tint.alpha() == 0 {
        return region;
    }

    let step = if sigma.is_finite() {
        (sigma / 1.5).floor().clamp(1.0, 6.0) as usize
    } else {
        1
    };
    let (small_width, small_height) = (region_width.div_ceil(step), region_height.div_ceil(step));

    // The coverage, summed into cells `step` pixels square. Outside the
    // scratch counts as nothing, as it does for a CSS shadow.
    let width = scratch.width() as usize;
    let height = scratch.height() as usize;
    let (left, top) = (left.max(0) as usize, top.max(0) as usize);
    let pixels = scratch.pixels();
    let mut coverage = vec![0.0_f32; small_width * small_height];
    let columns = region_width.min(width.saturating_sub(left));
    for y in 0..region_height.min(height.saturating_sub(top)) {
        let row = &pixels[(top + y) * width + left..(top + y) * width + left + columns];
        let cells = &mut coverage[(y / step) * small_width..(y / step + 1) * small_width];
        for (cell, run) in cells.iter_mut().zip(row.chunks(step)) {
            *cell += run
                .iter()
                .map(|pixel| u32::from(pixel.alpha()))
                .sum::<u32>() as f32;
        }
    }
    let per_cell = 1.0 / (step * step) as f32;
    for value in &mut coverage {
        *value *= per_cell;
    }

    blur_coverage(
        &mut coverage,
        small_width,
        small_height,
        sigma / step as f32,
    );

    // Back up to full size, between the cells, with where each column and
    // row falls between them worked out once.
    let between = |index: usize, cells: usize| -> (usize, usize, f32) {
        let at = ((index as f32 + 0.5) / step as f32 - 0.5).clamp(0.0, (cells - 1) as f32);
        let low = at.floor() as usize;
        (low, (low + 1).min(cells - 1), at - low as f32)
    };
    let across: Vec<(usize, usize, f32)> =
        (0..region_width).map(|x| between(x, small_width)).collect();
    let tint_alpha = f32::from(tint.alpha()) / 255.0;
    for y in 0..region_height {
        let (y0, y1, fy) = between(y, small_height);
        let upper = &coverage[y0 * small_width..(y0 + 1) * small_width];
        let lower = &coverage[y1 * small_width..(y1 + 1) * small_width];
        let out = &mut region[y * region_width..(y + 1) * region_width];
        for (pixel, &(x0, x1, fx)) in out.iter_mut().zip(&across) {
            let top_value = upper[x0] + (upper[x1] - upper[x0]) * fx;
            let bottom_value = lower[x0] + (lower[x1] - lower[x0]) * fx;
            let value = (top_value + (bottom_value - top_value) * fy) * tint_alpha;
            if value < 0.5 {
                continue;
            }
            let alpha = value.min(255.0) as u32;
            let premultiply = |channel: u8| ((u32::from(channel) * alpha + 127) / 255) as u8;
            *pixel = tiny_skia::PremultipliedColorU8::from_rgba(
                premultiply(tint.red()),
                premultiply(tint.green()),
                premultiply(tint.blue()),
                alpha as u8,
            )
            .unwrap_or(transparent);
        }
    }
    region
}

/// Blur one channel in place: three box blurs each way, within a few percent
/// of a Gaussian of the same deviation, with outside counting as nothing.
///
/// Rows, then columns swept a row at a time with a running sum per column, so
/// both directions read memory in order.
fn blur_coverage(values: &mut [f32], width: usize, height: usize, sigma: f32) {
    if width == 0
        || height == 0
        || values.len() != width * height
        || !sigma.is_finite()
        || sigma < 0.5
    {
        return;
    }
    let ideal = (4.0 * sigma * sigma + 1.0).sqrt();
    let radius = (((ideal - 1.0) / 2.0).round() as usize).max(1);
    let scale = 1.0 / (2 * radius + 1) as f32;
    let mut across = vec![0.0_f32; values.len()];
    let mut columns = vec![0.0_f32; width];

    for _ in 0..3 {
        for y in 0..height {
            let row = &values[y * width..(y + 1) * width];
            let out = &mut across[y * width..(y + 1) * width];
            let mut sum: f32 = row[..radius.min(width)].iter().sum();
            for x in 0..width {
                if x + radius < width {
                    sum += row[x + radius];
                }
                out[x] = sum * scale;
                if x >= radius {
                    sum -= row[x - radius];
                }
            }
        }

        columns.iter_mut().for_each(|value| *value = 0.0);
        for y in 0..radius.min(height) {
            for (sum, value) in columns.iter_mut().zip(&across[y * width..(y + 1) * width]) {
                *sum += value;
            }
        }
        for y in 0..height {
            if y + radius < height {
                let below = (y + radius) * width;
                for (sum, value) in columns.iter_mut().zip(&across[below..below + width]) {
                    *sum += value;
                }
            }
            for (out, sum) in values[y * width..(y + 1) * width].iter_mut().zip(&columns) {
                *out = (sum * scale).max(0.0);
            }
            if y >= radius {
                let above = (y - radius) * width;
                for (sum, value) in columns.iter_mut().zip(&across[above..above + width]) {
                    *sum -= value;
                }
            }
        }
    }
}

fn shadow_under(scratch: &mut tiny_skia::Pixmap, ink: &mut InkBounds, shadow: &Shadow) {
    let Some((left, top, right, bottom)) = ink.area else {
        return;
    };
    let spread = (shadow.sigma * 3.0).ceil() as i32 + 1;
    let (width, height) = (scratch.width() as i32, scratch.height() as i32);
    let (left, top) = ((left - spread).max(0), (top - spread).max(0));
    let (right, bottom) = (
        (right + spread).min(width - 1),
        (bottom + spread).min(height - 1),
    );
    let (region_width, region_height) = ((right - left + 1) as usize, (bottom - top + 1) as usize);

    let region = tinted_shadow(
        scratch,
        (left, top, region_width, region_height),
        shadow.sigma,
        shadow.color.to_color_u8(),
    );

    let (dx, dy) = (shadow.dx.round() as i32, shadow.dy.round() as i32);
    let pixels = scratch.pixels_mut();
    for y in 0..region_height as i32 {
        let target_y = top + y + dy;
        if target_y < 0 || target_y >= height {
            continue;
        }
        for x in 0..region_width as i32 {
            let target_x = left + x + dx;
            if target_x < 0 || target_x >= width {
                continue;
            }
            let cast = region[y as usize * region_width + x as usize];
            if cast.alpha() == 0 {
                continue;
            }
            let Some(slot) = pixels.get_mut((target_y * width + target_x) as usize) else {
                continue;
            };
            // Under a solid glyph a shadow cannot be seen; on nothing it is
            // itself.
            if slot.alpha() == 255 {
                continue;
            }
            if slot.alpha() == 0 {
                *slot = cast;
                continue;
            }
            let inverse = 255 - u32::from(slot.alpha());
            let mix = |top: u8, below: u8| {
                (u32::from(top) + (u32::from(below) * inverse + 127) / 255).min(255) as u8
            };
            *slot = tiny_skia::PremultipliedColorU8::from_rgba(
                mix(slot.red(), cast.red()),
                mix(slot.green(), cast.green()),
                mix(slot.blue(), cast.blue()),
                mix(slot.alpha(), cast.alpha()),
            )
            .unwrap_or(*slot);
        }
    }
    ink.include(
        (left + dx).clamp(0, width - 1),
        (top + dy).clamp(0, height - 1),
    );
    ink.include(
        (right + dx).clamp(0, width - 1),
        (bottom + dy).clamp(0, height - 1),
    );
}

/// The rectangle of a scratch pixmap that holds any ink, inclusive.
#[derive(Debug, Clone, Copy, Default)]
pub(super) struct InkBounds {
    area: Option<(i32, i32, i32, i32)>,
}

impl InkBounds {
    pub(super) fn include(&mut self, x: i32, y: i32) {
        self.area = Some(match self.area {
            None => (x, y, x, y),
            Some((left, top, right, bottom)) => {
                (left.min(x), top.min(y), right.max(x), bottom.max(y))
            }
        });
    }
}

/// Put rasterised text onto the destination.
///
/// An upright box — no rotation, flip or scale, which is nearly every text box
/// on a slide and every overlay — is a copy at an offset, and is done as one:
/// source-over of the inked rectangle only. `draw_pixmap` runs tiny-skia's
/// pipeline over every pixel of the scratch whether it holds ink or not, and
/// that was measured at 37 ms for a full-frame scratch holding nothing but a
/// countdown clock: the whole cost of the timer, paid once a second.
///
/// Anything rotated or mirrored still goes through `draw_pixmap`, which is
/// what interpolates it; without that the text crawls.
pub(super) fn composite(
    pixmap: &mut PixmapMut<'_>,
    scratch: &tiny_skia::Pixmap,
    ink: InkBounds,
    transform: Transform,
) {
    let Some((left, top, right, bottom)) = ink.area else {
        return;
    };

    if transform.has_scale() || transform.has_skew() {
        pixmap.draw_pixmap(
            0,
            0,
            scratch.as_ref(),
            &tiny_skia::PixmapPaint {
                quality: tiny_skia::FilterQuality::Bilinear,
                ..tiny_skia::PixmapPaint::default()
            },
            transform,
            None,
        );
        return;
    }

    // Where nearest-neighbour sampling puts source pixel 0 for a fractional
    // translation, so this lands exactly where `draw_pixmap` did.
    let dx = (transform.tx - 0.5).ceil() as i32;
    let dy = (transform.ty - 0.5).ceil() as i32;
    blit_over(
        pixmap,
        scratch.pixels(),
        scratch.width() as i32,
        (left, top, right, bottom),
        (dx, dy),
    );
}

/// Source-over the inclusive rectangle `area` of premultiplied `source` pixels
/// onto `pixmap`, moved by `offset`. Transparent pixels are skipped, which is
/// what makes a mostly empty scratch cheap.
fn blit_over(
    pixmap: &mut PixmapMut<'_>,
    source: &[tiny_skia::PremultipliedColorU8],
    source_width: i32,
    (left, top, right, bottom): (i32, i32, i32, i32),
    (dx, dy): (i32, i32),
) {
    let (dest_width, dest_height) = (pixmap.width() as i32, pixmap.height() as i32);
    let destination = pixmap.pixels_mut();

    for sy in top..=bottom {
        let y = sy + dy;
        if y < 0 || y >= dest_height {
            continue;
        }
        for sx in left..=right {
            let x = sx + dx;
            if x < 0 || x >= dest_width {
                continue;
            }
            let Some(over) = source.get((sy * source_width + sx) as usize) else {
                continue;
            };
            let alpha = over.alpha();
            if alpha == 0 {
                continue;
            }
            let Some(under) = destination.get_mut((y * dest_width + x) as usize) else {
                continue;
            };
            if alpha == 255 {
                *under = *over;
                continue;
            }
            let inverse = 255 - u32::from(alpha);
            let mix = |src: u8, dst: u8| -> u8 {
                (u32::from(src) + (u32::from(dst) * inverse + 127) / 255).min(255) as u8
            };
            *under = tiny_skia::PremultipliedColorU8::from_rgba(
                mix(over.red(), under.red()),
                mix(over.green(), under.green()),
                mix(over.blue(), under.blue()),
                (u32::from(alpha) + (u32::from(under.alpha()) * inverse + 127) / 255).min(255)
                    as u8,
            )
            .unwrap_or(*under);
        }
    }
}

/// How a block of free text is set: the parts of CSS the audience window's own
/// text layers use, which are not a slide element's.
#[derive(Debug, Clone)]
pub struct TextStyle {
    pub font_size: f32,
    /// Line box height in pixels, as CSS `line-height` resolves it.
    pub line_height: f32,
    pub family: Option<String>,
    pub weight: Weight,
    pub italic: bool,
    /// CSS `letter-spacing`, in em.
    pub letter_spacing_em: f32,
    pub align: Align,
    /// Wrap at words, breaking a word only when it cannot fit — CSS
    /// `overflow-wrap: break-word`. Off sets one line however long it is.
    pub wrap: bool,
}

/// A drop shadow, as CSS `drop-shadow(dx dy blur color)` describes one.
#[derive(Debug, Clone, Copy)]
pub struct Shadow {
    pub dx: f32,
    pub dy: f32,
    /// The Gaussian's standard deviation: half the CSS blur length.
    pub sigma: f32,
    pub color: tiny_skia::Color,
}

/// The family name to hand cosmic-text: the one asked for, or an instance of it
/// at the optical size `font_size` is drawn at when it is a variable font with
/// that axis. `None` for the default family.
pub(super) fn resolve_family(
    system: &mut FontSystem,
    optical: &mut OpticalSizes,
    family: Option<&str>,
    weight: Weight,
    italic: bool,
    font_size: f32,
) -> Option<String> {
    let family = family.map(str::trim).filter(|name| !name.is_empty())?;
    // A font this computer does not have is drawn in the closest one it does.
    let family = super::font_fallback::resolve(system, family);
    Some(
        optical
            .family_for(system, &family, weight, italic, font_size)
            .unwrap_or(family),
    )
}

fn attrs_for<'a>(style: &TextStyle, family: Option<&'a str>) -> Attrs<'a> {
    let mut attrs = Attrs::new().weight(style.weight);
    if style.italic {
        attrs = attrs.style(Style::Italic);
    }
    if style.letter_spacing_em != 0.0 && style.letter_spacing_em.is_finite() {
        attrs = attrs.letter_spacing(style.letter_spacing_em);
    }
    if let Some(family) = family {
        attrs = attrs.family(Family::Name(family));
    }
    attrs
}

fn lay_out(
    system: &mut FontSystem,
    optical: &mut OpticalSizes,
    text: &str,
    width: Option<f32>,
    style: &TextStyle,
) -> Buffer {
    let font_size = style.font_size.max(1.0);
    let family = resolve_family(
        system,
        optical,
        style.family.as_deref(),
        style.weight,
        style.italic,
        font_size,
    );
    let line_height = if style.line_height > 0.0 {
        style.line_height
    } else {
        font_size * DEFAULT_LINE_HEIGHT
    };
    let mut buffer = Buffer::new(system, Metrics::new(font_size, line_height));
    // No height: a height makes `layout_runs` stop at it, and a measurement
    // that stops where it was told to cannot say the text overflows.
    buffer.set_size(width.filter(|_| style.wrap), None);
    buffer.set_wrap(if style.wrap {
        Wrap::WordOrGlyph
    } else {
        Wrap::None
    });
    buffer.set_text(
        text,
        &attrs_for(style, family.as_deref()),
        Shaping::Advanced,
        Some(style.align),
    );
    buffer.shape_until_scroll(system, false);
    buffer
}

fn extent(buffer: &Buffer) -> (f32, f32) {
    buffer
        .layout_runs()
        .fold((0.0_f32, 0.0_f32), |(height, width), run| {
            (
                height.max(run.line_top + run.line_height),
                width.max(run.line_w),
            )
        })
}

/// The height `text` takes laid out `width` wide, and its widest line.
pub fn measure(text: &str, width: f32, style: &TextStyle) -> (f32, f32) {
    let Ok(mut fonts) = fonts().lock() else {
        return (0.0, 0.0);
    };
    let Fonts {
        system, optical, ..
    } = &mut *fonts;
    let buffer = lay_out(system, optical, text, Some(width), style);
    extent(&buffer)
}

/// Draw `text` laid out `width` wide with its top-left corner at `(x, y)`.
///
/// `shadow` is drawn under the text, from the text's own coverage. `squeeze`
/// is Canvas `fillText`'s `maxWidth`: a line wider than it is scaled
/// horizontally about `anchor_x` until it fits, rather than wrapped.
pub fn draw_paragraph(
    pixmap: &mut PixmapMut<'_>,
    text: &str,
    (x, y, width): (f32, f32, f32),
    style: &TextStyle,
    color: tiny_skia::Color,
    shadow: Option<&Shadow>,
    squeeze: Option<(f32, f32)>,
) {
    if width <= 0.0 || text.trim().is_empty() {
        return;
    }
    let Ok(mut fonts) = fonts().lock() else {
        tracing::error!("the font system is poisoned; skipping text");
        return;
    };
    let Fonts {
        system,
        cache,
        optical,
    } = &mut *fonts;
    let mut buffer = lay_out(system, optical, text, Some(width), style);
    let (_, widest) = extent(&buffer);

    // A squeezed line is rasterised whole, into a scratch as wide as the line,
    // and scaled into place afterwards. Rasterised where it lands, the part
    // wider than the frame would be cut off before it was scaled down.
    let squeeze = squeeze.filter(|(max_width, _)| *max_width > 0.0 && widest > *max_width);
    let (x, scratch_width) = match squeeze {
        Some(_) => (1.0, widest.ceil() as u32 + 2),
        None => (x, pixmap.width()),
    };
    let Some(mut scratch) = tiny_skia::Pixmap::new(scratch_width.max(1), pixmap.height().max(1))
    else {
        return;
    };
    let scratch_width = scratch.width() as i32;
    let scratch_height = scratch.height() as i32;
    let base = color.to_color_u8();
    let base_alpha = f32::from(base.alpha()) / 255.0;
    let mut ink = InkBounds::default();

    buffer.draw(
        system,
        cache,
        cosmic_text::Color::rgba(255, 255, 255, 255),
        |glyph_x, glyph_y, w, h, coverage| {
            let alpha = f32::from(coverage.a()) / 255.0 * base_alpha;
            if alpha <= 0.0 {
                return;
            }
            for row in 0..h as i32 {
                for col in 0..w as i32 {
                    let px = x as i32 + glyph_x + col;
                    let py = y as i32 + glyph_y + row;
                    if px < 0 || py < 0 || px >= scratch_width || py >= scratch_height {
                        continue;
                    }
                    ink.include(px, py);
                    blend(
                        &mut scratch,
                        (py * scratch_width + px) as usize,
                        base.red(),
                        base.green(),
                        base.blue(),
                        alpha,
                    );
                }
            }
        },
    );
    drop(fonts);

    // Canvas `fillText` squeezes about its alignment point: centred on
    // `anchor_x`, the line's own centre lands there.
    let transform = match squeeze {
        Some((max_width, anchor_x)) => {
            let scale = max_width / widest;
            Transform::from_translate(anchor_x - scale * (widest / 2.0 + 1.0), 0.0)
                .pre_scale(scale, 1.0)
        }
        None => Transform::identity(),
    };

    if let Some(shadow) = shadow {
        draw_shadow(pixmap, &scratch, ink, shadow, transform);
    }
    composite(pixmap, &scratch, ink, transform);
}

/// A blurred, tinted, offset copy of the text's coverage, under the text.
fn draw_shadow(
    pixmap: &mut PixmapMut<'_>,
    scratch: &tiny_skia::Pixmap,
    ink: InkBounds,
    shadow: &Shadow,
    transform: Transform,
) {
    let Some((left, top, right, bottom)) = ink.area else {
        return;
    };
    let sigma = shadow.sigma.max(0.0);
    let pad = (sigma * 3.0).ceil() as i32 + 1;
    let (width, height) = (scratch.width() as i32, scratch.height() as i32);
    let (left, top) = ((left - pad).max(0), (top - pad).max(0));
    let (right, bottom) = ((right + pad).min(width - 1), (bottom + pad).min(height - 1));
    let (region_width, region_height) = ((right - left + 1) as usize, (bottom - top + 1) as usize);

    let region = tinted_shadow(
        scratch,
        (left, top, region_width, region_height),
        sigma,
        shadow.color.to_color_u8(),
    );

    let offset = (
        left + (transform.tx + shadow.dx).round() as i32,
        top + (transform.ty + shadow.dy).round() as i32,
    );
    blit_over(
        pixmap,
        &region,
        region_width as i32,
        (0, 0, region_width as i32 - 1, region_height as i32 - 1),
        offset,
    );
}

/// Source-over one glyph pixel into the scratch buffer.
///
/// tiny-skia stores premultiplied pixels, so the source is multiplied by its
/// own coverage before being added to what the destination keeps.
pub(super) fn blend(
    scratch: &mut tiny_skia::Pixmap,
    index: usize,
    r: u8,
    g: u8,
    b: u8,
    alpha: f32,
) {
    let pixels = scratch.pixels_mut();
    let Some(slot) = pixels.get_mut(index) else {
        return;
    };

    let src_a = alpha.clamp(0.0, 1.0);
    // Nothing under it yet, which is nearly every pixel of a glyph: the colour
    // itself at this coverage, without mixing in the nothing below.
    if slot.alpha() == 0 {
        let premultiply = |channel: u8| (f32::from(channel) * src_a).round() as u8;
        *slot = tiny_skia::PremultipliedColorU8::from_rgba(
            premultiply(r),
            premultiply(g),
            premultiply(b),
            (src_a * 255.0).round() as u8,
        )
        .unwrap_or(*slot);
        return;
    }
    let inverse = 1.0 - src_a;

    let mix = |src: u8, dst: u8| -> u8 {
        (f32::from(src) * src_a + f32::from(dst) * inverse)
            .round()
            .clamp(0.0, 255.0) as u8
    };

    let out_a = (src_a + f32::from(slot.alpha()) / 255.0 * inverse).clamp(0.0, 1.0);
    let out = tiny_skia::ColorU8::from_rgba(
        mix(r, slot.red()),
        mix(g, slot.green()),
        mix(b, slot.blue()),
        (out_a * 255.0).round() as u8,
    );
    *slot = out.premultiply();
}

/// Add font files to the font stack: the fonts installed in the app, and a
/// deck's embedded fonts as it is imported. A file already loaded is loaded
/// again harmlessly; one that is not a font is skipped.
pub fn load_font_files(paths: &[std::path::PathBuf]) {
    let Ok(mut fonts) = fonts().lock() else {
        return;
    };
    for path in paths {
        if let Err(error) = fonts.system.db_mut().load_font_file(path) {
            tracing::warn!(%error, path = %path.display(), "a font could not be loaded for the screens");
        }
    }
    super::font_fallback::forget();
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

    #[test]
    fn a_css_shadow_reads_as_the_canvas_reads_it() {
        let shadow = parse_css_shadow("0 4px 12px rgba(0,0,0,0.8)", 1.0).expect("shadow");
        assert_eq!((shadow.dx, shadow.dy, shadow.sigma), (0.0, 4.0, 6.0));
        assert!((shadow.color.alpha() - 0.8).abs() < 0.01);

        let wrapped = parse_css_shadow("drop-shadow(2px -3px 4px #ff0000)", 2.0).expect("shadow");
        assert_eq!((wrapped.dx, wrapped.dy, wrapped.sigma), (4.0, -6.0, 4.0));

        let default_colour = parse_css_shadow("1 1", 1.0).expect("shadow");
        assert!((default_colour.color.alpha() - 0.35).abs() < 0.01);

        for none in ["", "none", "NONE", "soft", "1px"] {
            assert!(parse_css_shadow(none, 1.0).is_none(), "{none:?}");
        }
    }

    #[test]
    fn the_sliding_maximum_matches_the_slow_one() {
        let row: Vec<u8> = (0..97u32).map(|i| ((i * 37 + 11) % 251) as u8).collect();
        let mut out = vec![0u8; row.len()];
        for half in 0..9 {
            sliding_max(&row, half, &mut out);
            for (x, got) in out.iter().enumerate() {
                let from = x.saturating_sub(half);
                let to = (x + half).min(row.len() - 1);
                let expected = row[from..=to].iter().copied().max().unwrap();
                assert_eq!(*got, expected, "half {half}, x {x}");
            }
        }
    }

    fn count_pixels(frame: &Frame, test: impl Fn(u8, u8, u8) -> bool) -> usize {
        (0..frame.height())
            .flat_map(|y| (0..frame.width()).map(move |x| (x, y)))
            .filter_map(|(x, y)| frame.pixel_at(x, y))
            .filter(|(r, g, b, _)| test(*r, *g, *b))
            .count()
    }

    #[test]
    fn an_outline_is_drawn_around_the_glyphs() {
        let plain = render(json!({
            "id": "a", "type": "text",
            "x": 0.0, "y": 0.0, "width": 400.0, "height": 200.0,
            "content": "Grace",
            "style": { "fontSize": 60.0, "color": "#ffffff" }
        }));
        let outlined = render(json!({
            "id": "a", "type": "text",
            "x": 0.0, "y": 0.0, "width": 400.0, "height": 200.0,
            "content": "Grace",
            "style": { "fontSize": 60.0, "color": "#ffffff", "strokeColor": "#ff0000", "strokeWidth": 3.0 }
        }));
        let red = |r: u8, g: u8, b: u8| r > 150 && g < 90 && b < 90;
        assert_eq!(count_pixels(&plain, red), 0);
        assert!(count_pixels(&outlined, red) > 150, "no outline pixels");
        // The glyphs are still white on top of it.
        assert!(count_pixels(&outlined, |r, g, b| r > 220 && g > 220 && b > 220) > 100);
    }

    #[test]
    fn the_coverage_blur_spreads_evenly_and_loses_nothing() {
        let (width, height) = (41, 41);
        let mut values = vec![0.0_f32; width * height];
        values[20 * width + 20] = 1000.0;
        blur_coverage(&mut values, width, height, 4.0);
        let total: f32 = values.iter().sum();
        assert!(
            (total - 1000.0).abs() < 1.0,
            "the shadow's weight is kept: {total}"
        );
        let at = |x: usize, y: usize| values[y * width + x];
        assert!(
            at(20, 20) > at(24, 20) && at(24, 20) > at(28, 20),
            "it falls away from the middle"
        );
        assert!(
            (at(16, 20) - at(24, 20)).abs() < 1e-3,
            "and the same each way"
        );
        assert!((at(20, 16) - at(20, 24)).abs() < 1e-3);
    }

    #[test]
    fn a_soft_shadow_drawn_small_matches_one_blurred_at_full_size() {
        // Blurred at a quarter of the size and smoothed back up, a soft
        // shadow has to look like the one blurred at full size, which cost a
        // tenth of a second for a line of words.
        let mut scratch = tiny_skia::Pixmap::new(200, 120).expect("scratch");
        for y in 40..80 {
            for x in 30..170 {
                scratch.pixels_mut()[y * 200 + x] =
                    tiny_skia::PremultipliedColorU8::from_rgba(255, 255, 255, 255).expect("pixel");
            }
        }
        let tint = tiny_skia::ColorU8::from_rgba(0, 0, 0, 200);
        let sigma = 6.0;
        let fast = tinted_shadow(&scratch, (0, 0, 200, 120), sigma, tint);

        let mut reference: Vec<tiny_skia::PremultipliedColorU8> = scratch
            .pixels()
            .iter()
            .map(|pixel| {
                let alpha = (u32::from(pixel.alpha()) * 200 + 127) / 255;
                tiny_skia::PremultipliedColorU8::from_rgba(0, 0, 0, alpha as u8).expect("pixel")
            })
            .collect();
        super::super::filters::blur(&mut reference, 200, 120, sigma, 1.0);

        let differences: Vec<i32> = fast
            .iter()
            .zip(&reference)
            .map(|(a, b)| (i32::from(a.alpha()) - i32::from(b.alpha())).abs())
            .collect();
        let mean = differences.iter().sum::<i32>() as f32 / differences.len() as f32;
        let worst = differences.iter().copied().max().unwrap_or(0);
        assert!(mean < 2.0, "on average within a level or two: {mean}");
        assert!(worst < 16, "and nowhere far off: {worst}");
    }

    #[test]
    fn a_shadow_falls_below_the_glyphs() {
        let frame = render(json!({
            "id": "a", "type": "text",
            "x": 0.0, "y": 0.0, "width": 400.0, "height": 200.0,
            "content": "Grace",
            "style": { "fontSize": 60.0, "color": "#ffffff", "shadow": "0 8px 0 #00ff00", "verticalAlign": "top" }
        }));
        let green = |r: u8, g: u8, b: u8| g > 150 && r < 100 && b < 100;
        assert!(count_pixels(&frame, green) > 100, "no shadow pixels");
        // Green only shows where the shadow is not under white glyphs, so the
        // lowest green row is lower than the lowest white one.
        let lowest = |test: &dyn Fn(u8, u8, u8) -> bool| {
            (0..frame.height())
                .rev()
                .find(|&y| {
                    (0..frame.width()).any(|x| {
                        frame
                            .pixel_at(x, y)
                            .is_some_and(|(r, g, b, _)| test(r, g, b))
                    })
                })
                .unwrap_or(0)
        };
        let white = |r: u8, g: u8, b: u8| r > 220 && g > 220 && b > 220;
        assert!(
            lowest(&green) > lowest(&white),
            "the shadow isn't below the text"
        );
    }

    #[test]
    fn no_shadow_or_outline_leaves_the_box_as_it_was() {
        assert_eq!(TextEffects::default().pad(), 0);
        let style = SlideElementStyle {
            shadow: Some("none".into()),
            stroke_width: Some(0.0),
            stroke_color: Some("#fff".into()),
            ..SlideElementStyle::default()
        };
        assert_eq!(
            TextEffects::of(Some(&style), 1.0, tiny_skia::Color::WHITE).pad(),
            0
        );
    }

    /// The average red and blue of the ink in a column band.
    fn red_and_blue_in_columns(frame: &Frame, from_x: u32, to_x: u32) -> (f64, f64) {
        let (mut red, mut blue, mut count) = (0.0, 0.0, 0.0);
        for y in 0..frame.height() {
            for x in from_x..to_x.min(frame.width()) {
                if let Some((r, g, b, _)) = frame.pixel_at(x, y) {
                    if r > 40 || g > 40 || b > 40 {
                        red += f64::from(r);
                        blue += f64::from(b);
                        count += 1.0;
                    }
                }
            }
        }
        assert!(count > 0.0, "no ink between {from_x} and {to_x}");
        (red / count, blue / count)
    }

    #[test]
    fn a_gradient_runs_across_the_words_as_the_canvas_draws_it() {
        let frame = render(json!({
            "id": "a", "type": "text",
            "x": 0.0, "y": 0.0, "width": 400.0, "height": 200.0,
            "content": "MMMMMMMMMMMM",
            "style": {
                "fontSize": 48.0, "textFillMode": "gradient",
                "gradientFromColor": "#ff0000", "gradientToColor": "#0000ff", "gradientAngle": 0.0
            }
        }));
        let (left_red, left_blue) = red_and_blue_in_columns(&frame, 0, 200);
        let (right_red, right_blue) = red_and_blue_in_columns(&frame, 200, 400);
        assert!(
            left_red > right_red,
            "red fades left to right: {left_red} then {right_red}"
        );
        assert!(
            right_blue > left_blue,
            "blue grows left to right: {left_blue} then {right_blue}"
        );
    }

    #[test]
    fn a_gradient_meets_the_box_where_the_canvas_puts_it() {
        let style: SlideElementStyle = serde_json::from_value(json!({
            "textFillMode": "gradient",
            "gradientFromColor": "#000000", "gradientToColor": "#ffffff", "gradientAngle": 0.0
        }))
        .expect("style");
        let gradient = TextGradient::of(Some(&style), 100.0, 50.0).expect("a gradient");
        // The line reaches the longer side past the middle each way, so the
        // box itself spans the middle half of it.
        assert_eq!(gradient.at(50.0, 25.0).0, 128);
        assert_eq!(gradient.at(0.0, 25.0).0, 64);
        assert_eq!(gradient.at(100.0, 25.0).0, 191);
    }

    #[test]
    fn a_gradient_missing_a_colour_is_the_plain_colour() {
        let style: SlideElementStyle = serde_json::from_value(json!({
            "textFillMode": "gradient", "gradientFromColor": "#ff0000", "color": "#00ff00"
        }))
        .expect("style");
        assert!(TextGradient::of(Some(&style), 100.0, 50.0).is_none());
    }

    /// The columns and rows ink lands in: its left, right, top and bottom.
    fn ink_extent(frame: &Frame) -> (u32, u32, u32, u32) {
        let (mut left, mut right, mut top, mut bottom) = (u32::MAX, 0, u32::MAX, 0);
        for y in 0..frame.height() {
            for x in 0..frame.width() {
                if let Some((r, g, b, _)) = frame.pixel_at(x, y) {
                    if r > 40 || g > 40 || b > 40 {
                        left = left.min(x);
                        right = right.max(x);
                        top = top.min(y);
                        bottom = bottom.max(y);
                    }
                }
            }
        }
        (left, right, top, bottom)
    }

    fn words(style: serde_json::Value, content: &str) -> Frame {
        render(json!({
            "id": "a", "type": "text",
            "x": 0.0, "y": 0.0, "width": 400.0, "height": 200.0,
            "content": content,
            "style": style
        }))
    }

    #[test]
    fn letter_spacing_spreads_the_words() {
        let (left, right, _, _) = ink_extent(&words(json!({ "fontSize": 24.0 }), "spacing"));
        let (wide_left, wide_right, _, _) = ink_extent(&words(
            json!({ "fontSize": 24.0, "letterSpacing": 8.0 }),
            "spacing",
        ));
        assert!(
            wide_right - wide_left > right - left + 30,
            "{} against {}",
            wide_right - wide_left,
            right - left
        );
    }

    #[test]
    fn line_height_spreads_the_lines() {
        let (_, _, top, bottom) = ink_extent(&words(json!({ "fontSize": 24.0 }), "one\ntwo"));
        let (_, _, tall_top, tall_bottom) = ink_extent(&words(
            json!({ "fontSize": 24.0, "lineHeight": 2.4 }),
            "one\ntwo",
        ));
        assert!(
            tall_bottom - tall_top > bottom - top + 15,
            "{} against {}",
            tall_bottom - tall_top,
            bottom - top
        );
    }

    #[test]
    fn an_underline_is_drawn_under_the_words() {
        let (_, _, _, bottom) = ink_extent(&words(json!({ "fontSize": 30.0 }), "mm"));
        let (_, _, _, underlined) = ink_extent(&words(
            json!({ "fontSize": 30.0, "textDecoration": "underline" }),
            "mm",
        ));
        assert!(underlined > bottom, "{underlined} against {bottom}");
        let (_, _, _, from_flag) = ink_extent(&words(
            json!({ "fontSize": 30.0, "fontUnderline": true }),
            "mm",
        ));
        assert_eq!(from_flag, underlined, "fontUnderline is the same line");
    }

    #[test]
    fn title_case_and_first_letters_match_the_canvas() {
        assert_eq!(
            capitalize("amazing grace, how sweet", Some("titleCase")),
            "Amazing Grace, How Sweet"
        );
        assert_eq!(capitalize("it's well", Some("titleCase")), "It's Well");
        assert_eq!(
            capitalize("  holy\n(and) true", Some("lineStart")),
            "  Holy\n(And) true"
        );
    }
}
