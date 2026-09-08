//! Human-readable monitor names.
//!
//! tao names macOS monitors `"Monitor #<model number>"`
//! (`platform_impl/macos/monitor.rs:208`), which is what an operator would see
//! in the display picker — worse than the "Built-in Retina Display" the
//! Electron build showed. AppKit knows the real name; this asks it.
//!
//! The localized name is used **only as a label**. Identity still keys on the
//! model-number name, because `localizedName` is localised: changing the system
//! language would rename every monitor and orphan every saved preference.
//! Model numbers are hardware and locale-independent.
//!
//! Non-macOS platforms report usable names already, so this is a no-op there.

use std::collections::HashMap;

/// Physical top-left position of a monitor, which is what `Monitor::position()`
/// returns and therefore the key that can join the two sources.
pub type PhysicalPosition = (i32, i32);

/// Maps monitor position to the name a person would recognise.
///
/// Returns an empty map on any platform or failure — a missing label is a
/// cosmetic problem, never a reason to fail display enumeration.
#[cfg(not(target_os = "macos"))]
pub fn localized_names_by_position() -> HashMap<PhysicalPosition, String> {
    HashMap::new()
}

#[cfg(target_os = "macos")]
pub fn localized_names_by_position() -> HashMap<PhysicalPosition, String> {
    use core_graphics::display::CGDisplay;
    use objc2_app_kit::NSScreen;
    use objc2_foundation::{ns_string, MainThreadMarker};

    // `NSScreen::screens` is main-thread-only. Callers hop threads for us; if we
    // somehow arrive off-main, return nothing rather than risk undefined
    // behaviour.
    let Some(mtm) = MainThreadMarker::new() else {
        tracing::debug!("skipping localized monitor names: not on the main thread");
        return HashMap::new();
    };

    let mut names = HashMap::new();

    for screen in NSScreen::screens(mtm) {
        // `NSScreenNumber` is the CGDirectDisplayID. Going through it means we
        // can ask CoreGraphics for the exact same bounds tao used, rather than
        // converting Cocoa's bottom-left coordinates by hand and hoping the
        // rounding matches.
        let description = screen.deviceDescription();
        let Some(number) = description.objectForKey(ns_string!("NSScreenNumber")) else {
            continue;
        };
        let Ok(number) = number.downcast::<objc2_foundation::NSNumber>() else {
            continue;
        };
        let display_id = number.as_u32();

        let bounds = CGDisplay::new(display_id).bounds();
        let scale = screen.backingScaleFactor();

        // Mirrors tao: PhysicalPosition::from_logical(origin, scale_factor).
        let position = (
            (bounds.origin.x * scale).round() as i32,
            (bounds.origin.y * scale).round() as i32,
        );

        let localized = screen.localizedName().to_string();
        let trimmed = localized.trim();
        if !trimmed.is_empty() {
            names.insert(position, trimmed.to_owned());
        }
    }

    names
}

/// Pick the label to show for a monitor.
///
/// Kept separate from the AppKit call so the precedence rules are testable on
/// every platform.
pub fn resolve_label(
    localized: Option<&str>,
    reported_name: Option<&str>,
    is_primary: bool,
    id: i64,
) -> String {
    // The name a person recognises always wins.
    if let Some(name) = localized.map(str::trim).filter(|name| !name.is_empty()) {
        return name.to_owned();
    }

    // Otherwise fall back the way the Electron handler does
    // (`window.ipc.ts:47`). tao's synthetic "Monitor #41024" is deliberately
    // excluded: it is a model number, and showing it is the problem this module
    // exists to fix.
    match reported_name.map(str::trim) {
        Some(name) if !name.is_empty() && !is_synthetic_name(name) => name.to_owned(),
        _ if is_primary => "Primary Display".to_owned(),
        _ => format!("Screen {id}"),
    }
}

/// tao's macOS placeholder, e.g. `"Monitor #41024"`.
fn is_synthetic_name(name: &str) -> bool {
    name.strip_prefix("Monitor #")
        .is_some_and(|rest| !rest.is_empty() && rest.chars().all(|c| c.is_ascii_digit()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_localized_name_wins_when_available() {
        assert_eq!(
            resolve_label(
                Some("Built-in Retina Display"),
                Some("Monitor #41024"),
                true,
                7
            ),
            "Built-in Retina Display"
        );
    }

    #[test]
    fn a_blank_localized_name_is_ignored() {
        assert_eq!(
            resolve_label(Some("   "), Some("DELL U2720Q"), false, 7),
            "DELL U2720Q"
        );
    }

    #[test]
    fn taos_model_number_placeholder_is_never_shown() {
        // This is the bug: an operator should not see "Monitor #41024" in the
        // display picker.
        assert_eq!(
            resolve_label(None, Some("Monitor #41024"), true, 7),
            "Primary Display"
        );
        assert_eq!(
            resolve_label(None, Some("Monitor #7"), false, 42),
            "Screen 42"
        );
    }

    #[test]
    fn a_real_reported_name_is_kept() {
        // Windows and Linux report usable names; do not discard them.
        assert_eq!(
            resolve_label(None, Some("LG UltraFine"), false, 7),
            "LG UltraFine"
        );
    }

    #[test]
    fn names_that_merely_resemble_the_placeholder_are_kept() {
        assert_eq!(
            resolve_label(None, Some("Monitor #A1"), false, 7),
            "Monitor #A1"
        );
        assert_eq!(
            resolve_label(None, Some("Monitor #"), false, 7),
            "Monitor #"
        );
        assert_eq!(
            resolve_label(None, Some("Studio Monitor #2"), false, 7),
            "Studio Monitor #2"
        );
    }

    #[test]
    fn falls_back_to_primary_then_screen_id() {
        assert_eq!(resolve_label(None, None, true, 7), "Primary Display");
        assert_eq!(resolve_label(None, None, false, 7), "Screen 7");
        assert_eq!(resolve_label(None, Some(""), false, 7), "Screen 7");
    }

    #[test]
    fn non_macos_lookup_is_an_empty_map_not_a_failure() {
        // On macOS this needs the main thread and returns empty off it; either
        // way a missing label must never break enumeration.
        let names = localized_names_by_position();
        let _ = names.get(&(0, 0));
    }
}
