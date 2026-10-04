//! A shape's words, with every style they inherit.
//!
//! PowerPoint resolves a run's look through a chain, lowest first:
//!
//! ```text
//! presentation default text style      by paragraph level, 1 to 9
//! master text styles                   title, body or other, for a placeholder
//! master placeholder's list style
//! layout placeholder's list style
//! the shape style's font reference     its font and colour
//! the shape's own list style
//! the paragraph's properties
//! the run's properties
//! ```
//!
//! The old importer took the first value it found across a master's
//! placeholders, whatever their level, which is why body text came out in the
//! title's size and every theme font as Calibri. Shrink-to-fit is applied here
//! from the scale PowerPoint stored in the file, rather than guessed again.

use roxmltree::Node;
use serde_json::{json, Map, Value};

use super::color::Rgba;
use super::fill::{self, Paint};
use super::theme::Theme;
use super::xml::{self, A};

const DEFAULT_SIZE_PT: f64 = 18.0;
/// The line height of single spacing, as a multiple of the size: about what
/// PowerPoint's fonts' ascent, descent and gap add up to.
const SINGLE_SPACING: f64 = 1.2;
const EMU_PER_POINT: f64 = 12_700.0;

#[derive(Debug, Clone, Copy, PartialEq)]
pub enum Spacing {
    /// A fraction of a line.
    Percent(f64),
    Points(f64),
}

#[derive(Debug, Clone, PartialEq)]
pub enum Bullet {
    None,
    Char(String),
    AutoNumber { scheme: String, start: i64 },
}

#[derive(Debug, Clone, Default, PartialEq)]
pub struct RunProps {
    pub size: Option<f64>,
    pub bold: Option<bool>,
    pub italic: Option<bool>,
    pub underline: Option<bool>,
    pub strike: Option<bool>,
    pub caps: Option<&'static str>,
    pub baseline: Option<f64>,
    /// Letter spacing in points.
    pub spacing: Option<f64>,
    pub latin: Option<String>,
    pub east_asian: Option<String>,
    pub fill: Option<Paint>,
    pub highlight: Option<Rgba>,
}

impl RunProps {
    pub fn merge(&mut self, over: &Self) {
        macro_rules! take {
            ($($field:ident),*) => { $( if over.$field.is_some() { self.$field = over.$field.clone(); } )* };
        }
        take!(
            size, bold, italic, underline, strike, caps, baseline, spacing, latin, east_asian,
            fill, highlight
        );
    }

    /// An `a:rPr`, `a:defRPr` or `a:endParaRPr`.
    pub fn read(node: Node, theme: &Theme) -> Self {
        let face = |tag: &str| {
            xml::child(node, A, tag)
                .and_then(|font| font.attribute("typeface"))
                .and_then(|face| theme.typeface(face))
        };
        Self {
            size: xml::float(node, "sz").map(|size| size / 100.0),
            bold: xml::flag(node, "b"),
            italic: xml::flag(node, "i"),
            underline: node.attribute("u").map(|u| u != "none"),
            strike: node.attribute("strike").map(|strike| strike != "noStrike"),
            caps: node.attribute("cap").map(|cap| match cap {
                "all" => "all",
                "small" => "small",
                _ => "none",
            }),
            baseline: xml::percent(node, "baseline"),
            spacing: xml::float(node, "spc").map(|spc| spc / 100.0),
            latin: face("latin"),
            east_asian: face("ea"),
            fill: fill::fill_child(node).map(|fill| fill::read(fill, &theme.palette)),
            highlight: xml::child(node, A, "highlight")
                .and_then(super::color::color_child)
                .and_then(|color| theme.color(color)),
        }
    }
}

#[derive(Debug, Clone, Default, PartialEq)]
pub struct ParaProps {
    pub align: Option<&'static str>,
    /// EMU.
    pub margin_left: Option<f64>,
    pub indent: Option<f64>,
    pub line_spacing: Option<Spacing>,
    pub space_before: Option<Spacing>,
    pub space_after: Option<Spacing>,
    pub bullet: Option<Bullet>,
    /// `None` inside is "follow the text".
    pub bullet_font: Option<Option<String>>,
    pub bullet_color: Option<Option<Rgba>>,
    pub bullet_size: Option<Option<Spacing>>,
    pub run: RunProps,
}

impl ParaProps {
    pub fn merge(&mut self, over: &Self) {
        macro_rules! take {
            ($($field:ident),*) => { $( if over.$field.is_some() { self.$field = over.$field.clone(); } )* };
        }
        take!(
            align,
            margin_left,
            indent,
            line_spacing,
            space_before,
            space_after,
            bullet,
            bullet_font,
            bullet_color,
            bullet_size
        );
        self.run.merge(&over.run);
    }

    /// An `a:pPr` or an `a:lvlNpPr`.
    pub fn read(node: Node, theme: &Theme) -> Self {
        let spacing = |tag: &str| {
            let holder = xml::child(node, A, tag)?;
            if let Some(percent) = xml::child(holder, A, "spcPct") {
                return xml::percent(percent, "val").map(Spacing::Percent);
            }
            xml::child(holder, A, "spcPts")
                .and_then(|points| xml::float(points, "val"))
                .map(|value| Spacing::Points(value / 100.0))
        };
        let mut props = Self {
            align: node.attribute("algn").map(|align| match align {
                "ctr" => "center",
                "r" => "right",
                "just" | "dist" | "justLow" | "thaiDist" => "justify",
                _ => "left",
            }),
            margin_left: xml::float(node, "marL"),
            indent: xml::float(node, "indent"),
            line_spacing: spacing("lnSpc"),
            space_before: spacing("spcBef"),
            space_after: spacing("spcAft"),
            ..Self::default()
        };
        for child in xml::elements(node) {
            match child.tag_name().name() {
                "buNone" => props.bullet = Some(Bullet::None),
                "buChar" => {
                    props.bullet = Some(Bullet::Char(
                        child.attribute("char").unwrap_or("•").to_owned(),
                    ));
                }
                "buAutoNum" => {
                    props.bullet = Some(Bullet::AutoNumber {
                        scheme: child.attribute("type").unwrap_or("arabicPeriod").to_owned(),
                        start: xml::int(child, "startAt").unwrap_or(1),
                    });
                }
                "buBlip" => props.bullet = Some(Bullet::Char("•".to_owned())),
                "buFontTx" => props.bullet_font = Some(None),
                "buFont" => {
                    props.bullet_font = Some(
                        child
                            .attribute("typeface")
                            .and_then(|face| theme.typeface(face)),
                    );
                }
                "buClrTx" => props.bullet_color = Some(None),
                "buClr" => {
                    props.bullet_color =
                        Some(super::color::color_child(child).and_then(|color| theme.color(color)));
                }
                "buSzTx" => props.bullet_size = Some(None),
                "buSzPct" => {
                    props.bullet_size = Some(xml::percent(child, "val").map(Spacing::Percent))
                }
                "buSzPts" => {
                    props.bullet_size =
                        Some(xml::float(child, "val").map(|value| Spacing::Points(value / 100.0)));
                }
                "defRPr" => props.run = RunProps::read(child, theme),
                _ => {}
            }
        }
        props
    }
}

/// Paragraph properties by level, from an `a:lstStyle`, a master's
/// `p:titleStyle` and its kin, or a presentation's `p:defaultTextStyle`.
#[derive(Debug, Clone, Default)]
pub struct ListStyle {
    levels: [ParaProps; 9],
}

impl ListStyle {
    pub fn read(node: Option<Node>, theme: &Theme) -> Self {
        let mut style = Self::default();
        let Some(node) = node else {
            return style;
        };
        if let Some(default) = xml::child(node, A, "defPPr") {
            let props = ParaProps::read(default, theme);
            for level in &mut style.levels {
                level.merge(&props);
            }
        }
        for (index, level) in style.levels.iter_mut().enumerate() {
            if let Some(node) = xml::child(node, A, &format!("lvl{}pPr", index + 1)) {
                level.merge(&ParaProps::read(node, theme));
            }
        }
        style
    }

    pub fn level(&self, level: usize) -> &ParaProps {
        &self.levels[level.min(8)]
    }
}

/// Where and how the words sit in their box: `a:bodyPr`, inherited.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct BodyProps {
    /// EMU.
    pub insets: [Option<f64>; 4],
    pub anchor: Option<&'static str>,
    pub wrap: Option<bool>,
    pub autofit: Option<Autofit>,
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub enum Autofit {
    None,
    /// Shrink text on overflow: the scale PowerPoint worked out.
    Shrink {
        font_scale: f64,
        line_reduction: f64,
    },
    /// Resize the shape to fit the text.
    Grow,
}

impl BodyProps {
    pub fn read(node: Node) -> Self {
        Self {
            insets: ["lIns", "tIns", "rIns", "bIns"].map(|name| xml::float(node, name)),
            anchor: node.attribute("anchor").map(|anchor| match anchor {
                "ctr" => "middle",
                "b" => "bottom",
                _ => "top",
            }),
            wrap: node.attribute("wrap").map(|wrap| wrap != "none"),
            autofit: xml::elements(node).find_map(|child| match child.tag_name().name() {
                "noAutofit" => Some(Autofit::None),
                "normAutofit" => Some(Autofit::Shrink {
                    font_scale: xml::percent(child, "fontScale").unwrap_or(1.0),
                    line_reduction: xml::percent(child, "lnSpcReduction").unwrap_or(0.0),
                }),
                "spAutoFit" => Some(Autofit::Grow),
                _ => None,
            }),
        }
    }

    pub fn merge(&mut self, over: &Self) {
        for (mine, theirs) in self.insets.iter_mut().zip(over.insets) {
            if theirs.is_some() {
                *mine = theirs;
            }
        }
        if over.anchor.is_some() {
            self.anchor = over.anchor;
        }
        if over.wrap.is_some() {
            self.wrap = over.wrap;
        }
        if over.autofit.is_some() {
            self.autofit = over.autofit;
        }
    }
}

/// Everything a text body inherits, lowest first.
pub struct Inherited<'s> {
    pub list_styles: Vec<&'s ListStyle>,
    /// The shape style's `fontRef`: its font and colour.
    pub font_ref: RunProps,
    pub body: BodyProps,
}

/// A text body, read into what the renderers draw.
pub struct Words {
    pub text_body: Value,
    /// Every run's text, paragraphs on lines.
    pub plain: String,
    /// The first run's look, for the element's own style.
    pub first: Option<Value>,
    pub first_align: &'static str,
}

/// `scale` is pixels per EMU; `slide_number` fills slide-number fields.
pub fn words(
    tx_body: Node,
    inherited: &Inherited,
    theme: &Theme,
    scale: f64,
    slide_number: usize,
) -> Option<Words> {
    let own_list = ListStyle::read(xml::child(tx_body, A, "lstStyle"), theme);
    let mut body = inherited.body.clone();
    if let Some(body_pr) = xml::child(tx_body, A, "bodyPr") {
        body.merge(&BodyProps::read(body_pr));
    }
    let (font_scale, line_reduction) = match body.autofit {
        Some(Autofit::Shrink {
            font_scale,
            line_reduction,
        }) => (font_scale, line_reduction),
        _ => (1.0, 0.0),
    };
    let px = |emu: f64| emu * scale;
    let point_px = |points: f64| points * EMU_PER_POINT * scale;

    let mut paragraphs = Vec::new();
    let mut plain_lines = Vec::new();
    let mut first_run: Option<Value> = None;
    let mut first_align = "left";
    let mut numbering: [i64; 9] = [0; 9];
    let mut any_text = false;

    for paragraph in xml::children(tx_body, A, "p") {
        let ppr = xml::child(paragraph, A, "pPr");
        let level = ppr
            .and_then(|ppr| xml::int(ppr, "lvl"))
            .unwrap_or(0)
            .clamp(0, 8) as usize;

        let mut props = ParaProps::default();
        for style in &inherited.list_styles {
            props.merge(style.level(level));
        }
        props.run.merge(&inherited.font_ref);
        props.merge(own_list.level(level));
        if let Some(ppr) = ppr {
            props.merge(&ParaProps::read(ppr, theme));
        }

        // The runs, line breaks and fields, each with its own look.
        let mut runs: Vec<(String, RunProps)> = Vec::new();
        for child in xml::elements(paragraph) {
            let own = |node: Node| {
                let mut run = props.run.clone();
                if let Some(rpr) = xml::child(node, A, "rPr") {
                    run.merge(&RunProps::read(rpr, theme));
                }
                run
            };
            match child.tag_name().name() {
                "r" => {
                    let text = xml::child(child, A, "t")
                        .and_then(|t| t.text())
                        .unwrap_or("");
                    runs.push((text.to_owned(), own(child)));
                }
                "br" => runs.push(("\n".to_owned(), own(child))),
                "fld" => {
                    let text = if child.attribute("type") == Some("slidenum") {
                        slide_number.to_string()
                    } else {
                        xml::child(child, A, "t")
                            .and_then(|t| t.text())
                            .unwrap_or("")
                            .to_owned()
                    };
                    runs.push((text, own(child)));
                }
                _ => {}
            }
        }
        // An empty paragraph is still a line, as tall as its end mark.
        let end_props = {
            let mut run = props.run.clone();
            if let Some(end) = xml::child(paragraph, A, "endParaRPr") {
                run.merge(&RunProps::read(end, theme));
            }
            run
        };
        let has_text = runs.iter().any(|(text, _)| !text.trim().is_empty());
        any_text |= has_text;
        if runs.is_empty() {
            runs.push((String::new(), end_props.clone()));
        }

        let size_px = |run: &RunProps| point_px(run.size.unwrap_or(DEFAULT_SIZE_PT) * font_scale);
        let first_size = runs
            .first()
            .map_or_else(|| size_px(&end_props), |(_, run)| size_px(run));

        let run_values: Vec<Value> = runs
            .iter()
            .map(|(text, run)| run_json(text, run, size_px(run), point_px))
            .collect();
        if first_run.is_none() && has_text {
            first_run = run_values
                .iter()
                .find(|run| {
                    run["text"]
                        .as_str()
                        .is_some_and(|text| !text.trim().is_empty())
                })
                .cloned();
            first_align = props.align.unwrap_or("left");
        }

        let mut paragraph_json = Map::new();
        paragraph_json.insert("alignment".into(), json!(props.align.unwrap_or("left")));
        let line_height = match props.line_spacing {
            Some(Spacing::Points(points)) => point_px(points),
            Some(Spacing::Percent(percent)) => {
                ((percent - line_reduction).max(0.1)) * SINGLE_SPACING
            }
            None => (1.0 - line_reduction).max(0.1) * SINGLE_SPACING,
        };
        paragraph_json.insert("lineHeight".into(), json!(round(line_height)));
        let spacing_px = |spacing: Option<Spacing>| match spacing {
            Some(Spacing::Points(points)) => point_px(points),
            Some(Spacing::Percent(percent)) => percent * first_size * SINGLE_SPACING,
            None => 0.0,
        };
        paragraph_json.insert(
            "spaceBefore".into(),
            json!(round(spacing_px(props.space_before))),
        );
        paragraph_json.insert(
            "spaceAfter".into(),
            json!(round(spacing_px(props.space_after))),
        );
        paragraph_json.insert(
            "marginLeft".into(),
            json!(round(px(props.margin_left.unwrap_or(0.0)))),
        );
        paragraph_json.insert(
            "indent".into(),
            json!(round(px(props.indent.unwrap_or(0.0)))),
        );
        paragraph_json.insert("level".into(), json!(level));

        // The bullet, where there is text to put one by.
        let bullet_text = match (&props.bullet, has_text) {
            (Some(Bullet::Char(character)), true) => {
                numbering[level] = 0;
                Some(character.clone())
            }
            (Some(Bullet::AutoNumber { scheme, start }), true) => {
                numbering[level] = if numbering[level] == 0 {
                    *start
                } else {
                    numbering[level] + 1
                };
                Some(auto_number(scheme, numbering[level]))
            }
            _ => {
                if has_text {
                    numbering[level] = 0;
                }
                None
            }
        };
        for deeper in numbering.iter_mut().skip(level + 1) {
            *deeper = 0;
        }
        if let Some(text) = bullet_text {
            let text_run = runs.first().map_or(&end_props, |(_, run)| run);
            let mut bullet = Map::new();
            bullet.insert("text".into(), json!(text));
            let family = match &props.bullet_font {
                Some(Some(face)) => Some(face.clone()),
                _ => text_run.latin.clone(),
            };
            if let Some(family) = family {
                bullet.insert("fontFamily".into(), json!(family));
            }
            let color = match props.bullet_color {
                Some(Some(color)) => Some(color),
                _ => text_run.fill.as_ref().and_then(Paint::representative),
            };
            bullet.insert("color".into(), json!(color.unwrap_or(Rgba::BLACK).to_hex()));
            let size = match props.bullet_size {
                Some(Some(Spacing::Percent(percent))) => first_size * percent,
                Some(Some(Spacing::Points(points))) => point_px(points) * font_scale,
                _ => first_size,
            };
            bullet.insert("fontSize".into(), json!(round(size)));
            paragraph_json.insert("bullet".into(), Value::Object(bullet));
        }

        paragraph_json.insert("runs".into(), Value::Array(run_values));
        paragraphs.push(Value::Object(paragraph_json));
        plain_lines.push(
            runs.iter()
                .map(|(text, _)| text.as_str())
                .collect::<String>(),
        );
    }

    if !any_text {
        return None;
    }

    // PowerPoint's defaults: a tenth of an inch at the sides, half that above
    // and below, from the top.
    let [left, top, right, bottom] = body.insets;
    let text_body = json!({
        "insetLeft": round(px(left.unwrap_or(91_440.0))),
        "insetTop": round(px(top.unwrap_or(45_720.0))),
        "insetRight": round(px(right.unwrap_or(91_440.0))),
        "insetBottom": round(px(bottom.unwrap_or(45_720.0))),
        "verticalAlign": body.anchor.unwrap_or("top"),
        "wrap": body.wrap.unwrap_or(true),
        "autoFit": match body.autofit {
            Some(Autofit::Shrink { .. }) => "shrink",
            Some(Autofit::Grow) => "grow",
            _ => "none",
        },
        "paragraphs": paragraphs,
    });
    Some(Words {
        text_body,
        plain: plain_lines.join("\n").trim().to_owned(),
        first: first_run,
        first_align,
    })
}

fn run_json(text: &str, run: &RunProps, size_px: f64, point_px: impl Fn(f64) -> f64) -> Value {
    let text = match run.caps {
        Some("all" | "small") => text.to_uppercase(),
        _ => text.to_owned(),
    };
    let mut value = Map::new();
    value.insert("text".into(), json!(text));
    if let Some(family) = &run.latin {
        value.insert("fontFamily".into(), json!(family));
    }
    let size = if run.caps == Some("small") {
        size_px * 0.8
    } else {
        size_px
    };
    value.insert("fontSize".into(), json!(round(size)));
    value.insert(
        "fontWeight".into(),
        json!(if run.bold == Some(true) { "700" } else { "400" }),
    );
    value.insert(
        "fontStyle".into(),
        json!(if run.italic == Some(true) {
            "italic"
        } else {
            "normal"
        }),
    );
    let color = run
        .fill
        .as_ref()
        .map_or(Some(Rgba::BLACK), Paint::representative);
    match color {
        Some(color) => value.insert("color".into(), json!(color.to_hex())),
        // `noFill`: the words take up their room but are not seen.
        None => value.insert("color".into(), json!("#00000000")),
    };
    value.insert("underline".into(), json!(run.underline == Some(true)));
    if run.strike == Some(true) {
        value.insert("strike".into(), json!(true));
    }
    if let Some(spacing) = run.spacing.filter(|spacing| *spacing != 0.0) {
        value.insert("letterSpacing".into(), json!(round(point_px(spacing))));
    }
    if let Some(baseline) = run.baseline.filter(|baseline| *baseline != 0.0) {
        value.insert("baseline".into(), json!(baseline));
    }
    if let Some(highlight) = run.highlight {
        value.insert("highlight".into(), json!(highlight.to_hex()));
    }
    Value::Object(value)
}

fn round(value: f64) -> f64 {
    (value * 100.0).round() / 100.0
}

/// The number for paragraph `number` in a `buAutoNum` scheme.
pub fn auto_number(scheme: &str, number: i64) -> String {
    let (style, decoration) = [
        ("arabic", "arabic"),
        ("alphaLc", "alphaLc"),
        ("alphaUc", "alphaUc"),
        ("romanLc", "romanLc"),
        ("romanUc", "romanUc"),
    ]
    .iter()
    .find_map(|(prefix, style)| scheme.strip_prefix(prefix).map(|rest| (*style, rest)))
    .unwrap_or(("arabic", "Period"));
    let number = number.max(1);
    let body = match style {
        "alphaLc" => alpha(number).to_lowercase(),
        "alphaUc" => alpha(number),
        "romanLc" => roman(number).to_lowercase(),
        "romanUc" => roman(number),
        _ => number.to_string(),
    };
    match decoration {
        "ParenR" => format!("{body})"),
        "ParenBoth" => format!("({body})"),
        "Plain" => body,
        "Minus" => format!("- {body} -"),
        _ => format!("{body}."),
    }
}

fn alpha(mut number: i64) -> String {
    let mut letters = Vec::new();
    while number > 0 {
        number -= 1;
        letters.push((b'A' + (number % 26) as u8) as char);
        number /= 26;
    }
    letters.iter().rev().collect()
}

fn roman(mut number: i64) -> String {
    let table = [
        (1000, "M"),
        (900, "CM"),
        (500, "D"),
        (400, "CD"),
        (100, "C"),
        (90, "XC"),
        (50, "L"),
        (40, "XL"),
        (10, "X"),
        (9, "IX"),
        (5, "V"),
        (4, "IV"),
        (1, "I"),
    ];
    let mut out = String::new();
    for (value, numeral) in table {
        while number >= value {
            out.push_str(numeral);
            number -= value;
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn numbering_follows_its_scheme() {
        assert_eq!(auto_number("arabicPeriod", 3), "3.");
        assert_eq!(auto_number("alphaLcParenR", 2), "b)");
        assert_eq!(auto_number("romanUcPeriod", 4), "IV.");
        assert_eq!(auto_number("arabicParenBoth", 12), "(12)");
        assert_eq!(auto_number("alphaUcPeriod", 27), "AA.");
    }
}
