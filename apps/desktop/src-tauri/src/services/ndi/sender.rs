//! One NDI video source on the network.

use std::ffi::{c_void, CString};
use std::ptr::{self, NonNull};
use std::sync::Arc;
use std::time::Duration;

use super::finder::millis;
use super::rules::{self, FrameHeader, StreamRate};
use super::sys::{NdiLib, SendCreate, VideoFrameV2, SEND_TIMECODE_SYNTHESIZE};

pub struct Sender {
    lib: Arc<NdiLib>,
    instance: NonNull<c_void>,
    /// The rate every frame declares, and the rate the SDK paces to.
    rate: StreamRate,
}

// SAFETY: an NDI sender may be driven from any thread, but not from two at
// once, which `&mut self` on `send_bgra` enforces.
unsafe impl Send for Sender {}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SendError {
    /// Width or height is zero, or too large for the SDK's `int` fields.
    UnsendableSize { width: u32, height: u32 },
    /// The buffer is not `width * height * 4` bytes.
    WrongLength { expected: usize, actual: usize },
}

impl std::fmt::Display for SendError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::UnsendableSize { width, height } => {
                write!(f, "a {width}x{height} frame cannot be sent over NDI")
            }
            Self::WrongLength { expected, actual } => write!(
                f,
                "a frame needs {expected} bytes of BGRA and was given {actual}"
            ),
        }
    }
}

impl std::error::Error for SendError {}

impl Sender {
    /// Announce a source on the network.
    ///
    /// Clocked on video and not on audio, as Electron's sender is: the SDK
    /// paces `send_bgra` to the declared 30 fps, so the sending thread needs no
    /// timer of its own, and there is no audio to clock.
    pub fn new(lib: Arc<NdiLib>, name: &str, groups: &str, rate: u32) -> Result<Self, String> {
        Self::new_at(
            lib,
            name,
            groups,
            StreamRate::whole(rules::frame_rate(Some(rate))),
        )
    }

    /// Announce a source at a broadcast rate: 29.97, or 1080i50's 25 frames
    /// of two fields each.
    pub fn new_at(
        lib: Arc<NdiLib>,
        name: &str,
        groups: &str,
        rate: StreamRate,
    ) -> Result<Self, String> {
        let name = CString::new(name)
            .map_err(|_| "An NDI source name cannot contain a NUL character.".to_owned())?;
        let groups = CString::new(groups)
            .map_err(|_| "An NDI group name cannot contain a NUL character.".to_owned())?;
        let settings = SendCreate {
            p_ndi_name: name.as_ptr(),
            p_groups: groups.as_ptr(),
            clock_video: true,
            clock_audio: false,
        };

        // SAFETY: both strings outlive the call, which copies them.
        let instance = unsafe { (lib.send_create)(&settings) };
        NonNull::new(instance)
            .map(|instance| Self {
                lib,
                instance,
                rate,
            })
            .ok_or_else(|| "The NDI sender could not be created.".to_owned())
    }

    /// Send one frame of straight-alpha BGRA, top row first.
    ///
    /// Blocks until the SDK's video clock says the frame is due.
    pub fn send_bgra(&mut self, width: u32, height: u32, bgra: &[u8]) -> Result<(), SendError> {
        let header = rules::frame_header_at(width, height, self.rate)
            .ok_or(SendError::UnsendableSize { width, height })?;
        let expected = (width as usize) * (height as usize) * 4;
        if bgra.len() != expected {
            return Err(SendError::WrongLength {
                expected,
                actual: bgra.len(),
            });
        }

        let frame = frame_from_header(header, bgra.as_ptr());
        // SAFETY: a live instance; the header describes exactly `bgra`, which
        // outlives this synchronous call. The SDK reads the pixels and does not
        // write through the pointer despite its `uint8_t*` type.
        unsafe { (self.lib.send_send_video_v2)(self.instance.as_ptr(), &frame) };
        Ok(())
    }

    /// How many receivers are connected, waiting up to `timeout` for at least
    /// one when there are none.
    pub fn connections(&self, timeout: Duration) -> u32 {
        // SAFETY: a live instance.
        let count =
            unsafe { (self.lib.send_get_no_connections)(self.instance.as_ptr(), millis(timeout)) };
        u32::try_from(count).unwrap_or(0)
    }
}

impl Drop for Sender {
    fn drop(&mut self) {
        // SAFETY: created by `send_create` and destroyed exactly once.
        unsafe { (self.lib.send_destroy)(self.instance.as_ptr()) }
    }
}

fn frame_from_header(header: FrameHeader, data: *const u8) -> VideoFrameV2 {
    VideoFrameV2 {
        xres: header.width,
        yres: header.height,
        fourcc: header.fourcc as i32,
        frame_rate_n: header.frame_rate_n,
        frame_rate_d: header.frame_rate_d,
        picture_aspect_ratio: header.picture_aspect_ratio,
        frame_format_type: header.frame_format,
        timecode: SEND_TIMECODE_SYNTHESIZE,
        p_data: data.cast_mut(),
        line_stride_in_bytes: header.line_stride_bytes,
        p_metadata: ptr::null(),
        timestamp: 0,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_raw_frame_carries_the_header_unchanged_and_asks_the_sdk_for_a_timecode() {
        let header = rules::frame_header(1920, 1080, 30).unwrap();
        let pixels = [0_u8; 4];
        let frame = frame_from_header(header, pixels.as_ptr());

        assert_eq!((frame.xres, frame.yres), (1920, 1080));
        assert_eq!(frame.fourcc as u32, rules::FOURCC_BGRA);
        assert_eq!((frame.frame_rate_n, frame.frame_rate_d), (30_000, 1_000));
        assert_eq!(frame.frame_format_type, rules::FRAME_FORMAT_PROGRESSIVE);
        assert_eq!(frame.line_stride_in_bytes, 7680);
        assert_eq!(frame.timecode, i64::MAX);
        assert_eq!(frame.p_data.cast_const(), pixels.as_ptr());
        assert!(frame.p_metadata.is_null());
    }
}
