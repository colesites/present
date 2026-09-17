//! Reading a scripture reference.

use crate::services::scripture::{self, Book, Reference};

/// Read "Genesis 1:2", "gen 1 2" or "turn to first John one two" against the
/// books the operator has (`services/scripture.rs`).
///
/// The books come from the caller because the panel already holds them, for
/// whichever translations are downloaded.
#[tauri::command]
pub fn parse_scripture_reference(input: String, books: Vec<Book>) -> Reference {
    scripture::parse(&input, &books)
}
