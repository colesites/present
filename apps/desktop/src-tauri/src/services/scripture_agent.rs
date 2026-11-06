//! Understanding what a preacher says about scripture, when the parser could
//! not read it.
//!
//! The microphone hears a sentence; most of the time it contains a reference
//! `services::scripture` can read outright — "John chapter 3 verse 16", "first
//! John 1 1", "Psalm 119 verse 1" — and that costs nothing and needs no
//! network. This is for the rest: a misheard book name, a reference said
//! sideways ("the third chapter of John"), and a story told in the preacher's
//! own words ("David took five smooth stones from the brook").
//!
//! **Groq first, the Vercel AI Gateway when Groq cannot answer** — no key in
//! this build, too many requests on its plan, slow, down, anything — with the
//! same model on both ([`GROQ`], [`GATEWAY`]).
//!
//! **What is sent is the last few seconds of speech and the list of books**,
//! as the words arrive rather than once a sentence ends. Not the Bible text,
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

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum SpeechIntent {
    ScriptureReading,
    Commentary,
    ReferenceMention,
    NavigationRequest,
    Uncertain,
}

impl Default for SpeechIntent {
    fn default() -> Self {
        SpeechIntent::Uncertain
    }
}

/// What the model is asked for, and all it may answer with.
#[derive(Debug, Clone, PartialEq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Answer {
    #[serde(default)]
    pub intent: Option<SpeechIntent>,
    /// The book as the model names it; matched against the operator's books
    /// here rather than trusted.
    pub book: String,
    pub chapter: u32,
    #[serde(default)]
    pub verse: Option<u32>,
    #[serde(default)]
    pub verse_end: Option<u32>,
    /// Recognised from a story or an event told in the preacher's own words,
    /// rather than named or quoted.
    #[serde(default)]
    pub story: bool,
    /// 0 to 1. Anything outside that is treated as not sure at all.
    #[serde(default)]
    pub confidence: f64,
}

/// How sure the model must be for a passage to go on screen by itself.
pub const PROJECT_AT: f64 = 0.9;

/// What the agent made of an utterance.
#[derive(Debug, Clone, PartialEq)]
pub struct Understanding {
    pub intent: SpeechIntent,
    pub reference: Reference,
    pub confidence: f64,
    /// A story recognised, not a passage named (`Answer::story`).
    pub story: bool,
}

impl Understanding {
    /// Whether this can go to the screen without being asked about.
    ///
    /// A reference the model resolved to a book the operator actually has,
    /// with a chapter and nothing wrong with it, and that the model is sure
    /// of. An earlier model reported plain references like "john three
    /// sixteen" well below any sensible threshold, so there was none; the one
    /// used now ([`MODEL`]) gives every plain reference and every story it
    /// knows 1, and 0.2 to 0.3 to "let's welcome our visitors this morning".
    /// Anything under [`PROJECT_AT`] is still found, in the Bible tab, but
    /// not shown.
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
            && (self.intent == SpeechIntent::ScriptureReading
                || self.intent == SpeechIntent::NavigationRequest
                || (self.intent == SpeechIntent::Uncertain
                    && (self.story || self.confidence >= 0.95)))
    }
}

/// The instruction the model is given. Short on purpose: it is sent as the
/// preacher speaks, and what it costs is latency in front of a congregation.
pub const INSTRUCTION: &str = "\
You find the Bible passage a preacher is talking about and classify their speech intent. \
The words come from live speech recognition, newest last, and a book name may be misheard as words \
that sound like it (\"have a cook\" for Habakkuk). The intent must be one of: \
\"SCRIPTURE_READING\" (reading Scripture aloud), \
\"NAVIGATION_REQUEST\" (explicitly telling congregation or app to turn to/read a passage), \
\"REFERENCE_MENTION\" (mentioning a reference in passing or commentary without intending to navigate or read), \
\"COMMENTARY\" (explaining verse meaning, sermon points, reflection, paraphrase), \
\"UNCERTAIN\" (ambiguous or not about Scripture). \
Reply with JSON only: {\"intent\":string,\"book\":string,\"chapter\":number,\
\"verse\":number|null,\"verseEnd\":number|null,\"story\":boolean,\
\"confidence\":number}. Answer the passage the words heard just now are about; \
what was heard before is only there to help understand them. When several are \
named, answer the last one. A verse said after a passage (\"now look at \
verse 16\") is in that passage; a verse or chapter said with no book means one \
in the open passage. For a story or event told in the preacher's own words, give the verse that tells the part being \
described, with story true and intent SCRIPTURE_READING. verseEnd only for a range said as one (\"verses 16 \
to 18\"). Use a book name exactly as given in the list. confidence is 0 to 1: 1 \
when the words can only mean that passage, below 0.5 when you are guessing or \
the words are not about a passage. Answer with nothing else.";

/// The request body for an OpenAI-shaped chat endpoint, which is what the
/// gateway speaks.
///
/// `heard`: the words new since the model was last asked. `earlier`: what
/// came before them, to understand them by ("turn to the book of John" before
/// "chapter 3 verse 16"), which the model is told not to answer.
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
    earlier: Option<&str>,
    books: &[Book],
    open: Option<&str>,
) -> serde_json::Value {
    request_body_with_fallback(model, heard, earlier, books, open, None)
}

/// Request body with optional Vercel AI Gateway model fallback configuration.
pub fn request_body_with_fallback(
    model: &str,
    heard: &str,
    earlier: Option<&str>,
    books: &[Book],
    open: Option<&str>,
    fallback_model: Option<&str>,
) -> serde_json::Value {
    let names: Vec<&str> = books.iter().map(|book| book.name.as_str()).collect();
    let open = open
        .map(str::trim)
        .filter(|open| !open.is_empty())
        .map(|open| format!("Open passage: {open}\n"))
        .unwrap_or_default();
    let earlier = earlier
        .map(str::trim)
        .filter(|earlier| !earlier.is_empty())
        .map(|earlier| format!("Heard before: {earlier}\n"))
        .unwrap_or_default();
    let mut body = serde_json::json!({
        "model": model,
        "temperature": 0,
        // Minimal reasoning effort where supported: low reasoning budget
        // keeps latency within bounds in front of a live congregation.
        "reasoning_effort": "low",
        "max_tokens": 600,
        "response_format": { "type": "json_object" },
        "messages": [
            { "role": "system", "content": INSTRUCTION },
            {
                "role": "user",
                "content": format!(
                    "Books: {}\n{open}{earlier}Heard just now: {heard}",
                    names.join(", ")
                ),
            }
        ]
    });
    if let Some(fallback) = fallback_model {
        body["providerOptions"] = serde_json::json!({
            "gateway": {
                "models": [fallback]
            }
        });
    }
    body
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
        // A story is shown at the verse that tells the part being told, not
        // as the whole of it: Daniel in the lions' den came back as Daniel
        // 6:16-23, eight verses to put on screen for one sentence.
        let end = answer.verse_end.filter(|_| !answer.story);
        if let Some(end) = end.filter(|end| *end > verse) {
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
        intent: answer.intent.unwrap_or_default(),
        reference,
        confidence,
        story: answer.story,
    }
}

/// Where the model is asked: an OpenAI-shaped chat endpoint, called from here
/// with a key built into the app (`services/service_keys.rs`) rather than
/// through the website.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Service {
    pub name: &'static str,
    pub url: &'static str,
    /// How long it may take before the next one is asked instead.
    pub timeout: std::time::Duration,
    /// Which of [`RESTING_UNTIL`] is its own.
    slot: usize,
}

/// Primary model through Vercel AI Gateway: OpenAI's gpt-6-luna-fast.
pub const PRIMARY_MODEL: &str = "openai/gpt-6-luna-fast";

/// Fallback model through Vercel AI Gateway: Google's gemini-3.8-flash.
/// Hard invariant: Routine intent classification must not use Gemini 4 Argon.
pub const FALLBACK_MODEL: &str = "google/gemini-3.8-flash";

/// Optional last-resort model for direct Groq API during Vercel AI Gateway outages.
pub const GROQ_MODEL: &str = "llama-3.3-70b-versatile";

/// Backward-compatible alias for existing references to MODEL.
pub const MODEL: &str = PRIMARY_MODEL;

/// Asked first: Vercel AI Gateway with primary model (`PRIMARY_MODEL`) and
/// automatic model-fallback configuration to Gemini (`FALLBACK_MODEL`).
pub const GATEWAY: Service = Service {
    name: "the AI Gateway",
    url: "https://ai-gateway.vercel.sh/v1/chat/completions",
    timeout: std::time::Duration::from_millis(3800),
    slot: 0,
};

/// Optional last-resort provider: Direct Groq API, asked only if the Vercel
/// AI Gateway is unavailable or fails. Improves resilience during Gateway-wide outages.
pub const GROQ: Service = Service {
    name: "Groq",
    url: "https://api.groq.com/openai/v1/chat/completions",
    timeout: std::time::Duration::from_millis(2500),
    slot: 1,
};

/// How long to leave a service alone after it says "too many", when it does
/// not say for how long.
const REST_AFTER_REFUSAL: std::time::Duration = std::time::Duration::from_secs(20);

/// Until when each service is being left alone.
///
/// The Bible tab asks as the preacher speaks. A free plan holds a model to a
/// few requests a minute, and every request past that is refused — and still
/// sent, and still logged, while the preacher carries on. Once refused, a
/// service is not asked again until the wait it asked for is over; the other
/// one is asked meanwhile, and the parser in the Bible tab reads plain
/// references all the while.
static RESTING_UNTIL: std::sync::Mutex<[Option<std::time::Instant>; 2]> =
    std::sync::Mutex::new([None, None]);

/// How long a refusal asks to be left alone: its `retry-after`, in seconds,
/// or [`REST_AFTER_REFUSAL`]. Never more than a minute, so a strange header
/// cannot switch the agent off for a whole service.
fn rest_for(retry_after: Option<&str>) -> std::time::Duration {
    retry_after
        .and_then(|value| value.trim().parse::<f64>().ok())
        .filter(|seconds| seconds.is_finite() && *seconds >= 0.0)
        .map(|seconds| std::time::Duration::from_secs_f64(seconds.min(60.0)))
        .unwrap_or(REST_AFTER_REFUSAL)
}

fn resting(service: &Service) -> bool {
    let mut until = RESTING_UNTIL
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    match until[service.slot] {
        Some(at) if std::time::Instant::now() < at => true,
        Some(_) => {
            until[service.slot] = None;
            tracing::info!(
                service = service.name,
                "asking again after it asked for a rest"
            );
            false
        }
        None => false,
    }
}

fn rest(service: &Service, for_how_long: std::time::Duration) {
    let mut until = RESTING_UNTIL
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    until[service.slot] = Some(std::time::Instant::now() + for_how_long);
}

/// The services this build can ask, in the order they are asked:
/// 1. Primary: Vercel AI Gateway (`PRIMARY_MODEL` with `FALLBACK_MODEL` fallback)
/// 2. Optional last-resort provider: Direct Groq API (`GROQ_MODEL`) during Gateway outages
fn services() -> Vec<(Service, String)> {
    [
        (GATEWAY, service_keys::ai_gateway()),
        (GROQ, service_keys::groq()),
    ]
    .into_iter()
    .filter_map(|(service, key)| key.map(|key| (service, key)))
    .collect()
}

/// What one service made of what was heard.
enum Reply {
    /// The model answered: a passage, or that it did not name one.
    Answered(Option<Answer>),
    /// It could not be asked, or did not answer; the next one is asked.
    Failed,
}

async fn ask_service(
    service: &Service,
    key: &str,
    heard: &str,
    earlier: Option<&str>,
    books: &[Book],
    open: Option<&str>,
    model: &str,
    fallback_model: Option<&str>,
    custom_timeout: Option<std::time::Duration>,
) -> Reply {
    let timeout = custom_timeout.unwrap_or(service.timeout);
    let Ok(client) = reqwest::Client::builder().timeout(timeout).build() else {
        return Reply::Failed;
    };
    let payload = request_body_with_fallback(model, heard, earlier, books, open, fallback_model);
    let response = match client
        .post(service.url)
        .bearer_auth(key)
        .json(&payload)
        .send()
        .await
    {
        Ok(response) => response,
        Err(error) => {
            tracing::warn!(service = service.name, %error, "could not be reached in time");
            return Reply::Failed;
        }
    };
    let status = response.status();
    if status == reqwest::StatusCode::TOO_MANY_REQUESTS {
        // A free plan's limit on requests or tokens a minute. The service is
        // left alone for as long as it asked (`RESTING_UNTIL`).
        let wait = rest_for(
            response
                .headers()
                .get(reqwest::header::RETRY_AFTER)
                .and_then(|value| value.to_str().ok()),
        );
        rest(service, wait);
        tracing::warn!(
            service = service.name,
            seconds = wait.as_secs_f64(),
            "refused: too many requests for this account's plan; resting"
        );
        return Reply::Failed;
    }
    if !status.is_success() {
        let detail = response.text().await.unwrap_or_default();
        tracing::warn!(service = service.name, %status, detail = %detail.chars().take(300).collect::<String>(), "refused the request");
        return Reply::Failed;
    }
    match response.json::<serde_json::Value>().await {
        Ok(body) => {
            let answer = answer_from_response(&body);
            if answer.is_none() {
                tracing::info!(service = service.name, heard, %body, "the model did not name a passage");
            }
            Reply::Answered(answer)
        }
        Err(error) => {
            tracing::warn!(service = service.name, %error, "the answer was not JSON");
            Reply::Failed
        }
    }
}

/// Ask what was said, and decide what it is worth.
///
/// Fail-safe invariant: Returns `None` when there is nothing to ask about, nobody signed in,
/// no service could answer, or the model named no passage. The application fails safely:
/// current screen and selected translation are strictly preserved.
pub async fn ask(
    session_token: &str,
    heard: &str,
    earlier: Option<&str>,
    books: &[Book],
    open: Option<&str>,
) -> Option<Understanding> {
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
    let services = services();
    if services.is_empty() {
        tracing::warn!("heard something, but this build has no Groq or AI Gateway key to ask with");
        return None;
    }

    for (service, key) in &services {
        if resting(service) {
            tracing::debug!(
                service = service.name,
                "left alone for now; asking the next"
            );
            continue;
        }

        let is_gateway = service.slot == GATEWAY.slot;
        let model = if is_gateway {
            PRIMARY_MODEL
        } else {
            GROQ_MODEL
        };
        let fallback = if is_gateway {
            Some(FALLBACK_MODEL)
        } else {
            None
        };

        let start_time = std::time::Instant::now();
        let Reply::Answered(mut maybe_answer) = ask_service(
            service,
            key,
            heard.trim(),
            earlier,
            books,
            open,
            model,
            fallback,
            None,
        )
        .await
        else {
            continue;
        };

        // If Gateway answered, but primary response is explicitly UNCERTAIN or low-confidence,
        // and the speech contains candidate cues (chapter/verse or number), perform a safe,
        // latency-bounded retry using the Gemini fallback directly.
        if is_gateway {
            let is_uncertain = match &maybe_answer {
                Some(ans) => {
                    ans.intent == Some(SpeechIntent::Uncertain)
                        || (ans.intent.is_none() && ans.confidence < 0.5)
                        || ans.book.trim().is_empty()
                }
                None => true,
            };

            let elapsed = start_time.elapsed();
            let has_cues = heard.chars().any(|c| c.is_ascii_digit())
                || heard.split_whitespace().any(|w| {
                    let lower = w.to_ascii_lowercase();
                    lower == "verse" || lower == "chapter" || lower == "book" || lower == "read"
                });

            if is_uncertain && has_cues && elapsed < std::time::Duration::from_millis(2000) {
                tracing::info!(
                    service = service.name,
                    elapsed_ms = elapsed.as_millis(),
                    "primary model returned uncertain with cues present; attempting latency-bounded Gemini fallback"
                );
                // Latency-bounded (2.0s) retry
                let retry_reply = ask_service(
                    service,
                    key,
                    heard.trim(),
                    earlier,
                    books,
                    open,
                    FALLBACK_MODEL,
                    None,
                    Some(std::time::Duration::from_millis(2000)),
                )
                .await;

                if let Reply::Answered(Some(gemini_ans)) = retry_reply {
                    if gemini_ans.confidence >= 0.7
                        && gemini_ans.intent != Some(SpeechIntent::Uncertain)
                    {
                        tracing::info!(
                            service = service.name,
                            intent = ?gemini_ans.intent,
                            "Gemini fallback resolved uncertain classification"
                        );
                        maybe_answer = Some(gemini_ans);
                    }
                }
            }
        }

        let Some(answer) = maybe_answer else {
            return None;
        };

        let understanding = understand(&answer, books);
        tracing::info!(
            service = service.name,
            heard,
            book = ?understanding.reference.book,
            chapter = ?understanding.reference.chapter,
            verse = ?understanding.reference.verse_start,
            intent = ?understanding.intent,
            story = understanding.story,
            will_project = understanding.may_project(),
            "the scripture agent read what was said"
        );
        return Some(understanding);
    }

    tracing::warn!(
        heard,
        "no service could answer; the parser and the operator carry on safely (preserving screen and translation)"
    );
    None
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
            ask("", "John 3:16", None, &books, None).await.is_none(),
            "nobody signed in"
        );
        assert!(
            ask("token", "   ", None, &books, None).await.is_none(),
            "nothing was said"
        );
        assert!(
            ask("token", "John 3:16", None, &[], None).await.is_none(),
            "no books installed, so no answer could be checked"
        );
    }

    #[test]
    fn the_model_is_asked_for_one_object_and_told_which_books_exist() {
        let body = request_body(
            "some-fast-model",
            "the third chapter of John",
            None,
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
            intent: None,
            book: "John".to_owned(),
            chapter: 3,
            verse: Some(16),
            verse_end: None,
            story: false,
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
            intent: None,
            book: "Hezekiah".to_owned(),
            chapter: 2,
            verse: Some(4),
            verse_end: None,
            story: false,
            confidence: 0.99,
        };
        let understanding = understand(&invented, &books());
        assert_eq!(understanding.reference.book, None);
        assert!(!understanding.may_project(), "however sure it says it is");
    }

    #[test]
    fn a_chapter_that_does_not_exist_does_not_reach_the_screen() {
        let beyond = Answer {
            intent: None,
            book: "John".to_owned(),
            chapter: 40,
            verse: None,
            verse_end: None,
            story: false,
            confidence: 0.99,
        };
        assert!(!understand(&beyond, &books()).may_project());
    }

    #[test]
    fn only_a_reading_the_model_is_sure_of_goes_up_by_itself() {
        // "God is good all the time": the model named Psalm 107:1 at 0.8.
        let allusion = Answer {
            intent: None,
            book: "Psalms".to_owned(),
            chapter: 107,
            verse: Some(1),
            verse_end: None,
            story: false,
            confidence: 0.8,
        };
        let understanding = understand(&allusion, &books());
        assert_eq!(understanding.reference.book.as_deref(), Some("psalms"));
        assert!(!understanding.may_project(), "found, not shown");

        let plain = Answer {
            intent: Some(SpeechIntent::ScriptureReading),
            book: "John".to_owned(),
            chapter: 3,
            verse: Some(16),
            verse_end: None,
            story: false,
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
    fn commentary_and_reference_mentions_do_not_project() {
        let mention = Answer {
            intent: Some(SpeechIntent::ReferenceMention),
            book: "Romans".to_owned(),
            chapter: 8,
            verse: Some(28),
            verse_end: None,
            story: false,
            confidence: 1.0,
        };
        assert!(
            !understand(&mention, &books()).may_project(),
            "passing reference mention must never project"
        );

        let commentary = Answer {
            intent: Some(SpeechIntent::Commentary),
            book: "Romans".to_owned(),
            chapter: 8,
            verse: Some(28),
            verse_end: None,
            story: false,
            confidence: 1.0,
        };
        assert!(
            !understand(&commentary, &books()).may_project(),
            "commentary must never project"
        );
    }

    #[test]
    fn a_range_that_runs_backwards_is_dropped_rather_than_shown() {
        let backwards = Answer {
            intent: None,
            book: "John".to_owned(),
            chapter: 3,
            verse: Some(16),
            verse_end: Some(2),
            story: false,
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
    fn the_new_words_are_sent_apart_from_what_came_before() {
        // David and Goliath, then the prodigal son: sent as one, the model
        // went on answering David.
        let body = request_body(
            MODEL,
            "And think about the father who saw his son coming home from a long way off",
            Some("remember when David took 5 smooth stones out of the brook"),
            &books(),
            None,
        );
        let user = body["messages"][1]["content"].as_str().expect("a message");
        assert!(user.contains(
            "Heard before: remember when David took 5 smooth stones out of the brook\nHeard just now: And think about the father"
        ));
        assert!(INSTRUCTION.contains("words heard just now"));
        let alone = request_body(MODEL, "Jesus wept", Some("  "), &books(), None);
        assert!(!alone["messages"][1]["content"]
            .as_str()
            .expect("a message")
            .contains("Heard before"));
    }

    #[test]
    fn gateway_is_asked_first_with_gemini_fallback_and_groq_is_last_resort() {
        assert!(GATEWAY.url.starts_with("https://ai-gateway.vercel.sh/"));
        assert!(GROQ.url.starts_with("https://api.groq.com/"));
        assert!(
            GATEWAY.timeout + GROQ.timeout <= std::time::Duration::from_secs(7),
            "both, one after the other, still answer before the preacher has moved on"
        );
        let body = request_body_with_fallback(
            PRIMARY_MODEL,
            "John 3 16",
            None,
            &books(),
            None,
            Some(FALLBACK_MODEL),
        );
        assert_eq!(body["model"], "openai/gpt-6-luna-fast");
        assert_eq!(
            body["providerOptions"]["gateway"]["models"][0],
            "google/gemini-3.8-flash"
        );
        assert_eq!(body["reasoning_effort"], "low", "it thinks, but briefly");
    }

    #[test]
    fn argon_is_not_used_for_routine_intent_classification() {
        assert_ne!(PRIMARY_MODEL, "google/gemini-4-argon");
        assert_ne!(FALLBACK_MODEL, "google/gemini-4-argon");
        assert!(!PRIMARY_MODEL.contains("argon"));
        assert!(!FALLBACK_MODEL.contains("argon"));
    }

    #[test]
    fn a_service_that_refused_is_left_alone_and_the_other_is_not() {
        rest(&GATEWAY, std::time::Duration::from_secs(30));
        assert!(resting(&GATEWAY));
        assert!(!resting(&GROQ), "the last-resort backup is still asked");
        rest(&GATEWAY, std::time::Duration::ZERO);
        assert!(
            !resting(&GATEWAY),
            "and Gateway again once its wait is over"
        );
    }

    #[test]
    fn a_story_is_shown_at_the_verse_that_tells_it() {
        // gpt-oss-120b, asked about Daniel in the lions' den.
        let answer = answer_from_json(
            r#"{"book":"Daniel","chapter":6,"verse":16,"verseEnd":23,"story":true,"confidence":1}"#,
        )
        .expect("an answer");
        let books = [Book {
            id: "daniel".to_owned(),
            name: "Daniel".to_owned(),
            abbreviation: None,
            chapters: 12,
        }];
        let understanding = understand(&answer, &books);
        assert!(understanding.story);
        assert_eq!(understanding.reference.verse_start, Some(16));
        assert_eq!(
            understanding.reference.verse_end, None,
            "one verse, not eight"
        );
        assert!(understanding.may_project());
    }

    #[test]
    fn the_open_passage_is_sent_when_there_is_one() {
        let user = |open| {
            request_body(MODEL, "now look at verse eighteen", None, &books(), open)["messages"][1]
                ["content"]
                .as_str()
                .expect("a message")
                .to_owned()
        };
        assert!(user(Some("John 3:16"))
            .contains("Open passage: John 3:16\nHeard just now: now look at verse eighteen"));
        assert!(!user(None).contains("Open passage"));
        assert!(!user(Some("  ")).contains("Open passage"), "nothing open");
        assert!(
            INSTRUCTION.contains("open passage"),
            "and the model is told what it is for"
        );
    }

    #[test]
    fn the_model_is_told_which_of_several_references_to_answer() {
        // It is sent the last few seconds of speech, which often name more
        // than one passage, and the book in them may be misheard.
        assert!(INSTRUCTION.contains("When several are named, answer the last one"));
        assert!(INSTRUCTION.contains("misheard"));
        assert!(INSTRUCTION.contains("verseEnd only"));
        // And a story told is a passage too.
        assert!(INSTRUCTION.contains("a story or event"));
        assert!(INSTRUCTION.contains("\"story\":boolean"));
    }

    #[test]
    fn a_refusal_is_waited_out_for_as_long_as_it_asks() {
        use std::time::Duration;
        assert_eq!(rest_for(Some("25")), Duration::from_secs(25));
        assert_eq!(rest_for(Some(" 1.5 ")), Duration::from_millis(1500));
        assert_eq!(rest_for(None), REST_AFTER_REFUSAL, "it did not say");
        assert_eq!(rest_for(Some("soon")), REST_AFTER_REFUSAL);
        assert_eq!(rest_for(Some("-4")), REST_AFTER_REFUSAL);
        assert_eq!(
            rest_for(Some("86400")),
            Duration::from_secs(60),
            "never long enough to lose a whole service"
        );
    }

    #[test]
    fn nonsense_confidence_is_recorded_as_none() {
        // Confidence decides what goes on screen, so a NaN or an infinity
        // must not travel any further, and is read as not sure at all.
        for confidence in [f64::NAN, f64::INFINITY, -5.0] {
            let answer = Answer {
                intent: None,
                book: "John".to_owned(),
                chapter: 3,
                verse: Some(16),
                verse_end: None,
                story: false,
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
