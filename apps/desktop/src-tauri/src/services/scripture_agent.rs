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

/// How sure the model has to be before a reference is projected without
/// anybody confirming it.
///
/// Wrong scripture on the wall is worse than none, and the cost of being shy
/// is one click. Tuned to be generous to a plain reference and reluctant with
/// a sentence it half-heard.
pub const CONFIDENT_ENOUGH: f64 = 0.8;

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

/// What the agent made of an utterance.
#[derive(Debug, Clone, PartialEq)]
pub struct Understanding {
    pub reference: Reference,
    pub confidence: f64,
}

impl Understanding {
    /// Whether this can go to the screen without being asked about.
    pub fn may_project(&self) -> bool {
        self.confidence >= CONFIDENT_ENOUGH
            && self.reference.book.is_some()
            && self.reference.chapter.is_some()
            && self.reference.errors.is_empty()
    }
}

/// The instruction the model is given. Short on purpose: it is sent with every
/// utterance, and what it costs is latency in front of a congregation.
pub const INSTRUCTION: &str = "\
You turn what a preacher said into a Bible reference. Reply with JSON only: \
{\"book\":string,\"chapter\":number,\"verse\":number|null,\"verseEnd\":number|null,\
\"confidence\":number}. Use a book name exactly as given in the list. \
confidence is 0 to 1: 1 when the reference is unmistakable, below 0.5 when you \
are guessing or the sentence names no reference. Answer with nothing else.";

/// The request body for an OpenAI-shaped chat endpoint, which is what the
/// gateway speaks.
pub fn request_body(model: &str, heard: &str, books: &[Book]) -> serde_json::Value {
    let names: Vec<&str> = books.iter().map(|book| book.name.as_str()).collect();
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
                "content": format!("Books: {}\nHeard: {heard}", names.join(", ")),
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
    let trimmed = content.trim().trim_start_matches("```json").trim_matches('`');
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

/// Where the desktop asks. The key for the gateway lives on the web app, not
/// on this machine, so this is the one hop the model call takes.
const ASK_PATH: &str = "/api/ai/scripture";

/// How long the whole round trip may take.
///
/// Shorter than the route's own timeout, because a reference that arrives
/// after the preacher has moved on is worse than none: the operator is
/// already doing it by hand.
const ASK_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(5);

pub fn ask_url(web_app_base_url: &str) -> Option<String> {
    let trimmed = web_app_base_url.trim().trim_end_matches('/');
    (!trimmed.is_empty()).then(|| format!("{trimmed}{ASK_PATH}"))
}

/// Ask what a sentence meant, and decide what it is worth.
///
/// `None` when there is nothing to ask about, nobody signed in, or the model
/// could not be reached — all of which are ordinary, and none of which stop
/// the operator doing it themselves.
pub async fn ask(
    web_app_base_url: &str,
    session_token: &str,
    heard: &str,
    books: &[Book],
) -> Option<Understanding> {
    // Everything that was heard, whatever it looks like. What it meant is the
    // model's question to answer, not this file's to pre-judge.
    if session_token.trim().is_empty() || heard.trim().is_empty() || books.is_empty() {
        return None;
    }
    let url = ask_url(web_app_base_url)?;
    let names: Vec<&str> = books.iter().map(|book| book.name.as_str()).collect();

    let client = reqwest::Client::builder().timeout(ASK_TIMEOUT).build().ok()?;
    let response = client
        .post(&url)
        .bearer_auth(session_token)
        .json(&serde_json::json!({ "heard": heard.trim(), "books": names }))
        .send()
        .await
        .map_err(|error| tracing::debug!(%error, "the scripture agent could not be reached"))
        .ok()?;
    if !response.status().is_success() {
        tracing::debug!(status = %response.status(), "the scripture agent had nothing");
        return None;
    }

    let body: serde_json::Value = response.json().await.ok()?;
    let content = body.get("content")?.as_str()?;
    let answer = answer_from_json(content)?;
    Some(understand(&answer, books))
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
            ask("https://example.test", "", "John 3:16", &books).await.is_none(),
            "nobody signed in"
        );
        assert!(
            ask("https://example.test", "token", "   ", &books).await.is_none(),
            "nothing was said"
        );
        assert!(
            ask("https://example.test", "token", "John 3:16", &[]).await.is_none(),
            "no books installed, so no answer could be checked"
        );
    }

    #[test]
    fn the_model_is_asked_for_one_object_and_told_which_books_exist() {
        let body = request_body("some-fast-model", "the third chapter of John", &books());
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
            assert_eq!(answer_from_json(wrapped).as_ref(), Some(&expected), "{wrapped}");
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
        assert!(
            !understanding.may_project(),
            "however sure it says it is"
        );
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
    fn an_unsure_answer_becomes_a_suggestion_rather_than_a_slide() {
        let unsure = Answer {
            book: "John".to_owned(),
            chapter: 3,
            verse: Some(16),
            verse_end: None,
            confidence: 0.4,
        };
        let understanding = understand(&unsure, &books());
        assert_eq!(understanding.reference.book.as_deref(), Some("john"));
        assert!(!understanding.may_project(), "it is still offered, not sent");

        let sure = Answer {
            confidence: 0.95,
            ..unsure
        };
        assert!(understand(&sure, &books()).may_project());
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
        assert_eq!(understanding.reference.verse_end, None, "the end is ignored");
        assert!(understanding.may_project(), "the verse itself is still good");
    }

    #[test]
    fn the_desktop_asks_the_web_app_and_not_the_gateway() {
        // The key is not on this machine, so this is where the question goes.
        assert_eq!(
            ask_url("https://present.multivrs.space").as_deref(),
            Some("https://present.multivrs.space/api/ai/scripture")
        );
        assert_eq!(
            ask_url("https://present.multivrs.space/").as_deref(),
            Some("https://present.multivrs.space/api/ai/scripture"),
            "however the URL was written"
        );
        assert_eq!(ask_url("  "), None);
    }


    #[test]
    fn nonsense_confidence_is_no_confidence() {
        for confidence in [f64::NAN, f64::INFINITY, -5.0] {
            let answer = Answer {
                book: "John".to_owned(),
                chapter: 3,
                verse: Some(16),
                verse_end: None,
                confidence,
            };
            assert!(!understand(&answer, &books()).may_project(), "{confidence}");
        }
    }
}
