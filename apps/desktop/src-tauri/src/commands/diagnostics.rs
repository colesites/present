//! Migration diagnostics.
//!
//! The webview under Tauri is not Chromium — WKWebView on macOS, WebView2 on
//! Windows, WebKitGTK on Linux — so web-platform features the Electron build
//! took for granted have to be checked rather than assumed. This command lets
//! the frontend report what its runtime actually supports, so migration
//! decisions rest on measurement instead of memory.
//!
//! Temporary: delete once the subsystems it informs have migrated.

use std::sync::Arc;

use serde::{Deserialize, Serialize};
use tauri::State;

use crate::errors::AppResult;
use crate::services::error_log::{self, ErrorLog};

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WebviewCapabilities {
    /// `navigator.mediaDevices` exists at all.
    pub has_media_devices: bool,
    /// `navigator.mediaDevices.getUserMedia` is callable. Presence is not the
    /// same as working — a live capture attempt is reported separately.
    pub has_get_user_media: bool,
    pub has_enumerate_devices: bool,
    /// `setSinkId` on a media element — how audio output routing works today
    /// (`useShowVideoSync.ts:121`).
    pub has_set_sink_id: bool,
    pub has_audio_context: bool,
    pub has_audio_worklet: bool,
    pub has_web_speech: bool,
    // `rename_all = "camelCase"` would produce `hasWebsocket`; the web API is
    // spelled WebSocket, so pin the name rather than bend the JS to match.
    #[serde(rename = "hasWebSocket")]
    pub has_websocket: bool,
    pub has_media_recorder: bool,
    /// Result of actually calling `getUserMedia({ audio: true })`, when the
    /// probe was asked to try. `None` means it was not attempted.
    pub live_capture: Option<LiveCaptureResult>,
    pub user_agent: String,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LiveCaptureResult {
    pub granted: bool,
    /// DOMException name — `NotAllowedError`, `NotFoundError`, … — when denied.
    pub error_name: Option<String>,
    pub error_message: Option<String>,
}

/// Escape hatch for the probe itself: if the typed command below cannot be
/// reached, the frontend has no other way to tell us why. Takes a plain string
/// so nothing about it can fail to deserialise.
#[tauri::command]
pub fn report_diagnostic(message: String) -> AppResult<()> {
    tracing::warn!(%message, "frontend diagnostic");
    Ok(())
}

/// One error caught by the renderer's global handlers.
///
/// What `main-renderer.ts` sends on `window.error` and `unhandledrejection`.
/// Goes to the redacted local error log, as `recordRendererError` does under
/// Electron, and to the Rust log, where a terminal can see it. Any payload is
/// accepted, as Electron accepts any: one that is not an object is dropped, and
/// what an object leaves out is filled in (`services/error_log.rs`).
#[tauri::command]
pub async fn report_renderer_error(
    log: State<'_, Arc<ErrorLog>>,
    error: serde_json::Value,
) -> AppResult<()> {
    let Some(event) = error_log::renderer_event(&error) else {
        return Ok(());
    };
    tracing::error!(
        source = event.context.get("source").and_then(|value| value.as_str()).unwrap_or("renderer"),
        name = event.name.as_deref().unwrap_or("Error"),
        message = %error_log::redact(&event.message),
        "renderer error"
    );
    if let Some(stack) = event.stack.as_deref() {
        tracing::error!(stack = %error_log::redact(stack), "renderer error stack");
    }
    let log = Arc::clone(&log);
    tauri::async_runtime::spawn_blocking(move || log.record(&event))
        .await
        .map_err(|join| crate::errors::AppError::Invalid(join.to_string()))
}

/// Records what the webview can do. Logged rather than stored: this exists to
/// answer migration questions, not to drive runtime behaviour.
#[tauri::command]
pub fn report_webview_capabilities(capabilities: WebviewCapabilities) -> AppResult<()> {
    tracing::info!(
        has_media_devices = capabilities.has_media_devices,
        has_get_user_media = capabilities.has_get_user_media,
        has_enumerate_devices = capabilities.has_enumerate_devices,
        has_set_sink_id = capabilities.has_set_sink_id,
        has_audio_context = capabilities.has_audio_context,
        has_audio_worklet = capabilities.has_audio_worklet,
        has_web_speech = capabilities.has_web_speech,
        has_websocket = capabilities.has_websocket,
        has_media_recorder = capabilities.has_media_recorder,
        user_agent = %capabilities.user_agent,
        "webview capabilities"
    );

    match capabilities.live_capture {
        Some(result) if result.granted => {
            tracing::info!("live microphone capture: GRANTED");
        }
        Some(result) => {
            tracing::warn!(
                error_name = result.error_name.as_deref().unwrap_or("<none>"),
                error_message = result.error_message.as_deref().unwrap_or("<none>"),
                "live microphone capture: DENIED"
            );
        }
        None => {
            tracing::info!("live microphone capture: not attempted");
        }
    }

    Ok(())
}
