//! The operator's preview frames, and the `output-frame://` response.
//!
//! One `PreviewSource` for the machine, behind a lock: the preview is one
//! panel, and a second compositor drawing the same scene would decode the same
//! video twice — which is the thing this exists to stop.

use std::sync::Mutex;

use tauri::http;
use tauri::AppHandle;

use crate::services::preview::{self, PreviewSource};

#[derive(Default)]
pub struct PreviewState {
    source: Mutex<Option<PreviewSource>>,
}

impl PreviewState {
    pub fn new() -> Self {
        Self::default()
    }

    /// The scene on screen at `size`, as a JPEG.
    ///
    /// The source is made on first use because it needs an `AppHandle`, and
    /// because a machine whose operator never opens the preview should not
    /// carry a compositor for it.
    pub fn frame(&self, app: &AppHandle, size: (u32, u32)) -> Result<Vec<u8>, String> {
        let mut guard = self
            .source
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        let source = guard.get_or_insert_with(|| PreviewSource::new(app.clone()));
        source.frame(size).map(<[u8]>::to_vec)
    }

    /// Let go of the compositor and any video it has open.
    pub fn release(&self) {
        let mut guard = self
            .source
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        *guard = None;
    }
}

/// The size asked for in `?w=` and `?h=`, whatever the query looks like.
pub fn size_from_uri(uri: &str) -> (u32, u32) {
    let query = uri.split_once('?').map(|(_, rest)| rest).unwrap_or("");
    let number = |name: &str| {
        query
            .split('&')
            .filter_map(|pair| pair.split_once('='))
            .find(|(key, _)| *key == name)
            .and_then(|(_, value)| value.parse::<u32>().ok())
    };
    preview::requested_size(number("w"), number("h"))
}

/// The `output-frame://frame/audience?w=&h=&t=` response.
///
/// A failure is 204 and not 500: the preview is a picture of what is already
/// on screen elsewhere, so the honest answer to "I could not draw it" is to
/// show nothing and let the next request try again.
pub fn respond(state: &PreviewState, app: &AppHandle, uri: &str) -> http::Response<Vec<u8>> {
    let builder = http::Response::builder().header("Cache-Control", "no-store");
    match state.frame(app, size_from_uri(uri)) {
        Ok(jpeg) => builder
            .status(200)
            .header("Content-Type", "image/jpeg")
            .body(jpeg),
        Err(error) => {
            tracing::debug!(%error, "no preview frame this time");
            builder.status(204).body(Vec::new())
        }
    }
    .unwrap_or_else(|_| http::Response::new(Vec::new()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_size_comes_from_the_query_and_is_kept_sane() {
        assert_eq!(
            size_from_uri("output-frame://frame/audience?w=480&h=270&t=12"),
            (480, 270)
        );
        assert_eq!(
            size_from_uri("output-frame://frame/audience?t=12"),
            (640, 360),
            "a request that says nothing still gets a picture"
        );
        assert_eq!(
            size_from_uri("output-frame://frame/audience?w=abc&h=-4"),
            (640, 360),
            "nonsense is not a size"
        );
        assert_eq!(
            size_from_uri("output-frame://frame/audience?w=99999&h=99999"),
            (preview::MAX_SIDE, preview::MAX_SIDE)
        );
        assert_eq!(size_from_uri("output-frame://frame/audience"), (640, 360));
    }
}
