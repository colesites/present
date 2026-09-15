//! `src/main/lib/pptx-payload.mjs` in Rust: the payload scaled onto a
//! 1920×1080 slide, as the renderer receives it.
//!
//! Built as JSON so a value JavaScript leaves `undefined` can be left out,
//! as `JSON.stringify` and structured cloning both do. The arithmetic is the
//! same double-precision operations in the same order.

use serde_json::{json, Map, Value};

use super::payload::{Background, Paragraph, Payload, Run, Shape, ShapeKind, TextBody};

pub const TARGET_SLIDE_WIDTH: f64 = 1920.0;
pub const TARGET_SLIDE_HEIGHT: f64 = 1080.0;

/// JavaScript's `String.prototype.trim`.
fn js_trim(value: &str) -> &str {
    value.trim_matches(|c: char| (c.is_whitespace() && c != '\u{85}') || c == '\u{feff}')
}

fn to_vertical_align(value: &str) -> &'static str {
    match value {
        "top" => "top",
        "bottom" => "bottom",
        _ => "middle",
    }
}

fn to_data_url(format: &str, data: &str) -> String {
    if data.is_empty() {
        return String::new();
    }
    let format = format.to_lowercase();
    let mime = if format == "jpg" {
        "jpeg".to_owned()
    } else {
        format
    };
    format!("data:image/{mime};base64,{data}")
}

fn plain_text(body: &TextBody) -> String {
    let joined = body
        .paragraphs
        .iter()
        .map(|paragraph| {
            paragraph
                .runs
                .iter()
                .map(|run| run.text.as_str())
                .collect::<String>()
        })
        .collect::<Vec<_>>()
        .join("\n");
    js_trim(&joined).to_owned()
}

/// `value || fallback` for a string.
fn or_str<'a>(value: &'a str, fallback: &'a str) -> &'a str {
    if value.is_empty() {
        fallback
    } else {
        value
    }
}

/// `value || fallback` for a number: 0 and NaN are falsy.
fn or_number(value: f64, fallback: f64) -> f64 {
    if value == 0.0 || value.is_nan() {
        fallback
    } else {
        value
    }
}

fn structured_run(run: &Run) -> Map<String, Value> {
    let mut map = Map::new();
    map.insert("text".into(), json!(run.text));
    if !run.font_name.is_empty() {
        map.insert("fontFamily".into(), json!(run.font_name));
    }
    if run.font_size_px != 0.0 && !run.font_size_px.is_nan() {
        map.insert("fontSize".into(), json!(run.font_size_px));
    }
    map.insert(
        "fontWeight".into(),
        json!(if run.bold { "700" } else { "400" }),
    );
    map.insert(
        "fontStyle".into(),
        json!(if run.italic { "italic" } else { "normal" }),
    );
    map.insert("color".into(), json!(or_str(&run.color, "#000000")));
    map.insert("underline".into(), json!(run.underline));
    map.insert(
        "letterSpacing".into(),
        json!(or_number(run.character_spacing_px, 0.0)),
    );
    map
}

fn structured_paragraph(paragraph: &Paragraph) -> Map<String, Value> {
    let mut map = Map::new();
    map.insert("alignment".into(), json!(paragraph.alignment));
    map.insert("lineHeight".into(), json!(paragraph.line_spacing));
    map.insert("spaceBefore".into(), json!(paragraph.space_before_px));
    map.insert("spaceAfter".into(), json!(paragraph.space_after_px));
    map.insert(
        "runs".into(),
        Value::Array(
            paragraph
                .runs
                .iter()
                .map(|run| Value::Object(structured_run(run)))
                .collect(),
        ),
    );
    map
}

fn structured_body(body: &TextBody) -> Map<String, Value> {
    let mut map = Map::new();
    map.insert("insetLeft".into(), json!(body.inset_left_px));
    map.insert("insetRight".into(), json!(body.inset_right_px));
    map.insert("insetTop".into(), json!(body.inset_top_px));
    map.insert("insetBottom".into(), json!(body.inset_bottom_px));
    map.insert(
        "verticalAlign".into(),
        json!(to_vertical_align(body.vertical_align)),
    );
    map.insert("wrap".into(), json!(body.wrap));
    map.insert("autoFit".into(), json!(body.autofit));
    map.insert(
        "paragraphs".into(),
        Value::Array(
            body.paragraphs
                .iter()
                .map(|paragraph| Value::Object(structured_paragraph(paragraph)))
                .collect(),
        ),
    );
    map
}

fn number(map: &Map<String, Value>, key: &str) -> Option<f64> {
    map.get(key).and_then(Value::as_f64)
}

fn scale_key(map: &mut Map<String, Value>, key: &str, factor: f64) {
    if let Some(value) = number(map, key) {
        map.insert(key.into(), json!(value * factor));
    }
}

/// `scaleTextBody`.
fn scale_body(mut body: Map<String, Value>, scale_x: f64, scale_y: f64) -> Map<String, Value> {
    let smaller = scale_x.min(scale_y);
    scale_key(&mut body, "insetLeft", scale_x);
    scale_key(&mut body, "insetRight", scale_x);
    scale_key(&mut body, "insetTop", scale_y);
    scale_key(&mut body, "insetBottom", scale_y);
    if let Some(Value::Array(paragraphs)) = body.get_mut("paragraphs") {
        for paragraph in paragraphs.iter_mut() {
            let Value::Object(paragraph) = paragraph else {
                continue;
            };
            if let Some(line_height) = number(paragraph, "lineHeight") {
                if line_height > 4.0 {
                    paragraph.insert("lineHeight".into(), json!(line_height * smaller));
                }
            }
            scale_key(paragraph, "spaceBefore", scale_y);
            scale_key(paragraph, "spaceAfter", scale_y);
            if let Some(Value::Array(runs)) = paragraph.get_mut("runs") {
                for run in runs.iter_mut() {
                    if let Value::Object(run) = run {
                        scale_key(run, "fontSize", smaller);
                        scale_key(run, "letterSpacing", scale_x);
                    }
                }
            }
        }
    }
    body
}

/// `scaleElement`.
fn scale_element(mut element: Map<String, Value>, scale_x: f64, scale_y: f64) -> Value {
    let smaller = scale_x.min(scale_y);
    scale_key(&mut element, "x", scale_x);
    scale_key(&mut element, "y", scale_y);
    scale_key(&mut element, "width", scale_x);
    scale_key(&mut element, "height", scale_y);
    if let Some(Value::Object(body)) = element.remove("textBody") {
        element.insert(
            "textBody".into(),
            Value::Object(scale_body(body, scale_x, scale_y)),
        );
    }
    if let Some(Value::Object(style)) = element.get_mut("style") {
        scale_key(style, "fontSize", smaller);
        scale_key(style, "borderWidth", smaller);
        scale_key(style, "paddingLeft", scale_x);
        scale_key(style, "paddingRight", scale_x);
        scale_key(style, "paddingTop", scale_y);
        scale_key(style, "paddingBottom", scale_y);
    }
    Value::Object(element)
}

fn base(shape: &Shape, slide_index: usize) -> Map<String, Value> {
    let key = match shape.id {
        Some(id) => id.to_string(),
        None => shape.name.clone(),
    };
    let mut map = Map::new();
    map.insert("id".into(), json!(format!("pptx_{slide_index}_{key}")));
    map.insert("type".into(), json!("shape"));
    map.insert("x".into(), json!(shape.x));
    map.insert("y".into(), json!(shape.y));
    map.insert("width".into(), json!(shape.width));
    map.insert("height".into(), json!(shape.height));
    map.insert("content".into(), json!(""));
    map.insert("style".into(), json!({ "rotation": shape.rotation }));
    map
}

fn style_mut(element: &mut Map<String, Value>) -> &mut Map<String, Value> {
    if !matches!(element.get("style"), Some(Value::Object(_))) {
        element.insert("style".into(), Value::Object(Map::new()));
    }
    match element.get_mut("style") {
        Some(Value::Object(style)) => style,
        _ => unreachable!("style was just made an object"),
    }
}

/// `flattenShape`.
fn flatten(shape: &Shape, slide_index: usize, scale_x: f64, scale_y: f64, out: &mut Vec<Value>) {
    let mut element = base(shape, slide_index);
    match &shape.kind {
        ShapeKind::Group(children) => {
            for child in children {
                flatten(child, slide_index, scale_x, scale_y, out);
            }
        }
        ShapeKind::Image { format, data } => {
            element.insert("type".into(), json!("image"));
            element.insert("content".into(), json!(to_data_url(format, data)));
            style_mut(&mut element).insert("objectFit".into(), json!("fill"));
            out.push(scale_element(element, scale_x, scale_y));
        }
        ShapeKind::Text(body) => {
            let first_paragraph = body.paragraphs.first();
            let first_run = first_paragraph.and_then(|paragraph| paragraph.runs.first());
            element.insert("type".into(), json!("text"));
            element.insert("content".into(), json!(plain_text(body)));
            element.insert("textBody".into(), Value::Object(structured_body(body)));
            let style = style_mut(&mut element);
            style.insert(
                "fontFamily".into(),
                json!(or_str(
                    first_run.map_or("", |run| run.font_name.as_str()),
                    "Calibri"
                )),
            );
            style.insert(
                "fontSize".into(),
                json!(or_number(
                    first_run.map_or(0.0, |run| run.font_size_px),
                    18.0
                )),
            );
            style.insert(
                "fontWeight".into(),
                json!(if first_run.is_some_and(|run| run.bold) {
                    "700"
                } else {
                    "400"
                }),
            );
            style.insert(
                "fontStyle".into(),
                json!(if first_run.is_some_and(|run| run.italic) {
                    "italic"
                } else {
                    "normal"
                }),
            );
            style.insert(
                "textDecoration".into(),
                json!(if first_run.is_some_and(|run| run.underline) {
                    "underline"
                } else {
                    "none"
                }),
            );
            style.insert(
                "color".into(),
                json!(or_str(
                    first_run.map_or("", |run| run.color.as_str()),
                    "#000000"
                )),
            );
            style.insert(
                "textAlign".into(),
                json!(or_str(
                    first_paragraph.map_or("", |paragraph| paragraph.alignment.as_str()),
                    "left"
                )),
            );
            style.insert(
                "verticalAlign".into(),
                json!(to_vertical_align(body.vertical_align)),
            );
            style.insert(
                "paddingLeft".into(),
                json!(or_number(body.inset_left_px, 0.0)),
            );
            style.insert(
                "paddingRight".into(),
                json!(or_number(body.inset_right_px, 0.0)),
            );
            style.insert(
                "paddingTop".into(),
                json!(or_number(body.inset_top_px, 0.0)),
            );
            style.insert(
                "paddingBottom".into(),
                json!(or_number(body.inset_bottom_px, 0.0)),
            );
            out.push(scale_element(element, scale_x, scale_y));
        }
        ShapeKind::Table { rows } => {
            let lines: Vec<String> = rows
                .iter()
                .map(|cells| {
                    cells
                        .iter()
                        .map(|cell| js_trim(&plain_text(cell)).to_owned())
                        .filter(|text| !text.is_empty())
                        .collect::<Vec<_>>()
                        .join(" | ")
                })
                .filter(|line| !line.is_empty())
                .collect();
            let table_lines = lines.join("\n");
            element.insert("type".into(), json!("text"));
            element.insert("content".into(), json!(table_lines));
            let paragraphs: Vec<Value> = table_lines
                .split('\n')
                .map(|line| {
                    json!({
                        "alignment": "left",
                        "runs": [{
                            "text": line,
                            "fontFamily": "Calibri",
                            "fontSize": 16,
                            "fontWeight": "400",
                            "fontStyle": "normal",
                            "color": "#000000",
                        }],
                    })
                })
                .collect();
            element.insert(
                "textBody".into(),
                json!({ "verticalAlign": "top", "paragraphs": paragraphs }),
            );
            let style = style_mut(&mut element);
            style.insert("textAlign".into(), json!("left"));
            style.insert("verticalAlign".into(), json!("top"));
            style.insert("color".into(), json!("#000000"));
            out.push(scale_element(element, scale_x, scale_y));
        }
        ShapeKind::Line { color, width_px } => {
            let style = style_mut(&mut element);
            style.insert("backgroundColor".into(), json!("transparent"));
            style.insert(
                "borderColor".into(),
                json!(color.as_deref().unwrap_or("transparent")),
            );
            style.insert("borderWidth".into(), json!(width_px));
            out.push(scale_element(element, scale_x, scale_y));
        }
        ShapeKind::Unknown => {}
    }
}

/// `path.basename(filePath, path.extname(filePath)) || "Imported presentation"`.
fn title_from_path(file_path: &str) -> String {
    let base = file_path
        .trim_end_matches('/')
        .rsplit('/')
        .next()
        .unwrap_or("");
    // path.extname: the last dot, unless it is the first character.
    let stem = match base.rfind('.') {
        Some(dot) if dot > 0 => &base[..dot],
        _ => base,
    };
    if stem.is_empty() {
        "Imported presentation".to_owned()
    } else {
        stem.to_owned()
    }
}

/// `convertPayloadToPresentation`.
pub fn to_presentation(payload: &Payload, file_path: &str) -> Value {
    let source_width = or_number(payload.slide_width_px, TARGET_SLIDE_WIDTH);
    let source_height = or_number(payload.slide_height_px, TARGET_SLIDE_HEIGHT);
    let scale_x = TARGET_SLIDE_WIDTH / source_width;
    let scale_y = TARGET_SLIDE_HEIGHT / source_height;

    let slides: Vec<Value> = payload
        .slides
        .iter()
        .enumerate()
        .map(|(index, slide)| {
            let mut elements = Vec::new();
            if let Background::Image { format, data } = &slide.background {
                if !data.is_empty() {
                    let mut background = Map::new();
                    background.insert("id".into(), json!(format!("pptx_bg_{}", index + 1)));
                    background.insert("type".into(), json!("image"));
                    background.insert("x".into(), json!(0));
                    background.insert("y".into(), json!(0));
                    background.insert("width".into(), json!(source_width));
                    background.insert("height".into(), json!(source_height));
                    background.insert("content".into(), json!(to_data_url(format, data)));
                    background.insert("style".into(), json!({ "objectFit": "fill" }));
                    elements.push(scale_element(background, scale_x, scale_y));
                }
            }
            for shape in &slide.shapes {
                flatten(shape, index + 1, scale_x, scale_y, &mut elements);
            }
            let text_content = elements
                .iter()
                .filter(|element| element.get("type").and_then(Value::as_str) == Some("text"))
                .map(|element| element.get("content").and_then(Value::as_str).unwrap_or(""))
                .collect::<Vec<_>>()
                .join("\n");
            json!({
                "id": format!("pptx:{}", index + 1),
                "title": format!("Slide {}", index + 1),
                "backgroundColor": match &slide.background {
                    Background::Solid(color) => Value::String(color.clone()),
                    Background::Image { .. } => Value::Null,
                },
                "elements": elements,
                "textContent": js_trim(&text_content),
            })
        })
        .collect();

    json!({
        "title": title_from_path(file_path),
        "slideWidthPx": TARGET_SLIDE_WIDTH,
        "slideHeightPx": TARGET_SLIDE_HEIGHT,
        "slides": slides,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_title_is_the_file_name_without_its_extension() {
        assert_eq!(
            title_from_path("/decks/Sunday Service.pptx"),
            "Sunday Service"
        );
        assert_eq!(title_from_path("/decks/.pptx"), ".pptx");
        assert_eq!(title_from_path("/decks/a.b.pptx"), "a.b");
        assert_eq!(title_from_path(""), "Imported presentation");
    }
}
