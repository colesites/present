//! The fonts a deck carries.
//!
//! PowerPoint embeds fonts as Embedded OpenType: a header, then the font. An
//! uncompressed one is the font as it is (some XORed with 0x50); one
//! compressed with MicroType Express needs a decompressor this does not have
//! yet, and is left out — its text falls back to a font on the machine.
//!
//! A deck names a font by what its text calls it, which is not always the
//! font's own family: Canva embeds "Raleway Bold" as a font whose family is
//! "Raleway" at weight 700. So each embedded font is read for its real
//! family, weight and style, installed among the app's fonts, and the deck's
//! text is pointed at it by those.

use std::path::{Path, PathBuf};

use cosmic_text::fontdb;
use serde_json::Value;

use super::deck::EmbeddedFontPart;
use super::package::Package;

const EOT_MAGIC: u16 = 0x504C;
const FLAG_COMPRESSED: u32 = 0x4;
const FLAG_XOR: u32 = 0x1000_0000;

/// An embedded font, installed.
#[derive(Debug, Clone, PartialEq)]
pub struct InstalledFont {
    /// What the deck's text calls it.
    pub typeface: String,
    /// Which of the typeface's faces the deck embedded it as.
    pub bold: bool,
    pub italic: bool,
    /// What it is.
    pub family: String,
    pub weight: u16,
    pub italic_face: bool,
    pub path: PathBuf,
}

/// The font inside an Embedded OpenType file, or the bytes themselves when
/// they are a font already. `None` for a compressed one.
pub fn unwrap(bytes: &[u8]) -> Option<Vec<u8>> {
    let u32_at = |at: usize| {
        bytes
            .get(at..at + 4)
            .map(|b| u32::from_le_bytes([b[0], b[1], b[2], b[3]]))
    };
    let magic = bytes.get(34..36).map(|b| u16::from_le_bytes([b[0], b[1]]));
    if magic != Some(EOT_MAGIC) {
        return is_font(bytes).then(|| bytes.to_vec());
    }
    let total = u32_at(0)? as usize;
    let data_size = u32_at(4)? as usize;
    let flags = u32_at(12)?;
    if flags & FLAG_COMPRESSED != 0 {
        return None;
    }
    let end = total.min(bytes.len());
    let start = end.checked_sub(data_size)?;
    let mut font = bytes.get(start..end)?.to_vec();
    if flags & FLAG_XOR != 0 {
        for byte in &mut font {
            *byte ^= 0x50;
        }
    }
    is_font(&font).then_some(font)
}

fn is_font(bytes: &[u8]) -> bool {
    matches!(
        bytes.get(..4),
        Some([0, 1, 0, 0] | b"OTTO" | b"true" | b"ttcf")
    )
}

/// A font's own family, weight and whether it is italic.
pub fn describe(bytes: &[u8]) -> Option<(String, u16, bool)> {
    let mut database = fontdb::Database::new();
    database.load_font_data(bytes.to_vec());
    let face = database.faces().next()?;
    let family = face
        .families
        .iter()
        .find(|(_, language)| *language == fontdb::Language::English_UnitedStates)
        .or_else(|| face.families.first())
        .map(|(name, _)| name.clone())?;
    Some((family, face.weight.0, face.style != fontdb::Style::Normal))
}

/// Install each font `parts` names into `directory`, each file once.
pub fn install(
    package: &Package,
    parts: &[EmbeddedFontPart],
    directory: &Path,
) -> Vec<InstalledFont> {
    let mut installed = Vec::new();
    for part in parts {
        let Some(font) = package.bytes(&part.part).and_then(unwrap) else {
            tracing::info!(
                typeface = part.typeface,
                "an embedded font is compressed and was left out"
            );
            continue;
        };
        let Some((family, weight, italic_face)) = describe(&font) else {
            continue;
        };
        let extension = if font.starts_with(b"OTTO") {
            "otf"
        } else {
            "ttf"
        };
        let hash = blake3::hash(&font).to_hex();
        let safe: String = family
            .chars()
            .map(|c| if c.is_ascii_alphanumeric() { c } else { '-' })
            .collect();
        // Named so the font catalog reads its family and weight from the name.
        let path = directory.join(format!(
            "{safe}-{weight}{}-{}.{extension}",
            if italic_face { "-Italic" } else { "" },
            &hash[..8]
        ));
        if !path.exists() {
            if let Err(error) =
                std::fs::create_dir_all(directory).and_then(|()| std::fs::write(&path, &font))
            {
                tracing::warn!(%error, family, "an embedded font could not be installed");
                continue;
            }
        }
        installed.push(InstalledFont {
            typeface: part.typeface.clone(),
            bold: part.bold,
            italic: part.italic,
            family,
            weight,
            italic_face,
            path,
        });
    }
    installed
}

/// Point every run, bullet and text style of the deck that names an embedded
/// typeface at the installed font it is: its real family, weight and style.
pub fn rename(presentation: &mut Value, installed: &[InstalledFont]) {
    if installed.is_empty() {
        return;
    }
    let find = |typeface: &str, bold: bool, italic: bool| {
        installed
            .iter()
            .find(|font| font.typeface == typeface && font.bold == bold && font.italic == italic)
            .or_else(|| {
                installed
                    .iter()
                    .find(|font| font.typeface == typeface && !font.bold && !font.italic)
            })
            .or_else(|| installed.iter().find(|font| font.typeface == typeface))
    };
    let fix = |object: &mut serde_json::Map<String, Value>| {
        let Some(typeface) = object
            .get("fontFamily")
            .and_then(Value::as_str)
            .map(str::to_owned)
        else {
            return;
        };
        let bold = object
            .get("fontWeight")
            .and_then(Value::as_str)
            .is_some_and(|w| w == "700");
        let italic = object.get("fontStyle").and_then(Value::as_str) == Some("italic");
        let Some(font) = find(&typeface, bold, italic) else {
            return;
        };
        object.insert("fontFamily".into(), Value::String(font.family.clone()));
        // An embedded face that is bold already is drawn at its own weight;
        // a regular face asked to be bold is made so by the renderer.
        let weight = if bold && font.weight < 600 {
            700
        } else {
            font.weight
        };
        if object.contains_key("fontWeight") {
            object.insert("fontWeight".into(), Value::String(weight.to_string()));
        }
        if font.italic_face {
            object.insert("fontStyle".into(), Value::String("italic".into()));
        }
    };
    walk(presentation, &fix);
}

fn walk(value: &mut Value, fix: &dyn Fn(&mut serde_json::Map<String, Value>)) {
    match value {
        Value::Object(object) => {
            if object.contains_key("fontFamily") {
                fix(object);
            }
            for child in object.values_mut() {
                walk(child, fix);
            }
        }
        Value::Array(items) => {
            for item in items {
                walk(item, fix);
            }
        }
        _ => {}
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn an_uncompressed_eot_unwraps_to_its_font() {
        let font = [0u8, 1, 0, 0, 9, 9, 9, 9];
        let mut eot = vec![0u8; 40];
        let total = (eot.len() + font.len()) as u32;
        eot[0..4].copy_from_slice(&total.to_le_bytes());
        eot[4..8].copy_from_slice(&(font.len() as u32).to_le_bytes());
        eot[8..12].copy_from_slice(&0x0002_0002u32.to_le_bytes());
        eot[34..36].copy_from_slice(&EOT_MAGIC.to_le_bytes());
        eot.extend_from_slice(&font);
        assert_eq!(unwrap(&eot).as_deref(), Some(&font[..]));

        // Compressed: left out rather than misread.
        eot[12..16].copy_from_slice(&FLAG_COMPRESSED.to_le_bytes());
        assert_eq!(unwrap(&eot), None);
    }

    #[test]
    fn runs_naming_an_embedded_typeface_use_the_font_it_is() {
        let installed = [InstalledFont {
            typeface: "Raleway Bold".into(),
            bold: false,
            italic: false,
            family: "Raleway".into(),
            weight: 700,
            italic_face: false,
            path: PathBuf::from("/fonts/Raleway-700.ttf"),
        }];
        let mut deck = json!({ "slides": [{ "elements": [{ "textBody": { "paragraphs": [{ "runs": [
            { "text": "Hi", "fontFamily": "Raleway Bold", "fontWeight": "400" },
            { "text": "There", "fontFamily": "Georgia", "fontWeight": "400" }
        ]}]}}]}]});
        rename(&mut deck, &installed);
        let runs = &deck["slides"][0]["elements"][0]["textBody"]["paragraphs"][0]["runs"];
        assert_eq!(runs[0]["fontFamily"], "Raleway");
        assert_eq!(runs[0]["fontWeight"], "700");
        assert_eq!(runs[1]["fontFamily"], "Georgia");
    }
}
