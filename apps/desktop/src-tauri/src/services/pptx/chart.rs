//! A PowerPoint chart, drawn as the shapes and words it is made of.
//!
//! A chart is a part of its own (`c:chartSpace`) holding the data it was last
//! drawn with — every series' values and the category names are cached in
//! it — and how to draw them. PowerPoint keeps no picture of it. So the chart
//! is laid out here, the way PowerPoint lays one out by default: a title, a
//! legend, a plot with gridlines and axis labels, and the bars, lines, areas,
//! slices or points. Each becomes an ordinary shape or text box, grouped, so
//! the chart shows on every screen and can be moved, recoloured and edited
//! like anything else on the slide.
//!
//! Column and bar (clustered, stacked, 100%), line, area, pie, doughnut and
//! scatter charts are drawn, and their 3-D kinds flat. A kind not drawn here
//! (radar, stock, surface, bubble) is drawn as the nearest one: bars.
//!
//! Everything here is in EMU from the chart frame's top-left; `deck.rs`
//! places it on the slide.

use roxmltree::{Document, Node};

use super::color::{Palette, Rgba};
use super::fill;
use super::xml::{self, A};

pub const CHART_URI: &str = "http://schemas.openxmlformats.org/drawingml/2006/chart";
const C: &str = "http://schemas.openxmlformats.org/drawingml/2006/chart";
const EMU_PER_POINT: f64 = 12_700.0;

/// A path command, in EMU from the item's own top-left.
#[derive(Debug, Clone, PartialEq)]
pub enum Cmd {
    M(f64, f64),
    L(f64, f64),
    C(f64, f64, f64, f64, f64, f64),
    Z,
}

#[derive(Debug, Clone, PartialEq)]
pub struct Path {
    pub cmds: Vec<Cmd>,
    pub fill: bool,
    pub stroke: bool,
}

/// A box in the chart frame, in EMU.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Rect {
    pub x: f64,
    pub y: f64,
    pub w: f64,
    pub h: f64,
}

#[derive(Debug, Clone, PartialEq)]
pub struct Outline {
    pub color: Rgba,
    /// In EMU.
    pub width: f64,
}

#[derive(Debug, Clone, PartialEq)]
pub enum Item {
    Shape {
        rect: Rect,
        paths: Vec<Path>,
        fill: Option<Rgba>,
        line: Option<Outline>,
    },
    Text {
        rect: Rect,
        text: String,
        size_pt: f64,
        color: Rgba,
        bold: bool,
        align: &'static str,
    },
}

#[derive(Debug, Clone, Copy, PartialEq)]
enum Grouping {
    Clustered,
    Stacked,
    Percent,
}

#[derive(Debug, Clone, Copy, PartialEq)]
enum Kind {
    Bars {
        horizontal: bool,
        grouping: Grouping,
        gap: f64,
        overlap: f64,
    },
    Line {
        grouping: Grouping,
        markers: bool,
    },
    Area {
        grouping: Grouping,
    },
    Pie {
        hole: f64,
        first_angle: f64,
    },
    Scatter {
        lines: bool,
    },
}

#[derive(Debug, Clone, PartialEq)]
struct Series {
    name: String,
    values: Vec<Option<f64>>,
    x_values: Vec<f64>,
    color: Rgba,
    /// Each point's own colour, by index (a pie's slices).
    point_colors: Vec<(usize, Rgba)>,
    line_off: bool,
}

#[derive(Debug, Clone, Copy, PartialEq)]
enum LegendAt {
    Right,
    Left,
    Top,
    Bottom,
}

#[derive(Debug, Clone, PartialEq)]
struct Chart {
    title: Option<String>,
    kind: Kind,
    series: Vec<Series>,
    categories: Vec<String>,
    legend: Option<LegendAt>,
    show_values: bool,
    show_percent: bool,
    text_pt: f64,
    text_color: Rgba,
}

/// The chart part, drawn into a frame `width` × `height` EMU. None when the
/// part holds no chart that can be read.
pub fn draw(xml_text: &str, palette: &Palette, width: f64, height: f64) -> Option<Vec<Item>> {
    let document = Document::parse(xml_text).ok()?;
    let chart = read(document.root_element(), palette)?;
    Some(layout(&chart, width, height))
}

// --- Reading ---------------------------------------------------------------

fn c_child<'a, 'i>(node: Node<'a, 'i>, name: &str) -> Option<Node<'a, 'i>> {
    xml::child(node, C, name)
}

fn val<'a>(node: Node<'a, '_>, name: &str) -> Option<&'a str> {
    c_child(node, name).and_then(|child| child.attribute("val"))
}

fn on(node: Node, name: &str) -> bool {
    c_child(node, name).is_some_and(|child| !matches!(child.attribute("val"), Some("0" | "false")))
}

/// The cached points of a reference or literal: `c:strRef`, `c:numRef`,
/// `c:strLit`, `c:numLit`, or a multi-level category's last level.
fn points(holder: Node) -> Vec<(usize, String)> {
    let cache = holder.descendants().find(|node| {
        node.tag_name().namespace() == Some(C)
            && matches!(
                node.tag_name().name(),
                "strCache" | "numCache" | "strLit" | "numLit" | "lvl"
            )
    });
    let Some(cache) = cache else {
        return Vec::new();
    };
    xml::children(cache, C, "pt")
        .filter_map(|pt| {
            let index = pt.attribute("idx")?.parse().ok()?;
            let text = c_child(pt, "v")?.text().unwrap_or("").to_string();
            Some((index, text))
        })
        .collect()
}

fn count(holder: Node) -> Option<usize> {
    holder
        .descendants()
        .find(|node| node.tag_name().namespace() == Some(C) && node.tag_name().name() == "ptCount")
        .and_then(|node| node.attribute("val"))
        .and_then(|value| value.parse().ok())
}

fn text_of(holder: Node) -> String {
    let rich: Vec<&str> = holder
        .descendants()
        .filter(|node| xml::is(*node, A, "t"))
        .filter_map(|node| node.text())
        .collect();
    if !rich.is_empty() {
        return rich.concat();
    }
    // A name written straight in: `<c:tx><c:v>Evening</c:v></c:tx>`.
    if let Some(direct) = c_child(holder, "v").and_then(|v| v.text()) {
        return direct.to_string();
    }
    points(holder)
        .into_iter()
        .map(|(_, text)| text)
        .collect::<Vec<_>>()
        .join(" ")
}

/// The colour a series or point is filled (or, for a line, drawn) with.
fn own_color(holder: Node, palette: &Palette, prefer_line: bool) -> Option<Rgba> {
    let properties = c_child(holder, "spPr")?;
    let line = xml::child(properties, A, "ln").and_then(fill::fill_child);
    let area = fill::fill_child(properties);
    let pick =
        |node: Option<Node>| node.and_then(|node| fill::read(node, palette).representative());
    if prefer_line {
        pick(line).or_else(|| pick(area))
    } else {
        pick(area).or_else(|| pick(line))
    }
}

/// The theme's accent colours in turn, darker on each later round, as
/// PowerPoint picks a series' colour when it has none of its own.
fn accent(palette: &Palette, index: usize) -> Rgba {
    let base = palette
        .scheme_color(&format!("accent{}", index % 6 + 1))
        .unwrap_or(Rgba::opaque(0.27, 0.45, 0.77));
    let round = (index / 6) as f64;
    let shade = 1.0 - 0.25 * round.min(3.0);
    Rgba::opaque(base.r * shade, base.g * shade, base.b * shade)
}

fn grouping(node: Node) -> Grouping {
    match val(node, "grouping") {
        Some("stacked") => Grouping::Stacked,
        Some("percentStacked") => Grouping::Percent,
        _ => Grouping::Clustered,
    }
}

fn read(space: Node, palette: &Palette) -> Option<Chart> {
    let chart = c_child(space, "chart")?;
    let plot = c_child(chart, "plotArea")?;
    let kind_node = xml::elements(plot).find(|node| {
        node.tag_name().namespace() == Some(C) && node.tag_name().name().ends_with("Chart")
    })?;
    let kind_name = kind_node.tag_name().name();
    let kind = match kind_name {
        "lineChart" | "line3DChart" | "stockChart" => Kind::Line {
            grouping: grouping(kind_node),
            markers: !matches!(val(kind_node, "marker"), Some("0" | "false")),
        },
        "areaChart" | "area3DChart" => Kind::Area {
            grouping: grouping(kind_node),
        },
        "pieChart" | "pie3DChart" | "ofPieChart" => Kind::Pie {
            hole: 0.0,
            first_angle: val(kind_node, "firstSliceAng")
                .and_then(|v| v.parse().ok())
                .unwrap_or(0.0),
        },
        "doughnutChart" => Kind::Pie {
            hole: val(kind_node, "holeSize")
                .and_then(|v| v.parse::<f64>().ok())
                .unwrap_or(50.0)
                / 100.0,
            first_angle: val(kind_node, "firstSliceAng")
                .and_then(|v| v.parse().ok())
                .unwrap_or(0.0),
        },
        "scatterChart" | "bubbleChart" => Kind::Scatter {
            lines: val(kind_node, "scatterStyle")
                .is_some_and(|style| style.contains("line") || style.contains("smooth")),
        },
        _ => Kind::Bars {
            horizontal: val(kind_node, "barDir") == Some("bar"),
            grouping: grouping(kind_node),
            gap: val(kind_node, "gapWidth")
                .and_then(|v| v.parse::<f64>().ok())
                .unwrap_or(150.0)
                / 100.0,
            overlap: val(kind_node, "overlap")
                .and_then(|v| v.parse::<f64>().ok())
                .unwrap_or(0.0)
                / 100.0,
        },
    };
    let is_line = matches!(kind, Kind::Line { .. } | Kind::Scatter { .. });

    let mut categories: Vec<String> = Vec::new();
    let mut series = Vec::new();
    for (index, ser) in xml::children(kind_node, C, "ser").enumerate() {
        let order = val(ser, "order")
            .and_then(|v| v.parse::<usize>().ok())
            .unwrap_or(index);
        let name = c_child(ser, "tx")
            .map(text_of)
            .unwrap_or_else(|| format!("Series {}", index + 1));
        let values_node = c_child(ser, "val").or_else(|| c_child(ser, "yVal"));
        let total = values_node.and_then(count).unwrap_or(0);
        let mut values: Vec<Option<f64>> = vec![None; total];
        for (at, text) in values_node.map(points).unwrap_or_default() {
            if at >= values.len() {
                values.resize(at + 1, None);
            }
            values[at] = text.trim().parse().ok();
        }
        let x_values: Vec<f64> = c_child(ser, "xVal")
            .map(points)
            .unwrap_or_default()
            .into_iter()
            .map(|(_, text)| text.trim().parse().unwrap_or(0.0))
            .collect();
        if categories.is_empty() {
            if let Some(cat) = c_child(ser, "cat") {
                let mut names = vec![String::new(); count(cat).unwrap_or(0)];
                for (at, text) in points(cat) {
                    if at >= names.len() {
                        names.resize(at + 1, String::new());
                    }
                    names[at] = text;
                }
                categories = names;
            }
        }
        let point_colors = xml::children(ser, C, "dPt")
            .filter_map(|point| {
                let at = val(point, "idx")?.parse().ok()?;
                Some((at, own_color(point, palette, false)?))
            })
            .collect();
        let line_off = c_child(ser, "spPr")
            .and_then(|props| xml::child(props, A, "ln"))
            .is_some_and(|ln| xml::child(ln, A, "noFill").is_some());
        series.push((
            order,
            Series {
                name,
                values,
                x_values,
                color: own_color(ser, palette, is_line).unwrap_or_else(|| accent(palette, order)),
                point_colors,
                line_off,
            },
        ));
    }
    series.sort_by_key(|(order, _)| *order);
    let mut series: Vec<Series> = series.into_iter().map(|(_, series)| series).collect();
    // "Vary colours by point", a pie's default: each slice the next accent.
    let varies = c_child(kind_node, "varyColors")
        .is_none_or(|node| !matches!(node.attribute("val"), Some("0" | "false")));
    if matches!(kind, Kind::Pie { .. }) && varies {
        if let Some(first) = series.first_mut() {
            for at in 0..first.values.len() {
                if !first.point_colors.iter().any(|(index, _)| *index == at) {
                    first.point_colors.push((at, accent(palette, at)));
                }
            }
        }
    }
    if series.is_empty() {
        return None;
    }
    let longest = series.iter().map(|s| s.values.len()).max().unwrap_or(0);
    if categories.len() < longest {
        for at in categories.len()..longest {
            categories.push((at + 1).to_string());
        }
    }

    let title = if on(chart, "autoTitleDeleted") {
        None
    } else {
        match c_child(chart, "title") {
            Some(title) => {
                let text = c_child(title, "tx").map(text_of).unwrap_or_default();
                if text.trim().is_empty() {
                    // A title with no words of its own is the one series' name.
                    (series.len() == 1).then(|| series[0].name.clone())
                } else {
                    Some(text)
                }
            }
            None => None,
        }
    };
    let legend = c_child(chart, "legend").map(|legend| match val(legend, "legendPos") {
        Some("l") => LegendAt::Left,
        Some("t") => LegendAt::Top,
        Some("b") => LegendAt::Bottom,
        _ => LegendAt::Right,
    });
    let labels = c_child(kind_node, "dLbls");
    let show_values = labels.is_some_and(|labels| on(labels, "showVal"));
    let show_percent = labels.is_some_and(|labels| on(labels, "showPercent"));

    // The chart's own text size and colour, if it sets them.
    let default_run = space
        .descendants()
        .find(|node| xml::is(*node, A, "defRPr") && node.attribute("sz").is_some());
    let text_pt = default_run
        .and_then(|run| run.attribute("sz"))
        .and_then(|size| size.parse::<f64>().ok())
        .map_or(12.0, |size| size / 100.0);
    let text_color = default_run
        .and_then(fill::fill_child)
        .and_then(|node| fill::read(node, palette).representative())
        .or_else(|| palette.scheme_color("tx1"))
        .unwrap_or(Rgba::opaque(0.35, 0.35, 0.35));

    Some(Chart {
        title,
        kind,
        series,
        categories,
        legend,
        show_values,
        show_percent,
        text_pt,
        text_color,
    })
}

// --- Laying out --------------------------------------------------------------

/// Round numbers for an axis from `low` to `high`: its ends and step.
fn nice_axis(low: f64, high: f64) -> (f64, f64, f64) {
    let (low, high) = if (high - low).abs() < f64::EPSILON {
        if high == 0.0 {
            (0.0, 1.0)
        } else {
            (low.min(0.0), high.max(0.0) + high.abs() * 0.1)
        }
    } else {
        (low, high)
    };
    let span = high - low;
    let rough = span / 5.0;
    let magnitude = 10f64.powf(rough.log10().floor());
    let step = [1.0, 2.0, 2.5, 5.0, 10.0]
        .into_iter()
        .map(|factor| factor * magnitude)
        .find(|step| span / step <= 6.0)
        .unwrap_or(10.0 * magnitude);
    (
        (low / step).floor() * step,
        (high / step).ceil() * step,
        step,
    )
}

fn format_number(value: f64, step: f64, percent: bool) -> String {
    let decimals = if step >= 1.0 || step == 0.0 {
        0
    } else {
        (-step.log10().floor()) as usize
    };
    let text = format!("{value:.decimals$}");
    // Thousands separated, as PowerPoint's General format shows them.
    let (sign, rest) = text
        .strip_prefix('-')
        .map_or(("", text.as_str()), |rest| ("-", rest));
    let (whole, fraction) = rest
        .split_once('.')
        .map_or((rest, None), |(w, f)| (w, Some(f)));
    let mut grouped = String::new();
    for (index, digit) in whole.chars().enumerate() {
        if index > 0 && (whole.len() - index) % 3 == 0 {
            grouped.push(',');
        }
        grouped.push(digit);
    }
    let mut out = format!("{sign}{grouped}");
    if let Some(fraction) = fraction {
        out.push('.');
        out.push_str(fraction);
    }
    if percent {
        out.push('%');
    }
    out
}

fn text_width(text: &str, size_emu: f64) -> f64 {
    text.chars().count() as f64 * size_emu * 0.55
}

/// A label's left edge, moved so the label stays within the area across.
fn inside(x: f64, w: f64, area: Rect) -> f64 {
    x.min(area.x + area.w - w).max(area.x)
}

fn rect_path(x: f64, y: f64, w: f64, h: f64) -> Path {
    Path {
        cmds: vec![
            Cmd::M(x, y),
            Cmd::L(x + w, y),
            Cmd::L(x + w, y + h),
            Cmd::L(x, y + h),
            Cmd::Z,
        ],
        fill: true,
        stroke: false,
    }
}

/// A point on a circle, `angle` degrees clockwise from twelve o'clock.
fn on_circle(cx: f64, cy: f64, r: f64, angle: f64) -> (f64, f64) {
    let theta = angle.to_radians();
    (cx + r * theta.sin(), cy - r * theta.cos())
}

/// An arc as cubic curves, at most a quarter turn each, from `from` to `to`
/// degrees (either way round); the pen is already at its start.
fn arc(cmds: &mut Vec<Cmd>, cx: f64, cy: f64, r: f64, from: f64, to: f64) {
    let pieces = ((to - from).abs() / 90.0).ceil().max(1.0) as usize;
    let sweep = (to - from) / pieces as f64;
    for piece in 0..pieces {
        let a1 = from + sweep * piece as f64;
        let a2 = a1 + sweep;
        let k = 4.0 / 3.0 * (sweep.to_radians() / 4.0).tan();
        let (x1, y1) = on_circle(cx, cy, r, a1);
        let (x4, y4) = on_circle(cx, cy, r, a2);
        let (t1, t2) = (a1.to_radians(), a2.to_radians());
        let c1 = (x1 + k * r * t1.cos(), y1 + k * r * t1.sin());
        let c2 = (x4 - k * r * t2.cos(), y4 - k * r * t2.sin());
        cmds.push(Cmd::C(c1.0, c1.1, c2.0, c2.1, x4, y4));
    }
}

fn layout(chart: &Chart, width: f64, height: f64) -> Vec<Item> {
    let mut items = Vec::new();
    let size = chart.text_pt * EMU_PER_POINT;
    let line_h = size * 1.4;
    let pad = (width.min(height) * 0.03).max(size * 0.4);
    let mut area = Rect {
        x: pad,
        y: pad,
        w: width - 2.0 * pad,
        h: height - 2.0 * pad,
    };
    let text =
        |rect: Rect, text: String, size_pt: f64, bold: bool, align: &'static str| Item::Text {
            rect,
            text,
            size_pt,
            color: chart.text_color,
            bold,
            align,
        };

    // The title, across the top.
    if let Some(title) = &chart.title {
        let title_pt = chart.text_pt * 1.55;
        let h = title_pt * EMU_PER_POINT * 1.5;
        items.push(text(
            Rect {
                x: area.x,
                y: area.y,
                w: area.w,
                h,
            },
            title.clone(),
            title_pt,
            false,
            "center",
        ));
        area.y += h + pad * 0.5;
        area.h -= h + pad * 0.5;
    }

    // The legend: series, or a pie's categories.
    let is_pie = matches!(chart.kind, Kind::Pie { .. });
    let entries: Vec<(String, Rgba)> = if is_pie {
        let first = &chart.series[0];
        chart
            .categories
            .iter()
            .enumerate()
            .map(|(at, name)| (name.clone(), pie_color(first, at)))
            .collect()
    } else {
        chart
            .series
            .iter()
            .map(|s| (s.name.clone(), s.color))
            .collect()
    };
    if let Some(at) = chart.legend {
        let swatch = size * 0.75;
        let entry_w = |name: &str| swatch + size * 0.4 + text_width(name, size);
        match at {
            LegendAt::Right | LegendAt::Left => {
                let w = entries
                    .iter()
                    .map(|(name, _)| entry_w(name))
                    .fold(0.0, f64::max)
                    .min(area.w * 0.35);
                let total_h = entries.len() as f64 * line_h;
                let x = if at == LegendAt::Right {
                    area.x + area.w - w
                } else {
                    area.x
                };
                let mut y = area.y + (area.h - total_h).max(0.0) / 2.0;
                for (name, color) in &entries {
                    legend_entry(
                        &mut items, chart, x, y, w, line_h, swatch, size, name, *color,
                    );
                    y += line_h;
                }
                if at == LegendAt::Left {
                    area.x += w + pad;
                }
                area.w -= w + pad;
            }
            LegendAt::Top | LegendAt::Bottom => {
                let total_w: f64 = entries.iter().map(|(name, _)| entry_w(name) + size).sum();
                let y = if at == LegendAt::Bottom {
                    area.y + area.h - line_h
                } else {
                    area.y
                };
                let mut x = area.x + (area.w - total_w).max(0.0) / 2.0;
                for (name, color) in &entries {
                    let w = entry_w(name);
                    legend_entry(
                        &mut items, chart, x, y, w, line_h, swatch, size, name, *color,
                    );
                    x += w + size;
                }
                if at == LegendAt::Top {
                    area.y += line_h + pad * 0.5;
                }
                area.h -= line_h + pad * 0.5;
            }
        }
    }

    match chart.kind {
        Kind::Pie { hole, first_angle } => pie(&mut items, chart, area, hole, first_angle, size),
        Kind::Scatter { lines } => scatter(&mut items, chart, area, lines, size),
        _ => categorical(&mut items, chart, area, size),
    }
    items
}

fn pie_color(series: &Series, at: usize) -> Rgba {
    series
        .point_colors
        .iter()
        .find(|(index, _)| *index == at)
        .map(|(_, color)| *color)
        .unwrap_or_else(|| {
            // Slices take the accents in turn, as PowerPoint varies them.
            let base = series.color;
            let shades = [1.0, 0.75, 1.25, 0.55, 1.45, 0.85];
            let factor = shades[at % shades.len()];
            let mix = |c: f64| {
                if factor <= 1.0 {
                    c * factor
                } else {
                    c + (1.0 - c) * (factor - 1.0)
                }
            };
            if at == 0 {
                base
            } else {
                Rgba::opaque(mix(base.r), mix(base.g), mix(base.b))
            }
        })
}

#[allow(clippy::too_many_arguments)]
fn legend_entry(
    items: &mut Vec<Item>,
    chart: &Chart,
    x: f64,
    y: f64,
    w: f64,
    line_h: f64,
    swatch: f64,
    size: f64,
    name: &str,
    color: Rgba,
) {
    items.push(Item::Shape {
        rect: Rect {
            x,
            y: y + (line_h - swatch) / 2.0,
            w: swatch,
            h: swatch,
        },
        paths: vec![rect_path(0.0, 0.0, swatch, swatch)],
        fill: Some(color),
        line: None,
    });
    items.push(Item::Text {
        rect: Rect {
            x: x + swatch + size * 0.4,
            y,
            w: (w - swatch - size * 0.4).max(size),
            h: line_h,
        },
        text: name.to_string(),
        size_pt: chart.text_pt,
        color: chart.text_color,
        bold: false,
        align: "left",
    });
}

fn gridline_color() -> Rgba {
    Rgba::opaque(0.85, 0.85, 0.85)
}

/// Column, bar, line and area charts: categories along one axis, values
/// along the other.
fn categorical(items: &mut Vec<Item>, chart: &Chart, area: Rect, size: f64) {
    let (horizontal, grouping) = match chart.kind {
        Kind::Bars {
            horizontal,
            grouping,
            ..
        } => (horizontal, grouping),
        Kind::Line { grouping, .. } | Kind::Area { grouping } => (false, grouping),
        _ => (false, Grouping::Clustered),
    };
    let categories = chart.categories.len().max(1);
    let value =
        |series: &Series, at: usize| series.values.get(at).copied().flatten().unwrap_or(0.0);

    // The values' range, stacked where they stack.
    let mut low: f64 = 0.0;
    let mut high: f64 = 0.0;
    for at in 0..categories {
        let (mut up, mut down) = (0.0, 0.0);
        for series in &chart.series {
            let v = value(series, at);
            if grouping == Grouping::Clustered {
                high = high.max(v);
                low = low.min(v);
            } else if v >= 0.0 {
                up += v;
            } else {
                down += v;
            }
        }
        if grouping != Grouping::Clustered {
            high = high.max(up);
            low = low.min(down);
        }
    }
    let percent = grouping == Grouping::Percent;
    if percent {
        low = if low < 0.0 { -100.0 } else { 0.0 };
        high = 100.0;
    }
    let (axis_low, axis_high, step) = nice_axis(low, high);
    let labels: Vec<String> = {
        let mut out = Vec::new();
        let mut v = axis_low;
        while v <= axis_high + step * 0.001 {
            out.push(format_number(v, step, percent));
            v += step;
        }
        out
    };

    // Room for the axis labels.
    let value_label_w = labels
        .iter()
        .map(|l| text_width(l, size))
        .fold(0.0, f64::max)
        + size * 0.5;
    let category_label_w = chart
        .categories
        .iter()
        .map(|l| text_width(l, size))
        .fold(0.0, f64::max)
        + size * 0.5;
    let line_h = size * 1.4;
    let plot = if horizontal {
        let left = category_label_w.min(area.w * 0.35);
        Rect {
            x: area.x + left,
            y: area.y,
            w: area.w - left,
            h: area.h - line_h,
        }
    } else {
        Rect {
            x: area.x + value_label_w,
            y: area.y,
            w: area.w - value_label_w,
            h: area.h - line_h,
        }
    };
    if plot.w <= 0.0 || plot.h <= 0.0 {
        return;
    }
    let span = (axis_high - axis_low).max(f64::EPSILON);
    // Where a value sits along the value axis, from the plot's own origin.
    let along = |v: f64| {
        if horizontal {
            (v - axis_low) / span * plot.w
        } else {
            plot.h - (v - axis_low) / span * plot.h
        }
    };

    // Gridlines and the value labels.
    let mut grid = Vec::new();
    for (index, label) in labels.iter().enumerate() {
        let v = axis_low + step * index as f64;
        let at = along(v);
        if horizontal {
            grid.push(Path {
                cmds: vec![Cmd::M(at, 0.0), Cmd::L(at, plot.h)],
                fill: false,
                stroke: true,
            });
            let w = text_width(label, size) + size;
            items.push(Item::Text {
                rect: Rect {
                    x: inside(plot.x + at - w / 2.0, w, area),
                    y: plot.y + plot.h,
                    w,
                    h: line_h,
                },
                text: label.clone(),
                size_pt: chart.text_pt,
                color: chart.text_color,
                bold: false,
                align: "center",
            });
        } else {
            grid.push(Path {
                cmds: vec![Cmd::M(0.0, at), Cmd::L(plot.w, at)],
                fill: false,
                stroke: true,
            });
            items.push(Item::Text {
                rect: Rect {
                    x: area.x,
                    y: plot.y + at - line_h / 2.0,
                    w: value_label_w - size * 0.4,
                    h: line_h,
                },
                text: label.clone(),
                size_pt: chart.text_pt,
                color: chart.text_color,
                bold: false,
                align: "right",
            });
        }
    }
    items.push(Item::Shape {
        rect: plot,
        paths: grid,
        fill: None,
        line: Some(Outline {
            color: gridline_color(),
            width: 0.75 * EMU_PER_POINT,
        }),
    });

    // The category labels.
    let band = if horizontal { plot.h } else { plot.w } / categories as f64;
    for (at, name) in chart.categories.iter().enumerate() {
        let slot = if horizontal { categories - 1 - at } else { at };
        let centre = band * (slot as f64 + 0.5);
        let rect = if horizontal {
            Rect {
                x: area.x,
                y: plot.y + centre - line_h / 2.0,
                w: (plot.x - area.x - size * 0.4).max(size),
                h: line_h,
            }
        } else {
            Rect {
                x: plot.x + centre - band / 2.0,
                y: plot.y + plot.h,
                w: band,
                h: line_h,
            }
        };
        items.push(Item::Text {
            rect,
            text: name.clone(),
            size_pt: chart.text_pt,
            color: chart.text_color,
            bold: false,
            align: if horizontal { "right" } else { "center" },
        });
    }

    // Each category's totals, for 100% charts.
    let totals: Vec<f64> = (0..categories)
        .map(|at| {
            chart
                .series
                .iter()
                .map(|s| value(s, at).abs())
                .sum::<f64>()
                .max(f64::EPSILON)
        })
        .collect();
    let shown = |series: &Series, at: usize| {
        let v = value(series, at);
        if percent {
            v / totals[at] * 100.0
        } else {
            v
        }
    };

    match chart.kind {
        Kind::Bars { gap, overlap, .. } => {
            let count = chart.series.len() as f64;
            let stacked = grouping != Grouping::Clustered;
            let slots = if stacked {
                1.0
            } else {
                count - (count - 1.0) * overlap.max(0.0)
            };
            let bar = band / (slots + gap);
            let step_between = if stacked {
                0.0
            } else {
                bar * (1.0 - overlap.max(0.0))
            };
            let group = if stacked {
                bar
            } else {
                bar + step_between * (count - 1.0)
            };
            let mut up = vec![0.0; categories];
            let mut down = vec![0.0; categories];
            let zero = along(0.0_f64.clamp(axis_low, axis_high));
            for (index, series) in chart.series.iter().enumerate() {
                let mut paths = Vec::new();
                for at in 0..categories {
                    let v = shown(series, at);
                    let (from, to) = if stacked {
                        let base = if v >= 0.0 { &mut up[at] } else { &mut down[at] };
                        let start = *base;
                        *base += v;
                        (along(start), along(start + v))
                    } else {
                        (zero, along(v))
                    };
                    // A bar chart's first category is at the bottom, as PowerPoint draws it.
                    let slot = if horizontal { categories - 1 - at } else { at };
                    let offset =
                        band * slot as f64 + (band - group) / 2.0 + step_between * index as f64;
                    let (lo, hi) = (from.min(to), from.max(to));
                    paths.push(if horizontal {
                        rect_path(lo, offset, hi - lo, bar)
                    } else {
                        rect_path(offset, lo, bar, hi - lo)
                    });
                    if chart.show_values {
                        let label = format_number(v, step / 10.0, percent);
                        let w = text_width(&label, size) + size;
                        let rect = if horizontal {
                            Rect {
                                x: plot.x + hi + size * 0.2,
                                y: plot.y + offset + bar / 2.0 - line_h / 2.0,
                                w,
                                h: line_h,
                            }
                        } else {
                            Rect {
                                x: plot.x + offset + bar / 2.0 - w / 2.0,
                                y: plot.y + lo - line_h,
                                w,
                                h: line_h,
                            }
                        };
                        items.push(Item::Text {
                            rect,
                            text: label,
                            size_pt: chart.text_pt,
                            color: chart.text_color,
                            bold: false,
                            align: "center",
                        });
                    }
                }
                items.push(Item::Shape {
                    rect: plot,
                    paths,
                    fill: Some(series.color),
                    line: None,
                });
            }
        }
        Kind::Line { .. } | Kind::Area { .. } => {
            let is_area = matches!(chart.kind, Kind::Area { .. });
            let markers = matches!(chart.kind, Kind::Line { markers: true, .. });
            let mut running = vec![0.0; categories];
            // Later series in front, as PowerPoint draws them.
            let order: Vec<usize> = (0..chart.series.len()).collect();
            // Stacked areas and lines sit on the ones before them.
            let mut bases: Vec<Vec<f64>> = Vec::new();
            for series in &chart.series {
                let base = running.clone();
                if grouping != Grouping::Clustered {
                    for (at, total) in running.iter_mut().enumerate() {
                        *total += shown(series, at);
                    }
                }
                bases.push(base);
            }
            for index in order {
                let series = &chart.series[index];
                let point = |at: usize| {
                    let base = if grouping != Grouping::Clustered {
                        bases[index][at]
                    } else {
                        0.0
                    };
                    (band * (at as f64 + 0.5), along(base + shown(series, at)))
                };
                let mut cmds = Vec::new();
                for at in 0..categories {
                    let (x, y) = point(at);
                    cmds.push(if at == 0 { Cmd::M(x, y) } else { Cmd::L(x, y) });
                }
                if is_area {
                    for at in (0..categories).rev() {
                        let base = if grouping != Grouping::Clustered {
                            bases[index][at]
                        } else {
                            0.0
                        };
                        cmds.push(Cmd::L(band * (at as f64 + 0.5), along(base)));
                    }
                    cmds.push(Cmd::Z);
                    items.push(Item::Shape {
                        rect: plot,
                        paths: vec![Path {
                            cmds,
                            fill: true,
                            stroke: false,
                        }],
                        fill: Some(series.color),
                        line: None,
                    });
                } else {
                    let mut paths = vec![Path {
                        cmds,
                        fill: false,
                        stroke: true,
                    }];
                    if markers {
                        let r = size * 0.28;
                        for at in 0..categories {
                            let (x, y) = point(at);
                            let mut dot = vec![Cmd::M(x, y - r)];
                            arc(&mut dot, x, y, r, 0.0, 360.0);
                            dot.push(Cmd::Z);
                            paths.push(Path {
                                cmds: dot,
                                fill: true,
                                stroke: false,
                            });
                        }
                    }
                    items.push(Item::Shape {
                        rect: plot,
                        paths,
                        fill: Some(series.color),
                        line: Some(Outline {
                            color: series.color,
                            width: 2.25 * EMU_PER_POINT,
                        }),
                    });
                }
            }
        }
        _ => {}
    }

    // The category axis along the bottom (or left) of the plot.
    let zero = along(0.0_f64.clamp(axis_low, axis_high));
    let axis = if horizontal {
        Path {
            cmds: vec![Cmd::M(zero, 0.0), Cmd::L(zero, plot.h)],
            fill: false,
            stroke: true,
        }
    } else {
        Path {
            cmds: vec![Cmd::M(0.0, zero), Cmd::L(plot.w, zero)],
            fill: false,
            stroke: true,
        }
    };
    items.push(Item::Shape {
        rect: plot,
        paths: vec![axis],
        fill: None,
        line: Some(Outline {
            color: Rgba::opaque(0.75, 0.75, 0.75),
            width: 0.75 * EMU_PER_POINT,
        }),
    });
}

fn pie(items: &mut Vec<Item>, chart: &Chart, area: Rect, hole: f64, first_angle: f64, size: f64) {
    let series = &chart.series[0];
    let values: Vec<f64> = series
        .values
        .iter()
        .map(|v| v.unwrap_or(0.0).max(0.0))
        .collect();
    let total: f64 = values.iter().sum();
    if total <= 0.0 {
        return;
    }
    let r = area.w.min(area.h) / 2.0 * 0.95;
    let rect = Rect {
        x: area.x + area.w / 2.0 - r,
        y: area.y + area.h / 2.0 - r,
        w: 2.0 * r,
        h: 2.0 * r,
    };
    let (cx, cy) = (r, r);
    let inner = r * hole.clamp(0.0, 0.9);
    let mut angle = first_angle;
    for (at, v) in values.iter().enumerate() {
        if *v <= 0.0 {
            continue;
        }
        let sweep = v / total * 360.0;
        let end = angle + sweep;
        let mut cmds = Vec::new();
        if inner > 0.0 {
            let (sx, sy) = on_circle(cx, cy, r, angle);
            cmds.push(Cmd::M(sx, sy));
            arc(&mut cmds, cx, cy, r, angle, end);
            let (ix, iy) = on_circle(cx, cy, inner, end);
            cmds.push(Cmd::L(ix, iy));
            arc(&mut cmds, cx, cy, inner, end, angle);
        } else if sweep >= 359.999 {
            let (sx, sy) = on_circle(cx, cy, r, angle);
            cmds.push(Cmd::M(sx, sy));
            arc(&mut cmds, cx, cy, r, angle, end);
        } else {
            cmds.push(Cmd::M(cx, cy));
            let (sx, sy) = on_circle(cx, cy, r, angle);
            cmds.push(Cmd::L(sx, sy));
            arc(&mut cmds, cx, cy, r, angle, end);
        }
        cmds.push(Cmd::Z);
        items.push(Item::Shape {
            rect,
            paths: vec![Path {
                cmds,
                fill: true,
                stroke: true,
            }],
            fill: Some(pie_color(series, at)),
            line: Some(Outline {
                color: Rgba::WHITE,
                width: EMU_PER_POINT,
            }),
        });
        if chart.show_values || chart.show_percent {
            let label = if chart.show_percent {
                format!("{:.0}%", v / total * 100.0)
            } else {
                format_number(*v, 1.0, false)
            };
            let mid = angle + sweep / 2.0;
            let radius = if inner > 0.0 {
                (r + inner) / 2.0
            } else {
                r * 0.65
            };
            let (lx, ly) = on_circle(cx, cy, radius, mid);
            let w = text_width(&label, size) + size;
            let line_h = size * 1.4;
            items.push(Item::Text {
                rect: Rect {
                    x: rect.x + lx - w / 2.0,
                    y: rect.y + ly - line_h / 2.0,
                    w,
                    h: line_h,
                },
                text: label,
                size_pt: chart.text_pt,
                color: Rgba::WHITE,
                bold: false,
                align: "center",
            });
        }
        angle = end;
    }
}

fn scatter(items: &mut Vec<Item>, chart: &Chart, area: Rect, lines: bool, size: f64) {
    let xs: Vec<f64> = chart
        .series
        .iter()
        .flat_map(|s| {
            if s.x_values.is_empty() {
                (1..=s.values.len()).map(|i| i as f64).collect::<Vec<_>>()
            } else {
                s.x_values.clone()
            }
        })
        .collect();
    let ys: Vec<f64> = chart
        .series
        .iter()
        .flat_map(|s| s.values.iter().flatten().copied())
        .collect();
    if xs.is_empty() || ys.is_empty() {
        return;
    }
    let (x_low, x_high, x_step) = nice_axis(
        xs.iter().copied().fold(f64::INFINITY, f64::min).min(0.0),
        xs.iter().copied().fold(f64::NEG_INFINITY, f64::max),
    );
    let (y_low, y_high, y_step) = nice_axis(
        ys.iter().copied().fold(f64::INFINITY, f64::min).min(0.0),
        ys.iter().copied().fold(f64::NEG_INFINITY, f64::max),
    );
    let line_h = size * 1.4;
    let y_label_w = text_width(&format_number(y_high, y_step, false), size) + size * 0.5;
    let plot = Rect {
        x: area.x + y_label_w,
        y: area.y,
        w: area.w - y_label_w,
        h: area.h - line_h,
    };
    if plot.w <= 0.0 || plot.h <= 0.0 {
        return;
    }
    let px = |x: f64| (x - x_low) / (x_high - x_low).max(f64::EPSILON) * plot.w;
    let py = |y: f64| plot.h - (y - y_low) / (y_high - y_low).max(f64::EPSILON) * plot.h;
    let mut grid = Vec::new();
    let mut y = y_low;
    while y <= y_high + y_step * 0.001 {
        grid.push(Path {
            cmds: vec![Cmd::M(0.0, py(y)), Cmd::L(plot.w, py(y))],
            fill: false,
            stroke: true,
        });
        items.push(Item::Text {
            rect: Rect {
                x: area.x,
                y: plot.y + py(y) - line_h / 2.0,
                w: y_label_w - size * 0.4,
                h: line_h,
            },
            text: format_number(y, y_step, false),
            size_pt: chart.text_pt,
            color: chart.text_color,
            bold: false,
            align: "right",
        });
        y += y_step;
    }
    let mut x = x_low;
    while x <= x_high + x_step * 0.001 {
        let label = format_number(x, x_step, false);
        let w = text_width(&label, size) + size;
        items.push(Item::Text {
            rect: Rect {
                x: inside(plot.x + px(x) - w / 2.0, w, area),
                y: plot.y + plot.h,
                w,
                h: line_h,
            },
            text: label,
            size_pt: chart.text_pt,
            color: chart.text_color,
            bold: false,
            align: "center",
        });
        x += x_step;
    }
    items.push(Item::Shape {
        rect: plot,
        paths: grid,
        fill: None,
        line: Some(Outline {
            color: gridline_color(),
            width: 0.75 * EMU_PER_POINT,
        }),
    });
    for series in &chart.series {
        let points: Vec<(f64, f64)> = series
            .values
            .iter()
            .enumerate()
            .filter_map(|(at, v)| {
                let x = series.x_values.get(at).copied().unwrap_or((at + 1) as f64);
                v.map(|y| (px(x), py(y)))
            })
            .collect();
        let mut paths = Vec::new();
        if lines && !series.line_off && points.len() > 1 {
            let cmds = points
                .iter()
                .enumerate()
                .map(|(i, (x, y))| {
                    if i == 0 {
                        Cmd::M(*x, *y)
                    } else {
                        Cmd::L(*x, *y)
                    }
                })
                .collect();
            paths.push(Path {
                cmds,
                fill: false,
                stroke: true,
            });
        }
        let r = size * 0.3;
        for (x, y) in &points {
            let mut dot = vec![Cmd::M(*x, y - r)];
            arc(&mut dot, *x, *y, r, 0.0, 360.0);
            dot.push(Cmd::Z);
            paths.push(Path {
                cmds: dot,
                fill: true,
                stroke: false,
            });
        }
        items.push(Item::Shape {
            rect: plot,
            paths,
            fill: Some(series.color),
            line: Some(Outline {
                color: series.color,
                width: 2.0 * EMU_PER_POINT,
            }),
        });
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap;

    fn palette() -> Palette {
        let mut scheme = HashMap::new();
        scheme.insert("accent1".to_string(), Rgba::opaque(1.0, 0.0, 0.0));
        scheme.insert("accent2".to_string(), Rgba::opaque(0.0, 0.0, 1.0));
        scheme.insert("tx1".to_string(), Rgba::BLACK);
        Palette {
            scheme,
            map: HashMap::new(),
            placeholder: None,
        }
    }

    fn chart_xml(kind: &str, extra: &str) -> String {
        format!(
            r#"<c:chartSpace xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
              <c:chart>
                <c:title><c:tx><c:rich><a:p><a:r><a:t>Attendance</a:t></a:r></a:p></c:rich></c:tx></c:title>
                <c:plotArea><c:{kind}>{extra}
                  <c:ser><c:idx val="0"/><c:order val="0"/>
                    <c:tx><c:strRef><c:strCache><c:ptCount val="1"/><c:pt idx="0"><c:v>Morning</c:v></c:pt></c:strCache></c:strRef></c:tx>
                    <c:cat><c:strRef><c:strCache><c:ptCount val="3"/><c:pt idx="0"><c:v>Jan</c:v></c:pt><c:pt idx="1"><c:v>Feb</c:v></c:pt><c:pt idx="2"><c:v>Mar</c:v></c:pt></c:strCache></c:strRef></c:cat>
                    <c:val><c:numRef><c:numCache><c:ptCount val="3"/><c:pt idx="0"><c:v>120</c:v></c:pt><c:pt idx="1"><c:v>150</c:v></c:pt><c:pt idx="2"><c:v>90</c:v></c:pt></c:numCache></c:numRef></c:val>
                  </c:ser>
                  <c:ser><c:idx val="1"/><c:order val="1"/>
                    <c:tx><c:v>Evening</c:v></c:tx>
                    <c:val><c:numRef><c:numCache><c:ptCount val="3"/><c:pt idx="0"><c:v>80</c:v></c:pt><c:pt idx="1"><c:v>60</c:v></c:pt><c:pt idx="2"><c:v>100</c:v></c:pt></c:numCache></c:numRef></c:val>
                  </c:ser>
                </c:{kind}></c:plotArea>
                <c:legend><c:legendPos val="b"/></c:legend>
              </c:chart>
            </c:chartSpace>"#
        )
    }

    fn texts(items: &[Item]) -> Vec<String> {
        items
            .iter()
            .filter_map(|item| match item {
                Item::Text { text, .. } => Some(text.clone()),
                _ => None,
            })
            .collect()
    }

    #[test]
    fn a_column_chart_reads_its_series_and_draws_one_shape_each() {
        let xml = chart_xml(
            "barChart",
            r#"<c:barDir val="col"/><c:grouping val="clustered"/>"#,
        );
        let document = Document::parse(&xml).unwrap();
        let chart = read(document.root_element(), &palette()).unwrap();
        assert_eq!(chart.title.as_deref(), Some("Attendance"));
        assert_eq!(chart.categories, vec!["Jan", "Feb", "Mar"]);
        assert_eq!(
            chart.series[0].values,
            vec![Some(120.0), Some(150.0), Some(90.0)]
        );
        assert_eq!(chart.series[1].name, "Evening");
        assert_eq!(
            chart.series[0].color,
            Rgba::opaque(1.0, 0.0, 0.0),
            "the first accent"
        );
        assert_eq!(chart.legend, Some(LegendAt::Bottom));

        let items = draw(&xml, &palette(), 6_000_000.0, 4_000_000.0).unwrap();
        let words = texts(&items);
        for expected in [
            "Attendance",
            "Jan",
            "Feb",
            "Mar",
            "Morning",
            "Evening",
            "0",
            "150",
        ] {
            assert!(
                words.iter().any(|w| w == expected),
                "{expected} in {words:?}"
            );
        }
        let filled: Vec<_> = items
            .iter()
            .filter(
                |item| matches!(item, Item::Shape { fill: Some(_), paths, .. } if paths.len() == 3),
            )
            .collect();
        assert_eq!(filled.len(), 2, "a shape of three bars for each series");
    }

    #[test]
    fn every_item_stays_inside_the_frame() {
        for (kind, extra) in [
            (
                "barChart",
                r#"<c:barDir val="bar"/><c:grouping val="stacked"/><c:overlap val="100"/>"#,
            ),
            (
                "barChart",
                r#"<c:barDir val="col"/><c:grouping val="percentStacked"/>"#,
            ),
            ("lineChart", r#"<c:grouping val="standard"/>"#),
            ("areaChart", r#"<c:grouping val="stacked"/>"#),
            ("pieChart", ""),
            ("doughnutChart", r#"<c:holeSize val="60"/>"#),
            ("scatterChart", r#"<c:scatterStyle val="lineMarker"/>"#),
        ] {
            let (w, h) = (6_000_000.0, 4_000_000.0);
            let items = draw(&chart_xml(kind, extra), &palette(), w, h)
                .unwrap_or_else(|| panic!("{kind} drawn"));
            assert!(!items.is_empty(), "{kind}");
            for item in &items {
                let rect = match item {
                    Item::Shape { rect, .. } | Item::Text { rect, .. } => rect,
                };
                assert!(rect.x >= -1.0 && rect.y >= -1.0, "{kind}: {rect:?}");
                assert!(
                    rect.x + rect.w <= w + 1.0 && rect.y + rect.h <= h + 1.0,
                    "{kind}: {rect:?} {item:?}"
                );
            }
        }
    }

    #[test]
    fn a_pie_has_a_slice_for_each_value_in_its_own_colour() {
        let items = draw(
            &chart_xml("pieChart", ""),
            &palette(),
            4_000_000.0,
            4_000_000.0,
        )
        .unwrap();
        let slices: Vec<Rgba> = items
            .iter()
            .filter_map(|item| match item {
                Item::Shape {
                    fill: Some(color),
                    line: Some(_),
                    ..
                } => Some(*color),
                _ => None,
            })
            .collect();
        assert_eq!(slices.len(), 3);
        assert_ne!(slices[0], slices[1]);
    }

    #[test]
    fn axis_numbers_are_round_and_grouped() {
        assert_eq!(nice_axis(0.0, 150.0), (0.0, 150.0, 25.0));
        assert_eq!(nice_axis(0.0, 870.0), (0.0, 1000.0, 200.0));
        assert_eq!(format_number(12500.0, 2500.0, false), "12,500");
        assert_eq!(format_number(0.25, 0.05, true), "0.25%");
        assert_eq!(format_number(-1500.0, 500.0, false), "-1,500");
    }
}
