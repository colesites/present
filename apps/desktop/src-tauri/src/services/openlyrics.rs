//! OpenLyrics songs (<https://docs.openlyrics.org>), the XML format OpenLP,
//! Quelea, Worship Extreme and others export, read into a library item.
//!
//! The body is written the way the lyrics editor reads one: a `[Verse 1]`
//! header over each slide's lines, a blank line between slides. Verses follow
//! the song's `verseOrder` when it has one, repeats included; a verse split
//! into several `<lines>` becomes one slide per part. Chords, comments and
//! instrumental sections are left out — the library has nowhere to show them.

use std::collections::HashMap;

use quick_xml::events::Event;
use quick_xml::{Reader, XmlVersion};
use serde::Serialize;

use crate::errors::{AppError, AppResult};

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenLyricsSong {
    pub title: String,
    /// Words, music and translation authors, in document order, once each.
    pub authors: Vec<String>,
    pub copyright: Option<String>,
    pub ccli_number: Option<String>,
    pub body: String,
    pub slide_count: usize,
}

#[derive(Default)]
struct Verse {
    /// One entry per `<lines>`, each a list of lines.
    parts: Vec<Vec<String>>,
}

/// `v1` → `Verse 1`, `c` → `Chorus`, `b2a` → `Bridge 2a`. Anything else as written.
pub fn verse_label(name: &str) -> String {
    let mut chars = name.chars();
    let Some(kind) = chars.next() else {
        return String::new();
    };
    let rest: String = chars.collect();
    let word = match kind.to_ascii_lowercase() {
        'v' => "Verse",
        'c' => "Chorus",
        'b' => "Bridge",
        'p' => "Pre-Chorus",
        'i' => "Intro",
        'e' => "Ending",
        'o' => "Other",
        _ => return name.to_owned(),
    };
    // Digits, then at most one letter: `v1`, `v1a`, `c`.
    let suffix = rest.trim_start_matches(|c: char| c.is_ascii_digit());
    let well_formed = suffix.len() <= 1 && suffix.chars().all(|c| c.is_ascii_lowercase());
    if !well_formed {
        return name.to_owned();
    }
    if rest.is_empty() {
        word.to_owned()
    } else {
        format!("{word} {rest}")
    }
}

/// Collapse the whitespace an indented XML file puts inside a line.
fn tidy(text: &str) -> String {
    text.split_whitespace().collect::<Vec<_>>().join(" ")
}

fn predefined_entity(name: &str) -> Option<char> {
    Some(match name {
        "amp" => '&',
        "lt" => '<',
        "gt" => '>',
        "quot" => '"',
        "apos" => '\'',
        _ => return None,
    })
}

fn invalid(message: impl Into<String>) -> AppError {
    AppError::Invalid(message.into())
}

pub fn parse(xml: &str) -> AppResult<OpenLyricsSong> {
    let mut reader = Reader::from_str(xml);
    let mut path: Vec<String> = Vec::new();

    let mut saw_song = false;
    let mut title: Option<String> = None;
    let mut authors: Vec<String> = Vec::new();
    let mut copyright: Option<String> = None;
    let mut ccli_number: Option<String> = None;
    let mut verse_order: Option<String> = None;
    let mut verses: Vec<(String, Verse)> = Vec::new();

    // What text is being collected, and into what.
    let mut text = String::new();
    let mut current_verse: Option<(String, Verse)> = None;
    let mut current_lines: Option<Vec<String>> = None;
    // Inside an element whose text is not lyrics.
    let mut skip_depth: Option<usize> = None;

    loop {
        let event = reader
            .read_event()
            .map_err(|error| invalid(format!("This is not a readable OpenLyrics file: {error}")))?;
        match event {
            Event::Start(start) => {
                let name = start.local_name().as_ref().to_owned();
                if path.is_empty() {
                    if name != "song" {
                        return Err(invalid("This XML file is not an OpenLyrics song."));
                    }
                    saw_song = true;
                }
                match name.as_str() {
                    "comment" | "instrument" if skip_depth.is_none() => {
                        skip_depth = Some(path.len());
                    }
                    "verse" if skip_depth.is_none() => {
                        let verse_name = start
                            .attributes()
                            .flatten()
                            .find(|attribute| attribute.key.local_name().as_ref() == "name")
                            .and_then(|attribute| {
                                attribute.normalized_value(XmlVersion::Implicit1_0).ok()
                            })
                            .map(|value| value.trim().to_owned())
                            .unwrap_or_default();
                        current_verse = Some((verse_name, Verse::default()));
                    }
                    "lines" if skip_depth.is_none() && current_verse.is_some() => {
                        current_lines = Some(Vec::new());
                        text.clear();
                    }
                    _ => {}
                }
                if matches!(
                    name.as_str(),
                    "title" | "author" | "copyright" | "ccliNo" | "verseOrder"
                ) && current_lines.is_none()
                {
                    text.clear();
                }
                path.push(name);
            }
            Event::Empty(empty) => {
                let name = empty.local_name();
                if name.as_ref() == "br" && skip_depth.is_none() {
                    if let Some(lines) = current_lines.as_mut() {
                        lines.push(tidy(&text));
                        text.clear();
                    }
                }
            }
            Event::End(_) => {
                let Some(name) = path.pop() else {
                    break;
                };
                if skip_depth == Some(path.len()) {
                    skip_depth = None;
                    continue;
                }
                if skip_depth.is_some() {
                    continue;
                }
                let parent = path.last().map(String::as_str);
                match (name.as_str(), parent) {
                    ("title", Some("titles")) if title.is_none() => {
                        let value = tidy(&text);
                        if !value.is_empty() {
                            title = Some(value);
                        }
                    }
                    ("author", Some("authors")) => {
                        let value = tidy(&text);
                        if !value.is_empty() && !authors.contains(&value) {
                            authors.push(value);
                        }
                    }
                    ("copyright", Some("properties")) => {
                        copyright = Some(tidy(&text)).filter(|value| !value.is_empty());
                    }
                    ("ccliNo", Some("properties")) => {
                        ccli_number = Some(tidy(&text)).filter(|value| !value.is_empty());
                    }
                    ("verseOrder", Some("properties")) => {
                        verse_order = Some(tidy(&text)).filter(|value| !value.is_empty());
                    }
                    ("lines", _) => {
                        if let (Some(mut lines), Some((_, verse))) =
                            (current_lines.take(), current_verse.as_mut())
                        {
                            lines.push(tidy(&text));
                            // Trailing empty lines come from a closing `<br/>`.
                            while lines.last().is_some_and(String::is_empty) {
                                lines.pop();
                            }
                            if !lines.is_empty() {
                                verse.parts.push(lines);
                            }
                        }
                        text.clear();
                    }
                    ("verse", _) => {
                        if let Some(verse) = current_verse.take() {
                            // A translation repeats a verse name; the first wins.
                            if !verse.1.parts.is_empty()
                                && !verses.iter().any(|(name, _)| *name == verse.0)
                            {
                                verses.push(verse);
                            }
                        }
                    }
                    _ => {}
                }
                if name != "lines" && current_lines.is_none() {
                    text.clear();
                }
            }
            Event::Text(content) if skip_depth.is_none() => {
                text.push_str(&content.xml10_content());
            }
            Event::CData(content) if skip_depth.is_none() => {
                text.push_str(&content.xml10_content());
            }
            Event::GeneralRef(reference) if skip_depth.is_none() => {
                if let Ok(Some(character)) = reference.resolve_char_ref() {
                    text.push(character);
                } else if let Some(character) = predefined_entity(&reference.xml10_content()) {
                    text.push(character);
                }
            }
            Event::Eof => break,
            _ => {}
        }
    }

    if !saw_song {
        return Err(invalid("This XML file is not an OpenLyrics song."));
    }
    let title = title.ok_or_else(|| invalid("The song has no title."))?;

    let by_name: HashMap<&str, &Verse> = verses
        .iter()
        .map(|(name, verse)| (name.as_str(), verse))
        .collect();
    let order: Vec<&str> = match &verse_order {
        Some(order) => order
            .split_whitespace()
            .filter(|name| by_name.contains_key(name))
            .collect(),
        None => verses.iter().map(|(name, _)| name.as_str()).collect(),
    };
    // A verse order that names nothing that exists is ignored.
    let order = if order.is_empty() {
        verses.iter().map(|(name, _)| name.as_str()).collect()
    } else {
        order
    };

    let mut blocks = Vec::new();
    for name in order {
        let verse = by_name[name];
        let label = verse_label(name);
        for part in &verse.parts {
            let mut block = String::new();
            if !label.is_empty() {
                block.push_str(&format!("[{label}]\n"));
            }
            block.push_str(&part.join("\n"));
            blocks.push(block);
        }
    }

    Ok(OpenLyricsSong {
        title,
        authors,
        copyright,
        ccli_number,
        slide_count: blocks.len(),
        body: blocks.join("\n\n"),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    const AMAZING_GRACE: &str = r#"<?xml version="1.0" encoding="UTF-8"?>
<song xmlns="http://openlyrics.info/namespace/2009/song" version="0.9" createdIn="OpenLP 3.0" modifiedDate="2024-01-01T00:00:00">
  <properties>
    <titles>
      <title>Amazing Grace</title>
      <title lang="es">Sublime Gracia</title>
    </titles>
    <authors>
      <author type="words">John Newton</author>
      <author type="music">Traditional</author>
      <author type="words">John Newton</author>
    </authors>
    <copyright>Public Domain</copyright>
    <ccliNo>22025</ccliNo>
    <verseOrder>v1 c v2 c</verseOrder>
  </properties>
  <lyrics>
    <verse name="v1">
      <lines>
        Amazing grace, how sweet the sound<br/>
        That saved a wretch like me<br/>
      </lines>
      <lines>I once was lost, but now am found<br/><comment>slow</comment>Was blind, but now I see</lines>
    </verse>
    <verse name="c">
      <lines><chord name="G"/>Praise &amp; glory &#x2014; <tag name="it">forever</tag></lines>
    </verse>
    <verse name="v2">
      <lines>'Twas grace that taught my heart to fear</lines>
    </verse>
    <verse name="v1" lang="es">
      <lines>Sublime gracia</lines>
    </verse>
    <instrument name="i1"><beat><chord name="G"/></beat></instrument>
  </lyrics>
</song>"#;

    #[test]
    fn a_song_becomes_a_title_its_credits_and_labelled_slides_in_order() {
        let song = parse(AMAZING_GRACE).unwrap();
        assert_eq!(song.title, "Amazing Grace");
        assert_eq!(song.authors, ["John Newton", "Traditional"]);
        assert_eq!(song.copyright.as_deref(), Some("Public Domain"));
        assert_eq!(song.ccli_number.as_deref(), Some("22025"));
        assert_eq!(
            song.body,
            "[Verse 1]\nAmazing grace, how sweet the sound\nThat saved a wretch like me\n\n\
             [Verse 1]\nI once was lost, but now am found\nWas blind, but now I see\n\n\
             [Chorus]\nPraise & glory \u{2014} forever\n\n\
             [Verse 2]\n'Twas grace that taught my heart to fear\n\n\
             [Chorus]\nPraise & glory \u{2014} forever"
        );
        assert_eq!(song.slide_count, 5);
    }

    #[test]
    fn without_a_verse_order_the_verses_come_in_document_order() {
        let xml = r#"<song xmlns="http://openlyrics.info/namespace/2009/song"><properties><titles><title>Two</title></titles></properties>
            <lyrics><verse name="c"><lines>Chorus line</lines></verse><verse name="v1"><lines>Verse line</lines></verse></lyrics></song>"#;
        let song = parse(xml).unwrap();
        assert_eq!(song.body, "[Chorus]\nChorus line\n\n[Verse 1]\nVerse line");
        assert!(song.authors.is_empty() && song.copyright.is_none());
    }

    #[test]
    fn a_verse_order_naming_nothing_that_exists_is_ignored() {
        let xml = r#"<song><properties><titles><title>Odd</title></titles><verseOrder>x9 y9</verseOrder></properties>
            <lyrics><verse name="v1"><lines>Only</lines></verse></lyrics></song>"#;
        assert_eq!(parse(xml).unwrap().body, "[Verse 1]\nOnly");
    }

    #[test]
    fn verse_names_become_the_labels_the_editor_uses() {
        assert_eq!(verse_label("v1"), "Verse 1");
        assert_eq!(verse_label("c"), "Chorus");
        assert_eq!(verse_label("c2"), "Chorus 2");
        assert_eq!(verse_label("b2a"), "Bridge 2a");
        assert_eq!(verse_label("p"), "Pre-Chorus");
        assert_eq!(verse_label("e1"), "Ending 1");
        assert_eq!(verse_label("verse"), "verse", "not a code: kept");
        assert_eq!(verse_label("x1"), "x1");
    }

    #[test]
    fn anything_that_is_not_an_openlyrics_song_is_refused() {
        assert!(parse("<html><body/></html>").is_err());
        assert!(parse("<song><lyrics>").is_err(), "cut off");
        assert!(parse("not xml at all").is_err());
        assert!(
            parse("<song><lyrics><verse name=\"v1\"><lines>x</lines></verse></lyrics></song>")
                .is_err(),
            "no title"
        );
    }
}
