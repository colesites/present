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

/// Draw the message banner, if there is one.
pub fn draw_message(pixmap: &mut PixmapMut<'_>, overlay: &MessageOverlay) {
    if overlay.text.trim().is_empty() {
        return;
    }

    let width = pixmap.width() as f32;
    let height = pixmap.height() as f32;

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

    if let Some(plate) = plate {
        if let Some(path) = shapes::rounded_rect_path(0.0, top, width, band_height, 0.0) {
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

    let spec = text::TextBox::new(
        padding,
        top + padding,
        (width - padding * 2.0).max(1.0),
        (band_height - padding * 2.0).max(1.0),
        scaled_font,
    )
    .centred()
    .with_color(ink)
    .with_weight(cosmic_text::Weight::SEMIBOLD);

    text::draw_box(pixmap, &overlay.text, &spec);
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

/// Draw the timer, if it is showing.
///
/// The clock sits at a percentage of the frame, which is how the operator
/// positions it by dragging. The name banner, when enabled, spans the top
/// independently of where the clock is.
pub fn draw_timer(pixmap: &mut PixmapMut<'_>, scene: &OutputScene, layout: Option<&TimerLayout>) {
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
    let clock_font = layout.map_or(96.0, |l| clamp(l.clock_font_px, 12.0, 400.0));

    let clock_color = layout
        .and_then(|l| color::parse(&l.clock_color))
        .unwrap_or(Color::WHITE);

    if let Some(clock) = scene.timer_text.as_deref().filter(|t| !t.trim().is_empty()) {
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
    if !banner_enabled {
        return;
    }

    let banner_height = layout.map_or(48.0, |l| clamp(l.name_banner_height_px, 0.0, 400.0));
    if banner_height <= 0.0 {
        return;
    }

    let top = if layout.is_some_and(|l| l.title_position == "top") {
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

    let ink = layout
        .and_then(|l| color::parse(&l.name_color))
        .unwrap_or(Color::WHITE);
    let name_font = layout.map_or(24.0, |l| clamp(l.name_font_px, 8.0, 200.0));

    let spec = text::TextBox::new(0.0, top, frame_width, banner_height, name_font)
        .centred()
        .with_color(ink);
    text::draw_box(pixmap, label, &spec);
}

/// Draw the screen composer's regions.
///
/// The composer replaces the ordinary slide rather than sitting above it, which
/// is why this is a separate entry point and not another overlay: when it is
/// enabled, the regions *are* the output.
///
/// A region whose source is a camera feed is left to the webview layer, like a
/// capture prop. A region with a slide draws that slide's elements inside its
/// own rectangle, which is the whole point of the composer.
pub fn draw_composer(
    pixmap: &mut PixmapMut<'_>,
    layout: &super::composer::ComposerLayout,
    loader: &dyn MediaLoader,
) -> PropsDrawn {
    let mut counts = PropsDrawn::default();
    let frame_width = pixmap.width() as f32;
    let frame_height = pixmap.height() as f32;

    for region in &layout.regions {
        let Some((x, y, width, height)) = region.rect(frame_width, frame_height) else {
            continue;
        };
        if !region.is_composited() {
            counts.deferred += 1;
            continue;
        }

        // The region's own plate, under whatever it shows.
        if let Some(background) = region
            .background_color
            .as_deref()
            .filter(|value| !value.trim().eq_ignore_ascii_case("transparent"))
            .and_then(color::parse)
        {
            let radius = region
                .border_radius
                .filter(|value| value.is_finite() && *value > 0.0)
                .unwrap_or(0.0) as f32;

            if let Some(path) =
                shapes::rounded_rect_path(x, y, width, height, radius.min(width.min(height) / 2.0))
            {
                let mut paint = tiny_skia::Paint {
                    anti_alias: true,
                    ..tiny_skia::Paint::default()
                };
                paint.set_color(background);
                pixmap.fill_path(
                    &path,
                    &paint,
                    tiny_skia::FillRule::Winding,
                    Transform::identity(),
                    None,
                );
            }
        }

        let padding = region
            .padding
            .filter(|value| value.is_finite() && *value >= 0.0)
            .unwrap_or(0.0) as f32;
        let inner_x = x + padding;
        let inner_y = y + padding;
        let inner_width = (width - padding * 2.0).max(1.0);
        let inner_height = (height - padding * 2.0).max(1.0);

        // Media behind text, matching the layer order everywhere else.
        if region.show_media_layer {
            if let Some(url) = region
                .media_url
                .as_deref()
                .or(region.background_media_url.as_deref())
                .filter(|url| !url.is_empty())
            {
                if let Some(decoded) = loader.load(url).and_then(|bytes| images::decode(&bytes)) {
                    images::draw(
                        pixmap,
                        &decoded,
                        Transform::from_translate(inner_x, inner_y),
                        inner_width,
                        inner_height,
                        region.fit_mode.to_object_fit(),
                        None,
                    );
                }
            }
        }

        if !region.show_text_layer {
            counts.drawn += 1;
            continue;
        }

        // A region carrying a slide draws that slide inside itself, scaled to
        // the region rather than to the output. That is what the composer is
        // for: two decks side by side, each laid out as its author intended.
        if let Some(elements) = region.slide_elements.as_deref() {
            let viewport = super::geometry::Viewport::new(
                region.slide_canvas_size.as_deref(),
                inner_width.max(1.0) as u32,
                inner_height.max(1.0) as u32,
            );
            for element in elements {
                if !element.is_visible() || !element.element_type.is_composited() {
                    continue;
                }
                // Regions are drawn into the same pixmap, so the element's own
                // transform is offset by where the region starts.
                let mut moved = element.clone();
                moved.x = Some(element.x() + inner_x as f64 / viewport.scale_x());
                moved.y = Some(element.y() + inner_y as f64 / viewport.scale_y());
                super::scene::draw_element_into_pixmap(pixmap, &moved, &viewport, loader);
            }
        }

        let text_body = region
            .text_content
            .as_deref()
            .or(region.slide_text.as_deref())
            .filter(|value| !value.trim().is_empty());

        if let Some(body) = text_body {
            let spec = text::TextBox::new(
                inner_x,
                inner_y,
                inner_width,
                inner_height,
                (inner_height * 0.12).max(12.0),
            )
            .centred();
            text::draw_box(pixmap, body, &spec);
        }

        counts.drawn += 1;
    }

    counts
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
        );

        let mut bottom = Frame::new(640, 360).expect("frame");
        draw_message(
            &mut bottom.pixmap_mut(),
            &message("bottom", "info", "Cry room open"),
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
            draw_message(&mut frame.pixmap_mut(), &overlay);
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
    fn each_theme_paints_its_own_plate() {
        // Ported case for case from `getOverlayThemeStyle`. A theme silently
        // falling back would send the wrong signal on a warning message.
        let mut warning = Frame::new(320, 180).expect("frame");
        draw_message(
            &mut warning.pixmap_mut(),
            &message("top", "warning", "Move your car"),
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
        );

        assert!(ink_in_rows(&frame, 0, 60) > 0, "nothing was drawn");
    }

    #[test]
    fn an_empty_message_draws_nothing() {
        for text in ["", "   "] {
            let mut frame = Frame::new(320, 180).expect("frame");
            draw_message(&mut frame.pixmap_mut(), &message("top", "info", text));
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
        }
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
