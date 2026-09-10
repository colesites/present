//! CSS colour strings, as the scene carries them.
//!
//! Every colour in the scene arrives as text, because on the React side it goes
//! straight into a style attribute: `"#fff"`, `"#ffffffcc"`, `"rgb(0 0 0)"`,
//! `"rgba(0,0,0,.5)"`, `"transparent"`. `services::output` deliberately keeps
//! them as `String` so a value Rust does not recognise still reaches the
//! browser intact. The compositor is the point where one of them has to become
//! four numbers.
//!
//! **An unrecognised colour returns `None`, and every caller treats that as
//! "do not paint".** That is the safe direction. Not painting a shape leaves
//! the background visible; guessing black paints a rectangle over the lyrics,
//! and guessing white paints one over the video. Neither is recoverable in
//! front of a congregation, and the first is barely noticeable.

use tiny_skia::Color;

/// Parse a CSS colour. `None` means "not a colour I understand" — never a
/// default.
pub fn parse(value: &str) -> Option<Color> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return None;
    }

    // `transparent` is a real answer, not a failure: it means paint nothing,
    // which is what a fully transparent colour does.
    if trimmed.eq_ignore_ascii_case("transparent") {
        return Color::from_rgba8(0, 0, 0, 0).into();
    }
    if trimmed.eq_ignore_ascii_case("none") {
        return None;
    }

    if let Some(hex) = trimmed.strip_prefix('#') {
        return parse_hex(hex);
    }
    if let Some(rest) = strip_function(trimmed, "rgba").or_else(|| strip_function(trimmed, "rgb")) {
        return parse_rgb(rest);
    }
    named(trimmed)
}

/// `#rgb`, `#rgba`, `#rrggbb`, `#rrggbbaa`.
fn parse_hex(hex: &str) -> Option<Color> {
    let digits: Vec<u8> = hex
        .chars()
        .map(|c| c.to_digit(16).map(|d| d as u8))
        .collect::<Option<_>>()?;

    let (r, g, b, a) = match digits.len() {
        // Shorthand doubles each digit: `#f00` is `#ff0000`, not `#f00000`.
        3 => (digits[0] * 17, digits[1] * 17, digits[2] * 17, 255),
        4 => (
            digits[0] * 17,
            digits[1] * 17,
            digits[2] * 17,
            digits[3] * 17,
        ),
        6 => (
            digits[0] * 16 + digits[1],
            digits[2] * 16 + digits[3],
            digits[4] * 16 + digits[5],
            255,
        ),
        8 => (
            digits[0] * 16 + digits[1],
            digits[2] * 16 + digits[3],
            digits[4] * 16 + digits[5],
            digits[6] * 16 + digits[7],
        ),
        _ => return None,
    };

    Some(Color::from_rgba8(r, g, b, a))
}

/// The inside of `rgb(...)` / `rgba(...)`, if this is one.
fn strip_function<'a>(value: &'a str, name: &str) -> Option<&'a str> {
    let lowered = value.to_ascii_lowercase();
    let rest = lowered.strip_prefix(name)?;
    if !rest.trim_start().starts_with('(') {
        return None;
    }
    // Index back into the original so the caller sees the untouched text.
    let open = value.find('(')?;
    let close = value.rfind(')')?;
    if close <= open {
        return None;
    }
    Some(&value[open + 1..close])
}

/// Both the legacy comma form and the modern space form, since the React side
/// emits whichever the source style used.
fn parse_rgb(body: &str) -> Option<Color> {
    let normalised = body.replace([',', '/'], " ");
    let parts: Vec<&str> = normalised.split_whitespace().collect();
    if parts.len() < 3 || parts.len() > 4 {
        return None;
    }

    let r = parse_channel(parts[0])?;
    let g = parse_channel(parts[1])?;
    let b = parse_channel(parts[2])?;
    let a = match parts.get(3) {
        Some(raw) => parse_alpha(raw)?,
        None => 255,
    };

    Some(Color::from_rgba8(r, g, b, a))
}

/// `0-255`, or a percentage.
fn parse_channel(raw: &str) -> Option<u8> {
    if let Some(percent) = raw.strip_suffix('%') {
        let value: f32 = percent.trim().parse().ok()?;
        return Some((value.clamp(0.0, 100.0) / 100.0 * 255.0).round() as u8);
    }
    let value: f32 = raw.trim().parse().ok()?;
    Some(value.clamp(0.0, 255.0).round() as u8)
}

/// `0-1`, or a percentage. `.5` with no leading zero is valid CSS and is what
/// a hand-written style usually contains.
fn parse_alpha(raw: &str) -> Option<u8> {
    if let Some(percent) = raw.strip_suffix('%') {
        let value: f32 = percent.trim().parse().ok()?;
        return Some((value.clamp(0.0, 100.0) / 100.0 * 255.0).round() as u8);
    }
    let value: f32 = raw.trim().parse().ok()?;
    Some((value.clamp(0.0, 1.0) * 255.0).round() as u8)
}

/// The handful of names that actually appear in this application's styles.
///
/// Deliberately not the full CSS list. A name that is not here returns `None`
/// and nothing is painted, which is the same safe direction as a malformed hex.
fn named(value: &str) -> Option<Color> {
    let rgb = match value.to_ascii_lowercase().as_str() {
        "black" => (0, 0, 0),
        "white" => (255, 255, 255),
        "red" => (255, 0, 0),
        "green" => (0, 128, 0),
        "blue" => (0, 0, 255),
        "yellow" => (255, 255, 0),
        "gray" | "grey" => (128, 128, 128),
        _ => return None,
    };
    Some(Color::from_rgba8(rgb.0, rgb.1, rgb.2, 255))
}

/// Apply an element's `opacity` on top of its colour's own alpha.
///
/// They multiply, which is what CSS does: a 50%-opaque element painted in a
/// 50%-alpha colour is 25% opaque, not 50%.
pub fn with_opacity(color: Color, opacity: Option<f64>) -> Color {
    let Some(opacity) = opacity else {
        return color;
    };
    if !opacity.is_finite() {
        return color;
    }

    let mut adjusted = color;
    adjusted.set_alpha(color.alpha() * opacity.clamp(0.0, 1.0) as f32);
    adjusted
}

#[cfg(test)]
mod tests {
    use super::*;

    fn rgba(color: Color) -> (u8, u8, u8, u8) {
        let c = color.to_color_u8();
        (c.red(), c.green(), c.blue(), c.alpha())
    }

    #[test]
    fn shorthand_hex_doubles_each_digit() {
        // `#f00` is `#ff0000`. Reading it as `#f00000` gives a dark red that
        // looks plausible on a preview and wrong on a projector.
        assert_eq!(rgba(parse("#f00").unwrap()), (255, 0, 0, 255));
        assert_eq!(rgba(parse("#abc").unwrap()), (170, 187, 204, 255));
    }

    #[test]
    fn the_four_hex_lengths_all_parse() {
        assert_eq!(rgba(parse("#fff").unwrap()), (255, 255, 255, 255));
        assert_eq!(rgba(parse("#ffff").unwrap()), (255, 255, 255, 255));
        assert_eq!(rgba(parse("#ffffff").unwrap()), (255, 255, 255, 255));
        assert_eq!(rgba(parse("#ffffff80").unwrap()), (255, 255, 255, 128));
    }

    #[test]
    fn both_rgb_syntaxes_parse() {
        // The legacy comma form and the modern space form, because the React
        // side emits whichever the source style used.
        assert_eq!(rgba(parse("rgb(255, 0, 0)").unwrap()), (255, 0, 0, 255));
        assert_eq!(rgba(parse("rgb(255 0 0)").unwrap()), (255, 0, 0, 255));
        assert_eq!(rgba(parse("rgba(0, 0, 0, 0.5)").unwrap()), (0, 0, 0, 128));
        assert_eq!(rgba(parse("rgb(0 0 0 / 50%)").unwrap()), (0, 0, 0, 128));
    }

    #[test]
    fn a_leading_dot_alpha_parses() {
        // `.5` is valid CSS and is what a hand-written style usually contains.
        assert_eq!(rgba(parse("rgba(0,0,0,.5)").unwrap()), (0, 0, 0, 128));
    }

    #[test]
    fn an_unrecognised_colour_paints_nothing_rather_than_guessing() {
        // The rule the module is built on. Guessing black paints a rectangle
        // over the lyrics; guessing white paints one over the video. Not
        // painting leaves the background visible, which is recoverable.
        assert!(parse("chartreuse").is_none());
        assert!(parse("#ff").is_none());
        assert!(parse("#gggggg").is_none());
        assert!(parse("rgb(1, 2)").is_none());
        assert!(parse("rgb(1, 2, 3, 4, 5)").is_none());
        assert!(parse("").is_none());
        assert!(parse("   ").is_none());
        assert!(parse("var(--brand)").is_none());
    }

    #[test]
    fn transparent_is_an_answer_and_none_is_not() {
        // `transparent` means paint nothing *deliberately*; `none` means there
        // is no colour here. Both end up painting nothing, but only the first
        // is a colour, and a caller that distinguishes them stays correct.
        assert_eq!(rgba(parse("transparent").unwrap()), (0, 0, 0, 0));
        assert!(parse("none").is_none());
    }

    #[test]
    fn case_and_whitespace_do_not_matter() {
        assert_eq!(rgba(parse("  #FFF  ").unwrap()), (255, 255, 255, 255));
        assert_eq!(rgba(parse("RGBA(0,0,0,1)").unwrap()), (0, 0, 0, 255));
        assert_eq!(rgba(parse("Transparent").unwrap()), (0, 0, 0, 0));
    }

    #[test]
    fn out_of_range_channels_are_clamped_rather_than_wrapped() {
        // 300 must not wrap to 44. A wrapped channel is a completely different
        // colour; a clamped one is the colour that was asked for.
        assert_eq!(rgba(parse("rgb(300, -20, 0)").unwrap()), (255, 0, 0, 255));
        assert_eq!(rgba(parse("rgba(0,0,0,5)").unwrap()), (0, 0, 0, 255));
    }

    #[test]
    fn opacity_multiplies_with_the_colours_own_alpha() {
        // CSS behaviour: a half-opaque element in a half-alpha colour is a
        // quarter opaque.
        let half = parse("#00000080").unwrap();
        let quarter = with_opacity(half, Some(0.5));
        assert_eq!(quarter.to_color_u8().alpha(), 64);

        // No opacity, and a nonsense opacity, both leave the colour alone.
        assert_eq!(with_opacity(half, None).to_color_u8().alpha(), 128);
        assert_eq!(
            with_opacity(half, Some(f64::NAN)).to_color_u8().alpha(),
            128
        );
    }
}
