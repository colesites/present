//! Rust-owned application state.
//!
//! Stage 1 only owned process-level facts. The presentation, media and output
//! sub-states described in `docs/tauri-migration/stage-0-audit.md` land here in
//! Stages 4 and 5 - they are deliberately absent rather than stubbed, so
//! nothing in the tree is a placeholder.

pub mod app_state;
pub mod audio_state;
pub mod auth_state;
pub mod control_state;
pub mod display_state;
pub mod file_state;
pub mod looks_state;
pub mod ndi_input_state;
pub mod ndi_state;
pub mod output_state;
pub mod output_surface_state;
pub mod persist;
pub mod playback_state;
pub mod presentation_state;
pub mod preview_state;
pub mod remote_state;
pub mod screen_ndi_state;
pub mod stage_relay_state;
pub mod store_state;
pub mod web_storage_state;
pub mod window_state;

pub use app_state::AppState;
pub use audio_state::AudioState;
pub use auth_state::AuthState;
pub use control_state::ControlState;
pub use display_state::DisplayState;
pub use file_state::FileState;
pub use looks_state::LooksState;
pub use ndi_input_state::NdiInputState;
pub use ndi_state::NdiState;
pub use output_state::OutputState;
pub use output_surface_state::OutputSurfaceState;
pub use playback_state::PlaybackState;
pub use presentation_state::PresentationState;
pub use preview_state::PreviewState;
pub use remote_state::RemoteState;
pub use screen_ndi_state::ScreenNdiState;
pub use stage_relay_state::StageRelayState;
pub use store_state::StoreState;
pub use web_storage_state::WebStorageState;
pub use window_state::WindowState;
