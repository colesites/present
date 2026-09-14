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
struct Fonts {
    system: FontSystem,
    cache: SwashCache,
    /// Variable fonts instanced at the optical size they are drawn at.
    optical: OpticalSizes,
}

fn fonts() -> &'static Mutex<Fonts> {
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
    let Some(mut scratch) =
        tiny_skia::Pixmap::new((width.ceil() as u32).max(1), (height.ceil() as u32).max(1))
    else {
        return;
    };
    let scratch_width = scratch.width() as i32;
    let scratch_height = scratch.height() as i32;

    let base = text_color.to_color_u8();
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

    composite(pixmap, &scratch, ink, viewport.element_transform(element));
}

/// The rectangle of a scratch pixmap that holds any ink, inclusive.
#[derive(Debug, Clone, Copy, Default)]
struct InkBounds {
    area: Option<(i32, i32, i32, i32)>,
}

impl InkBounds {
    fn include(&mut self, x: i32, y: i32) {
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
fn composite(
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
fn resolve_family(
    system: &mut FontSystem,
    optical: &mut OpticalSizes,
    family: Option<&str>,
    weight: Weight,
    italic: bool,
    font_size: f32,
) -> Option<String> {
    let family = family.map(str::trim).filter(|name| !name.is_empty())?;
    Some(
        optical
            .family_for(system, family, weight, italic, font_size)
            .unwrap_or_else(|| family.to_owned()),
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

    let tint = shadow.color.to_color_u8();
    let source = scratch.pixels();
    let mut region = Vec::with_capacity(region_width * region_height);
    for sy in top..=bottom {
        for sx in left..=right {
            let coverage = source
                .get((sy * width + sx) as usize)
                .map_or(0, |pixel| pixel.alpha());
            let alpha = (u32::from(coverage) * u32::from(tint.alpha()) + 127) / 255;
            let premultiply = |channel: u8| ((u32::from(channel) * alpha + 127) / 255) as u8;
            region.push(
                tiny_skia::PremultipliedColorU8::from_rgba(
                    premultiply(tint.red()),
                    premultiply(tint.green()),
                    premultiply(tint.blue()),
                    alpha as u8,
                )
                .unwrap_or(tiny_skia::PremultipliedColorU8::TRANSPARENT),
            );
        }
    }
    super::filters::blur(&mut region, region_width, region_height, sigma, 1.0);

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
fn blend(scratch: &mut tiny_skia::Pixmap, index: usize, r: u8, g: u8, b: u8, alpha: f32) {
    let pixels = scratch.pixels_mut();
    let Some(slot) = pixels.get_mut(index) else {
        return;
    };

    let src_a = alpha.clamp(0.0, 1.0);
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
