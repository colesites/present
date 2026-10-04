//! The font catalog: the system's fonts and the ones the operator installed.
//!
//! Replaces `font.ipc.ts` and `font.service.ts`, and the `font-list` package
//! behind them. The rules are `src/shared/lib/font-catalog.mjs`, case for case
//! with `tests/font-catalog.test.mjs` — which on a Mac checks that file against
//! font-list's own helpers.
//!
//! **The patterns are JavaScript regular expressions, reproduced by hand.**
//! Their word boundaries count only ASCII letters, digits and `_` as word
//! characters, `\s` is JavaScript's whitespace, and an alternation takes the
//! first alternative that matches at the leftmost position. The `regex` crate's
//! `\b` is Unicode-aware, and "élan" would title-case differently.
//!
//! No Tauri types. Where the fonts come from is the caller's to say.

use std::cmp::Ordering;
use std::collections::HashSet;
use std::path::{Path, PathBuf};

use base64::Engine;
use serde::Serialize;

use crate::errors::AppResult;
use crate::services::collation;

pub const SUPPORTED_EXTENSIONS: [&str; 4] = [".ttf", ".otf", ".woff", ".woff2"];

/// The folder installed fonts are copied into, inside the app's data folder.
pub const CUSTOM_FONT_DIRECTORY: &str = "custom-fonts";

/// font-list leaves this family out.
pub const FONT_LIST_EXCEPTIONS: [&str; 1] = ["iconfont"];

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum FontSource {
    System,
    Custom,
}

/// `SystemFontFace` or `CustomFontFace`, as `shared/types/font.ts` has them.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FontFace {
    pub family_name: String,
    pub post_script_name: String,
    pub weight: String,
    pub weight_label: String,
    pub style: String,
    pub style_label: String,
    pub width: String,
    pub monospace: bool,
    pub source: FontSource,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub file_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub file_path: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub data_url: Option<String>,
}

// --- JavaScript's regular expressions, as these patterns use them ------------

/// `\w` without the `u` flag.
fn is_word(character: char) -> bool {
    character.is_ascii_alphanumeric() || character == '_'
}

/// `\s`, and what `String.prototype.trim` removes.
fn is_js_space(character: char) -> bool {
    (character.is_whitespace() && character != '\u{85}') || character == '\u{feff}'
}

fn js_trim(value: &str) -> &str {
    value.trim_matches(is_js_space)
}

/// Replace each run of characters matching `class` with one space.
fn collapse(value: &str, class: impl Fn(char) -> bool) -> String {
    let mut out = String::with_capacity(value.len());
    let mut in_run = false;
    for character in value.chars() {
        if class(character) {
            if !in_run {
                out.push(' ');
                in_run = true;
            }
        } else {
            out.push(character);
            in_run = false;
        }
    }
    out
}

/// A whole word in a hint: its parts, with an optional single space or hyphen
/// between them — `extra[\s-]?light` is `&["extra", "light"]`.
type Word = &'static [&'static str];

/// Where `parts` matches `text` from `start`, case-insensitively, with the
/// word boundary after it. Tries the separator before going without it, as a
/// greedy `?` does.
fn match_parts(text: &[char], start: usize, parts: &[&str]) -> Option<usize> {
    let (first, rest) = parts.split_first()?;
    let mut position = start;
    for expected in first.chars() {
        let actual = *text.get(position)?;
        if !actual.eq_ignore_ascii_case(&expected) {
            return None;
        }
        position += 1;
    }
    if rest.is_empty() {
        let bounded = text.get(position).is_none_or(|next| !is_word(*next));
        return bounded.then_some(position);
    }
    if let Some(separator) = text.get(position) {
        if is_js_space(*separator) || *separator == '-' {
            if let Some(end) = match_parts(text, position + 1, rest) {
                return Some(end);
            }
        }
    }
    match_parts(text, position, rest)
}

/// The first match of `\b(word|word|…)\b` at or after `from`: its start and end.
fn find_words(text: &[char], from: usize, words: &[Word]) -> Option<(usize, usize)> {
    (from..text.len()).find_map(|start| {
        let bounded = start == 0 || !is_word(text[start - 1]);
        if !bounded || !is_word(text[start]) {
            return None;
        }
        words
            .iter()
            .find_map(|parts| match_parts(text, start, parts))
            .map(|end| (start, end))
    })
}

fn contains_words(value: &str, words: &[Word]) -> bool {
    let text: Vec<char> = value.chars().collect();
    find_words(&text, 0, words).is_some()
}

/// `value.replace(/\b(…)\b/gi, "")`.
fn remove_words(value: &str, words: &[Word]) -> String {
    let text: Vec<char> = value.chars().collect();
    let mut out = String::with_capacity(value.len());
    let mut position = 0;
    while let Some((start, end)) = find_words(&text, position, words) {
        out.extend(&text[position..start]);
        position = end;
    }
    out.extend(&text[position..]);
    out
}

/// `toTitleCase`: trimmed, `_` and `-` runs and then whitespace runs to one
/// space, and every word character after a non-word character upper-cased.
fn title_case(value: &str) -> String {
    let spaced = collapse(
        &collapse(js_trim(value), |c| c == '_' || c == '-'),
        is_js_space,
    );
    let mut out = String::with_capacity(spaced.len());
    let mut previous_is_word = false;
    for character in spaced.chars() {
        let word = is_word(character);
        if word && !previous_is_word {
            out.push(character.to_ascii_uppercase());
        } else {
            out.push(character);
        }
        previous_is_word = word;
    }
    out
}

// --- Weight and style -------------------------------------------------------

struct WeightHint {
    words: &'static [Word],
    weight: &'static str,
    label: &'static str,
}

/// In order: the first whose word the name contains wins.
const WEIGHT_HINTS: [WeightHint; 9] = [
    WeightHint {
        words: &[&["thin"], &["hairline"]],
        weight: "100",
        label: "Thin",
    },
    WeightHint {
        words: &[&["extra", "light"], &["ultra", "light"]],
        weight: "200",
        label: "Extra Light",
    },
    WeightHint {
        words: &[&["light"]],
        weight: "300",
        label: "Light",
    },
    WeightHint {
        words: &[&["book"], &["regular"], &["roman"], &["normal"]],
        weight: "400",
        label: "Regular",
    },
    WeightHint {
        words: &[&["medium"]],
        weight: "500",
        label: "Medium",
    },
    WeightHint {
        words: &[&["semi", "bold"], &["demi", "bold"]],
        weight: "600",
        label: "Semibold",
    },
    WeightHint {
        words: &[&["bold"]],
        weight: "700",
        label: "Bold",
    },
    WeightHint {
        words: &[&["extra", "bold"], &["ultra", "bold"], &["heavy"]],
        weight: "800",
        label: "Extra Bold",
    },
    WeightHint {
        words: &[&["black"], &["extra", "black"], &["ultra", "black"]],
        weight: "900",
        label: "Black",
    },
];

/// Every weight and style word, in the order `inferFontMetaFromFileName`
/// removes them from a family name.
const DESCRIPTOR_WORDS: [Word; 21] = [
    &["thin"],
    &["hairline"],
    &["extra", "light"],
    &["ultra", "light"],
    &["light"],
    &["book"],
    &["regular"],
    &["roman"],
    &["normal"],
    &["medium"],
    &["semi", "bold"],
    &["demi", "bold"],
    &["bold"],
    &["extra", "bold"],
    &["ultra", "bold"],
    &["heavy"],
    &["black"],
    &["extra", "black"],
    &["ultra", "black"],
    &["italic"],
    &["oblique"],
];

/// `normalizeFontWeightMeta`: the weight and its label.
pub fn normalize_weight(raw: Option<&str>) -> (String, String) {
    let normalized = js_trim(raw.unwrap_or(""));

    if !normalized.is_empty() && normalized.chars().all(|c| c.is_ascii_digit()) {
        let digits = normalized.trim_start_matches('0');
        // Clamped to 900 anyway, so anything too long to parse is 900.
        let parsed: u128 = if digits.is_empty() {
            0
        } else {
            digits.parse().unwrap_or(u128::MAX)
        };
        let clamped = parsed.clamp(100, 900);
        // `Math.round(n / 100) * 100`: half rounds up.
        let rounded = ((clamped + 50) / 100 * 100).to_string();
        let label = WEIGHT_HINTS
            .iter()
            .find(|hint| hint.weight == rounded)
            .map_or_else(|| rounded.clone(), |hint| hint.label.to_owned());
        return (rounded, label);
    }

    if let Some(hint) = WEIGHT_HINTS
        .iter()
        .find(|hint| contains_words(normalized, hint.words))
    {
        return (hint.weight.to_owned(), hint.label.to_owned());
    }

    let label = if normalized.is_empty() {
        "Regular".to_owned()
    } else {
        title_case(normalized)
    };
    ("400".to_owned(), label)
}

/// `normalizeFontStyleMeta`: the style and its label.
pub fn normalize_style(raw: Option<&str>) -> (String, String) {
    let normalized = js_trim(raw.unwrap_or(""));
    if contains_words(normalized, &[&["italic"]]) {
        return ("italic".to_owned(), "Italic".to_owned());
    }
    if contains_words(normalized, &[&["oblique"]]) {
        return ("oblique".to_owned(), "Oblique".to_owned());
    }
    let label = if normalized.is_empty() {
        "Normal".to_owned()
    } else {
        title_case(normalized)
    };
    ("normal".to_owned(), label)
}

/// What `inferFontMetaFromFileName` makes of an installed font's file name.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct InferredMeta {
    pub family_name: String,
    pub weight: String,
    pub weight_label: String,
    pub style: String,
    pub style_label: String,
}

pub fn infer_from_file_name(file_name: &str) -> InferredMeta {
    // `/\.[^.]+$/`: the last dot, if anything follows it.
    let base = match file_name.rfind('.') {
        Some(dot) if dot + 1 < file_name.len() => &file_name[..dot],
        _ => file_name,
    };
    let normalized = collapse(&collapse(base, |c| c == '_' || c == '-'), is_js_space);
    let normalized = js_trim(&normalized);

    let (style, style_label) = normalize_style(Some(normalized));
    let (weight, weight_label) = normalize_weight(Some(normalized));
    let family = collapse(&remove_words(normalized, &DESCRIPTOR_WORDS), is_js_space);
    let family = js_trim(&family);

    InferredMeta {
        family_name: if !family.is_empty() {
            family.to_owned()
        } else if !normalized.is_empty() {
            normalized.to_owned()
        } else {
            "Custom Font".to_owned()
        },
        weight,
        weight_label,
        style,
        style_label,
    }
}

/// `getFontFileMimeType`.
pub fn mime_type(file_name: &str) -> &'static str {
    let lower = file_name.to_lowercase();
    if lower.ends_with(".otf") {
        "font/otf"
    } else if lower.ends_with(".woff2") {
        "font/woff2"
    } else if lower.ends_with(".woff") {
        "font/woff"
    } else {
        "font/ttf"
    }
}

// --- Order ------------------------------------------------------------------

/// `Number.parseInt(weight, 10) || 400`.
fn weight_sort_value(weight: &str) -> i64 {
    let trimmed = weight.trim_start_matches(is_js_space);
    let (sign, digits) = match trimmed.strip_prefix('-') {
        Some(rest) => (-1, rest),
        None => (1, trimmed.strip_prefix('+').unwrap_or(trimmed)),
    };
    let digits: String = digits.chars().take_while(char::is_ascii_digit).collect();
    match digits.parse::<i64>() {
        Ok(0) | Err(_) => 400,
        Ok(value) => sign * value,
    }
}

/// `getFontFaceSortKey`, as `<` compares it: joined with commas.
fn sort_key(face: &FontFace) -> String {
    format!(
        "{},{},{},{}",
        face.family_name.to_lowercase(),
        weight_sort_value(&face.weight),
        face.style.to_lowercase(),
        face.post_script_name.to_lowercase()
    )
}

/// JavaScript's `<` on strings: by UTF-16 code unit.
fn code_unit_order(a: &str, b: &str) -> Ordering {
    a.encode_utf16().cmp(b.encode_utf16())
}

/// `sortFontFaces`.
pub fn sort_faces(mut faces: Vec<FontFace>) -> Vec<FontFace> {
    faces.sort_by(|left, right| code_unit_order(&sort_key(left), &sort_key(right)));
    faces
}

/// `dedupeFontFaces`.
pub fn dedupe_faces(faces: Vec<FontFace>) -> Vec<FontFace> {
    let mut seen = HashSet::new();
    let unique = faces
        .into_iter()
        .filter(|face| {
            let source = match face.source {
                FontSource::System => "system",
                FontSource::Custom => "custom",
            };
            seen.insert(format!(
                "{source}|{}|{}|{}|{}|{}",
                face.family_name,
                face.post_script_name,
                face.weight,
                face.style,
                face.file_name.as_deref().unwrap_or("")
            ))
        })
        .collect();
    sort_faces(unique)
}

// --- The system font list -----------------------------------------------------

/// What font-list's macOS helper prints for a family: guesses from its first
/// member's PostScript name (`fontlist2.m`).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FamilyEntry {
    pub family_name: String,
    pub post_script_name: String,
    pub weight: &'static str,
    pub style: &'static str,
    pub width: &'static str,
    pub monospace: bool,
}

const MONOSPACE_HINTS: [&str; 12] = [
    "mono",
    "courier",
    "console",
    "terminal",
    "fixed",
    "typewriter",
    "source",
    "code",
    "fira",
    "jetbrains",
    "menlo",
    "monaco",
];

pub fn describe_family(family_name: &str, post_script_name: &str) -> FamilyEntry {
    let lower = post_script_name.to_lowercase();
    let has = |needle: &str| lower.contains(needle);

    let weight = if has("ultralight") || has("thin") {
        "ultralight"
    } else if has("light") {
        "light"
    } else if has("medium") {
        "medium"
    } else if has("semibold") || has("demibold") {
        "semibold"
    } else if has("bold") {
        "bold"
    } else if has("heavy") || has("black") {
        "heavy"
    } else {
        "regular"
    };
    let style = if has("italic") || has("oblique") {
        "italic"
    } else {
        "normal"
    };
    let width = if has("condensed") || has("narrow") {
        "condensed"
    } else if has("expanded") || has("extended") {
        "expanded"
    } else {
        "normal"
    };

    FamilyEntry {
        family_name: family_name.to_owned(),
        post_script_name: post_script_name.to_owned(),
        weight,
        style,
        width,
        monospace: MONOSPACE_HINTS.iter().any(|hint| has(hint)),
    }
}

/// One face of a family, as the platform describes it: its weight on the
/// CSS scale and whether it is italic, where the platform says, and
/// otherwise the guesses `describe_family` makes from its PostScript name.
///
/// The list used to hold only each family's first face, which is why every
/// font offered one weight: Arial had no Bold, Helvetica Neue no Light.
pub fn describe_member(
    family_name: &str,
    post_script_name: &str,
    css_weight: Option<u16>,
    italic: Option<bool>,
) -> FamilyEntry {
    let mut entry = describe_family(family_name, post_script_name);
    if let Some(weight) = css_weight {
        entry.weight = css_weight_name(weight);
    }
    if let Some(italic) = italic {
        entry.style = if italic { "italic" } else { "normal" };
    }
    entry
}

/// A CSS weight as the nearest hundred, which `normalize_weight` reads.
fn css_weight_name(weight: u16) -> &'static str {
    match (u32::from(weight) + 50) / 100 {
        0 | 1 => "100",
        2 => "200",
        3 => "300",
        4 => "400",
        5 => "500",
        6 => "600",
        7 => "700",
        8 => "800",
        _ => "900",
    }
}

/// `NSFontManager`'s weight (0 to 15, 5 regular, 9 bold) on the CSS scale.
pub fn css_weight_from_apple(weight: isize) -> u16 {
    match weight {
        ..=1 => 100,
        2 => 200,
        3 | 4 => 300,
        5 => 400,
        6 => 500,
        7 | 8 => 600,
        9 => 700,
        10 => 800,
        _ => 900,
    }
}

/// font-list's `standardize` with quoting disabled: `\uXXXX` escapes decoded,
/// either case of `u`, then one pair of surrounding double quotes removed.
pub fn standardize_name(name: &str) -> String {
    let characters: Vec<char> = name.chars().collect();
    let mut unescaped = String::with_capacity(name.len());
    let mut index = 0;
    while index < characters.len() {
        let escape = characters[index] == '\\'
            && matches!(characters.get(index + 1), Some('u' | 'U'))
            && characters.len() >= index + 6
            && characters[index + 2..index + 6]
                .iter()
                .all(char::is_ascii_hexdigit);
        if escape {
            let hex: String = characters[index + 2..index + 6].iter().collect();
            let code = u32::from_str_radix(&hex, 16).unwrap_or(0xfffd);
            // A lone surrogate is a valid JavaScript string and not a Rust one.
            unescaped.push(char::from_u32(code).unwrap_or('\u{fffd}'));
            index += 6;
        } else {
            unescaped.push(characters[index]);
            index += 1;
        }
    }

    if unescaped.starts_with('"') && unescaped.ends_with('"') {
        return unescaped
            .get(1..unescaped.len().saturating_sub(1))
            .unwrap_or("")
            .to_owned();
    }
    unescaped
}

/// font-list's sort key: leading quotes dropped, lower-cased.
fn font_list_key(name: &str) -> String {
    name.trim_start_matches(['\'', '"']).to_lowercase()
}

/// `get-system-fonts`, from the family names the platform lists.
pub fn system_families(names: &[String]) -> Vec<String> {
    let mut seen = HashSet::new();
    let mut listed: Vec<String> = names
        .iter()
        .filter(|name| seen.insert(name.as_str()))
        .filter(|name| !name.is_empty() && !FONT_LIST_EXCEPTIONS.contains(&name.as_str()))
        .map(|name| standardize_name(name))
        .collect();
    // font-list's comparator never says "equal"; ties keep their order here.
    listed.sort_by(|a, b| code_unit_order(&font_list_key(a), &font_list_key(b)));

    let mut seen = HashSet::new();
    let mut families: Vec<String> = listed
        .iter()
        .map(|name| js_trim(name).to_owned())
        .filter(|name| !name.is_empty())
        .filter(|name| seen.insert(name.clone()))
        .collect();
    families.sort_by(|a, b| collation::locale_order(a, b));
    families
}

/// `get-system-font-faces`, from what the platform lists for each family.
pub fn system_faces(entries: &[FamilyEntry]) -> Vec<FontFace> {
    let mut listed: Vec<FamilyEntry> = entries
        .iter()
        .filter(|entry| {
            !entry.family_name.is_empty()
                && !FONT_LIST_EXCEPTIONS.contains(&entry.family_name.as_str())
        })
        .map(|entry| FamilyEntry {
            family_name: standardize_name(&entry.family_name),
            ..entry.clone()
        })
        .collect();
    listed.sort_by(|a, b| {
        code_unit_order(
            &font_list_key(&a.family_name),
            &font_list_key(&b.family_name),
        )
    });

    let faces = listed
        .into_iter()
        .map(|entry| {
            let (weight, weight_label) = normalize_weight(Some(entry.weight));
            let (style, style_label) = normalize_style(Some(entry.style));
            FontFace {
                family_name: js_trim(&entry.family_name).to_owned(),
                post_script_name: js_trim(&entry.post_script_name).to_owned(),
                weight,
                weight_label,
                style,
                style_label,
                width: js_trim(entry.width).to_owned(),
                monospace: entry.monospace,
                source: FontSource::System,
                file_name: None,
                file_path: None,
                data_url: None,
            }
        })
        .filter(|face| !face.family_name.is_empty() && !face.post_script_name.is_empty())
        .collect();
    dedupe_faces(faces)
}

// --- Installed fonts --------------------------------------------------------

/// `path.parse(fileName)` for a bare file name: the stem and the extension.
pub fn split_file_name(file_name: &str) -> (&str, &str) {
    match file_name.rfind('.') {
        Some(dot) if dot > 0 => (&file_name[..dot], &file_name[dot..]),
        _ => (file_name, ""),
    }
}

pub fn is_supported_font_file(file_name: &str) -> bool {
    let extension = split_file_name(file_name).1.to_lowercase();
    SUPPORTED_EXTENSIONS.contains(&extension.as_str())
}

/// `Name.ttf`, then `Name 1.ttf`, `Name 2.ttf`… — never a name `exists` says is
/// taken.
pub fn unique_file_name(original: &str, exists: impl Fn(&str) -> bool) -> String {
    let (stem, extension) = split_file_name(original);
    let extension = if extension.is_empty() {
        ".ttf"
    } else {
        extension
    };
    let stem = js_trim(stem);
    let stem = if stem.is_empty() { "Custom Font" } else { stem };

    let mut candidate = format!("{stem}{extension}");
    let mut counter = 1u32;
    while exists(&candidate) {
        candidate = format!("{stem} {counter}{extension}");
        counter += 1;
    }
    candidate
}

/// An installed font as the pickers list it.
pub fn custom_face(file_name: &str, file_path: &str, bytes: &[u8]) -> FontFace {
    let mut inferred = infer_from_file_name(file_name);
    // What the font says it is wins over what its file name suggests: a
    // deck's embedded font is saved as `Raleway-700-1a2b3c4d.ttf`.
    if let Some((family, weight, italic)) = crate::services::pptx::fonts::describe(bytes) {
        let (weight, weight_label) = normalize_weight(Some(&weight.to_string()));
        let (style, style_label) = normalize_style(Some(if italic { "italic" } else { "normal" }));
        inferred = InferredMeta {
            family_name: family,
            weight,
            weight_label,
            style,
            style_label,
        };
    }
    let encoded = base64::engine::general_purpose::STANDARD.encode(bytes);
    FontFace {
        family_name: inferred.family_name,
        post_script_name: split_file_name(file_name).0.to_owned(),
        weight: inferred.weight,
        weight_label: inferred.weight_label,
        style: inferred.style,
        style_label: inferred.style_label,
        width: String::new(),
        monospace: false,
        source: FontSource::Custom,
        file_name: Some(file_name.to_owned()),
        file_path: Some(file_path.to_owned()),
        data_url: Some(format!("data:{};base64,{encoded}", mime_type(file_name))),
    }
}

fn face_from_file(path: &Path) -> AppResult<FontFace> {
    let file_name = path
        .file_name()
        .map(|name| name.to_string_lossy().into_owned())
        .unwrap_or_default();
    let bytes = std::fs::read(path)?;
    Ok(custom_face(&file_name, &path.to_string_lossy(), &bytes))
}

/// `get-custom-fonts`: every font file directly in `directory`.
pub fn list_custom(directory: &Path) -> AppResult<Vec<FontFace>> {
    if !directory.exists() {
        return Ok(Vec::new());
    }
    let mut faces = Vec::new();
    for entry in std::fs::read_dir(directory)? {
        let entry = entry?;
        if !entry.file_type()?.is_file() {
            continue;
        }
        let name = entry.file_name().to_string_lossy().into_owned();
        if !is_supported_font_file(&name) {
            continue;
        }
        faces.push(face_from_file(&directory.join(&name))?);
    }
    Ok(dedupe_faces(faces))
}

/// `install-custom-fonts`: copy each font file into `directory` under a name
/// not already taken, and list the copies. Anything not a font is skipped.
pub fn install_custom(directory: &Path, sources: &[PathBuf]) -> AppResult<Vec<FontFace>> {
    std::fs::create_dir_all(directory)?;
    let mut installed = Vec::new();
    for source in sources {
        let Some(name) = source
            .file_name()
            .map(|name| name.to_string_lossy().into_owned())
        else {
            continue;
        };
        if !is_supported_font_file(&name) {
            continue;
        }
        let target = directory.join(unique_file_name(&name, |candidate| {
            directory.join(candidate).exists()
        }));
        std::fs::copy(source, &target)?;
        installed.push(target);
    }
    installed.iter().map(|path| face_from_file(path)).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    // The cases of tests/font-catalog.test.mjs.

    fn weight(raw: Option<&str>) -> String {
        let (value, label) = normalize_weight(raw);
        format!("{value} {label}")
    }

    #[test]
    fn a_numeric_weight_is_clamped_to_100_900_and_rounded_to_the_hundred() {
        assert_eq!(weight(Some("700")), "700 Bold");
        assert_eq!(weight(Some("650")), "700 Bold");
        assert_eq!(weight(Some("150")), "200 Extra Light");
        assert_eq!(weight(Some("1000")), "900 Black");
        assert_eq!(weight(Some("50")), "100 Thin");
        assert_eq!(weight(Some("99999999999999999999")), "900 Black");
        assert_eq!(weight(Some(" 400 ")), "400 Regular");
    }

    #[test]
    fn a_named_weight_takes_the_first_hint_whose_whole_word_it_contains() {
        assert_eq!(weight(Some("bold")), "700 Bold");
        assert_eq!(weight(Some("Semi-Bold")), "600 Semibold");
        assert_eq!(weight(Some("ultralight")), "200 Extra Light");
        assert_eq!(weight(Some("heavy")), "800 Extra Bold");
        assert_eq!(weight(Some("black")), "900 Black");
        assert_eq!(weight(Some("Extra Bold")), "700 Bold");
        assert_eq!(weight(Some("ExtraBold")), "800 Extra Bold");
    }

    #[test]
    fn an_unrecognised_weight_is_400_labelled_with_its_own_name_in_title_case() {
        assert_eq!(weight(Some("foo_bar-baz")), "400 Foo Bar Baz");
        assert_eq!(weight(Some("élan")), "400 éLan");
        assert_eq!(weight(Some("")), "400 Regular");
        assert_eq!(weight(None), "400 Regular");
    }

    #[test]
    fn a_style_is_italic_or_oblique_by_whole_word_otherwise_normal_with_its_own_label() {
        let style = |raw| normalize_style(Some(raw));
        assert_eq!(style("italic"), ("italic".into(), "Italic".into()));
        assert_eq!(style("Oblique"), ("oblique".into(), "Oblique".into()));
        assert_eq!(style("BoldItalic"), ("normal".into(), "BoldItalic".into()));
        assert_eq!(
            style("slanted-ish"),
            ("normal".into(), "Slanted Ish".into())
        );
        assert_eq!(style(""), ("normal".into(), "Normal".into()));
    }

    #[test]
    fn an_installed_font_is_named_from_its_file_name() {
        let meta = |file_name| {
            let inferred = infer_from_file_name(file_name);
            [
                inferred.family_name,
                inferred.weight,
                inferred.weight_label,
                inferred.style,
                inferred.style_label,
            ]
        };
        assert_eq!(
            meta("Open_Sans-Bold.otf"),
            ["Open Sans", "700", "Bold", "normal", "Open Sans Bold"]
        );
        assert_eq!(
            meta("Lato-Black.woff2"),
            ["Lato", "900", "Black", "normal", "Lato Black"]
        );
        assert_eq!(
            meta("Roboto Condensed Light.ttf"),
            [
                "Roboto Condensed",
                "300",
                "Light",
                "normal",
                "Roboto Condensed Light"
            ]
        );
        assert_eq!(
            meta("Inter-ExtraBold.woff"),
            ["Inter", "800", "Extra Bold", "normal", "Inter ExtraBold"]
        );
        assert_eq!(
            meta("Lato-Italic.ttf"),
            ["Lato", "400", "Lato Italic", "italic", "Italic"]
        );
        assert_eq!(
            meta("Montserrat-SemiBoldItalic.ttf"),
            [
                "Montserrat SemiBoldItalic",
                "400",
                "Montserrat SemiBoldItalic",
                "normal",
                "Montserrat SemiBoldItalic"
            ]
        );
        assert_eq!(meta("Bold.ttf"), ["Bold", "700", "Bold", "normal", "Bold"]);
        assert_eq!(
            meta(".ttf"),
            ["Custom Font", "400", "Regular", "normal", "Normal"]
        );
        assert_eq!(meta("a.b.ttf"), ["a.b", "400", "A.B", "normal", "A.B"]);
    }

    #[test]
    fn the_mime_type_follows_the_extension_and_anything_else_is_truetype() {
        assert_eq!(mime_type("a.OTF"), "font/otf");
        assert_eq!(mime_type("a.woff2"), "font/woff2");
        assert_eq!(mime_type("a.woff"), "font/woff");
        assert_eq!(mime_type("a.ttf"), "font/ttf");
        assert_eq!(mime_type("a.txt"), "font/ttf");
    }

    #[test]
    fn only_ttf_otf_woff_and_woff2_files_are_fonts_whatever_the_case() {
        assert!(is_supported_font_file("Lato.TTF"));
        assert!(is_supported_font_file("Lato.woff2"));
        assert!(!is_supported_font_file("Lato.eot"));
        assert!(!is_supported_font_file(".ttf"));
        assert!(!is_supported_font_file("ttf"));
    }

    #[test]
    fn an_installed_copy_never_overwrites_one_already_there() {
        assert_eq!(
            unique_file_name("Lato.ttf", |name| name == "Lato.ttf"),
            "Lato 1.ttf"
        );
        assert_eq!(
            unique_file_name("Lato.ttf", |name| ["Lato.ttf", "Lato 1.ttf"]
                .contains(&name)),
            "Lato 2.ttf"
        );
        assert_eq!(unique_file_name("  Lato  .otf", |_| false), "Lato.otf");
        assert_eq!(unique_file_name(" .ttf", |_| false), "Custom Font.ttf");
        assert_eq!(unique_file_name("noext", |_| false), "noext.ttf");
    }

    #[test]
    fn an_installed_font_is_listed_with_its_bytes_as_a_data_url() {
        let face = custom_face("Lato-BoldItalic.ttf", "/fonts/Lato-BoldItalic.ttf", b"ABC");
        assert_eq!(
            serde_json::to_value(&face).unwrap(),
            serde_json::json!({
                "familyName": "Lato BoldItalic",
                "postScriptName": "Lato-BoldItalic",
                "weight": "400",
                "weightLabel": "Lato BoldItalic",
                "style": "normal",
                "styleLabel": "Lato BoldItalic",
                "width": "",
                "monospace": false,
                "source": "custom",
                "fileName": "Lato-BoldItalic.ttf",
                "filePath": "/fonts/Lato-BoldItalic.ttf",
                "dataUrl": "data:font/ttf;base64,QUJD",
            })
        );
    }

    fn system(family: &str, post_script: &str, weight: &str, style: &str) -> FontFace {
        FontFace {
            family_name: family.into(),
            post_script_name: post_script.into(),
            weight: weight.into(),
            weight_label: String::new(),
            style: style.into(),
            style_label: String::new(),
            width: String::new(),
            monospace: false,
            source: FontSource::System,
            file_name: None,
            file_path: None,
            data_url: None,
        }
    }

    #[test]
    fn faces_are_deduplicated_and_sorted_by_one_joined_lower_cased_string() {
        let sorted: Vec<String> = dedupe_faces(vec![
            system("Zed", "Zed", "400", "normal"),
            system("arial", "Arial-Bold", "700", "normal"),
            system("Arial", "Arial", "400", "normal"),
            system("Arial", "Arial", "400", "normal"),
            system("Arial", "Arial-Italic", "400", "italic"),
            system("A,b", "x", "400", "normal"),
            system("A", "x", "1000", "normal"),
            system("Éclat", "Eclat", "400", "normal"),
        ])
        .into_iter()
        .map(|face| {
            format!(
                "{}/{}/{}/{}",
                face.family_name, face.post_script_name, face.weight, face.style
            )
        })
        .collect();
        assert_eq!(
            sorted,
            [
                "A/x/1000/normal",
                "A,b/x/400/normal",
                "Arial/Arial-Italic/400/italic",
                "Arial/Arial/400/normal",
                "arial/Arial-Bold/700/normal",
                "Zed/Zed/400/normal",
                "Éclat/Eclat/400/normal",
            ]
        );
    }

    #[test]
    fn font_list_drops_iconfont_and_unquotes_names() {
        assert_eq!(standardize_name("\"Quoted Name\""), "Quoted Name");
        assert_eq!(standardize_name("\\u559c\\u9e4aX"), "喜鹊X");
        assert_eq!(
            standardize_name("\\U559cX\\u9e4a"),
            "喜X鹊",
            "either case, in order"
        );
        assert_eq!(
            standardize_name("\\uZZZZ"),
            "\\uZZZZ",
            "not hex, left alone"
        );
        assert_eq!(standardize_name("\""), "");
        let names: Vec<String> = [
            "b",
            "A",
            "a",
            "iconfont",
            "",
            "  Spaced  ",
            "Spaced",
            "\"Q\"",
        ]
        .map(str::to_owned)
        .to_vec();
        assert_eq!(system_families(&names), ["a", "A", "b", "Q", "Spaced"]);
    }

    #[test]
    fn every_face_of_a_family_is_listed_with_its_own_weight() {
        let entries = [
            describe_member(
                "Arial",
                "ArialMT",
                Some(css_weight_from_apple(5)),
                Some(false),
            ),
            describe_member(
                "Arial",
                "Arial-BoldMT",
                Some(css_weight_from_apple(9)),
                Some(false),
            ),
            describe_member(
                "Arial",
                "Arial-BoldItalicMT",
                Some(css_weight_from_apple(9)),
                Some(true),
            ),
            describe_member(
                "Helvetica Neue",
                "HelveticaNeue-Light",
                Some(300),
                Some(false),
            ),
            // Nothing from the platform: guessed from the name, as before.
            describe_member("Avenir", "Avenir-Heavy", None, None),
        ];
        let faces: Vec<(String, String, String)> = system_faces(&entries)
            .into_iter()
            .map(|face| (face.family_name, face.weight, face.style))
            .collect();
        assert_eq!(
            faces,
            [
                ("Arial".into(), "400".into(), "normal".into()),
                ("Arial".into(), "700".into(), "italic".into()),
                ("Arial".into(), "700".into(), "normal".into()),
                ("Avenir".into(), "800".into(), "normal".into()),
                ("Helvetica Neue".into(), "300".into(), "normal".into()),
            ]
        );
    }

    #[test]
    fn apple_weights_land_on_the_css_scale() {
        assert_eq!(css_weight_from_apple(3), 300);
        assert_eq!(css_weight_from_apple(5), 400);
        assert_eq!(css_weight_from_apple(6), 500);
        assert_eq!(css_weight_from_apple(8), 600);
        assert_eq!(css_weight_from_apple(9), 700);
        assert_eq!(css_weight_from_apple(11), 900);
        assert_eq!(css_weight_name(350), "400");
        assert_eq!(css_weight_name(950), "900");
    }

    #[test]
    fn system_faces_use_the_helpers_guesses() {
        let entries = [
            describe_family("Helvetica Neue", "HelveticaNeue"),
            describe_family("iconfont", "x"),
            describe_family("Menlo", "Menlo-Regular"),
            describe_family("Arial Black", "Arial-Black"),
        ];
        let faces: Vec<(String, String, String, String, bool)> = system_faces(&entries)
            .into_iter()
            .map(|face| {
                (
                    face.family_name,
                    face.weight,
                    face.weight_label,
                    face.width,
                    face.monospace,
                )
            })
            .collect();
        assert_eq!(
            faces,
            [
                (
                    "Arial Black".into(),
                    "800".into(),
                    "Extra Bold".into(),
                    "normal".into(),
                    false
                ),
                (
                    "Helvetica Neue".into(),
                    "400".into(),
                    "Regular".into(),
                    "normal".into(),
                    false
                ),
                (
                    "Menlo".into(),
                    "400".into(),
                    "Regular".into(),
                    "normal".into(),
                    true
                ),
            ]
        );
    }

    #[test]
    fn the_helpers_guesses_from_a_post_script_name() {
        let guess = |post_script| {
            let entry = describe_family("F", post_script);
            (entry.weight, entry.style, entry.width, entry.monospace)
        };
        assert_eq!(
            guess("HelveticaNeue-Thin"),
            ("ultralight", "normal", "normal", false)
        );
        assert_eq!(
            guess("Avenir-LightOblique"),
            ("light", "italic", "normal", false)
        );
        assert_eq!(
            guess("Futura-CondensedMedium"),
            ("medium", "normal", "condensed", false)
        );
        assert_eq!(
            guess("Georgia-BoldItalic"),
            ("bold", "italic", "normal", false)
        );
        assert_eq!(guess("Arial-Black"), ("heavy", "normal", "normal", false));
        assert_eq!(
            guess("SourceSansPro-Regular"),
            ("regular", "normal", "normal", true)
        );
        assert_eq!(guess("Semibold"), ("semibold", "normal", "normal", false));
        assert_eq!(guess("Extended"), ("regular", "normal", "expanded", false));
    }

    #[test]
    fn installing_copies_fonts_under_free_names_and_lists_them() {
        let root = std::env::temp_dir().join(format!("present-fonts-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        let picked = root.join("picked");
        std::fs::create_dir_all(&picked).unwrap();
        std::fs::write(picked.join("Lato-Bold.ttf"), b"font").unwrap();
        std::fs::write(picked.join("notes.txt"), b"text").unwrap();
        let installed_into = root.join("custom-fonts");

        let first = install_custom(
            &installed_into,
            &[picked.join("Lato-Bold.ttf"), picked.join("notes.txt")],
        )
        .unwrap();
        assert_eq!(first.len(), 1, "the text file is skipped");
        let second = install_custom(&installed_into, &[picked.join("Lato-Bold.ttf")]).unwrap();
        assert_eq!(second[0].file_name.as_deref(), Some("Lato-Bold 1.ttf"));

        std::fs::create_dir_all(installed_into.join("Folder.ttf")).unwrap();
        let listed: Vec<String> = list_custom(&installed_into)
            .unwrap()
            .into_iter()
            .filter_map(|face| face.file_name)
            .collect();
        assert_eq!(listed.len(), 2, "a folder is not a font: {listed:?}");
        assert!(list_custom(&root.join("missing")).unwrap().is_empty());
        let _ = std::fs::remove_dir_all(root);
    }
}
