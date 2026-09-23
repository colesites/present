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

/// What a spoken sentence meant, when the parser could not read it.
///
/// The renderer hands over what it heard and the books it has; the answer is
/// a reference and whether it is sure enough to go straight to the screen.
/// Everything about that judgement is in `services::scripture_agent` — this
/// only carries it across.
#[tauri::command]
pub async fn understand_spoken_scripture(
    web_app_base_url: String,
    session_token: String,
    heard: String,
    books: Vec<scripture::Book>,
) -> AppResult<Option<SpokenScripture>> {
    Ok(
        scripture_agent::ask(&web_app_base_url, &session_token, &heard, &books)
            .await
            .map(|understanding| SpokenScripture {
                may_project: understanding.may_project(),
                confidence: understanding.confidence,
                reference: understanding.reference,
            }),
    )
}

/// What the renderer is told about a sentence.
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SpokenScripture {
    pub reference: scripture::Reference,
    pub confidence: f64,
    /// Sure enough, and real enough, to put on the screen without asking.
    pub may_project: bool,
}
