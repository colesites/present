//! Noticing a webview's content process dying, on Windows and Linux.
//!
//! Known-issues §10. Tauri's `on_web_content_process_terminate` exists only on
//! macOS and iOS, so under Tauri a crashed webview elsewhere stayed crashed,
//! where Electron's `render-process-gone` reloads it on all three. Wry exposes
//! the platform webviews, and each has the event Electron is built on:
//!
//! - WebView2 (Windows): `ProcessFailed`. A render process that exited or hung
//!   is recovered; the browser process exiting takes the whole environment with
//!   it, which a reload cannot bring back, so that is only logged.
//! - WebKitGTK (Linux): `web-process-terminated`. A crash or the memory limit
//!   is recovered; a termination the app asked for is not a crash.
//!
//! The decision and the reload are `recover_from_webview_crash` in `lib.rs`,
//! shared with macOS. **Neither platform has been run**: this compiles against
//! the same crate versions wry uses, and nothing more is claimed.

use tauri::WebviewWindow;

/// Watch `window`'s webview for its content process dying. A no-op on macOS,
/// where Tauri's own hook covers every webview.
pub fn watch(window: &WebviewWindow) {
    #[cfg(windows)]
    windows_impl::watch(window);
    #[cfg(target_os = "linux")]
    linux_impl::watch(window);
    #[cfg(not(any(windows, target_os = "linux")))]
    let _ = window;
}

#[cfg(windows)]
mod windows_impl {
    use tauri::{Manager, WebviewWindow};
    use webview2_com::Microsoft::Web::WebView2::Win32::{
        COREWEBVIEW2_PROCESS_FAILED_KIND, COREWEBVIEW2_PROCESS_FAILED_KIND_BROWSER_PROCESS_EXITED,
        COREWEBVIEW2_PROCESS_FAILED_KIND_RENDER_PROCESS_EXITED,
        COREWEBVIEW2_PROCESS_FAILED_KIND_RENDER_PROCESS_UNRESPONSIVE,
    };
    use webview2_com::ProcessFailedEventHandler;

    pub fn watch(window: &WebviewWindow) {
        let app = window.app_handle().clone();
        let label = window.label().to_owned();
        let registered = window.with_webview(move |platform| {
            let result = (|| unsafe {
                let core = platform.controller().CoreWebView2()?;
                let mut token = 0i64;
                core.add_ProcessFailed(
                    &ProcessFailedEventHandler::create(Box::new(move |_sender, args| {
                        let Some(args) = args else {
                            return Ok(());
                        };
                        let mut kind = COREWEBVIEW2_PROCESS_FAILED_KIND::default();
                        args.ProcessFailedKind(&mut kind)?;
                        let reason = if kind == COREWEBVIEW2_PROCESS_FAILED_KIND_RENDER_PROCESS_EXITED {
                            "render-process-exited"
                        } else if kind == COREWEBVIEW2_PROCESS_FAILED_KIND_RENDER_PROCESS_UNRESPONSIVE {
                            "render-process-unresponsive"
                        } else if kind == COREWEBVIEW2_PROCESS_FAILED_KIND_BROWSER_PROCESS_EXITED {
                            tracing::error!(%label, "the WebView2 browser process exited; a reload cannot recover it");
                            return Ok(());
                        } else {
                            tracing::warn!(%label, kind = kind.0, "a WebView2 helper process failed");
                            return Ok(());
                        };
                        crate::recover_from_webview_crash(&app, &label, reason);
                        Ok(())
                    })),
                    &mut token,
                )
            })();
            if let Err(error) = result {
                tracing::error!(%error, "could not watch a webview for crashes");
            }
        });
        if let Err(error) = registered {
            tracing::error!(%error, "could not reach a webview to watch for crashes");
        }
    }
}

#[cfg(target_os = "linux")]
mod linux_impl {
    use tauri::{Manager, WebviewWindow};
    use webkit2gtk::{WebProcessTerminationReason, WebViewExt};

    pub fn watch(window: &WebviewWindow) {
        let app = window.app_handle().clone();
        let label = window.label().to_owned();
        let registered = window.with_webview(move |platform| {
            platform
                .inner()
                .connect_web_process_terminated(move |_, reason| {
                    let reason = match reason {
                        WebProcessTerminationReason::Crashed => "crashed",
                        WebProcessTerminationReason::ExceededMemoryLimit => "exceeded-memory-limit",
                        // Asked for by the app, not a crash.
                        _ => return,
                    };
                    crate::recover_from_webview_crash(&app, &label, reason);
                });
        });
        if let Err(error) = registered {
            tracing::error!(%error, "could not reach a webview to watch for crashes");
        }
    }
}
