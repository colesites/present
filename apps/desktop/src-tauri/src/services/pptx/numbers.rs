//! Python's arithmetic, exactly, where parse_pptx.py's output depends on it.
//!
//! `round(x, 4)` rounds the exact binary value to the nearest four-decimal
//! value, ties to even; `%` on floats takes the divisor's sign; `colorsys` is
//! transcribed from CPython 3.14. A difference in the fourth decimal is a
//! difference in the imported slide, and the tests compare exactly.

/// Python's `round(value, 4)`.
///
/// Rust's `{:.4}` formatting rounds the exact binary value, ties to even — the
/// same rule — so the decimal string it prints is the one Python rounds to.
pub fn round4(value: f64) -> f64 {
    if !value.is_finite() {
        return value;
    }
    format!("{value:.4}").parse().unwrap_or(value)
}

/// Python's `round(value)` for a float: the nearest integer, ties to even.
pub fn round_half_even(value: f64) -> f64 {
    value.round_ties_even()
}

/// Python's `value % 1.0`.
pub fn py_mod1(value: f64) -> f64 {
    let remainder = value % 1.0;
    if remainder != 0.0 && remainder < 0.0 {
        remainder + 1.0
    } else if remainder == 0.0 {
        0.0
    } else {
        remainder
    }
}

pub const EMU_PER_INCH: f64 = 914_400.0;
pub const DPI: f64 = 96.0;
pub const PT_PER_INCH: f64 = 72.0;

/// `emu_to_px`.
pub fn emu_to_px(emu: f64) -> f64 {
    round4((emu / EMU_PER_INCH) * DPI)
}

/// `pt_to_px`.
pub fn pt_to_px(pt: f64) -> f64 {
    round4((pt / PT_PER_INCH) * DPI)
}

/// python-pptx's `Length.pt` for a centipoint value, e.g. a font size: stored
/// as `int(centipoints * 127)` EMU, read back as EMU / 12700.
pub fn centipoints_pt(centipoints: i64) -> f64 {
    (centipoints * 127) as f64 / 12_700.0
}

/// python-pptx's `Length.pt` for an EMU value.
pub fn emu_pt(emu: i64) -> f64 {
    emu as f64 / 12_700.0
}

/// Python's `int(text)` for the attribute values the parser reads: optional
/// surrounding whitespace, an optional sign, ASCII digits, `_` between digits.
pub fn py_int(text: &str) -> Option<i64> {
    let trimmed = text.trim();
    let (negative, digits) = match trimmed.as_bytes().first() {
        Some(b'-') => (true, &trimmed[1..]),
        Some(b'+') => (false, &trimmed[1..]),
        _ => (false, trimmed),
    };
    if digits.is_empty()
        || digits.starts_with('_')
        || digits.ends_with('_')
        || digits.contains("__")
    {
        return None;
    }
    let cleaned: String = digits
        .chars()
        .filter(|character| *character != '_')
        .collect();
    if !cleaned.chars().all(|character| character.is_ascii_digit()) {
        return None;
    }
    let value: i64 = cleaned.parse().ok()?;
    Some(if negative { -value } else { value })
}

/// Python's `float(text)`.
pub fn py_float(text: &str) -> Option<f64> {
    let trimmed = text.trim();
    let lowered = trimmed.to_ascii_lowercase();
    let unsigned = lowered.trim_start_matches(['+', '-']);
    if matches!(unsigned, "inf" | "infinity" | "nan") {
        return trimmed.parse().ok().or(match unsigned {
            "nan" => Some(f64::NAN),
            _ if lowered.starts_with('-') => Some(f64::NEG_INFINITY),
            _ => Some(f64::INFINITY),
        });
    }
    if trimmed.contains('_') {
        return py_float(&trimmed.replace('_', ""));
    }
    trimmed.parse().ok()
}

// --- Colours --------------------------------------------------------------------

/// `normalize_hex_color`: `#RRGGBB`, upper-case, from six or three hex digits.
pub fn normalize_hex(value: &str) -> Option<String> {
    let text: String = value.trim().replace('#', "");
    let expanded = if text.len() == 3 && text.chars().all(|c| c.is_ascii_hexdigit()) {
        text.chars().flat_map(|c| [c, c]).collect()
    } else {
        text
    };
    (expanded.len() == 6 && expanded.chars().all(|c| c.is_ascii_hexdigit()))
        .then(|| format!("#{}", expanded.to_ascii_uppercase()))
}

const ONE_THIRD: f64 = 1.0 / 3.0;
const ONE_SIXTH: f64 = 1.0 / 6.0;
const TWO_THIRD: f64 = 2.0 / 3.0;

/// `colorsys.rgb_to_hls`.
pub fn rgb_to_hls(r: f64, g: f64, b: f64) -> (f64, f64, f64) {
    let maxc = r.max(g).max(b);
    let minc = r.min(g).min(b);
    let sumc = maxc + minc;
    let rangec = maxc - minc;
    let l = sumc / 2.0;
    if minc == maxc {
        return (0.0, l, 0.0);
    }
    let s = if l <= 0.5 {
        rangec / sumc
    } else {
        rangec / (2.0 - maxc - minc)
    };
    let rc = (maxc - r) / rangec;
    let gc = (maxc - g) / rangec;
    let bc = (maxc - b) / rangec;
    let h = if r == maxc {
        bc - gc
    } else if g == maxc {
        2.0 + rc - bc
    } else {
        4.0 + gc - rc
    };
    (py_mod1(h / 6.0), l, s)
}

fn hue_value(m1: f64, m2: f64, hue: f64) -> f64 {
    let hue = py_mod1(hue);
    if hue < ONE_SIXTH {
        return m1 + (m2 - m1) * hue * 6.0;
    }
    if hue < 0.5 {
        return m2;
    }
    if hue < TWO_THIRD {
        return m1 + (m2 - m1) * (TWO_THIRD - hue) * 6.0;
    }
    m1
}

/// `colorsys.hls_to_rgb`.
pub fn hls_to_rgb(h: f64, l: f64, s: f64) -> (f64, f64, f64) {
    if s == 0.0 {
        return (l, l, l);
    }
    let m2 = if l <= 0.5 {
        l * (1.0 + s)
    } else {
        l + s - (l * s)
    };
    let m1 = 2.0 * l - m2;
    (
        hue_value(m1, m2, h + ONE_THIRD),
        hue_value(m1, m2, h),
        hue_value(m1, m2, h - ONE_THIRD),
    )
}

fn clamp(value: f64, minimum: f64, maximum: f64) -> f64 {
    minimum.max(maximum.min(value))
}

/// The colour transforms parse_pptx.py applies.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct Transforms {
    pub lum_mod: Option<i64>,
    pub lum_off: Option<i64>,
    pub alpha: Option<i64>,
}

/// `apply_luminance_and_alpha`: lightness scaled and offset in HLS, alpha as
/// darkening over black, back to `#RRGGBB`.
pub fn apply_transforms(hex: &str, transforms: Transforms) -> String {
    let normalized = normalize_hex(hex).unwrap_or_else(|| "#000000".to_owned());
    let channel = |index: usize| {
        i64::from_str_radix(&normalized[index..index + 2], 16).unwrap_or(0) as f64 / 255.0
    };
    let (h, l, s) = rgb_to_hls(channel(1), channel(3), channel(5));

    let mod_ratio = transforms
        .lum_mod
        .map_or(1.0, |value| clamp(value as f64 / 100_000.0, 0.0, 1.0));
    let off_ratio = transforms
        .lum_off
        .map_or(0.0, |value| clamp(value as f64 / 100_000.0, 0.0, 1.0));
    let l = clamp(l * mod_ratio + off_ratio, 0.0, 1.0);

    let (mut r, mut g, mut b) = hls_to_rgb(h, l, s);
    if let Some(alpha) = transforms.alpha {
        let ratio = clamp(alpha as f64 / 100_000.0, 0.0, 1.0);
        r *= ratio;
        g *= ratio;
        b *= ratio;
    }
    let byte = |value: f64| round_half_even(clamp(value, 0.0, 1.0) * 255.0) as i64;
    format!("#{:02X}{:02X}{:02X}", byte(r), byte(g), byte(b))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn round4_rounds_like_python() {
        // Each against CPython 3.14's round(x, 4).
        assert_eq!(round4(1.03125), 1.0312, "an exact tie goes to even");
        assert_eq!(
            round4(0.00005),
            0.0001,
            "0.00005 is slightly above the tie in binary"
        );
        assert_eq!(round4(2.5e-05), 0.0);
        assert_eq!(round4(12.34565), 12.3456);
        assert_eq!(round4(79.99995), 79.9999);
        assert_eq!(round_half_even(0.5 * 255.0), 128.0);
        assert_eq!(round_half_even(1.03125 * 255.0), 263.0);
    }

    #[test]
    fn floats_mod_one_take_the_divisors_sign() {
        assert_eq!(py_mod1(-0.25), 0.75);
        assert_eq!(py_mod1(1.25), 0.25);
        assert_eq!(py_mod1(-1.0), 0.0);
    }

    #[test]
    fn python_int_and_float_accept_what_python_accepts() {
        assert_eq!(py_int(" 42 "), Some(42));
        assert_eq!(py_int("-7"), Some(-7));
        assert_eq!(py_int("1_000"), Some(1000));
        assert_eq!(py_int("4.0"), None);
        assert_eq!(py_int(""), None);
        assert_eq!(py_float("45720"), Some(45720.0));
        assert_eq!(py_float("1e3"), Some(1000.0));
        assert_eq!(py_float("x"), None);
    }

    #[test]
    fn hex_colours_normalize() {
        assert_eq!(normalize_hex("c00000").as_deref(), Some("#C00000"));
        assert_eq!(normalize_hex("#abc").as_deref(), Some("#AABBCC"));
        assert_eq!(normalize_hex("12345").as_deref(), None);
    }

    #[test]
    fn luminance_transforms_match_the_fixtures() {
        // tests/fixtures/pptx: accent1 4F81BD at lumMod 75%, tx1 at 50/50,
        // accent2 C0504D at 60/40.
        let transforms = |lum_mod, lum_off| Transforms {
            lum_mod,
            lum_off,
            alpha: None,
        };
        assert_eq!(
            apply_transforms("#4F81BD", transforms(Some(75000), None)),
            "#376092"
        );
        assert_eq!(
            apply_transforms("#000000", transforms(Some(50000), Some(50000))),
            "#808080"
        );
        assert_eq!(
            apply_transforms("#C0504D", transforms(Some(60000), Some(40000))),
            "#D99694"
        );
        assert_eq!(
            apply_transforms(
                "#FFFFFF",
                Transforms {
                    lum_mod: None,
                    lum_off: Some(-20000),
                    alpha: Some(50000)
                }
            ),
            "#808080",
            "a negative offset is clamped to 0, alpha darkens over black"
        );
    }
}
