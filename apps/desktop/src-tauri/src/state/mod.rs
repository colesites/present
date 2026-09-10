//! Rust-owned application state.
//!
//! Stage 1 only owned process-level facts. The presentation, media and output
//! sub-states described in `docs/tauri-migration/stage-0-audit.md` land here in
//! Stages 4 and 5 - they are deliberately absent rather than stubbed, so
//! nothing in the tree is a placeholder.

pub mod app_state;
pub mod auth_state;
pub mod display_state;
pub mod file_state;
pub mod looks_state;
pub mod output_state;
pub mod persist;
pub mod presentation_state;
pub mod window_state;

pub use app_state::AppState;
pub use auth_state::AuthState;
pub use display_state::DisplayState;
pub use file_state::FileState;
pub use looks_state::LooksState;
pub use output_state::OutputState;
pub use presentation_state::PresentationState;
pub use window_state::WindowState;
