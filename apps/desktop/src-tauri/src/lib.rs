//! Present — Rust application core.
//!
//! All application logic lives here rather than in `main.rs`; see `Cargo.toml`
//! for why. Keep this file to wiring only: state registration, plugin setup,
//! command registration.

pub mod commands;
pub mod errors;
pub mod services;
pub mod state;

use state::AppState;

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

    tauri::Builder::default()
        .manage(app_state)
        .invoke_handler(tauri::generate_handler![
            commands::app::get_app_info,
            commands::diagnostics::report_webview_capabilities,
            commands::diagnostics::report_diagnostic,
            commands::speech::request_speech_token,
            commands::speech::report_speech_usage
        ])
        .setup(|_app| {
            tracing::info!(
                version = env!("CARGO_PKG_VERSION"),
                "Present Rust core started"
            );
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running Present");
}
