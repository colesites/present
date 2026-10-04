//! What to draw a font in when it is not on this computer.
//!
//! The table is `src/shared/lib/font-fallback.mjs`, read here as it is built,
//! so the screens and the canvas renderer fall back to the same fonts: a deck
//! asking for Calibri or Century Schoolbook on a Mac gets the closest font of
//! the same kind rather than whatever the text engine reaches first.

use std::collections::HashMap;
use std::sync::{Mutex, OnceLock};

use cosmic_text::FontSystem;

const TABLE: &str = include_str!("../../../../src/shared/lib/font-fallback.mjs");

struct Fallback {
    fonts: Vec<String>,
    generic: String,
}

struct Table {
    known: HashMap<String, Fallback>,
    serif: Vec<String>,
    mono: Vec<String>,
    script: Vec<String>,
}

/// The quoted strings in `text`, in order.
fn quoted(text: &str) -> Vec<String> {
    text.split('"')
        .enumerate()
        .filter(|(index, _)| index % 2 == 1)
        .map(|(_, value)| value.to_owned())
        .collect()
}

fn table() -> &'static Table {
    static TABLE_CELL: OnceLock<Table> = OnceLock::new();
    TABLE_CELL.get_or_init(|| {
        let mut known = HashMap::new();
        let hints = |name: &str| {
            TABLE
                .lines()
                .find(|line| line.trim_start().starts_with(&format!("const {name}")))
                .map(quoted)
                .unwrap_or_default()
        };
        let (serif, mono, script) = (
            hints("SERIF_HINTS"),
            hints("MONO_HINTS"),
            hints("SCRIPT_HINTS"),
        );
        for line in TABLE.lines() {
            let line = line.trim();
            let (Some(fonts_at), Some(generic_at)) =
                (line.find("fonts: ["), line.find("generic: \""))
            else {
                continue;
            };
            let Some(key_end) = line.find(": {") else {
                continue;
            };
            let key = line[..key_end].trim().trim_matches('"').to_owned();
            let fonts_end = line[fonts_at..]
                .find(']')
                .map_or(line.len(), |end| fonts_at + end);
            let fonts = quoted(&line[fonts_at..fonts_end]);
            let generic = quoted(&line[generic_at..])
                .into_iter()
                .next()
                .unwrap_or_default();
            known.insert(key, Fallback { fonts, generic });
        }
        Table {
            known,
            serif,
            mono,
            script,
        }
    })
}

/// The generic family a font name belongs to, and the fonts to try for it.
fn fallback(family: &str) -> (Vec<String>, &'static str) {
    let key = family.trim().to_lowercase();
    let table = table();
    if let Some(known) = table.known.get(&key) {
        let generic = match known.generic.as_str() {
            "serif" => "serif",
            "monospace" => "monospace",
            "cursive" => "cursive",
            _ => "sans-serif",
        };
        return (known.fonts.clone(), generic);
    }
    let generic = if key.contains("sans") {
        "sans-serif"
    } else if table.mono.iter().any(|hint| key.contains(hint.as_str())) {
        "monospace"
    } else if table.script.iter().any(|hint| key.contains(hint.as_str())) {
        "cursive"
    } else if table.serif.iter().any(|hint| key.contains(hint.as_str())) {
        "serif"
    } else {
        "sans-serif"
    };
    (Vec::new(), generic)
}

/// What each generic family is drawn in, by the first of these installed.
fn generic_fonts(generic: &str) -> &'static [&'static str] {
    match generic {
        "serif" => &["Times New Roman", "Times", "Georgia", "DejaVu Serif"],
        "monospace" => &["Menlo", "Courier New", "Consolas", "DejaVu Sans Mono"],
        "cursive" => &[
            "Snell Roundhand",
            "Bradley Hand",
            "Apple Chancery",
            "Segoe Script",
        ],
        _ => &[
            "Helvetica Neue",
            "Helvetica",
            "Arial",
            "Segoe UI",
            "DejaVu Sans",
        ],
    }
}

fn cache() -> &'static Mutex<HashMap<String, String>> {
    static CACHE: OnceLock<Mutex<HashMap<String, String>>> = OnceLock::new();
    CACHE.get_or_init(|| Mutex::new(HashMap::new()))
}

/// Forget what was worked out: fonts were just installed.
pub fn forget() {
    if let Ok(mut cache) = cache().lock() {
        cache.clear();
    }
}

fn installed(system: &FontSystem, family: &str) -> bool {
    system.db().faces().any(|face| {
        face.families
            .iter()
            .any(|(name, _)| name.eq_ignore_ascii_case(family))
    })
}

/// `family` if it is installed, else the closest font that is.
pub fn resolve(system: &FontSystem, family: &str) -> String {
    if let Some(found) = cache()
        .lock()
        .ok()
        .and_then(|cache| cache.get(family).cloned())
    {
        return found;
    }
    let resolved = if installed(system, family) {
        family.to_owned()
    } else {
        let (fonts, generic) = fallback(family);
        fonts
            .iter()
            .map(String::as_str)
            .chain(generic_fonts(generic).iter().copied())
            .find(|candidate| installed(system, candidate))
            .map_or_else(|| family.to_owned(), str::to_owned)
    };
    if let Ok(mut cache) = cache().lock() {
        cache.insert(family.to_owned(), resolved.clone());
    }
    resolved
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_shared_table_is_read() {
        let (fonts, generic) = fallback("Calibri");
        assert_eq!(generic, "sans-serif");
        assert_eq!(fonts.first().map(String::as_str), Some("Carlito"));
        assert_eq!(fallback("Century Schoolbook").1, "serif");
        assert_eq!(fallback("Bradley Hand ITC").1, "cursive");
    }

    #[test]
    fn an_unknown_font_is_placed_by_its_name() {
        assert_eq!(fallback("Some Serif Display").1, "serif");
        assert_eq!(fallback("Fira Mono").1, "monospace");
        assert_eq!(fallback("Great Vibes Script").1, "cursive");
        assert_eq!(fallback("Brand New Sans").1, "sans-serif");
        assert_eq!(fallback("Garamond Premier").1, "serif");
    }
}
