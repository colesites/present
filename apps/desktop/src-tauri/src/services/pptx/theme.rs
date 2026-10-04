//! A master's theme: its colours, its fonts, and the fills, lines and
//! backgrounds its shapes refer to by number.

use roxmltree::{Document, Node};

use super::color::{self, Palette, Rgba};
use super::xml::{self, A, P};

const SCHEME_SLOTS: [&str; 12] = [
    "dk1", "lt1", "dk2", "lt2", "accent1", "accent2", "accent3", "accent4", "accent5", "accent6",
    "hlink", "folHlink",
];

/// The colour map PowerPoint assumes when a master has none.
const DEFAULT_MAP: [(&str, &str); 12] = [
    ("bg1", "lt1"),
    ("tx1", "dk1"),
    ("bg2", "lt2"),
    ("tx2", "dk2"),
    ("accent1", "accent1"),
    ("accent2", "accent2"),
    ("accent3", "accent3"),
    ("accent4", "accent4"),
    ("accent5", "accent5"),
    ("accent6", "accent6"),
    ("hlink", "hlink"),
    ("folHlink", "folHlink"),
];

pub struct Theme<'a, 'i> {
    pub palette: Palette,
    major: Fonts,
    minor: Fonts,
    fill_styles: Vec<Node<'a, 'i>>,
    line_styles: Vec<Node<'a, 'i>>,
    background_styles: Vec<Node<'a, 'i>>,
}

#[derive(Debug, Clone, Default)]
struct Fonts {
    latin: Option<String>,
    east_asian: Option<String>,
    complex: Option<String>,
}

impl<'a, 'i> Theme<'a, 'i> {
    /// The theme in `theme`, with `master`'s colour map, overridden by any
    /// layout's or slide's `clrMapOvr` given in `overrides`.
    pub fn read(theme: Option<&'a Document<'i>>, master: Option<Node>, overrides: &[Node]) -> Self {
        let root = theme.map(Document::root_element);
        let elements = root.map(|root| root.descendants());

        let mut palette = Palette::default();
        if let Some(scheme) = elements
            .clone()
            .and_then(|mut nodes| nodes.find(|node| xml::is(*node, A, "clrScheme")))
        {
            for slot in SCHEME_SLOTS {
                if let Some(value) = xml::child(scheme, A, slot)
                    .and_then(color::color_child)
                    .and_then(|node| color::resolve(node, &palette))
                {
                    palette.scheme.insert(slot.to_owned(), value);
                }
            }
        }
        for (alias, slot) in DEFAULT_MAP {
            palette.map.insert(alias.to_owned(), slot.to_owned());
        }
        if let Some(map) = master.and_then(|master| xml::child(master, P, "clrMap")) {
            for attribute in map.attributes() {
                palette
                    .map
                    .insert(attribute.name().to_owned(), attribute.value().to_owned());
            }
        }
        for over in overrides {
            if let Some(mapping) = xml::child(*over, A, "overrideClrMapping") {
                for attribute in mapping.attributes() {
                    palette
                        .map
                        .insert(attribute.name().to_owned(), attribute.value().to_owned());
                }
            }
        }

        let font_scheme = elements
            .clone()
            .and_then(|mut nodes| nodes.find(|node| xml::is(*node, A, "fontScheme")));
        let fonts = |name: &str| {
            let Some(collection) = font_scheme.and_then(|scheme| xml::child(scheme, A, name))
            else {
                return Fonts::default();
            };
            let face = |tag: &str| {
                xml::child(collection, A, tag)
                    .and_then(|node| node.attribute("typeface"))
                    .filter(|face| !face.is_empty())
                    .map(str::to_owned)
            };
            Fonts {
                latin: face("latin"),
                east_asian: face("ea"),
                complex: face("cs"),
            }
        };

        let format =
            elements.and_then(|mut nodes| nodes.find(|node| xml::is(*node, A, "fmtScheme")));
        let list = |name: &str| -> Vec<Node<'a, 'i>> {
            format
                .and_then(|format| xml::child(format, A, name))
                .map(|list| xml::elements(list).collect())
                .unwrap_or_default()
        };

        Self {
            palette,
            major: fonts("majorFont"),
            minor: fonts("minorFont"),
            fill_styles: list("fillStyleLst"),
            line_styles: list("lnStyleLst"),
            background_styles: list("bgFillStyleLst"),
        }
    }

    /// A typeface as written, with the theme's `+mj-lt`, `+mn-ea` and the
    /// rest resolved to the font they stand for.
    pub fn typeface(&self, face: &str) -> Option<String> {
        let fonts = match face.get(..4) {
            Some("+mj-") => &self.major,
            Some("+mn-") => &self.minor,
            _ => return Some(face.to_owned()).filter(|face| !face.is_empty()),
        };
        match &face[4..] {
            "lt" => fonts.latin.clone(),
            "ea" => fonts.east_asian.clone().or_else(|| fonts.latin.clone()),
            "cs" => fonts.complex.clone().or_else(|| fonts.latin.clone()),
            _ => fonts.latin.clone(),
        }
    }

    /// `major` or `minor`: the theme's heading or body font.
    pub fn font_collection(&self, idx: &str) -> Option<String> {
        match idx {
            "major" => self.major.latin.clone(),
            "minor" => self.minor.latin.clone(),
            _ => None,
        }
    }

    /// The fill a `fillRef` or `bgRef` with this `idx` names: 1 to 999 in the
    /// fill styles, 1001 and up in the background fill styles, 0 none.
    pub fn fill_style(&self, idx: i64) -> Option<Node<'a, 'i>> {
        match idx {
            1..=999 => self.fill_styles.get(idx as usize - 1).copied(),
            1001.. => self.background_styles.get(idx as usize - 1001).copied(),
            _ => None,
        }
    }

    pub fn line_style(&self, idx: i64) -> Option<Node<'a, 'i>> {
        (idx >= 1)
            .then(|| self.line_styles.get(idx as usize - 1).copied())
            .flatten()
    }

    pub fn color(&self, node: Node) -> Option<Rgba> {
        color::resolve(node, &self.palette)
    }
}
