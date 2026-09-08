//! Rust-owned application state.
//!
//! Stage 1 only owns process-level facts. The presentation, media, output and
//! display sub-states described in `docs/tauri-migration/stage-0-audit.md` land
//! here in Stages 2, 4 and 5 — they are deliberately absent rather than stubbed,
//! so nothing in the tree is a placeholder.

pub mod app_state;

pub use app_state::AppState;
