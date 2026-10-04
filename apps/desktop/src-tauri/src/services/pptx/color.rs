//! DrawingML colours, resolved to the colour PowerPoint paints.
//!
//! A colour is a base — RGB, a scheme slot, a system colour, HSL, linear RGB or
//! a named preset — followed by any number of adjustments applied in order:
//! luminance, saturation and hue in HSL; tint and shade in linear light, as
//! PowerPoint does them; and alpha. Every kind is read: the old importer took
//! RGB and scheme colours and painted everything else black.

use std::collections::HashMap;

use roxmltree::Node;

use super::xml::{self, A};

/// A colour with straight alpha, each channel from 0 to 1.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Rgba {
    pub r: f64,
    pub g: f64,
    pub b: f64,
    pub a: f64,
}

impl Rgba {
    pub const BLACK: Self = Self::opaque(0.0, 0.0, 0.0);
    pub const WHITE: Self = Self::opaque(1.0, 1.0, 1.0);

    pub const fn opaque(r: f64, g: f64, b: f64) -> Self {
        Self { r, g, b, a: 1.0 }
    }

    pub fn from_hex(text: &str) -> Option<Self> {
        let hex = text.trim().trim_start_matches('#');
        if hex.len() != 6 || !hex.chars().all(|c| c.is_ascii_hexdigit()) {
            return None;
        }
        let channel = |at: usize| {
            u8::from_str_radix(&hex[at..at + 2], 16)
                .ok()
                .map(|v| f64::from(v) / 255.0)
        };
        Some(Self::opaque(channel(0)?, channel(2)?, channel(4)?))
    }

    /// `#rrggbb`, or `#rrggbbaa` when it is not opaque — what the renderers read.
    pub fn to_hex(self) -> String {
        let byte = |value: f64| (value.clamp(0.0, 1.0) * 255.0).round() as u8;
        let alpha = byte(self.a);
        if alpha == 255 {
            format!(
                "#{:02x}{:02x}{:02x}",
                byte(self.r),
                byte(self.g),
                byte(self.b)
            )
        } else {
            format!(
                "#{:02x}{:02x}{:02x}{:02x}",
                byte(self.r),
                byte(self.g),
                byte(self.b),
                alpha
            )
        }
    }

    pub fn with_alpha(self, a: f64) -> Self {
        Self {
            a: a.clamp(0.0, 1.0),
            ..self
        }
    }
}

/// What a scheme colour can name: the theme's twelve slots, after the master's
/// colour map has said which of them `tx1`, `bg1` and the rest mean, and the
/// colour a style reference passes down as `phClr`.
#[derive(Debug, Clone, Default)]
pub struct Palette {
    /// The theme's slots, by name: `dk1`, `lt1`, `accent1`…
    pub scheme: HashMap<String, Rgba>,
    /// `bg1` → `lt1` and so on: the colour map in force.
    pub map: HashMap<String, String>,
    /// `phClr`: the colour a `fillRef`, `lnRef` or `fontRef` supplies.
    pub placeholder: Option<Rgba>,
}

impl Palette {
    pub fn scheme_color(&self, name: &str) -> Option<Rgba> {
        if name == "phClr" {
            return self.placeholder;
        }
        let slot = self.map.get(name).map_or(name, String::as_str);
        self.scheme
            .get(slot)
            .or_else(|| self.scheme.get(name))
            .copied()
    }

    /// The same palette with `phClr` set.
    pub fn with_placeholder(&self, color: Option<Rgba>) -> Self {
        Self {
            placeholder: color,
            ..self.clone()
        }
    }
}

const COLOR_TAGS: [&str; 6] = [
    "srgbClr",
    "schemeClr",
    "sysClr",
    "hslClr",
    "scrgbClr",
    "prstClr",
];

/// The first colour element among `node`'s children.
pub fn color_child<'a, 'i>(node: Node<'a, 'i>) -> Option<Node<'a, 'i>> {
    xml::elements(node).find(|candidate| {
        candidate.tag_name().namespace() == Some(A)
            && COLOR_TAGS.contains(&candidate.tag_name().name())
    })
}

/// Resolve a colour element (`a:srgbClr` and its kin) with its adjustments.
pub fn resolve(node: Node, palette: &Palette) -> Option<Rgba> {
    let base = match node.tag_name().name() {
        "srgbClr" => Rgba::from_hex(node.attribute("val")?)?,
        "schemeClr" => palette.scheme_color(node.attribute("val")?)?,
        "sysClr" => node
            .attribute("lastClr")
            .and_then(Rgba::from_hex)
            .or_else(|| system_color(node.attribute("val")?))?,
        "hslClr" => {
            let hue = xml::float(node, "hue").unwrap_or(0.0) / 60_000.0 / 360.0;
            let sat = xml::percent(node, "sat").unwrap_or(0.0);
            let lum = xml::percent(node, "lum").unwrap_or(0.0);
            let (r, g, b) = hsl_to_rgb(hue, sat, lum);
            Rgba::opaque(r, g, b)
        }
        "scrgbClr" => Rgba::opaque(
            linear_to_srgb(xml::percent(node, "r").unwrap_or(0.0)),
            linear_to_srgb(xml::percent(node, "g").unwrap_or(0.0)),
            linear_to_srgb(xml::percent(node, "b").unwrap_or(0.0)),
        ),
        "prstClr" => preset_color(node.attribute("val")?)?,
        _ => return None,
    };
    Some(adjust(base, node))
}

fn adjust(mut color: Rgba, node: Node) -> Rgba {
    for adjustment in xml::elements(node) {
        let value = xml::percent(adjustment, "val");
        let raw = xml::float(adjustment, "val");
        match adjustment.tag_name().name() {
            "alpha" => color.a = value.unwrap_or(1.0).clamp(0.0, 1.0),
            "alphaMod" => color.a = (color.a * value.unwrap_or(1.0)).clamp(0.0, 1.0),
            "alphaOff" => color.a = (color.a + value.unwrap_or(0.0)).clamp(0.0, 1.0),
            "lumMod" | "lumOff" | "satMod" | "satOff" | "hueMod" | "hueOff" | "lum" | "sat"
            | "hue" => {
                let (mut h, mut s, mut l) = rgb_to_hsl(color.r, color.g, color.b);
                match adjustment.tag_name().name() {
                    "lumMod" => l *= value.unwrap_or(1.0),
                    "lumOff" => l += value.unwrap_or(0.0),
                    "lum" => l = value.unwrap_or(l),
                    "satMod" => s *= value.unwrap_or(1.0),
                    "satOff" => s += value.unwrap_or(0.0),
                    "sat" => s = value.unwrap_or(s),
                    "hueMod" => h *= value.unwrap_or(1.0),
                    "hueOff" => h += raw.unwrap_or(0.0) / 60_000.0 / 360.0,
                    "hue" => h = raw.unwrap_or(0.0) / 60_000.0 / 360.0,
                    _ => {}
                }
                let (r, g, b) = hsl_to_rgb(h.rem_euclid(1.0), s.clamp(0.0, 1.0), l.clamp(0.0, 1.0));
                color = Rgba { r, g, b, ..color };
            }
            // Tint toward white and shade toward black are in linear light.
            "tint" => {
                let tint = value.unwrap_or(1.0);
                color = map_linear(color, |c| c * tint + (1.0 - tint));
            }
            "shade" => {
                let shade = value.unwrap_or(1.0);
                color = map_linear(color, |c| c * shade);
            }
            "comp" => {
                let (h, s, l) = rgb_to_hsl(color.r, color.g, color.b);
                let (r, g, b) = hsl_to_rgb((h + 0.5).rem_euclid(1.0), s, l);
                color = Rgba { r, g, b, ..color };
            }
            "inv" => {
                color = Rgba {
                    r: 1.0 - color.r,
                    g: 1.0 - color.g,
                    b: 1.0 - color.b,
                    ..color
                }
            }
            "gray" => {
                let y = 0.2126 * color.r + 0.7152 * color.g + 0.0722 * color.b;
                color = Rgba {
                    r: y,
                    g: y,
                    b: y,
                    ..color
                };
            }
            "gamma" => color = map(color, linear_to_srgb),
            "invGamma" => color = map(color, srgb_to_linear),
            "red" => color.r = value.unwrap_or(color.r).clamp(0.0, 1.0),
            "redMod" => color.r = (color.r * value.unwrap_or(1.0)).clamp(0.0, 1.0),
            "redOff" => color.r = (color.r + value.unwrap_or(0.0)).clamp(0.0, 1.0),
            "green" => color.g = value.unwrap_or(color.g).clamp(0.0, 1.0),
            "greenMod" => color.g = (color.g * value.unwrap_or(1.0)).clamp(0.0, 1.0),
            "greenOff" => color.g = (color.g + value.unwrap_or(0.0)).clamp(0.0, 1.0),
            "blue" => color.b = value.unwrap_or(color.b).clamp(0.0, 1.0),
            "blueMod" => color.b = (color.b * value.unwrap_or(1.0)).clamp(0.0, 1.0),
            "blueOff" => color.b = (color.b + value.unwrap_or(0.0)).clamp(0.0, 1.0),
            _ => {}
        }
    }
    color
}

fn map(color: Rgba, f: impl Fn(f64) -> f64) -> Rgba {
    Rgba {
        r: f(color.r).clamp(0.0, 1.0),
        g: f(color.g).clamp(0.0, 1.0),
        b: f(color.b).clamp(0.0, 1.0),
        a: color.a,
    }
}

fn map_linear(color: Rgba, f: impl Fn(f64) -> f64) -> Rgba {
    map(color, |c| {
        linear_to_srgb(f(srgb_to_linear(c)).clamp(0.0, 1.0))
    })
}

pub fn srgb_to_linear(c: f64) -> f64 {
    if c <= 0.04045 {
        c / 12.92
    } else {
        ((c + 0.055) / 1.055).powf(2.4)
    }
}

pub fn linear_to_srgb(c: f64) -> f64 {
    let c = c.clamp(0.0, 1.0);
    if c <= 0.003_130_8 {
        c * 12.92
    } else {
        1.055 * c.powf(1.0 / 2.4) - 0.055
    }
}

/// HSL with every component from 0 to 1.
pub fn rgb_to_hsl(r: f64, g: f64, b: f64) -> (f64, f64, f64) {
    let max = r.max(g).max(b);
    let min = r.min(g).min(b);
    let l = (max + min) / 2.0;
    if (max - min).abs() < f64::EPSILON {
        return (0.0, 0.0, l);
    }
    let d = max - min;
    let s = if l > 0.5 {
        d / (2.0 - max - min)
    } else {
        d / (max + min)
    };
    let h = if (max - r).abs() < f64::EPSILON {
        (g - b) / d + if g < b { 6.0 } else { 0.0 }
    } else if (max - g).abs() < f64::EPSILON {
        (b - r) / d + 2.0
    } else {
        (r - g) / d + 4.0
    };
    (h / 6.0, s, l)
}

pub fn hsl_to_rgb(h: f64, s: f64, l: f64) -> (f64, f64, f64) {
    if s <= 0.0 {
        return (l, l, l);
    }
    let q = if l < 0.5 {
        l * (1.0 + s)
    } else {
        l + s - l * s
    };
    let p = 2.0 * l - q;
    let channel = |t: f64| {
        let t = t.rem_euclid(1.0);
        if t < 1.0 / 6.0 {
            p + (q - p) * 6.0 * t
        } else if t < 0.5 {
            q
        } else if t < 2.0 / 3.0 {
            p + (q - p) * (2.0 / 3.0 - t) * 6.0
        } else {
            p
        }
    };
    (channel(h + 1.0 / 3.0), channel(h), channel(h - 1.0 / 3.0))
}

fn system_color(name: &str) -> Option<Rgba> {
    Some(match name {
        "window" | "menu" | "info" | "highlightText" | "captionText" | "btnHighlight" => {
            Rgba::WHITE
        }
        "windowText" | "menuText" | "infoText" | "btnText" | "3dDkShadow" => Rgba::BLACK,
        "btnFace" | "3dLight" | "menuBar" => Rgba::opaque(0.941, 0.941, 0.941),
        "btnShadow" | "grayText" => Rgba::opaque(0.627, 0.627, 0.627),
        "highlight" | "hotLight" | "menuHighlight" => Rgba::opaque(0.0, 0.47, 0.843),
        _ => return None,
    })
}

/// DrawingML's preset colours are CSS's named colours, with `dk`, `lt` and
/// `med` for dark, light and medium.
fn preset_color(name: &str) -> Option<Rgba> {
    let lower = name.to_ascii_lowercase();
    let expanded = if let Some(rest) = lower.strip_prefix("dk") {
        format!("dark{rest}")
    } else if let Some(rest) = lower.strip_prefix("lt") {
        format!("light{rest}")
    } else if let Some(rest) = lower.strip_prefix("med") {
        format!("medium{rest}")
    } else {
        lower
    };
    let hex = CSS_COLORS
        .iter()
        .find(|(css, _)| *css == expanded)
        .map(|(_, hex)| *hex)?;
    Rgba::from_hex(hex)
}

const CSS_COLORS: &[(&str, &str)] = &[
    ("aliceblue", "f0f8ff"),
    ("antiquewhite", "faebd7"),
    ("aqua", "00ffff"),
    ("aquamarine", "7fffd4"),
    ("azure", "f0ffff"),
    ("beige", "f5f5dc"),
    ("bisque", "ffe4c4"),
    ("black", "000000"),
    ("blanchedalmond", "ffebcd"),
    ("blue", "0000ff"),
    ("blueviolet", "8a2be2"),
    ("brown", "a52a2a"),
    ("burlywood", "deb887"),
    ("cadetblue", "5f9ea0"),
    ("chartreuse", "7fff00"),
    ("chocolate", "d2691e"),
    ("coral", "ff7f50"),
    ("cornflowerblue", "6495ed"),
    ("cornsilk", "fff8dc"),
    ("crimson", "dc143c"),
    ("cyan", "00ffff"),
    ("darkblue", "00008b"),
    ("darkcyan", "008b8b"),
    ("darkgoldenrod", "b8860b"),
    ("darkgray", "a9a9a9"),
    ("darkgrey", "a9a9a9"),
    ("darkgreen", "006400"),
    ("darkkhaki", "bdb76b"),
    ("darkmagenta", "8b008b"),
    ("darkolivegreen", "556b2f"),
    ("darkorange", "ff8c00"),
    ("darkorchid", "9932cc"),
    ("darkred", "8b0000"),
    ("darksalmon", "e9967a"),
    ("darkseagreen", "8fbc8f"),
    ("darkslateblue", "483d8b"),
    ("darkslategray", "2f4f4f"),
    ("darkslategrey", "2f4f4f"),
    ("darkturquoise", "00ced1"),
    ("darkviolet", "9400d3"),
    ("deeppink", "ff1493"),
    ("deepskyblue", "00bfff"),
    ("dimgray", "696969"),
    ("dimgrey", "696969"),
    ("dodgerblue", "1e90ff"),
    ("firebrick", "b22222"),
    ("floralwhite", "fffaf0"),
    ("forestgreen", "228b22"),
    ("fuchsia", "ff00ff"),
    ("gainsboro", "dcdcdc"),
    ("ghostwhite", "f8f8ff"),
    ("gold", "ffd700"),
    ("goldenrod", "daa520"),
    ("gray", "808080"),
    ("grey", "808080"),
    ("green", "008000"),
    ("greenyellow", "adff2f"),
    ("honeydew", "f0fff0"),
    ("hotpink", "ff69b4"),
    ("indianred", "cd5c5c"),
    ("indigo", "4b0082"),
    ("ivory", "fffff0"),
    ("khaki", "f0e68c"),
    ("lavender", "e6e6fa"),
    ("lavenderblush", "fff0f5"),
    ("lawngreen", "7cfc00"),
    ("lemonchiffon", "fffacd"),
    ("lightblue", "add8e6"),
    ("lightcoral", "f08080"),
    ("lightcyan", "e0ffff"),
    ("lightgoldenrodyellow", "fafad2"),
    ("lightgray", "d3d3d3"),
    ("lightgrey", "d3d3d3"),
    ("lightgreen", "90ee90"),
    ("lightpink", "ffb6c1"),
    ("lightsalmon", "ffa07a"),
    ("lightseagreen", "20b2aa"),
    ("lightskyblue", "87cefa"),
    ("lightslategray", "778899"),
    ("lightslategrey", "778899"),
    ("lightsteelblue", "b0c4de"),
    ("lightyellow", "ffffe0"),
    ("lime", "00ff00"),
    ("limegreen", "32cd32"),
    ("linen", "faf0e6"),
    ("magenta", "ff00ff"),
    ("maroon", "800000"),
    ("mediumaquamarine", "66cdaa"),
    ("mediumblue", "0000cd"),
    ("mediumorchid", "ba55d3"),
    ("mediumpurple", "9370db"),
    ("mediumseagreen", "3cb371"),
    ("mediumslateblue", "7b68ee"),
    ("mediumspringgreen", "00fa9a"),
    ("mediumturquoise", "48d1cc"),
    ("mediumvioletred", "c71585"),
    ("midnightblue", "191970"),
    ("mintcream", "f5fffa"),
    ("mistyrose", "ffe4e1"),
    ("moccasin", "ffe4b5"),
    ("navajowhite", "ffdead"),
    ("navy", "000080"),
    ("oldlace", "fdf5e6"),
    ("olive", "808000"),
    ("olivedrab", "6b8e23"),
    ("orange", "ffa500"),
    ("orangered", "ff4500"),
    ("orchid", "da70d6"),
    ("palegoldenrod", "eee8aa"),
    ("palegreen", "98fb98"),
    ("paleturquoise", "afeeee"),
    ("palevioletred", "db7093"),
    ("papayawhip", "ffefd5"),
    ("peachpuff", "ffdab9"),
    ("peru", "cd853f"),
    ("pink", "ffc0cb"),
    ("plum", "dda0dd"),
    ("powderblue", "b0e0e6"),
    ("purple", "800080"),
    ("red", "ff0000"),
    ("rosybrown", "bc8f8f"),
    ("royalblue", "4169e1"),
    ("saddlebrown", "8b4513"),
    ("salmon", "fa8072"),
    ("sandybrown", "f4a460"),
    ("seagreen", "2e8b57"),
    ("seashell", "fff5ee"),
    ("sienna", "a0522d"),
    ("silver", "c0c0c0"),
    ("skyblue", "87ceeb"),
    ("slateblue", "6a5acd"),
    ("slategray", "708090"),
    ("slategrey", "708090"),
    ("snow", "fffafa"),
    ("springgreen", "00ff7f"),
    ("steelblue", "4682b4"),
    ("tan", "d2b48c"),
    ("teal", "008080"),
    ("thistle", "d8bfd8"),
    ("tomato", "ff6347"),
    ("turquoise", "40e0d0"),
    ("violet", "ee82ee"),
    ("wheat", "f5deb3"),
    ("white", "ffffff"),
    ("whitesmoke", "f5f5f5"),
    ("yellow", "ffff00"),
    ("yellowgreen", "9acd32"),
];

#[cfg(test)]
mod tests {
    use super::*;

    fn color(xml: &str, palette: &Palette) -> Option<String> {
        let wrapped = format!(r#"<r xmlns:a="{A}">{xml}</r>"#);
        let document = roxmltree::Document::parse(&wrapped).expect("xml");
        let node = color_child(document.root_element())?;
        resolve(node, palette).map(Rgba::to_hex)
    }

    fn palette() -> Palette {
        let mut palette = Palette::default();
        palette
            .scheme
            .insert("dk1".into(), Rgba::from_hex("000000").unwrap());
        palette
            .scheme
            .insert("lt1".into(), Rgba::from_hex("FFFFFF").unwrap());
        palette
            .scheme
            .insert("accent1".into(), Rgba::from_hex("4472C4").unwrap());
        palette.map.insert("tx1".into(), "dk1".into());
        palette.map.insert("bg1".into(), "lt1".into());
        palette
    }

    #[test]
    fn every_kind_of_base_colour_reads() {
        let palette = palette();
        assert_eq!(
            color(r#"<a:srgbClr val="FF8000"/>"#, &palette).as_deref(),
            Some("#ff8000")
        );
        assert_eq!(
            color(r#"<a:schemeClr val="tx1"/>"#, &palette).as_deref(),
            Some("#000000")
        );
        assert_eq!(
            color(r#"<a:schemeClr val="bg1"/>"#, &palette).as_deref(),
            Some("#ffffff")
        );
        assert_eq!(
            color(r#"<a:sysClr val="windowText" lastClr="111111"/>"#, &palette).as_deref(),
            Some("#111111")
        );
        assert_eq!(
            color(r#"<a:prstClr val="dkBlue"/>"#, &palette).as_deref(),
            Some("#00008b")
        );
        assert_eq!(
            color(r#"<a:hslClr hue="0" sat="100000" lum="50000"/>"#, &palette).as_deref(),
            Some("#ff0000")
        );
        assert_eq!(
            color(r#"<a:scrgbClr r="100000" g="0" b="0"/>"#, &palette).as_deref(),
            Some("#ff0000")
        );
    }

    #[test]
    fn adjustments_apply_in_order() {
        let palette = palette();
        // Accent 1, 25% darker: PowerPoint's swatch is #2F5597.
        assert_eq!(
            color(
                r#"<a:schemeClr val="accent1"><a:lumMod val="75000"/></a:schemeClr>"#,
                &palette
            )
            .as_deref(),
            Some("#2f5597")
        );
        // Accent 1, 40% lighter: PowerPoint's swatch is #8FAADC.
        assert_eq!(
            color(
                r#"<a:schemeClr val="accent1"><a:lumMod val="60000"/><a:lumOff val="40000"/></a:schemeClr>"#,
                &palette
            )
            .as_deref(),
            Some("#8faadc")
        );
        assert_eq!(
            color(
                r#"<a:srgbClr val="000000"><a:alpha val="50000"/></a:srgbClr>"#,
                &palette
            )
            .as_deref(),
            Some("#00000080")
        );
    }

    #[test]
    fn a_style_reference_supplies_ph_clr() {
        let palette = palette().with_placeholder(Rgba::from_hex("123456"));
        assert_eq!(
            color(r#"<a:schemeClr val="phClr"/>"#, &palette).as_deref(),
            Some("#123456")
        );
    }
}
