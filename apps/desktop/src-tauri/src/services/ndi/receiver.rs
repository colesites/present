//! Receiving one NDI source.

use std::ffi::{c_void, CString};
use std::ptr::{self, NonNull};
use std::sync::Arc;
use std::time::Duration;

use super::finder::millis;
use super::rules::Source;
use super::sys::{
    NdiLib, RawSource, RecvCreateV3, VideoFrameV2, FRAME_TYPE_ERROR, FRAME_TYPE_NONE,
    FRAME_TYPE_VIDEO,
};

pub struct Receiver {
    lib: Arc<NdiLib>,
    instance: NonNull<c_void>,
}

// SAFETY: an NDI receiver may be used from any thread; capture takes
// `&mut self`, so two threads cannot capture at once.
unsafe impl Send for Receiver {}

/// What one capture call produced.
pub enum Capture<'a> {
    Video(ReceivedVideo<'a>),
    /// Nothing arrived before the timeout.
    Nothing,
    /// The connection to the source is lost. NDI keeps trying to reconnect by
    /// name, so a later capture can succeed again.
    Error,
    /// Audio, metadata or a status change, none of which a prop uses.
    Other,
}

/// A video frame owned by the SDK until this is dropped.
pub struct ReceivedVideo<'a> {
    receiver: &'a Receiver,
    frame: VideoFrameV2,
}

impl ReceivedVideo<'_> {
    pub fn width(&self) -> i32 {
        self.frame.xres
    }

    pub fn height(&self) -> i32 {
        self.frame.yres
    }

    pub fn fourcc(&self) -> u32 {
        self.frame.fourcc as u32
    }

    pub fn has_data(&self) -> bool {
        !self.frame.p_data.is_null()
    }

    /// The pixels as tightly packed four-byte rows, without the stride padding
    /// a receiver is free to add. `None` for anything that is not four bytes a
    /// pixel, or a frame whose stride is shorter than its width.
    pub fn tight_pixels(&self) -> Option<Vec<u8>> {
        let width = usize::try_from(self.frame.xres).ok().filter(|w| *w > 0)?;
        let height = usize::try_from(self.frame.yres).ok().filter(|h| *h > 0)?;
        let stride = usize::try_from(self.frame.line_stride_in_bytes).ok()?;
        let row = width.checked_mul(4)?;
        if !self.has_data() || stride < row {
            return None;
        }

        // SAFETY: the SDK owns `stride * height` bytes at `p_data` until this
        // frame is freed, which cannot happen while `self` is borrowed.
        let data = unsafe { std::slice::from_raw_parts(self.frame.p_data, stride * height) };
        let mut out = Vec::with_capacity(row * height);
        for line in data.chunks_exact(stride) {
            out.extend_from_slice(&line[..row]);
        }
        Some(out)
    }
}

impl Drop for ReceivedVideo<'_> {
    fn drop(&mut self) {
        // SAFETY: filled in by `recv_capture_v2` on this receiver, freed once.
        unsafe {
            (self.receiver.lib.recv_free_video_v2)(self.receiver.instance.as_ptr(), &self.frame)
        }
    }
}

impl Receiver {
    /// Connect to a source by name, as discovery reported it.
    pub fn connect(
        lib: Arc<NdiLib>,
        source: &Source,
        color_format: i32,
        bandwidth: i32,
        receiver_name: &str,
    ) -> Result<Self, String> {
        let invalid = |_| "An NDI name cannot contain a NUL character.".to_owned();
        let name = CString::new(source.name.as_str()).map_err(invalid)?;
        let url = source
            .url_address
            .as_deref()
            .map(CString::new)
            .transpose()
            .map_err(invalid)?;
        let receiver_name = CString::new(receiver_name).map_err(invalid)?;

        let settings = RecvCreateV3 {
            source_to_connect_to: RawSource {
                p_ndi_name: name.as_ptr(),
                p_url_address: url.as_ref().map_or(ptr::null(), |value| value.as_ptr()),
            },
            color_format,
            bandwidth,
            allow_video_fields: true,
            p_ndi_recv_name: receiver_name.as_ptr(),
        };

        // SAFETY: every string outlives the call, which copies them.
        let instance = unsafe { (lib.recv_create_v3)(&settings) };
        NonNull::new(instance)
            .map(|instance| Self { lib, instance })
            .ok_or_else(|| format!("Could not connect to NDI source \"{}\".", source.name))
    }

    /// Wait up to `timeout` for the next video frame.
    pub fn capture(&mut self, timeout: Duration) -> Capture<'_> {
        let mut frame = VideoFrameV2::empty();
        // SAFETY: a live instance; audio and metadata are not asked for.
        let kind = unsafe {
            (self.lib.recv_capture_v2)(
                self.instance.as_ptr(),
                &mut frame,
                ptr::null_mut(),
                ptr::null_mut(),
                millis(timeout),
            )
        };
        match kind {
            FRAME_TYPE_VIDEO => Capture::Video(ReceivedVideo {
                receiver: self,
                frame,
            }),
            FRAME_TYPE_NONE => Capture::Nothing,
            FRAME_TYPE_ERROR => Capture::Error,
            _ => Capture::Other,
        }
    }

    /// Whether this receiver is connected to its source: 0 or 1.
    pub fn connections(&self) -> u32 {
        // SAFETY: a live instance.
        let count = unsafe { (self.lib.recv_get_no_connections)(self.instance.as_ptr()) };
        u32::try_from(count).unwrap_or(0)
    }
}

impl Drop for Receiver {
    fn drop(&mut self) {
        // SAFETY: created by `recv_create_v3` and destroyed exactly once, after
        // every `ReceivedVideo` borrowing it has been freed.
        unsafe { (self.lib.recv_destroy)(self.instance.as_ptr()) }
    }
}
