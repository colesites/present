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
use tauri::{
    AppHandle, Emitter, LogicalPosition, LogicalSize, Manager, PhysicalPosition, PhysicalSize,
    WebviewUrl, WebviewWindow, WebviewWindowBuilder, WindowEvent,
};

use crate::errors::AppResult;
use crate::services::display::{Display, Rect};
use crate::services::monitors;
use crate::services::window_spec::{Placement, Rgb, WindowRole, WindowSpec};
use crate::state::{OutputSurfaceState, WindowState};

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

/// What to do about a window that may or may not be on the right monitor.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Reposition {
    /// The window already covers the target. Touching it would be a visible
    /// change for no reason.
    Leave,
    /// Move and resize it. `leave_fullscreen` when the window has to be taken
    /// out of fullscreen first, which on macOS is an animated transition the
    /// audience can see.
    Move { leave_fullscreen: bool },
}

/// Decide whether a window needs moving.
///
/// This is the fix for known-issues §9. Electron guards the whole reposition on
/// the window *not* being fullscreen (`display.service.ts:135-152`), and the
/// audience window always is, so its hot-plug handlers have never moved
/// anything. Removing the guard outright would be worse than leaving it: every
/// unrelated display event would drop the projector out of fullscreen and back
/// again, mid-service.
///
/// So the guard is replaced rather than deleted. The question is not "is it
/// fullscreen" but "is it already where it belongs", and only a window that is
/// genuinely on the wrong monitor pays the transition.
pub fn plan_reposition(
    window_position: (i32, i32),
    window_size: (u32, u32),
    is_fullscreen: bool,
    target: Rect,
) -> Reposition {
    // Fullscreen is part of "correct", not just geometry. A window can sit at
    // exactly the right bounds and still be an ordinary window — macOS leaves
    // one that way after the monitor it was fullscreen on disappears — and on
    // the audience screen that means the menu bar and Dock sit over the output.
    let already_correct = is_fullscreen
        && window_position == (target.x, target.y)
        && window_size == (target.width, target.height);

    if already_correct {
        Reposition::Leave
    } else {
        Reposition::Move {
            leave_fullscreen: is_fullscreen,
        }
    }
}

/// How long to give macOS to finish the exit-fullscreen animation before
/// repositioning. A window still animating ignores `set_position`.
const FULLSCREEN_EXIT_SETTLE: Duration = Duration::from_millis(700);

/// Move an existing window onto `target` and fill it.
///
/// Does nothing when the window already covers `target`, which is the common
/// case for a display event on some other monitor.
pub fn place(window: &WebviewWindow, target: &Display) -> AppResult<()> {
    let position = window.outer_position()?;
    let size = window.outer_size()?;
    let is_fullscreen = window.is_fullscreen()?;

    let plan = plan_reposition(
        (position.x, position.y),
        (size.width, size.height),
        is_fullscreen,
        target.bounds,
    );

    let Reposition::Move { leave_fullscreen } = plan else {
        return Ok(());
    };

    tracing::info!(
        label = %window.label(),
        display = target.id,
        %leave_fullscreen,
        "moving window onto its preferred display"
    );

    if leave_fullscreen {
        window.set_fullscreen(false)?;
        // Not on the main thread — this is the watcher thread or a command —
        // so sleeping here blocks nothing that matters.
        std::thread::sleep(FULLSCREEN_EXIT_SETTLE);
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
    tracing::info!(label = %spec.label, "window shown");

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

    if spec.role == WindowRole::Main {
        crate::services::splash::close(window.app_handle());
    }
}

/// The page in `window` has drawn: show it, once.
pub fn reveal_when_drawn(window: &WebviewWindow) {
    let Some(state) = window.app_handle().try_state::<WindowState>() else {
        return;
    };
    match state.pending_reveal(window.label()) {
        Some((spec, shown)) => reveal(window, &spec, &shown),
        None => {
            tracing::debug!(label = %window.label(), "window_ready from a window with no pending reveal")
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

    let window = builder.build()?;

    // On Windows and Linux the application menu is a bar inside each window.
    // It belongs on the operator's, and on nothing an audience or a stage
    // might see: a menu bar across the projector is exactly what a
    // congregation notices. macOS has one bar for the whole app, at the top of
    // the screen, and nothing in any window to take away.
    #[cfg(not(target_os = "macos"))]
    if spec.role != WindowRole::Main {
        if let Err(error) = window.remove_menu() {
            tracing::warn!(label = %spec.label, %error, "could not take the menu bar off a window");
        }
    }

    // Shown when its page has drawn (`window_ready`), not when the document
    // has loaded: between the two a webview is white, which is what an operator
    // saw opening the app and a congregation saw when the output opened.
    if let Some(state) = app.try_state::<WindowState>() {
        state.await_reveal(spec, Arc::clone(&shown));
    }

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
    // Windows and Linux only; Tauri's own hook covers macOS (known-issues §10).
    crate::services::webview_crash::watch(&window);

    // The operator's opt-in to the natively drawn audience screen. A no-op
    // when it is off, which it is by default.
    if spec.role == WindowRole::Output {
        if let Some(surface) = app.try_state::<Arc<OutputSurfaceState>>() {
            surface.attach(app);
        }
    }

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

        if role == WindowRole::Output {
            if let Some(surface) = app.try_state::<Arc<OutputSurfaceState>>() {
                surface.detach();
            }
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

#[cfg(test)]
mod tests {
    use super::*;

    const PROJECTOR: Rect = Rect {
        x: 1512,
        y: 0,
        width: 1920,
        height: 1080,
    };

    #[test]
    fn a_window_already_covering_its_display_is_left_alone() {
        // The common case: something changed on another monitor. Under the old
        // guard this was also a no-op, and it must stay one — dropping the
        // audience output out of fullscreen for an unrelated event would be a
        // visible fault during a service.
        assert_eq!(
            plan_reposition((1512, 0), (1920, 1080), true, PROJECTOR),
            Reposition::Leave
        );
    }

    #[test]
    fn a_fullscreen_window_on_the_wrong_monitor_is_moved() {
        // This is known-issues §9. Electron returns early here because the
        // window is fullscreen, so the projector never follows the preference.
        assert_eq!(
            plan_reposition((0, 0), (1512, 982), true, PROJECTOR),
            Reposition::Move {
                leave_fullscreen: true
            }
        );
    }

    #[test]
    fn a_windowed_window_on_the_wrong_monitor_needs_no_transition() {
        assert_eq!(
            plan_reposition((0, 0), (1512, 982), false, PROJECTOR),
            Reposition::Move {
                leave_fullscreen: false
            }
        );
    }

    #[test]
    fn correct_bounds_without_fullscreen_still_needs_fixing() {
        // macOS leaves a window at the right size but windowed after the
        // monitor it was fullscreen on goes away. On the audience screen that
        // shows the menu bar and Dock over the output.
        assert_eq!(
            plan_reposition((1512, 0), (1920, 1080), false, PROJECTOR),
            Reposition::Move {
                leave_fullscreen: false
            }
        );
    }

    #[test]
    fn a_resolution_change_on_the_same_monitor_moves_the_window() {
        // Same origin, new size: the projector switched to 720p. The window has
        // to be resized or it overhangs.
        let downscaled = Rect {
            x: 1512,
            y: 0,
            width: 1280,
            height: 720,
        };
        assert_eq!(
            plan_reposition((1512, 0), (1920, 1080), true, downscaled),
            Reposition::Move {
                leave_fullscreen: true
            }
        );
    }

    #[test]
    fn a_monitor_rearranged_to_a_new_origin_moves_the_window() {
        // Dragging the projector to the left of the laptop in display settings
        // changes its origin without changing its size.
        let relocated = Rect {
            x: -1920,
            y: 0,
            width: 1920,
            height: 1080,
        };
        assert_eq!(
            plan_reposition((1512, 0), (1920, 1080), true, relocated),
            Reposition::Move {
                leave_fullscreen: true
            }
        );
    }

    #[test]
    fn a_one_pixel_difference_still_counts() {
        // Exact comparison on purpose. A window one pixel short of the monitor
        // shows a line of desktop on the audience screen.
        assert_eq!(
            plan_reposition((1512, 0), (1920, 1079), true, PROJECTOR),
            Reposition::Move {
                leave_fullscreen: true
            }
        );
    }

    #[test]
    fn negative_origins_compare_correctly() {
        // A monitor placed above or left of the primary has negative
        // coordinates, and the comparison must not treat them as unset.
        let above = Rect {
            x: 0,
            y: -1080,
            width: 1920,
            height: 1080,
        };
        assert_eq!(
            plan_reposition((0, -1080), (1920, 1080), true, above),
            Reposition::Leave
        );
        assert_eq!(
            plan_reposition((0, 0), (1920, 1080), true, above),
            Reposition::Move {
                leave_fullscreen: true
            }
        );
    }
}
