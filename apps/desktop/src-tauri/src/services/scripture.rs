//! Reading a scripture reference the way somebody says or types one.
//!
//! "Genesis 1:2", "gen 1 2", "turn to first John one two", "Psalms chapter one
//! hundred and nineteen verse one". The scripture panel has read references
//! this way since the Electron build (`features/scripture/lib/parser.ts`);
//! these are the same rules in Rust, so what does not come from the React tree
//! — a service item, the AI operator, and the foot pedals and phone remote
//! being built next — resolves a reference the same way.
//!
//! **Both are checked against the same table**,
//! `tests/fixtures/scripture-references.json`, quirks included: a chapter `0`
//! is reported as a missing chapter, and `1:2-2` as a range that does not go
//! forwards.
//!
//! The chapter and verse grammar is parsed with `nom`; the rest is the
//! normalising the panel does first — ordinals, spoken numbers, and the words
//! "chapter" and "verse" — which is token replacement, not grammar.

use nom::branch::alt;
use nom::bytes::complete::take_while1;
use nom::character::complete::{char, digit1, space1};
use nom::combinator::{all_consuming, map_res, opt, rest};
use nom::sequence::preceded;
use nom::{IResult, Parser};
use serde::{Deserialize, Serialize};

/// A book the reference could name, as the panel knows it.
#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Book {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub abbreviation: Option<String>,
    pub chapters: u32,
}

/// What a reference was understood to mean. `errors` is what to tell the
/// operator; a reference can name a book and still carry one.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Reference {
    /// The book's id, or `None` when nothing matched.
    pub book: Option<String>,
    pub chapter: Option<u32>,
    pub verse_start: Option<u32>,
    pub verse_end: Option<u32>,
    pub version_code: Option<String>,
    pub errors: Vec<String>,
}

const SPOKEN_NUMBERS: [(&str, u32); 29] = [
    ("zero", 0),
    ("one", 1),
    ("two", 2),
    ("three", 3),
    ("four", 4),
    ("five", 5),
    ("six", 6),
    ("seven", 7),
    ("eight", 8),
    ("nine", 9),
    ("ten", 10),
    ("eleven", 11),
    ("twelve", 12),
    ("thirteen", 13),
    ("fourteen", 14),
    ("fifteen", 15),
    ("sixteen", 16),
    ("seventeen", 17),
    ("eighteen", 18),
    ("nineteen", 19),
    ("twenty", 20),
    ("thirty", 30),
    ("forty", 40),
    ("fifty", 50),
    ("sixty", 60),
    ("seventy", 70),
    ("eighty", 80),
    ("ninety", 90),
    ("hundred", 100),
];

fn spoken_number(word: &str) -> Option<u32> {
    SPOKEN_NUMBERS
        .iter()
        .find(|(name, _)| *name == word)
        .map(|(_, value)| *value)
}

/// A book's alias as it is matched: lower case, without "the book of", and
/// with a leading ordinal as a digit.
fn normalize_book_lookup(value: &str) -> String {
    let lowered = value.trim().to_lowercase();
    let without_book_of = lowered
        .strip_prefix("the book of ")
        .or_else(|| lowered.strip_prefix("book of "))
        .unwrap_or(&lowered);
    let mut words: Vec<String> = without_book_of
        .split_whitespace()
        .map(str::to_owned)
        .collect();
    if let Some(first) = words.first_mut() {
        match first.as_str() {
            "first" | "1st" | "i" => *first = "1".to_owned(),
            "second" | "2nd" | "ii" => *first = "2".to_owned(),
            "third" | "3rd" | "iii" => *first = "3".to_owned(),
            _ => {}
        }
    }
    words.join(" ")
}

/// Every name a book answers to, longest first.
fn book_aliases(book: &Book) -> Vec<String> {
    let mut aliases: Vec<String> = [Some(&book.name), Some(&book.id), book.abbreviation.as_ref()]
        .into_iter()
        .flatten()
        .filter(|value| !value.trim().is_empty())
        .map(|value| normalize_book_lookup(value))
        .filter(|alias| !alias.is_empty())
        .collect();
    aliases.sort_by_key(|alias| std::cmp::Reverse(alias.len()));
    aliases.dedup();
    aliases
}

/// Where `alias` appears in `input` as a whole word, if it does.
fn find_whole_word(input: &str, alias: &str) -> Option<(usize, usize)> {
    let lowered = input.to_lowercase();
    let mut from = 0;
    while let Some(offset) = lowered[from..].find(alias) {
        let start = from + offset;
        let end = start + alias.len();
        let before_is_space = start == 0 || lowered[..start].ends_with(' ');
        let after_is_space = end == lowered.len() || lowered[end..].starts_with(' ');
        if before_is_space && after_is_space {
            return Some((start, end));
        }
        from = start + 1;
    }
    None
}

/// The book the reference names, and what follows it.
fn find_referenced_book<'a>(input: &str, books: &'a [Book]) -> Option<(&'a Book, String)> {
    let mut best: Option<(&Book, usize, usize)> = None;
    for book in books {
        for alias in book_aliases(book) {
            let Some((start, end)) = find_whole_word(input, &alias) else {
                continue;
            };
            let better = match best {
                None => true,
                // The earliest match wins, and the longest of those.
                Some((_, best_start, best_end)) => {
                    start < best_start
                        || (start == best_start && end - start > best_end - best_start)
                }
            };
            if better {
                best = Some((book, start, end));
            }
        }
    }
    best.map(|(book, _, end)| (book, input[end..].trim().to_owned()))
}

/// The ordinals the panel rewrites: "first" and "1st" anywhere, and the Roman
/// "i", "ii" and "iii" only where a book name would start.
fn replace_ordinals(input: &str) -> String {
    let mut words: Vec<String> = input
        .replace(['.', ','], " ")
        .split_whitespace()
        .map(|word| match word.to_lowercase().as_str() {
            "first" | "1st" => "1".to_owned(),
            "second" | "2nd" => "2".to_owned(),
            "third" | "3rd" => "3".to_owned(),
            _ => word.to_owned(),
        })
        .collect();
    if let Some(first) = words.first_mut() {
        match first.to_lowercase().as_str() {
            "i" => *first = "1".to_owned(),
            "ii" => *first = "2".to_owned(),
            "iii" => *first = "3".to_owned(),
            _ => {}
        }
    }
    words.join(" ")
}

/// A number said in words, as one value: "twenty one" is 21, "one hundred and
/// nineteen" is 119.
fn compound_number(words: &[String]) -> Option<u32> {
    let mut total = 0;
    let mut has_value = false;
    for word in words {
        if word == "and" {
            continue;
        }
        let value = spoken_number(word)?;
        has_value = true;
        if value == 100 {
            total = total.max(1) * value;
        } else {
            total += value;
        }
    }
    has_value.then_some(total)
}

/// Spoken numbers as digits. Numbers said one after another — "one two" — stay
/// separate, because that is a chapter and a verse, not twelve.
fn replace_spoken_numbers(input: &str) -> String {
    let words: Vec<&str> = input.split_whitespace().collect();
    let lookup: Vec<String> = words
        .iter()
        .map(|word| {
            word.to_lowercase()
                .chars()
                .filter(|character| character.is_ascii_lowercase() || *character == '-')
                .collect()
        })
        .collect();
    let is_number_word = |index: usize| {
        let word: &str = &lookup[index];
        !word.is_empty() && (word == "and" || spoken_number(word).is_some())
    };

    let mut out: Vec<String> = Vec::with_capacity(words.len());
    let mut index = 0;
    while index < words.len() {
        if !is_number_word(index) {
            out.push(words[index].to_owned());
            index += 1;
            continue;
        }
        let mut end = index;
        while end < words.len() && is_number_word(end) {
            end += 1;
        }
        let phrase = &lookup[index..end];
        let units_in_a_row = phrase.len() > 1
            && phrase
                .iter()
                .all(|word| word == "and" || spoken_number(word).is_some_and(|value| value < 20));
        if units_in_a_row {
            out.extend(
                phrase
                    .iter()
                    .filter(|word| *word != "and")
                    .map(|word| spoken_number(word).expect("checked above").to_string()),
            );
        } else if let Some(value) = compound_number(phrase) {
            out.push(value.to_string());
        } else {
            out.extend(words[index..end].iter().map(|word| (*word).to_owned()));
        }
        index = end;
    }
    out.join(" ")
}

/// "chapter" dropped, and "verse 3", "verses 3 to 5" and "verses 3-5" turned
/// into the `:3` and `:3-5` the grammar below reads.
fn rewrite_chapter_and_verse_words(input: &str) -> String {
    let words: Vec<&str> = input.split_whitespace().collect();
    let mut out: Vec<String> = Vec::with_capacity(words.len());
    let mut index = 0;
    let number = |word: Option<&&str>| {
        word.filter(|value| value.chars().all(|c| c.is_ascii_digit()) && !value.is_empty())
            .map(|value| (*value).to_owned())
    };

    while index < words.len() {
        let lowered = words[index].to_lowercase();
        if lowered == "chapter" || lowered == "chapters" {
            index += 1;
            continue;
        }
        if lowered == "verse" || lowered == "verses" {
            if let Some(start) = number(words.get(index + 1)) {
                let joined = words.get(index + 2).map(|word| word.to_lowercase());
                let joined_range = match joined.as_deref() {
                    // "verses 3 to 5" and "verses 3 through 5"
                    Some("to") | Some("through") => {
                        number(words.get(index + 3)).map(|end| (end, 4))
                    }
                    // "verses 3 - 5"
                    Some("-") => number(words.get(index + 3)).map(|end| (end, 4)),
                    _ => None,
                };
                if let Some((end, width)) = joined_range {
                    out.push(format!(":{start}-{end}"));
                    index += width;
                    continue;
                }
                out.push(format!(":{start}"));
                index += 2;
                continue;
            }
            // "verses 3-5", where the range is one word.
            if let Some(range) = words.get(index + 1).filter(|word| {
                word.split_once('-')
                    .is_some_and(|(left, right)| is_digits(left) && is_digits(right))
            }) {
                out.push(format!(":{range}"));
                index += 2;
                continue;
            }
        }
        out.push(words[index].to_owned());
        index += 1;
    }
    out.join(" ")
}

fn is_digits(value: &str) -> bool {
    !value.is_empty() && value.chars().all(|character| character.is_ascii_digit())
}

/// Everything the panel does to a reference before it is read.
fn normalize(input: &str) -> String {
    let ordinals = replace_ordinals(input.trim());
    let numbered = replace_spoken_numbers(&ordinals);
    let rewritten = rewrite_chapter_and_verse_words(&numbered);
    // A colon or a dash belongs to the numbers around it.
    let joined = rewritten.replace(" :", ":");
    let mut out = String::with_capacity(joined.len());
    let mut characters = joined.chars().peekable();
    while let Some(character) = characters.next() {
        if character == ' ' {
            // Spaces before a dash, and after one, go.
            let rest: String = characters.clone().collect();
            let trimmed = rest.trim_start();
            if trimmed.starts_with('-') {
                continue;
            }
            if out.ends_with('-') {
                continue;
            }
        }
        out.push(character);
    }
    out.split_whitespace().collect::<Vec<_>>().join(" ")
}

/// `1`, `1:2`, `1:2-5`, each optionally followed by more words.
struct Tail {
    chapter: u32,
    verse_start: Option<u32>,
    verse_end: Option<u32>,
    rest: Option<String>,
}

fn number(input: &str) -> IResult<&str, u32> {
    map_res(digit1, str::parse).parse(input)
}

fn verses(input: &str) -> IResult<&str, (u32, Option<u32>)> {
    let (input, start) = preceded(char(':'), number).parse(input)?;
    let (input, end) = opt(preceded(char('-'), number)).parse(input)?;
    Ok((input, (start, end)))
}

fn tail(input: &str) -> IResult<&str, Tail> {
    let (input, chapter) = number(input)?;
    let (input, verses) = opt(verses).parse(input)?;
    let (input, rest) = opt(preceded(space1, rest)).parse(input)?;
    Ok((
        input,
        Tail {
            chapter,
            verse_start: verses.map(|(start, _)| start),
            verse_end: verses.and_then(|(_, end)| end),
            rest: rest
                .map(str::to_owned)
                .filter(|value| !value.trim().is_empty()),
        },
    ))
}

/// A version code: letters then letters or digits, as `NKJV` or `NIV84`.
fn version_code(input: &str) -> IResult<&str, &str> {
    let (input, code) = (
        take_while1(|character: char| character.is_ascii_alphabetic()),
        opt(take_while1(|character: char| {
            character.is_ascii_alphanumeric()
        })),
    )
        .parse(input)
        .map(|(remaining, (letters, _))| (remaining, letters))?;
    Ok((input, code))
}

/// What can follow the chapter and verse: a verse range the writer put after a
/// space, a version code, or both.
fn parse_rest(rest: &str) -> (Option<u32>, Option<u32>, Option<String>) {
    let mut words = rest.split_whitespace();
    let Some(first) = words.next() else {
        return (None, None, None);
    };
    let range = all_consuming((number, opt(preceded(char('-'), number))))
        .parse(first)
        .ok();
    if let Some((_, (start, end))) = range {
        let code = words
            .next()
            .and_then(|word| all_consuming(version_code).parse(word).ok())
            .map(|(_, code)| code.to_uppercase());
        return (Some(start), end, code);
    }
    let code = all_consuming(alt((version_code, |input| {
        // Letters then digits: `NIV84`.
        take_while1(|character: char| character.is_ascii_alphanumeric())(input)
    })))
    .parse(first)
    .ok()
    .filter(|(_, code)| code.starts_with(|character: char| character.is_ascii_alphabetic()))
    .map(|(_, code)| code.to_uppercase());
    (None, None, code)
}

/// Read a reference, against the books the operator has.
pub fn parse(input: &str, books: &[Book]) -> Reference {
    let mut reference = Reference::default();
    let normalized = normalize(input);
    if normalized.is_empty() {
        return reference;
    }

    let Some((book, after_book)) = find_referenced_book(&normalized, books) else {
        reference
            .errors
            .push("Invalid format. Expected: Book Chapter or Book Chapter:Verse".to_owned());
        return reference;
    };
    reference.book = Some(book.id.clone());

    let parsed = all_consuming(tail).parse(after_book.as_str()).ok();
    let Some((_, parsed)) = parsed else {
        reference.errors.push("Missing chapter number.".to_owned());
        return reference;
    };
    // The panel treats chapter 0 as no chapter at all.
    if parsed.chapter == 0 {
        reference.errors.push("Missing chapter number.".to_owned());
        return reference;
    }
    if parsed.chapter > book.chapters {
        reference.errors.push(format!(
            "Invalid chapter: {}. {} has {} chapters.",
            parsed.chapter, book.name, book.chapters
        ));
    }
    reference.chapter = Some(parsed.chapter);
    reference.verse_start = parsed.verse_start;
    reference.verse_end = parsed.verse_end;

    if let Some(rest) = parsed.rest {
        let (start, end, code) = parse_rest(&rest);
        if start.is_some() {
            reference.verse_start = start;
            reference.verse_end = end;
        }
        reference.version_code = code;
    }

    if let (Some(start), Some(end)) = (reference.verse_start, reference.verse_end) {
        if end <= start {
            reference
                .errors
                .push("End verse must be greater than start verse.".to_owned());
        }
    }
    reference
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The table the scripture panel's parser is held to as well
    /// (`tests/scripture-parser.test.mjs`).
    #[derive(Deserialize)]
    struct Table {
        books: Vec<Book>,
        cases: Vec<Case>,
    }

    #[derive(Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct Case {
        input: String,
        book: Option<String>,
        chapter: Option<u32>,
        verse_start: Option<u32>,
        verse_end: Option<u32>,
        version_code: Option<String>,
        errors: Vec<String>,
    }

    fn table() -> Table {
        let path = concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/../tests/fixtures/scripture-references.json"
        );
        serde_json::from_str(&std::fs::read_to_string(path).expect("the shared table"))
            .expect("the table parses")
    }

    #[test]
    fn every_reference_in_the_shared_table_reads_the_same_way() {
        let table = table();
        let mut wrong = Vec::new();
        for case in &table.cases {
            let parsed = parse(&case.input, &table.books);
            let expected = Reference {
                book: case.book.clone(),
                chapter: case.chapter,
                verse_start: case.verse_start,
                verse_end: case.verse_end,
                version_code: case.version_code.clone(),
                errors: case.errors.clone(),
            };
            if parsed != expected {
                wrong.push(format!(
                    "{:?}\n  expected {expected:?}\n  got      {parsed:?}",
                    case.input
                ));
            }
        }
        assert!(
            wrong.is_empty(),
            "{} of {} differ:\n{}",
            wrong.len(),
            table.cases.len(),
            wrong.join("\n")
        );
    }

    #[test]
    fn a_book_answers_to_its_name_id_and_abbreviation() {
        let books = vec![Book {
            id: "1jn".to_owned(),
            name: "1 John".to_owned(),
            abbreviation: Some("1 Jn".to_owned()),
            chapters: 5,
        }];
        for input in ["1 John 2:3", "1jn 2:3", "1 Jn 2:3", "First John 2 3"] {
            let parsed = parse(input, &books);
            assert_eq!(parsed.book.as_deref(), Some("1jn"), "{input}");
            assert_eq!(
                (parsed.chapter, parsed.verse_start),
                (Some(2), Some(3)),
                "{input}"
            );
        }
    }
}
