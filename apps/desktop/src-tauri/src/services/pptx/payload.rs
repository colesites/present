//! parse_pptx.py, in Rust: a .pptx read into the payload the conversion turns
//! into slides.
//!
//! The Python is written against python-pptx, so the behaviour to reproduce
//! is python-pptx's as much as the script's. The places that decide the output:
//!
//! - **every `p:sp` is text**, whatever its geometry, and one with no text body
//!   gets an empty paragraph, as `Shape.text_frame` adds one
//! - a picture in a picture **placeholder** is not a picture (its shape type is
//!   `PLACEHOLDER`), and neither is a chart, an OLE object or a movie
//! - a slide placeholder with no position of its own takes its layout
//!   placeholder's (matched by `idx`), which takes its master's (by type)
//! - a group's children keep their own coordinates, offset by the group's
//!   position: python-pptx does not apply the group's child transform
//! - a run's colour comes from python-pptx's `ColorFormat`, which ignores
//!   transforms on RGB colours and names anything but RGB and theme colours
//!   black; defaults from placeholders go through the script's own XML reader,
//!   which applies them
//! - line spacing set in points is python-pptx's `Length`, an `int`, so the
//!   script reports it in EMU
//!
//! Anything that raised inside a `try` in the script falls back the same way
//! here; see each function.

use std::collections::HashMap;

use base64::Engine;
use roxmltree::{Document, Node};

use crate::errors::{AppError, AppResult};

use super::image;
use super::numbers::{
    apply_transforms, centipoints_pt, emu_pt, emu_to_px, normalize_hex, pt_to_px, py_float, py_int,
    round4, Transforms,
};
use super::package::{self, Package};

const A: &str = "http://schemas.openxmlformats.org/drawingml/2006/main";
const P: &str = "http://schemas.openxmlformats.org/presentationml/2006/main";
const R: &str = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const TABLE_URI: &str = "http://schemas.openxmlformats.org/drawingml/2006/table";

const DEFAULT_FONT_NAME: &str = "Calibri";
const DEFAULT_FONT_SIZE_PX: f64 = 18.0;
const DEFAULT_FONT_COLOR: &str = "#000000";

// --- The payload ---------------------------------------------------------------

#[derive(Debug, Clone, PartialEq)]
pub struct Run {
    pub text: String,
    pub font_name: String,
    pub font_size_px: f64,
    pub bold: bool,
    pub italic: bool,
    pub underline: bool,
    pub color: String,
    pub character_spacing_px: f64,
}

#[derive(Debug, Clone, PartialEq)]
pub struct Paragraph {
    pub alignment: String,
    pub space_before_px: f64,
    pub space_after_px: f64,
    pub line_spacing: f64,
    pub runs: Vec<Run>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct TextBody {
    pub inset_left_px: f64,
    pub inset_right_px: f64,
    pub inset_top_px: f64,
    pub inset_bottom_px: f64,
    pub vertical_align: &'static str,
    pub wrap: bool,
    pub autofit: String,
    pub paragraphs: Vec<Paragraph>,
}

impl TextBody {
    /// The body the script falls back to when extraction fails.
    fn fallback() -> Self {
        Self {
            inset_left_px: 0.0,
            inset_right_px: 0.0,
            inset_top_px: 0.0,
            inset_bottom_px: 0.0,
            vertical_align: "center",
            wrap: true,
            autofit: "none".to_owned(),
            paragraphs: Vec::new(),
        }
    }
}

#[derive(Debug, Clone, PartialEq)]
pub enum ShapeKind {
    Text(TextBody),
    Image {
        format: String,
        data: String,
    },
    /// Rows of cells; only their text reaches a slide.
    Table {
        rows: Vec<Vec<TextBody>>,
    },
    Line {
        color: Option<String>,
        width_px: f64,
    },
    Group(Vec<Shape>),
    Unknown,
}

#[derive(Debug, Clone, PartialEq)]
pub struct Shape {
    pub id: Option<i64>,
    pub name: String,
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
    pub rotation: f64,
    pub kind: ShapeKind,
}

#[derive(Debug, Clone, PartialEq)]
pub enum Background {
    Solid(String),
    Image { format: String, data: String },
}

#[derive(Debug, Clone, PartialEq)]
pub struct Slide {
    pub background: Background,
    pub shapes: Vec<Shape>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct Payload {
    pub slide_width_px: f64,
    pub slide_height_px: f64,
    pub slides: Vec<Slide>,
}

// --- XML ----------------------------------------------------------------------

fn is(node: Node, ns: &str, name: &str) -> bool {
    node.is_element() && node.tag_name().namespace() == Some(ns) && node.tag_name().name() == name
}

fn child<'a, 'i>(node: Node<'a, 'i>, ns: &str, name: &str) -> Option<Node<'a, 'i>> {
    node.children().find(|candidate| is(*candidate, ns, name))
}

fn children<'a, 'i>(
    node: Node<'a, 'i>,
    ns: &'static str,
    name: &'static str,
) -> impl Iterator<Item = Node<'a, 'i>> {
    node.children()
        .filter(move |candidate| is(*candidate, ns, name))
}

fn elements<'a, 'i>(node: Node<'a, 'i>) -> impl Iterator<Item = Node<'a, 'i>> {
    node.children().filter(Node::is_element)
}

/// ElementPath `.//first/rest…`: the first match, in the order lxml finds it.
fn find_path<'a, 'i>(
    root: Node<'a, 'i>,
    first: (&str, &str),
    rest: &[(&str, &str)],
) -> Option<Node<'a, 'i>> {
    fn walk<'a, 'i>(node: Node<'a, 'i>, rest: &[(&str, &str)]) -> Option<Node<'a, 'i>> {
        match rest.split_first() {
            None => Some(node),
            Some(((ns, name), tail)) => {
                children_named(node, ns, name).find_map(|next| walk(next, tail))
            }
        }
    }
    fn children_named<'a, 'i, 'n>(
        node: Node<'a, 'i>,
        ns: &'n str,
        name: &'n str,
    ) -> impl Iterator<Item = Node<'a, 'i>> + 'n
    where
        'a: 'n,
        'i: 'n,
    {
        node.children()
            .filter(move |candidate| is(*candidate, ns, name))
    }
    root.descendants()
        .skip(1)
        .filter(|node| is(*node, first.0, first.1))
        .find_map(|node| walk(node, rest))
}

/// A shape element's `p:nvPr/p:ph`, under its first child, as python-pptx looks.
fn placeholder_element<'a, 'i>(shape: Node<'a, 'i>) -> Option<Node<'a, 'i>> {
    let first = elements(shape).next()?;
    child(child(first, P, "nvPr")?, P, "ph")
}

const SHAPE_TAGS: [&str; 6] = ["sp", "grpSp", "graphicFrame", "cxnSp", "pic", "contentPart"];

fn shape_elements<'a, 'i>(tree: Node<'a, 'i>) -> impl Iterator<Item = Node<'a, 'i>> {
    tree.children().filter(|node| {
        node.is_element()
            && node.tag_name().namespace() == Some(P)
            && SHAPE_TAGS.contains(&node.tag_name().name())
    })
}

fn sp_tree<'a, 'i>(root: Node<'a, 'i>) -> Option<Node<'a, 'i>> {
    child(child(root, P, "cSld")?, P, "spTree")
}

// --- Colours ---------------------------------------------------------------------

type ThemeColors = HashMap<String, String>;

fn transforms_of(color: Node) -> Transforms {
    let mut transforms = Transforms::default();
    for node in elements(color) {
        let Some(value) = node.attribute("val").and_then(py_int) else {
            continue;
        };
        match node.tag_name().name() {
            "lumMod" => transforms.lum_mod = Some(value),
            "lumOff" => transforms.lum_off = Some(value),
            "alpha" => transforms.alpha = Some(value),
            _ => {}
        }
    }
    transforms
}

/// `resolve_xml_color_choice`: never `None` for an element.
fn xml_color_choice(color: Node, theme: &ThemeColors) -> String {
    let base = match color.tag_name().name() {
        "srgbClr" => color.attribute("val").and_then(normalize_hex),
        "schemeClr" => {
            let key = color.attribute("val").unwrap_or("").trim().to_lowercase();
            Some(
                theme
                    .get(&key)
                    .and_then(|value| normalize_hex(value))
                    .unwrap_or_else(|| DEFAULT_FONT_COLOR.to_owned()),
            )
        }
        "sysClr" => Some(
            color
                .attribute("lastClr")
                .and_then(normalize_hex)
                .unwrap_or_else(|| DEFAULT_FONT_COLOR.to_owned()),
        ),
        _ => Some(DEFAULT_FONT_COLOR.to_owned()),
    };
    apply_transforms(base.as_deref().unwrap_or(""), transforms_of(color))
}

/// `resolve_xml_solid_fill`: the first child's colour, or `None` if it has none.
fn xml_solid_fill(solid: Node, theme: &ThemeColors) -> Option<String> {
    elements(solid)
        .next()
        .map(|color| xml_color_choice(color, theme))
}

const FILL_TAGS: [&str; 6] = [
    "noFill",
    "solidFill",
    "gradFill",
    "blipFill",
    "pattFill",
    "grpFill",
];
const COLOR_TAGS: [&str; 6] = [
    "scrgbClr",
    "srgbClr",
    "hslClr",
    "sysClr",
    "schemeClr",
    "prstClr",
];
const THEME_KEYS: [&str; 16] = [
    "accent1", "accent2", "accent3", "accent4", "accent5", "accent6", "bg1", "bg2", "dk1", "dk2",
    "folHlink", "hlink", "lt1", "lt2", "tx1", "tx2",
];

/// python-pptx's `ColorFormat` on a fill parent, through `resolve_color`.
///
/// A parent without a solid fill is given an empty one by `.color`, whose type
/// is `None`. RGB is taken as written, transforms ignored; a theme colour is
/// looked up with its transforms; every other colour type is black.
fn api_color(parent: Node, theme: &ThemeColors) -> Option<String> {
    let fill = parent.children().find(|node| {
        node.is_element()
            && node.tag_name().namespace() == Some(A)
            && FILL_TAGS.contains(&node.tag_name().name())
    })?;
    if fill.tag_name().name() != "solidFill" {
        return None;
    }
    let color = fill.children().find(|node| {
        node.is_element()
            && node.tag_name().namespace() == Some(A)
            && COLOR_TAGS.contains(&node.tag_name().name())
    })?;
    Some(match color.tag_name().name() {
        "srgbClr" => color
            .attribute("val")
            .filter(|value| value.len() == 6 && value.chars().all(|c| c.is_ascii_hexdigit()))
            .and_then(normalize_hex)
            .unwrap_or_else(|| DEFAULT_FONT_COLOR.to_owned()),
        "schemeClr" => {
            let Some(key) = color
                .attribute("val")
                .filter(|value| THEME_KEYS.contains(value))
            else {
                // MSO_THEME_COLOR.from_xml raises; resolve_color answers black.
                return Some(DEFAULT_FONT_COLOR.to_owned());
            };
            let base = theme
                .get(&key.to_lowercase())
                .and_then(|value| normalize_hex(value))
                .unwrap_or_else(|| DEFAULT_FONT_COLOR.to_owned());
            apply_transforms(&base, transforms_of(color))
        }
        _ => DEFAULT_FONT_COLOR.to_owned(),
    })
}

const THEME_SCHEME_KEYS: [&str; 12] = [
    "dk1", "lt1", "dk2", "lt2", "accent1", "accent2", "accent3", "accent4", "accent5", "accent6",
    "hlink", "folHlink",
];

/// `build_theme_colors_for_slide`: the master theme's colour scheme, then the
/// master's colour map aliases pointing into it.
fn theme_colors(theme: Option<&Document>, master: Option<&Document>) -> ThemeColors {
    let mut colors = ThemeColors::new();
    if let Some(scheme) = theme.and_then(|theme| {
        theme
            .root()
            .descendants()
            .find(|node| is(*node, A, "clrScheme"))
    }) {
        for key in THEME_SCHEME_KEYS {
            let Some(entry) = child(scheme, A, key) else {
                continue;
            };
            if let Some(color) = elements(entry).next() {
                let value = xml_color_choice(color, &colors);
                colors.insert(key.to_lowercase(), value);
            }
        }
    }

    if let Some(map) = master.and_then(|master| {
        master
            .root_element()
            .descendants()
            .skip(1)
            .find(|node| is(*node, P, "clrMap"))
    }) {
        let aliases: Vec<(String, String)> = map
            .attributes()
            .map(|attribute| {
                (
                    attribute.name().trim().to_lowercase(),
                    attribute.value().trim().to_lowercase(),
                )
            })
            .filter(|(alias, target)| !alias.is_empty() && !target.is_empty())
            .collect();
        for (alias, target) in aliases {
            if let Some(value) = colors.get(&target).cloned() {
                colors.insert(alias, value);
            }
        }
    }
    colors
}

// --- Text ---------------------------------------------------------------------

#[derive(Debug, Clone, Default, PartialEq)]
struct TextProps {
    font_name: Option<String>,
    font_size_px: Option<f64>,
    bold: Option<bool>,
    italic: Option<bool>,
    underline: Option<bool>,
    color: Option<String>,
    character_spacing_px: Option<f64>,
    alignment: Option<String>,
}

fn on_off(value: Option<&str>) -> Option<bool> {
    match value?.trim().to_lowercase().as_str() {
        "1" | "true" | "on" | "yes" => Some(true),
        "0" | "false" | "off" | "no" => Some(false),
        _ => None,
    }
}

fn underline_value(value: Option<&str>) -> Option<bool> {
    let text = value?.trim().to_lowercase();
    Some(!matches!(text.as_str(), "none" | "0" | "false" | "off"))
}

/// `extract_rpr_properties_from_xml`.
fn xml_run_props(rpr: Option<Node>, theme: &ThemeColors) -> TextProps {
    let Some(rpr) = rpr else {
        return TextProps::default();
    };
    TextProps {
        font_name: child(rpr, A, "latin")
            .and_then(|latin| latin.attribute("typeface"))
            .map(str::to_owned),
        font_size_px: rpr
            .attribute("sz")
            .and_then(py_int)
            .map(|size| pt_to_px(size as f64 / 100.0)),
        bold: on_off(rpr.attribute("b")),
        italic: on_off(rpr.attribute("i")),
        underline: underline_value(rpr.attribute("u")),
        color: child(rpr, A, "solidFill").and_then(|solid| xml_solid_fill(solid, theme)),
        character_spacing_px: rpr
            .attribute("spc")
            .and_then(py_float)
            .map(|spacing| pt_to_px(spacing / 100.0)),
        alignment: None,
    }
}

/// `map_alignment_code`.
fn alignment_code(value: &str) -> Option<&'static str> {
    match value.trim().to_lowercase().replace([' ', '_'], "").as_str() {
        "l" | "left" => Some("left"),
        "ctr" | "center" => Some("center"),
        "r" | "right" => Some("right"),
        "just" | "justify" | "dist" | "thaidist" => Some("justify"),
        _ => None,
    }
}

/// `map_alignment_code` on python-pptx's `PP_ALIGN` member: its name, so only
/// LEFT, CENTER, RIGHT and JUSTIFY map. `Err` for a value python-pptx rejects.
fn enum_alignment(algn: Option<&str>) -> Result<Option<&'static str>, ()> {
    Ok(match algn {
        None => None,
        Some("l") => Some("left"),
        Some("ctr") => Some("center"),
        Some("r") => Some("right"),
        Some("just") => Some("justify"),
        Some("dist" | "justLow" | "thaiDist" | "") => None,
        Some(_) => return Err(()),
    })
}

/// `extract_alignment_from_text_shape_xml`.
fn shape_xml_alignment(shape: Node) -> Option<String> {
    if let Some(ppr) = find_path(shape, (A, "p"), &[(A, "pPr")]) {
        if let Some(alignment) = ppr.attribute("algn").and_then(alignment_code) {
            return Some(alignment.to_owned());
        }
    }
    find_path(shape, (A, "lstStyle"), &[(A, "lvl1pPr")])
        .and_then(|level| level.attribute("algn"))
        .and_then(alignment_code)
        .map(str::to_owned)
}

/// `extract_placeholder_defined_props` on a layout or master placeholder.
fn placeholder_defined_props(shape: Option<Node>, theme: &ThemeColors) -> TextProps {
    let Some(shape) = shape else {
        return TextProps::default();
    };
    let rpr = find_path(shape, (A, "p"), &[(A, "pPr"), (A, "defRPr")])
        .or_else(|| find_path(shape, (A, "lstStyle"), &[(A, "lvl1pPr"), (A, "defRPr")]));
    let extracted = xml_run_props(rpr, theme);
    TextProps {
        font_name: extracted.font_name,
        font_size_px: extracted.font_size_px,
        bold: extracted.bold,
        italic: extracted.italic,
        color: extracted.color,
        alignment: shape_xml_alignment(shape),
        ..TextProps::default()
    }
}

/// A placeholder element's `idx` (default 0) and type (default `obj`).
fn placeholder_key<'a>(shape: Node<'a, 'a>) -> Option<(Result<i64, ()>, &'a str)> {
    let ph = placeholder_element(shape)?;
    let idx = match ph.attribute("idx") {
        None => Ok(0),
        Some(text) => py_int(text).ok_or(()),
    };
    Some((idx, ph.attribute("type").unwrap_or("obj")))
}

const PLACEHOLDER_TYPES: [&str; 16] = [
    "clipArt", "body", "ctrTitle", "chart", "dt", "ftr", "hdr", "media", "obj", "dgm", "pic",
    "sldImg", "sldNum", "subTitle", "tbl", "title",
];

/// `find_matching_placeholder`: by `idx`, else the first of the same type.
fn matching_placeholder<'a, 'i>(
    candidates: &[Node<'a, 'i>],
    idx: i64,
    ph_type: &str,
) -> Option<Node<'a, 'i>> {
    let mut by_type = None;
    for candidate in candidates {
        let Some((Ok(candidate_idx), candidate_type)) = placeholder_key(*candidate) else {
            continue;
        };
        if !PLACEHOLDER_TYPES.contains(&candidate_type) {
            continue;
        }
        if candidate_idx == idx {
            return Some(*candidate);
        }
        if candidate_type == ph_type && by_type.is_none() {
            by_type = Some(*candidate);
        }
    }
    by_type
}

/// The shape elements of a layout or master that are placeholders, in order.
fn placeholders_of<'a, 'i>(root: Option<Node<'a, 'i>>) -> Vec<Node<'a, 'i>> {
    root.and_then(sp_tree)
        .map(|tree| {
            shape_elements(tree)
                .filter(|shape| placeholder_element(*shape).is_some())
                .collect()
        })
        .unwrap_or_default()
}

/// `extract_container_text_defaults`: the first value of each property across
/// a layout's or master's placeholders.
fn container_defaults(placeholders: &[Node], theme: &ThemeColors) -> TextProps {
    let mut defaults = TextProps::default();
    for placeholder in placeholders {
        let props = placeholder_defined_props(Some(*placeholder), theme);
        defaults.font_name = defaults.font_name.or(props.font_name);
        defaults.font_size_px = defaults.font_size_px.or(props.font_size_px);
        defaults.bold = defaults.bold.or(props.bold);
        defaults.italic = defaults.italic.or(props.italic);
        defaults.color = defaults.color.or(props.color);
        defaults.alignment = defaults.alignment.or(props.alignment);
    }
    defaults
}

struct Context<'a, 'i> {
    package: &'a Package,
    slide_part: &'a str,
    theme: ThemeColors,
    layout_placeholders: Vec<Node<'a, 'i>>,
    master_placeholders: Vec<Node<'a, 'i>>,
    layout_defaults: TextProps,
    master_defaults: TextProps,
}

/// `resolve_placeholder_props`: master defaults, then layout overrides.
fn placeholder_props(shape: Node, context: &Context) -> TextProps {
    let Some((Ok(idx), ph_type)) = placeholder_key(shape) else {
        return TextProps::default();
    };
    if !PLACEHOLDER_TYPES.contains(&ph_type) {
        return TextProps::default();
    }
    let layout = placeholder_defined_props(
        matching_placeholder(&context.layout_placeholders, idx, ph_type),
        &context.theme,
    );
    let master = placeholder_defined_props(
        matching_placeholder(&context.master_placeholders, idx, ph_type),
        &context.theme,
    );
    TextProps {
        font_name: layout.font_name.or(master.font_name),
        font_size_px: layout.font_size_px.or(master.font_size_px),
        bold: layout.bold.or(master.bold),
        italic: layout.italic.or(master.italic),
        color: layout.color.or(master.color),
        alignment: layout.alignment.or(master.alignment),
        ..TextProps::default()
    }
}

/// python-pptx's `Font` on a run's `a:rPr`, in the order the script reads it.
/// A value python-pptx rejects stops the reading, as the exception did.
fn api_run_props(rpr: Option<Node>, theme: &ThemeColors) -> TextProps {
    let mut props = TextProps::default();
    let Some(rpr) = rpr else {
        // `run.font` adds an empty rPr: nothing set, and `.color` gives None.
        return props;
    };

    if let Some(latin) = child(rpr, A, "latin") {
        match latin.attribute("typeface") {
            Some(typeface) => props.font_name = Some(typeface.to_owned()),
            None => return props,
        }
    }
    if let Some(size) = rpr.attribute("sz") {
        match py_int(size) {
            Some(size) => props.font_size_px = Some(pt_to_px(centipoints_pt(size))),
            None => return props,
        }
    }
    let boolean = |name: &str| -> Result<Option<bool>, ()> {
        match rpr.attribute(name) {
            None => Ok(None),
            Some("1" | "true") => Ok(Some(true)),
            Some("0" | "false") => Ok(Some(false)),
            Some(_) => Err(()),
        }
    };
    match boolean("b") {
        Ok(value) => props.bold = value,
        Err(()) => return props,
    }
    match boolean("i") {
        Ok(value) => props.italic = value,
        Err(()) => return props,
    }
    match rpr.attribute("u") {
        None => {}
        Some("none") => props.underline = Some(false),
        Some(
            "words" | "sng" | "dbl" | "heavy" | "dotted" | "dottedHeavy" | "dash" | "dashHeavy"
            | "dashLong" | "dashLongHeavy" | "dotDash" | "dotDashHeavy" | "dotDotDash"
            | "dotDotDashHeavy" | "wavy" | "wavyHeavy" | "wavyDbl" | "",
        ) => props.underline = Some(true),
        Some(_) => return props,
    }
    props.color = api_color(rpr, theme);
    props
}

fn first_some<T: Clone>(candidates: &[Option<T>], fallback: T) -> T {
    candidates.iter().find_map(Clone::clone).unwrap_or(fallback)
}

/// `extract_run_data`.
fn run_data(run: Node, paragraph: &TextProps, placeholder: &TextProps, context: &Context) -> Run {
    let rpr = child(run, A, "rPr");
    let api = api_run_props(rpr, &context.theme);
    let xml = xml_run_props(rpr, &context.theme);

    let name = api.font_name.or(xml.font_name);
    let size = api.font_size_px.or(xml.font_size_px);
    let bold = api.bold.or(xml.bold);
    let italic = api.italic.or(xml.italic);
    let underline = api.underline.or(xml.underline);
    let color = api.color.or(xml.color);
    let spacing = xml.character_spacing_px.or(paragraph.character_spacing_px);

    let (layout, master) = (&context.layout_defaults, &context.master_defaults);
    let color = first_some(
        &[
            color,
            paragraph.color.clone(),
            placeholder.color.clone(),
            layout.color.clone(),
            master.color.clone(),
        ],
        DEFAULT_FONT_COLOR.to_owned(),
    );
    Run {
        text: child(run, A, "t")
            .and_then(|t| t.text())
            .unwrap_or("")
            .to_owned(),
        font_name: first_some(
            &[
                name,
                paragraph.font_name.clone(),
                placeholder.font_name.clone(),
                layout.font_name.clone(),
                master.font_name.clone(),
            ],
            DEFAULT_FONT_NAME.to_owned(),
        ),
        font_size_px: round4(first_some(
            &[
                size,
                paragraph.font_size_px,
                placeholder.font_size_px,
                layout.font_size_px,
                master.font_size_px,
            ],
            DEFAULT_FONT_SIZE_PX,
        )),
        bold: first_some(
            &[
                bold,
                paragraph.bold,
                placeholder.bold,
                layout.bold,
                master.bold,
            ],
            false,
        ),
        italic: first_some(
            &[
                italic,
                paragraph.italic,
                placeholder.italic,
                layout.italic,
                master.italic,
            ],
            false,
        ),
        underline: first_some(&[underline, paragraph.underline], false),
        color: normalize_hex(&color).unwrap_or_else(|| DEFAULT_FONT_COLOR.to_owned()),
        character_spacing_px: round4(spacing.unwrap_or(0.0)),
    }
}

/// `extract_paragraph_spacing`: points only; a percentage is 0.
fn paragraph_spacing(ppr: Option<Node>, tag: &str) -> f64 {
    let Some(points) = ppr
        .and_then(|ppr| child(ppr, A, tag))
        .and_then(|spacing| child(spacing, A, "spcPts"))
    else {
        return 0.0;
    };
    match points.attribute("val").and_then(py_int) {
        Some(value) => pt_to_px(centipoints_pt(value)),
        None => points
            .attribute("val")
            .and_then(py_float)
            .map_or(0.0, |value| pt_to_px(value / 100.0)),
    }
}

/// `extract_paragraph_line_spacing`: a multiple as a float, points as
/// python-pptx's `Length` — an int of EMU.
fn paragraph_line_spacing(ppr: Option<Node>) -> Result<f64, ()> {
    let Some(line) = ppr.and_then(|ppr| child(ppr, A, "lnSpc")) else {
        return Ok(1.0);
    };
    if let Some(points) = child(line, A, "spcPts") {
        let value = points.attribute("val").and_then(py_int).ok_or(())?;
        return Ok(round4((value * 127) as f64));
    }
    if let Some(percent) = child(line, A, "spcPct") {
        let text = percent.attribute("val").ok_or(())?;
        let value = match text.strip_suffix('%') {
            Some(number) => py_float(number).ok_or(())? / 100.0,
            None => py_int(text).ok_or(())? as f64 / 100_000.0,
        };
        return Ok(round4(value));
    }
    Err(())
}

/// `extract_paragraph_data`. `Err` where python-pptx raised, which fails the
/// whole text body.
fn paragraph_data(
    paragraph: Node,
    placeholder: &TextProps,
    context: &Context,
) -> Result<Paragraph, ()> {
    let ppr = child(paragraph, A, "pPr");
    let paragraph_rpr = ppr
        .and_then(|ppr| child(ppr, A, "defRPr"))
        .or_else(|| child(paragraph, A, "endParaRPr"));
    let props = xml_run_props(paragraph_rpr, &context.theme);

    let direct = enum_alignment(ppr.and_then(|ppr| ppr.attribute("algn")))?;
    let from_xml = ppr
        .and_then(|ppr| ppr.attribute("algn"))
        .and_then(alignment_code);
    let alignment = direct
        .or(from_xml)
        .map(str::to_owned)
        .or_else(|| placeholder.alignment.clone())
        .or_else(|| context.layout_defaults.alignment.clone())
        .or_else(|| context.master_defaults.alignment.clone())
        .unwrap_or_else(|| "left".to_owned());

    let space_before_px = round4(paragraph_spacing(ppr, "spcBef"));
    let space_after_px = round4(paragraph_spacing(ppr, "spcAft"));
    let line_spacing = paragraph_line_spacing(ppr)?;

    let runs: Vec<Node> = children(paragraph, A, "r").collect();
    let (layout, master) = (&context.layout_defaults, &context.master_defaults);
    let runs = if runs.is_empty() {
        let color = first_some(
            &[
                props.color.clone(),
                placeholder.color.clone(),
                layout.color.clone(),
                master.color.clone(),
            ],
            DEFAULT_FONT_COLOR.to_owned(),
        );
        vec![Run {
            text: String::new(),
            font_name: first_some(
                &[
                    props.font_name.clone(),
                    placeholder.font_name.clone(),
                    layout.font_name.clone(),
                    master.font_name.clone(),
                ],
                DEFAULT_FONT_NAME.to_owned(),
            ),
            font_size_px: round4(first_some(
                &[
                    props.font_size_px,
                    placeholder.font_size_px,
                    layout.font_size_px,
                    master.font_size_px,
                ],
                DEFAULT_FONT_SIZE_PX,
            )),
            bold: first_some(
                &[props.bold, placeholder.bold, layout.bold, master.bold],
                false,
            ),
            italic: first_some(
                &[
                    props.italic,
                    placeholder.italic,
                    layout.italic,
                    master.italic,
                ],
                false,
            ),
            underline: props.underline.unwrap_or(false),
            color: normalize_hex(&color).unwrap_or_else(|| DEFAULT_FONT_COLOR.to_owned()),
            character_spacing_px: round4(props.character_spacing_px.unwrap_or(0.0)),
        }]
    } else {
        runs.into_iter()
            .map(|run| run_data(run, &props, placeholder, context))
            .collect()
    };

    Ok(Paragraph {
        alignment,
        space_before_px,
        space_after_px,
        line_spacing,
        runs,
    })
}

/// `extract_text_body` on a `txBody`, or on the empty one python-pptx adds
/// when there is none. `Err` where the script fell back to an empty body.
fn text_body(
    tx_body: Option<Node>,
    placeholder: &TextProps,
    context: &Context,
) -> Result<TextBody, ()> {
    let Some(tx_body) = tx_body else {
        let empty = Paragraph {
            alignment: String::new(),
            space_before_px: 0.0,
            space_after_px: 0.0,
            line_spacing: 1.0,
            runs: Vec::new(),
        };
        // `<a:bodyPr/><a:lstStyle/><a:p/>`: one paragraph, no runs.
        let alignment = placeholder
            .alignment
            .clone()
            .or_else(|| context.layout_defaults.alignment.clone())
            .or_else(|| context.master_defaults.alignment.clone())
            .unwrap_or_else(|| "left".to_owned());
        let (layout, master) = (&context.layout_defaults, &context.master_defaults);
        let color = first_some(
            &[
                placeholder.color.clone(),
                layout.color.clone(),
                master.color.clone(),
            ],
            DEFAULT_FONT_COLOR.to_owned(),
        );
        return Ok(TextBody {
            inset_left_px: 0.0,
            inset_right_px: 0.0,
            inset_top_px: 0.0,
            inset_bottom_px: 0.0,
            vertical_align: "center",
            wrap: true,
            autofit: "none".to_owned(),
            paragraphs: vec![Paragraph {
                alignment,
                runs: vec![Run {
                    text: String::new(),
                    font_name: first_some(
                        &[
                            placeholder.font_name.clone(),
                            layout.font_name.clone(),
                            master.font_name.clone(),
                        ],
                        DEFAULT_FONT_NAME.to_owned(),
                    ),
                    font_size_px: round4(first_some(
                        &[
                            placeholder.font_size_px,
                            layout.font_size_px,
                            master.font_size_px,
                        ],
                        DEFAULT_FONT_SIZE_PX,
                    )),
                    bold: first_some(&[placeholder.bold, layout.bold, master.bold], false),
                    italic: first_some(&[placeholder.italic, layout.italic, master.italic], false),
                    underline: false,
                    color: normalize_hex(&color).unwrap_or_else(|| DEFAULT_FONT_COLOR.to_owned()),
                    character_spacing_px: 0.0,
                }],
                ..empty
            }],
        });
    };

    // bodyPr is required; python-pptx raises without it.
    let body_pr = child(tx_body, A, "bodyPr").ok_or(())?;
    let inset = |name: &str| emu_to_px(body_pr.attribute(name).and_then(py_float).unwrap_or(0.0));
    let wrap = !(body_pr.attribute("wrap").is_some_and(|value| {
        matches!(value.trim().to_lowercase().as_str(), "none" | "false" | "0")
    }) || body_pr
        .attribute("noWrap")
        .is_some_and(|value| matches!(value.trim().to_lowercase().as_str(), "1" | "true")));
    let autofit = elements(body_pr)
        .find_map(
            |node| match (node.tag_name().namespace(), node.tag_name().name()) {
                (Some(A), "noAutofit") => Some("none"),
                (Some(A), "normAutofit") => Some("text_to_fit_shape"),
                (Some(A), "spAutoFit") => Some("shape_to_fit_text"),
                _ => None,
            },
        )
        .unwrap_or("none");
    let vertical_align = match body_pr
        .attribute("anchor")
        .map(|value| value.trim().to_lowercase())
    {
        Some(anchor) if anchor == "t" => "top",
        Some(anchor) if anchor == "b" => "bottom",
        _ => "center",
    };

    let paragraphs = children(tx_body, A, "p")
        .map(|paragraph| paragraph_data(paragraph, placeholder, context))
        .collect::<Result<Vec<_>, ()>>()?;

    Ok(TextBody {
        inset_left_px: inset("lIns"),
        inset_right_px: inset("rIns"),
        inset_top_px: inset("tIns"),
        inset_bottom_px: inset("bIns"),
        vertical_align,
        wrap,
        autofit: autofit.to_owned(),
        paragraphs,
    })
}

// --- Shapes ---------------------------------------------------------------------

/// The `a:xfrm` a shape's position is read from.
fn xfrm_of<'a, 'i>(shape: Node<'a, 'i>) -> Option<Node<'a, 'i>> {
    match shape.tag_name().name() {
        "grpSp" => child(child(shape, P, "grpSpPr")?, A, "xfrm"),
        "graphicFrame" => child(shape, P, "xfrm"),
        "contentPart" => None,
        _ => child(child(shape, P, "spPr")?, A, "xfrm"),
    }
}

#[derive(Clone, Copy)]
enum Dimension {
    Left,
    Top,
    Width,
    Height,
}

fn own_dimension(shape: Node, dimension: Dimension) -> Option<i64> {
    let xfrm = xfrm_of(shape)?;
    let (tag, attribute) = match dimension {
        Dimension::Left => ("off", "x"),
        Dimension::Top => ("off", "y"),
        Dimension::Width => ("ext", "cx"),
        Dimension::Height => ("ext", "cy"),
    };
    child(xfrm, A, tag)?.attribute(attribute).and_then(py_int)
}

/// `LayoutPlaceholder._base_placeholder`'s type mapping.
fn master_type_for_layout(ph_type: &str) -> Result<&'static str, ()> {
    Ok(match ph_type {
        "body" | "chart" | "clipArt" | "dgm" | "media" | "obj" | "pic" | "subTitle" | "tbl" => {
            "body"
        }
        "ctrTitle" | "title" => "title",
        "dt" => "dt",
        "ftr" => "ftr",
        "sldNum" => "sldNum",
        // HEADER and SLIDE_IMAGE are missing from python-pptx's map: KeyError.
        _ => return Err(()),
    })
}

/// A slide placeholder's dimension: its own, else its layout placeholder's
/// (by idx), which for an `sp` is its own or its master placeholder's (by
/// type). `Err` for python-pptx's KeyError, which fails the import.
fn dimension(
    shape: Node,
    dimension_kind: Dimension,
    context: &Context,
    inherits: bool,
) -> Result<Option<i64>, AppError> {
    if let Some(value) = own_dimension(shape, dimension_kind) {
        return Ok(Some(value));
    }
    if !inherits {
        return Ok(None);
    }
    let Some((Ok(idx), _)) = placeholder_key(shape) else {
        return Ok(None);
    };
    let Some(layout_shape) = context
        .layout_placeholders
        .iter()
        .copied()
        .find(|candidate| {
            placeholder_key(*candidate).is_some_and(|(candidate_idx, _)| candidate_idx == Ok(idx))
        })
    else {
        return Ok(None);
    };
    if let Some(value) = own_dimension(layout_shape, dimension_kind) {
        return Ok(Some(value));
    }
    if layout_shape.tag_name().name() != "sp" {
        return Ok(None);
    }
    let layout_type = placeholder_key(layout_shape).map_or("obj", |(_, ph_type)| ph_type);
    let master_type = master_type_for_layout(layout_type).map_err(|()| {
        AppError::Invalid(format!(
            "A placeholder inherits its position from a layout placeholder of type '{layout_type}', which the importer cannot resolve"
        ))
    })?;
    for master_shape in &context.master_placeholders {
        if master_shape.tag_name().name() != "sp" {
            // python-pptx asks a non-sp master placeholder for `ph_type` and
            // raises AttributeError, which the script reads as 0.
            return Ok(None);
        }
        if placeholder_key(*master_shape).map(|(_, ph_type)| ph_type) == Some(master_type) {
            return Ok(own_dimension(*master_shape, dimension_kind));
        }
    }
    Ok(None)
}

fn rotation_of(shape: Node) -> f64 {
    xfrm_of(shape)
        .and_then(|xfrm| xfrm.attribute("rot"))
        .and_then(py_int)
        .map_or(0.0, |rot| rot.rem_euclid(21_600_000) as f64 / 60_000.0)
}

fn non_visual_props<'a, 'i>(shape: Node<'a, 'i>) -> Option<Node<'a, 'i>> {
    child(elements(shape).next()?, P, "cNvPr")
}

/// A shape the importer sees, classified as `classify_shape_type` does on the
/// python-pptx object the factory builds.
fn classify(shape: Node, top_level: bool) -> &'static str {
    let is_placeholder = placeholder_element(shape).is_some();
    match shape.tag_name().name() {
        "grpSp" => "group",
        "sp" => "text",
        "cxnSp" => "line",
        "pic" => {
            let movie = elements(shape)
                .next()
                .and_then(|nv| child(nv, P, "nvPr"))
                .is_some_and(|nv_pr| child(nv_pr, A, "videoFile").is_some());
            if (top_level && is_placeholder) || movie {
                "unknown"
            } else {
                "image"
            }
        }
        "graphicFrame" => {
            let uri = child(shape, A, "graphic")
                .and_then(|graphic| child(graphic, A, "graphicData"))
                .and_then(|data| data.attribute("uri"));
            if uri == Some(TABLE_URI) {
                "table"
            } else {
                "unknown"
            }
        }
        _ => "unknown",
    }
}

fn image_data(shape: Node, context: &Context) -> (String, String) {
    let empty = ("png".to_owned(), String::new());
    let Some(rel_id) = child(shape, P, "blipFill")
        .and_then(|fill| child(fill, A, "blip"))
        .and_then(|blip| blip.attribute((R, "embed")))
    else {
        return empty;
    };
    let Ok(Some(target)) = context.package.related_by_id(context.slide_part, rel_id) else {
        return empty;
    };
    let Some(bytes) = context.package.bytes(&target) else {
        return empty;
    };
    match image::python_pptx_ext(bytes) {
        Some(ext) => (
            ext.to_owned(),
            base64::engine::general_purpose::STANDARD.encode(bytes),
        ),
        None => empty,
    }
}

fn table_rows(shape: Node, placeholder: &TextProps, context: &Context) -> Vec<Vec<TextBody>> {
    let Some(table) = child(shape, A, "graphic")
        .and_then(|graphic| child(graphic, A, "graphicData"))
        .and_then(|data| child(data, A, "tbl"))
    else {
        return Vec::new();
    };
    let mut rows = Vec::new();
    for row in children(table, A, "tr") {
        let mut cells = Vec::new();
        for cell in children(row, A, "tc") {
            match text_body(child(cell, A, "txBody"), placeholder, context) {
                Ok(body) => cells.push(body),
                // The script's try is around the whole table: rows so far stand.
                Err(()) => return rows,
            }
        }
        rows.push(cells);
    }
    rows
}

/// `extract_shape_data`.
fn shape_data(
    shape: Node,
    context: &Context,
    offset: (f64, f64),
    top_level: bool,
) -> AppResult<Shape> {
    let tag = shape.tag_name().name();
    let is_placeholder = placeholder_element(shape).is_some();
    // Only slide placeholders built by _SlidePlaceholderFactory inherit.
    let inherits = top_level && is_placeholder && matches!(tag, "sp" | "pic");
    let px = |value: Option<i64>| emu_to_px(value.map_or(0.0, |value| value as f64));

    let (id, name) = match non_visual_props(shape) {
        Some(props) if tag != "contentPart" => (
            props.attribute("id").and_then(py_int),
            props.attribute("name").unwrap_or("").to_owned(),
        ),
        _ => (None, String::new()),
    };
    let x = round4(px(dimension(shape, Dimension::Left, context, inherits)?) + offset.0);
    let y = round4(px(dimension(shape, Dimension::Top, context, inherits)?) + offset.1);
    let width = round4(px(dimension(shape, Dimension::Width, context, inherits)?));
    let height = round4(px(dimension(shape, Dimension::Height, context, inherits)?));
    let rotation = round4(rotation_of(shape));

    let placeholder = placeholder_props(shape, context);
    let kind = match classify(shape, top_level) {
        "text" => ShapeKind::Text(
            text_body(child(shape, P, "txBody"), &placeholder, context)
                .unwrap_or_else(|()| TextBody::fallback()),
        ),
        "image" => {
            let (format, data) = image_data(shape, context);
            ShapeKind::Image { format, data }
        }
        "table" => ShapeKind::Table {
            rows: table_rows(shape, &placeholder, context),
        },
        "line" => {
            let ln = child(shape, P, "spPr").and_then(|sp_pr| child(sp_pr, A, "ln"));
            let color = ln.and_then(|ln| api_color(ln, &context.theme));
            let width_px = ln
                .and_then(|ln| ln.attribute("w"))
                .and_then(py_int)
                .map_or(0.0, |width| pt_to_px(emu_pt(width)));
            ShapeKind::Line {
                color: color.and_then(|color| normalize_hex(&color)),
                width_px: round4(width_px),
            }
        }
        "group" => ShapeKind::Group(
            shape_elements(shape)
                .map(|child_shape| shape_data(child_shape, context, (x, y), false))
                .collect::<AppResult<Vec<_>>>()?,
        ),
        _ => ShapeKind::Unknown,
    };

    Ok(Shape {
        id,
        name,
        x,
        y,
        width,
        height,
        rotation,
        kind,
    })
}

// --- Backgrounds ----------------------------------------------------------------

/// `extract_background_from_part`.
fn part_background(
    package: &Package,
    part: &str,
    root: Option<Node>,
    theme: &ThemeColors,
) -> Option<Background> {
    let background = root?
        .descendants()
        .filter(|node| is(*node, P, "cSld"))
        .find_map(|c_sld| child(c_sld, P, "bg"))?;

    if let Some(bg_pr) = child(background, P, "bgPr") {
        if let Some(solid) = child(bg_pr, A, "solidFill") {
            let color =
                xml_solid_fill(solid, theme).unwrap_or_else(|| DEFAULT_FONT_COLOR.to_owned());
            return Some(Background::Solid(
                normalize_hex(&color).unwrap_or_else(|| DEFAULT_FONT_COLOR.to_owned()),
            ));
        }
        if let Some(blip) = child(bg_pr, A, "blipFill").and_then(|fill| child(fill, A, "blip")) {
            if let Some(rel_id) = blip
                .attribute((R, "embed"))
                .or_else(|| blip.attribute((R, "link")))
            {
                if let Ok(Some(target)) = package.related_by_id(part, rel_id) {
                    if let Some(bytes) = package.bytes(&target) {
                        let content_type = package.content_type(&target);
                        let stored = package.stored_name(&target);
                        return Some(Background::Image {
                            format: image::format_from_content_type(
                                content_type.as_deref(),
                                stored.as_deref(),
                            ),
                            data: base64::engine::general_purpose::STANDARD.encode(bytes),
                        });
                    }
                }
            }
        }
    }

    child(background, P, "bgRef")
        .and_then(|bg_ref| elements(bg_ref).next())
        .map(|color| {
            let color = xml_color_choice(color, theme);
            Background::Solid(
                normalize_hex(&color).unwrap_or_else(|| DEFAULT_FONT_COLOR.to_owned()),
            )
        })
}

// --- The presentation -------------------------------------------------------------

fn parse_xml<'a>(text: &'a str, part: &str) -> AppResult<Document<'a>> {
    Document::parse_with_options(
        text,
        roxmltree::ParsingOptions {
            allow_dtd: false,
            ..Default::default()
        },
    )
    .map_err(|error| AppError::Invalid(format!("Unreadable part {part}: {error}")))
}

/// `parse_pptx_mode`.
pub fn parse(package: &Package) -> AppResult<Payload> {
    let presentation_part = package
        .related_by_type("/", package::RT_OFFICE_DOCUMENT)?
        .ok_or_else(|| AppError::Invalid("This file has no presentation in it".to_owned()))?;
    let presentation_text = package
        .text(&presentation_part)
        .ok_or_else(|| AppError::Invalid("This file's presentation part is missing".to_owned()))?;
    let presentation = parse_xml(&presentation_text, &presentation_part)?;
    let root = presentation.root_element();

    let size = child(root, P, "sldSz");
    let slide_size = |name: &str| {
        emu_to_px(
            size.and_then(|size| size.attribute(name))
                .and_then(py_int)
                .unwrap_or(0) as f64,
        )
    };

    let slide_parts: Vec<String> = child(root, P, "sldIdLst")
        .map(|list| {
            children(list, P, "sldId")
                .filter_map(|slide| slide.attribute((R, "id")))
                .map(|rel_id| package.related_by_id(&presentation_part, rel_id))
                .collect::<AppResult<Vec<_>>>()
        })
        .transpose()?
        .unwrap_or_default()
        .into_iter()
        .flatten()
        .collect();

    let mut slides = Vec::with_capacity(slide_parts.len());
    for slide_part in &slide_parts {
        slides.push(parse_slide(package, slide_part)?);
    }

    Ok(Payload {
        slide_width_px: slide_size("cx"),
        slide_height_px: slide_size("cy"),
        slides,
    })
}

fn parse_slide(package: &Package, slide_part: &str) -> AppResult<Slide> {
    let missing = |what: &str| AppError::Invalid(format!("The slide {slide_part} has no {what}"));

    let slide_text = package.text(slide_part).ok_or_else(|| missing("XML"))?;
    let slide = parse_xml(&slide_text, slide_part)?;

    let layout_part = package
        .related_by_type(slide_part, package::RT_SLIDE_LAYOUT)?
        .ok_or_else(|| missing("layout"))?;
    let layout_text = package
        .text(&layout_part)
        .ok_or_else(|| missing("layout XML"))?;
    let layout = parse_xml(&layout_text, &layout_part)?;

    let master_part = package
        .related_by_type(&layout_part, package::RT_SLIDE_MASTER)?
        .ok_or_else(|| missing("master"))?;
    let master_text = package
        .text(&master_part)
        .ok_or_else(|| missing("master XML"))?;
    let master = parse_xml(&master_text, &master_part)?;

    let theme_text = package
        .related_by_type(&master_part, package::RT_THEME)?
        .and_then(|theme_part| package.text(&theme_part).map(|text| (theme_part, text)));
    let theme = match &theme_text {
        Some((part, text)) => Some(parse_xml(text, part)?),
        None => None,
    };

    let colors = theme_colors(theme.as_ref(), Some(&master));
    let layout_placeholders = placeholders_of(Some(layout.root_element()));
    let master_placeholders = placeholders_of(Some(master.root_element()));
    let layout_defaults = container_defaults(&layout_placeholders, &colors);
    let master_defaults = container_defaults(&master_placeholders, &colors);

    let background = part_background(package, slide_part, Some(slide.root_element()), &colors)
        .or_else(|| part_background(package, &layout_part, Some(layout.root_element()), &colors))
        .or_else(|| part_background(package, &master_part, Some(master.root_element()), &colors))
        .unwrap_or_else(|| Background::Solid(DEFAULT_FONT_COLOR.to_owned()));

    let context = Context {
        package,
        slide_part,
        theme: colors,
        layout_placeholders,
        master_placeholders,
        layout_defaults,
        master_defaults,
    };

    let shapes = match sp_tree(slide.root_element()) {
        Some(tree) => shape_elements(tree)
            .map(|shape| shape_data(shape, &context, (0.0, 0.0), true))
            .collect::<AppResult<Vec<_>>>()?,
        None => Vec::new(),
    };

    Ok(Slide { background, shapes })
}
