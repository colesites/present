//! A connected display's own resolution: the modes it offers, and changing to
//! one of them from Screen Configuration, as ProPresenter does.
//!
//! A change is made the way System Settings makes it, for good, and taken back
//! after [`KEEP_WITHIN`] unless the operator keeps it. A mode a projector
//! cannot show leaves it black, and whoever is at the desk must not need a
//! picture on that projector to put it right.
//!
//! macOS only for now: elsewhere the list is empty and Display settings opens
//! the system's own.

use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;
use std::time::Duration;

use serde::Serialize;

use crate::errors::{AppError, AppResult};
use crate::services::display::Display;

/// How long a new mode lasts before it is taken back, unless kept.
pub const KEEP_WITHIN: Duration = Duration::from_secs(15);

/// One mode a display can be put in.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DisplayMode {
    /// The same for as long as the display is connected: its size, its pixels
    /// and its rate, which is what a person tells two modes apart by.
    pub id: String,
    /// The desktop's size, in points. The same as the pixels unless the mode
    /// is HiDPI, when each point is drawn with several pixels.
    pub width: u32,
    pub height: u32,
    pub pixel_width: u32,
    pub pixel_height: u32,
    /// Hertz; 0 when the display does not say, as some built-in panels don't.
    pub refresh_rate: f64,
    pub current: bool,
}

impl DisplayMode {
    pub fn new(
        width: u32,
        height: u32,
        pixel_width: u32,
        pixel_height: u32,
        refresh_rate: f64,
    ) -> Self {
        Self {
            id: mode_id(width, height, pixel_width, pixel_height, refresh_rate),
            width,
            height,
            pixel_width,
            pixel_height,
            refresh_rate,
            current: false,
        }
    }

    pub fn hidpi(&self) -> bool {
        self.pixel_width > self.width
    }
}

fn mode_id(
    width: u32,
    height: u32,
    pixel_width: u32,
    pixel_height: u32,
    refresh_rate: f64,
) -> String {
    // Hundredths of a hertz tell 59.94 from 60 without a float in the id.
    let centihertz = (refresh_rate * 100.0).round() as i64;
    format!("{width}x{height}:{pixel_width}x{pixel_height}@{centihertz}")
}

/// The modes worth offering, in the order a picker lists them.
///
/// The system lists a mode once for each pixel format, and the scaled HiDPI
/// modes of a Retina panel alongside its native ones. Those are kept only for
/// a display already running HiDPI: a projector offered "960 × 540 HiDPI"
/// would only be offered a blurrier picture.
pub fn offered(modes: Vec<DisplayMode>, current: Option<&DisplayMode>) -> Vec<DisplayMode> {
    let hidpi = current.is_some_and(DisplayMode::hidpi);
    let mut kept: Vec<DisplayMode> = Vec::new();
    for mut mode in modes {
        if mode.hidpi() && !hidpi {
            continue;
        }
        if kept.iter().any(|each| each.id == mode.id) {
            continue;
        }
        mode.current = current.is_some_and(|current| current.id == mode.id);
        kept.push(mode);
    }
    kept.sort_by(|a, b| {
        (b.width, b.height, b.pixel_width, b.pixel_height)
            .cmp(&(a.width, a.height, a.pixel_width, a.pixel_height))
            .then(b.refresh_rate.total_cmp(&a.refresh_rate))
    });
    kept
}

/// Whether a display's top-left, as the system places it in points, is the
/// one Present knows it by: tao scales that origin to physical pixels.
pub fn is_at(display: &Display, origin: (f64, f64)) -> bool {
    let x = (origin.0 * display.scale_factor).round() as i64;
    let y = (origin.1 * display.scale_factor).round() as i64;
    (x - i64::from(display.bounds.x)).abs() <= 1 && (y - i64::from(display.bounds.y)).abs() <= 1
}

/// A mode waiting to be kept, and the one to go back to if it isn't.
#[derive(Debug, Clone)]
struct Pending {
    token: u64,
    previous: String,
}

/// Changes waiting to be kept, by display.
#[derive(Default)]
pub struct DisplayModeState {
    pending: Mutex<HashMap<i64, Pending>>,
    next: AtomicU64,
}

impl DisplayModeState {
    /// Remember that `display` was changed from `previous`, and return the
    /// token the revert timer checks it still holds.
    pub fn changed(&self, display: i64, previous: String) -> u64 {
        let token = self.next.fetch_add(1, Ordering::Relaxed) + 1;
        let mut pending = self
            .pending
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        // A second change inside the window goes back to the mode before the
        // first, not to the first change.
        let previous = pending
            .get(&display)
            .map(|waiting| waiting.previous.clone())
            .unwrap_or(previous);
        pending.insert(display, Pending { token, previous });
        token
    }

    /// Keep the new mode: nothing is taken back.
    pub fn keep(&self, display: i64) -> bool {
        self.pending
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .remove(&display)
            .is_some()
    }

    /// The mode to go back to, if the change is still waiting. With a token,
    /// only if it is still that change: the timer of one replaced by a later
    /// change does nothing.
    pub fn take_back(&self, display: i64, token: Option<u64>) -> Option<String> {
        let mut pending = self
            .pending
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        let waiting = pending.get(&display)?;
        if token.is_some_and(|token| token != waiting.token) {
            return None;
        }
        pending.remove(&display).map(|waiting| waiting.previous)
    }

    /// The displays with a change waiting to be kept.
    pub fn waiting(&self) -> Vec<i64> {
        self.pending
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .keys()
            .copied()
            .collect()
    }
}

/// The modes a display offers, the one it is in marked.
pub fn modes_for(display: &Display) -> AppResult<Vec<DisplayMode>> {
    platform::modes_for(display)
}

/// Put a display in one of its modes. Returns the id of the mode it was in.
pub fn set_mode(display: &Display, mode_id: &str) -> AppResult<String> {
    platform::set_mode(display, mode_id)
}

#[cfg(target_os = "macos")]
mod platform {
    use std::ptr;

    use objc2_core_foundation::{CFBoolean, CFDictionary, CFRetained, CFString};
    use objc2_core_graphics::{
        kCGDisplayShowDuplicateLowResolutionModes, CGBeginDisplayConfiguration,
        CGCancelDisplayConfiguration, CGCompleteDisplayConfiguration,
        CGConfigureDisplayWithDisplayMode, CGConfigureOption, CGDirectDisplayID, CGDisplayBounds,
        CGDisplayConfigRef, CGDisplayCopyAllDisplayModes, CGDisplayCopyDisplayMode, CGDisplayMode,
        CGError, CGGetActiveDisplayList,
    };

    use super::{is_at, offered, AppError, AppResult, Display, DisplayMode};

    fn cg_id(display: &Display) -> AppResult<CGDirectDisplayID> {
        let mut ids = [0 as CGDirectDisplayID; 32];
        let mut count = 0u32;
        // SAFETY: the buffer holds the 32 ids asked for, and count is a valid out pointer.
        let error =
            unsafe { CGGetActiveDisplayList(ids.len() as u32, ids.as_mut_ptr(), &mut count) };
        if error != CGError::Success {
            return Err(AppError::Invalid(format!(
                "Could not list the displays ({}).",
                error.0
            )));
        }
        ids.iter()
            .take(count as usize)
            .copied()
            .find(|id| {
                let bounds = CGDisplayBounds(*id);
                is_at(display, (bounds.origin.x, bounds.origin.y))
            })
            .ok_or_else(|| AppError::NotFound(format!("display {}", display.id)))
    }

    fn describe(mode: &CGDisplayMode) -> DisplayMode {
        let mode = Some(mode);
        DisplayMode::new(
            CGDisplayMode::width(mode) as u32,
            CGDisplayMode::height(mode) as u32,
            CGDisplayMode::pixel_width(mode) as u32,
            CGDisplayMode::pixel_height(mode) as u32,
            CGDisplayMode::refresh_rate(mode),
        )
    }

    /// Every mode the system has for the display, the HiDPI ones included.
    fn all_modes(id: CGDirectDisplayID) -> Vec<CFRetained<CGDisplayMode>> {
        // SAFETY: an extern static CoreGraphics defines.
        let key: &CFString = unsafe { kCGDisplayShowDuplicateLowResolutionModes };
        let options =
            CFDictionary::<CFString, CFBoolean>::from_slices(&[key], &[CFBoolean::new(true)]);
        // SAFETY: the options are the CFString to CFBoolean dictionary the call documents.
        let Some(array) = (unsafe { CGDisplayCopyAllDisplayModes(id, Some(options.as_opaque())) })
        else {
            return Vec::new();
        };
        // SAFETY: the array CGDisplayCopyAllDisplayModes returns holds display modes.
        let modes = unsafe { array.cast_unchecked::<CGDisplayMode>() };
        modes
            .iter()
            .filter(|mode| CGDisplayMode::is_usable_for_desktop_gui(Some(mode)))
            .collect()
    }

    pub fn modes_for(display: &Display) -> AppResult<Vec<DisplayMode>> {
        let id = cg_id(display)?;
        let current = CGDisplayCopyDisplayMode(id).map(|mode| describe(&mode));
        let modes = all_modes(id).iter().map(|mode| describe(mode)).collect();
        Ok(offered(modes, current.as_ref()))
    }

    pub fn set_mode(display: &Display, mode_id: &str) -> AppResult<String> {
        let id = cg_id(display)?;
        let previous = CGDisplayCopyDisplayMode(id)
            .map(|mode| describe(&mode).id)
            .ok_or_else(|| {
                AppError::Invalid("The display did not say which mode it is in.".to_owned())
            })?;
        let modes = all_modes(id);
        let mode = modes
            .iter()
            .find(|mode| describe(mode).id == mode_id)
            .ok_or_else(|| {
                AppError::NotFound(format!("mode {mode_id} on display {}", display.id))
            })?;
        if previous == mode_id {
            return Ok(previous);
        }

        let mut config: CGDisplayConfigRef = ptr::null_mut();
        // SAFETY: config is a valid out pointer; every path below completes or cancels it.
        let error = unsafe { CGBeginDisplayConfiguration(&mut config) };
        if error != CGError::Success {
            return Err(AppError::Invalid(format!(
                "Could not change the display ({}).",
                error.0
            )));
        }
        // SAFETY: config was just begun, and the mode is one of this display's.
        let error = unsafe { CGConfigureDisplayWithDisplayMode(config, id, Some(mode), None) };
        if error != CGError::Success {
            // SAFETY: config was begun and not completed.
            unsafe { CGCancelDisplayConfiguration(config) };
            return Err(AppError::Invalid(format!(
                "The display would not take that mode ({}).",
                error.0
            )));
        }
        // SAFETY: config was begun and configured above.
        let error =
            unsafe { CGCompleteDisplayConfiguration(config, CGConfigureOption::Permanently) };
        if error != CGError::Success {
            return Err(AppError::Invalid(format!(
                "Could not change the display ({}).",
                error.0
            )));
        }
        Ok(previous)
    }
}

#[cfg(not(target_os = "macos"))]
mod platform {
    use super::{AppError, AppResult, Display, DisplayMode};

    pub fn modes_for(_display: &Display) -> AppResult<Vec<DisplayMode>> {
        Ok(Vec::new())
    }

    pub fn set_mode(_display: &Display, _mode_id: &str) -> AppResult<String> {
        Err(AppError::Invalid(
            "Change this display's resolution in the system's Display settings.".to_owned(),
        ))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::services::display::Rect;

    fn display(x: i32, y: i32, scale_factor: f64) -> Display {
        Display {
            id: 7,
            label: "Projector".to_owned(),
            bounds: Rect {
                x,
                y,
                width: 1920,
                height: 1080,
            },
            work_area: Rect {
                x,
                y,
                width: 1920,
                height: 1080,
            },
            scale_factor,
            is_primary: false,
        }
    }

    #[test]
    fn a_mode_is_known_by_its_size_pixels_and_rate() {
        assert_eq!(
            DisplayMode::new(1920, 1080, 1920, 1080, 59.94).id,
            "1920x1080:1920x1080@5994"
        );
        assert_ne!(
            DisplayMode::new(1920, 1080, 1920, 1080, 60.0).id,
            DisplayMode::new(1920, 1080, 1920, 1080, 59.94).id
        );
    }

    #[test]
    fn a_projector_is_not_offered_scaled_modes() {
        let current = DisplayMode::new(1920, 1080, 1920, 1080, 60.0);
        let modes = offered(
            vec![
                DisplayMode::new(1280, 720, 1280, 720, 60.0),
                DisplayMode::new(960, 540, 1920, 1080, 60.0),
                DisplayMode::new(1920, 1080, 1920, 1080, 60.0),
                DisplayMode::new(1920, 1080, 1920, 1080, 60.0),
                DisplayMode::new(1920, 1080, 1920, 1080, 50.0),
            ],
            Some(&current),
        );
        let ids: Vec<&str> = modes.iter().map(|mode| mode.id.as_str()).collect();
        assert_eq!(
            ids,
            [
                "1920x1080:1920x1080@6000",
                "1920x1080:1920x1080@5000",
                "1280x720:1280x720@6000"
            ],
            "largest first, faster first, each once, no HiDPI"
        );
        assert!(modes[0].current);
        assert!(!modes[1].current);
    }

    #[test]
    fn a_retina_panel_keeps_its_scaled_modes() {
        let current = DisplayMode::new(1440, 900, 2880, 1800, 60.0);
        let modes = offered(
            vec![
                DisplayMode::new(1440, 900, 2880, 1800, 60.0),
                DisplayMode::new(1680, 1050, 3360, 2100, 60.0),
                DisplayMode::new(2880, 1800, 2880, 1800, 60.0),
            ],
            Some(&current),
        );
        assert_eq!(modes.len(), 3);
        assert_eq!(modes.iter().filter(|mode| mode.current).count(), 1);
        assert_eq!(modes[0].width, 2880);
    }

    #[test]
    fn a_display_is_found_where_the_system_places_it() {
        assert!(is_at(&display(1920, 0, 1.0), (1920.0, 0.0)));
        assert!(is_at(&display(2880, -1800, 2.0), (1440.0, -900.0)));
        assert!(!is_at(&display(1920, 0, 1.0), (0.0, 0.0)));
    }

    #[test]
    fn a_change_not_kept_goes_back_to_the_mode_before_it() {
        let state = DisplayModeState::default();
        let first = state.changed(7, "a".to_owned());
        let second = state.changed(7, "b".to_owned());
        assert_eq!(
            state.take_back(7, Some(first)),
            None,
            "the first change's timer is stale"
        );
        assert_eq!(
            state.take_back(7, Some(second)),
            Some("a".to_owned()),
            "back past both changes"
        );
        assert_eq!(state.take_back(7, None), None, "nothing left to take back");
    }

    #[test]
    fn a_kept_change_is_not_taken_back() {
        let state = DisplayModeState::default();
        let token = state.changed(7, "a".to_owned());
        assert!(state.keep(7));
        assert_eq!(state.take_back(7, Some(token)), None);
        assert!(state.waiting().is_empty());
    }
}
