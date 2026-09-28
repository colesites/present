//! Noticing that the monitors changed.
//!
//! Electron gets this for free: `screen` emits `display-added`,
//! `display-removed` and `display-metrics-changed`, and `main/index.ts:74-82`
//! reconciles the output window on each (or would — see known-issues §9).
//!
//! Tauri emits nothing. Neither tao nor Tauri surfaces a monitor-change event
//! on any platform, so the trigger has to be built. This polls.
//!
//! **Why polling rather than a platform notification.** macOS has
//! `NSApplicationDidChangeScreenParametersNotification`, Windows has
//! `WM_DISPLAYCHANGE`, and X11 and Wayland each have their own. Three
//! platform-specific observers is three times the surface for a mechanism that
//! must not fail during a service, and only the macOS one could be tested here.
//! A poll is one code path on all three, its failure mode is bounded latency
//! rather than a missed event, and the comparison it depends on is a pure
//! function with tests. The interval is the whole cost, and enumeration on
//! macOS is a `CGDisplay::active_displays()` call rather than anything that
//! touches AppKit.

use std::time::Duration;

use tauri::{AppHandle, Emitter, Manager};

use crate::services::display::Display;
use crate::services::display_identity::{identify, DisplayKey};
use crate::services::window_spec::{spec_for, WindowRole};
use crate::services::{monitors, window};
use crate::state::DisplayState;

/// What changed between two monitor snapshots.
///
/// The three fields mirror Electron's three `screen` events so the mapping
/// stays legible, even though every one of them triggers the same reconcile.
// `Eq` follows `Display`, which carries a scale factor and so is `PartialEq`
// only. See the note on that type.
#[derive(Debug, Default, Clone, PartialEq)]
pub struct DisplayChange {
    /// Connected since the last look.
    pub added: Vec<Display>,
    /// Gone since the last look.
    pub removed: Vec<Display>,
    /// Same monitor, different geometry — a resolution or arrangement change.
    pub changed: Vec<Display>,
}

impl DisplayChange {
    pub fn is_empty(&self) -> bool {
        self.added.is_empty() && self.removed.is_empty() && self.changed.is_empty()
    }

    /// A one-line summary for the log. During a service the log is the only
    /// record of what the hardware did.
    pub fn summary(&self) -> String {
        let names = |displays: &[Display]| {
            displays
                .iter()
                .map(|display| display.label.clone())
                .collect::<Vec<_>>()
                .join(", ")
        };
        format!(
            "added=[{}] removed=[{}] changed=[{}]",
            names(&self.added),
            names(&self.removed),
            names(&self.changed)
        )
    }
}

/// Compare two identified monitor sets.
///
/// Keyed on `DisplayKey` rather than on the derived numeric id, for the same
/// reason preferences are: the key is the identity, the id is a hash of it.
pub fn diff(
    previous: &[(DisplayKey, Display)],
    current: &[(DisplayKey, Display)],
) -> DisplayChange {
    let mut change = DisplayChange::default();

    for (key, display) in current {
        match previous.iter().find(|(candidate, _)| candidate == key) {
            None => change.added.push(display.clone()),
            Some((_, before)) if geometry_differs(before, display) => {
                change.changed.push(display.clone());
            }
            Some(_) => {}
        }
    }

    for (key, display) in previous {
        if !current.iter().any(|(candidate, _)| candidate == key) {
            change.removed.push(display.clone());
        }
    }

    change
}

/// Everything about a monitor that can move a window.
///
/// Two fields are deliberately excluded.
///
/// **The label.** `localized_name` is only read when a display list is built
/// for the frontend, so a snapshot taken without it would otherwise look like a
/// change every time one was taken with it.
///
/// **The work area.** This was included at first and caused a feedback loop.
/// macOS hides the menu bar for a fullscreen window, which changes the work
/// area of that monitor — on this machine from `y:50 height:2350` to the full
/// `height:2400`. So putting the audience output into fullscreen changed the
/// work area, which read as a display change, which reconciled the window,
/// which changed the work area again. Observed firing about once a second
/// against a single static monitor.
///
/// It is the right thing to exclude on the merits too: the work area is the
/// menu bar and the Dock, neither of which has anything to do with where a
/// full-screen window belongs. `bounds` is what a window is placed against.
fn geometry_differs(before: &Display, after: &Display) -> bool {
    before.bounds != after.bounds || before.is_primary != after.is_primary
}

/// How often to look.
///
/// Electron is event-driven and therefore instant; this is the latency that
/// buys one portable code path instead of three platform observers. One second
/// is short enough that an operator plugging in a projector sees it respond
/// before they have looked up.
pub const POLL_INTERVAL: Duration = Duration::from_secs(1);

/// The event the frontend gets when the monitor set changes.
///
/// Named in the audit's §11 event list. The React display pickers currently
/// poll every 15 s (`App.tsx:46`); this is what lets that go away.
pub const DISPLAY_LIST_CHANGED: &str = "display:list-changed";

/// Start watching for monitor changes.
///
/// One background thread for the life of the app. Each tick takes a
/// label-free geometry snapshot, and only a real change pays for the full
/// enumeration, the event and the reconcile pass.
pub fn spawn(app: AppHandle) {
    // Seeded from the same label-free snapshot each tick takes, so the first
    // comparison is like for like. Starting from an empty set would make that
    // tick report every monitor as newly added and reconcile windows that are
    // already correct.
    let mut previous = match monitors::geometry_snapshot(&app) {
        Ok(geometry) => identify(&geometry),
        Err(error) => {
            tracing::warn!(%error, "could not read monitors at startup; watching from empty");
            Vec::new()
        }
    };

    std::thread::spawn(move || loop {
        std::thread::sleep(POLL_INTERVAL);

        // Cheap check first. Geometry is all that can move a window, and this
        // path deliberately skips the main-thread hop for monitor labels.
        let geometry = match monitors::geometry_snapshot(&app) {
            Ok(geometry) => geometry,
            Err(error) => {
                tracing::warn!(%error, "monitor poll failed; will retry");
                continue;
            }
        };
        let current = identify(&geometry);
        let change = diff(&previous, &current);
        if change.is_empty() {
            continue;
        }

        tracing::info!(change = %change.summary(), "monitors changed");
        previous = current;

        // Re-read with labels for anything leaving the Rust core.
        let labelled = monitors::current_displays(&app)
            .map(|displays| {
                displays
                    .into_iter()
                    .map(|(_, display)| display)
                    .collect::<Vec<_>>()
            })
            .unwrap_or_default();
        if let Err(error) = app.emit(DISPLAY_LIST_CHANGED, &labelled) {
            tracing::warn!(%error, "failed to announce the display change");
        }

        reconcile_all(&app);
    });
}

/// Put every open full-screen window back on the display its role resolves to.
///
/// This is what `reconcileOutputWindowDisplay()` was meant to do
/// (`main/index.ts:74-82`). Electron only ever reconciled the audience output;
/// the two stage displays have the same problem and are included here.
pub fn reconcile_all(app: &AppHandle) {
    let Some(state) = app.try_state::<DisplayState>() else {
        tracing::warn!("display preferences unavailable; skipping reconcile");
        return;
    };

    for role in WindowRole::SINGLETONS {
        let spec = spec_for(role);
        let Some(screen_role) = spec.placement.screen_role() else {
            continue;
        };
        if app.get_webview_window(&spec.label).is_none() {
            continue;
        }

        // Each window is reconciled independently. A failure on one must not
        // leave the others on a monitor that no longer exists.
        match monitors::resolve_role(app, &state, screen_role) {
            Ok(Some(resolved)) => {
                if let Err(error) = window::reconcile(app, &spec, Some(&resolved.display)) {
                    tracing::error!(label = %spec.label, %error, "reconcile failed");
                }
            }
            Ok(None) => tracing::warn!(
                label = %spec.label,
                "no monitors connected; leaving the window where it is"
            ),
            Err(error) => {
                tracing::error!(label = %spec.label, %error, "could not resolve a display")
            }
        }
    }

    // Every other output window of Screen Configuration's screens, each on
    // the display chosen for it. One whose display has gone stays where it
    // is, as the built-in ones do when there is nothing to move to.
    for screen in state.snapshot().screens() {
        for output in screen.active_outputs() {
            let first_of_built_in =
                screen.is_built_in() && output.id == crate::services::screens::MAIN_OUTPUT;
            if first_of_built_in {
                continue;
            }
            let Some(spec) = crate::services::window_spec::output_spec(&screen, &output.id) else {
                continue;
            };
            if app.get_webview_window(&spec.label).is_none() {
                continue;
            }
            match monitors::resolve_output(app, &state, &screen, &output.id) {
                Ok(Some(display)) => {
                    if let Err(error) = window::reconcile(app, &spec, Some(&display)) {
                        tracing::error!(label = %spec.label, %error, "reconcile failed");
                    }
                }
                Ok(None) => tracing::warn!(
                    label = %spec.label,
                    "an output's display is not connected; leaving it where it is"
                ),
                Err(error) => {
                    tracing::error!(label = %spec.label, %error, "could not resolve a display")
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::services::display::Rect;

    fn display(id: i64, label: &str, x: i32, width: u32) -> Display {
        Display {
            id,
            label: label.to_owned(),
            bounds: Rect {
                x,
                y: 0,
                width,
                height: 1080,
            },
            // Deliberately inset, so a fixture that changes only `bounds`
            // proves `bounds` is what is compared.
            work_area: Rect {
                x,
                y: 25,
                width,
                height: 1055,
            },
            scale_factor: 1.0,
            is_primary: x == 0,
        }
    }

    fn key(name: &str) -> DisplayKey {
        DisplayKey {
            name: Some(name.to_owned()),
            ordinal: 0,
        }
    }

    fn laptop() -> (DisplayKey, Display) {
        (
            key("laptop"),
            display(1, "Built-in Retina Display", 0, 1512),
        )
    }

    fn projector() -> (DisplayKey, Display) {
        (key("projector"), display(2, "EPSON PowerLite", 1512, 1920))
    }

    #[test]
    fn an_unchanged_set_reports_nothing() {
        let before = vec![laptop(), projector()];
        let after = before.clone();
        assert!(diff(&before, &after).is_empty());
    }

    #[test]
    fn plugging_in_a_projector_is_an_addition() {
        let change = diff(&[laptop()], &[laptop(), projector()]);
        assert_eq!(change.added.len(), 1);
        assert_eq!(change.added[0].label, "EPSON PowerLite");
        assert!(change.removed.is_empty());
        assert!(change.changed.is_empty());
    }

    #[test]
    fn pulling_the_cable_is_a_removal() {
        let change = diff(&[laptop(), projector()], &[laptop()]);
        assert_eq!(change.removed.len(), 1);
        assert_eq!(change.removed[0].label, "EPSON PowerLite");
        assert!(change.added.is_empty());
    }

    #[test]
    fn a_resolution_change_is_reported_against_the_same_monitor() {
        let (projector_key, mut resized) = projector();
        resized.bounds.width = 1280;
        resized.work_area.width = 1280;

        let change = diff(
            &[laptop(), projector()],
            &[laptop(), (projector_key, resized)],
        );
        assert_eq!(change.changed.len(), 1);
        assert_eq!(change.changed[0].bounds.width, 1280);
        assert!(change.added.is_empty(), "the monitor did not come or go");
        assert!(change.removed.is_empty());
    }

    #[test]
    fn rearranging_monitors_is_a_change_not_a_swap() {
        // Dragging the projector to the left of the laptop in display settings.
        let (projector_key, mut moved) = projector();
        moved.bounds.x = -1920;
        moved.work_area.x = -1920;

        let change = diff(
            &[laptop(), projector()],
            &[laptop(), (projector_key, moved)],
        );
        assert_eq!(change.changed.len(), 1);
        assert!(change.added.is_empty());
        assert!(change.removed.is_empty());
    }

    #[test]
    fn the_primary_moving_counts_as_a_change() {
        // Making the projector the primary display re-ranks the selection rule,
        // so the audience output may need to move even though nothing was
        // plugged or unplugged.
        let (laptop_key, mut demoted) = laptop();
        demoted.is_primary = false;
        let (projector_key, mut promoted) = projector();
        promoted.is_primary = true;

        let change = diff(
            &[laptop(), projector()],
            &[(laptop_key, demoted), (projector_key, promoted)],
        );
        assert_eq!(change.changed.len(), 2);
    }

    #[test]
    fn a_work_area_change_is_not_a_display_change() {
        // Regression. macOS hides the menu bar for a fullscreen window, which
        // shrinks or grows that monitor's work area. Treating that as a display
        // change made putting the audience output into fullscreen trigger a
        // reconcile, which put it into fullscreen, about once a second.
        let (projector_key, mut menu_bar_hidden) = projector();
        menu_bar_hidden.work_area.y = 0;
        menu_bar_hidden.work_area.height = 1080;

        let change = diff(&[projector()], &[(projector_key, menu_bar_hidden)]);
        assert!(
            change.is_empty(),
            "the menu bar is not a reason to move the audience output"
        );
    }

    #[test]
    fn a_relabelled_monitor_is_not_a_change() {
        // The watcher takes label-free snapshots; a label appearing later must
        // not read as the hardware moving.
        let (projector_key, mut relabelled) = projector();
        relabelled.label = "Monitor #41024".to_owned();

        let change = diff(&[projector()], &[(projector_key, relabelled)]);
        assert!(change.is_empty());
    }

    #[test]
    fn swapping_one_monitor_for_another_reports_both_sides() {
        let change = diff(
            &[laptop(), projector()],
            &[laptop(), (key("tv"), display(3, "LG TV", 1512, 3840))],
        );
        assert_eq!(change.added.len(), 1);
        assert_eq!(change.removed.len(), 1);
    }

    #[test]
    fn losing_every_monitor_reports_them_all_removed() {
        // A laptop lid closed on a clamshell rig. The reconcile that follows
        // has to cope with an empty set rather than assume one is left.
        let change = diff(&[laptop(), projector()], &[]);
        assert_eq!(change.removed.len(), 2);
        assert!(change.added.is_empty());
    }

    #[test]
    fn the_summary_names_the_monitors() {
        let change = diff(&[laptop()], &[laptop(), projector()]);
        assert_eq!(
            change.summary(),
            "added=[EPSON PowerLite] removed=[] changed=[]"
        );
    }
}
