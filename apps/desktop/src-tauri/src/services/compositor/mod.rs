//! The frame pipeline.
//!
//! ADR-001 decided the audience output is composited in Rust rather than
//! captured from a webview, and its amendment settled the shape: Rust draws the
//! slide, the media and the overlays, and a transparent webview above it keeps
//! the YouTube and capture props.
//!
//! This module is the part that produces pixels. One pipeline feeds every
//! consumer — the audience window, NDI, and anything later — instead of each
//! one capturing separately.

pub mod color;
pub mod frame;
pub mod geometry;
pub mod images;
pub mod loader;
pub mod pipeline;
pub mod scene;
pub mod shapes;
pub mod text;

pub use frame::Frame;
pub use loader::ScopedMediaLoader;
pub use pipeline::SceneCompositor;
pub use scene::{render, MediaLoader, NoMedia, Rendered};
