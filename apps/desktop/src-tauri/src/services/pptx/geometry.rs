//! A shape's outline: DrawingML geometry, turned into paths.
//!
//! Custom geometry (`a:custGeom`, which Canva draws everything with) and the
//! preset shapes are the same language: adjust values, guides computed from
//! them by formulas, and paths of moves, lines, arcs and curves in a path
//! space scaled onto the shape. The presets below are written in that
//! language too, so one evaluator draws both.
//!
//! Angles are in 60,000ths of a degree. An arc's angles are *visual* — the
//! direction from the centre — not the ellipse's parameter, which is why an
//! arc on an ellipse is converted before it is drawn.
//!
//! The output is SVG path data (`M L C Q Z`, absolute) in the shape's own
//! pixels, from its top-left: both renderers read it.

use std::collections::HashMap;
use std::f64::consts::PI;
use std::fmt::Write as _;

use roxmltree::Node;

use super::xml::{self, A};

/// One path of a shape, ready to draw.
#[derive(Debug, Clone, PartialEq)]
pub struct ShapePath {
    pub d: String,
    pub fill: bool,
    pub stroke: bool,
}

/// A geometry definition: adjust values, guides, paths.
#[derive(Debug, Clone, Default)]
struct Definition {
    adjusts: Vec<(String, String)>,
    guides: Vec<(String, String)>,
    paths: Vec<PathDef>,
}

#[derive(Debug, Clone)]
struct PathDef {
    /// The path's own coordinate space; `None` for the shape's.
    width: Option<f64>,
    height: Option<f64>,
    fill: bool,
    stroke: bool,
    commands: Vec<Command>,
}

#[derive(Debug, Clone)]
enum Command {
    Move(String, String),
    Line(String, String),
    Arc(String, String, String, String),
    Quad([(String, String); 2]),
    Cubic([(String, String); 3]),
    Close,
}

/// The paths of the geometry in `sp_pr` (its `prstGeom` or `custGeom`), for a
/// shape `width` by `height` EMU drawn at `scale` pixels per EMU. `None` when
/// the shape names no geometry.
pub fn paths_of(sp_pr: Node, width: f64, height: f64, scale: f64) -> Option<Vec<ShapePath>> {
    if let Some(custom) = xml::child(sp_pr, A, "custGeom") {
        return Some(evaluate(
            &read_custom(custom),
            &overrides(None),
            width,
            height,
            scale,
        ));
    }
    let preset = xml::child(sp_pr, A, "prstGeom")?;
    let name = preset.attribute("prst").unwrap_or("rect");
    Some(preset_paths(name, Some(preset), width, height, scale))
}

/// A preset by name, with any adjust values `prst_geom` overrides. An unknown
/// preset is drawn as its rectangle rather than not at all.
pub fn preset_paths(
    name: &str,
    prst_geom: Option<Node>,
    width: f64,
    height: f64,
    scale: f64,
) -> Vec<ShapePath> {
    let source = PRESETS
        .iter()
        .find(|(preset, _)| *preset == name)
        .map(|(_, source)| *source)
        .unwrap_or_else(|| {
            tracing::debug!(preset = name, "a preset shape drawn as its rectangle");
            RECT
        });
    let definition = parse_preset(source);
    evaluate(&definition, &overrides(prst_geom), width, height, scale)
}

/// The rectangle a shape with no geometry is.
pub fn rectangle(width: f64, height: f64, scale: f64) -> Vec<ShapePath> {
    preset_paths("rect", None, width, height, scale)
}

/// `a:avLst` overrides in a `prstGeom` or `custGeom`.
fn overrides(geometry: Option<Node>) -> HashMap<String, String> {
    geometry
        .and_then(|node| xml::child(node, A, "avLst"))
        .map(|list| {
            xml::children(list, A, "gd")
                .filter_map(|gd| {
                    Some((
                        gd.attribute("name")?.to_owned(),
                        gd.attribute("fmla")?.to_owned(),
                    ))
                })
                .collect()
        })
        .unwrap_or_default()
}

fn read_custom(custom: Node) -> Definition {
    let guides = |list: &str| -> Vec<(String, String)> {
        xml::child(custom, A, list)
            .map(|list| {
                xml::children(list, A, "gd")
                    .filter_map(|gd| {
                        Some((
                            gd.attribute("name")?.to_owned(),
                            gd.attribute("fmla")?.to_owned(),
                        ))
                    })
                    .collect()
            })
            .unwrap_or_default()
    };
    let point = |node: Node| -> Option<(String, String)> {
        let pt = xml::child(node, A, "pt")?;
        Some((pt.attribute("x")?.to_owned(), pt.attribute("y")?.to_owned()))
    };
    let points = |node: Node| -> Vec<(String, String)> {
        xml::children(node, A, "pt")
            .filter_map(|pt| Some((pt.attribute("x")?.to_owned(), pt.attribute("y")?.to_owned())))
            .collect()
    };
    let paths = xml::child(custom, A, "pathLst")
        .map(|list| {
            xml::children(list, A, "path")
                .map(|path| {
                    let mut commands = Vec::new();
                    for command in xml::elements(path) {
                        match command.tag_name().name() {
                            "moveTo" => {
                                if let Some((x, y)) = point(command) {
                                    commands.push(Command::Move(x, y));
                                }
                            }
                            "lnTo" => {
                                if let Some((x, y)) = point(command) {
                                    commands.push(Command::Line(x, y));
                                }
                            }
                            "arcTo" => commands.push(Command::Arc(
                                command.attribute("wR").unwrap_or("0").to_owned(),
                                command.attribute("hR").unwrap_or("0").to_owned(),
                                command.attribute("stAng").unwrap_or("0").to_owned(),
                                command.attribute("swAng").unwrap_or("0").to_owned(),
                            )),
                            "quadBezTo" => {
                                let pts = points(command);
                                if let [a, b] = pts.as_slice() {
                                    commands.push(Command::Quad([a.clone(), b.clone()]));
                                }
                            }
                            "cubicBezTo" => {
                                let pts = points(command);
                                if let [a, b, c] = pts.as_slice() {
                                    commands.push(Command::Cubic([
                                        a.clone(),
                                        b.clone(),
                                        c.clone(),
                                    ]));
                                }
                            }
                            "close" => commands.push(Command::Close),
                            _ => {}
                        }
                    }
                    PathDef {
                        width: xml::float(path, "w").filter(|w| *w > 0.0),
                        height: xml::float(path, "h").filter(|h| *h > 0.0),
                        fill: path.attribute("fill") != Some("none"),
                        stroke: xml::flag(path, "stroke").unwrap_or(true),
                        commands,
                    }
                })
                .collect()
        })
        .unwrap_or_default();
    Definition {
        adjusts: guides("avLst"),
        guides: guides("gdLst"),
        paths,
    }
}

/// The guide values for a shape `w` by `h`: the built-ins, then adjusts (with
/// the shape's overrides), then the guides in order.
fn guide_values(
    definition: &Definition,
    adjust_overrides: &HashMap<String, String>,
    w: f64,
    h: f64,
) -> HashMap<String, f64> {
    let mut values = HashMap::new();
    let ss = w.min(h);
    let ls = w.max(h);
    for (name, value) in [
        ("w", w),
        ("h", h),
        ("l", 0.0),
        ("t", 0.0),
        ("r", w),
        ("b", h),
        ("hc", w / 2.0),
        ("vc", h / 2.0),
        ("ss", ss),
        ("ls", ls),
        ("cd2", 10_800_000.0),
        ("cd4", 5_400_000.0),
        ("cd8", 2_700_000.0),
        ("3cd4", 16_200_000.0),
        ("3cd8", 8_100_000.0),
        ("5cd8", 13_500_000.0),
        ("7cd8", 18_900_000.0),
    ] {
        values.insert(name.to_owned(), value);
    }
    for divisor in [2.0, 3.0, 4.0, 5.0, 6.0, 8.0, 10.0, 12.0, 16.0, 32.0] {
        values.insert(format!("wd{divisor}"), w / divisor);
        values.insert(format!("hd{divisor}"), h / divisor);
        values.insert(format!("ssd{divisor}"), ss / divisor);
    }
    for (name, formula) in &definition.adjusts {
        let formula = adjust_overrides.get(name).unwrap_or(formula);
        let value = formula_value(formula, &values);
        values.insert(name.clone(), value);
    }
    for (name, formula) in &definition.guides {
        let value = formula_value(formula, &values);
        values.insert(name.clone(), value);
    }
    values
}

fn operand(token: &str, values: &HashMap<String, f64>) -> f64 {
    values
        .get(token)
        .copied()
        .or_else(|| token.parse::<f64>().ok())
        .unwrap_or(0.0)
}

/// One guide formula: an operator and up to three operands.
fn formula_value(formula: &str, values: &HashMap<String, f64>) -> f64 {
    let mut parts = formula.split_whitespace();
    let Some(op) = parts.next() else {
        return 0.0;
    };
    let args: Vec<f64> = parts.map(|token| operand(token, values)).collect();
    let arg = |index: usize| args.get(index).copied().unwrap_or(0.0);
    let (x, y, z) = (arg(0), arg(1), arg(2));
    let radians = |angle: f64| angle / 60_000.0 * PI / 180.0;
    let value = match op {
        "val" => x,
        "*/" => {
            if z == 0.0 {
                0.0
            } else {
                x * y / z
            }
        }
        "+-" => x + y - z,
        "+/" => {
            if z == 0.0 {
                0.0
            } else {
                (x + y) / z
            }
        }
        "?:" => {
            if x > 0.0 {
                y
            } else {
                z
            }
        }
        "abs" => x.abs(),
        "at2" => y.atan2(x) * 180.0 / PI * 60_000.0,
        "cat2" => x * z.atan2(y).cos(),
        "sat2" => x * z.atan2(y).sin(),
        "cos" => x * radians(y).cos(),
        "sin" => x * radians(y).sin(),
        "tan" => x * radians(y).tan(),
        "max" => x.max(y),
        "min" => x.min(y),
        "mod" => (x * x + y * y + z * z).sqrt(),
        "pin" => {
            if y < x {
                x
            } else if y > z {
                z
            } else {
                y
            }
        }
        "sqrt" => x.max(0.0).sqrt(),
        _ => operand(op, values),
    };
    if value.is_finite() {
        value
    } else {
        0.0
    }
}

fn evaluate(
    definition: &Definition,
    adjust_overrides: &HashMap<String, String>,
    width: f64,
    height: f64,
    scale: f64,
) -> Vec<ShapePath> {
    let values = guide_values(definition, adjust_overrides, width, height);
    let value = |token: &str| operand(token, &values);
    definition
        .paths
        .iter()
        .map(|path| {
            // Path space onto the shape, then EMU onto pixels.
            let sx = path.width.map_or(1.0, |w| width / w) * scale;
            let sy = path.height.map_or(1.0, |h| height / h) * scale;
            // Arc radii are in path units too.
            let mut d = String::new();
            let mut current = (0.0_f64, 0.0_f64);
            let mut start = current;
            for command in &path.commands {
                match command {
                    Command::Move(x, y) => {
                        current = (value(x) * sx, value(y) * sy);
                        start = current;
                        push(&mut d, 'M', &[current]);
                    }
                    Command::Line(x, y) => {
                        current = (value(x) * sx, value(y) * sy);
                        push(&mut d, 'L', &[current]);
                    }
                    Command::Arc(w_r, h_r, st, sw) => {
                        current = arc(
                            &mut d,
                            current,
                            value(w_r) * sx,
                            value(h_r) * sy,
                            value(st),
                            value(sw),
                        );
                    }
                    Command::Quad([a, b]) => {
                        let control = (value(&a.0) * sx, value(&a.1) * sy);
                        current = (value(&b.0) * sx, value(&b.1) * sy);
                        push(&mut d, 'Q', &[control, current]);
                    }
                    Command::Cubic([a, b, c]) => {
                        let first = (value(&a.0) * sx, value(&a.1) * sy);
                        let second = (value(&b.0) * sx, value(&b.1) * sy);
                        current = (value(&c.0) * sx, value(&c.1) * sy);
                        push(&mut d, 'C', &[first, second, current]);
                    }
                    Command::Close => {
                        d.push('Z');
                        current = start;
                    }
                }
            }
            ShapePath {
                d,
                fill: path.fill,
                stroke: path.stroke,
            }
        })
        .filter(|path| !path.d.is_empty())
        .collect()
}

fn push(d: &mut String, command: char, points: &[(f64, f64)]) {
    d.push(command);
    for (index, (x, y)) in points.iter().enumerate() {
        if index > 0 {
            d.push(' ');
        }
        let _ = write!(d, "{} {}", tidy(*x), tidy(*y));
    }
}

/// Two decimals is a hundredth of a pixel, and keeps the data small.
fn tidy(value: f64) -> f64 {
    let rounded = (value * 100.0).round() / 100.0;
    if rounded == 0.0 {
        0.0
    } else {
        rounded
    }
}

/// The ellipse parameter of the point at visual angle `angle` (radians).
fn parameter(angle: f64, w_r: f64, h_r: f64) -> f64 {
    (w_r * angle.sin()).atan2(h_r * angle.cos())
}

/// An `arcTo` from `from`, as cubic curves. Returns where it ends.
fn arc(d: &mut String, from: (f64, f64), w_r: f64, h_r: f64, start: f64, sweep: f64) -> (f64, f64) {
    let to_radians = |angle: f64| angle / 60_000.0 * PI / 180.0;
    let (start, sweep) = (to_radians(start), to_radians(sweep));
    if w_r.abs() < 1e-9 || h_r.abs() < 1e-9 || sweep.abs() < 1e-12 {
        return from;
    }
    let p_start = parameter(start, w_r, h_r);
    let mut p_sweep = if sweep.abs() >= 2.0 * PI - 1e-9 {
        sweep
    } else {
        let mut delta = parameter(start + sweep, w_r, h_r) - p_start;
        if sweep > 0.0 && delta < 0.0 {
            delta += 2.0 * PI;
        } else if sweep < 0.0 && delta > 0.0 {
            delta -= 2.0 * PI;
        }
        delta
    };
    if p_sweep.abs() < 1e-12 {
        p_sweep = sweep;
    }
    let centre = (from.0 - w_r * p_start.cos(), from.1 - h_r * p_start.sin());
    let segments = (p_sweep.abs() / (PI / 2.0)).ceil().max(1.0) as usize;
    let step = p_sweep / segments as f64;
    let mut end = from;
    for index in 0..segments {
        let a = p_start + step * index as f64;
        let b = a + step;
        let k = 4.0 / 3.0 * (step / 4.0).tan();
        let p0 = (centre.0 + w_r * a.cos(), centre.1 + h_r * a.sin());
        let p3 = (centre.0 + w_r * b.cos(), centre.1 + h_r * b.sin());
        let p1 = (p0.0 - k * w_r * a.sin(), p0.1 + k * h_r * a.cos());
        let p2 = (p3.0 + k * w_r * b.sin(), p3.1 - k * h_r * b.cos());
        push(d, 'C', &[p1, p2, p3]);
        end = p3;
    }
    end
}

// --- The presets ----------------------------------------------------------------
//
// Written as presetShapeDefinitions.xml writes them, in a compact form:
// `av name formula`, `gd name formula`, then `path` lines (with `nofill` or
// `nostroke`, and `w=` `h=` for a path space) followed by `M x y`, `L x y`,
// `A wR hR stAng swAng`, `Q x1 y1 x y`, `C x1 y1 x2 y2 x y` and `Z`.

fn parse_preset(source: &str) -> Definition {
    let mut definition = Definition::default();
    for line in source
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty())
    {
        let mut words = line.split_whitespace();
        let Some(head) = words.next() else {
            continue;
        };
        let rest: Vec<&str> = words.collect();
        let owned = |index: usize| rest.get(index).copied().unwrap_or("0").to_owned();
        let pair = |index: usize| (owned(index), owned(index + 1));
        match head {
            "av" if !rest.is_empty() => definition.adjusts.push((owned(0), rest[1..].join(" "))),
            "gd" if !rest.is_empty() => definition.guides.push((owned(0), rest[1..].join(" "))),
            "path" => {
                let attribute = |key: &str| {
                    rest.iter()
                        .find_map(|word| word.strip_prefix(key))
                        .and_then(|value| value.parse::<f64>().ok())
                };
                definition.paths.push(PathDef {
                    width: attribute("w="),
                    height: attribute("h="),
                    fill: !rest.contains(&"nofill"),
                    stroke: !rest.contains(&"nostroke"),
                    commands: Vec::new(),
                });
            }
            command => {
                let Some(path) = definition.paths.last_mut() else {
                    continue;
                };
                path.commands.push(match command {
                    "M" => Command::Move(owned(0), owned(1)),
                    "L" => Command::Line(owned(0), owned(1)),
                    "A" => Command::Arc(owned(0), owned(1), owned(2), owned(3)),
                    "Q" => Command::Quad([pair(0), pair(2)]),
                    "C" => Command::Cubic([pair(0), pair(2), pair(4)]),
                    "Z" => Command::Close,
                    _ => continue,
                });
            }
        }
    }
    definition
}

const RECT: &str = "
path
M l t
L r t
L r b
L l b
Z";

const PRESETS: &[(&str, &str)] = &[
    ("rect", RECT),
    ("flowChartProcess", RECT),
    (
        "roundRect",
        "
av adj 16667
gd a pin 0 adj 50000
gd x1 */ ss a 100000
gd x2 +- r 0 x1
gd y2 +- b 0 x1
path
M l x1
A x1 x1 cd2 cd4
L x2 t
A x1 x1 3cd4 cd4
L r y2
A x1 x1 0 cd4
L x1 b
A x1 x1 cd4 cd4
Z",
    ),
    (
        "flowChartAlternateProcess",
        "
gd x1 */ ss 1 6
gd x2 +- r 0 x1
gd y2 +- b 0 x1
path
M l x1
A x1 x1 cd2 cd4
L x2 t
A x1 x1 3cd4 cd4
L r y2
A x1 x1 0 cd4
L x1 b
A x1 x1 cd4 cd4
Z",
    ),
    (
        "ellipse",
        "
path
M l vc
A wd2 hd2 cd2 cd4
A wd2 hd2 3cd4 cd4
A wd2 hd2 0 cd4
A wd2 hd2 cd4 cd4
Z",
    ),
    (
        "flowChartConnector",
        "
path
M l vc
A wd2 hd2 cd2 cd4
A wd2 hd2 3cd4 cd4
A wd2 hd2 0 cd4
A wd2 hd2 cd4 cd4
Z",
    ),
    (
        "line",
        "
path nofill
M l t
L r b",
    ),
    (
        "straightConnector1",
        "
path nofill
M l t
L r b",
    ),
    (
        "bentConnector2",
        "
path nofill
M l t
L r t
L r b",
    ),
    (
        "bentConnector3",
        "
av adj1 50000
gd x1 */ w adj1 100000
path nofill
M l t
L x1 t
L x1 b
L r b",
    ),
    (
        "curvedConnector3",
        "
av adj1 50000
gd x2 */ w adj1 100000
gd x1 +/ l x2 2
gd x3 +/ r x2 2
gd y3 */ h 3 4
path nofill
M l t
C x1 t x2 hd4 x2 vc
C x2 y3 x3 b r b",
    ),
    (
        "round2DiagRect",
        "
av adj1 16667
av adj2 0
gd a1 pin 0 adj1 50000
gd a2 pin 0 adj2 50000
gd x1 */ ss a1 100000
gd y1 +- b 0 x1
gd a ?: a1 0 0
gd dx2 */ ss a2 100000
gd x3 +- r 0 dx2
gd y3 +- b 0 dx2
gd x4 +- r 0 x1
path
M x1 t
L x3 t
A dx2 dx2 3cd4 cd4
L r y1
A x1 x1 0 cd4
L dx2 b
A dx2 dx2 cd4 cd4
L l x1
A x1 x1 cd2 cd4
Z",
    ),
    (
        "round2SameRect",
        "
av adj1 16667
av adj2 0
gd a1 pin 0 adj1 50000
gd a2 pin 0 adj2 50000
gd tx1 */ ss a1 100000
gd tx2 +- r 0 tx1
gd bx1 */ ss a2 100000
gd bx2 +- r 0 bx1
gd by1 +- b 0 bx1
path
M tx1 t
L tx2 t
A tx1 tx1 3cd4 cd4
L r by1
A bx1 bx1 0 cd4
L bx1 b
A bx1 bx1 cd4 cd4
L l tx1
A tx1 tx1 cd2 cd4
Z",
    ),
    (
        "round1Rect",
        "
av adj 16667
gd a pin 0 adj 50000
gd dx1 */ ss a 100000
gd x1 +- r 0 dx1
path
M l t
L x1 t
A dx1 dx1 3cd4 cd4
L r b
L l b
Z",
    ),
    (
        "snip1Rect",
        "
av adj 16667
gd a pin 0 adj 50000
gd dx1 */ ss a 100000
gd x1 +- r 0 dx1
path
M l t
L x1 t
L r dx1
L r b
L l b
Z",
    ),
    (
        "snip2SameRect",
        "
av adj1 16667
av adj2 0
gd a1 pin 0 adj1 50000
gd a2 pin 0 adj2 50000
gd tx1 */ ss a1 100000
gd tx2 +- r 0 tx1
gd bx1 */ ss a2 100000
gd bx2 +- r 0 bx1
gd by1 +- b 0 bx1
path
M tx1 t
L tx2 t
L r tx1
L r by1
L bx2 b
L bx1 b
L l by1
L l tx1
Z",
    ),
    (
        "flowChartTerminator",
        "
path w=21600 h=21600
M 3475 0
L 18125 0
A 3475 10800 3cd4 cd2
L 3475 21600
A 3475 10800 cd4 cd2
Z",
    ),
    (
        "triangle",
        "
av adj 50000
gd a pin 0 adj 100000
gd x1 */ w a 100000
path
M l b
L x1 t
L r b
Z",
    ),
    (
        "rtTriangle",
        "
path
M l b
L l t
L r b
Z",
    ),
    (
        "diamond",
        "
path
M l vc
L hc t
L r vc
L hc b
Z",
    ),
    (
        "flowChartDecision",
        "
path
M l vc
L hc t
L r vc
L hc b
Z",
    ),
    (
        "parallelogram",
        "
av adj 25000
gd maxAdj */ 100000 w ss
gd a pin 0 adj maxAdj
gd x2 */ ss a 100000
gd x5 +- r 0 x2
path
M l b
L x2 t
L r t
L x5 b
Z",
    ),
    (
        "trapezoid",
        "
av adj 25000
gd maxAdj */ 50000 w ss
gd a pin 0 adj maxAdj
gd x2 */ ss a 100000
gd x3 +- r 0 x2
path
M l b
L x2 t
L x3 t
L r b
Z",
    ),
    (
        "pentagon",
        "
gd y1 */ h 38197 100000
gd x1 */ w 19098 100000
gd x2 */ w 80902 100000
path
M l y1
L hc t
L r y1
L x2 b
L x1 b
Z",
    ),
    (
        "hexagon",
        "
av adj 25000
gd maxAdj */ 50000 w ss
gd a pin 0 adj maxAdj
gd x1 */ ss a 100000
gd x2 +- r 0 x1
path
M l vc
L x1 t
L x2 t
L r vc
L x2 b
L x1 b
Z",
    ),
    (
        "octagon",
        "
av adj 29289
gd a pin 0 adj 50000
gd x1 */ ss a 100000
gd x2 +- r 0 x1
gd y2 +- b 0 x1
path
M l x1
L x1 t
L x2 t
L r x1
L r y2
L x2 b
L x1 b
L l y2
Z",
    ),
    (
        "chevron",
        "
av adj 50000
gd maxAdj */ 100000 w ss
gd a pin 0 adj maxAdj
gd x1 */ ss a 100000
gd x2 +- r 0 x1
path
M l t
L x2 t
L r vc
L x2 b
L l b
L x1 vc
Z",
    ),
    (
        "homePlate",
        "
av adj 50000
gd maxAdj */ 100000 w ss
gd a pin 0 adj maxAdj
gd dx1 */ ss a 100000
gd x1 +- r 0 dx1
path
M l t
L x1 t
L r vc
L x1 b
L l b
Z",
    ),
    (
        "plus",
        "
av adj 25000
gd a pin 0 adj 50000
gd x1 */ ss a 100000
gd x2 +- r 0 x1
gd y2 +- b 0 x1
path
M l x1
L x1 x1
L x1 t
L x2 t
L x2 x1
L r x1
L r y2
L x2 y2
L x2 b
L x1 b
L x1 y2
L l y2
Z",
    ),
    (
        "rightArrow",
        "
av adj1 50000
av adj2 50000
gd maxAdj2 */ 100000 w ss
gd a1 pin 0 adj1 100000
gd a2 pin 0 adj2 maxAdj2
gd dy1 */ h a1 200000
gd y1 +- vc 0 dy1
gd y2 +- vc dy1 0
gd dx2 */ ss a2 100000
gd x2 +- r 0 dx2
path
M l y1
L x2 y1
L x2 t
L r vc
L x2 b
L x2 y2
L l y2
Z",
    ),
    (
        "leftArrow",
        "
av adj1 50000
av adj2 50000
gd maxAdj2 */ 100000 w ss
gd a1 pin 0 adj1 100000
gd a2 pin 0 adj2 maxAdj2
gd dy1 */ h a1 200000
gd y1 +- vc 0 dy1
gd y2 +- vc dy1 0
gd dx2 */ ss a2 100000
gd x2 +- l dx2 0
path
M l vc
L x2 t
L x2 y1
L r y1
L r y2
L x2 y2
L x2 b
Z",
    ),
    (
        "upArrow",
        "
av adj1 50000
av adj2 50000
gd maxAdj2 */ 100000 h ss
gd a1 pin 0 adj1 100000
gd a2 pin 0 adj2 maxAdj2
gd dx1 */ w a1 200000
gd x1 +- hc 0 dx1
gd x2 +- hc dx1 0
gd dy2 */ ss a2 100000
gd y2 +- t dy2 0
path
M l y2
L hc t
L r y2
L x2 y2
L x2 b
L x1 b
L x1 y2
Z",
    ),
    (
        "downArrow",
        "
av adj1 50000
av adj2 50000
gd maxAdj2 */ 100000 h ss
gd a1 pin 0 adj1 100000
gd a2 pin 0 adj2 maxAdj2
gd dx1 */ w a1 200000
gd x1 +- hc 0 dx1
gd x2 +- hc dx1 0
gd dy2 */ ss a2 100000
gd y2 +- b 0 dy2
path
M l y2
L x1 y2
L x1 t
L x2 t
L x2 y2
L r y2
L hc b
Z",
    ),
    (
        "arc",
        "
av adj1 16200000
av adj2 0
gd stAng pin 0 adj1 21599999
gd enAng pin 0 adj2 21599999
gd sw11 +- enAng 0 stAng
gd sw12 +- sw11 21600000 0
gd swAng ?: sw11 sw11 sw12
gd wt1 sin wd2 stAng
gd ht1 cos hd2 stAng
gd dx1 cat2 wd2 ht1 wt1
gd dy1 sat2 hd2 ht1 wt1
gd x1 +- hc dx1 0
gd y1 +- vc dy1 0
path nostroke
M x1 y1
A wd2 hd2 stAng swAng
L hc vc
Z
path nofill
M x1 y1
A wd2 hd2 stAng swAng",
    ),
    (
        "pie",
        "
av adj1 0
av adj2 16200000
gd stAng pin 0 adj1 21599999
gd enAng pin 0 adj2 21599999
gd sw1 +- enAng 0 stAng
gd sw2 +- sw1 21600000 0
gd swAng ?: sw1 sw1 sw2
gd wt1 sin wd2 stAng
gd ht1 cos hd2 stAng
gd dx1 cat2 wd2 ht1 wt1
gd dy1 sat2 hd2 ht1 wt1
gd x1 +- hc dx1 0
gd y1 +- vc dy1 0
path
M x1 y1
A wd2 hd2 stAng swAng
L hc vc
Z",
    ),
    (
        "donut",
        "
av adj 25000
gd a pin 0 adj 50000
gd dr */ ss a 100000
gd iwd2 +- wd2 0 dr
gd ihd2 +- hd2 0 dr
path
M l vc
A wd2 hd2 cd2 cd4
A wd2 hd2 3cd4 cd4
A wd2 hd2 0 cd4
A wd2 hd2 cd4 cd4
Z
M dr vc
A iwd2 ihd2 cd2 -5400000
A iwd2 ihd2 cd4 -5400000
A iwd2 ihd2 0 -5400000
A iwd2 ihd2 3cd4 -5400000
Z",
    ),
    (
        "frame",
        "
av adj1 12500
gd a1 pin 0 adj1 50000
gd x1 */ ss a1 100000
gd x4 +- r 0 x1
gd y4 +- b 0 x1
path
M l t
L r t
L r b
L l b
Z
M x1 x1
L x1 y4
L x4 y4
L x4 x1
Z",
    ),
];

#[cfg(test)]
mod tests {
    use super::*;

    fn numbers(d: &str) -> Vec<f64> {
        d.split(|c: char| c.is_ascii_alphabetic() || c == ' ')
            .filter(|token| !token.is_empty())
            .map(|token| token.parse().expect("number"))
            .collect()
    }

    #[test]
    fn a_rectangle_is_its_box() {
        let paths = preset_paths("rect", None, 100.0, 50.0, 1.0);
        assert_eq!(paths.len(), 1);
        assert_eq!(paths[0].d, "M0 0L100 0L100 50L0 50Z");
        assert!(paths[0].fill && paths[0].stroke);
    }

    #[test]
    fn an_ellipse_passes_through_the_middle_of_each_side() {
        let paths = preset_paths("ellipse", None, 200.0, 100.0, 1.0);
        let points = numbers(&paths[0].d);
        // It starts at the left middle, and each quarter ends on an axis.
        assert_eq!(&points[..2], &[0.0, 50.0]);
        assert!(paths[0].d.contains("100 0"), "{}", paths[0].d);
        assert!(paths[0].d.contains("200 50"), "{}", paths[0].d);
        assert!(paths[0].d.contains("100 100"), "{}", paths[0].d);
    }

    #[test]
    fn an_override_moves_a_rounded_corner() {
        let xml = format!(
            r#"<a:prstGeom xmlns:a="{A}" prst="roundRect"><a:avLst><a:gd name="adj" fmla="val 50000"/></a:avLst></a:prstGeom>"#
        );
        let document = roxmltree::Document::parse(&xml).expect("xml");
        let paths = preset_paths(
            "roundRect",
            Some(document.root_element()),
            100.0,
            100.0,
            1.0,
        );
        // Half the side: a circle, so the first straight edge has no length.
        assert!(paths[0].d.starts_with("M0 50"), "{}", paths[0].d);
    }

    #[test]
    fn custom_geometry_scales_its_path_space_onto_the_shape() {
        let xml = format!(
            r#"<p:spPr xmlns:a="{A}" xmlns:p="p"><a:custGeom><a:avLst/><a:gdLst/><a:pathLst>
                <a:path w="10" h="10"><a:moveTo><a:pt x="0" y="0"/></a:moveTo><a:lnTo><a:pt x="10" y="5"/></a:lnTo><a:close/></a:path>
            </a:pathLst></a:custGeom></p:spPr>"#
        );
        let document = roxmltree::Document::parse(&xml).expect("xml");
        let paths = paths_of(
            document.root_element(),
            9525.0 * 200.0,
            9525.0 * 100.0,
            1.0 / 9525.0,
        )
        .expect("paths");
        assert_eq!(paths[0].d, "M0 0L200 50Z");
    }

    #[test]
    fn guides_compute_in_order_with_every_operator() {
        let mut values = HashMap::new();
        values.insert("w".to_owned(), 200.0);
        assert_eq!(formula_value("*/ w 1 2", &values), 100.0);
        assert_eq!(formula_value("+- w 10 20", &values), 190.0);
        assert_eq!(formula_value("pin 0 300 100", &values), 100.0);
        assert_eq!(formula_value("?: -1 5 7", &values), 7.0);
        assert!((formula_value("at2 1 1", &values) - 2_700_000.0).abs() < 1e-6);
        assert!((formula_value("sin 10 5400000", &values) - 10.0).abs() < 1e-9);
        assert_eq!(formula_value("mod 3 4 0", &values), 5.0);
    }

    #[test]
    fn a_line_is_not_filled() {
        let paths = preset_paths("line", None, 100.0, 0.0, 1.0);
        assert!(!paths[0].fill);
        assert_eq!(paths[0].d, "M0 0L100 0");
    }

    #[test]
    fn an_unknown_preset_is_its_rectangle() {
        let paths = preset_paths("cloudCallout", None, 10.0, 10.0, 1.0);
        assert_eq!(paths[0].d, "M0 0L10 0L10 10L0 10Z");
    }
}
