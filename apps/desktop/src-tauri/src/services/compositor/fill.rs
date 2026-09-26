//! A shape's `fill`: one colour, a gradient, or a mix of colours.
//!
//! Themes paint their backgrounds and the boxes behind their words with
//! these, and the canvas renderer paints the same (`slide-fill.ts`), so the
//! geometry below is theirs:
//!
//! * a gradient runs across the box at `angle` degrees, 0 left to right and
//!   90 top to bottom, and reaches exactly the box's corners along that line,
//!   as a CSS `linear-gradient` does;
//! * a mix is a base colour with soft spots of colour on it, each fading from
//!   its colour at `x`, `y` (fractions of the box) to nothing at `size` times
//!   the box's longer side.
//!
//! The fill arrives in the style's `extra` map and is read leniently: one this
//! build cannot read is no fill, and the shape's `backgroundColor` is drawn
//! instead, never a blank screen.

use serde::Deserialize;
use tiny_skia::{
    Color, FillRule, GradientStop, LinearGradient, Paint, Path, PixmapMut, Point, RadialGradient,
    SpreadMode, Transform,
};

use crate::services::slide::SlideElementStyle;

use super::color;

/// The most spots a mix draws. A theme has three; more is a malformed value.
const MAX_SPOTS: usize = 8;

#[derive(Debug, Clone, PartialEq, Deserialize)]
#[serde(tag = "kind", rename_all = "lowercase")]
pub enum Fill {
    Color {
        color: String,
    },
    Gradient {
        from: String,
        to: String,
        #[serde(default)]
        angle: f64,
    },
    Mix {
        base: String,
        #[serde(default)]
        spots: Vec<Spot>,
    },
}

#[derive(Debug, Clone, PartialEq, Deserialize)]
pub struct Spot {
    pub color: String,
    pub x: f64,
    pub y: f64,
    pub size: f64,
}

impl Fill {
    /// The element's `fill`, if it has one this build can read.
    pub fn of(style: Option<&SlideElementStyle>) -> Option<Self> {
        let value = style?.extra.get("fill")?;
        serde_json::from_value(value.clone()).ok()
    }
}

/// Paint `path`, in the element's own space of `width` by `height`, with the
/// fill. `false` when nothing in it could be read, so the caller can fall back.
pub fn paint(
    pixmap: &mut PixmapMut<'_>,
    path: &Path,
    fill: &Fill,
    (width, height): (f32, f32),
    opacity: Option<f64>,
    transform: Transform,
) -> bool {
    let parse = |value: &str| color::parse(value).map(|c| color::with_opacity(c, opacity));
    let mut paint = Paint {
        anti_alias: true,
        ..Paint::default()
    };
    match fill {
        Fill::Color { color } => {
            let Some(color) = parse(color) else {
                return false;
            };
            paint.set_color(color);
            pixmap.fill_path(path, &paint, FillRule::Winding, transform, None);
            true
        }
        Fill::Gradient { from, to, angle } => {
            let (Some(from), Some(to)) = (parse(from), parse(to)) else {
                return false;
            };
            let (start, end) = gradient_line(*angle, width, height);
            let Some(shader) = LinearGradient::new(
                start,
                end,
                vec![GradientStop::new(0.0, from), GradientStop::new(1.0, to)],
                SpreadMode::Pad,
                Transform::identity(),
            ) else {
                // A zero-length line: the box has no size along it.
                paint.set_color(from);
                pixmap.fill_path(path, &paint, FillRule::Winding, transform, None);
                return true;
            };
            paint.shader = shader;
            pixmap.fill_path(path, &paint, FillRule::Winding, transform, None);
            true
        }
        Fill::Mix { base, spots } => {
            let Some(base) = parse(base) else {
                return false;
            };
            paint.set_color(base);
            pixmap.fill_path(path, &paint, FillRule::Winding, transform, None);
            let longer = width.max(height);
            for spot in spots.iter().take(MAX_SPOTS) {
                let Some(color) = parse(&spot.color) else {
                    continue;
                };
                let radius = (spot.size.clamp(0.0, 4.0) as f32 * longer).max(1.0);
                let centre = Point::from_xy(
                    spot.x.clamp(-1.0, 2.0) as f32 * width,
                    spot.y.clamp(-1.0, 2.0) as f32 * height,
                );
                let mut clear = color;
                clear.set_alpha(0.0);
                let Some(shader) = RadialGradient::new(
                    centre,
                    0.0,
                    centre,
                    radius,
                    vec![GradientStop::new(0.0, color), GradientStop::new(1.0, clear)],
                    SpreadMode::Pad,
                    Transform::identity(),
                ) else {
                    continue;
                };
                let mut spot_paint = Paint {
                    anti_alias: true,
                    ..Paint::default()
                };
                spot_paint.shader = shader;
                pixmap.fill_path(path, &spot_paint, FillRule::Winding, transform, None);
            }
            true
        }
    }
}

/// Where a gradient at `angle` degrees starts and ends across a box: through
/// its middle, as long as the box is along that direction.
pub fn gradient_line(angle: f64, width: f32, height: f32) -> (Point, Point) {
    let radians = (angle as f32).to_radians();
    let (dx, dy) = (radians.cos(), radians.sin());
    let half = (width * dx.abs() + height * dy.abs()) / 2.0;
    let (cx, cy) = (width / 2.0, height / 2.0);
    (
        Point::from_xy(cx - dx * half, cy - dy * half),
        Point::from_xy(cx + dx * half, cy + dy * half),
    )
}

/// The colour a renderer that paints only colours should use for a fill.
pub fn plain_color(fill: &Fill) -> Option<Color> {
    match fill {
        Fill::Color { color } => color::parse(color),
        Fill::Gradient { from, .. } => color::parse(from),
        Fill::Mix { base, .. } => color::parse(base),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn style(value: serde_json::Value) -> SlideElementStyle {
        serde_json::from_value(value).expect("style")
    }

    #[test]
    fn a_fill_is_read_from_the_style() {
        let fill = Fill::of(Some(&style(json!({
            "fill": { "kind": "gradient", "from": "#000000", "to": "#ffffff", "angle": 90.0 }
        }))));
        assert_eq!(
            fill,
            Some(Fill::Gradient {
                from: "#000000".into(),
                to: "#ffffff".into(),
                angle: 90.0
            })
        );
    }

    #[test]
    fn a_fill_this_build_cannot_read_is_none_not_an_error() {
        assert_eq!(
            Fill::of(Some(&style(json!({ "fill": { "kind": "hologram" } })))),
            None
        );
        assert_eq!(Fill::of(Some(&style(json!({ "fill": "red" })))), None);
        assert_eq!(
            Fill::of(Some(&style(json!({ "fill": { "kind": "mix" } })))),
            None
        );
    }

    #[test]
    fn a_gradient_line_meets_the_corners_along_its_direction() {
        let (start, end) = gradient_line(0.0, 200.0, 100.0);
        assert_eq!((start.x, start.y, end.x, end.y), (0.0, 50.0, 200.0, 50.0));
        let (start, end) = gradient_line(90.0, 200.0, 100.0);
        assert!((start.y - 0.0).abs() < 1e-3 && (end.y - 100.0).abs() < 1e-3);
        assert!((start.x - 100.0).abs() < 1e-3);
    }
}
