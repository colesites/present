//! VideoPsalm songbooks, read into library items.
//!
//! VideoPsalm has no export, but its backup keeps each songbook as a `.json`
//! file: the songbook's name in `Text` and its songs in `Songs`, each with its
//! title in `Text`, its credits, and its verses in `Verses`. The file is not
//! quite JSON. Its keys are not quoted and its line breaks are written raw
//! inside strings, which is why it is put right here before it is read — the
//! same repair OpenLP's VideoPsalm importer makes.
//!
//! A song comes out in the same shape an OpenLyrics song does, so the library
//! takes both the same way: a `[Verse 1]` header over each verse's lines and a
//! blank line between verses. VideoPsalm does not say which verse is a chorus,
//! so each is numbered in the order the song has them.

use serde_json::Value;

use crate::errors::{AppError, AppResult};
use crate::services::openlyrics::OpenLyricsSong;

/// One songbook: its name, and the songs in it that have words.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Songbook {
    pub name: Option<String>,
    pub songs: Vec<OpenLyricsSong>,
    /// Songs with no words to show, left out.
    pub skipped: usize,
}

/// Read a songbook file's text.
pub fn parse(source: &str) -> AppResult<Songbook> {
    let source = source.trim_start_matches('\u{feff}').trim();
    let value: Value = serde_json::from_str(source)
        .or_else(|_| serde_json::from_str(&to_strict_json(source)))
        .map_err(|error| AppError::Invalid(format!("Not a VideoPsalm songbook: {error}")))?;

    let songs = value
        .get("Songs")
        .and_then(Value::as_array)
        .ok_or_else(|| {
            AppError::Invalid("Not a VideoPsalm songbook: it has no songs.".to_owned())
        })?;

    let mut book = Songbook {
        name: text(&value, "Text"),
        songs: Vec::new(),
        skipped: 0,
    };
    for song in songs {
        match read_song(song) {
            Some(song) => book.songs.push(song),
            None => book.skipped += 1,
        }
    }
    Ok(book)
}

fn read_song(song: &Value) -> Option<OpenLyricsSong> {
    let blocks: Vec<String> = song
        .get("Verses")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(|verse| text(verse, "Text"))
        .map(|words| lines(&words))
        .filter(|lines| !lines.is_empty())
        .enumerate()
        .map(|(index, lines)| format!("[Verse {}]\n{}", index + 1, lines.join("\n")))
        .collect();
    if blocks.is_empty() {
        return None;
    }

    let mut authors: Vec<String> = Vec::new();
    for key in ["TextAuthor", "Author", "MusicAuthor", "Composer"] {
        for name in text(song, key).iter().flat_map(|names| names.lines()) {
            let name = name.trim();
            if !name.is_empty() && !authors.iter().any(|known| known == name) {
                authors.push(name.to_owned());
            }
        }
    }

    Some(OpenLyricsSong {
        title: text(song, "Text").unwrap_or_else(|| "Untitled".to_owned()),
        authors,
        copyright: text(song, "Copyright").map(|words| lines(&words).join(" ")),
        ccli_number: text(song, "CCLI"),
        slide_count: blocks.len(),
        body: blocks.join("\n\n"),
    })
}

/// A field as trimmed text, whether it was written as a string or a number.
fn text(value: &Value, key: &str) -> Option<String> {
    let text = match value.get(key)? {
        Value::String(text) => text.trim().to_owned(),
        Value::Number(number) => number.to_string(),
        _ => return None,
    };
    (!text.is_empty()).then_some(text)
}

/// The non-empty lines of a verse, each trimmed.
fn lines(words: &str) -> Vec<String> {
    words
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty())
        .map(str::to_owned)
        .collect()
}

/// VideoPsalm's not-quite-JSON made into JSON: keys quoted, line breaks and
/// other control characters inside strings escaped, single-quoted strings
/// double-quoted, and commas before a closing bracket dropped. Anything
/// already valid comes through unchanged.
pub fn to_strict_json(source: &str) -> String {
    let chars: Vec<char> = source.chars().collect();
    let mut out = String::with_capacity(source.len() + source.len() / 8);
    let mut index = 0;

    while index < chars.len() {
        let c = chars[index];
        match c {
            '"' | '\'' => {
                index = copy_string(&chars, index, &mut out);
                continue;
            }
            ',' => {
                // A comma with nothing after it but a closing bracket.
                let next = chars[index + 1..].iter().find(|c| !c.is_whitespace());
                if !matches!(next, Some('}') | Some(']')) {
                    out.push(',');
                }
            }
            c if is_word(c) => {
                let start = index;
                while index < chars.len() && is_word(chars[index]) {
                    index += 1;
                }
                let word: String = chars[start..index].iter().collect();
                let next = chars[index..].iter().find(|c| !c.is_whitespace());
                if next == Some(&':') {
                    out.push('"');
                    out.push_str(&word);
                    out.push('"');
                } else {
                    out.push_str(&word);
                }
                continue;
            }
            c => out.push(c),
        }
        index += 1;
    }
    out
}

fn is_word(c: char) -> bool {
    c.is_alphanumeric() || c == '_' || c == '$' || c == '-' || c == '.' || c == '+'
}

/// Copy the string starting at `start` (its opening quote) as a JSON string,
/// and return the index after its closing quote.
fn copy_string(chars: &[char], start: usize, out: &mut String) -> usize {
    let quote = chars[start];
    out.push('"');
    let mut index = start + 1;
    while index < chars.len() {
        let c = chars[index];
        match c {
            '\\' if index + 1 < chars.len() => {
                let escaped = chars[index + 1];
                // `\'` means nothing in JSON; the quote alone does.
                if escaped == '\'' {
                    out.push('\'');
                } else {
                    out.push('\\');
                    out.push(escaped);
                }
                index += 2;
                continue;
            }
            c if c == quote => {
                out.push('"');
                return index + 1;
            }
            '"' => out.push_str("\\\""),
            '\n' => out.push_str("\\n"),
            '\r' => {}
            '\t' => out.push_str("\\t"),
            c if (c as u32) < 0x20 => out.push_str(&format!("\\u{:04x}", c as u32)),
            c => out.push(c),
        }
        index += 1;
    }
    index
}

#[cfg(test)]
mod tests {
    use super::*;

    /// As VideoPsalm writes a songbook: keys bare, a line break raw inside a
    /// verse, a number where a string might be expected.
    const SONGBOOK: &str = "\u{feff}{Guid:\"8f1c\",Text:\"Hymns of Praise\",Songs:[\
        {ID:1,Text:\"Amazing Grace\",Author:\"John Newton\",Copyright:\"Public\ndomain\",CCLI:22025,\
         Verses:[{ID:1,Text:\"Amazing grace, how sweet the sound\nThat saved a wretch like me\"},\
                 {ID:2,Text:\"'Twas grace that taught\r\nmy heart to fear\"}]},\
        {ID:2,Text:\"Empty\",Verses:[]},\
        {ID:3,Text:\"How Great Thou Art\",TextAuthor:\"Carl Boberg\",MusicAuthor:\"Carl Boberg\",\
         Verses:[{Text:\"O Lord my God\",},],},\
    ]}";

    #[test]
    fn a_songbook_is_read_with_its_name_and_songs() {
        let book = parse(SONGBOOK).expect("read");
        assert_eq!(book.name.as_deref(), Some("Hymns of Praise"));
        assert_eq!(book.songs.len(), 2);
        assert_eq!(book.skipped, 1, "the song with no words is left out");

        let grace = &book.songs[0];
        assert_eq!(grace.title, "Amazing Grace");
        assert_eq!(grace.authors, ["John Newton"]);
        assert_eq!(grace.copyright.as_deref(), Some("Public domain"));
        assert_eq!(grace.ccli_number.as_deref(), Some("22025"));
        assert_eq!(
            grace.body,
            "[Verse 1]\nAmazing grace, how sweet the sound\nThat saved a wretch like me\n\n\
             [Verse 2]\n'Twas grace that taught\nmy heart to fear"
        );
        assert_eq!(grace.slide_count, 2);

        assert_eq!(book.songs[1].authors, ["Carl Boberg"], "named once");
    }

    #[test]
    fn a_songbook_already_in_json_reads_as_it_is() {
        let book = parse(
            r#"{"Text":"Book","Songs":[{"Text":"Song","Verses":[{"Text":"Line one\nLine two"}]}]}"#,
        )
        .expect("read");
        assert_eq!(book.songs[0].body, "[Verse 1]\nLine one\nLine two");
    }

    #[test]
    fn a_colon_or_a_quote_inside_words_is_left_alone() {
        let strict = to_strict_json("{Text:\"Psalm 23: The Lord\",Note:'He said \"go\"'}");
        let value: Value = serde_json::from_str(&strict).expect(&strict);
        assert_eq!(value["Text"], "Psalm 23: The Lord");
        assert_eq!(value["Note"], "He said \"go\"");
    }

    #[test]
    fn a_file_that_is_not_a_songbook_says_so() {
        assert!(parse("{\"name\":\"package\"}").is_err());
        assert!(parse("not json at all").is_err());
    }
}
