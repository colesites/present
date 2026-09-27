//! What sits above the slide: messages, props and the timer.
//!
//! Ports the three overlay layers of `OutputWindow.tsx` onto the compositor's
//! primitives. They differ from slide elements in one way that runs through
//! everything here: **they are positioned against the frame, not against the
//! deck's canvas.** A message banner spans the output whatever size the deck
//! was authored at, and its font is `min(5vw, 56px)` rather than a number in
//! canvas units. So they take frame pixels directly rather than going through
//! `Viewport`.
//!
//! Props come in kinds, and only some are ours. An image or a text prop is
//! drawn here; a YouTube embed, an NDI feed or a capture device belongs to the
//! webview layer above the composited surface, per ADR-001's amendment. Those
//! are counted as deferred, exactly like a `web` slide element, so a caller can
//! tell "nothing to draw" from "drawn by somebody else".

use tiny_skia::{Color, PixmapMut, Transform};

use crate::services::output::{MessageOverlay, OutputScene, PropsOverlayItem, TimerLayout};

use super::scene::MediaLoader;
use super::{color, images, shapes, text};

/// The banner's vertical padding, as the React layer's `py-4` in a 1080p frame.
/// The screen the operator's pixel sizes are chosen against.
///
/// Everything drawn at a size in pixels is scaled by this frame's height over
/// this, so the same settings look the same on a preview, a 1080 projector and
/// a 4K wall.
const REFERENCE_HEIGHT: f32 = 1080.0;

const MESSAGE_PADDING_RATIO: f32 = 16.0 / 1080.0;

/// `min(6vw, 64px)` at 1080p, the static banner's font size.
const MESSAGE_FONT_VW: f32 = 0.06;
const MESSAGE_FONT_MAX_RATIO: f32 = 64.0 / 1080.0;

/// Props inset from the edge by 3%, matching `getPropSlotStyle`.
const PROP_INSET_RATIO: f32 = 0.03;

/// What a message overlay's theme paints.
///
/// Ported case for case from `getOverlayThemeStyle`. An unknown key falls to
/// the same default the React layer uses rather than painting nothing, because
/// a message the operator sent and the congregation cannot see is worse than
/// one in the wrong colour.
fn theme_colors(theme_key: &str) -> (Option<Color>, Color) {
    let white = Color::WHITE;
    let near_black = Color::from_rgba8(17, 17, 17, 255);

    match theme_key {
        "warning" => (Some(Color::from_rgba8(245, 158, 11, 235)), near_black),
        "info" => (Some(Color::from_rgba8(37, 99, 235, 235)), white),
        "danger" => (Some(Color::from_rgba8(220, 38, 38, 235)), white),
        // Transparent keeps the text and drops the plate; the React layer adds
        // a text shadow there, which the compositor does not draw yet.
        "transparent" => (None, white),
        _ => (Some(Color::from_rgba8(15, 15, 18, 217)), white),
    }
}

/// Where a message's band sits and what it is painted with, in frame pixels.
struct MessageBand {
    top: f32,
    height: f32,
    padding: f32,
    font_size: f32,
    plate: Option<Color>,
    ink: Color,
}

fn message_band(overlay: &MessageOverlay, width: f32, height: f32) -> MessageBand {
    // Six percent of the width, capped at the height's share — 64px on a
    // 1080-tall frame. The cap used to multiply the two terms together, which
    // squares a number already in pixels: on any real frame it came out in the
    // thousands, so the cap never bound and every message was drawn at the
    // full six percent of the width. At 1920 that is 115px before the
    // operator's own scale is applied on top.
    let font_size = (width * MESSAGE_FONT_VW)
        .min(height * MESSAGE_FONT_MAX_RATIO)
        .max(12.0);

    let scale = if overlay.font_scale.is_finite() && overlay.font_scale > 0.0 {
        overlay.font_scale as f32
    } else {
        1.0
    };
    // The band is sized around the text that actually goes in it. It used to
    // be measured from the unscaled size, so an operator who set the font to
    // 140% got text 40% taller than the colour behind it — the banner looked
    // like it was covering the wrong height because the text had outgrown it.
    let scaled_font = font_size * scale;
    let padding = height * MESSAGE_PADDING_RATIO;
    let band_height = scaled_font * 1.4 + padding * 2.0;

    let top = if overlay.position == "top" {
        0.0
    } else {
        (height - band_height).max(0.0)
    };

    let (plate, ink) = theme_colors(&overlay.theme_key);
    MessageBand {
        top,
        height: band_height,
        padding,
        font_size: scaled_font,
        plate,
        ink,
    }
}

/// Whether a message scrolls rather than standing still.
pub fn is_moving(overlay: &MessageOverlay) -> bool {
    matches!(overlay.animation.as_str(), "marquee-left" | "marquee-right")
}

/// Draw the message banner, if there is one.
///
/// A scrolling message is drawn where it is `elapsed_seconds` after it was
/// sent. The compositor does not come here for one: it keeps the words as a
/// [`MarqueeStrip`] and only moves them, frame by frame. A one-off frame can.
pub fn draw_message(pixmap: &mut PixmapMut<'_>, overlay: &MessageOverlay, elapsed_seconds: f64) {
    if overlay.text.trim().is_empty() {
        return;
    }
    draw_message_plate(pixmap, overlay);

    if is_moving(overlay) {
        if let Some(strip) = MarqueeStrip::new(overlay, pixmap.width(), pixmap.height()) {
            strip.draw(pixmap, overlay, elapsed_seconds);
        }
        return;
    }

    let width = pixmap.width() as f32;
    let band = message_band(overlay, width, pixmap.height() as f32);
    // Standing still: centred in the band.
    let spec = text::TextBox::new(
        band.padding,
        band.top + band.padding,
        (width - band.padding * 2.0).max(1.0),
        (band.height - band.padding * 2.0).max(1.0),
        band.font_size,
    )
    .centred()
    .with_color(band.ink)
    .with_weight(cosmic_text::Weight::SEMIBOLD);
    text::draw_box(pixmap, &overlay.text, &spec);
}

/// The band behind a message, without its words: what stays put while a
/// scrolling message moves across it.
pub fn draw_message_plate(pixmap: &mut PixmapMut<'_>, overlay: &MessageOverlay) {
    if overlay.text.trim().is_empty() {
        return;
    }
    let width = pixmap.width() as f32;
    let band = message_band(overlay, width, pixmap.height() as f32);
    let Some(plate) = band.plate else {
        return;
    };
    if let Some(path) = shapes::rounded_rect_path(0.0, band.top, width, band.height, 0.0) {
        let mut paint = tiny_skia::Paint {
            anti_alias: false,
            ..tiny_skia::Paint::default()
        };
        paint.set_color(plate);
        pixmap.fill_path(
            &path,
            &paint,
            tiny_skia::FillRule::Winding,
            Transform::identity(),
            None,
        );
    }
}

/// Room around the words in a [`MarqueeStrip`], for the edges of glyphs that
/// reach past their advance and for the filtering of a part-pixel move.
const STRIP_MARGIN: u32 = 2;

/// The widest a scrolling message's words are kept drawn. A paragraph at a
/// large size on a 4K wall would be hundreds of megabytes past this, so one
/// that long is laid out again each frame instead.
const MAX_STRIP_WIDTH: u32 = 16_384;

/// A scrolling message's words, drawn once, to be slid along its band.
///
/// Scrolling used to redraw the whole overlay layer thirty times a second,
/// laying the words out and rasterising them each time over a layer the size
/// of the frame, and put them wherever the clock said at the moment of the
/// redraw. On an output drawing sixty frames a second, each position was held
/// for one frame, or two, or three: the stutter an operator sees. Now the
/// words are drawn once, and every frame puts them where they are at that
/// instant, to a fraction of a pixel.
pub struct MarqueeStrip {
    /// The words over transparency, as wide as they are, or `None` when that
    /// is wider than [`MAX_STRIP_WIDTH`].
    words: Option<tiny_skia::Pixmap>,
    line: String,
    text_width: f32,
    /// Where the top of the words sits in the frame, on a whole pixel so a
    /// move blurs nothing vertically.
    top: f32,
    frame_width: f32,
    style: text::TextStyle,
    ink: Color,
}

impl MarqueeStrip {
    pub fn new(overlay: &MessageOverlay, frame_width: u32, frame_height: u32) -> Option<Self> {
        if overlay.text.trim().is_empty() || !is_moving(overlay) {
            return None;
        }
        let width = frame_width as f32;
        let band = message_band(overlay, width, frame_height as f32);
        let style = text::TextStyle {
            font_size: band.font_size,
            line_height: 0.0,
            family: None,
            weight: cosmic_text::Weight::SEMIBOLD,
            italic: false,
            letter_spacing_em: 0.0,
            align: cosmic_text::Align::Left,
            wrap: false,
        };
        // One line, however long: a scrolling message is read as it passes.
        // Laid out as wide as the frame, a long one used to wrap onto lines
        // below the band.
        let line = overlay
            .text
            .split_whitespace()
            .collect::<Vec<_>>()
            .join(" ");
        let (text_height, text_width) = text::measure(&line, width.max(1.0), &style);
        if text_width <= 0.0 {
            return None;
        }
        let top = (band.top + ((band.height - text_height) / 2.0).max(0.0)).round();

        let margin = STRIP_MARGIN as f32;
        let strip_width = text_width.ceil() as u32 + STRIP_MARGIN * 2;
        let strip_height = text_height.ceil().max(1.0) as u32 + STRIP_MARGIN * 2;
        let words = if strip_width <= MAX_STRIP_WIDTH {
            tiny_skia::Pixmap::new(strip_width, strip_height).map(|mut words| {
                text::draw_paragraph(
                    &mut words.as_mut(),
                    &line,
                    (margin, margin, text_width + 1.0),
                    &style,
                    band.ink,
                    None,
                    None,
                );
                words
            })
        } else {
            None
        };

        Some(Self {
            words,
            line,
            text_width,
            top,
            frame_width: width,
            style,
            ink: band.ink,
        })
    }

    /// Where the left edge of the words is, `elapsed_seconds` after the
    /// message was sent.
    fn x_at(&self, overlay: &MessageOverlay, elapsed_seconds: f64) -> f64 {
        // A nonsense or missing speed falls back to ten seconds rather than
        // dividing by zero.
        let seconds = if overlay.speed_seconds.is_finite() && overlay.speed_seconds > 0.1 {
            overlay.speed_seconds
        } else {
            10.0
        };
        let frame_width = f64::from(self.frame_width);
        let text_width = f64::from(self.text_width);
        // Twice the frame's width in `speed_seconds`, the pace the setting has
        // always meant. The words come in from one edge and are gone past the
        // other before they come round again, so a longer message takes
        // longer, rather than moving faster.
        let pace = frame_width * 2.0 / seconds;
        let travel = (frame_width + text_width).max(1.0);
        let gone = (elapsed_seconds.max(0.0) * pace).rem_euclid(travel);
        if overlay.animation == "marquee-right" {
            gone - text_width
        } else {
            frame_width - gone
        }
    }

    /// Draw the words where they are `elapsed_seconds` after the message was
    /// sent.
    pub fn draw(&self, pixmap: &mut PixmapMut<'_>, overlay: &MessageOverlay, elapsed_seconds: f64) {
        let x = self.x_at(overlay, elapsed_seconds) as f32;
        match &self.words {
            Some(words) => {
                let margin = STRIP_MARGIN as f32;
                let paint = tiny_skia::PixmapPaint {
                    quality: tiny_skia::FilterQuality::Bilinear,
                    ..tiny_skia::PixmapPaint::default()
                };
                pixmap.draw_pixmap(
                    0,
                    0,
                    words.as_ref(),
                    &paint,
                    Transform::from_translate(x - margin, self.top - margin),
                    None,
                );
            }
            None => text::draw_paragraph(
                pixmap,
                &self.line,
                (x, self.top, self.text_width + 1.0),
                &self.style,
                self.ink,
                None,
                None,
            ),
        }
    }
}

/// Where a prop sits, in frame pixels.
fn prop_rect(
    position: &str,
    size_percent: f64,
    frame_width: f32,
    frame_height: f32,
) -> (f32, f32, f32, f32) {
    let size = (size_percent.clamp(5.0, 100.0) / 100.0) as f32;
    let inset_x = frame_width * PROP_INSET_RATIO;
    let inset_y = frame_height * PROP_INSET_RATIO;

    // Width is the percentage; height follows 16:9, which is what an
    // `aspect-video` box does in the React layer.
    let width = frame_width * size;
    let height = width * 9.0 / 16.0;

    match position {
        "top-left" => (inset_x, inset_y, width, height),
        "top-right" => (frame_width - inset_x - width, inset_y, width, height),
        "bottom-left" => (inset_x, frame_height - inset_y - height, width, height),
        "bottom-right" => (
            frame_width - inset_x - width,
            frame_height - inset_y - height,
            width,
            height,
        ),
        "center" => (
            (frame_width - width) / 2.0,
            (frame_height - height) / 2.0,
            width,
            height,
        ),
        // "full" and anything unrecognised cover the frame, matching the
        // React layer's default arm.
        _ => (0.0, 0.0, frame_width, frame_height),
    }
}

/// Is this prop kind something the compositor draws?
///
/// `youtube`, `ndi` and `capture` are browsers or live feeds and belong to the
/// webview layer above (ADR-001's amendment). Drawing anything in their place
/// would cover them.
fn is_composited(kind: &str) -> bool {
    matches!(kind, "image" | "text" | "media")
}

/// How many props were drawn, and how many were left to the layer above.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub struct PropsDrawn {
    pub drawn: usize,
    pub deferred: usize,
}

/// Draw the props overlay.
pub fn draw_props(
    pixmap: &mut PixmapMut<'_>,
    props: &[PropsOverlayItem],
    loader: &dyn MediaLoader,
) -> PropsDrawn {
    let mut counts = PropsDrawn::default();
    let frame_width = pixmap.width() as f32;
    let frame_height = pixmap.height() as f32;

    for prop in props {
        if !is_composited(&prop.kind) {
            counts.deferred += 1;
            continue;
        }

        let (x, y, width, height) =
            prop_rect(&prop.position, prop.size_percent, frame_width, frame_height);
        if width <= 0.0 || height <= 0.0 {
            continue;
        }

        let opacity = if prop.opacity.is_finite() {
            prop.opacity.clamp(0.0, 1.0)
        } else {
            1.0
        };
        if opacity <= 0.0 {
            continue;
        }

        if prop.kind == "text" {
            let Some(body) = prop.text.as_deref().filter(|text| !text.trim().is_empty()) else {
                continue;
            };
            let ink = prop
                .color
                .as_deref()
                .and_then(color::parse)
                .unwrap_or(Color::WHITE);

            let font_size = prop
                .font_size
                .filter(|size| size.is_finite() && *size > 0.0)
                .map(|size| size as f32)
                .unwrap_or(frame_height * 0.05);

            let spec = text::TextBox::new(x, y, width, height, font_size)
                .centred()
                .with_color(color::with_opacity(ink, Some(opacity)));
            text::draw_box(pixmap, body, &spec);
            counts.drawn += 1;
            continue;
        }

        // Image and media props both resolve to a bitmap through the loader.
        let Some(url) = prop
            .image_url
            .as_deref()
            .or(prop.media_url.as_deref())
            .filter(|url| !url.is_empty())
        else {
            continue;
        };
        let Some(bytes) = loader.load(url) else {
            continue;
        };
        let Some(decoded) = images::decode(&bytes) else {
            continue;
        };

        images::draw(
            pixmap,
            &decoded,
            Transform::from_translate(x, y),
            width,
            height,
            images::ObjectFit::Contain,
            Some(opacity),
        );
        counts.drawn += 1;
    }

    counts
}

/// How long a blinking "time up" is lit in each second.
const TIME_UP_LIT_MS: u128 = 600;

/// Whether the timer shows a "time up" that blinks.
pub fn timer_blinks(scene: &OutputScene) -> bool {
    scene.timer_visible
        && scene
            .timer_time_up
            .as_ref()
            .is_some_and(|style| style.blink)
}

/// Whether the timer's words are lit at `now_ms`, milliseconds since the Unix
/// epoch: always, unless a "time up" blinks, which is lit for most of each
/// second. By the wall clock, so the screen and the preview blink together.
pub fn timer_lit(scene: &OutputScene, now_ms: u128) -> bool {
    !timer_blinks(scene) || now_ms % 1000 < TIME_UP_LIT_MS
}

/// The clock's colour: the "time up" one once the timer has run out.
fn clock_ink(scene: &OutputScene, fallback: Color) -> Color {
    scene
        .timer_time_up
        .as_ref()
        .and_then(|style| color::parse(&style.color))
        .unwrap_or(fallback)
}

/// Draw the timer, if it is showing.
///
/// The clock sits at a percentage of the frame, which is how the operator
/// positions it by dragging. The name banner, when enabled, spans the top
/// independently of where the clock is.
pub fn draw_timer(pixmap: &mut PixmapMut<'_>, scene: &OutputScene, layout: Option<&TimerLayout>) {
    draw_timer_at(pixmap, scene, layout, true);
}

/// [`draw_timer`], with the clock's words left out while a blinking "time
/// up" is dark (`lit` false). The name and the box behind stay.
pub fn draw_timer_at(
    pixmap: &mut PixmapMut<'_>,
    scene: &OutputScene,
    layout: Option<&TimerLayout>,
    lit: bool,
) {
    if !scene.timer_visible {
        return;
    }

    let frame_width = pixmap.width() as f32;
    let frame_height = pixmap.height() as f32;

    let clamp = |value: f64, low: f64, high: f64| -> f32 {
        if value.is_finite() {
            value.clamp(low, high) as f32
        } else {
            low as f32
        }
    };

    let x_percent = layout.map_or(50.0, |l| clamp(l.x_percent, 0.0, 100.0));
    let y_percent = layout.map_or(50.0, |l| clamp(l.y_percent, 0.0, 100.0));
    // Sizes are chosen against a 1080-tall screen and drawn in proportion to
    // whatever frame this is. The preview is the same picture at a fraction of
    // the size, so an absolute 96px clock filled it while looking modest on
    // the wall — the operator could not judge from the preview what the
    // congregation would see. It also means a 4K output scales up rather than
    // shrinking into a corner.
    let of_reference = frame_height / REFERENCE_HEIGHT;
    let clock_font = layout.map_or(96.0, |l| clamp(l.clock_font_px, 12.0, 400.0)) * of_reference;

    let clock_color = clock_ink(
        scene,
        layout
            .and_then(|l| color::parse(&l.clock_color))
            .unwrap_or(Color::WHITE),
    );

    // The box behind the clock, when one is chosen: around the clock, and the
    // name too when it sits with the clock rather than in its banner.
    if let (Some(fill), Some(clock)) = (
        layout
            .and_then(|l| l.box_color.as_deref())
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .and_then(color::parse),
        scene.timer_text.as_deref().filter(|t| !t.trim().is_empty()),
    ) {
        let name = scene
            .timer_label
            .as_deref()
            .filter(|l| !l.trim().is_empty())
            .filter(|_| !layout.is_some_and(|l| l.name_banner_enabled));
        let name_font = layout.map_or(24.0, |l| clamp(l.name_font_px, 8.0, 200.0)) * of_reference;
        let above = layout.is_some_and(|l| l.title_position == "top");
        let width_of = |words: &str, size: f32, weight: cosmic_text::Weight| {
            text::measure(
                words,
                frame_width,
                &text::TextStyle {
                    font_size: size,
                    line_height: 0.0,
                    family: None,
                    weight,
                    italic: false,
                    letter_spacing_em: 0.0,
                    align: cosmic_text::Align::Left,
                    wrap: false,
                },
            )
            .1
        };
        let centre_x = frame_width * x_percent / 100.0;
        let centre_y = frame_height * y_percent / 100.0;
        let mut width = width_of(clock, clock_font, cosmic_text::Weight::BOLD);
        let (mut top, mut bottom) = (centre_y - clock_font * 0.6, centre_y + clock_font * 0.6);
        if let Some(name) = name {
            width = width.max(width_of(name, name_font, cosmic_text::Weight::NORMAL));
            // Where the name is drawn below: a box 1.6 of its size tall, a
            // little way above or below the clock's.
            let (clock_box, name_box, gap) = (clock_font * 1.6, name_font * 1.6, name_font * 0.3);
            let name_top = if above {
                centre_y - clock_box / 2.0 - gap - name_box
            } else {
                centre_y + clock_box / 2.0 + gap
            };
            let name_middle = name_top + name_box / 2.0;
            top = top.min(name_middle - name_font * 0.6);
            bottom = bottom.max(name_middle + name_font * 0.6);
        }
        let (pad_x, pad_y) = (clock_font * 0.25, clock_font * 0.12);
        let rect = (
            centre_x - width / 2.0 - pad_x,
            top - pad_y,
            width + pad_x * 2.0,
            bottom - top + pad_y * 2.0,
        );
        if let Some(path) =
            shapes::rounded_rect_path(rect.0, rect.1, rect.2, rect.3, clock_font * 0.12)
        {
            let mut paint = tiny_skia::Paint {
                anti_alias: true,
                ..tiny_skia::Paint::default()
            };
            paint.set_color(fill);
            pixmap.fill_path(
                &path,
                &paint,
                tiny_skia::FillRule::Winding,
                Transform::identity(),
                None,
            );
        }
    }

    if let Some(clock) = scene
        .timer_text
        .as_deref()
        .filter(|t| !t.trim().is_empty())
        .filter(|_| lit)
    {
        // The clock is centred on its point, so the box is built around it
        // rather than starting at it.
        let box_width = frame_width;
        let box_height = clock_font * 1.6;
        // Both percentages place the *centre* of the clock, which is what the
        // operator drags. A full-width centred box shifted onto that point puts
        // the text there without measuring it first.
        let spec = text::TextBox::new(
            (frame_width * x_percent / 100.0) - box_width / 2.0,
            (frame_height * y_percent / 100.0) - box_height / 2.0,
            box_width,
            box_height,
            clock_font,
        )
        .centred()
        .with_color(clock_color)
        .with_weight(cosmic_text::Weight::BOLD);

        text::draw_box(pixmap, clock, &spec);
    }

    let banner_enabled = layout.is_some_and(|l| l.name_banner_enabled);
    let Some(label) = scene
        .timer_label
        .as_deref()
        .filter(|l| !l.trim().is_empty())
    else {
        return;
    };
    let ink = layout
        .and_then(|l| color::parse(&l.name_color))
        .unwrap_or(Color::WHITE);
    let name_font = layout.map_or(24.0, |l| clamp(l.name_font_px, 8.0, 200.0)) * of_reference;
    let above = layout.is_some_and(|l| l.title_position == "top");

    // Without the banner the name still belongs on the screen, next to the
    // clock it names. It used to return here instead, so the name and the size
    // chosen for it only ever appeared if the operator also turned the banner
    // on — the size control looked broken because the thing it sized was not
    // being drawn.
    if !banner_enabled {
        let clock_box = clock_font * 1.6;
        let name_box = name_font * 1.6;
        let centre_y = frame_height * y_percent / 100.0;
        let gap = name_font * 0.3;
        let top = if above {
            centre_y - clock_box / 2.0 - gap - name_box
        } else {
            centre_y + clock_box / 2.0 + gap
        };
        let spec = text::TextBox::new(
            (frame_width * x_percent / 100.0) - frame_width / 2.0,
            top,
            frame_width,
            name_box,
            name_font,
        )
        .centred()
        .with_color(ink);
        text::draw_box(pixmap, label, &spec);
        return;
    }

    let banner_height =
        layout.map_or(48.0, |l| clamp(l.name_banner_height_px, 0.0, 400.0)) * of_reference;
    if banner_height <= 0.0 {
        return;
    }

    let top = if above {
        0.0
    } else {
        (frame_height - banner_height).max(0.0)
    };

    if let Some(banner) = layout.and_then(|l| color::parse(&l.name_banner_color)) {
        if let Some(path) = shapes::rounded_rect_path(0.0, top, frame_width, banner_height, 0.0) {
            let mut paint = tiny_skia::Paint {
                anti_alias: false,
                ..tiny_skia::Paint::default()
            };
            paint.set_color(banner);
            pixmap.fill_path(
                &path,
                &paint,
                tiny_skia::FillRule::Winding,
                Transform::identity(),
                None,
            );
        }
    }

    let spec = text::TextBox::new(0.0, top, frame_width, banner_height, name_font)
        .centred()
        .with_color(ink);
    text::draw_box(pixmap, label, &spec);
}

/// A composer region's plate: its colour, inside its padding, with its
/// corners rounded, as the output window's region box draws it.
pub fn draw_region_plate(
    pixmap: &mut PixmapMut<'_>,
    region: &super::composer::ComposerRegion,
    frame_width: f32,
    frame_height: f32,
) {
    let Some((x, y, width, height)) = region.inner_rect(frame_width, frame_height) else {
        return;
    };
    let Some(plate) = region
        .background_color
        .as_deref()
        .filter(|value| !value.trim().eq_ignore_ascii_case("transparent"))
        .and_then(color::parse)
    else {
        return;
    };
    fill_rounded(
        pixmap,
        (x, y, width, height),
        region.radius(frame_height),
        plate,
    );
}

/// A rectangle of colour with rounded corners.
fn fill_rounded(
    pixmap: &mut PixmapMut<'_>,
    (x, y, width, height): (f32, f32, f32, f32),
    radius: f32,
    fill: Color,
) {
    let Some(path) =
        shapes::rounded_rect_path(x, y, width, height, radius.min(width.min(height) / 2.0))
    else {
        return;
    };
    let mut paint = tiny_skia::Paint {
        anti_alias: true,
        ..tiny_skia::Paint::default()
    };
    paint.set_color(fill);
    pixmap.fill_path(
        &path,
        &paint,
        tiny_skia::FillRule::Winding,
        Transform::identity(),
        None,
    );
}

/// A still in a composer region, fitted inside its plate as the region's fit
/// mode says. `false` when it could not be read.
pub fn draw_region_image(
    pixmap: &mut PixmapMut<'_>,
    region: &super::composer::ComposerRegion,
    url: &str,
    loader: &dyn MediaLoader,
    frame_width: f32,
    frame_height: f32,
) -> bool {
    let Some((x, y, width, height)) = region.inner_rect(frame_width, frame_height) else {
        return false;
    };
    let Some(decoded) = loader.load(url).and_then(|bytes| images::decode(&bytes)) else {
        return false;
    };
    images::draw(
        pixmap,
        &decoded,
        Transform::from_translate(x, y),
        width,
        height,
        region.fit_mode.to_object_fit(),
        None,
    );
    true
}

/// A countdown region's clock, and the timer's name above it.
///
/// Sized to the region: the clock as large as fits a third of its height or
/// most of its width, the name about a third of that.
pub fn draw_region_clock(
    pixmap: &mut PixmapMut<'_>,
    region: &super::composer::ComposerRegion,
    scene: &OutputScene,
    clock: &str,
    lit: bool,
    frame_width: f32,
    frame_height: f32,
) {
    let label = scene.timer_label.as_deref();
    let Some((x, y, width, height)) = region.inner_rect(frame_width, frame_height) else {
        return;
    };
    let characters = clock.chars().count().max(4) as f32;
    let clock_size = (height * 0.34).min(width * 1.7 / characters).max(10.0);
    let label = label.map(str::trim).filter(|value| !value.is_empty());
    let label_size = (clock_size * 0.3).max(8.0);
    let gap = clock_size * 0.15;
    let block = clock_size * 1.2 + label.map_or(0.0, |_| label_size * 1.2 + gap);
    let top = y + ((height - block) / 2.0).max(0.0);

    if let Some(label) = label {
        let spec = text::TextBox::new(x, top, width, label_size * 1.3, label_size)
            .centred()
            .with_color(Color::from_rgba8(212, 212, 216, 255));
        text::draw_box(pixmap, &label.to_uppercase(), &spec);
    }
    if !lit {
        return;
    }
    let clock_top = top + label.map_or(0.0, |_| label_size * 1.2 + gap);
    let spec = text::TextBox::new(x, clock_top, width, clock_size * 1.3, clock_size)
        .centred()
        .with_color(clock_ink(scene, Color::WHITE))
        .with_weight(cosmic_text::Weight::SEMIBOLD);
    text::draw_box(pixmap, clock, &spec);
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::services::compositor::scene::NoMedia;
    use crate::services::compositor::Frame;

    fn message(position: &str, theme: &str, text: &str) -> MessageOverlay {
        MessageOverlay {
            id: "m1".to_owned(),
            text: text.to_owned(),
            position: position.to_owned(),
            theme_key: theme.to_owned(),
            shown_at_ms: 0.0,
            dismiss_mode: "manual".to_owned(),
            animation: "none".to_owned(),
            speed_seconds: 0.0,
            font_scale: 1.0,
        }
    }

    fn ink_in_rows(frame: &Frame, from: u32, to: u32) -> usize {
        let mut count = 0;
        for y in from..to.min(frame.height()) {
            for x in 0..frame.width() {
                if let Some((r, g, b, _)) = frame.pixel_at(x, y) {
                    if r > 40 || g > 40 || b > 40 {
                        count += 1;
                    }
                }
            }
        }
        count
    }

    #[test]
    fn a_top_banner_lands_at_the_top_and_a_bottom_one_at_the_bottom() {
        // The one thing an operator notices instantly if it is wrong.
        let mut top = Frame::new(640, 360).expect("frame");
        draw_message(
            &mut top.pixmap_mut(),
            &message("top", "info", "Cry room open"),
            0.0,
        );

        let mut bottom = Frame::new(640, 360).expect("frame");
        draw_message(
            &mut bottom.pixmap_mut(),
            &message("bottom", "info", "Cry room open"),
            0.0,
        );

        assert!(ink_in_rows(&top, 0, 90) > ink_in_rows(&top, 270, 360));
        assert!(ink_in_rows(&bottom, 270, 360) > ink_in_rows(&bottom, 0, 90));
    }

    #[test]
    fn the_banner_grows_with_the_font_the_operator_chose() {
        // The colour behind the text is sized from the text that goes in it.
        // Measured from the unscaled size, a message set to 140% had text
        // taller than its own banner, which read as the banner covering the
        // wrong height.
        let band_rows = |scale: f64| {
            let mut frame = Frame::new(320, 180).expect("frame");
            let mut overlay = message("top", "info", "Offering is by transfer");
            overlay.font_scale = scale;
            draw_message(&mut frame.pixmap_mut(), &overlay, 0.0);
            // The frame starts opaque black, so the plate is found by colour:
            // every row at the left edge that is no longer black is banner.
            (0..180)
                .filter(|row| {
                    frame
                        .pixel_at(2, *row)
                        .is_some_and(|(r, g, b, _)| r > 0 || g > 0 || b > 0)
                })
                .count()
        };
        let plain = band_rows(1.0);
        let larger = band_rows(1.4);
        assert!(plain > 0, "a banner is drawn at all");
        assert!(
            larger > plain,
            "a larger font needs a taller banner: {plain} then {larger}"
        );
    }

    #[test]
    fn a_marquee_moves_across_the_frame_over_time() {
        // Same message, three moments: the text must be somewhere different
        // each time, or it is not scrolling.
        let ink_at = |elapsed: f64| {
            let mut frame = Frame::new(320, 180).expect("frame");
            let mut overlay = message("top", "transparent", "Offering by transfer");
            overlay.animation = "marquee-left".to_owned();
            overlay.speed_seconds = 6.0;
            draw_message(&mut frame.pixmap_mut(), &overlay, elapsed);
            (0..320)
                .filter(|column| {
                    (0..40).any(|row| {
                        frame
                            .pixel_at(*column, row)
                            .is_some_and(|(r, g, b, _)| r > 40 || g > 40 || b > 40)
                    })
                })
                .collect::<Vec<_>>()
        };

        let early = ink_at(0.5);
        let later = ink_at(3.0);
        assert!(!early.is_empty() && !later.is_empty(), "the text is drawn");
        assert_ne!(early, later, "and it is somewhere else a moment later");
    }

    #[test]
    fn a_marquee_moves_a_little_every_frame_not_in_jumps() {
        // Sixty frames a second, one second of them: the words must move on
        // every frame, and by about the same amount each time. Scrolling was
        // redrawn thirty times a second, at whatever instant the redraw fell
        // on, so frames repeated and then leapt.
        let mut overlay = message("top", "transparent", "Offering by transfer");
        overlay.animation = "marquee-left".to_owned();
        overlay.speed_seconds = 8.0;
        let strip = MarqueeStrip::new(&overlay, 640, 360).expect("a strip");
        let steps: Vec<f64> = (0..60)
            .map(|frame| {
                let at = |n: f64| strip.x_at(&overlay, 1.0 + n / 60.0);
                at(f64::from(frame)) - at(f64::from(frame + 1))
            })
            .collect();
        let expected = 640.0 * 2.0 / 8.0 / 60.0;
        for step in steps {
            assert!(
                (step - expected).abs() < 0.001,
                "each frame moves {expected:.3}px, one moved {step:.3}px"
            );
        }
    }

    #[test]
    fn a_long_scrolling_message_stays_on_one_line_in_its_band() {
        // Laid out as wide as the frame, a long message wrapped, and its
        // second line was drawn below the banner, over the slide.
        let mut overlay = message(
            "top",
            "info",
            "The car park by the east doors is full, please use the overflow lot across the road",
        );
        overlay.animation = "marquee-left".to_owned();
        let mut frame = Frame::new(320, 180).expect("frame");
        draw_message(&mut frame.pixmap_mut(), &overlay, 3.0);
        let band = message_band(&overlay, 320.0, 180.0);
        let below = (band.height.ceil() as u32 + 2).min(180);
        assert!(
            ink_in_rows(&frame, 0, below) > 0,
            "the words are in the band"
        );
        assert_eq!(ink_in_rows(&frame, below, 180), 0, "and nothing under it");
    }

    #[test]
    fn a_message_scrolling_right_comes_in_from_the_left() {
        let mut overlay = message("top", "transparent", "Welcome");
        overlay.animation = "marquee-right".to_owned();
        overlay.speed_seconds = 10.0;
        let strip = MarqueeStrip::new(&overlay, 640, 360).expect("a strip");
        let start = strip.x_at(&overlay, 0.0);
        assert!(start < 0.0, "it starts off the left edge, at {start}");
        assert!(strip.x_at(&overlay, 1.0) > start, "and moves right");
    }

    #[test]
    fn a_still_message_does_not_move() {
        let ink_at = |elapsed: f64| {
            let mut frame = Frame::new(320, 180).expect("frame");
            draw_message(
                &mut frame.pixmap_mut(),
                &message("top", "transparent", "Offering by transfer"),
                elapsed,
            );
            (0..320)
                .filter(|column| {
                    (0..40).any(|row| {
                        frame
                            .pixel_at(*column, row)
                            .is_some_and(|(r, g, b, _)| r > 40 || g > 40 || b > 40)
                    })
                })
                .collect::<Vec<_>>()
        };
        assert_eq!(ink_at(0.0), ink_at(30.0), "a static message stays put");
    }

    #[test]
    fn each_theme_paints_its_own_plate() {
        // Ported case for case from `getOverlayThemeStyle`. A theme silently
        // falling back would send the wrong signal on a warning message.
        let mut warning = Frame::new(320, 180).expect("frame");
        draw_message(
            &mut warning.pixmap_mut(),
            &message("top", "warning", "Move your car"),
            0.0,
        );
        // Sampled at the band's left edge, inside the padding: the centre is
        // where the text goes, and the band is only as tall as the text now.
        let (r, g, b, _) = warning.pixel_at(2, 2).expect("pixel");
        assert!(
            r > 200 && g > 120 && b < 80,
            "amber expected, got {r},{g},{b}"
        );

        let mut danger = Frame::new(320, 180).expect("frame");
        draw_message(
            &mut danger.pixmap_mut(),
            &message("top", "danger", "Evacuate"),
            0.0,
        );
        let (r, g, b, _) = danger.pixel_at(2, 2).expect("pixel");
        assert!(r > 180 && g < 90 && b < 90, "red expected, got {r},{g},{b}");
    }

    #[test]
    fn a_transparent_theme_draws_no_plate() {
        let mut frame = Frame::new(320, 180).expect("frame");
        draw_message(
            &mut frame.pixmap_mut(),
            &message("top", "transparent", "Quiet"),
            0.0,
        );

        // The corner of the banner band, away from where the centred text goes.
        assert_eq!(frame.pixel_at(2, 2), Some((0, 0, 0, 255)));
    }

    #[test]
    fn an_unknown_theme_still_shows_the_message() {
        // A message the operator sent and the congregation cannot see is worse
        // than one in the wrong colour.
        let mut frame = Frame::new(320, 180).expect("frame");
        draw_message(
            &mut frame.pixmap_mut(),
            &message("top", "seafoam", "Notice"),
            0.0,
        );

        assert!(ink_in_rows(&frame, 0, 60) > 0, "nothing was drawn");
    }

    #[test]
    fn an_empty_message_draws_nothing() {
        for text in ["", "   "] {
            let mut frame = Frame::new(320, 180).expect("frame");
            draw_message(&mut frame.pixmap_mut(), &message("top", "info", text), 0.0);
            assert_eq!(ink_in_rows(&frame, 0, 180), 0, "{text:?} drew something");
        }
    }

    fn prop(kind: &str, position: &str) -> PropsOverlayItem {
        PropsOverlayItem {
            id: "p1".to_owned(),
            kind: kind.to_owned(),
            media_id: None,
            image_url: None,
            media_url: None,
            youtube_url: None,
            ndi_source_name: None,
            capture_device_id: None,
            capture_device_label: None,
            shown_at_ms: None,
            text: Some("Give thanks".to_owned()),
            position: position.to_owned(),
            opacity: 1.0,
            size_percent: 30.0,
            color: Some("#ffffff".to_owned()),
            font_size: Some(24.0),
        }
    }

    #[test]
    fn live_feed_props_are_left_to_the_webview_layer() {
        // ADR-001's amendment. Drawing anything in their place would cover the
        // layer above.
        let mut frame = Frame::new(320, 180).expect("frame");
        let props = vec![
            prop("youtube", "full"),
            prop("ndi", "full"),
            prop("capture", "full"),
        ];

        let counts = draw_props(&mut frame.pixmap_mut(), &props, &NoMedia);
        assert_eq!(
            counts,
            PropsDrawn {
                drawn: 0,
                deferred: 3
            }
        );
        assert_eq!(
            frame.pixel_at(160, 90),
            Some((0, 0, 0, 255)),
            "nothing painted"
        );
    }

    #[test]
    fn a_text_prop_lands_in_its_corner() {
        let mut frame = Frame::new(640, 360).expect("frame");
        let counts = draw_props(
            &mut frame.pixmap_mut(),
            &[prop("text", "top-left")],
            &NoMedia,
        );

        assert_eq!(counts.drawn, 1);
        let top_left = ink_in_rows(&frame, 0, 120);
        let bottom = ink_in_rows(&frame, 240, 360);
        assert!(top_left > bottom, "the prop is not in the top-left");
    }

    #[test]
    fn prop_positions_are_distinct() {
        // Four corners that all resolve to the same rectangle would look like
        // one prop and be very hard to spot.
        let rects: Vec<(f32, f32, f32, f32)> = [
            "top-left",
            "top-right",
            "bottom-left",
            "bottom-right",
            "center",
        ]
        .iter()
        .map(|position| prop_rect(position, 30.0, 1920.0, 1080.0))
        .collect();

        for (index, first) in rects.iter().enumerate() {
            for second in rects.iter().skip(index + 1) {
                assert_ne!(first, second, "two prop slots share a rectangle");
            }
        }
    }

    #[test]
    fn a_full_prop_covers_the_frame() {
        assert_eq!(
            prop_rect("full", 30.0, 1920.0, 1080.0),
            (0.0, 0.0, 1920.0, 1080.0)
        );
        // An unrecognised position takes the same arm the React layer's default
        // does, rather than vanishing.
        assert_eq!(
            prop_rect("nowhere", 30.0, 1920.0, 1080.0),
            (0.0, 0.0, 1920.0, 1080.0)
        );
    }

    #[test]
    fn a_fully_transparent_prop_is_skipped() {
        let mut frame = Frame::new(320, 180).expect("frame");
        let mut invisible = prop("text", "full");
        invisible.opacity = 0.0;

        let counts = draw_props(&mut frame.pixmap_mut(), &[invisible], &NoMedia);
        assert_eq!(counts.drawn, 0);
        assert_eq!(ink_in_rows(&frame, 0, 180), 0);
    }

    fn timer_scene(visible: bool, clock: &str, label: &str) -> OutputScene {
        OutputScene {
            timer_visible: visible,
            timer_text: Some(clock.to_owned()),
            timer_label: Some(label.to_owned()),
            ..OutputScene::default()
        }
    }

    fn layout() -> TimerLayout {
        TimerLayout {
            x_percent: 50.0,
            y_percent: 50.0,
            clock_font_px: 64.0,
            name_font_px: 24.0,
            name_banner_height_px: 48.0,
            clock_color: "#ffffff".to_owned(),
            name_color: "#ffffff".to_owned(),
            name_banner_enabled: false,
            name_banner_color: "#000000".to_owned(),
            title_position: "bottom".to_owned(),
            box_color: None,
        }
    }

    #[test]
    fn the_clock_has_a_box_behind_it_only_when_one_is_chosen() {
        let scene = OutputScene {
            timer_visible: true,
            timer_text: Some("05:00".to_owned()),
            ..OutputScene::default()
        };
        // Sampled beside the digits, inside where a box would be.
        let beside_the_clock = |layout: &TimerLayout| {
            let mut frame = Frame::new(640, 360).expect("frame");
            draw_timer(&mut frame.pixmap_mut(), &scene, Some(layout));
            frame.pixel_at(320, 160)
        };
        assert_eq!(
            beside_the_clock(&layout()),
            Some((0, 0, 0, 255)),
            "no box by default, as the screens drew it"
        );
        let boxed = TimerLayout {
            box_color: Some("#ff0000".to_owned()),
            ..layout()
        };
        let mut frame = Frame::new(640, 360).expect("frame");
        draw_timer(&mut frame.pixmap_mut(), &scene, Some(&boxed));
        let reds = frame
            .pixmap()
            .pixels()
            .iter()
            .filter(|pixel| pixel.red() > 200 && pixel.green() < 60)
            .count();
        assert!(reds > 800, "a red box around the clock: {reds} red pixels");
        let corner = frame.pixel_at(2, 2);
        assert_eq!(corner, Some((0, 0, 0, 255)), "only around the clock");
    }

    #[test]
    fn a_time_up_is_drawn_in_its_colour_and_blinks_by_the_clock() {
        let scene = OutputScene {
            timer_visible: true,
            timer_text: Some("TIME UP".to_owned()),
            timer_time_up: Some(crate::services::output::TimeUpStyle {
                color: "#ff0000".to_owned(),
                blink: true,
            }),
            ..OutputScene::default()
        };
        let reds = |lit: bool| {
            let mut frame = Frame::new(640, 360).expect("frame");
            draw_timer_at(&mut frame.pixmap_mut(), &scene, Some(&layout()), lit);
            frame
                .pixmap()
                .pixels()
                .iter()
                .filter(|pixel| pixel.red() > 200 && pixel.green() < 60)
                .count()
        };
        assert!(
            reds(true) > 300,
            "the words in red, not the clock's white: {}",
            reds(true)
        );
        assert_eq!(reds(false), 0, "and gone while it is dark");

        assert!(timer_lit(&scene, 1_000_100), "lit early in each second");
        assert!(!timer_lit(&scene, 1_000_700), "dark at the end of it");
        let steady = OutputScene {
            timer_time_up: Some(crate::services::output::TimeUpStyle {
                color: "#ff0000".to_owned(),
                blink: false,
            }),
            ..scene.clone()
        };
        assert!(!timer_blinks(&steady));
        assert!(
            timer_lit(&steady, 1_000_700),
            "one that does not blink stays lit"
        );
        assert!(timer_lit(&OutputScene::default(), 1_000_700));
    }

    #[test]
    fn the_timer_name_is_drawn_without_a_banner() {
        // The name used to be skipped entirely unless the banner was on, so
        // the size chosen for it appeared to do nothing.
        let scene = timer_scene(true, "00:05:00", "Pre-Service");
        let mut layout = layout();
        layout.name_banner_enabled = false;

        let mut frame = Frame::new(320, 180).expect("frame");
        draw_timer(&mut frame.pixmap_mut(), &scene, Some(&layout));
        let with_name = ink_in_rows(&frame, 0, 180);

        let mut nameless = Frame::new(320, 180).expect("frame");
        let no_label = timer_scene(true, "00:05:00", "");
        draw_timer(&mut nameless.pixmap_mut(), &no_label, Some(&layout));
        let clock_only = ink_in_rows(&nameless, 0, 180);

        assert!(
            with_name > clock_only,
            "the name adds ink of its own: {clock_only} then {with_name}"
        );
    }

    #[test]
    fn the_timer_keeps_its_proportions_at_any_frame_size() {
        // The same settings drawn twice, one frame a third the size of the
        // other. The clock should cover about the same share of each; drawn at
        // an absolute pixel size it covered nine times as much of the small
        // one, which is why it swamped the preview.
        let share = |width: u32, height: u32| {
            let mut frame = Frame::new(width, height).expect("frame");
            draw_timer(
                &mut frame.pixmap_mut(),
                &timer_scene(true, "00:14:44", ""),
                Some(&layout()),
            );
            ink_in_rows(&frame, 0, height) as f64 / f64::from(width * height)
        };

        let large = share(960, 540);
        let small = share(320, 180);
        assert!(large > 0.0 && small > 0.0, "the clock is drawn on both");
        let ratio = small / large;
        assert!(
            (0.5..2.0).contains(&ratio),
            "the clock covers a comparable share of each frame: {ratio}"
        );
    }

    #[test]
    fn a_hidden_timer_draws_nothing() {
        let mut frame = Frame::new(320, 180).expect("frame");
        draw_timer(
            &mut frame.pixmap_mut(),
            &timer_scene(false, "05:00", "Countdown"),
            Some(&layout()),
        );
        assert_eq!(ink_in_rows(&frame, 0, 180), 0);
    }

    #[test]
    fn the_clock_follows_its_percentage_position() {
        // The operator drags it; the numbers are the centre of the clock.
        let high = {
            let mut frame = Frame::new(640, 360).expect("frame");
            let mut spec = layout();
            spec.y_percent = 15.0;
            draw_timer(
                &mut frame.pixmap_mut(),
                &timer_scene(true, "05:00", ""),
                Some(&spec),
            );
            ink_in_rows(&frame, 0, 120)
        };
        let low = {
            let mut frame = Frame::new(640, 360).expect("frame");
            let mut spec = layout();
            spec.y_percent = 85.0;
            draw_timer(
                &mut frame.pixmap_mut(),
                &timer_scene(true, "05:00", ""),
                Some(&spec),
            );
            ink_in_rows(&frame, 0, 120)
        };

        assert!(high > low, "the clock did not move with yPercent");
    }

    #[test]
    fn the_name_banner_only_appears_when_it_is_enabled() {
        let without = {
            let mut frame = Frame::new(640, 360).expect("frame");
            draw_timer(
                &mut frame.pixmap_mut(),
                &timer_scene(true, "", "Countdown"),
                Some(&layout()),
            );
            ink_in_rows(&frame, 300, 360)
        };
        let with = {
            let mut frame = Frame::new(640, 360).expect("frame");
            let mut spec = layout();
            spec.name_banner_enabled = true;
            spec.name_banner_color = "#ff0000".to_owned();
            draw_timer(
                &mut frame.pixmap_mut(),
                &timer_scene(true, "", "Countdown"),
                Some(&spec),
            );
            ink_in_rows(&frame, 300, 360)
        };

        assert_eq!(without, 0, "a banner appeared without being enabled");
        assert!(with > 0, "the banner did not appear when enabled");
    }

    #[test]
    fn a_timer_with_no_layout_still_draws() {
        // The layout is optional on the scene, and a timer the operator turned
        // on must appear even before they have positioned it.
        let mut frame = Frame::new(640, 360).expect("frame");
        draw_timer(
            &mut frame.pixmap_mut(),
            &timer_scene(true, "05:00", ""),
            None,
        );

        assert!(ink_in_rows(&frame, 0, 360) > 0, "nothing was drawn");
    }
}
