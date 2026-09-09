//! Tauri command surface.
//!
//! Commands stay thin: deserialise, delegate to a service, map to `AppResult`.
//! Domain logic belongs in `services/`, never here.

pub mod app;
pub mod diagnostics;
pub mod display;
pub mod speech;
pub mod window;
