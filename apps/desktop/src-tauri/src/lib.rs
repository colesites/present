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

    // Windows and Linux deliver a `present://` link by launching the app again
    // with the URL in argv. Without a single-instance lock that starts a second
    // copy of Present — a second audience window, a second NDI sender — instead
    // of signing the running one in. Registered first, as the plugin requires.
    #[cfg(all(desktop, not(target_os = "macos")))]
    {
        builder = builder.plugin(tauri_plugin_single_instance::init(|app, argv, _cwd| {
            if let Some(url) = services::deep_link::find_in_args(argv) {
                services::deep_link::handle(app, &url);
            } else if let Some(window) =
                app.get_webview_window(services::window_spec::WindowRole::Main.label())
            {
                let _ = window.set_focus();
            }
        }));
    }

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

    #[cfg(desktop)]
    {
        builder = builder.plugin(tauri_plugin_global_shortcut::Builder::new().build());
    }

    builder
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_deep_link::init())
        // `local-media://` — the scheme the whole media pipeline fetches
        // through. Registered asynchronously so a range read off a slow disk
        // cannot stall the window it is feeding.
        .register_asynchronous_uri_scheme_protocol("local-media", |context, request, responder| {
            let app = context.app_handle().clone();
            let uri = request.uri().to_string();
            let range = request
                .headers()
                .get("Range")
                .and_then(|value| value.to_str().ok())
                .map(str::to_owned);

            // Reading the file happens off the thread this closure runs on:
            // a range read from a projector-side USB drive is slow enough to be
            // visible if it blocks the window's message loop.
            tauri::async_runtime::spawn_blocking(move || {
                let Some(state) = app.try_state::<state::FileState>() else {
                    tracing::error!("local-media request before the file scope was registered");
                    return;
                };
                responder.respond(services::media_protocol::respond(
                    &state,
                    &uri,
                    range.as_deref(),
                ));
            });
        })
        .manage(app_state)
        .manage(WindowState::new())
        .manage(services::deep_link::PendingDeepLink::new())
        // The audience scene. In memory only: this is what is on screen right
        // now, and restoring last Sunday's slide on launch would be worse than
        // starting blank.
        .manage(state::OutputState::new())
        // Open lyric editors and the saves they are waiting on.
        .manage(services::mini_lyrics::MiniLyricsState::new())
        .on_menu_event(services::app_menu::handle)
        .invoke_handler(tauri::generate_handler![
            commands::app::get_app_info,
            commands::diagnostics::report_webview_capabilities,
            commands::diagnostics::report_diagnostic,
            commands::diagnostics::report_renderer_error,
            commands::speech::request_speech_token,
            commands::speech::report_speech_usage,
            commands::display::get_displays,
            commands::display::get_preferred_display,
            commands::display::set_preferred_display,
            commands::display::set_preferred_resolution,
            commands::display::get_preferred_resolution,
            commands::display::reconcile_displays,
            commands::window::open_window,
            commands::window::close_window,
            commands::window::open_mini_lyrics_window,
            commands::window::close_mini_lyrics_window,
            commands::window::list_open_windows,
            commands::file::select_folder,
            commands::file::select_library_export_destination,
            commands::file::select_library_import_source,
            commands::file::select_media_file,
            commands::file::select_audio_files,
            commands::file::select_prop_image,
            commands::file::select_prop_media,
            commands::file::select_presentation_files,
            commands::file::list_media_folders,
            commands::file::remove_media_folder,
            commands::file::read_folder,
            commands::file::copy_media_file,
            commands::file::rename_media_file,
            commands::file::delete_media_file,
            commands::file::create_directory,
            commands::file::rename_directory,
            commands::file::export_library_bundle,
            commands::file::import_library_bundle,
            commands::permissions::request_microphone_access,
            commands::permissions::request_camera_access,
            commands::permissions::get_microphone_access_status,
            commands::permissions::get_camera_access_status,
            commands::deep_link::take_pending_deep_link,
            commands::looks::get_looks_config,
            commands::looks::set_looks_target,
            commands::looks::set_selected_look,
            commands::looks::add_look,
            commands::looks::set_look_name,
            commands::looks::set_look_layer,
            commands::looks::set_look_text_position,
            commands::auth::get_stored_auth_session,
            commands::auth::set_stored_auth_session,
            commands::auth::clear_stored_auth_session,
            commands::auth::consume_pending_auth_token,
            commands::auth::begin_auth_flow,
            commands::auth::open_external_browser,
            commands::auth::refresh_desktop_session,
            commands::output::get_output_scene,
            commands::output::send_to_output,
            commands::output::set_output_frozen,
            commands::output::is_output_frozen,
            commands::presentation::get_presentation_position,
            commands::presentation::set_presentation_service,
            commands::presentation::set_presentation_service_item,
            commands::presentation::set_presentation_service_group,
            commands::presentation::set_presentation_deck,
            commands::presentation::go_to_slide,
            commands::presentation::next_slide,
            commands::presentation::previous_slide,
            commands::presentation::reconcile_presentation_services,
            commands::mini_lyrics::get_mini_lyrics_payload,
            commands::mini_lyrics::save_mini_lyrics,
            commands::mini_lyrics::respond_mini_lyrics_save
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
            // The media folders, and with them the only paths `local-media://`
            // will serve. Registered before any window exists so the operator
            // window's first media request already has a scope to check.
            app.manage(state::FileState::load(&config_dir));
            // The output layer flags. Stage 4's first slice: what the
            // congregation sees is now owned here rather than in React, and
            // reaches the other windows as an event instead of a 400ms poll.
            app.manage(state::LooksState::load(&config_dir));
            // The auth session, in the OS keychain rather than in one of two
            // files chosen by whether the app was packaged — half of
            // known-issues §2.
            app.manage(state::AuthState::load(&config_dir));
            // Where the operator is: which service, which item, which slide.
            // The service half persists so reopening mid-service does not lose
            // their place.
            app.manage(state::PresentationState::load(&config_dir));

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

            // Tauri emits no monitor-change event on any platform, so the
            // equivalent of Electron's three `screen` subscriptions
            // (`main/index.ts:74-82`) is a poll. See services/display_watch.rs
            // for why polling rather than three platform observers.
            services::display_watch::spawn(app.handle().clone());

            if let Err(error) = services::app_menu::install(app.handle()) {
                // A missing menu costs the operator `Cmd+,` and the import
                // items, not the service. Log it and keep going.
                tracing::error!(%error, "could not install the application menu");
            }

            #[cfg(desktop)]
            services::shortcuts::register(app.handle());

            // The scheme is declared in tauri.conf.json for the installer to
            // register with the OS; this is the runtime half. On macOS the link
            // arrives as an Apple event rather than in argv.
            #[cfg(desktop)]
            {
                use tauri_plugin_deep_link::DeepLinkExt;

                let handle = app.handle().clone();
                app.deep_link().on_open_url(move |event| {
                    for url in event.urls() {
                        services::deep_link::handle(&handle, url.as_str());
                    }
                });

                // A link that launched the app on Windows or Linux is already
                // in argv by the time we get here.
                if let Some(url) = services::deep_link::find_in_args(std::env::args()) {
                    services::deep_link::handle(app.handle(), &url);
                }
            }

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
