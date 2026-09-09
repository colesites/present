//! Turning a [`WindowSpec`] into a real window.
//!
//! Ported from the eight modules under `src/main/windows/`. The behaviour that
//! matters during a live service is spelled out here once, rather than being
//! repeated (and drifting) across eight `new BrowserWindow({...})` calls:
//!
//! * the window is created hidden and shown on its first paint, so no window
//!   ever appears with an unpainted frame;
//! * every window carries its final background colour from the moment it
//!   exists, so even the hidden frame is the right colour;
//! * background throttling is off, which is what stops the audience output
//!   blanking when the operator window takes focus;
//! * a bounded watchdog shows the window anyway if that first paint never
//!   arrives.
//!
//! Placement is the one thing that has no Electron equivalent to copy. Electron
//! works in device-independent pixels throughout; Tauri reports monitor
//! geometry in **physical** pixels but its window builder takes **logical**
//! units, so a Retina monitor at physical x=3840 would be placed at logical
//! x=3840 — half a screen past where it belongs. See [`place`].

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Duration;

use tauri::utils::config::{BackgroundThrottlingPolicy, Color};
use tauri::webview::PageLoadEvent;
use tauri::{
    AppHandle, Emitter, LogicalPosition, LogicalSize, Manager, PhysicalPosition, PhysicalSize,
    WebviewUrl, WebviewWindow, WebviewWindowBuilder, WindowEvent,
};

use crate::errors::AppResult;
use crate::services::display::Display;
use crate::services::monitors;
use crate::services::window_spec::{Placement, Rgb, WindowRole, WindowSpec};
use crate::state::WindowState;

fn color(rgb: Rgb) -> Color {
    Color(rgb.0, rgb.1, rgb.2, 255)
}

/// Physical monitor geometry, converted to the logical units the builder wants.
///
/// Returns `None` for a windowed placement, which is centred instead.
fn logical_geometry(
    app: &AppHandle,
    placement: Placement,
    target: Option<&Display>,
) -> Option<(LogicalPosition<f64>, LogicalSize<f64>)> {
    let (Placement::FillRoleDisplay { .. }, Some(display)) = (placement, target) else {
        return None;
    };

    let scale =
        monitors::scale_factor_at(app, display.bounds.x, display.bounds.y).max(f64::EPSILON);
    Some((
        LogicalPosition::new(
            f64::from(display.bounds.x) / scale,
            f64::from(display.bounds.y) / scale,
        ),
        LogicalSize::new(
            f64::from(display.bounds.width) / scale,
            f64::from(display.bounds.height) / scale,
        ),
    ))
}

/// Move an existing window onto `target` and fill it.
///
/// The Electron original (`display.service.ts:135-152`) only repositions a
/// window that is not already fullscreen, because moving a fullscreen window on
/// macOS tears it out of its Space. Same rule here.
pub fn place(window: &WebviewWindow, target: &Display) -> AppResult<()> {
    if window.is_fullscreen()? {
        return Ok(());
    }

    // Physical units: these are the exact numbers the monitor reported, so no
    // scale-factor arithmetic can round them onto the wrong screen.
    window.set_position(PhysicalPosition::new(target.bounds.x, target.bounds.y))?;
    window.set_size(PhysicalSize::new(target.bounds.width, target.bounds.height))?;
    window.set_fullscreen(true)?;
    Ok(())
}

/// Show a window that has been waiting for its first paint.
///
/// Idempotent by way of `shown`: the page-load hook and the watchdog race each
/// other by design, and whichever arrives first wins.
fn reveal(window: &WebviewWindow, spec: &WindowSpec, shown: &AtomicBool) {
    if shown.swap(true, Ordering::SeqCst) {
        return;
    }

    if let Err(error) = window.show() {
        tracing::error!(label = %spec.label, %error, "failed to show window");
        return;
    }

    if spec.placement.is_fullscreen() {
        // `is_fullscreen` can fail on a window that is being torn down; treat
        // an unreadable state as "not fullscreen" and ask for it anyway.
        if !window.is_fullscreen().unwrap_or(false) {
            if let Err(error) = window.set_fullscreen(true) {
                tracing::error!(label = %spec.label, %error, "failed to enter fullscreen");
            }
        }
    }

    if spec.focus_on_show {
        if let Err(error) = window.set_focus() {
            tracing::warn!(label = %spec.label, %error, "failed to focus window");
        }
    }
}

/// Create the window described by `spec`, or focus and reposition the one that
/// already exists.
///
/// `target` is the monitor a fullscreen role resolved to; `None` for windowed
/// roles, and also for a fullscreen role at the moment no monitor is connected
/// — in which case the window is created at its default position rather than
/// not at all.
pub fn open(
    app: &AppHandle,
    spec: &WindowSpec,
    target: Option<&Display>,
) -> AppResult<WebviewWindow> {
    if let Some(existing) = app.get_webview_window(&spec.label) {
        // Matching Electron: reopening an open window focuses it and moves it
        // onto whatever display the preference now resolves to.
        if let Some(display) = target {
            place(&existing, display)?;
        }
        existing.set_focus()?;
        return Ok(existing);
    }

    let mut builder =
        WebviewWindowBuilder::new(app, &spec.label, WebviewUrl::App(spec.url.clone().into()))
            .title(&spec.title)
            // Hidden until the first paint. Every window in the app defers this, and
            // for the audience output it is the difference between a black screen and
            // a white flash in front of the congregation.
            .visible(false)
            .background_color(color(spec.background))
            // Without this the audience output throttles when the operator window
            // takes focus, which shows up on the projector as a blank frame.
            // (`output.window.ts:68-71`, `main.window.ts:132-135`.)
            .background_throttling(BackgroundThrottlingPolicy::Disabled);

    match spec.placement {
        Placement::FillRoleDisplay { .. } => {
            // Deliberately left resizable, as Electron leaves it. A frameless
            // window covering a whole monitor cannot be dragged or resized
            // anyway, and on macOS a non-resizable NSWindow is a poor
            // candidate for fullscreen.
            builder = builder.decorations(false);
            if let Some((position, size)) = logical_geometry(app, spec.placement, target) {
                builder = builder
                    .position(position.x, position.y)
                    .inner_size(size.width, size.height);
            }
        }
        Placement::Windowed {
            width,
            height,
            min,
            max,
        } => {
            builder = builder.inner_size(width, height).center();
            if let Some((min_width, min_height)) = min {
                builder = builder.min_inner_size(min_width, min_height);
            }
            if let Some((max_width, max_height)) = max {
                builder = builder.max_inner_size(max_width, max_height);
            }
        }
    }

    let shown = Arc::new(AtomicBool::new(false));

    {
        let spec = spec.clone();
        let shown = Arc::clone(&shown);
        builder = builder.on_page_load(move |window, payload| {
            if payload.event() == PageLoadEvent::Finished {
                reveal(&window, &spec, &shown);
            }
        });
    }

    let window = builder.build()?;

    // The builder took logical units; assert the physical truth now that the
    // window exists, so a scale factor read a moment ago cannot leave the
    // audience output a few pixels onto the wrong monitor.
    if let Some(display) = target {
        if spec.placement.is_fullscreen() {
            place(&window, display)?;
        }
    }

    spawn_show_watchdog(app, spec, Arc::clone(&shown));
    register_close_handler(app, &window, spec);

    tracing::info!(
        label = %spec.label,
        url = %spec.url,
        display = ?target.map(|display| display.id),
        "window created"
    );

    Ok(window)
}

/// Show the window anyway if its first paint has not arrived in time.
///
/// Electron has no equivalent — `ready-to-show` either fires or the window
/// stays hidden forever, and a hidden audience window is indistinguishable from
/// a broken projector. The window already carries its final background colour,
/// so showing early is visually free.
fn spawn_show_watchdog(app: &AppHandle, spec: &WindowSpec, shown: Arc<AtomicBool>) {
    if spec.show_watchdog_ms == 0 {
        return;
    }

    let app = app.clone();
    let spec = spec.clone();
    std::thread::spawn(move || {
        std::thread::sleep(Duration::from_millis(spec.show_watchdog_ms));
        if shown.load(Ordering::SeqCst) {
            return;
        }

        // Resolved by label rather than held as a clone: a window closed
        // during the wait is simply gone by now, and showing it again would be
        // worse than doing nothing.
        let Some(window) = app.get_webview_window(&spec.label) else {
            return;
        };

        tracing::warn!(
            label = %spec.label,
            waited_ms = spec.show_watchdog_ms,
            "first paint never arrived; showing the window anyway"
        );
        reveal(&window, &spec, &shown);
    });
}

/// Tell the operator window when one of its child windows goes away, and clear
/// the closed window's crash history.
fn register_close_handler(app: &AppHandle, window: &WebviewWindow, spec: &WindowSpec) {
    let app = app.clone();
    let label = spec.label.clone();
    let role = spec.role;

    window.on_window_event(move |event| {
        if !matches!(event, WindowEvent::Destroyed) {
            return;
        }

        if let Some(state) = app.try_state::<WindowState>() {
            state.forget(&label);
        }

        // Settings is a child of the operator window and does not outlive it
        // (`main.window.ts:245-249`).
        if role == WindowRole::Main {
            if let Err(error) = close(&app, WindowRole::Settings.label()) {
                tracing::warn!(%error, "failed to close settings with the main window");
            }
        }

        let Some(event_name) = role.closed_event() else {
            return;
        };
        if let Some(main) = app.get_webview_window(WindowRole::Main.label()) {
            if let Err(error) = main.emit(event_name, ()) {
                tracing::warn!(%event_name, %error, "failed to announce window close");
            }
        }
    });
}

/// Close the window with this label. `false` when there was nothing open.
pub fn close(app: &AppHandle, label: &str) -> AppResult<bool> {
    let Some(window) = app.get_webview_window(label) else {
        return Ok(false);
    };
    window.close()?;
    Ok(true)
}

/// Move a role's window back onto whatever display its preference now resolves
/// to. A no-op when that window is not open.
///
/// This is the reconcile pass the three `screen` events in `main/index.ts:74-82`
/// drive under Electron.
pub fn reconcile(app: &AppHandle, spec: &WindowSpec, target: Option<&Display>) -> AppResult<()> {
    let (Some(window), Some(display)) = (app.get_webview_window(&spec.label), target) else {
        return Ok(());
    };
    place(&window, display)
}
