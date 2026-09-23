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

/// Installs tracing, to the terminal and to a daily log file
/// (`services/log_files.rs`). Verbosity comes from `RUST_LOG`, defaulting to
/// `info` for our own crate and `warn` for dependencies so a release run is
/// quiet.
fn init_tracing() {
    use tracing_subscriber::{fmt, prelude::*, EnvFilter};

    let filter = EnvFilter::try_from_default_env()
        .unwrap_or_else(|_| EnvFilter::new("warn,present_lib=info"));

    // No file is not a reason to start without logging to the terminal.
    let file = services::log_files::log_dir()
        .ok_or_else(|| "no log folder on this system".to_owned())
        .and_then(|dir| services::log_files::appender(&dir));
    let (file_layer, file_error) = match file {
        Ok(appender) => (
            Some(
                fmt::layer()
                    .with_target(true)
                    .with_ansi(false)
                    .with_writer(appender),
            ),
            None,
        ),
        Err(error) => (None, Some(error)),
    };

    // A second call would panic on the global-subscriber slot; ignore it so
    // tests and repeated entry points stay safe.
    let _ = tracing_subscriber::registry()
        .with(filter)
        .with(fmt::layer().with_target(true))
        .with(file_layer)
        .try_init();

    if let Some(error) = file_error {
        tracing::warn!(%error, "logging to the terminal only");
    }
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
    // macOS/iOS-only. Windows and Linux register the platform webviews' own
    // events per window instead (`services/webview_crash.rs`), because the
    // Electron build recovers on all three (known-issues §10).
    #[cfg(any(target_os = "macos", target_os = "ios"))]
    {
        builder = builder.on_web_content_process_terminate(|webview| {
            recover_from_webview_crash(
                webview.app_handle(),
                webview.label(),
                "web-content-process-terminated",
            );
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
                let response =
                    services::media_protocol::respond(&state, &uri, range.as_deref());

                // The answer goes back on the main thread, because that is
                // where WebKit both starts and stops a scheme task. Answering
                // from this thread races the stop: wry checks the task is
                // still alive and then hands it the response, and a cancel
                // landing between those two makes WebKit raise an Objective-C
                // exception. That crosses a frame that cannot unwind, which is
                // not a catchable error — it is `abort()`, and the whole app
                // goes down mid-service.
                //
                // A `<video>` cancels range requests constantly, as it seeks
                // and buffers and is torn down, so it hit this every time.
                // On the main thread the start, the stop and this answer are
                // the same queue, and the race has nowhere to happen. Only the
                // handing over moves — the disk read above stays here.
                #[cfg(target_os = "macos")]
                {
                    if let Err(error) =
                        app.run_on_main_thread(move || responder.respond(response))
                    {
                        tracing::warn!(%error, "could not answer a local-media request");
                    }
                }
                #[cfg(not(target_os = "macos"))]
                responder.respond(response);
            });
        })
        // `ndi-frame://frame/<source>` — the latest frame of the source an NDI
        // prop shows, as a JPEG, for the `<img>` that asks eight times a second.
        .register_asynchronous_uri_scheme_protocol("ndi-frame", |context, request, responder| {
            let app = context.app_handle().clone();
            let uri = request.uri().to_string();
            tauri::async_runtime::spawn_blocking(move || {
                let Some(state) = app.try_state::<std::sync::Arc<state::NdiInputState>>() else {
                    responder.respond(
                        tauri::http::Response::builder()
                            .status(204)
                            .body(Vec::new())
                            .unwrap_or_default(),
                    );
                    return;
                };
                responder.respond(state::ndi_input_state::respond(&state, &uri));
            });
        })
        // `output-frame://frame/audience?w=&h=&t=` — what is on the audience
        // screen, drawn by the compositor for the operator's own preview, as a
        // JPEG for the `<img>` that asks for it. The third consumer of the one
        // frame pipeline (ADR-001), after the audience surface and NDI.
        .register_asynchronous_uri_scheme_protocol("output-frame", |context, request, responder| {
            let app = context.app_handle().clone();
            let uri = request.uri().to_string();
            // Drawing a frame is work: off the thread this closure runs on, as
            // the media protocol does, so it never blocks the message loop.
            tauri::async_runtime::spawn_blocking(move || {
                let Some(state) = app.try_state::<state::PreviewState>() else {
                    responder.respond(
                        tauri::http::Response::builder()
                            .status(204)
                            .body(Vec::new())
                            .unwrap_or_default(),
                    );
                    return;
                };
                let response = state::preview_state::respond(&state, &app, &uri);
                responder.respond(response);
            });
        })
        // `transition-sample://frame/<id>?p=&w=&h=` — one moment of a
        // transition, drawn by the engine that will run it in front of the
        // congregation. The picker's tiles are not an imitation in CSS.
        .register_asynchronous_uri_scheme_protocol(
            "transition-sample",
            |_context, request, responder| {
                let uri = request.uri().to_string();
                tauri::async_runtime::spawn_blocking(move || {
                    responder.respond(services::compositor::transition::sample_response(&uri));
                });
            },
        )
        .manage(app_state)
        .manage(WindowState::new())
        .manage(services::deep_link::PendingDeepLink::new())
        // The audience scene. In memory only: this is what is on screen right
        // now, and restoring last Sunday's slide on launch would be worse than
        // starting blank.
        .manage(state::OutputState::new())
        // The operator's preview, drawn on demand. Made on first use, so a
        // machine whose operator never opens it carries nothing.
        .manage(state::PreviewState::new())
        // The NDI runtime and the stream while it runs. In memory: whether NDI
        // is on is a setting React re-applies on launch.
        .manage(state::NdiState::new())
        // The one NDI receiver props share. `Arc` because a delayed stop runs
        // on its own thread.
        .manage(std::sync::Arc::new(state::NdiInputState::new()))
        // The media transport. In memory: where a video had got to describes
        // the moment, not the operator's setup.
        .manage(state::PlaybackState::new())
        // What each stage display was last sent, for one that opens mid-service.
        .manage(state::StageRelayState::new())
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
            commands::window::window_ready,
            commands::window::get_splash_status,
            commands::window::set_splash_status,
            commands::file::select_folder,
            commands::file::select_library_export_destination,
            commands::file::select_library_import_source,
            commands::file::select_media_file,
            commands::file::select_audio_files,
            commands::file::select_prop_image,
            commands::file::select_prop_media,
            commands::file::select_presentation_files,
            commands::file::list_media_folders,
            commands::file::add_media_folder,
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
            commands::audio::get_audio_graph,
            commands::audio::get_source_routing,
            commands::audio::set_audio_device,
            commands::audio::set_audio_source_gain,
            commands::audio::set_audio_source_muted,
            commands::audio::set_audio_master_gain,
            commands::audio::set_audio_master_muted,
            commands::playback::get_playback,
            commands::playback::select_playback_media,
            commands::playback::play_playback,
            commands::playback::pause_playback,
            commands::playback::toggle_playback,
            commands::playback::stop_playback,
            commands::playback::seek_playback,
            commands::playback::report_playback_position,
            commands::playback::set_playback_duration,
            commands::playback::playback_ended,
            commands::compositor::render_output_frame,
            commands::media::check_video_support,
            commands::looks::get_looks_config,
            commands::looks::set_looks_target,
            commands::looks::set_selected_look,
            commands::looks::add_look,
            commands::looks::set_look_name,
            commands::looks::set_look_layer,
            commands::looks::set_look_layers,
            commands::looks::set_look_text_position,
            commands::auth::get_stored_auth_session,
            commands::auth::set_stored_auth_session,
            commands::auth::clear_stored_auth_session,
            commands::auth::consume_pending_auth_token,
            commands::auth::begin_auth_flow,
            commands::auth::open_external_browser,
            commands::auth::refresh_desktop_session,
            commands::ndi::start_ndi_output,
            commands::ndi::stop_ndi_output,
            commands::ndi::get_ndi_status,
            commands::ndi::list_ndi_sources,
            commands::ndi::start_ndi_input,
            commands::ndi::stop_ndi_input,
            commands::ai_operator::list_ai_operator_tools,
            commands::browser_mode::set_browser_mode_enabled,
            commands::browser_mode::set_browser_mode_bounds,
            commands::browser_mode::browser_navigate,
            commands::browser_mode::browser_back,
            commands::browser_mode::browser_forward,
            commands::browser_mode::browser_reload,
            commands::browser_mode::set_browser_projection_target,
            commands::browser_mode::get_browser_mode_state,
            commands::browser_mode::fetch_browser_suggestions,
            commands::thumbnails::get_media_thumbnail,
            commands::songs::import_openlyrics_songs,
            commands::scripture::parse_scripture_reference,
            commands::scripture::understand_spoken_scripture,
            commands::control::get_control_settings,
            commands::control::set_control_settings,
            commands::control::run_control_action,
            commands::control::learn_midi_message,
            commands::remote::get_remote_status,
            commands::remote::set_remote_settings,
            commands::offline::offline_list,
            commands::offline::offline_put,
            commands::offline::offline_remove,
            commands::offline::offline_replace,
            commands::offline::offline_enqueue,
            commands::offline::offline_queued,
            commands::offline::offline_workspaces,
            commands::offline::offline_dequeue,
            commands::offline::offline_queue_depth,
            commands::offline::offline_new_id,
            commands::pptx::open_pptx,
            commands::pptx::parse_pptx,
            commands::fonts::get_system_fonts,
            commands::fonts::get_system_font_faces,
            commands::fonts::pick_font_file,
            commands::fonts::install_custom_fonts,
            commands::fonts::get_custom_fonts,
            commands::web_storage::get_web_storage,
            commands::web_storage::initialize_web_storage,
            commands::web_storage::set_web_storage_items,
            commands::stage::send_to_stage,
            commands::stage::get_stage_messages,
            commands::bible::list_bundled_bibles,
            commands::bible::read_bundled_bible,
            commands::bible::fetch_hosted_bible_catalog,
            commands::surface::get_output_surface,
            commands::transitions::get_transitions,
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
            // The redacted local error log, first, so a panic in anything set up
            // after it is written down before the release build aborts.
            let data_dir = app
                .path()
                .app_data_dir()
                .unwrap_or_else(|_| config_dir.clone());
            let error_log = std::sync::Arc::new(services::error_log::ErrorLog::new(
                &data_dir,
                env!("CARGO_PKG_VERSION"),
            ));
            services::error_log::record_panics(std::sync::Arc::clone(&error_log));
            app.manage(error_log);
            // The durable copy of the app's browser storage (known-issues §2).
            // Before any window, which asks for it before React starts.
            app.manage(state::WebStorageState::load(&config_dir));
            app.manage(state::DisplayState::load(&config_dir));
            // The media folders, and with them the only paths `local-media://`
            // will serve. Registered before any window exists so the operator
            // window's first media request already has a scope to check.
            app.manage(state::FileState::load(&config_dir));
            {
                // Media folders that update live.
                let watch = services::media_watch::MediaWatch::start(app.handle().clone());
                watch.sync_with(&app.state::<state::FileState>());
                app.manage(watch);
            }
            // The offline library: the songs, services and messages a church
            // has when the internet does not.
            match state::StoreState::load(&config_dir) {
                Ok(store) => {
                    app.manage(store);
                }
                Err(error) => {
                    tracing::error!(%error, "the offline library could not be opened");
                }
            }
            app.manage(commands::thumbnails::ThumbnailQueue::default());
            // Foot pedals, MIDI and OSC. Both are off until somebody sets them
            // up, so this opens nothing on a fresh install.
            {
                let control = state::ControlState::load(&config_dir);
                control.listen(app.handle());
                app.manage(control);
            }
            // The phone remote, off until somebody turns it on.
            {
                let remote = state::RemoteState::load(&config_dir);
                remote.apply(app.handle());
                app.manage(remote);
            }
            // Browser mode (Stage 7). Its views report through `signals`, and
            // are answered here, off the main thread they live on.
            {
                use services::browser_mode::{view::WryHost, BrowserMode};
                let (signals, mut receiver) = tokio::sync::mpsc::unbounded_channel();
                let browser = BrowserMode::new(WryHost::new(app.handle().clone(), signals));
                app.manage(std::sync::Arc::clone(&browser));
                tauri::async_runtime::spawn(async move {
                    while let Some(signal) = receiver.recv().await {
                        browser.on_signal(signal).await;
                    }
                });
            }
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
            // The single audio path: one sink, one device, both sources.
            // Persisted because the device choice is wired up once when the
            // desk is, and because localStorage partitions it per origin.
            app.manage(state::AudioState::load(&config_dir));
            // The view the audience window is drawn on. Not a setting: the
            // compositor draws the audience output wherever it can.
            app.manage(std::sync::Arc::new(state::OutputSurfaceState::new()));

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
            app.manage(services::splash::SplashState::default());
            services::splash::open(app.handle());
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
/// `main.window.ts:196-227`, on every platform: Tauri's hook on macOS, and on
/// Windows and Linux the platform webviews' own events, registered per window in
/// `services/webview_crash.rs`. Each caller passes only abnormal terminations,
/// so there is no clean-exit case to skip here.
pub(crate) fn recover_from_webview_crash(app: &tauri::AppHandle, label: &str, reason: &str) {
    use services::window_spec::CrashAction;

    let label = label.to_owned();

    if let Some(log) = app.try_state::<std::sync::Arc<services::error_log::ErrorLog>>() {
        let mut context = serde_json::Map::new();
        context.insert("label".to_owned(), serde_json::Value::String(label.clone()));
        context.insert(
            "reason".to_owned(),
            serde_json::Value::String(reason.to_owned()),
        );
        log.record(&services::error_log::ErrorEvent {
            category: services::error_log::Category::Renderer,
            message: format!("Renderer process exited: {reason}"),
            name: None,
            stack: None,
            context,
        });
    }

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
            tracing::error!(%label, %reason, "webview content process died; reloading");
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
