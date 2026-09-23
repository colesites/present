//! Discovery: which NDI sources are on the network.

use std::ffi::{c_void, CStr, CString};
use std::ptr::{self, NonNull};
use std::sync::Arc;
use std::time::Duration;

use super::rules::Source;
use super::sys::{FindCreate, NdiLib};

pub struct Finder {
    lib: Arc<NdiLib>,
    instance: NonNull<c_void>,
}

// SAFETY: an NDI finder may be used from any thread. It is not `Sync`: the
// source list it hands back is only valid until the next call on it.
unsafe impl Send for Finder {}

impl Finder {
    /// Start looking. Sources on this machine are always included, as they are
    /// in Electron — the operator's own NDI Test Patterns or a camera app on
    /// the same laptop is exactly the source somebody tests with.
    pub fn new(lib: Arc<NdiLib>, groups: Option<&str>) -> Result<Self, String> {
        let groups = groups
            .map(CString::new)
            .transpose()
            .map_err(|_| "An NDI group name cannot contain a NUL character.".to_owned())?;
        let settings = FindCreate {
            show_local_sources: true,
            p_groups: groups.as_ref().map_or(ptr::null(), |value| value.as_ptr()),
            p_extra_ips: ptr::null(),
        };

        // SAFETY: `settings` and the group string outlive the call, which copies
        // what it needs.
        let instance = unsafe { (lib.find_create_v2)(&settings) };
        NonNull::new(instance)
            .map(|instance| Self { lib, instance })
            .ok_or_else(|| "NDI discovery could not start.".to_owned())
    }

    /// Wait up to `timeout` for the source list to change. `true` if it did.
    pub fn wait(&self, timeout: Duration) -> bool {
        // SAFETY: a live instance.
        unsafe { (self.lib.find_wait_for_sources)(self.instance.as_ptr(), millis(timeout)) }
    }

    /// The sources known right now, unordered. A source the SDK reports with
    /// no name is dropped here, since there is nothing to show or connect by.
    pub fn sources(&mut self) -> Vec<Source> {
        let mut count = 0_u32;
        // SAFETY: a live instance. The returned array belongs to the finder and
        // stays valid until the next call on it, which `&mut self` rules out
        // while the copy below runs.
        let raw =
            unsafe { (self.lib.find_get_current_sources)(self.instance.as_ptr(), &mut count) };
        if raw.is_null() || count == 0 {
            return Vec::new();
        }

        // SAFETY: `count` entries, as the SDK reported.
        let entries = unsafe { std::slice::from_raw_parts(raw, count as usize) };
        entries
            .iter()
            .filter_map(|entry| {
                // SAFETY: NUL-terminated strings owned by the finder, or null.
                let name = unsafe { optional_string(entry.p_ndi_name) }?;
                Some(Source {
                    name,
                    url_address: unsafe { optional_string(entry.p_url_address) },
                })
            })
            .collect()
    }
}

impl Drop for Finder {
    fn drop(&mut self) {
        // SAFETY: created by `find_create_v2` and destroyed exactly once.
        unsafe { (self.lib.find_destroy)(self.instance.as_ptr()) }
    }
}

/// # Safety
///
/// `raw` must be null or a NUL-terminated string that stays valid for the call.
pub(super) unsafe fn optional_string(raw: *const std::ffi::c_char) -> Option<String> {
    if raw.is_null() {
        None
    } else {
        Some(CStr::from_ptr(raw).to_string_lossy().into_owned())
    }
}

pub(super) fn millis(duration: Duration) -> u32 {
    u32::try_from(duration.as_millis()).unwrap_or(u32::MAX)
}
