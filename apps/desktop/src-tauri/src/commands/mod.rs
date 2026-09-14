//! Tauri command surface.
//!
//! Commands stay thin: deserialise, delegate to a service, map to `AppResult`.
//! Domain logic belongs in `services/`, never here.

pub mod app;
pub mod audio;
pub mod auth;
pub mod bible;
pub mod compositor;
pub mod deep_link;
pub mod diagnostics;
pub mod display;
pub mod file;
pub mod looks;
pub mod media;
pub mod mini_lyrics;
pub mod ndi;
pub mod output;
pub mod permissions;
pub mod playback;
pub mod presentation;
pub mod speech;
pub mod surface;
pub mod window;
