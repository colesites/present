//! Panels whose pictures are drawn natively over the page
//! (`services::surface::panel`): the center pane's video and the operator's
//! preview, on macOS.
//!
//! The page asks; where the answer is no — another platform, a window being
//! closed — it draws the panel itself, as it always has. Nothing here is
//! worth an error in front of the operator, so failures are logged and come
//! back as `false`.

use std::sync::Arc;

use serde::Deserialize;
use tauri::{AppHandle, State, WebviewWindow};

use crate::commands::media_frames::ClockArg;
use crate::errors::AppResult;
use crate::services::surface::panel::{NativePanel, PanelGeometry};
use crate::state::native_panels_state::PanelSource;
use crate::state::NativePanelsState;

/// What a panel shows, as the page says it.
#[derive(Debug, Clone, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum PanelSourceArg {
    /// A video file, keeping time as a media player does (`set_media_frames`).
    Media { url: String, clock: ClockArg },
    /// The operator's preview of an audience screen.
    Preview { screen: String },
}

impl From<PanelSourceArg> for PanelSource {
    fn from(source: PanelSourceArg) -> Self {
        match source {
            PanelSourceArg::Media { url, clock } => Self::Media {
                url,
                clock: clock.into(),
            },
            PanelSourceArg::Preview { screen } => Self::Preview(screen),
        }
    }
}

/// The same rule as a media player's id (`media_frames_state`): letters,
/// digits, `-` and `_`.
fn usable_id(id: &str) -> bool {
    !id.is_empty()
        && id.len() <= 128
        && id
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
}

/// Draw panel `id` of the calling window natively. `true` when it is; the
/// page draws it itself otherwise.
#[tauri::command]
pub async fn attach_native_panel(
    app: AppHandle,
    window: WebviewWindow,
    panels: State<'_, NativePanelsState>,
    id: String,
    source: PanelSourceArg,
    geometry: PanelGeometry,
) -> AppResult<bool> {
    if !usable_id(&id) {
        return Ok(false);
    }
    let label = window.label().to_owned();
    // Attaching waits on the main thread, so it is never done on it.
    let attaching = {
        let (app, label) = (app.clone(), label.clone());
        tauri::async_runtime::spawn_blocking(move || NativePanel::attach(&app, &label, &geometry))
    };
    let panel = match attaching.await {
        Ok(Ok(panel)) => Arc::new(panel),
        Ok(Err(error)) => {
            tracing::debug!(%error, id, "the page draws this panel itself");
            return Ok(false);
        }
        Err(error) => {
            tracing::warn!(%error, id, "attaching a native panel stopped short");
            return Ok(false);
        }
    };
    panels.attach(&app, &id, &label, source.into(), panel);
    Ok(true)
}

/// Panel `id` shows another file, or keeps time another way.
#[tauri::command]
pub async fn set_native_panel_source(
    panels: State<'_, NativePanelsState>,
    id: String,
    source: PanelSourceArg,
) -> AppResult<()> {
    panels.set_source(&id, source.into());
    Ok(())
}

/// Where panel `id` is now, or that it is still there.
#[tauri::command]
pub async fn set_native_panel_geometry(
    panels: State<'_, NativePanelsState>,
    id: String,
    geometry: PanelGeometry,
) -> AppResult<()> {
    if let Some(panel) = panels.get(&id) {
        panel.set_geometry(geometry);
    }
    Ok(())
}

#[tauri::command]
pub async fn detach_native_panel(
    panels: State<'_, NativePanelsState>,
    id: String,
) -> AppResult<()> {
    panels.detach(&id);
    Ok(())
}

/// The calling window's page has loaded afresh: whatever panels its last
/// page left are gone with it.
#[tauri::command]
pub async fn reset_native_panels(
    window: WebviewWindow,
    panels: State<'_, NativePanelsState>,
) -> AppResult<()> {
    panels.forget_window(window.label());
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_panel_id_is_kept_to_plain_characters() {
        assert!(usable_id("vr0"));
        assert!(usable_id("preview-audience_1"));
        assert!(!usable_id(""));
        assert!(!usable_id("../x"));
        assert!(!usable_id(&"a".repeat(129)));
    }

    #[test]
    fn the_page_names_what_a_panel_shows() {
        let media: PanelSourceArg = serde_json::from_str(
            r#"{"kind":"media","url":"local-media://media/a.mp4","clock":{"mode":"scene"}}"#,
        )
        .expect("media");
        assert!(matches!(
            PanelSource::from(media),
            PanelSource::Media { url, clock: crate::services::media_frames::Clock::Scene }
                if url == "local-media://media/a.mp4"
        ));
        let preview: PanelSourceArg =
            serde_json::from_str(r#"{"kind":"preview","screen":"audience"}"#).expect("preview");
        assert!(matches!(preview, PanelSourceArg::Preview { screen } if screen == "audience"));
    }
}
