//! Rectangles, rounded rectangles and their borders.
//!
//! A direct port of the shape arm of `CanvasSlideLayer.tsx:642-671`, including
//! the two details that would be easy to drop and hard to notice:
//!
//! * a background of `transparent` is skipped rather than painted, so it does
//!   not blend a fully transparent black over what is underneath;
//! * the border is drawn **inset by half its own width**, with its radius
//!   reduced to match, because a stroke straddles its path. Drawn on the outer
//!   edge instead, half of every border would hang outside the element and
//!   overlap whatever sits beside it.

use tiny_skia::{FillRule, Paint, PathBuilder, PixmapMut, Stroke, Transform};

use crate::services::slide::SlideElement;

use super::fill::{self, Fill};
use super::{color, geometry};

/// A rectangle with optionally rounded corners, in local element space.
///
/// Built with quadratic curves at the corners, matching
/// `buildRoundedRectPath`. A cubic approximation would be marginally rounder
/// and would make the two renderings of the same slide differ.
pub fn rounded_rect_path(
    x: f32,
    y: f32,
    width: f32,
    height: f32,
    radius: f32,
) -> Option<tiny_skia::Path> {
    if !(width.is_finite() && height.is_finite()) || width <= 0.0 || height <= 0.0 {
        return None;
    }

    let radius = radius.clamp(0.0, width.min(height) / 2.0);
    let mut builder = PathBuilder::new();

    if radius <= 0.0 {
        builder.push_rect(tiny_skia::Rect::from_xywh(x, y, width, height)?);
        return builder.finish();
    }

    builder.move_to(x + radius, y);
    builder.line_to(x + width - radius, y);
    builder.quad_to(x + width, y, x + width, y + radius);
    builder.line_to(x + width, y + height - radius);
    builder.quad_to(x + width, y + height, x + width - radius, y + height);
    builder.line_to(x + radius, y + height);
    builder.quad_to(x, y + height, x, y + height - radius);
    builder.line_to(x, y + radius);
    builder.quad_to(x, y, x + radius, y);
    builder.close();

    builder.finish()
}

/// Draw one `shape` element.
pub fn draw(pixmap: &mut PixmapMut<'_>, element: &SlideElement, viewport: &geometry::Viewport) {
    if let Some(paths) = super::paths::of(element) {
        draw_paths(pixmap, element, viewport, &paths);
        return;
    }
    let (width, height) = viewport.element_size(element);
    if width <= 0.0 || height <= 0.0 {
        return;
    }

    let style = element.style.as_ref();
    let transform = viewport.element_transform(element);
    let scale = viewport.scale_x().min(viewport.scale_y()) as f32;
    let radius = geometry::border_radius(style, width, height, scale);
    let opacity = style.and_then(|s| s.opacity);

    // Fill: a theme's gradient or mix of colours where the style has one it
    // can read (`fill.rs`), else the background colour. A `transparent`
    // background is skipped rather than painted: the Canvas version tests for
    // it by name, and painting it would blend nothing over what is underneath
    // for no reason.
    if let Some(path) = rounded_rect_path(0.0, 0.0, width, height, radius) {
        let painted = Fill::of(style).is_some_and(|fill| {
            fill::paint(pixmap, &path, &fill, (width, height), opacity, transform)
        });
        if !painted {
            if let Some(background) = style
                .and_then(|s| s.background_color.as_deref())
                .filter(|value| !value.trim().eq_ignore_ascii_case("transparent"))
                .and_then(color::parse)
            {
                let mut paint = Paint {
                    anti_alias: true,
                    ..Paint::default()
                };
                paint.set_color(color::with_opacity(background, opacity));
                pixmap.fill_path(&path, &paint, FillRule::Winding, transform, None);
            }
        }
    }

    // Border, inset by half its width because a stroke straddles its path.
    let border_width = style
        .and_then(|s| s.border_width)
        .filter(|value| value.is_finite() && *value > 0.0)
        .map(|value| viewport.scale_length(value))
        .unwrap_or(0.0);

    if border_width <= 0.0 {
        return;
    }
    let Some(border) = style
        .and_then(|s| s.border_color.as_deref())
        .and_then(color::parse)
    else {
        return;
    };

    let inset = border_width / 2.0;
    let Some(path) = rounded_rect_path(
        inset,
        inset,
        width - border_width,
        height - border_width,
        (radius - inset).max(0.0),
    ) else {
        return;
    };

    let mut paint = Paint {
        anti_alias: true,
        ..Paint::default()
    };
    paint.set_color(color::with_opacity(border, opacity));

    let stroke = Stroke {
        width: border_width,
        ..Stroke::default()
    };
    pixmap.stroke_path(&path, &paint, &stroke, transform, None);
}

/// A shape with its own geometry (an imported PowerPoint shape): each path
/// filled and outlined as it says, in the element's canvas pixels.
fn draw_paths(
    pixmap: &mut PixmapMut<'_>,
    element: &SlideElement,
    viewport: &geometry::Viewport,
    paths: &[super::paths::ShapePath],
) {
    let style = element.style.as_ref();
    let opacity = style.and_then(|s| s.opacity);
    let transform = viewport
        .element_transform(element)
        .pre_scale(viewport.scale_x() as f32, viewport.scale_y() as f32);
    let size = (element.width() as f32, element.height() as f32);

    let fill = Fill::of(style);
    let background = style
        .and_then(|s| s.background_color.as_deref())
        .filter(|value| !value.trim().eq_ignore_ascii_case("transparent"))
        .and_then(color::parse);
    for shape_path in paths.iter().filter(|shape_path| shape_path.fill) {
        let painted = fill.as_ref().is_some_and(|fill| {
            fill::paint(pixmap, &shape_path.path, fill, size, opacity, transform)
        });
        if !painted {
            if let Some(background) = background {
                let mut paint = Paint {
                    anti_alias: true,
                    ..Paint::default()
                };
                paint.set_color(color::with_opacity(background, opacity));
                pixmap.fill_path(&shape_path.path, &paint, FillRule::Winding, transform, None);
            }
        }
    }

    let Some(line) = super::paths::Line::of(style) else {
        return;
    };
    let Some(line_color) = color::parse(&line.color) else {
        return;
    };
    let mut paint = Paint {
        anti_alias: true,
        ..Paint::default()
    };
    paint.set_color(color::with_opacity(line_color, opacity));
    let stroke = line.stroke();
    for shape_path in paths.iter().filter(|shape_path| shape_path.stroke) {
        pixmap.stroke_path(&shape_path.path, &paint, &stroke, transform, None);
    }
}

/// Fill the whole frame with a colour, for the slide background.
pub fn fill_background(pixmap: &mut PixmapMut<'_>, value: &str) -> bool {
    let Some(background) = color::parse(value) else {
        return false;
    };

    let width = pixmap.width() as f32;
    let height = pixmap.height() as f32;
    let Some(rect) = tiny_skia::Rect::from_xywh(0.0, 0.0, width, height) else {
        return false;
    };

    let mut paint = Paint::default();
    paint.set_color(background);
    pixmap.fill_rect(rect, &paint, Transform::identity(), None);
    true
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    use crate::services::compositor::Frame;

    fn element(value: serde_json::Value) -> SlideElement {
        serde_json::from_value(value).expect("element")
    }

    fn viewport() -> geometry::Viewport {
        geometry::Viewport::new(Some("100x100"), 100, 100)
    }

    /// Draw one element onto a fresh 100×100 frame.
    fn render(value: serde_json::Value) -> Frame {
        let mut frame = Frame::new(100, 100).expect("frame");
        draw(&mut frame.pixmap_mut(), &element(value), &viewport());
        frame
    }

    #[test]
    fn a_filled_rectangle_lands_where_it_was_asked_to() {
        let frame = render(json!({
            "id": "a", "type": "shape",
            "x": 20.0, "y": 20.0, "width": 40.0, "height": 40.0,
            "style": { "backgroundColor": "#ff0000" }
        }));

        // Inside is red, outside is the frame's black.
        assert_eq!(frame.pixel_at(40, 40), Some((255, 0, 0, 255)), "centre");
        assert_eq!(
            frame.pixel_at(21, 21),
            Some((255, 0, 0, 255)),
            "just inside"
        );
        assert_eq!(frame.pixel_at(10, 10), Some((0, 0, 0, 255)), "outside");
        assert_eq!(frame.pixel_at(70, 70), Some((0, 0, 0, 255)), "past it");
    }

    #[test]
    fn a_gradient_fill_runs_across_the_shape() {
        let frame = render(json!({
            "id": "a", "type": "shape",
            "x": 0.0, "y": 0.0, "width": 100.0, "height": 100.0,
            "style": {
                "backgroundColor": "#00ff00",
                "fill": { "kind": "gradient", "from": "#ff0000", "to": "#0000ff", "angle": 0.0 }
            }
        }));
        let (left, _, left_blue, _) = frame.pixel_at(2, 50).expect("pixel");
        let (right, _, right_blue, _) = frame.pixel_at(97, 50).expect("pixel");
        assert!(
            left > 240 && left_blue < 15,
            "red at the start: {left} {left_blue}"
        );
        assert!(
            right < 15 && right_blue > 240,
            "blue at the end: {right} {right_blue}"
        );
        let (_, green, _, _) = frame.pixel_at(50, 50).expect("pixel");
        assert_eq!(green, 0, "the plain colour is not drawn under it");
    }

    #[test]
    fn a_mix_is_its_base_with_soft_spots_of_colour() {
        let frame = render(json!({
            "id": "a", "type": "shape",
            "x": 0.0, "y": 0.0, "width": 100.0, "height": 100.0,
            "style": { "fill": { "kind": "mix", "base": "#000080", "spots": [
                { "color": "#ff0000", "x": 0.2, "y": 0.2, "size": 0.3 }
            ] } }
        }));
        let (red, _, _, _) = frame.pixel_at(20, 20).expect("pixel");
        assert!(red > 230, "the spot's colour at its centre: {red}");
        assert_eq!(
            frame.pixel_at(90, 90),
            Some((0, 0, 128, 255)),
            "the base past its reach"
        );
    }

    #[test]
    fn an_unreadable_fill_falls_back_to_the_background_colour() {
        let frame = render(json!({
            "id": "a", "type": "shape",
            "x": 0.0, "y": 0.0, "width": 100.0, "height": 100.0,
            "style": { "backgroundColor": "#ff0000", "fill": { "kind": "gradient", "from": "nope", "to": "#fff" } }
        }));
        assert_eq!(frame.pixel_at(50, 50), Some((255, 0, 0, 255)));
    }

    #[test]
    fn a_transparent_background_paints_nothing() {
        // The Canvas version tests for the name. Painting it would blend a
        // fully transparent black over whatever is underneath.
        let frame = render(json!({
            "id": "a", "type": "shape",
            "x": 0.0, "y": 0.0, "width": 100.0, "height": 100.0,
            "style": { "backgroundColor": "transparent" }
        }));

        assert_eq!(frame.pixel_at(50, 50), Some((0, 0, 0, 255)), "untouched");
    }

    #[test]
    fn an_unrecognised_colour_paints_nothing_rather_than_black() {
        // A shape painted black over the lyrics is not recoverable in front of
        // a congregation; a shape that did not appear is.
        let frame = render(json!({
            "id": "a", "type": "shape",
            "x": 0.0, "y": 0.0, "width": 100.0, "height": 100.0,
            "style": { "backgroundColor": "var(--brand-primary)" }
        }));

        assert_eq!(frame.pixel_at(50, 50), Some((0, 0, 0, 255)));
    }

    #[test]
    fn a_border_is_drawn_inside_the_element_not_straddling_its_edge() {
        // A stroke straddles its path, so an un-inset border hangs half its
        // width outside the element and overlaps whatever sits beside it.
        let frame = render(json!({
            "id": "a", "type": "shape",
            "x": 20.0, "y": 20.0, "width": 60.0, "height": 60.0,
            "style": { "borderColor": "#00ff00", "borderWidth": 4.0 }
        }));

        // Just inside the element's edge: border.
        let (_, green, _, _) = frame.pixel_at(22, 50).expect("pixel");
        assert!(green > 200, "the border should be just inside the edge");

        // Just outside it: nothing. This is the assertion that catches the
        // missing inset.
        assert_eq!(
            frame.pixel_at(17, 50),
            Some((0, 0, 0, 255)),
            "outside the element"
        );
    }

    #[test]
    fn a_rounded_corner_is_actually_cut() {
        let frame = render(json!({
            "id": "a", "type": "shape",
            "x": 0.0, "y": 0.0, "width": 100.0, "height": 100.0,
            "style": { "backgroundColor": "#ffffff", "borderRadius": 40.0 }
        }));

        assert_eq!(
            frame.pixel_at(50, 50),
            Some((255, 255, 255, 255)),
            "centre filled"
        );
        assert_eq!(
            frame.pixel_at(1, 1),
            Some((0, 0, 0, 255)),
            "corner cut away"
        );
    }

    #[test]
    fn opacity_blends_the_shape_rather_than_hiding_it() {
        let frame = render(json!({
            "id": "a", "type": "shape",
            "x": 0.0, "y": 0.0, "width": 100.0, "height": 100.0,
            "style": { "backgroundColor": "#ffffff", "opacity": 0.5 }
        }));

        let (red, _, _, _) = frame.pixel_at(50, 50).expect("pixel");
        assert!(
            (100..=160).contains(&red),
            "half-opaque white over black should be mid grey, got {red}"
        );
    }

    #[test]
    fn a_zero_sized_element_draws_nothing_and_does_not_panic() {
        // An imported deck can contain these, and `Rect::from_xywh` returns
        // None for them rather than a degenerate rectangle.
        for size in [json!(0.0), json!(-10.0)] {
            let frame = render(json!({
                "id": "a", "type": "shape",
                "x": 10.0, "y": 10.0, "width": size, "height": size,
                "style": { "backgroundColor": "#ffffff" }
            }));
            assert_eq!(frame.pixel_at(10, 10), Some((0, 0, 0, 255)));
        }
    }

    #[test]
    fn a_shape_is_scaled_into_a_larger_frame() {
        // The same deck on a bigger screen: twice the size, same place.
        let mut frame = Frame::new(200, 200).expect("frame");
        let viewport = geometry::Viewport::new(Some("100x100"), 200, 200);
        draw(
            &mut frame.pixmap_mut(),
            &element(json!({
                "id": "a", "type": "shape",
                "x": 10.0, "y": 10.0, "width": 20.0, "height": 20.0,
                "style": { "backgroundColor": "#ff0000" }
            })),
            &viewport,
        );

        assert_eq!(frame.pixel_at(40, 40), Some((255, 0, 0, 255)), "scaled 2x");
        assert_eq!(frame.pixel_at(15, 15), Some((0, 0, 0, 255)), "not at 1x");
    }

    #[test]
    fn a_background_fill_covers_the_whole_frame() {
        let mut frame = Frame::new(64, 64).expect("frame");
        assert!(fill_background(&mut frame.pixmap_mut(), "#0000ff"));

        assert_eq!(frame.pixel_at(0, 0), Some((0, 0, 255, 255)));
        assert_eq!(frame.pixel_at(63, 63), Some((0, 0, 255, 255)));
    }

    #[test]
    fn an_unreadable_background_leaves_the_frame_alone() {
        let mut frame = Frame::new(64, 64).expect("frame");
        assert!(!fill_background(&mut frame.pixmap_mut(), "octarine"));

        assert_eq!(frame.pixel_at(32, 32), Some((0, 0, 0, 255)), "still black");
    }
}
