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
            commands::speech::report_speech_usage,
            commands::display::get_displays,
            commands::display::get_preferred_display,
            commands::display::set_preferred_display,
            commands::display::set_preferred_resolution,
            commands::display::get_preferred_resolution
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
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running Present");
}
