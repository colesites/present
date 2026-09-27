//! Reading the monitors the OS currently reports, and resolving a screen role
//! to one of them.
//!
//! This is the Tauri-facing half of the display layer. The rule itself lives in
//! `services/display.rs`, which stays free of Tauri types so it can be tested
//! against the JavaScript original. Everything here needs a running app.

use std::collections::HashMap;

use serde::Serialize;
use tauri::AppHandle;

use crate::errors::AppResult;
use crate::services::display::{select_preferred_display, Display, Rect, ScreenRole};
use crate::services::display_identity::{identify, DisplayKey, MonitorSnapshot};
use crate::services::display_names;
use crate::state::DisplayState;

/// Fetch human-readable monitor names, hopping to the main thread if needed.
///
/// AppKit will only hand out `NSScreen` from the main thread, and Tauri runs
/// commands off it. A label is cosmetic, so every failure here degrades to "no
/// localized name" rather than failing enumeration.
fn localized_names(app: &AppHandle) -> HashMap<(i32, i32), String> {
    // Already on the main thread (e.g. called from `setup`): just read it.
    // Going through `run_on_main_thread` from the main thread would deadlock.
    #[cfg(target_os = "macos")]
    if objc2_foundation::MainThreadMarker::new().is_some() {
        return display_names::localized_names_by_position();
    }

    let (sender, receiver) = std::sync::mpsc::channel();
    if app
        .run_on_main_thread(move || {
            let _ = sender.send(display_names::localized_names_by_position());
        })
        .is_err()
    {
        return HashMap::new();
    }

    // Bounded wait: a missing label must never hang a display query.
    receiver
        .recv_timeout(std::time::Duration::from_millis(500))
        .unwrap_or_else(|error| {
            tracing::warn!(%error, "timed out reading localized monitor names");
            HashMap::new()
        })
}

/// Read the monitors the OS currently reports.
fn snapshot_monitors(app: &AppHandle) -> AppResult<Vec<MonitorSnapshot>> {
    snapshot_monitors_with_labels(app, true)
}

/// Geometry only, skipping the AppKit lookup for human-readable names.
///
/// The hot-plug watcher runs this on a timer and only needs to know whether
/// anything moved. `localized_names` hops to the main thread, so calling it on
/// every tick would contend with the UI for no benefit — labels are cosmetic
/// and only matter when a display list is handed to the frontend.
pub fn geometry_snapshot(app: &AppHandle) -> AppResult<Vec<MonitorSnapshot>> {
    snapshot_monitors_with_labels(app, false)
}

fn snapshot_monitors_with_labels(
    app: &AppHandle,
    with_labels: bool,
) -> AppResult<Vec<MonitorSnapshot>> {
    let localized = if with_labels {
        localized_names(app)
    } else {
        HashMap::new()
    };

    let primary = app.primary_monitor()?;
    let primary_position = primary.as_ref().map(|monitor| {
        let position = monitor.position();
        (position.x, position.y)
    });

    let monitors = app
        .available_monitors()?
        .into_iter()
        .map(|monitor| {
            let position = monitor.position();
            let size = monitor.size();
            let work_area = monitor.work_area();

            MonitorSnapshot {
                name: monitor.name().cloned(),
                localized_name: localized.get(&(position.x, position.y)).cloned(),
                position: (position.x, position.y),
                size: (size.width, size.height),
                work_area: Rect {
                    x: work_area.position.x,
                    y: work_area.position.y,
                    width: work_area.size.width,
                    height: work_area.size.height,
                },
                scale_factor: monitor.scale_factor(),
                // Tauri does not flag the primary monitor, so match on position:
                // the primary is the one the OS places at the origin of the
                // virtual desktop.
                is_primary: primary_position == Some((position.x, position.y)),
            }
        })
        .collect();

    Ok(monitors)
}

/// Every connected monitor, paired with the key its preference is stored under.
pub fn current_displays(app: &AppHandle) -> AppResult<Vec<(DisplayKey, Display)>> {
    Ok(identify(&snapshot_monitors(app)?))
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ResolvedDisplay {
    /// The monitor this role will actually use right now.
    pub display: Display,
    /// Whether that is an explicit choice or the automatic fallback. The UI can
    /// use this to show "Auto" rather than pretending the operator picked it.
    pub is_explicit: bool,
}

/// Which monitor a role resolves to, applying the same rule as Electron.
///
/// `None` only when the OS reports no monitors at all.
pub fn resolve_role(
    app: &AppHandle,
    state: &DisplayState,
    role: ScreenRole,
) -> AppResult<Option<ResolvedDisplay>> {
    let identified = current_displays(app)?;
    Ok(resolve_role_among(&identified, &state.snapshot(), role))
}

/// [`resolve_role`] over monitors already read, for a caller resolving
/// several roles at once.
pub fn resolve_role_among(
    identified: &[(DisplayKey, Display)],
    preferences: &crate::state::display_state::DisplayPreferences,
    role: ScreenRole,
) -> Option<ResolvedDisplay> {
    if identified.is_empty() {
        return None;
    }
    let wanted = preferences.display_for(role);

    // Translate the persisted key into the id the selection rule works with.
    let preferred_id = wanted.and_then(|key| {
        identified
            .iter()
            .find(|(candidate, _)| candidate == key)
            .map(|(_, display)| display.id)
    });

    let displays: Vec<Display> = identified
        .iter()
        .map(|(_, display)| display.clone())
        .collect();
    let primary_id = displays
        .iter()
        .find(|display| display.is_primary)
        .map_or(displays[0].id, |display| display.id);

    let selected = select_preferred_display(&displays, primary_id, preferred_id)?;

    Some(ResolvedDisplay {
        display: selected.clone(),
        is_explicit: preferred_id.is_some_and(|id| id == selected.id),
    })
}

/// The display a screen in Screen Configuration goes to right now: its role's
/// for the three built in (Automatic included), and for an added screen the
/// one chosen for it, while that is connected.
pub fn resolve_screen(
    app: &AppHandle,
    state: &DisplayState,
    screen: &crate::services::screens::ScreenSetup,
) -> AppResult<Option<Display>> {
    if let Some(role) = screen.role() {
        return Ok(resolve_role(app, state, role)?.map(|resolved| resolved.display));
    }
    let Some(key) = state.snapshot().display_for_screen(&screen.id).cloned() else {
        return Ok(None);
    };
    Ok(current_displays(app)?
        .into_iter()
        .find(|(candidate, _)| *candidate == key)
        .map(|(_, display)| display))
}

/// The scale factor the OS reports for the monitor containing `bounds`.
///
/// Tauri reports monitor geometry in **physical** pixels but `WebviewWindowBuilder`
/// takes **logical** units, so every placement has to divide by this. Getting it
/// wrong puts the audience window on the wrong monitor on any Retina or scaled
/// display, which is why it is read rather than assumed to be 1.0.
pub fn scale_factor_at(app: &AppHandle, x: i32, y: i32) -> f64 {
    let found = app.available_monitors().ok().and_then(|monitors| {
        monitors.into_iter().find_map(|monitor| {
            let position = monitor.position();
            (position.x == x && position.y == y).then(|| monitor.scale_factor())
        })
    });

    // A monitor that vanished between enumeration and placement is a hot-plug
    // race, not a reason to fail: 1.0 puts the window at the physical origin we
    // already hold, which `set_position` then corrects exactly.
    found.unwrap_or(1.0)
}
