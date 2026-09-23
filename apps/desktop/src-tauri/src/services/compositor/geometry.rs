//! Turning a deck's coordinates into a frame's.
//!
//! Slide elements are positioned in the deck's own canvas units — a 1920×1080
//! deck says `x: 960` for the middle — and the frame may be any size. Every
//! layer needs the same mapping, and it has to be the same mapping the React
//! preview uses, because ADR-001 accepts that the same slide is now drawn twice
//! and requires the two to look identical.

use tiny_skia::Transform;

use crate::services::slide::{SlideElement, SlideElementStyle};

/// The deck's canvas, and the frame it is being drawn into.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Viewport {
    pub canvas_width: f64,
    pub canvas_height: f64,
    pub frame_width: f64,
    pub frame_height: f64,
}

/// What a deck means when it says nothing. `CanvasSizePreset`'s first entry.
pub const DEFAULT_CANVAS: (f64, f64) = (1920.0, 1080.0);

impl Viewport {
    /// Build from the scene's `slide_canvas_size`, which is text like
    /// `"1920x1080"`.
    ///
    /// Anything unparseable falls back to 1920×1080 rather than refusing.
    /// A deck that does not say is overwhelmingly a 1080p deck, and drawing it
    /// at the default is right far more often than drawing nothing.
    pub fn new(canvas_size: Option<&str>, frame_width: u32, frame_height: u32) -> Self {
        let (canvas_width, canvas_height) = canvas_size
            .and_then(parse_canvas_size)
            .unwrap_or(DEFAULT_CANVAS);

        Self {
            canvas_width,
            canvas_height,
            frame_width: f64::from(frame_width),
            frame_height: f64::from(frame_height),
        }
    }

    pub fn scale_x(&self) -> f64 {
        self.frame_width / self.canvas_width
    }

    pub fn scale_y(&self) -> f64 {
        self.frame_height / self.canvas_height
    }

    /// The transform that puts an element's local space at its place on the
    /// frame.
    ///
    /// Rotation and flip are about the element's centre, which is what the
    /// Canvas version does (`CanvasSlideLayer.tsx:625-633`) and what a user
    /// dragging a rotation handle expects. Doing it about the origin instead
    /// would swing the element across the screen.
    pub fn element_transform(&self, element: &SlideElement) -> Transform {
        let x = (element.x() * self.scale_x()) as f32;
        let y = (element.y() * self.scale_y()) as f32;
        let width = (element.width() * self.scale_x()) as f32;
        let height = (element.height() * self.scale_y()) as f32;

        let style = element.style.as_ref();
        let rotation = style.and_then(|s| s.rotation).unwrap_or(0.0);
        let flip_x = style.and_then(|s| s.flip_x).unwrap_or(false);
        let flip_y = style.and_then(|s| s.flip_y).unwrap_or(false);

        if rotation == 0.0 && !flip_x && !flip_y {
            return Transform::from_translate(x, y);
        }

        // Move to the centre, turn and mirror there, then step back out by half
        // the element so its local origin is its top-left again.
        Transform::from_translate(x + width / 2.0, y + height / 2.0)
            .pre_rotate(rotation as f32)
            .pre_scale(
                if flip_x { -1.0 } else { 1.0 },
                if flip_y { -1.0 } else { 1.0 },
            )
            .pre_translate(-width / 2.0, -height / 2.0)
    }

    /// An element's size on the frame.
    pub fn element_size(&self, element: &SlideElement) -> (f32, f32) {
        (
            (element.width() * self.scale_x()) as f32,
            (element.height() * self.scale_y()) as f32,
        )
    }

    /// A style length in canvas units, on the frame.
    ///
    /// Uses the smaller scale, like the Canvas version's border width
    /// (`Math.min(scaleX, scaleY)`): a border scaled independently on each axis
    /// would be thicker on one side of the same rectangle.
    pub fn scale_length(&self, length: f64) -> f32 {
        (length * self.scale_x().min(self.scale_y())) as f32
    }
}

/// `"1920x1080"` → `(1920.0, 1080.0)`.
fn parse_canvas_size(value: &str) -> Option<(f64, f64)> {
    let (width, height) = value.trim().split_once(['x', 'X', '×'])?;
    let width: f64 = width.trim().parse().ok()?;
    let height: f64 = height.trim().parse().ok()?;

    if !width.is_finite() || !height.is_finite() || width <= 0.0 || height <= 0.0 {
        return None;
    }
    Some((width, height))
}

/// The border radius to draw with, in frame units and never larger than the
/// box can hold.
///
/// A radius beyond half the shorter side is not a rounder rectangle, it is an
/// invalid path — the corner arcs overlap. CSS clamps; so does this.
pub fn border_radius(
    style: Option<&SlideElementStyle>,
    width: f32,
    height: f32,
    scale: f32,
) -> f32 {
    let radius = style.and_then(|s| s.border_radius).unwrap_or(0.0);
    if !radius.is_finite() || radius <= 0.0 {
        return 0.0;
    }
    (radius as f32 * scale).clamp(0.0, width.min(height) / 2.0)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn element(value: serde_json::Value) -> SlideElement {
        serde_json::from_value(value).expect("element")
    }

    #[test]
    fn a_deck_that_does_not_say_its_size_is_treated_as_1080p() {
        // Drawing at the default is right far more often than drawing nothing.
        let viewport = Viewport::new(None, 1920, 1080);
        assert_eq!(
            (viewport.canvas_width, viewport.canvas_height),
            DEFAULT_CANVAS
        );
        assert_eq!(viewport.scale_x(), 1.0);
    }

    #[test]
    fn an_unparseable_canvas_size_falls_back_rather_than_refusing() {
        for bad in ["", "1920", "axb", "1920x0", "-1920x1080", "1920xNaN"] {
            let viewport = Viewport::new(Some(bad), 1920, 1080);
            assert_eq!(
                (viewport.canvas_width, viewport.canvas_height),
                DEFAULT_CANVAS,
                "{bad:?} should have fallen back"
            );
        }
    }

    #[test]
    fn a_deck_is_scaled_to_the_frame_it_is_drawn_into() {
        // A 1080p deck on a 4K frame is drawn at 2x, not cropped.
        let viewport = Viewport::new(Some("1920x1080"), 3840, 2160);
        assert_eq!(viewport.scale_x(), 2.0);
        assert_eq!(viewport.scale_y(), 2.0);

        let e =
            element(json!({ "id": "a", "x": 100.0, "y": 50.0, "width": 200.0, "height": 100.0 }));
        assert_eq!(viewport.element_size(&e), (400.0, 200.0));
    }

    #[test]
    fn a_non_uniform_frame_scales_each_axis_separately() {
        // A 4:3 deck shown on a 16:9 screen stretches, which is what the React
        // preview does. Letterboxing here would make the two disagree.
        let viewport = Viewport::new(Some("1024x768"), 1920, 1080);
        assert!((viewport.scale_x() - 1.875).abs() < 1e-9);
        assert!((viewport.scale_y() - 1.40625).abs() < 1e-9);
    }

    #[test]
    fn an_unrotated_element_is_a_plain_translation() {
        let viewport = Viewport::new(Some("1920x1080"), 1920, 1080);
        let e =
            element(json!({ "id": "a", "x": 100.0, "y": 50.0, "width": 200.0, "height": 100.0 }));

        assert_eq!(
            viewport.element_transform(&e),
            Transform::from_translate(100.0, 50.0)
        );
    }

    #[test]
    fn rotation_turns_the_element_about_its_own_centre() {
        // About the origin instead would swing it across the screen.
        let viewport = Viewport::new(Some("1920x1080"), 1920, 1080);
        let e = element(json!({
            "id": "a", "x": 100.0, "y": 100.0, "width": 200.0, "height": 200.0,
            "style": { "rotation": 180.0 }
        }));

        let transform = viewport.element_transform(&e);
        // The element's own centre must stay where it was.
        let (cx, cy) = (100.0, 100.0);
        let mut point = [tiny_skia::Point::from_xy(cx, cy)];
        transform.map_points(&mut point);
        assert!((point[0].x - 200.0).abs() < 0.01, "{:?}", point[0]);
        assert!((point[0].y - 200.0).abs() < 0.01, "{:?}", point[0]);
    }

    #[test]
    fn a_border_radius_cannot_exceed_what_the_box_can_hold() {
        // Beyond half the shorter side the corner arcs overlap, which is not a
        // rounder rectangle but an invalid path.
        let style: SlideElementStyle =
            serde_json::from_value(json!({ "borderRadius": 500.0 })).expect("style");

        assert_eq!(border_radius(Some(&style), 100.0, 60.0, 1.0), 30.0);
    }

    #[test]
    fn a_nonsense_border_radius_is_no_radius() {
        for bad in [f64::NAN, f64::NEG_INFINITY, -4.0, 0.0] {
            let style = SlideElementStyle {
                border_radius: Some(bad),
                ..SlideElementStyle::default()
            };
            assert_eq!(border_radius(Some(&style), 100.0, 100.0, 1.0), 0.0, "{bad}");
        }
        assert_eq!(border_radius(None, 100.0, 100.0, 1.0), 0.0);
    }

    #[test]
    fn a_length_uses_the_smaller_scale_so_a_border_is_even() {
        // Scaling a border independently per axis makes it thicker on one side
        // of the same rectangle.
        let viewport = Viewport::new(Some("1920x1080"), 1920, 2160);
        assert_eq!(viewport.scale_length(4.0), 4.0, "min(1.0, 2.0) == 1.0");
    }
}
