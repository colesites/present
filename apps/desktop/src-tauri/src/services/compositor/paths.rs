//! A shape's outline as paths, and the line drawn along them.
//!
//! An imported PowerPoint shape carries its geometry already worked out
//! (`services/pptx/geometry.rs`): SVG path data in the shape's own canvas
//! pixels, from its top-left, using only absolute `M L C Q Z`. The canvas
//! renderer hands the same strings to `Path2D`.

use serde::Deserialize;
use tiny_skia::{LineCap, LineJoin, Path, PathBuilder, StrokeDash};

use crate::services::slide::{SlideElement, SlideElementStyle};

/// One path of an element, and whether it is filled and outlined.
#[derive(Debug, Clone)]
pub struct ShapePath {
    pub path: Path,
    pub fill: bool,
    pub stroke: bool,
}

#[derive(Debug, Deserialize)]
struct RawGeometry {
    #[serde(default)]
    paths: Vec<RawPath>,
}

#[derive(Debug, Deserialize)]
struct RawPath {
    d: String,
    #[serde(default = "yes")]
    fill: bool,
    #[serde(default = "yes")]
    stroke: bool,
}

fn yes() -> bool {
    true
}

/// The element's `geometry`, if it has one this build can read.
pub fn of(element: &SlideElement) -> Option<Vec<ShapePath>> {
    let raw: RawGeometry = serde_json::from_value(element.extra.get("geometry")?.clone()).ok()?;
    let paths: Vec<ShapePath> = raw
        .paths
        .into_iter()
        .filter_map(|raw| {
            Some(ShapePath {
                path: parse(&raw.d)?,
                fill: raw.fill,
                stroke: raw.stroke,
            })
        })
        .collect();
    (!paths.is_empty()).then_some(paths)
}

/// SVG path data with absolute `M L C Q Z`.
pub fn parse(d: &str) -> Option<Path> {
    let mut builder = PathBuilder::new();
    let mut numbers: Vec<f32> = Vec::with_capacity(6);
    let mut command: Option<char> = None;

    let flush = |command: Option<char>, numbers: &mut Vec<f32>, builder: &mut PathBuilder| {
        match (command, numbers.as_slice()) {
            (Some('M'), [x, y]) => builder.move_to(*x, *y),
            (Some('L'), [x, y]) => builder.line_to(*x, *y),
            (Some('Q'), [x1, y1, x, y]) => builder.quad_to(*x1, *y1, *x, *y),
            (Some('C'), [x1, y1, x2, y2, x, y]) => builder.cubic_to(*x1, *y1, *x2, *y2, *x, *y),
            (Some('Z'), []) => builder.close(),
            _ => {}
        }
        numbers.clear();
    };

    let mut token = String::new();
    for character in d.chars().chain(std::iter::once(' ')) {
        if character.is_ascii_alphabetic() && character != 'e' && character != 'E' {
            if !token.is_empty() {
                numbers.push(token.parse().ok()?);
                token.clear();
            }
            flush(command, &mut numbers, &mut builder);
            command = Some(character.to_ascii_uppercase());
            if command == Some('Z') {
                flush(command, &mut numbers, &mut builder);
                command = None;
            }
        } else if character == ' ' || character == ',' {
            if !token.is_empty() {
                numbers.push(token.parse().ok()?);
                token.clear();
            }
        } else if character == '-' && !token.is_empty() && !token.ends_with(['e', 'E']) {
            numbers.push(token.parse().ok()?);
            token.clear();
            token.push(character);
        } else {
            token.push(character);
        }
    }
    flush(command, &mut numbers, &mut builder);
    builder.finish()
}

/// The line drawn along a shape's paths: `style.line`.
#[derive(Debug, Clone, PartialEq, Deserialize)]
pub struct Line {
    pub color: String,
    /// In canvas pixels.
    pub width: f32,
    #[serde(default)]
    pub dash: Vec<f32>,
    #[serde(default)]
    pub cap: Option<String>,
    #[serde(default)]
    pub join: Option<String>,
}

impl Line {
    pub fn of(style: Option<&SlideElementStyle>) -> Option<Self> {
        let line: Self = serde_json::from_value(style?.extra.get("line")?.clone()).ok()?;
        (line.width.is_finite() && line.width > 0.0).then_some(line)
    }

    pub fn stroke(&self) -> tiny_skia::Stroke {
        tiny_skia::Stroke {
            width: self.width,
            line_cap: match self.cap.as_deref() {
                Some("round") => LineCap::Round,
                Some("square") => LineCap::Square,
                _ => LineCap::Butt,
            },
            line_join: match self.join.as_deref() {
                Some("round") => LineJoin::Round,
                Some("bevel") => LineJoin::Bevel,
                _ => LineJoin::Miter,
            },
            dash: (self.dash.len() >= 2
                && self
                    .dash
                    .iter()
                    .all(|part| part.is_finite() && *part >= 0.0))
            .then(|| {
                let mut dash = self.dash.clone();
                if dash.len() % 2 == 1 {
                    dash.extend_from_within(..);
                }
                StrokeDash::new(dash, 0.0)
            })
            .flatten(),
            ..tiny_skia::Stroke::default()
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn path_data_reads_every_command() {
        let path = parse("M0 0L100 0C100 50 50 100 0 100Q-10 50 0 0Z").expect("a path");
        let bounds = path.bounds();
        assert!(
            bounds.left() < 0.0,
            "the curve's control point is out to the left"
        );
        assert_eq!(bounds.right(), 100.0);
        assert_eq!(bounds.bottom(), 100.0);
    }

    #[test]
    fn negative_numbers_need_no_separator() {
        let path = parse("M10-5L-3.5 2").expect("a path");
        assert_eq!(path.bounds().top(), -5.0);
        assert_eq!(path.bounds().left(), -3.5);
    }

    #[test]
    fn nonsense_is_no_path() {
        assert!(parse("M0 x").is_none());
        assert!(parse("").is_none());
    }
}
