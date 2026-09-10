//! Which monitor a screen role lands on.
//!
//! This is a port of `src/shared/lib/display-selection.mjs`. The two must stay
//! in step: the test module below mirrors `tests/display-selection.test.mjs`
//! case for case, so a behaviour change on one side fails on the other.

use serde::{Deserialize, Serialize};

/// A monitor as the frontend sees it. Field names match the shape
/// `get-displays` returns today (`window.ipc.ts:44-52`) so the React side does
/// not change when the source of this data moves to Rust.
// `Eq` is out once a float is a field. Displays are compared for "did the
// monitor layout change", which `PartialEq` answers: two scale factors read
// from the same OS call are bit-identical, so no epsilon is wanted here.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Display {
    pub id: i64,
    pub label: String,
    /// Physical pixels, not the device-independent ones Electron reports. The
    /// settings picker prints this as the monitor's resolution, where physical
    /// is the more useful of the two — an operator choosing an output
    /// resolution is thinking about the projector's native mode. It also means
    /// a scaled built-in display reads differently here than under Electron.
    pub bounds: Rect,
    pub work_area: Rect,
    /// What the OS scales this monitor by. Needed by the settings screen, and
    /// by anything converting between the physical geometry above and the
    /// logical units `WebviewWindowBuilder` takes.
    pub scale_factor: f64,
    pub is_primary: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct Rect {
    pub x: i32,
    pub y: i32,
    pub width: u32,
    pub height: u32,
}

impl Rect {
    fn area(&self) -> u64 {
        u64::from(self.width) * u64::from(self.height)
    }
}

/// The three surfaces that can be sent to a monitor.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ScreenRole {
    Audience,
    Media,
    Worship,
}

/// Pick the display for a role.
///
/// 1. An explicitly chosen display wins, but only while it is still connected.
/// 2. Otherwise prefer the largest non-primary display — on a church setup the
///    projector or TV is the big external one.
/// 3. With no external display, fall back to the primary.
///
/// Returns `None` only when `displays` is empty.
pub fn select_preferred_display(
    displays: &[Display],
    primary_id: i64,
    preferred_display_id: Option<i64>,
) -> Option<&Display> {
    if displays.is_empty() {
        return None;
    }

    if let Some(wanted) = preferred_display_id {
        if let Some(explicit) = displays.iter().find(|display| display.id == wanted) {
            return Some(explicit);
        }
    }

    let primary = displays
        .iter()
        .find(|display| display.id == primary_id)
        .unwrap_or(&displays[0]);

    // `max_by_key` returns the LAST maximum, so iterate in reverse to keep the
    // JS `sort`'s first-listed tie-break. A stable tie-break matters: the
    // audience screen must not swap monitors when an identical panel
    // reconnects mid-service.
    displays
        .iter()
        .rev()
        .filter(|display| display.id != primary_id)
        .max_by_key(|display| display.bounds.area())
        .or(Some(primary))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn display(id: i64, width: u32, height: u32) -> Display {
        Display {
            id,
            label: format!("Display {id}"),
            bounds: Rect {
                x: 0,
                y: 0,
                width,
                height,
            },
            work_area: Rect {
                x: 0,
                y: 0,
                width,
                height,
            },
            scale_factor: 1.0,
            is_primary: false,
        }
    }

    fn laptop() -> Display {
        display(1, 1512, 982)
    }

    fn projector() -> Display {
        display(2, 1920, 1080)
    }

    fn tv() -> Display {
        display(3, 3840, 2160)
    }

    #[test]
    fn only_builtin_display() {
        let displays = vec![laptop()];
        let chosen = select_preferred_display(&displays, 1, None).expect("a display");
        assert_eq!(chosen.id, 1);
    }

    #[test]
    fn prefers_largest_external_over_primary() {
        let displays = vec![laptop(), projector(), tv()];
        let chosen = select_preferred_display(&displays, 1, None).expect("a display");
        assert_eq!(chosen.id, 3, "the 4K TV outranks the 1080p projector");
    }

    #[test]
    fn explicit_choice_beats_largest_external() {
        let displays = vec![laptop(), projector(), tv()];
        let chosen = select_preferred_display(&displays, 1, Some(2)).expect("a display");
        assert_eq!(chosen.id, 2);
    }

    #[test]
    fn explicit_choice_may_be_the_primary() {
        let displays = vec![laptop(), tv()];
        let chosen = select_preferred_display(&displays, 1, Some(1)).expect("a display");
        assert_eq!(
            chosen.id, 1,
            "operators can deliberately output to the laptop"
        );
    }

    #[test]
    fn unplugged_explicit_choice_falls_back_to_largest_external() {
        // The projector was chosen, then someone pulled the cable mid-service.
        let displays = vec![laptop(), tv()];
        let chosen = select_preferred_display(&displays, 1, Some(2)).expect("a display");
        assert_eq!(chosen.id, 3);
    }

    #[test]
    fn unplugged_explicit_choice_with_no_externals_falls_back_to_primary() {
        let displays = vec![laptop()];
        let chosen = select_preferred_display(&displays, 1, Some(2)).expect("a display");
        assert_eq!(chosen.id, 1, "never leave the role without a display");
    }

    #[test]
    fn equal_area_externals_resolve_to_the_first_listed() {
        let displays = vec![laptop(), display(2, 1920, 1080), display(3, 1920, 1080)];
        let chosen = select_preferred_display(&displays, 1, None).expect("a display");
        assert_eq!(
            chosen.id, 2,
            "a stable tie-break matters: the audience screen must not swap on reconnect"
        );
    }

    #[test]
    fn area_not_width_decides() {
        let ultrawide = display(2, 3440, 1440); // 4_953_600
        let uhd = display(3, 3840, 2160); //       8_294_400
        let displays = vec![laptop(), ultrawide, uhd];
        let chosen = select_preferred_display(&displays, 1, None).expect("a display");
        assert_eq!(chosen.id, 3);
    }

    #[test]
    fn no_displays_yields_none() {
        assert!(select_preferred_display(&[], 1, None).is_none());
    }

    #[test]
    fn unknown_primary_still_returns_a_display() {
        // Guards the hot-plug window where the reported primary has already gone.
        let displays = vec![projector(), tv()];
        let chosen = select_preferred_display(&displays, 999, None).expect("a display");
        assert_eq!(chosen.id, 3);
    }

    #[test]
    fn role_serialises_as_the_frontend_spells_it() {
        // The React side sends 'audience' | 'media' | 'worship' today.
        assert_eq!(
            serde_json::to_string(&ScreenRole::Audience).expect("serializable"),
            "\"audience\""
        );
        assert_eq!(
            serde_json::to_string(&ScreenRole::Worship).expect("serializable"),
            "\"worship\""
        );
    }
}
