//! What a slide is made of.
//!
//! Stage 4 carried `slide_elements` through the scene as an opaque
//! `serde_json::Value`, and said why: nothing in Rust interpreted them, so a
//! struct would have been decoration. The wgpu compositor changes that. It has
//! to draw these, which means Rust has to know what they are (ADR-001).
//!
//! **The overriding constraint is that typing this must not be able to blank
//! the audience screen.** These values come from the operator's React tree and
//! from imported PowerPoint decks, both of which can produce shapes this file
//! has not seen. A strict `serde` struct turns one unexpected element type into
//! a failed deserialisation, and a failed deserialisation mid-service is a
//! black screen in front of a congregation. So two rules run through
//! everything below:
//!
//! * **Unknown variants degrade, they do not fail.** `SlideElementType` has an
//!   `Unknown` arm via `#[serde(other)]`. The compositor skips what it cannot
//!   draw and draws the rest, which is the same trade the rest of this codebase
//!   makes — see `state::persist`, where an unreadable file starts from
//!   defaults rather than stopping the app.
//! * **Unknown fields survive.** Every struct keeps an `extra` map. The
//!   audience surface is a hybrid after ADR-001's amendment: Rust composites
//!   the slide, media and overlays, and a webview layer above it still draws
//!   the YouTube and capture props. React therefore still reads this data after
//!   it has been through Rust, and a field silently dropped in transit is a
//!   property that stops applying with nothing to point at.
//!
//! Alignment, weight and fit values stay `String` rather than becoming enums.
//! That is the precedent `services::output` set for `text_align`, and the
//! reason holds here: they are values a renderer turns into CSS or a layout
//! decision, and one Rust does not recognise should reach the renderer intact
//! rather than be replaced by a guess.

use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};

/// Anything this file did not model, kept verbatim.
pub type Extra = Map<String, Value>;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "lowercase")]
pub enum SlideElementType {
    #[default]
    Text,
    Shape,
    Image,
    Video,
    Web,
    /// Anything else. Present so a deck containing a type this build predates
    /// costs one undrawn element rather than the whole slide.
    #[serde(other)]
    Unknown,
}

impl SlideElementType {
    /// Can the Rust compositor draw this, or does it belong to the webview
    /// layer above it?
    ///
    /// `Web` is the YouTube prop and anything else that is really a browser.
    /// ADR-001's amendment keeps those on a transparent webview over the
    /// composited surface, so the compositor must know to leave a hole rather
    /// than draw a placeholder over them.
    pub const fn is_composited(self) -> bool {
        match self {
            Self::Text | Self::Shape | Self::Image | Self::Video => true,
            Self::Web | Self::Unknown => false,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct SlideElementStyle {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub font_family: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub font_size: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub font_weight: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub font_bold: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub font_underline: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub font_style: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub text_decoration: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub color: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub text_align: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub vertical_align: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub background_color: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub border_color: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub border_width: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub border_radius: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub opacity: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub stroke_color: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub stroke_width: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub shadow: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub padding_top: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub padding_right: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub padding_bottom: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub padding_left: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub text_fill_mode: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub gradient_from_color: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub gradient_to_color: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub gradient_angle: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub rotation: Option<f64>,
    #[serde(rename = "flipX", skip_serializing_if = "Option::is_none")]
    pub flip_x: Option<bool>,
    #[serde(rename = "flipY", skip_serializing_if = "Option::is_none")]
    pub flip_y: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub object_fit: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub capitalization: Option<String>,

    #[serde(flatten)]
    pub extra: Extra,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct SlideTextRun {
    #[serde(default)]
    pub text: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub font_family: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub font_size: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub font_weight: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub font_style: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub color: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub underline: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub letter_spacing: Option<f64>,

    #[serde(flatten)]
    pub extra: Extra,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct SlideTextParagraph {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub alignment: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub line_height: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub space_before: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub space_after: Option<f64>,
    #[serde(default)]
    pub runs: Vec<SlideTextRun>,

    #[serde(flatten)]
    pub extra: Extra,
}

/// The PowerPoint-shaped text model, used by imported decks.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct SlideTextBody {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub inset_left: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub inset_right: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub inset_top: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub inset_bottom: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub vertical_align: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub wrap: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub auto_fit: Option<String>,
    #[serde(default)]
    pub paragraphs: Vec<SlideTextParagraph>,

    #[serde(flatten)]
    pub extra: Extra,
}

/// One drawable thing on a slide.
///
/// Geometry is in the deck's own canvas units, which `slide_canvas_size` on the
/// scene resolves. It is deliberately not normalised here: the compositor needs
/// the same numbers the React preview uses, or the two renderings of the same
/// slide drift apart, and ADR-001 already accepts that they must be kept
/// visually identical.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct SlideElement {
    #[serde(default)]
    pub id: String,
    #[serde(rename = "type", default)]
    pub element_type: SlideElementType,
    /// Geometry is `Option` so that *absent* and *zero* stay distinguishable.
    ///
    /// A plain `#[serde(default)]` would read an omitted `width` as `0.0` and
    /// then write `"width": 0` back out — data the input never contained. React
    /// still reads these after Rust has held them (the hybrid surface), and it
    /// falls back differently for an undefined width than for a zero one, so
    /// inventing the zero would silently collapse elements the operator can see
    /// today. Use [`SlideElement::x`] and friends to read a drawable number.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub x: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub y: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub width: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub height: Option<f64>,
    /// Text, or an image URL, depending on `element_type`.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub content: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub rich_text_html: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub text_body: Option<SlideTextBody>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub is_placeholder: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub content_role: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub style: Option<SlideElementStyle>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub is_locked: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub is_visible: Option<bool>,

    #[serde(flatten)]
    pub extra: Extra,
}

impl SlideElement {
    /// `isVisible` is optional and absent means visible, which is the React
    /// reading (`element.isVisible !== false`). Getting this backwards would
    /// hide every element on every imported deck.
    pub fn is_visible(&self) -> bool {
        self.is_visible.unwrap_or(true)
    }

    /// Should the Rust compositor draw this element?
    pub fn is_composited(&self) -> bool {
        self.is_visible() && self.element_type.is_composited()
    }

    /// Geometry as the compositor wants it: a number, absence resolved to zero.
    pub fn x(&self) -> f64 {
        self.x.unwrap_or(0.0)
    }

    pub fn y(&self) -> f64 {
        self.y.unwrap_or(0.0)
    }

    pub fn width(&self) -> f64 {
        self.width.unwrap_or(0.0)
    }

    pub fn height(&self) -> f64 {
        self.height.unwrap_or(0.0)
    }

    pub fn content(&self) -> &str {
        self.content.as_deref().unwrap_or("")
    }
}

/// Parse the elements the scene carries.
///
/// Returns `None` for anything that is not an array, rather than erroring: the
/// caller's alternative is to blank the slide, and an empty slide with a
/// background is a better failure than no slide at all.
pub fn parse_elements(raw: Option<&Value>) -> Option<Vec<SlideElement>> {
    let array = raw?.as_array()?;

    let mut elements = Vec::with_capacity(array.len());
    for value in array {
        match serde_json::from_value::<SlideElement>(value.clone()) {
            Ok(element) => elements.push(element),
            Err(error) => {
                // One unreadable element must not cost the other eleven.
                tracing::warn!(%error, "skipping an unreadable slide element");
            }
        }
    }
    Some(elements)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn an_unknown_element_type_degrades_instead_of_failing() {
        // The rule the whole module is built around. A deck containing a type
        // this build predates must cost one undrawn element, never the slide.
        let elements = parse_elements(Some(&json!([
            { "id": "a", "type": "text", "content": "Amazing grace" },
            { "id": "b", "type": "hologram", "content": "?" },
        ])))
        .expect("array");

        assert_eq!(elements.len(), 2);
        assert_eq!(elements[0].element_type, SlideElementType::Text);
        assert_eq!(elements[1].element_type, SlideElementType::Unknown);
        assert!(!elements[1].is_composited());
        // The known one still draws.
        assert!(elements[0].is_composited());
    }

    #[test]
    fn unknown_fields_survive_a_round_trip() {
        // The audience surface is a hybrid (ADR-001 amendment): React still
        // reads this data after it has been through Rust. A field dropped in
        // transit is a property that silently stops applying, with nothing to
        // point at.
        let original = json!({
            "id": "a",
            "type": "text",
            "x": 10.0, "y": 20.0, "width": 100.0, "height": 50.0,
            "content": "Amazing grace",
            "someFutureField": { "nested": [1, 2, 3] },
            "style": { "fontSize": 48.0, "anotherFutureField": "kept" }
        });

        let element: SlideElement = serde_json::from_value(original.clone()).expect("parse");
        assert_eq!(
            element.extra.get("someFutureField"),
            Some(&json!({ "nested": [1, 2, 3] }))
        );
        assert_eq!(
            element
                .style
                .as_ref()
                .unwrap()
                .extra
                .get("anotherFutureField"),
            Some(&json!("kept"))
        );

        let back = serde_json::to_value(&element).expect("serialise");
        assert_eq!(back, original, "the element did not survive the round trip");
    }

    #[test]
    fn an_absent_visibility_flag_means_visible() {
        // React reads `element.isVisible !== false`. Getting this backwards
        // would hide every element of every imported deck, which is the kind of
        // mistake that only shows up in front of a congregation.
        let visible: SlideElement = serde_json::from_value(json!({ "id": "a" })).expect("parse");
        assert!(visible.is_visible());

        let hidden: SlideElement =
            serde_json::from_value(json!({ "id": "a", "isVisible": false })).expect("parse");
        assert!(!hidden.is_visible());
        assert!(!hidden.is_composited());
    }

    #[test]
    fn web_elements_are_left_to_the_webview_layer() {
        // ADR-001's amendment: YouTube and capture props stay on a transparent
        // webview above the composited surface. The compositor has to leave a
        // hole rather than draw over them.
        let web: SlideElement =
            serde_json::from_value(json!({ "id": "a", "type": "web" })).expect("parse");

        assert!(web.is_visible());
        assert!(!web.is_composited(), "a web element must not be composited");
    }

    #[test]
    fn one_unreadable_element_does_not_cost_the_others() {
        let elements = parse_elements(Some(&json!([
            { "id": "a", "type": "text" },
            "not an object at all",
            { "id": "c", "type": "shape" },
        ])))
        .expect("array");

        assert_eq!(elements.len(), 2);
        assert_eq!(elements[0].id, "a");
        assert_eq!(elements[1].id, "c");
    }

    #[test]
    fn anything_that_is_not_an_array_reads_as_no_elements() {
        assert!(parse_elements(None).is_none());
        assert!(parse_elements(Some(&Value::Null)).is_none());
        assert!(parse_elements(Some(&json!({ "not": "an array" }))).is_none());
        assert_eq!(parse_elements(Some(&json!([]))), Some(vec![]));
    }

    #[test]
    fn the_acronym_fields_keep_the_names_the_frontend_uses() {
        // `rename_all = "camelCase"` has already mangled one field in this tree
        // (`mediaFilterCSS`, handoff §12) and nothing at runtime would catch it.
        let element = SlideElement {
            style: Some(SlideElementStyle {
                flip_x: Some(true),
                flip_y: Some(false),
                ..SlideElementStyle::default()
            }),
            rich_text_html: Some("<b>x</b>".to_owned()),
            ..SlideElement::default()
        };

        let json = serde_json::to_string(&element).expect("serialise");
        assert!(json.contains("\"flipX\":true"), "{json}");
        assert!(json.contains("\"flipY\":false"), "{json}");
        assert!(json.contains("\"richTextHtml\""), "{json}");
        assert!(json.contains("\"type\":\"text\""), "{json}");
    }

    #[test]
    fn a_powerpoint_text_body_round_trips() {
        // Imported decks carry the paragraph/run model rather than a flat
        // string. It is the shape most likely to contain fields this file has
        // not seen, so it is the one most worth proving intact.
        let original = json!({
            "id": "a",
            "type": "text",
            "textBody": {
                "verticalAlign": "middle",
                "paragraphs": [{
                    "alignment": "center",
                    "runs": [
                        { "text": "Holy, ", "fontSize": 54.0, "color": "#fff" },
                        { "text": "holy", "underline": true, "unmodelled": 1 }
                    ]
                }]
            }
        });

        let element: SlideElement = serde_json::from_value(original.clone()).expect("parse");
        let body = element.text_body.as_ref().expect("text body");
        assert_eq!(body.paragraphs.len(), 1);
        assert_eq!(body.paragraphs[0].runs.len(), 2);
        assert_eq!(body.paragraphs[0].runs[0].text, "Holy, ");

        assert_eq!(
            serde_json::to_value(&element).expect("serialise"),
            original,
            "an imported deck's text body did not survive the round trip"
        );
    }

    #[test]
    fn absent_geometry_stays_absent_but_reads_as_zero() {
        let element: SlideElement =
            serde_json::from_value(json!({ "id": "a", "type": "shape" })).expect("parse");

        // The compositor gets a number.
        assert_eq!(
            (element.x(), element.y(), element.width(), element.height()),
            (0.0, 0.0, 0.0, 0.0)
        );
        assert_eq!(element.content(), "");

        // React gets back exactly what it sent. Writing `"width": 0` here would
        // be inventing data: an undefined width and a zero one lay out
        // differently, so the zero would collapse elements that render today.
        assert_eq!(element.width, None);
        assert_eq!(
            serde_json::to_value(&element).expect("serialise"),
            json!({ "id": "a", "type": "shape" })
        );
    }
}
