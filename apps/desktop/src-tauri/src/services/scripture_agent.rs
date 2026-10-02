//! Understanding a spoken reference that the parser could not read.
//!
//! The microphone hears a sentence; most of the time it contains a reference
//! `services::scripture` can read outright — "John chapter 3 verse 16", "first
//! John 1 1", "Psalm 119 verse 1" — and that costs nothing and needs no
//! network. This is for the rest: a misheard book name, a reference said
//! sideways ("the third chapter of John"), or a sentence where the reference
//! is buried in the middle of a thought.
//!
//! **What is sent is one sentence and the list of books.** Not the Bible text,
//! not the service, not who is speaking. The model answers with a reference
//! and how sure it is, and nothing else; anything it says that is not a
//! reference in a book the operator has installed is thrown away here rather
//! than reaching the screen.
//!
//! **Confidence decides whether it goes out on its own.** A model that is not
//! sure is worse than useless in front of a congregation, so an unsure answer
//! becomes a suggestion instead of a slide.

use serde::{Deserialize, Serialize};

use crate::services::scripture::{self, Book, Reference};
use crate::services::service_keys;

/// What the model is asked for, and all it may answer with.
#[derive(Debug, Clone, PartialEq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Answer {
    /// The book as the model names it; matched against the operator's books
    /// here rather than trusted.
    pub book: String,
    pub chapter: u32,
    #[serde(default)]
    pub verse: Option<u32>,
    #[serde(default)]
    pub verse_end: Option<u32>,
    /// 0 to 1. Anything outside that is treated as not sure at all.
    #[serde(default)]
    pub confidence: f64,
}

/// How sure the model must be for a passage to go on screen by itself.
pub const PROJECT_AT: f64 = 0.9;

/// What the agent made of an utterance.
#[derive(Debug, Clone, PartialEq)]
pub struct Understanding {
    pub reference: Reference,
    pub confidence: f64,
}

impl Understanding {
    /// Whether this can go to the screen without being asked about.
    ///
    /// A reference the model resolved to a book the operator actually has,
    /// with a chapter and nothing wrong with it, and that the model is sure
    /// of. An earlier model reported plain references like "john three
    /// sixteen" well below any sensible threshold, so there was none; the one
    /// used now ([`MODEL`]) gave every plain reference 1, and 0.8 to "God is
    /// good all the time", which names no passage at all. Anything under
    /// [`PROJECT_AT`] is still found, in the Bible tab, but not shown.
    ///
    /// The reading itself still stops a projection — an invented book, a
    /// missing chapter, a range that runs backwards. Those are checked in
    /// `understand`, against the books installed here rather than against the
    /// model's word for it.
    pub fn may_project(&self) -> bool {
        self.reference.book.is_some()
            && self.reference.chapter.is_some()
            && self.reference.errors.is_empty()
            && self.confidence >= PROJECT_AT
    }
}

/// The instruction the model is given. Short on purpose: it is sent with every
/// utterance, and what it costs is latency in front of a congregation.
pub const INSTRUCTION: &str = "\
You turn what a preacher said into a Bible reference. Reply with JSON only: \
{\"book\":string,\"chapter\":number,\"verse\":number|null,\"verseEnd\":number|null,\
\"confidence\":number}. Use a book name exactly as given in the list. \
When the sentence names a verse or a chapter but no book, it means one in the \
open passage. confidence is 0 to 1: 1 when the reference is unmistakable, below 0.5 when you \
are guessing or the sentence names no reference. Answer with nothing else.";

/// The request body for an OpenAI-shaped chat endpoint, which is what the
/// gateway speaks.
///
/// `open`: the passage in the Bible tab, so "now look at verse eighteen"
/// can be read within it. Measured with it on this prompt, it read every
/// verse or chapter said alone within the open passage, still preferred a
/// reference that was named, and made the model less sure of a sentence that
/// only sounded like scripture ("God is good all the time" went from 0.8 to
/// 0.4), not more.
pub fn request_body(
    model: &str,
    heard: &str,
    books: &[Book],
    open: Option<&str>,
) -> serde_json::Value {
    let names: Vec<&str> = books.iter().map(|book| book.name.as_str()).collect();
    let open = open
        .map(str::trim)
        .filter(|open| !open.is_empty())
        .map(|open| format!("Open passage: {open}\n"))
        .unwrap_or_default();
    serde_json::json!({
        "model": model,
        "temperature": 0,
        // The answer is one short object; a long one is a wrong one.
        "max_tokens": 80,
        "response_format": { "type": "json_object" },
        "messages": [
            { "role": "system", "content": INSTRUCTION },
            {
                "role": "user",
                "content": format!("Books: {}\n{open}Heard: {heard}", names.join(", ")),
            }
        ]
    })
}

/// Pull the model's answer out of a chat response.
pub fn answer_from_response(body: &serde_json::Value) -> Option<Answer> {
    let content = body
        .get("choices")?
        .as_array()?
        .first()?
        .get("message")?
        .get("content")?
        .as_str()?;
    answer_from_json(content)
}

/// Read one answer. Tolerant of a model that wrapped its JSON in prose or a
/// code fence, because they do.
pub fn answer_from_json(content: &str) -> Option<Answer> {
    let trimmed = content
        .trim()
        .trim_start_matches("```json")
        .trim_matches('`');
    let start = trimmed.find('{')?;
    let end = trimmed.rfind('}')?;
    serde_json::from_str::<Answer>(trimmed.get(start..=end)?).ok()
}

/// Turn an answer into a reference the app can use, against the books the
/// operator actually has.
///
/// The model's own words are never trusted as a reference: they are written
/// back out as one and read by the same parser everything else goes through,
/// so a book it invented, a chapter that does not exist, or a range that runs
/// backwards is caught here.
pub fn understand(answer: &Answer, books: &[Book]) -> Understanding {
    let mut written = format!("{} {}", answer.book.trim(), answer.chapter);
    if let Some(verse) = answer.verse {
        written.push(':');
        written.push_str(&verse.to_string());
        if let Some(end) = answer.verse_end.filter(|end| *end > verse) {
            written.push('-');
            written.push_str(&end.to_string());
        }
    }
    let reference = scripture::parse(&written, books);
    let confidence = if answer.confidence.is_finite() {
        answer.confidence.clamp(0.0, 1.0)
    } else {
        0.0
    };
    Understanding {
        reference,
        confidence,
    }
}

/// The Vercel AI Gateway, called from here with the key built into the app
/// (`services/service_keys.rs`) rather than through the website.
const GATEWAY_URL: &str = "https://ai-gateway.vercel.sh/v1/chat/completions";

/// The model asked. Measured against this prompt on the gateway's free tier,
/// beside `gpt-4o-mini-fast`, `qwen3.7-flash` and `mistral-large-3`: it read
/// every plain reference, answered fastest (median 1.4s), and was the only
/// one not held to five requests a minute, which one request per sentence
/// cannot live within.
pub const MODEL: &str = "google/gemini-2.5-flash-lite";

/// How long the whole round trip may take. A reference that arrives after
/// the preacher has moved on is worse than none: the operator is already
/// doing it by hand.
const ASK_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(6);

/// Ask what a sentence meant, and decide what it is worth.
///
/// `None` when there is nothing to ask about, nobody signed in, or the model
/// could not be reached — all of which are ordinary, and none of which stop
/// the operator doing it themselves.
pub async fn ask(
    session_token: &str,
    heard: &str,
    books: &[Book],
    open: Option<&str>,
) -> Option<Understanding> {
    // Everything that was heard, whatever it looks like. What it meant is the
    // model's question to answer, not this file's to pre-judge.
    //
    // Each way of giving up says so out loud. An agent that hears the preacher
    // and puts nothing on the screen looks identical from the operator's seat
    // whether it was never asked, was refused, or answered something that did
    // not resolve — and at `debug!` the log said nothing at all.
    if session_token.trim().is_empty() {
        tracing::info!("heard something, but nobody is signed in to ask about it");
        return None;
    }
    if heard.trim().is_empty() {
        return None;
    }
    if books.is_empty() {
        tracing::info!("heard something, but no Bible is installed to read it against");
        return None;
    }
    let Some(key) = service_keys::ai_gateway() else {
        tracing::warn!("heard something, but this build has no AI Gateway key to ask with");
        return None;
    };

    let client = reqwest::Client::builder()
        .timeout(ASK_TIMEOUT)
        .build()
        .ok()?;
    let response = client
        .post(GATEWAY_URL)
        .bearer_auth(key)
        .json(&request_body(MODEL, heard.trim(), books, open))
        .send()
        .await
        .map_err(|error| tracing::warn!(%error, "the AI Gateway could not be reached"))
        .ok()?;
    let status = response.status();
    if !status.is_success() {
        // 429 is the free tier's limit on requests a minute; the sentence is
        // left to the operator, as one the model could not read would be.
        let detail = response.text().await.unwrap_or_default();
        tracing::warn!(%status, detail = %detail.chars().take(300).collect::<String>(), "the AI Gateway refused the request");
        return None;
    }

    let body: serde_json::Value = match response.json::<serde_json::Value>().await {
        Ok(body) => body,
        Err(error) => {
            tracing::warn!(%error, "the scripture agent's answer was not JSON");
            return None;
        }
    };
    let Some(answer) = answer_from_response(&body) else {
        tracing::info!(heard, %body, "the model did not name a reference");
        return None;
    };
    let understanding = understand(&answer, books);
    tracing::info!(
        heard,
        book = ?understanding.reference.book,
        chapter = ?understanding.reference.chapter,
        verse = ?understanding.reference.verse_start,
        will_project = understanding.may_project(),
        "the scripture agent read what was said"
    );
    Some(understanding)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn books() -> Vec<Book> {
        [
            ("john", "John", 21),
            ("1-john", "1 John", 5),
            ("psalms", "Psalms", 150),
            ("genesis", "Genesis", 50),
        ]
        .into_iter()
        .map(|(id, name, chapters)| Book {
            id: id.to_owned(),
            name: name.to_owned(),
            abbreviation: None,
            chapters,
        })
        .collect()
    }

    #[tokio::test]
    async fn everything_that_was_heard_goes_to_the_model() {
        let books = books();
        // The only sentences that do not: the ones there is no way to ask
        // about, or no way to check an answer against.
        assert!(
            ask("", "John 3:16", &books, None).await.is_none(),
            "nobody signed in"
        );
        assert!(
            ask("token", "   ", &books, None).await.is_none(),
            "nothing was said"
        );
        assert!(
            ask("token", "John 3:16", &[], None).await.is_none(),
            "no books installed, so no answer could be checked"
        );
    }

    #[test]
    fn the_model_is_asked_for_one_object_and_told_which_books_exist() {
        let body = request_body(
            "some-fast-model",
            "the third chapter of John",
            &books(),
            None,
        );
        assert_eq!(body["model"], "some-fast-model");
        assert_eq!(body["temperature"], 0);
        assert_eq!(body["response_format"]["type"], "json_object");
        let user = body["messages"][1]["content"].as_str().expect("a message");
        assert!(user.contains("John"), "the books it may choose from");
        assert!(user.contains("1 John"));
        assert!(
            user.contains("the third chapter of John"),
            "and what was heard"
        );
        assert!(
            !user.contains("In the beginning"),
            "no scripture text is sent"
        );
    }

    #[test]
    fn an_answer_is_read_however_the_model_wrapped_it() {
        let expected = Answer {
            book: "John".to_owned(),
            chapter: 3,
            verse: Some(16),
            verse_end: None,
            confidence: 0.94,
        };
        for wrapped in [
            r#"{"book":"John","chapter":3,"verse":16,"confidence":0.94}"#,
            "```json\n{\"book\":\"John\",\"chapter\":3,\"verse\":16,\"confidence\":0.94}\n```",
            "Sure! {\"book\":\"John\",\"chapter\":3,\"verse\":16,\"confidence\":0.94}",
        ] {
            assert_eq!(
                answer_from_json(wrapped).as_ref(),
                Some(&expected),
                "{wrapped}"
            );
        }
        assert_eq!(answer_from_json("no idea"), None);
        assert_eq!(answer_from_json(""), None);
    }

    #[test]
    fn an_answer_comes_out_of_a_chat_response() {
        let response = serde_json::json!({
            "choices": [{ "message": { "content": "{\"book\":\"Psalms\",\"chapter\":23,\"confidence\":0.9}" } }]
        });
        let answer = answer_from_response(&response).expect("an answer");
        assert_eq!(answer.book, "Psalms");
        assert_eq!(answer.chapter, 23);
        assert!(answer_from_response(&serde_json::json!({})).is_none());
    }

    #[test]
    fn a_book_the_model_invented_does_not_reach_the_screen() {
        let invented = Answer {
            book: "Hezekiah".to_owned(),
            chapter: 2,
            verse: Some(4),
            verse_end: None,
            confidence: 0.99,
        };
        let understanding = understand(&invented, &books());
        assert_eq!(understanding.reference.book, None);
        assert!(!understanding.may_project(), "however sure it says it is");
    }

    #[test]
    fn a_chapter_that_does_not_exist_does_not_reach_the_screen() {
        let beyond = Answer {
            book: "John".to_owned(),
            chapter: 40,
            verse: None,
            verse_end: None,
            confidence: 0.99,
        };
        assert!(!understand(&beyond, &books()).may_project());
    }

    #[test]
    fn only_a_reading_the_model_is_sure_of_goes_up_by_itself() {
        // "God is good all the time": the model named Psalm 107:1 at 0.8.
        let allusion = Answer {
            book: "Psalms".to_owned(),
            chapter: 107,
            verse: Some(1),
            verse_end: None,
            confidence: 0.8,
        };
        let understanding = understand(&allusion, &books());
        assert_eq!(understanding.reference.book.as_deref(), Some("psalms"));
        assert!(!understanding.may_project(), "found, not shown");

        let plain = Answer {
            book: "John".to_owned(),
            chapter: 3,
            verse: Some(16),
            verse_end: None,
            confidence: 1.0,
        };
        assert!(understand(&plain, &books()).may_project());
        assert!(understand(
            &Answer {
                confidence: PROJECT_AT,
                ..plain
            },
            &books()
        )
        .may_project());
    }

    #[test]
    fn a_range_that_runs_backwards_is_dropped_rather_than_shown() {
        let backwards = Answer {
            book: "John".to_owned(),
            chapter: 3,
            verse: Some(16),
            verse_end: Some(2),
            confidence: 0.99,
        };
        let understanding = understand(&backwards, &books());
        assert_eq!(
            understanding.reference.verse_end, None,
            "the end is ignored"
        );
        assert!(
            understanding.may_project(),
            "the verse itself is still good"
        );
    }

    #[test]
    fn the_desktop_asks_the_gateway_itself() {
        assert!(GATEWAY_URL.starts_with("https://ai-gateway.vercel.sh/"));
        assert_eq!(
            request_body(MODEL, "John 3 16", &books(), None)["model"],
            MODEL
        );
    }

    #[test]
    fn the_open_passage_is_sent_when_there_is_one() {
        let user = |open| {
            request_body(MODEL, "now look at verse eighteen", &books(), open)["messages"][1]
                ["content"]
                .as_str()
                .expect("a message")
                .to_owned()
        };
        assert!(user(Some("John 3:16"))
            .contains("Open passage: John 3:16\nHeard: now look at verse eighteen"));
        assert!(!user(None).contains("Open passage"));
        assert!(!user(Some("  ")).contains("Open passage"), "nothing open");
        assert!(
            INSTRUCTION.contains("open passage"),
            "and the model is told what it is for"
        );
    }

    #[test]
    fn nonsense_confidence_is_recorded_as_none() {
        // Confidence decides what goes on screen, so a NaN or an infinity
        // must not travel any further, and is read as not sure at all.
        for confidence in [f64::NAN, f64::INFINITY, -5.0] {
            let answer = Answer {
                book: "John".to_owned(),
                chapter: 3,
                verse: Some(16),
                verse_end: None,
                confidence,
            };
            let understanding = understand(&answer, &books());
            assert_eq!(understanding.confidence, 0.0, "{confidence}");
            assert!(
                !understanding.may_project(),
                "found, but not shown on the model's say-so",
            );
        }
    }
}
