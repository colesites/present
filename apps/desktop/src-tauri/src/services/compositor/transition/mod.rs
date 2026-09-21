//! Transitions: what happens between one slide and the next.
//!
//! Present is a presentation application, not a video editor, so the default
//! is **not** to transition the whole picture. Going from "Amazing Grace" to
//! "How sweet the sound" changes the words; the background video behind them
//! carries on playing, untouched, and the logo does not move. Only what
//! changed takes part ([`change_detection`]), unless the operator asks for the
//! whole slide.
//!
//! The pieces:
//!
//! * [`config`] — what the operator chose, as a slide stores it.
//! * [`easing`] — how progress is shaped, once, for every preset.
//! * [`registry`] — the library, as data the picker reads.
//! * [`change_detection`] — which layers moved.
//!
//! Nothing here draws yet: this is the part that has to be right before
//! anything is drawn, and it is all testable without a screen.

pub mod change_detection;
pub mod config;
pub mod draw;
pub mod engine;
pub mod easing;
pub mod registry;
pub mod sample;

pub use change_detection::{compare, Changes};
pub use engine::Running;
pub use config::{Direction, Mode, Transition};
pub use easing::Easing;
pub use registry::{Category, Preset, Primitive, PRESETS};

/// The `transition-sample://frame/<id>?p=&w=&h=` response.
///
/// A JPEG of one moment, or 404 for a name the library does not have.
pub fn sample_response(uri: &str) -> tauri::http::Response<Vec<u8>> {
    use crate::services::thumbnails;

    let builder = tauri::http::Response::builder()
        .header("Cache-Control", "no-store")
        .header("Access-Control-Allow-Origin", "*");

    let (path, query) = uri.split_once('?').unwrap_or((uri, ""));
    let id = path.rsplit('/').next().unwrap_or_default();
    let id = percent_decode(id);
    let number = |name: &str| {
        query
            .split('&')
            .filter_map(|pair| pair.split_once('='))
            .find(|(key, _)| *key == name)
            .and_then(|(_, value)| value.parse::<f64>().ok())
    };
    let progress = number("p").unwrap_or(0.5);
    let width = number("w").unwrap_or(160.0).max(1.0) as u32;
    let height = number("h").unwrap_or(90.0).max(1.0) as u32;

    let drawn = sample::draw(&id, progress, width, height).and_then(|pixmap| {
        let mut bgra = Vec::with_capacity(pixmap.data().len());
        for pixel in pixmap.pixels() {
            bgra.extend_from_slice(&[pixel.blue(), pixel.green(), pixel.red(), pixel.alpha()]);
        }
        thumbnails::encode_jpeg(pixmap.width(), pixmap.height(), &bgra).ok()
    });

    match drawn {
        Some(jpeg) => builder
            .status(200)
            .header("Content-Type", "image/jpeg")
            .body(jpeg),
        None => builder.status(404).body(Vec::new()),
    }
    .unwrap_or_else(|_| tauri::http::Response::new(Vec::new()))
}

/// `%2D` and friends, so an id survives the URL.
fn percent_decode(value: &str) -> String {
    let bytes = value.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut index = 0;
    while index < bytes.len() {
        if bytes[index] == b'%' && index + 2 < bytes.len() {
            let pair = std::str::from_utf8(&bytes[index + 1..index + 3]).ok();
            if let Some(byte) = pair.and_then(|pair| u8::from_str_radix(pair, 16).ok()) {
                out.push(byte);
                index += 3;
                continue;
            }
        }
        out.push(bytes[index]);
        index += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}
