//! Present — Rust application core.
//!
//! All application logic lives here rather than in `main.rs`; see `Cargo.toml`
//! for why. Keep this file to wiring only: state registration, plugin setup,
//! command registration.

pub mod commands;
pub mod errors;
pub mod services;
pub mod state;

use tauri::Manager;

use services::window_spec::{spec_for, WindowRole};
use state::{AppState, WindowState};

/// Installs tracing. Verbosity comes from `RUST_LOG`, defaulting to `info` for
/// our own crate and `warn` for dependencies so a release run is quiet.
fn init_tracing() {
    use tracing_subscriber::{fmt, prelude::*, EnvFilter};

    let filter = EnvFilter::try_from_default_env()
        .unwrap_or_else(|_| EnvFilter::new("warn,present_lib=info"));

    // A second call would panic on the global-subscriber slot; ignore it so
    // tests and repeated entry points stay safe.
    let _ = tracing_subscriber::registry()
        .with(filter)
        .with(fmt::layer().with_target(true))
        .try_init();
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    init_tracing();

    // Constructed before the builder so `uptime_ms` measures the Rust core's
    // full startup, not just the part after the window exists.
    let app_state = AppState::new();

    #[allow(unused_mut)]
    let mut builder = tauri::Builder::default();

    // The only hook Tauri offers for a dead webview content process, and it is
    // macOS/iOS-only. Windows and Linux therefore have no crash recovery at
    // all yet — recorded in docs/tauri-migration/stage-2-windows.md rather than
    // papered over, because the Electron build recovers on all three.
    #[cfg(any(target_os = "macos", target_os = "ios"))]
    {
        builder = builder.on_web_content_process_terminate(|webview| {
            recover_from_webview_crash(webview);
        });
    }

    builder
        .manage(app_state)
        .manage(WindowState::new())
        .invoke_handler(tauri::generate_handler![
            commands::app::get_app_info,
            commands::diagnostics::report_webview_capabilities,
            commands::diagnostics::report_diagnostic,
            commands::speech::request_speech_token,
            commands::speech::report_speech_usage,
            commands::display::get_displays,
            commands::display::get_preferred_display,
            commands::display::set_preferred_display,
            commands::display::set_preferred_resolution,
            commands::display::get_preferred_resolution,
            commands::window::open_window,
            commands::window::close_window,
            commands::window::open_mini_lyrics_window,
            commands::window::close_mini_lyrics_window,
            commands::window::list_open_windows
        ])
        .setup(|app| {
            // Display preferences need the resolved app config directory, which
            // only exists once the app handle does — hence managing this here
            // rather than before the builder.
            let config_dir = app
                .path()
                .app_config_dir()
                .unwrap_or_else(|_| std::path::PathBuf::from("."));
            app.manage(state::DisplayState::load(&config_dir));

            tracing::info!(
                version = env!("CARGO_PKG_VERSION"),
                config_dir = %config_dir.display(),
                "Present Rust core started"
            );

            // The operator window is built here rather than declared in
            // tauri.conf.json so that every window in the app goes through one
            // code path and one set of specs. A window declared in JSON cannot
            // carry the deferred first paint or the crash policy, and would
            // drift from its Rust twin the first time either changed.
            services::window::open(app.handle(), &spec_for(WindowRole::Main), None)?;

            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building Present")
        .run(handle_run_event);
}

/// Application lifecycle, ported from `src/main/index.ts:100-111`.
///
/// Tauri's default is to quit once the last window closes, on every platform.
/// macOS is not like that and neither is the Electron build: the app stays in
/// the dock with no windows, and clicking the icon brings the operator window
/// back. Reproducing that matters more here than in a normal app — an operator
/// who closes the main window during a service has not asked for the audience
/// output to disappear with it.
fn handle_run_event(
    #[cfg_attr(not(target_os = "macos"), allow(unused_variables))] app: &tauri::AppHandle,
    event: tauri::RunEvent,
) {
    match event {
        #[cfg(target_os = "macos")]
        tauri::RunEvent::ExitRequested {
            code: None, api, ..
        } => {
            // `code: None` means a user gesture — the last window closing.
            // A programmatic exit carries a code and must still be honoured, or
            // Quit would stop working.
            api.prevent_exit();
        }
        #[cfg(target_os = "macos")]
        tauri::RunEvent::Reopen { .. } => {
            if app.get_webview_window(WindowRole::Main.label()).is_some() {
                return;
            }
            if let Err(error) = services::window::open(app, &spec_for(WindowRole::Main), None) {
                tracing::error!(%error, "failed to reopen the operator window from the dock");
            }
        }
        _ => {}
    }
}

/// Reload a window whose webview content process died, subject to that window's
/// crash policy.
///
/// Ports `render-process-gone` from `output.window.ts:83-92` and
/// `main.window.ts:196-227`. Electron can tell a clean exit from a crash and
/// ignores the former; this hook only ever fires on an abnormal termination, so
/// there is no clean-exit case to skip.
#[cfg(any(target_os = "macos", target_os = "ios"))]
fn recover_from_webview_crash<R: tauri::Runtime>(webview: &tauri::webview::Webview<R>) {
    use services::window_spec::CrashAction;

    let label = webview.label().to_owned();
    let app = webview.app_handle().clone();

    let Some(policy) = services::window_spec::crash_policy_for_label(&label) else {
        tracing::error!(%label, "webview content process died in an unrecognised window");
        return;
    };

    let Some(state) = app.try_state::<WindowState>() else {
        tracing::error!(%label, "webview content process died before state was registered");
        return;
    };

    match state.on_crash(&label, policy) {
        CrashAction::Reload => {
            tracing::error!(%label, "webview content process died; reloading");
            if let Some(window) = app.get_webview_window(&label) {
                if let Err(error) = window.reload() {
                    tracing::error!(%label, %error, "reload after crash failed");
                }
            }
        }
        CrashAction::LeaveInPlace => {
            tracing::error!(
                %label,
                "repeated webview crashes; leaving the window in place for inspection"
            );
        }
    }
}
