//! Tauri command surface.
//!
//! Commands stay thin: deserialise, delegate to a service, map to `AppResult`.
//! Domain logic belongs in `services/`, never here.

pub mod app;
pub mod auth;
pub mod deep_link;
pub mod diagnostics;
pub mod display;
pub mod file;
pub mod looks;
pub mod output;
pub mod permissions;
pub mod speech;
pub mod window;
