//! A deck read into slides: every shape on each, where PowerPoint draws it,
//! as the elements Present draws.
//!
//! What is drawn on a slide, bottom to top: its background; the master's own
//! shapes and the layout's (not their placeholders, which only lend their
//! position and look to the slide's); then the slide's shapes. A group's
//! children are placed through the group's transform — its child space
//! scaled onto its box, then its flips and rotation — so a resized group
//! keeps its children inside it.
//!
//! Elements are on a 1920×1080 canvas, the deck scaled evenly onto it and
//! centred, so a 4:3 deck is not stretched.

use std::collections::HashMap;

use roxmltree::{Document, Node};
use serde_json::{json, Map, Value};

use crate::errors::{AppError, AppResult};

use super::color::Rgba;
use super::fill::{self, Line, Paint, Picture};
use super::geometry::{self, ShapePath};
use super::package::{self, Package};
use super::text::{self, BodyProps, Inherited, ListStyle, RunProps};
use super::theme::Theme;
use super::xml::{self, A, DSP, P, R};

pub const CANVAS_WIDTH: f64 = 1920.0;
pub const CANVAS_HEIGHT: f64 = 1080.0;

const RT_DIAGRAM_DRAWING: &str =
    "http://schemas.microsoft.com/office/2007/relationships/diagramDrawing";
const RT_TABLE_STYLES: &str =
    "http://schemas.openxmlformats.org/officeDocument/2006/relationships/tableStyles";
const TABLE_URI: &str = "http://schemas.openxmlformats.org/drawingml/2006/table";
const DIAGRAM_URI: &str = "http://schemas.openxmlformats.org/drawingml/2006/diagram";

/// Where a picture's bytes go: a file the screens can read, in the app; a
/// `data:` URL in the tests.
pub trait MediaSink {
    /// Keep `bytes` (from the part `part`, a picture of type `extension`) and
    /// return the URL to draw it from.
    fn store(&mut self, part: &str, bytes: &[u8], extension: &str) -> Option<String>;
}

/// Pictures as `data:` URLs, each part once.
#[derive(Default)]
pub struct DataUrls {
    stored: HashMap<String, String>,
}

impl MediaSink for DataUrls {
    fn store(&mut self, part: &str, bytes: &[u8], extension: &str) -> Option<String> {
        use base64::Engine;
        if let Some(url) = self.stored.get(part) {
            return Some(url.clone());
        }
        let url = format!(
            "data:{};base64,{}",
            mime_type(extension),
            base64::engine::general_purpose::STANDARD.encode(bytes)
        );
        self.stored.insert(part.to_owned(), url.clone());
        Some(url)
    }
}

pub fn mime_type(extension: &str) -> &'static str {
    match extension {
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "svg" => "image/svg+xml",
        "bmp" => "image/bmp",
        "tif" | "tiff" => "image/tiff",
        "emf" => "image/x-emf",
        "wmf" => "image/x-wmf",
        _ => "image/png",
    }
}

/// A picture's type, from its first bytes.
pub fn sniff_extension(bytes: &[u8]) -> &'static str {
    match bytes {
        [0x89, b'P', b'N', b'G', ..] => "png",
        [0xFF, 0xD8, ..] => "jpeg",
        [b'G', b'I', b'F', ..] => "gif",
        [b'R', b'I', b'F', b'F', _, _, _, _, b'W', b'E', b'B', b'P', ..] => "webp",
        [b'B', b'M', ..] => "bmp",
        [b'I', b'I', 0x2A, 0x00, ..] | [b'M', b'M', 0x00, 0x2A, ..] => "tiff",
        [0x01, 0x00, 0x00, 0x00, ..] => "emf",
        [0xD7, 0xCD, 0xC6, 0x9A, ..] => "wmf",
        // An SVG can open with a long prolog — an editor's comments, a
        // doctype — before its `<svg`.
        _ if bytes.iter().take(256).any(|&b| b == b'<')
            && String::from_utf8_lossy(&bytes[..bytes.len().min(4096)]).contains("<svg") =>
        {
            "svg"
        }
        _ => "png",
    }
}

/// A deck, read.
pub struct Deck {
    pub slides: Vec<Value>,
    /// The fonts the deck carries, by the name its text uses them by.
    pub fonts: Vec<EmbeddedFontPart>,
}

/// One font file a deck embeds.
#[derive(Debug, Clone)]
pub struct EmbeddedFontPart {
    pub typeface: String,
    pub bold: bool,
    pub italic: bool,
    pub part: String,
}

pub fn read(package: &Package, sink: &mut dyn MediaSink) -> AppResult<Deck> {
    let presentation_part = package
        .related_by_type("/", package::RT_OFFICE_DOCUMENT)?
        .ok_or_else(|| AppError::Invalid("This file has no presentation in it".to_owned()))?;
    let presentation_text = package
        .text(&presentation_part)
        .ok_or_else(|| AppError::Invalid("This file's presentation part is missing".to_owned()))?;
    let presentation = parse_xml(&presentation_text, &presentation_part)?;
    let root = presentation.root_element();

    let size = xml::child(root, P, "sldSz");
    let width = size
        .and_then(|size| xml::float(size, "cx"))
        .filter(|w| *w > 0.0)
        .unwrap_or(12_192_000.0);
    let height = size
        .and_then(|size| xml::float(size, "cy"))
        .filter(|h| *h > 0.0)
        .unwrap_or(6_858_000.0);
    let scale = (CANVAS_WIDTH / width).min(CANVAS_HEIGHT / height);
    let canvas = Canvas {
        scale,
        offset: (
            (CANVAS_WIDTH - width * scale) / 2.0,
            (CANVAS_HEIGHT - height * scale) / 2.0,
        ),
        width,
        height,
    };

    let mut fonts = Vec::new();
    if let Some(list) = xml::child(root, P, "embeddedFontLst") {
        for embedded in xml::children(list, P, "embeddedFont") {
            let Some(typeface) =
                xml::child(embedded, P, "font").and_then(|font| font.attribute("typeface"))
            else {
                continue;
            };
            for (tag, bold, italic) in [
                ("regular", false, false),
                ("bold", true, false),
                ("italic", false, true),
                ("boldItalic", true, true),
            ] {
                let Some(rel_id) =
                    xml::child(embedded, P, tag).and_then(|node| node.attribute((R, "id")))
                else {
                    continue;
                };
                if let Ok(Some(part)) = package.related_by_id(&presentation_part, rel_id) {
                    fonts.push(EmbeddedFontPart {
                        typeface: typeface.to_owned(),
                        bold,
                        italic,
                        part,
                    });
                }
            }
        }
    }

    let table_styles_text = package
        .related_by_type(&presentation_part, RT_TABLE_STYLES)?
        .and_then(|part| package.text(&part));
    let table_styles = match &table_styles_text {
        Some(text) => Document::parse(text).ok(),
        None => None,
    };

    let slide_parts: Vec<String> = xml::child(root, P, "sldIdLst")
        .map(|list| {
            xml::children(list, P, "sldId")
                .filter_map(|slide| slide.attribute((R, "id")))
                .filter_map(|rel_id| {
                    package
                        .related_by_id(&presentation_part, rel_id)
                        .ok()
                        .flatten()
                })
                .collect()
        })
        .unwrap_or_default();

    let default_style_node = xml::child(root, P, "defaultTextStyle");
    let mut slides = Vec::with_capacity(slide_parts.len());
    for (index, slide_part) in slide_parts.iter().enumerate() {
        slides.push(read_slide(
            package,
            slide_part,
            index + 1,
            &canvas,
            default_style_node,
            table_styles.as_ref(),
            sink,
        )?);
    }
    Ok(Deck { slides, fonts })
}

#[derive(Debug, Clone, Copy)]
struct Canvas {
    /// Pixels per EMU.
    scale: f64,
    offset: (f64, f64),
    width: f64,
    height: f64,
}

fn parse_xml<'t>(text: &'t str, part: &str) -> AppResult<Document<'t>> {
    Document::parse_with_options(
        text,
        roxmltree::ParsingOptions {
            allow_dtd: false,
            ..Default::default()
        },
    )
    .map_err(|error| AppError::Invalid(format!("Unreadable part {part}: {error}")))
}

fn sp_tree<'a, 'i>(root: Node<'a, 'i>) -> Option<Node<'a, 'i>> {
    xml::path(root, P, &["cSld", "spTree"])
}

fn read_slide(
    package: &Package,
    slide_part: &str,
    number: usize,
    canvas: &Canvas,
    default_style_node: Option<Node>,
    table_styles: Option<&Document>,
    sink: &mut dyn MediaSink,
) -> AppResult<Value> {
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

    let theme_part = package.related_by_type(&master_part, package::RT_THEME)?;
    let theme_text = theme_part.as_deref().and_then(|part| package.text(part));
    let theme_doc = match &theme_text {
        Some(text) => Document::parse(text).ok(),
        None => None,
    };

    let (slide_root, layout_root, master_root) = (
        slide.root_element(),
        layout.root_element(),
        master.root_element(),
    );
    let overrides: Vec<Node> = [layout_root, slide_root]
        .into_iter()
        .filter_map(|root| xml::child(root, P, "clrMapOvr"))
        .collect();
    let theme = Theme::read(theme_doc.as_ref(), Some(master_root), &overrides);

    let default_style = ListStyle::read(default_style_node, &theme);
    let text_styles = xml::child(master_root, P, "txStyles");
    let master_style = |name: &str| {
        ListStyle::read(
            text_styles.and_then(|styles| xml::child(styles, P, name)),
            &theme,
        )
    };
    let styles = Styles {
        default: default_style,
        title: master_style("titleStyle"),
        body: master_style("bodyStyle"),
        other: master_style("otherStyle"),
    };

    let mut elements = Vec::new();
    let mut builder = Builder {
        package,
        sink,
        theme: &theme,
        canvas: *canvas,
        number,
        styles: &styles,
        layout_placeholders: placeholders_of(layout_root),
        master_placeholders: placeholders_of(master_root),
        table_styles,
        elements: &mut elements,
        next_id: 0,
        theme_part: theme_part.clone(),
    };

    // The background, from the first of slide, layout and master to have one.
    let mut background_color = None;
    for (root, part) in [
        (slide_root, slide_part),
        (layout_root, layout_part.as_str()),
        (master_root, master_part.as_str()),
    ] {
        if let Some(found) = builder.background(root, part) {
            background_color = found;
            break;
        }
    }

    let shows = |root: Node| root.attribute("showMasterSp") != Some("0");
    if shows(slide_root) && shows(layout_root) {
        if let Some(tree) = sp_tree(master_root) {
            builder.walk(tree, &master_part, &[], ShapeSource::Inherited);
        }
    }
    if shows(slide_root) {
        if let Some(tree) = sp_tree(layout_root) {
            builder.walk(tree, &layout_part, &[], ShapeSource::Inherited);
        }
    }
    if let Some(tree) = sp_tree(slide_root) {
        builder.walk(tree, slide_part, &[], ShapeSource::Slide);
    }

    let text_content = elements
        .iter()
        .filter(|element| element["type"] == "text")
        .filter_map(|element| element["content"].as_str())
        .filter(|text| !text.trim().is_empty())
        .collect::<Vec<_>>()
        .join("\n");
    Ok(json!({
        "id": format!("pptx:{number}"),
        "title": format!("Slide {number}"),
        "backgroundColor": background_color.map(|color: Rgba| color.to_hex()).map_or(Value::Null, Value::String),
        "hidden": slide_root.attribute("show") == Some("0"),
        "elements": elements,
        "textContent": text_content,
    }))
}

struct Styles {
    default: ListStyle,
    title: ListStyle,
    body: ListStyle,
    other: ListStyle,
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum ShapeSource {
    /// A shape on the slide itself.
    Slide,
    /// A master's or layout's own shape: drawn, unless it is a placeholder.
    Inherited,
}

/// A group's frame, from the group's `a:xfrm`.
#[derive(Debug, Clone, Copy, Default)]
struct Frame {
    offset: (f64, f64),
    extent: (f64, f64),
    child_offset: (f64, f64),
    child_extent: (f64, f64),
    rotation: f64,
    flip_h: bool,
    flip_v: bool,
}

/// A box on the slide, in EMU: its centre, size, rotation in degrees, flips.
#[derive(Debug, Clone, Copy, PartialEq)]
struct Placement {
    cx: f64,
    cy: f64,
    w: f64,
    h: f64,
    rotation: f64,
    flip_h: bool,
    flip_v: bool,
}

fn read_xfrm(xfrm: Node) -> Frame {
    let pair = |tag: &str, x: &str, y: &str| {
        xml::child(xfrm, A, tag).map(|node| {
            (
                xml::float(node, x).unwrap_or(0.0),
                xml::float(node, y).unwrap_or(0.0),
            )
        })
    };
    let offset = pair("off", "x", "y").unwrap_or((0.0, 0.0));
    let extent = pair("ext", "cx", "cy").unwrap_or((0.0, 0.0));
    Frame {
        offset,
        extent,
        child_offset: pair("chOff", "x", "y").unwrap_or(offset),
        child_extent: pair("chExt", "cx", "cy").unwrap_or(extent),
        rotation: xml::float(xfrm, "rot").map_or(0.0, |rot| rot / 60_000.0),
        flip_h: xml::flag(xfrm, "flipH").unwrap_or(false),
        flip_v: xml::flag(xfrm, "flipV").unwrap_or(false),
    }
}

/// A box given in the innermost group's child space, placed on the slide
/// through every group around it.
fn place(own: &Frame, groups: &[Frame]) -> Placement {
    let mut placed = Placement {
        cx: own.offset.0 + own.extent.0 / 2.0,
        cy: own.offset.1 + own.extent.1 / 2.0,
        w: own.extent.0,
        h: own.extent.1,
        rotation: own.rotation,
        flip_h: own.flip_h,
        flip_v: own.flip_v,
    };
    for group in groups.iter().rev() {
        let sx = if group.child_extent.0 > 0.0 {
            group.extent.0 / group.child_extent.0
        } else {
            1.0
        };
        let sy = if group.child_extent.1 > 0.0 {
            group.extent.1 / group.child_extent.1
        } else {
            1.0
        };
        let mut cx = group.offset.0 + (placed.cx - group.child_offset.0) * sx;
        let mut cy = group.offset.1 + (placed.cy - group.child_offset.1) * sy;
        let (gx, gy) = (
            group.offset.0 + group.extent.0 / 2.0,
            group.offset.1 + group.extent.1 / 2.0,
        );
        if group.flip_h {
            cx = 2.0 * gx - cx;
        }
        if group.flip_v {
            cy = 2.0 * gy - cy;
        }
        let radians = group.rotation.to_radians();
        let (dx, dy) = (cx - gx, cy - gy);
        cx = gx + dx * radians.cos() - dy * radians.sin();
        cy = gy + dx * radians.sin() + dy * radians.cos();
        let mirrored = group.flip_h != group.flip_v;
        placed = Placement {
            cx,
            cy,
            w: placed.w * sx,
            h: placed.h * sy,
            rotation: group.rotation
                + if mirrored {
                    -placed.rotation
                } else {
                    placed.rotation
                },
            flip_h: placed.flip_h != group.flip_h,
            flip_v: placed.flip_v != group.flip_v,
        };
    }
    placed
}

/// A placeholder's type and index.
#[derive(Debug, Clone)]
struct PlaceholderKey {
    kind: String,
    idx: Option<i64>,
}

/// The first child of any shape is its non-visual properties, whose `nvPr`
/// holds `p:ph`.
fn placeholder_key(shape: Node) -> Option<PlaceholderKey> {
    let non_visual = xml::elements(shape).next()?;
    let ph = xml::child(xml::child(non_visual, P, "nvPr")?, P, "ph")?;
    Some(PlaceholderKey {
        kind: ph.attribute("type").unwrap_or("obj").to_owned(),
        idx: xml::int(ph, "idx"),
    })
}

fn placeholders_of<'a, 'i>(root: Node<'a, 'i>) -> Vec<Node<'a, 'i>> {
    sp_tree(root)
        .map(|tree| {
            xml::elements(tree)
                .filter_map(xml::resolve_alternate)
                .filter(|shape| placeholder_key(*shape).is_some())
                .collect()
        })
        .unwrap_or_default()
}

/// The master's placeholder type a layout placeholder of `kind` takes after.
fn master_kind(kind: &str) -> &str {
    match kind {
        "ctrTitle" | "title" => "title",
        "dt" | "ftr" | "sldNum" | "hdr" => kind,
        _ => "body",
    }
}

/// A shape's own `spPr`, whatever namespace its shape is in.
fn shape_properties<'a, 'i>(shape: Node<'a, 'i>) -> Option<Node<'a, 'i>> {
    xml::child(shape, P, "spPr")
        .or_else(|| xml::child(shape, DSP, "spPr"))
        .or_else(|| xml::child(shape, P, "grpSpPr"))
        .or_else(|| xml::child(shape, DSP, "grpSpPr"))
}

fn shape_style<'a, 'i>(shape: Node<'a, 'i>) -> Option<Node<'a, 'i>> {
    xml::child(shape, P, "style").or_else(|| xml::child(shape, DSP, "style"))
}

fn text_body<'a, 'i>(shape: Node<'a, 'i>) -> Option<Node<'a, 'i>> {
    xml::child(shape, P, "txBody").or_else(|| xml::child(shape, DSP, "txBody"))
}

fn is_hidden(shape: Node) -> bool {
    xml::elements(shape)
        .next()
        .and_then(|non_visual| xml::elements(non_visual).next())
        .is_some_and(|c_nv_pr| xml::flag(c_nv_pr, "hidden") == Some(true))
}

struct Builder<'b, 'a, 'i> {
    package: &'b Package,
    sink: &'b mut dyn MediaSink,
    theme: &'b Theme<'a, 'i>,
    canvas: Canvas,
    number: usize,
    styles: &'b Styles,
    layout_placeholders: Vec<Node<'b, 'b>>,
    master_placeholders: Vec<Node<'b, 'b>>,
    table_styles: Option<&'b Document<'b>>,
    elements: &'b mut Vec<Value>,
    next_id: usize,
    /// The theme's own part: a picture in one of its fill or background
    /// styles is named by the theme's relationships, not the slide's.
    theme_part: Option<String>,
}

/// What a placeholder on a slide inherits from: the layout's and master's
/// placeholders it stands for.
struct Lineage<'n, 'i> {
    layout: Option<Node<'n, 'i>>,
    master: Option<Node<'n, 'i>>,
    kind: Option<String>,
}

impl<'b, 'a, 'i> Builder<'b, 'a, 'i> {
    fn id(&mut self) -> String {
        self.next_id += 1;
        format!("pptx_{}_{}", self.number, self.next_id)
    }

    fn lineage(&self, shape: Node, source: ShapeSource) -> Lineage<'b, 'b> {
        let Some(key) = placeholder_key(shape).filter(|_| source == ShapeSource::Slide) else {
            return Lineage {
                layout: None,
                master: None,
                kind: None,
            };
        };
        let layout = key
            .idx
            .and_then(|idx| {
                self.layout_placeholders.iter().copied().find(|candidate| {
                    placeholder_key(*candidate).is_some_and(|other| other.idx == Some(idx))
                })
            })
            .or_else(|| {
                self.layout_placeholders.iter().copied().find(|candidate| {
                    placeholder_key(*candidate).is_some_and(|other| other.kind == key.kind)
                })
            });
        let kind = layout
            .and_then(placeholder_key)
            .map_or_else(|| key.kind.clone(), |layout_key| layout_key.kind);
        let master = self.master_placeholders.iter().copied().find(|candidate| {
            placeholder_key(*candidate)
                .is_some_and(|other| master_kind(&other.kind) == master_kind(&kind))
        });
        Lineage {
            layout,
            master,
            kind: Some(kind),
        }
    }

    // --- Walking -------------------------------------------------------------

    fn walk<'n>(&mut self, tree: Node<'n, 'n>, part: &str, groups: &[Frame], source: ShapeSource)
    where
        'b: 'n,
    {
        for node in xml::elements(tree) {
            let Some(shape) = xml::resolve_alternate(node) else {
                continue;
            };
            self.shape(shape, part, groups, source, None);
        }
    }

    fn shape<'n>(
        &mut self,
        shape: Node<'n, 'n>,
        part: &str,
        groups: &[Frame],
        source: ShapeSource,
        group_fill: Option<&Paint>,
    ) where
        'b: 'n,
    {
        let name = shape.tag_name().name();
        if !matches!(name, "sp" | "pic" | "cxnSp" | "grpSp" | "graphicFrame") {
            return;
        }
        if is_hidden(shape) {
            return;
        }
        if source == ShapeSource::Inherited && placeholder_key(shape).is_some() {
            return;
        }
        match name {
            "grpSp" => self.group(shape, part, groups, source, group_fill),
            "graphicFrame" => self.graphic_frame(shape, part, groups),
            _ => self.drawn_shape(shape, part, groups, source, group_fill),
        }
    }

    fn group<'n>(
        &mut self,
        shape: Node<'n, 'n>,
        part: &str,
        groups: &[Frame],
        source: ShapeSource,
        group_fill: Option<&Paint>,
    ) where
        'b: 'n,
    {
        let properties = shape_properties(shape);
        let Some(xfrm) = properties.and_then(|props| xml::child(props, A, "xfrm")) else {
            return;
        };
        let mut frames = groups.to_vec();
        frames.push(read_xfrm(xfrm));
        let own_fill = properties
            .and_then(fill::fill_child)
            .map(|node| fill::read(node, &self.theme.palette));
        let fill = match own_fill {
            Some(Paint::Group) | None => group_fill.cloned(),
            other => other,
        };
        for node in xml::elements(shape) {
            let Some(child) = xml::resolve_alternate(node) else {
                continue;
            };
            self.shape(child, part, &frames, source, fill.as_ref());
        }
    }

    /// A shape, a picture or a connector.
    fn drawn_shape<'n>(
        &mut self,
        shape: Node<'n, 'n>,
        part: &str,
        groups: &[Frame],
        source: ShapeSource,
        group_fill: Option<&Paint>,
    ) where
        'b: 'n,
    {
        let lineage: Lineage<'n, 'n> = self.lineage(shape, source);
        let own = shape_properties(shape);
        let inherited_props: Vec<Node> = [lineage.layout, lineage.master]
            .into_iter()
            .flatten()
            .filter_map(shape_properties)
            .collect();

        let xfrm = own
            .and_then(|props| xml::child(props, A, "xfrm"))
            .or_else(|| {
                inherited_props
                    .iter()
                    .find_map(|props| xml::child(*props, A, "xfrm"))
            });
        let Some(xfrm) = xfrm else {
            return;
        };
        let frame = read_xfrm(xfrm);
        let placed = place(&frame, groups);

        // The geometry: its own, else its placeholder's, else a rectangle.
        let geometry_holder = own
            .filter(|props| {
                xml::child(*props, A, "prstGeom").is_some()
                    || xml::child(*props, A, "custGeom").is_some()
            })
            .or_else(|| {
                inherited_props.iter().copied().find(|props| {
                    xml::child(*props, A, "prstGeom").is_some()
                        || xml::child(*props, A, "custGeom").is_some()
                })
            });
        let scale = self.canvas.scale;
        let paths = geometry_holder
            .and_then(|holder| geometry::paths_of(holder, placed.w, placed.h, scale))
            .unwrap_or_else(|| geometry::rectangle(placed.w, placed.h, scale));
        let is_rectangle = geometry_holder
            .and_then(|holder| xml::child(holder, A, "prstGeom"))
            .is_none_or(|preset| preset.attribute("prst") == Some("rect"))
            && geometry_holder
                .and_then(|holder| xml::child(holder, A, "custGeom"))
                .is_none();

        let style = shape_style(shape)
            .or_else(|| lineage.layout.and_then(shape_style))
            .or_else(|| lineage.master.and_then(shape_style));

        // The fill.
        let is_picture = shape.tag_name().name() == "pic";
        let mut fill_from_theme = false;
        let fill = if is_picture {
            xml::child(shape, P, "blipFill")
                .and_then(|blip_fill| fill::picture(blip_fill, &self.theme.palette))
                .map(Paint::Picture)
                .unwrap_or(Paint::None)
        } else {
            let own_fill = own
                .and_then(fill::fill_child)
                .map(|node| fill::read(node, &self.theme.palette));
            let inherited_fill = || {
                inherited_props
                    .iter()
                    .find_map(|props| fill::fill_child(*props))
                    .map(|node| fill::read(node, &self.theme.palette))
            };
            let style_fill = || {
                let reference = style.and_then(|style| xml::child(style, A, "fillRef"))?;
                let idx = xml::int(reference, "idx")?;
                let palette = self.theme.palette.with_placeholder(
                    super::color::color_child(reference).and_then(|color| self.theme.color(color)),
                );
                let node = self.theme.fill_style(idx)?;
                Some(fill::read(node, &palette))
            };
            let fill = match own_fill.or_else(inherited_fill) {
                Some(fill) => fill,
                None => match style_fill() {
                    Some(fill) => {
                        fill_from_theme = true;
                        fill
                    }
                    None => Paint::None,
                },
            };
            match fill {
                Paint::Group => group_fill.cloned().unwrap_or(Paint::None),
                other => other,
            }
        };

        // The outline.
        let own_line = own.and_then(|props| xml::child(props, A, "ln"));
        let line_ref = style.and_then(|style| xml::child(style, A, "lnRef"));
        let line_palette = line_ref.map(|reference| {
            self.theme.palette.with_placeholder(
                super::color::color_child(reference).and_then(|color| self.theme.color(color)),
            )
        });
        let theme_line = line_ref
            .and_then(|reference| xml::int(reference, "idx"))
            .and_then(|idx| self.theme.line_style(idx));
        let line = fill::line(
            own_line,
            theme_line.zip(line_palette.as_ref()),
            &self.theme.palette,
            scale,
        );

        match &fill {
            Paint::Picture(picture) => {
                let named_in = self.picture_part(fill_from_theme, part);
                self.picture(
                    picture,
                    &named_in,
                    &placed,
                    (!is_rectangle).then_some(&paths),
                );
                if let Some(line) = &line {
                    self.shape_element(&placed, &paths, None, Some(line));
                }
            }
            _ => {
                let fill_json = fill.to_json(placed.w * scale, placed.h * scale);
                if fill_json.is_some() || line.is_some() {
                    self.shape_element(&placed, &paths, fill_json, line.as_ref());
                }
            }
        }

        if let Some(body) = text_body(shape) {
            self.words(shape, body, &placed, &lineage, style);
        }
    }

    fn box_json(&self, placed: &Placement) -> Map<String, Value> {
        let scale = self.canvas.scale;
        let (w, h) = (placed.w * scale, placed.h * scale);
        let x = self.canvas.offset.0 + placed.cx * scale - w / 2.0;
        let y = self.canvas.offset.1 + placed.cy * scale - h / 2.0;
        let mut element = Map::new();
        element.insert("x".into(), json!(round(x)));
        element.insert("y".into(), json!(round(y)));
        element.insert("width".into(), json!(round(w)));
        element.insert("height".into(), json!(round(h)));
        element
    }

    fn transform_style(placed: &Placement, mirror: bool) -> Map<String, Value> {
        let mut style = Map::new();
        let mut rotation = placed.rotation;
        let (mut flip_x, mut flip_y) = (placed.flip_h, placed.flip_v);
        if !mirror {
            // Words are never mirrored: a flipped box turns them instead.
            if flip_y {
                rotation += 180.0;
            }
            flip_x = false;
            flip_y = false;
        }
        style.insert("rotation".into(), json!(round(rotation.rem_euclid(360.0))));
        if flip_x {
            style.insert("flipX".into(), json!(true));
        }
        if flip_y {
            style.insert("flipY".into(), json!(true));
        }
        style
    }

    fn shape_element(
        &mut self,
        placed: &Placement,
        paths: &[ShapePath],
        fill: Option<Value>,
        line: Option<&Line>,
    ) {
        let mut element = self.box_json(placed);
        element.insert("id".into(), json!(self.id()));
        element.insert("type".into(), json!("shape"));
        element.insert("content".into(), json!(""));
        let mut style = Self::transform_style(placed, true);
        style.insert("backgroundColor".into(), json!("transparent"));
        if let Some(fill) = fill {
            style.insert("fill".into(), fill);
        }
        if let Some(line) = line {
            style.insert("line".into(), line.to_json());
        }
        element.insert("style".into(), Value::Object(style));
        element.insert("geometry".into(), geometry_json(paths));
        self.elements.push(Value::Object(element));
    }

    fn picture(
        &mut self,
        picture: &Picture,
        part: &str,
        placed: &Placement,
        clip: Option<&Vec<ShapePath>>,
    ) {
        let Some(url) = self.media(part, &picture.rel_id, &picture.effects) else {
            return;
        };
        let mut element = self.box_json(placed);
        element.insert("id".into(), json!(self.id()));
        element.insert("type".into(), json!("image"));
        element.insert("content".into(), json!(url));
        let mut style = Self::transform_style(placed, true);
        style.insert("objectFit".into(), json!("fill"));
        if picture.opacity < 1.0 {
            style.insert("opacity".into(), json!(picture.opacity));
        }
        if !picture.crop.is_empty() {
            style.insert("crop".into(), picture.crop.to_json());
        }
        element.insert("style".into(), Value::Object(style));
        if let Some(paths) = clip {
            element.insert("geometry".into(), geometry_json(paths));
        }
        self.elements.push(Value::Object(element));
    }

    /// The picture a relationship of `part` points at, with its effects
    /// applied, stored.
    fn media(
        &mut self,
        part: &str,
        rel_id: &str,
        effects: &[super::picture::Effect],
    ) -> Option<String> {
        let target = self.package.related_by_id(part, rel_id).ok().flatten()?;
        let bytes = self.package.bytes(&target)?;
        if !effects.is_empty() {
            if let Some(recoloured) = super::picture::apply(bytes, effects) {
                let key = format!("{target}#{}", super::picture::key(effects));
                return self.sink.store(&key, &recoloured, "png");
            }
        }
        let extension = sniff_extension(bytes);
        // Not a picture at all — a part a wrong relationship led to — is left
        // out rather than kept as one nothing can show.
        if extension == "png" && !bytes.starts_with(b"\x89PNG") {
            tracing::info!(target, "a picture's part is not a picture; it is left out");
            return None;
        }
        self.sink.store(&target, bytes, extension)
    }

    fn words<'n>(
        &mut self,
        shape: Node<'n, 'n>,
        body: Node<'n, 'n>,
        placed: &Placement,
        lineage: &Lineage<'n, 'n>,
        style: Option<Node<'n, 'n>>,
    ) {
        let theme = self.theme;
        let list_style = |holder: Option<Node<'n, 'n>>| {
            ListStyle::read(
                holder
                    .and_then(text_body)
                    .and_then(|tx| xml::child(tx, A, "lstStyle")),
                theme,
            )
        };
        let master_list = list_style(lineage.master);
        let layout_list = list_style(lineage.layout);
        let base = match lineage.kind.as_deref() {
            Some("title" | "ctrTitle") => &self.styles.title,
            Some("dt" | "ftr" | "sldNum" | "hdr") => &self.styles.other,
            Some(_) => &self.styles.body,
            None => &self.styles.default,
        };
        let mut list_styles: Vec<&ListStyle> = vec![&self.styles.default];
        if lineage.kind.is_some() {
            list_styles.extend([base, &master_list, &layout_list]);
        }

        let mut body_props = BodyProps::default();
        for holder in [lineage.master, lineage.layout].into_iter().flatten() {
            if let Some(body_pr) = text_body(holder).and_then(|tx| xml::child(tx, A, "bodyPr")) {
                body_props.merge(&BodyProps::read(body_pr));
            }
        }

        let mut font_ref = RunProps::default();
        if let Some(reference) = style.and_then(|style| xml::child(style, A, "fontRef")) {
            font_ref.latin = reference
                .attribute("idx")
                .and_then(|idx| theme.font_collection(idx));
            font_ref.fill = super::color::color_child(reference)
                .and_then(|color| theme.color(color))
                .map(Paint::Solid);
        }

        let inherited = Inherited {
            list_styles,
            font_ref,
            body: body_props,
        };
        let Some(words) = text::words(body, &inherited, theme, self.canvas.scale, self.number)
        else {
            return;
        };

        // SmartArt gives its words a box of their own.
        let text_placed = xml::child(shape, DSP, "txXfrm")
            .map(|xfrm| {
                let frame = read_xfrm(xfrm);
                Placement {
                    cx: frame.offset.0 + frame.extent.0 / 2.0,
                    cy: frame.offset.1 + frame.extent.1 / 2.0,
                    w: frame.extent.0,
                    h: frame.extent.1,
                    ..*placed
                }
            })
            .unwrap_or(*placed);

        let mut element = self.box_json(&text_placed);
        element.insert("id".into(), json!(self.id()));
        element.insert("type".into(), json!("text"));
        element.insert("content".into(), json!(words.plain));
        let mut style_json = Self::transform_style(&text_placed, false);
        let first = words.first.unwrap_or_else(|| json!({}));
        style_json.insert(
            "fontFamily".into(),
            first
                .get("fontFamily")
                .cloned()
                .unwrap_or_else(|| json!("Calibri")),
        );
        style_json.insert(
            "fontSize".into(),
            first.get("fontSize").cloned().unwrap_or_else(|| json!(36)),
        );
        style_json.insert(
            "fontWeight".into(),
            first
                .get("fontWeight")
                .cloned()
                .unwrap_or_else(|| json!("400")),
        );
        style_json.insert(
            "fontStyle".into(),
            first
                .get("fontStyle")
                .cloned()
                .unwrap_or_else(|| json!("normal")),
        );
        style_json.insert(
            "color".into(),
            first
                .get("color")
                .cloned()
                .unwrap_or_else(|| json!("#000000")),
        );
        style_json.insert("textAlign".into(), json!(words.first_align));
        style_json.insert(
            "verticalAlign".into(),
            words.text_body["verticalAlign"].clone(),
        );
        for (inset, padding) in [
            ("insetLeft", "paddingLeft"),
            ("insetTop", "paddingTop"),
            ("insetRight", "paddingRight"),
            ("insetBottom", "paddingBottom"),
        ] {
            style_json.insert(padding.into(), words.text_body[inset].clone());
        }
        element.insert("style".into(), Value::Object(style_json));
        element.insert("textBody".into(), words.text_body);
        self.elements.push(Value::Object(element));
    }

    /// The part whose relationships name a picture: the theme's, for one
    /// from its styles, or else the part it was read from.
    fn picture_part(&self, from_theme: bool, part: &str) -> String {
        match (&self.theme_part, from_theme) {
            (Some(theme), true) => theme.clone(),
            _ => part.to_owned(),
        }
    }

    // --- Backgrounds ---------------------------------------------------------

    /// The background a part sets, drawn as elements where it is more than a
    /// colour. `None` when the part sets none; `Some(colour)` otherwise.
    fn background(&mut self, root: Node, part: &str) -> Option<Option<Rgba>> {
        let bg = xml::path(root, P, &["cSld", "bg"])?;
        // A background from the theme's styles (`bgRef`) names its picture by
        // the theme's relationships. Read by the slide's, the same id could
        // be the slide's layout, which was imported as a picture.
        let from_theme = xml::child(bg, P, "bgPr").is_none();
        let paint = if let Some(bg_pr) = xml::child(bg, P, "bgPr") {
            fill::fill_child(bg_pr).map(|node| fill::read(node, &self.theme.palette))?
        } else {
            let reference = xml::child(bg, P, "bgRef")?;
            let palette = self.theme.palette.with_placeholder(
                super::color::color_child(reference).and_then(|color| self.theme.color(color)),
            );
            let idx = xml::int(reference, "idx").unwrap_or(0);
            match self.theme.fill_style(idx) {
                Some(node) => fill::read(node, &palette),
                None => palette.placeholder.map_or(Paint::None, Paint::Solid),
            }
        };
        let whole = Placement {
            cx: self.canvas.width / 2.0,
            cy: self.canvas.height / 2.0,
            w: self.canvas.width,
            h: self.canvas.height,
            rotation: 0.0,
            flip_h: false,
            flip_v: false,
        };
        match &paint {
            Paint::Solid(color) => Some(Some(*color)),
            Paint::Picture(picture) => {
                let named_in = self.picture_part(from_theme, part);
                self.picture(picture, &named_in, &whole, None);
                Some(None)
            }
            Paint::Linear { .. } | Paint::Radial { .. } => {
                let paths = geometry::rectangle(whole.w, whole.h, self.canvas.scale);
                let json = paint.to_json(whole.w * self.canvas.scale, whole.h * self.canvas.scale);
                self.shape_element(&whole, &paths, json, None);
                Some(paint.representative())
            }
            Paint::None | Paint::Group => Some(None),
        }
    }

    // --- Tables, SmartArt and embedded objects ------------------------------

    fn graphic_frame<'n>(&mut self, frame: Node<'n, 'n>, part: &str, groups: &[Frame])
    where
        'b: 'n,
    {
        let Some(xfrm) = xml::child(frame, P, "xfrm") else {
            return;
        };
        let own = read_xfrm(xfrm);
        let data = xml::path(frame, A, &["graphic", "graphicData"]);
        match data.and_then(|data| data.attribute("uri")) {
            Some(TABLE_URI) => {
                if let Some(table) = data.and_then(|data| xml::child(data, A, "tbl")) {
                    self.table(table, &own, groups);
                }
            }
            Some(DIAGRAM_URI) => self.diagram(frame, part, &own, groups),
            _ => {
                // An embedded object or anything else that carries a picture of
                // itself: draw the picture in the frame.
                if let Some(picture) = frame
                    .descendants()
                    .find(|node| xml::is(*node, P, "pic"))
                    .and_then(|pic| xml::child(pic, P, "blipFill"))
                    .and_then(|blip_fill| fill::picture(blip_fill, &self.theme.palette))
                {
                    let placed = place(&own, groups);
                    self.picture(&picture, part, &placed, None);
                }
            }
        }
    }

    /// SmartArt: the drawing PowerPoint saved of it, placed in its frame.
    fn diagram<'n>(&mut self, frame: Node<'n, 'n>, part: &str, own: &Frame, groups: &[Frame])
    where
        'b: 'n,
    {
        let drawing_part = (|| {
            let rel_ids = frame
                .descendants()
                .find(|node| node.tag_name().name() == "relIds")?;
            let data_part = self
                .package
                .related_by_id(part, rel_ids.attribute((R, "dm"))?)
                .ok()
                .flatten()?;
            let data_text = self.package.text(&data_part)?;
            let data = Document::parse(&data_text).ok()?;
            let rel_id = data
                .descendants()
                .find(|node| node.tag_name().name() == "dataModelExt")
                .and_then(|ext| ext.attribute("relId"))
                .map(str::to_owned);
            match rel_id {
                Some(rel_id) => self.package.related_by_id(part, &rel_id).ok().flatten(),
                None => self
                    .package
                    .relationships(part)
                    .ok()?
                    .into_iter()
                    .find(|relationship| relationship.rel_type == RT_DIAGRAM_DRAWING)
                    .and_then(|relationship| relationship.target),
            }
        })();
        let Some(drawing_part) = drawing_part else {
            return;
        };
        let Some(text) = self.package.text(&drawing_part) else {
            return;
        };
        let Ok(drawing) = Document::parse(&text) else {
            return;
        };
        let Some(tree) = drawing
            .descendants()
            .find(|node| xml::is(*node, DSP, "spTree"))
        else {
            return;
        };
        let mut frames = groups.to_vec();
        frames.push(Frame {
            child_offset: (0.0, 0.0),
            child_extent: own.extent,
            ..*own
        });
        for shape in xml::elements(tree) {
            if matches!(shape.tag_name().name(), "sp" | "grpSp") {
                if shape.tag_name().name() == "grpSp" {
                    self.group(shape, &drawing_part, &frames, ShapeSource::Slide, None);
                } else {
                    self.drawn_shape(shape, &drawing_part, &frames, ShapeSource::Slide, None);
                }
            }
        }
    }

    fn table(&mut self, table: Node, own: &Frame, groups: &[Frame]) {
        let columns: Vec<f64> = xml::child(table, A, "tblGrid")
            .map(|grid| {
                xml::children(grid, A, "gridCol")
                    .map(|col| xml::float(col, "w").unwrap_or(0.0))
                    .collect()
            })
            .unwrap_or_default();
        let rows: Vec<Node> = xml::children(table, A, "tr").collect();
        let heights: Vec<f64> = rows
            .iter()
            .map(|row| xml::float(*row, "h").unwrap_or(0.0))
            .collect();
        let props = xml::child(table, A, "tblPr");
        let table_style = props
            .and_then(|props| xml::child(props, A, "tableStyleId"))
            .and_then(|id| id.text())
            .and_then(|id| {
                self.table_styles?.descendants().find(|node| {
                    xml::is(*node, A, "tblStyle") && node.attribute("styleId") == Some(id.trim())
                })
            });
        let first_row = props
            .and_then(|props| xml::flag(props, "firstRow"))
            .unwrap_or(false);
        let band_rows = props
            .and_then(|props| xml::flag(props, "bandRow"))
            .unwrap_or(false);
        let style_part = |name: &str| table_style.and_then(|style| xml::child(style, A, name));

        let mut y = 0.0;
        for (row_index, row) in rows.iter().enumerate() {
            let mut x = 0.0;
            for (column_index, cell) in xml::children(*row, A, "tc").enumerate() {
                let width_span = xml::int(cell, "gridSpan").unwrap_or(1).max(1) as usize;
                let height_span = xml::int(cell, "rowSpan").unwrap_or(1).max(1) as usize;
                let cell_width: f64 = columns.iter().skip(column_index).take(width_span).sum();
                let cell_height: f64 = heights.iter().skip(row_index).take(height_span).sum();
                let merged = xml::flag(cell, "hMerge") == Some(true)
                    || xml::flag(cell, "vMerge") == Some(true);
                let column_width = columns.get(column_index).copied().unwrap_or(0.0);
                if !merged && cell_width > 0.0 && cell_height > 0.0 {
                    self.table_cell(
                        cell,
                        own,
                        groups,
                        (x, y, cell_width, cell_height),
                        TableCellStyle {
                            whole: style_part("wholeTbl"),
                            header: (first_row && row_index == 0)
                                .then(|| style_part("firstRow"))
                                .flatten(),
                            band: (band_rows
                                && row_index >= usize::from(first_row)
                                && (row_index - usize::from(first_row)) % 2 == 0)
                                .then(|| style_part("band1H"))
                                .flatten(),
                        },
                    );
                }
                x += column_width;
            }
            y += heights[row_index];
        }
    }

    fn table_cell(
        &mut self,
        cell: Node,
        own: &Frame,
        groups: &[Frame],
        (x, y, w, h): (f64, f64, f64, f64),
        style: TableCellStyle,
    ) {
        let frame = Frame {
            offset: (own.offset.0 + x, own.offset.1 + y),
            extent: (w, h),
            rotation: 0.0,
            flip_h: false,
            flip_v: false,
            ..Frame::default()
        };
        let placed = place(&frame, groups);
        let scale = self.canvas.scale;
        let properties = xml::child(cell, A, "tcPr");
        let palette = &self.theme.palette;
        let style_fill = |part: Option<Node>| {
            part.and_then(|part| xml::path(part, A, &["tcStyle", "fill"]))
                .and_then(fill::fill_child)
                .map(|node| fill::read(node, palette))
        };
        let paint = properties
            .and_then(fill::fill_child)
            .map(|node| fill::read(node, palette))
            .or_else(|| style_fill(style.header))
            .or_else(|| style_fill(style.band))
            .or_else(|| style_fill(style.whole))
            .unwrap_or(Paint::None);
        let rectangle = geometry::rectangle(placed.w, placed.h, scale);
        if let Some(fill_json) = paint.to_json(placed.w * scale, placed.h * scale) {
            self.shape_element(&placed, &rectangle, Some(fill_json), None);
        }

        // Each border its own line along that side.
        let style_border = |side: &str| {
            [style.header, style.whole]
                .into_iter()
                .flatten()
                .find_map(|part| xml::path(part, A, &["tcStyle", "tcBdr", side, "ln"]))
        };
        for (tag, side, from, to) in [
            ("lnT", "top", (0.0, 0.0), (1.0, 0.0)),
            ("lnB", "bottom", (0.0, 1.0), (1.0, 1.0)),
            ("lnL", "left", (0.0, 0.0), (0.0, 1.0)),
            ("lnR", "right", (1.0, 0.0), (1.0, 1.0)),
        ] {
            let own_line = properties.and_then(|props| xml::child(props, A, tag));
            let border = fill::line(
                own_line.or_else(|| style_border(side)),
                None,
                palette,
                scale,
            );
            if let Some(border) = border {
                let (w, h) = (placed.w * scale, placed.h * scale);
                let d = format!(
                    "M{} {}L{} {}",
                    round(from.0 * w),
                    round(from.1 * h),
                    round(to.0 * w),
                    round(to.1 * h)
                );
                let path = ShapePath {
                    d,
                    fill: false,
                    stroke: true,
                };
                self.shape_element(&placed, &[path], None, Some(&border));
            }
        }

        // The words, inset by the cell's margins, with the style's text look.
        let Some(body) = xml::child(cell, A, "txBody") else {
            return;
        };
        let margin = |name: &str, default: f64| {
            properties
                .and_then(|props| xml::float(props, name))
                .unwrap_or(default)
        };
        let body_props = BodyProps {
            insets: [
                Some(margin("marL", 91_440.0)),
                Some(margin("marT", 45_720.0)),
                Some(margin("marR", 91_440.0)),
                Some(margin("marB", 45_720.0)),
            ],
            anchor: properties.and_then(|props| props.attribute("anchor")).map(
                |anchor| match anchor {
                    "ctr" => "middle",
                    "b" => "bottom",
                    _ => "top",
                },
            ),
            ..BodyProps::default()
        };
        let mut font_ref = RunProps::default();
        for part in [style.whole, style.band, style.header]
            .into_iter()
            .flatten()
        {
            if let Some(text_style) = xml::child(part, A, "tcTxStyle") {
                if let Some(color) =
                    super::color::color_child(text_style).and_then(|color| self.theme.color(color))
                {
                    font_ref.fill = Some(Paint::Solid(color));
                }
                if let Some(bold) = text_style.attribute("b") {
                    font_ref.bold = Some(bold == "on");
                }
            }
        }
        let inherited = Inherited {
            list_styles: vec![&self.styles.default],
            font_ref,
            body: body_props,
        };
        let Some(words) = text::words(body, &inherited, self.theme, scale, self.number) else {
            return;
        };
        let mut element = self.box_json(&placed);
        element.insert("id".into(), json!(self.id()));
        element.insert("type".into(), json!("text"));
        element.insert("content".into(), json!(words.plain));
        let first = words.first.unwrap_or_else(|| json!({}));
        element.insert(
            "style".into(),
            json!({
                "rotation": 0,
                "fontFamily": first.get("fontFamily").cloned().unwrap_or_else(|| json!("Calibri")),
                "fontSize": first.get("fontSize").cloned().unwrap_or_else(|| json!(36)),
                "fontWeight": first.get("fontWeight").cloned().unwrap_or_else(|| json!("400")),
                "color": first.get("color").cloned().unwrap_or_else(|| json!("#000000")),
                "textAlign": words.first_align,
                "verticalAlign": words.text_body["verticalAlign"].clone(),
                "paddingLeft": words.text_body["insetLeft"].clone(),
                "paddingTop": words.text_body["insetTop"].clone(),
                "paddingRight": words.text_body["insetRight"].clone(),
                "paddingBottom": words.text_body["insetBottom"].clone(),
            }),
        );
        element.insert("textBody".into(), words.text_body);
        self.elements.push(Value::Object(element));
    }
}

#[derive(Clone, Copy)]
struct TableCellStyle<'n, 'i> {
    whole: Option<Node<'n, 'i>>,
    header: Option<Node<'n, 'i>>,
    band: Option<Node<'n, 'i>>,
}

fn geometry_json(paths: &[ShapePath]) -> Value {
    json!({
        "paths": paths
            .iter()
            .map(|path| json!({ "d": path.d, "fill": path.fill, "stroke": path.stroke }))
            .collect::<Vec<_>>(),
    })
}

fn round(value: f64) -> f64 {
    (value * 100.0).round() / 100.0
}

#[cfg(test)]
mod tests {
    use super::*;

    fn frame(x: f64, y: f64, w: f64, h: f64) -> Frame {
        Frame {
            offset: (x, y),
            extent: (w, h),
            child_offset: (x, y),
            child_extent: (w, h),
            ..Frame::default()
        }
    }

    #[test]
    fn a_child_of_a_group_in_slide_space_stays_where_it_is() {
        // PowerPoint's own groups: child space is the group's box. The old
        // importer added the group's offset again, and its children landed off
        // the slide.
        let group = frame(6_400_800.0, 914_400.0, 2_743_200.0, 2_286_000.0);
        let child = frame(6_400_800.0, 914_400.0, 914_400.0, 457_200.0);
        let placed = place(&child, &[group]);
        assert_eq!(placed.cx, 6_400_800.0 + 457_200.0);
        assert_eq!(placed.cy, 914_400.0 + 228_600.0);
    }

    #[test]
    fn a_resized_group_scales_its_children() {
        let group = Frame {
            offset: (0.0, 0.0),
            extent: (200.0, 100.0),
            child_offset: (0.0, 0.0),
            child_extent: (100.0, 100.0),
            ..Frame::default()
        };
        let placed = place(&frame(50.0, 0.0, 50.0, 50.0), &[group]);
        assert_eq!((placed.cx, placed.w), (150.0, 100.0));
        assert_eq!((placed.cy, placed.h), (25.0, 50.0));
    }

    #[test]
    fn a_rotated_group_turns_its_children_about_its_centre() {
        let group = Frame {
            rotation: 90.0,
            ..frame(0.0, 0.0, 100.0, 100.0)
        };
        let placed = place(&frame(0.0, 0.0, 50.0, 50.0), &[group]);
        // Top-left quarter turns to the top-right.
        assert!(
            (placed.cx - 75.0).abs() < 1e-9 && (placed.cy - 25.0).abs() < 1e-9,
            "{placed:?}"
        );
        assert_eq!(placed.rotation, 90.0);
    }

    #[test]
    fn a_flipped_group_mirrors_its_children() {
        let group = Frame {
            flip_h: true,
            ..frame(0.0, 0.0, 100.0, 100.0)
        };
        let child = Frame {
            rotation: 30.0,
            ..frame(0.0, 0.0, 50.0, 50.0)
        };
        let placed = place(&child, &[group]);
        assert_eq!(placed.cx, 75.0);
        assert!(placed.flip_h);
        assert_eq!(placed.rotation, -30.0);
    }

    #[test]
    fn pictures_are_known_by_their_first_bytes() {
        assert_eq!(sniff_extension(b"\x89PNG\r\n"), "png");
        assert_eq!(sniff_extension(&[0xFF, 0xD8, 0xFF]), "jpeg");
        assert_eq!(sniff_extension(b"<?xml version=\"1.0\"?><svg"), "svg");
    }
}
