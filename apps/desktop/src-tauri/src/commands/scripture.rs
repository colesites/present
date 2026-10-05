//! Reading a scripture reference.

use crate::errors::AppResult;
use crate::services::scripture::{self, Book, Reference};
use crate::services::scripture_agent;

/// Read "Genesis 1:2", "gen 1 2" or "turn to first John one two" against the
/// books the operator has (`services/scripture.rs`).
///
/// The books come from the caller because the panel already holds them, for
/// whichever translations are downloaded.
#[tauri::command]
pub fn parse_scripture_reference(input: String, books: Vec<Book>) -> Reference {
    scripture::parse(&input, &books)
}

/// What was said meant, when the parser could not read it: a passage named
/// sideways or misheard, or a story told.
///
/// The renderer hands over what it heard and the books it has; the answer is
/// a reference and whether it is sure enough to go straight to the screen.
/// Everything about that judgement is in `services::scripture_agent` — this
/// only carries it across.
#[tauri::command]
pub async fn understand_spoken_scripture(
    session_token: String,
    heard: String,
    // What was said before `heard`, to understand it by.
    earlier: Option<String>,
    books: Vec<scripture::Book>,
    // The passage in the Bible tab, for a verse or chapter said on its own.
    open_passage: Option<String>,
) -> AppResult<Option<SpokenScripture>> {
    Ok(scripture_agent::ask(
        &session_token,
        &heard,
        earlier.as_deref(),
        &books,
        open_passage.as_deref(),
    )
    .await
    .map(|understanding| SpokenScripture {
        may_project: understanding.may_project(),
        confidence: understanding.confidence,
        story: understanding.story,
        reference: understanding.reference,
    }))
}

/// What the Bible agent heard and did, in the app's log: each finished
/// sentence, each Bible named, each passage found or shown.
///
/// The agent decides in the renderer (`lib/heard-scripture.ts`), where
/// nothing it heard was written down; "I said give me KJV and nothing
/// happened" could not be told apart from the voice service hearing
/// something else.
#[tauri::command]
pub fn note_bible_agent(event: String, detail: String) {
    tracing::info!(%event, %detail, "Bible agent");
}

/// What the renderer is told about a sentence.
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SpokenScripture {
    pub reference: scripture::Reference,
    pub confidence: f64,
    /// Recognised from a story told, rather than a passage named.
    pub story: bool,
    /// Sure enough, and real enough, to put on the screen without asking.
    pub may_project: bool,
}
