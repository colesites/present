//! What a shape is painted with, and what it is outlined with.
//!
//! A fill is the shape's own (`spPr`), else its placeholder's, else the theme
//! style its `p:style` refers to by number with a colour standing in for
//! `phClr` — which is how a template's shapes get their accent colours, and
//! why shapes came out blank while only `spPr` was read.

use roxmltree::Node;
use serde_json::{json, Value};

use super::color::{self, Palette, Rgba};
use super::xml::{self, A, R};

#[derive(Debug, Clone, PartialEq)]
pub enum Paint {
    None,
    Solid(Rgba),
    Linear {
        /// Degrees, 0 left to right, 90 top to bottom.
        angle: f64,
        /// Whether the angle is for a square stretched onto the shape.
        scaled: bool,
        stops: Vec<(f64, Rgba)>,
    },
    Radial {
        /// The centre, as fractions of the box.
        cx: f64,
        cy: f64,
        stops: Vec<(f64, Rgba)>,
    },
    Picture(Picture),
    /// `grpFill`: the enclosing group's fill.
    Group,
}

/// A picture fill: which picture, and the part of it shown.
#[derive(Debug, Clone, PartialEq)]
pub struct Picture {
    pub rel_id: String,
    pub crop: Crop,
    pub opacity: f64,
    /// Recolouring, baked into the picture when it is stored.
    pub effects: Vec<super::picture::Effect>,
}

/// How much is cut from each side of a picture, as fractions of it; a
/// negative value is space added.
#[derive(Debug, Clone, Copy, Default, PartialEq)]
pub struct Crop {
    pub left: f64,
    pub top: f64,
    pub right: f64,
    pub bottom: f64,
}

impl Crop {
    pub fn is_empty(&self) -> bool {
        self.left == 0.0 && self.top == 0.0 && self.right == 0.0 && self.bottom == 0.0
    }

    pub fn to_json(self) -> Value {
        json!({ "left": self.left, "top": self.top, "right": self.right, "bottom": self.bottom })
    }
}

const FILL_TAGS: [&str; 6] = [
    "noFill",
    "solidFill",
    "gradFill",
    "blipFill",
    "pattFill",
    "grpFill",
];

/// The fill element among `parent`'s children, if it has one.
pub fn fill_child<'a, 'i>(parent: Node<'a, 'i>) -> Option<Node<'a, 'i>> {
    xml::elements(parent).find(|node| {
        node.tag_name().namespace() == Some(A) && FILL_TAGS.contains(&node.tag_name().name())
    })
}

/// A fill element, read.
pub fn read(fill: Node, palette: &Palette) -> Paint {
    match fill.tag_name().name() {
        "noFill" => Paint::None,
        "solidFill" => color::color_child(fill)
            .and_then(|node| color::resolve(node, palette))
            .map_or(Paint::None, Paint::Solid),
        "gradFill" => gradient(fill, palette),
        "blipFill" => picture(fill, palette).map_or(Paint::None, Paint::Picture),
        // A pattern is drawn as its foreground colour for now.
        "pattFill" => xml::child(fill, A, "fgClr")
            .and_then(color::color_child)
            .and_then(|node| color::resolve(node, palette))
            .map_or(Paint::None, Paint::Solid),
        "grpFill" => Paint::Group,
        _ => Paint::None,
    }
}

fn gradient(fill: Node, palette: &Palette) -> Paint {
    let mut stops: Vec<(f64, Rgba)> = xml::child(fill, A, "gsLst")
        .map(|list| {
            xml::children(list, A, "gs")
                .filter_map(|stop| {
                    let position = xml::percent(stop, "pos").unwrap_or(0.0).clamp(0.0, 1.0);
                    let color = color::resolve(color::color_child(stop)?, palette)?;
                    Some((position, color))
                })
                .collect()
        })
        .unwrap_or_default();
    stops.sort_by(|a, b| a.0.total_cmp(&b.0));
    if stops.is_empty() {
        return Paint::None;
    }
    if let Some(path) = xml::child(fill, A, "path") {
        let rect = xml::child(path, A, "fillToRect");
        let inset = |name: &str| {
            rect.and_then(|rect| xml::percent(rect, name))
                .unwrap_or(0.0)
        };
        let (l, t, r, b) = (inset("l"), inset("t"), inset("r"), inset("b"));
        return Paint::Radial {
            cx: (l + (1.0 - r)) / 2.0,
            cy: (t + (1.0 - b)) / 2.0,
            stops,
        };
    }
    let linear = xml::child(fill, A, "lin");
    Paint::Linear {
        angle: linear
            .and_then(|lin| xml::float(lin, "ang"))
            .map_or(0.0, |angle| angle / 60_000.0),
        scaled: linear
            .and_then(|lin| xml::flag(lin, "scaled"))
            .unwrap_or(false),
        stops,
    }
}

/// A `blipFill`: the picture's relationship, its crop, its opacity and the
/// effects PowerPoint applies to it.
pub fn picture(blip_fill: Node, palette: &Palette) -> Option<Picture> {
    let blip = xml::child(blip_fill, A, "blip")?;
    let rel_id = blip
        .attribute((R, "embed"))
        .or_else(|| blip.attribute((R, "link")))?
        .to_owned();
    let crop = xml::child(blip_fill, A, "srcRect")
        .map(|rect| Crop {
            left: xml::percent(rect, "l").unwrap_or(0.0),
            top: xml::percent(rect, "t").unwrap_or(0.0),
            right: xml::percent(rect, "r").unwrap_or(0.0),
            bottom: xml::percent(rect, "b").unwrap_or(0.0),
        })
        .unwrap_or_default();
    let opacity = xml::child(blip, A, "alphaModFix")
        .and_then(|alpha| xml::percent(alpha, "amt"))
        .unwrap_or(1.0)
        .clamp(0.0, 1.0);
    Some(Picture {
        rel_id,
        crop,
        opacity,
        effects: super::picture::effects(blip, palette),
    })
}

impl Paint {
    /// As the renderers read a shape's `fill`, for a box `width` by `height`.
    /// `None` for no paint, or one drawn another way (a picture).
    pub fn to_json(&self, width: f64, height: f64) -> Option<Value> {
        let stops = |stops: &[(f64, Rgba)]| -> Value {
            Value::Array(
                stops
                    .iter()
                    .map(|(offset, color)| json!({ "offset": offset, "color": color.to_hex() }))
                    .collect(),
            )
        };
        match self {
            Self::Solid(color) => Some(json!({ "kind": "color", "color": color.to_hex() })),
            Self::Linear {
                angle,
                scaled,
                stops: list,
            } => {
                let angle = if *scaled && width > 0.0 && height > 0.0 {
                    // Drawn on a square and stretched onto the box: the
                    // gradient's direction is the square's, scaled inversely.
                    let radians = angle.to_radians();
                    (radians.sin() / height)
                        .atan2(radians.cos() / width)
                        .to_degrees()
                } else {
                    *angle
                };
                Some(json!({ "kind": "linear", "angle": angle, "stops": stops(list) }))
            }
            Self::Radial {
                cx,
                cy,
                stops: list,
            } => Some(json!({ "kind": "radial", "cx": cx, "cy": cy, "stops": stops(list) })),
            Self::None | Self::Picture(_) | Self::Group => None,
        }
    }

    /// One colour standing for the paint, for an outline or a slide colour.
    pub fn representative(&self) -> Option<Rgba> {
        match self {
            Self::Solid(color) => Some(*color),
            Self::Linear { stops, .. } | Self::Radial { stops, .. } => {
                stops.first().map(|(_, color)| *color)
            }
            _ => None,
        }
    }
}

/// An outline.
#[derive(Debug, Clone, PartialEq)]
pub struct Line {
    pub color: Rgba,
    /// In pixels.
    pub width: f64,
    /// Dash and gap lengths, as multiples of the width; empty for solid.
    pub dash: Vec<f64>,
    pub cap: &'static str,
    pub join: &'static str,
}

impl Line {
    pub fn to_json(&self) -> Value {
        let mut line = json!({
            "color": self.color.to_hex(),
            "width": self.width,
            "cap": self.cap,
            "join": self.join,
        });
        if !self.dash.is_empty() {
            line["dash"] = json!(self
                .dash
                .iter()
                .map(|part| part * self.width)
                .collect::<Vec<_>>());
        }
        line
    }
}

/// A shape's outline: its own `a:ln` over the theme line its `lnRef` names.
/// `scale` is pixels per EMU.
pub fn line(
    own: Option<Node>,
    style: Option<(Node, &Palette)>,
    palette: &Palette,
    scale: f64,
) -> Option<Line> {
    let theme_line = style.map(|(node, _)| node);
    // The paint: the shape's own, if it says, else the theme line's.
    let paint = match own.and_then(fill_child) {
        Some(fill) => read(fill, palette),
        None => match style {
            Some((node, style_palette)) => {
                fill_child(node).map_or(Paint::None, |fill| read(fill, style_palette))
            }
            None => Paint::None,
        },
    };
    let color = paint.representative()?;
    let width_emu = own
        .and_then(|ln| xml::float(ln, "w"))
        .or_else(|| theme_line.and_then(|ln| xml::float(ln, "w")))
        .unwrap_or(9525.0);
    let attribute = |name: &str| {
        own.and_then(|ln| ln.attribute(name))
            .or_else(|| theme_line.and_then(|ln| ln.attribute(name)))
    };
    let pick = |tag: &str| {
        own.and_then(|ln| xml::child(ln, A, tag))
            .or_else(|| theme_line.and_then(|ln| xml::child(ln, A, tag)))
    };
    let dash = pick("prstDash")
        .and_then(|dash| dash.attribute("val"))
        .map(preset_dash)
        .or_else(|| {
            pick("custDash").map(|custom| {
                xml::children(custom, A, "ds")
                    .flat_map(|ds| {
                        [
                            xml::percent(ds, "d").unwrap_or(1.0),
                            xml::percent(ds, "sp").unwrap_or(1.0),
                        ]
                    })
                    .collect()
            })
        })
        .unwrap_or_default();
    let join = if pick("round").is_some() {
        "round"
    } else if pick("bevel").is_some() {
        "bevel"
    } else {
        "miter"
    };
    Some(Line {
        color,
        width: (width_emu * scale).max(0.0),
        dash,
        cap: match attribute("cap") {
            Some("rnd") => "round",
            Some("sq") => "square",
            _ => "butt",
        },
        join,
    })
}

fn preset_dash(name: &str) -> Vec<f64> {
    match name {
        "dot" | "sysDot" => vec![1.0, 1.0],
        "dash" => vec![4.0, 3.0],
        "sysDash" => vec![3.0, 1.0],
        "lgDash" => vec![8.0, 3.0],
        "dashDot" => vec![4.0, 3.0, 1.0, 3.0],
        "sysDashDot" => vec![3.0, 1.0, 1.0, 1.0],
        "lgDashDot" => vec![8.0, 3.0, 1.0, 3.0],
        "lgDashDotDot" => vec![8.0, 3.0, 1.0, 3.0, 1.0, 3.0],
        "sysDashDotDot" => vec![3.0, 1.0, 1.0, 1.0, 1.0, 1.0],
        _ => Vec::new(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn read_fill(xml: &str) -> Paint {
        let wrapped = format!(r#"<r xmlns:a="{A}" xmlns:r="{R}">{xml}</r>"#);
        let document = roxmltree::Document::parse(&wrapped).expect("xml");
        let node = fill_child(document.root_element()).expect("a fill");
        read(node, &Palette::default())
    }

    #[test]
    fn a_linear_gradient_keeps_its_stops_in_order() {
        let paint = read_fill(
            r#"<a:gradFill><a:gsLst>
                <a:gs pos="100000"><a:srgbClr val="0000FF"/></a:gs>
                <a:gs pos="0"><a:srgbClr val="FF0000"/></a:gs>
            </a:gsLst><a:lin ang="5400000" scaled="0"/></a:gradFill>"#,
        );
        let json = paint.to_json(100.0, 50.0).expect("json");
        assert_eq!(json["kind"], "linear");
        assert_eq!(json["angle"], 90.0);
        assert_eq!(json["stops"][0]["color"], "#ff0000");
        assert_eq!(json["stops"][1]["offset"], 1.0);
    }

    #[test]
    fn a_path_gradient_is_radial_about_its_fill_rectangle() {
        let paint = read_fill(
            r#"<a:gradFill><a:gsLst><a:gs pos="0"><a:srgbClr val="FFFFFF"/></a:gs><a:gs pos="100000"><a:srgbClr val="000000"/></a:gs></a:gsLst>
            <a:path path="circle"><a:fillToRect l="50000" t="50000" r="50000" b="50000"/></a:path></a:gradFill>"#,
        );
        let json = paint.to_json(100.0, 100.0).expect("json");
        assert_eq!(json["kind"], "radial");
        assert_eq!(json["cx"], 0.5);
        assert_eq!(json["cy"], 0.5);
    }

    #[test]
    fn a_picture_fill_keeps_its_crop() {
        let paint = read_fill(
            r#"<a:blipFill><a:blip r:embed="rId2"><a:alphaModFix amt="50000"/></a:blip><a:srcRect l="10000" r="20000"/><a:stretch/></a:blipFill>"#,
        );
        let Paint::Picture(picture) = paint else {
            panic!("a picture");
        };
        assert_eq!(picture.rel_id, "rId2");
        assert_eq!(picture.crop.left, 0.1);
        assert_eq!(picture.crop.right, 0.2);
        assert_eq!(picture.opacity, 0.5);
    }

    #[test]
    fn an_outline_takes_the_theme_line_where_it_says_nothing() {
        let wrapped = format!(
            r#"<r xmlns:a="{A}"><a:ln w="12700"><a:prstDash val="dash"/></a:ln><a:ln w="38100" cap="rnd"><a:solidFill><a:srgbClr val="00FF00"/></a:solidFill><a:round/></a:ln></r>"#
        );
        let document = roxmltree::Document::parse(&wrapped).expect("xml");
        let mut lines = xml::children(document.root_element(), A, "ln");
        let (own, theme) = (lines.next(), lines.next().expect("theme line"));
        let palette = Palette::default();
        let line = line(own, Some((theme, &palette)), &palette, 1.0 / 9525.0).expect("a line");
        assert_eq!(line.color.to_hex(), "#00ff00", "the theme's colour");
        assert!(
            (line.width - 12700.0 / 9525.0).abs() < 1e-9,
            "its own width"
        );
        assert_eq!(line.cap, "round");
        assert_eq!(line.join, "round");
        assert_eq!(line.dash, vec![4.0, 3.0]);
    }
}
