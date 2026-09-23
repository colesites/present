//! The screen composer's layout, typed.
//!
//! The last field the scene carried verbatim. `slide_elements` got a struct
//! when the compositor had to draw slides; this is the same move for the
//! composer, which divides the output into regions and draws something
//! different in each.
//!
//! Same two rules as `services::slide`, for the same reason — **typing this
//! must not be able to blank the audience screen**:
//!
//! * unknown variants degrade rather than failing, so a layout naming a source
//!   this build predates costs one undrawn region and not the frame;
//! * unknown fields survive, because the hybrid surface means React still reads
//!   this data after Rust has held it.
//!
//! Geometry here is **fractions of the output**, not canvas units: a region at
//! `x: 0.5, width: 0.5` is the right half of whatever screen it lands on. That
//! is what lets one layout work on a 1080p projector and a 4K screen, and it is
//! why these numbers do not go through `Viewport`.

use serde::{Deserialize, Serialize};

use crate::services::slide::{Extra, SlideElement};

/// What a region shows.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "kebab-case")]
pub enum ComposerSource {
    #[default]
    Video,
    CameraFeed,
    Countdown,
    Slides,
    /// Anything this build does not know. Left undrawn rather than guessed.
    #[serde(other)]
    Unknown,
}

impl ComposerSource {
    /// Can the Rust compositor draw this region, or does it belong to the
    /// webview layer above?
    ///
    /// A camera feed is `getUserMedia`, which is a browser API — the same
    /// reason a capture prop is deferred (ADR-001's amendment).
    pub const fn is_composited(self) -> bool {
        match self {
            Self::Video | Self::Countdown | Self::Slides => true,
            Self::CameraFeed | Self::Unknown => false,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "kebab-case")]
pub enum ComposerFit {
    #[default]
    Cover,
    Contain,
    Fill,
    ScaleDown,
    #[serde(other)]
    Unknown,
}

impl ComposerFit {
    /// The compositor's own fit rule. `scale-down` and anything unrecognised
    /// fall to `contain`, which is the conservative direction: it shows the
    /// whole image rather than cropping something the operator meant to be
    /// visible.
    pub const fn to_object_fit(self) -> super::images::ObjectFit {
        match self {
            Self::Cover => super::images::ObjectFit::Cover,
            Self::Fill => super::images::ObjectFit::Fill,
            Self::Contain | Self::ScaleDown | Self::Unknown => super::images::ObjectFit::Contain,
        }
    }
}

/// One region of the composed output.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ComposerRegion {
    #[serde(default)]
    pub id: String,
    #[serde(default)]
    pub name: String,
    /// Fractions of the output, not pixels. See the module comment.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub x: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub y: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub width: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub height: Option<f64>,
    #[serde(default)]
    pub source: ComposerSource,
    #[serde(default)]
    pub fit_mode: ComposerFit,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub background_color: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub padding: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub border_radius: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub text_content: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub footer_text: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub media_url: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub media_type: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub background_media_url: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub background_media_type: Option<String>,
    #[serde(default = "yes")]
    pub show_text_layer: bool,
    #[serde(default = "yes")]
    pub show_media_layer: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub slide_text: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub slide_footer: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub slide_elements: Option<Vec<SlideElement>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub slide_canvas_size: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub slide_background_color: Option<String>,

    #[serde(flatten)]
    pub extra: Extra,
}

/// Layers default to on: a region whose layout predates the flags should show
/// its content, not hide it.
fn yes() -> bool {
    true
}

impl ComposerRegion {
    /// The region's rectangle in frame pixels.
    ///
    /// `None` when it has no area, which is a region the operator has collapsed
    /// rather than an error.
    pub fn rect(&self, frame_width: f32, frame_height: f32) -> Option<(f32, f32, f32, f32)> {
        let fraction = |value: Option<f64>| -> f32 {
            value
                .filter(|v| v.is_finite())
                .unwrap_or(0.0)
                .clamp(0.0, 1.0) as f32
        };

        let width = fraction(self.width) * frame_width;
        let height = fraction(self.height) * frame_height;
        if width <= 0.0 || height <= 0.0 {
            return None;
        }

        Some((
            fraction(self.x) * frame_width,
            fraction(self.y) * frame_height,
            width,
            height,
        ))
    }

    pub fn is_composited(&self) -> bool {
        self.source.is_composited()
    }
}

/// A named arrangement of regions.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ComposerLayout {
    #[serde(default)]
    pub id: String,
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub regions: Vec<ComposerRegion>,
    #[serde(default)]
    pub allow_overlap: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub updated_at: Option<f64>,

    #[serde(flatten)]
    pub extra: Extra,
}

/// Parse the layout the scene carries.
///
/// `None` for anything that is not a layout, rather than an error: the caller's
/// alternative is to blank the screen, and a composed output that falls back to
/// the ordinary slide is a better failure than no output.
pub fn parse_layout(raw: Option<&serde_json::Value>) -> Option<ComposerLayout> {
    let value = raw?;
    if value.is_null() {
        return None;
    }

    match serde_json::from_value::<ComposerLayout>(value.clone()) {
        Ok(layout) => Some(layout),
        Err(error) => {
            tracing::warn!(%error, "skipping an unreadable screen composer layout");
            None
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn a_layout_round_trips_with_its_unknown_fields() {
        // The hybrid surface means React still reads this after Rust has held
        // it, so a field dropped in transit is a setting that silently stops
        // applying.
        let original = json!({
            "id": "l1",
            "name": "Split",
            "allowOverlap": false,
            "somethingNewer": { "nested": true },
            "regions": [{
                "id": "r1",
                "name": "Left",
                "x": 0.0, "y": 0.0, "width": 0.5, "height": 1.0,
                "source": "slides",
                "fitMode": "contain",
                "showTextLayer": true,
                "showMediaLayer": true,
                "regionExtra": 7
            }]
        });

        let layout = parse_layout(Some(&original)).expect("layout");
        assert_eq!(layout.regions.len(), 1);
        assert_eq!(
            serde_json::to_value(&layout).expect("serialise"),
            original,
            "the layout did not survive the round trip"
        );
    }

    #[test]
    fn an_unknown_source_degrades_instead_of_failing() {
        let layout = parse_layout(Some(&json!({
            "regions": [
                { "source": "slides", "width": 0.5, "height": 1.0 },
                { "source": "holodeck", "width": 0.5, "height": 1.0 }
            ]
        })))
        .expect("layout");

        assert_eq!(layout.regions[0].source, ComposerSource::Slides);
        assert_eq!(layout.regions[1].source, ComposerSource::Unknown);
        assert!(layout.regions[0].is_composited());
        assert!(
            !layout.regions[1].is_composited(),
            "an unknown source must not be drawn"
        );
    }

    #[test]
    fn a_camera_feed_belongs_to_the_webview_layer() {
        // `getUserMedia` is a browser API, the same reason a capture prop is
        // deferred rather than drawn.
        assert!(!ComposerSource::CameraFeed.is_composited());
        assert!(ComposerSource::Video.is_composited());
        assert!(ComposerSource::Countdown.is_composited());
    }

    #[test]
    fn regions_are_fractions_of_the_output_not_pixels() {
        // What lets one layout work on a 1080p projector and a 4K screen.
        let layout = parse_layout(Some(&json!({
            "regions": [{ "x": 0.5, "y": 0.0, "width": 0.5, "height": 1.0 }]
        })))
        .expect("layout");

        assert_eq!(
            layout.regions[0].rect(1920.0, 1080.0),
            Some((960.0, 0.0, 960.0, 1080.0))
        );
        assert_eq!(
            layout.regions[0].rect(3840.0, 2160.0),
            Some((1920.0, 0.0, 1920.0, 2160.0)),
            "the same layout should fill a bigger screen"
        );
    }

    #[test]
    fn a_collapsed_region_has_no_rectangle() {
        let layout = parse_layout(Some(&json!({
            "regions": [
                { "x": 0.0, "y": 0.0, "width": 0.0, "height": 1.0 },
                { "x": 0.0, "y": 0.0, "width": 0.5, "height": 0.0 }
            ]
        })))
        .expect("layout");

        assert_eq!(layout.regions[0].rect(1920.0, 1080.0), None);
        assert_eq!(layout.regions[1].rect(1920.0, 1080.0), None);
    }

    #[test]
    fn out_of_range_geometry_is_clamped_rather_than_escaping_the_frame() {
        let layout = parse_layout(Some(&json!({
            "regions": [{ "x": 2.5, "y": -1.0, "width": 9.0, "height": 1.0 }]
        })))
        .expect("layout");

        let (x, y, width, height) = layout.regions[0].rect(1000.0, 500.0).expect("rect");
        assert_eq!((x, y), (1000.0, 0.0));
        assert_eq!((width, height), (1000.0, 500.0));
    }

    #[test]
    fn layers_default_to_showing() {
        // A layout written before the flags existed should show its content,
        // not hide it.
        let layout = parse_layout(Some(&json!({
            "regions": [{ "width": 1.0, "height": 1.0 }]
        })))
        .expect("layout");

        assert!(layout.regions[0].show_text_layer);
        assert!(layout.regions[0].show_media_layer);
    }

    #[test]
    fn scale_down_and_anything_unknown_fall_to_contain() {
        // The conservative direction: show the whole image rather than crop
        // something the operator meant to be visible.
        use super::super::images::ObjectFit;

        assert_eq!(ComposerFit::ScaleDown.to_object_fit(), ObjectFit::Contain);
        assert_eq!(ComposerFit::Unknown.to_object_fit(), ObjectFit::Contain);
        assert_eq!(ComposerFit::Cover.to_object_fit(), ObjectFit::Cover);
        assert_eq!(ComposerFit::Fill.to_object_fit(), ObjectFit::Fill);
    }

    #[test]
    fn anything_that_is_not_a_layout_reads_as_none() {
        assert!(parse_layout(None).is_none());
        assert!(parse_layout(Some(&serde_json::Value::Null)).is_none());
        assert!(parse_layout(Some(&json!("not a layout"))).is_none());
        assert!(parse_layout(Some(&json!(42))).is_none());
    }

    #[test]
    fn a_layout_with_no_regions_is_still_a_layout() {
        let layout = parse_layout(Some(&json!({ "id": "empty", "regions": [] }))).expect("layout");
        assert_eq!(layout.id, "empty");
        assert!(layout.regions.is_empty());
    }
}
