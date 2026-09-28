//! SDI out of a Blackmagic DeckLink or UltraStudio device: a screen's picture
//! on a card's output, for a switcher or a projector down a long cable.
//!
//! The card is driven by `sdi/decklink_shim.cpp`, which schedules frames on
//! the card's own clock; this side lists the devices and video modes and
//! hands it one picture at a time from the screen's send loop
//! (`services/ndi/output.rs`), the loop NDI and Syphon use too.
//!
//! It needs Blackmagic Desktop Video installed. Without it the device list is
//! empty and an SDI output says why it can't start. macOS only for now.

use serde::Serialize;

use crate::services::ndi::output::FrameSink;
use crate::services::ndi::sender::SendError;

pub use crate::services::video_modes::VideoMode;
use crate::services::video_modes::{self, SDI_DEFAULT};

/// An output's mode, or 1080p29.97 when none is chosen.
pub fn video_mode_or_default(code: Option<&str>) -> VideoMode {
    video_modes::video_mode_or(code, SDI_DEFAULT)
}

/// A device that can play out.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SdiDevice {
    /// Its persistent id, as a string: it is a 64-bit number.
    pub id: String,
    pub name: String,
}

/// Whether Blackmagic Desktop Video is installed.
pub fn available() -> bool {
    platform::available()
}

/// The devices that can play out.
pub fn devices() -> Vec<SdiDevice> {
    platform::devices()
}

/// A DeckLink output, playing out while it lives.
pub struct SdiSink {
    output: platform::Output,
    size: (u32, u32),
}

impl SdiSink {
    /// Start playing out on `device` in `mode`: the first device when none is
    /// chosen, black until the first picture arrives.
    pub fn open(device: Option<&str>, mode: VideoMode) -> Result<Self, String> {
        let id = match device {
            Some(device) => device
                .parse::<i64>()
                .map_err(|_| "That DeckLink device isn't connected.".to_owned())?,
            None => devices()
                .first()
                .and_then(|device| device.id.parse::<i64>().ok())
                .ok_or_else(|| {
                    if available() {
                        "No DeckLink or UltraStudio device is connected.".to_owned()
                    } else {
                        "Blackmagic Desktop Video isn't installed on this computer.".to_owned()
                    }
                })?,
        };
        let (output, size) = platform::Output::open(id, mode)?;
        Ok(Self { output, size })
    }

    /// The size the card plays out at.
    pub fn size(&self) -> (u32, u32) {
        self.size
    }
}

impl FrameSink for SdiSink {
    fn send_bgra(&mut self, width: u32, height: u32, bgra: &[u8]) -> Result<(), SendError> {
        let expected = width as usize * height as usize * 4;
        if bgra.len() != expected {
            return Err(SendError::WrongLength {
                expected,
                actual: bgra.len(),
            });
        }
        if width == 0 || height == 0 {
            return Err(SendError::UnsendableSize { width, height });
        }
        self.output.send(bgra, width, height);
        Ok(())
    }

    fn connections(&self) -> u32 {
        1
    }
}

#[cfg(target_os = "macos")]
mod platform {
    use std::ffi::{c_char, c_void, CStr};

    use super::{SdiDevice, VideoMode};

    #[repr(C)]
    struct PresentDeckLinkDevice {
        id: i64,
        name: [c_char; 128],
    }

    extern "C" {
        fn present_decklink_available() -> i32;
        fn present_decklink_devices(out: *mut PresentDeckLinkDevice, max: i32) -> i32;
        fn present_decklink_open(
            id: i64,
            mode: u32,
            width: *mut u32,
            height: *mut u32,
            error: *mut c_char,
            error_length: i32,
        ) -> *mut c_void;
        fn present_decklink_send(
            handle: *mut c_void,
            bgra: *const u8,
            width: u32,
            height: u32,
        ) -> i32;
        fn present_decklink_close(handle: *mut c_void);
    }

    pub fn available() -> bool {
        // SAFETY: takes nothing and loads the API once, behind a pthread_once.
        unsafe { present_decklink_available() != 0 }
    }

    pub fn devices() -> Vec<SdiDevice> {
        const MAX: usize = 16;
        let mut found: Vec<PresentDeckLinkDevice> = (0..MAX)
            .map(|_| PresentDeckLinkDevice {
                id: 0,
                name: [0; 128],
            })
            .collect();
        // SAFETY: the buffer holds MAX devices, and the shim writes at most that many.
        let count = unsafe { present_decklink_devices(found.as_mut_ptr(), MAX as i32) };
        found.truncate(usize::try_from(count).unwrap_or(0).min(MAX));
        found
            .iter()
            .map(|device| {
                // SAFETY: the shim always ends the name with a NUL inside its 128 bytes.
                let name = unsafe { CStr::from_ptr(device.name.as_ptr()) }
                    .to_string_lossy()
                    .trim()
                    .to_owned();
                SdiDevice {
                    id: device.id.to_string(),
                    name: if name.is_empty() {
                        "DeckLink".to_owned()
                    } else {
                        name
                    },
                }
            })
            .collect()
    }

    pub struct Output(*mut c_void);

    // SAFETY: the shim's output guards its own state with a mutex, and it is
    // used from one thread at a time: the send loop's, then the one that
    // drops it.
    unsafe impl Send for Output {}

    impl Output {
        pub fn open(id: i64, mode: VideoMode) -> Result<(Self, (u32, u32)), String> {
            let mut error: [c_char; 256] = [0; 256];
            let (mut width, mut height) = (0u32, 0u32);
            // SAFETY: every out pointer is valid for the call, and the error
            // buffer's length is passed with it.
            let handle = unsafe {
                present_decklink_open(
                    id,
                    mode.fourcc(),
                    &mut width,
                    &mut height,
                    error.as_mut_ptr(),
                    error.len() as i32,
                )
            };
            if handle.is_null() {
                // SAFETY: the shim ends the message with a NUL inside the buffer.
                let message = unsafe { CStr::from_ptr(error.as_ptr()) }
                    .to_string_lossy()
                    .into_owned();
                return Err(if message.is_empty() {
                    "The DeckLink device could not start.".to_owned()
                } else {
                    message
                });
            }
            Ok((Self(handle), (width, height)))
        }

        pub fn send(&mut self, bgra: &[u8], width: u32, height: u32) {
            // SAFETY: the handle is open, and the buffer is width × height × 4 bytes,
            // checked by the caller.
            unsafe { present_decklink_send(self.0, bgra.as_ptr(), width, height) };
        }
    }

    impl Drop for Output {
        fn drop(&mut self) {
            // SAFETY: the handle came from present_decklink_open and is closed once.
            unsafe { present_decklink_close(self.0) };
        }
    }
}

#[cfg(not(target_os = "macos"))]
mod platform {
    use super::{SdiDevice, VideoMode};

    pub fn available() -> bool {
        false
    }

    pub fn devices() -> Vec<SdiDevice> {
        Vec::new()
    }

    pub struct Output;

    impl Output {
        pub fn open(_id: i64, _mode: VideoMode) -> Result<(Self, (u32, u32)), String> {
            Err("SDI out is on a Mac for now.".to_owned())
        }

        pub fn send(&mut self, _bgra: &[u8], _width: u32, _height: u32) {}
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn without_desktop_video_an_sdi_output_says_so() {
        if available() {
            // A Mac with Desktop Video lists its own devices.
            return;
        }
        assert!(devices().is_empty());
        let error = SdiSink::open(None, video_mode_or_default(None)).err();
        assert_eq!(
            error.as_deref(),
            Some("Blackmagic Desktop Video isn't installed on this computer.")
        );
    }
}
