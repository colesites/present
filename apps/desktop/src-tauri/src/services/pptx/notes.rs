//! A slide's speaker notes: the words in its notes page's body placeholder.
//!
//! The notes page (`notesSlide`) is a part of its own, related to the slide.
//! It holds a picture of the slide and a body placeholder (`p:ph type="body"`)
//! with the notes; each paragraph is a line, `a:br` a line break inside one.

use roxmltree::{Document, Node};

use super::package::Package;
use super::xml::{self, A, P};

pub const RT_NOTES_SLIDE: &str =
    "http://schemas.openxmlformats.org/officeDocument/2006/relationships/notesSlide";

/// The notes of the slide at `slide_part`, if it has any words in them.
pub fn read(package: &Package, slide_part: &str) -> Option<String> {
    let notes_part = package
        .related_by_type(slide_part, RT_NOTES_SLIDE)
        .ok()
        .flatten()?;
    let text = package.text(&notes_part)?;
    let document = Document::parse(&text).ok()?;
    notes_of(document.root_element())
}

fn notes_of(root: Node) -> Option<String> {
    let body = root.descendants().find(|node| {
        xml::is(*node, P, "sp")
            && node
                .descendants()
                .find(|child| xml::is(*child, P, "ph"))
                .is_some_and(|ph| ph.attribute("type") == Some("body"))
    })?;
    let text_body = xml::child(body, P, "txBody")?;
    let lines: Vec<String> = xml::children(text_body, A, "p")
        .map(|paragraph| {
            let mut line = String::new();
            for part in xml::elements(paragraph) {
                if xml::is(part, A, "r") || xml::is(part, A, "fld") {
                    if let Some(words) = xml::child(part, A, "t").and_then(|t| t.text()) {
                        line.push_str(words);
                    }
                } else if xml::is(part, A, "br") {
                    line.push('\n');
                }
            }
            line
        })
        .collect();
    let notes = lines.join("\n").trim().to_owned();
    (!notes.is_empty()).then_some(notes)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_body_placeholders_words_line_by_line() {
        let xml = r#"<p:notes xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><p:cSld><p:spTree>
            <p:sp><p:nvSpPr><p:cNvPr id="2" name="Slide Image"/><p:cNvSpPr/><p:nvPr><p:ph type="sldImg"/></p:nvPr></p:nvSpPr></p:sp>
            <p:sp><p:nvSpPr><p:cNvPr id="3" name="Notes"/><p:cNvSpPr/><p:nvPr><p:ph type="body" idx="1"/></p:nvPr></p:nvSpPr>
              <p:txBody><a:bodyPr/><a:p><a:r><a:t>Welcome everyone.</a:t></a:r></a:p><a:p><a:r><a:t>Pause for </a:t></a:r><a:r><a:t>the video.</a:t></a:r><a:br/><a:r><a:t>Then pray.</a:t></a:r></a:p><a:p/></p:txBody></p:sp>
            <p:sp><p:nvSpPr><p:cNvPr id="4" name="Number"/><p:cNvSpPr/><p:nvPr><p:ph type="sldNum" idx="5"/></p:nvPr></p:nvSpPr><p:txBody><a:p><a:r><a:t>3</a:t></a:r></a:p></p:txBody></p:sp>
          </p:spTree></p:cSld></p:notes>"#;
        let document = Document::parse(xml).unwrap();
        assert_eq!(
            notes_of(document.root_element()).as_deref(),
            Some("Welcome everyone.\nPause for the video.\nThen pray.")
        );
    }

    #[test]
    fn a_notes_page_with_no_words_is_none() {
        let xml = r#"<p:notes xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><p:cSld><p:spTree>
            <p:sp><p:nvSpPr><p:nvPr><p:ph type="body"/></p:nvPr></p:nvSpPr><p:txBody><a:p/></p:txBody></p:sp>
          </p:spTree></p:cSld></p:notes>"#;
        let document = Document::parse(xml).unwrap();
        assert_eq!(notes_of(document.root_element()), None);
    }
}
