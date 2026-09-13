//! The NDI SDK's C interface, resolved from a library loaded at runtime.
//!
//! Only what Present calls: discovery, one sender, one receiver. Every struct
//! here is `#[repr(C)]` and transcribed from the SDK's MIT-licensed headers
//! (`Processing.NDI.structs.h`, `.Find.h`, `.Send.h`, `.Recv.h`, v6); the layout
//! tests at the bottom pin each size and field offset, so a transcription
//! mistake is a failing test rather than a corrupted frame header.
//!
//! Nothing outside `services::ndi` should touch this module. The safe types in
//! `finder.rs`, `sender.rs` and `receiver.rs` are the interface.

use std::ffi::{c_char, c_float, c_int, c_void};

use libloading::Library;

pub type FindInstance = *mut c_void;
pub type SendInstance = *mut c_void;
pub type RecvInstance = *mut c_void;

/// `NDIlib_send_timecode_synthesize`: let the SDK stamp the frame.
pub const SEND_TIMECODE_SYNTHESIZE: i64 = i64::MAX;

/// `NDIlib_frame_type_e`, as `NDIlib_recv_capture_v2` returns it.
pub const FRAME_TYPE_NONE: c_int = 0;
pub const FRAME_TYPE_VIDEO: c_int = 1;
pub const FRAME_TYPE_ERROR: c_int = 4;

/// `NDIlib_source_t`. The address is a union with a deprecated alias of the
/// same type, so one pointer field describes both.
#[repr(C)]
#[derive(Debug, Clone, Copy)]
pub struct RawSource {
    pub p_ndi_name: *const c_char,
    pub p_url_address: *const c_char,
}

/// `NDIlib_find_create_t`.
#[repr(C)]
#[derive(Debug, Clone, Copy)]
pub struct FindCreate {
    pub show_local_sources: bool,
    pub p_groups: *const c_char,
    pub p_extra_ips: *const c_char,
}

/// `NDIlib_send_create_t`.
#[repr(C)]
#[derive(Debug, Clone, Copy)]
pub struct SendCreate {
    pub p_ndi_name: *const c_char,
    pub p_groups: *const c_char,
    pub clock_video: bool,
    pub clock_audio: bool,
}

/// `NDIlib_video_frame_v2_t`.
///
/// Both C enums in it are declared with a `0x7fffffff` sentinel, which fixes
/// them at `int` width; they are `i32` here. `line_stride_in_bytes` is a union
/// with `data_size_in_bytes`, which only compressed formats use.
#[repr(C)]
#[derive(Debug, Clone, Copy)]
pub struct VideoFrameV2 {
    pub xres: c_int,
    pub yres: c_int,
    pub fourcc: i32,
    pub frame_rate_n: c_int,
    pub frame_rate_d: c_int,
    pub picture_aspect_ratio: c_float,
    pub frame_format_type: i32,
    pub timecode: i64,
    pub p_data: *mut u8,
    pub line_stride_in_bytes: c_int,
    pub p_metadata: *const c_char,
    pub timestamp: i64,
}

impl VideoFrameV2 {
    /// A frame for `NDIlib_recv_capture_v2` to fill in.
    pub fn empty() -> Self {
        Self {
            xres: 0,
            yres: 0,
            fourcc: 0,
            frame_rate_n: 0,
            frame_rate_d: 0,
            picture_aspect_ratio: 0.0,
            frame_format_type: 0,
            timecode: 0,
            p_data: std::ptr::null_mut(),
            line_stride_in_bytes: 0,
            p_metadata: std::ptr::null(),
            timestamp: 0,
        }
    }
}

/// `NDIlib_recv_create_v3_t`.
#[repr(C)]
#[derive(Debug, Clone, Copy)]
pub struct RecvCreateV3 {
    pub source_to_connect_to: RawSource,
    pub color_format: i32,
    pub bandwidth: i32,
    pub allow_video_fields: bool,
    pub p_ndi_recv_name: *const c_char,
}

/// The functions Present calls, resolved once from a loaded library.
///
/// Holds the `Library` so the pointers cannot outlive the code they point at.
/// The library is never unloaded: an instance, a sender thread or the SDK's own
/// discovery threads can still be running, and unloading code under a running
/// thread is not a failure anything can recover from.
pub struct NdiLib {
    pub initialize: unsafe extern "C" fn() -> bool,
    pub version: unsafe extern "C" fn() -> *const c_char,

    pub find_create_v2: unsafe extern "C" fn(*const FindCreate) -> FindInstance,
    pub find_destroy: unsafe extern "C" fn(FindInstance),
    pub find_wait_for_sources: unsafe extern "C" fn(FindInstance, u32) -> bool,
    pub find_get_current_sources: unsafe extern "C" fn(FindInstance, *mut u32) -> *const RawSource,

    pub send_create: unsafe extern "C" fn(*const SendCreate) -> SendInstance,
    pub send_destroy: unsafe extern "C" fn(SendInstance),
    pub send_send_video_v2: unsafe extern "C" fn(SendInstance, *const VideoFrameV2),
    pub send_get_no_connections: unsafe extern "C" fn(SendInstance, u32) -> c_int,

    pub recv_create_v3: unsafe extern "C" fn(*const RecvCreateV3) -> RecvInstance,
    pub recv_destroy: unsafe extern "C" fn(RecvInstance),
    pub recv_capture_v2: unsafe extern "C" fn(
        RecvInstance,
        *mut VideoFrameV2,
        *mut c_void,
        *mut c_void,
        u32,
    ) -> c_int,
    pub recv_free_video_v2: unsafe extern "C" fn(RecvInstance, *const VideoFrameV2),
    pub recv_get_no_connections: unsafe extern "C" fn(RecvInstance) -> c_int,

    _library: Library,
}

impl NdiLib {
    /// Resolve every symbol from an already-opened library.
    ///
    /// # Safety
    ///
    /// `library` must be an NDI SDK runtime whose exported functions have the
    /// signatures declared above — true of every v5 and v6 runtime, whose ABI
    /// for these calls has not changed. A library that merely exports the same
    /// names with other signatures is undefined behaviour on first call.
    pub unsafe fn resolve(library: Library) -> Result<Self, String> {
        macro_rules! symbol {
            ($name:literal) => {
                *library
                    .get(concat!($name, "\0").as_bytes())
                    .map_err(|error| format!("{} is missing: {error}", $name))?
            };
        }

        Ok(Self {
            initialize: symbol!("NDIlib_initialize"),
            version: symbol!("NDIlib_version"),
            find_create_v2: symbol!("NDIlib_find_create_v2"),
            find_destroy: symbol!("NDIlib_find_destroy"),
            find_wait_for_sources: symbol!("NDIlib_find_wait_for_sources"),
            find_get_current_sources: symbol!("NDIlib_find_get_current_sources"),
            send_create: symbol!("NDIlib_send_create"),
            send_destroy: symbol!("NDIlib_send_destroy"),
            send_send_video_v2: symbol!("NDIlib_send_send_video_v2"),
            send_get_no_connections: symbol!("NDIlib_send_get_no_connections"),
            recv_create_v3: symbol!("NDIlib_recv_create_v3"),
            recv_destroy: symbol!("NDIlib_recv_destroy"),
            recv_capture_v2: symbol!("NDIlib_recv_capture_v2"),
            recv_free_video_v2: symbol!("NDIlib_recv_free_video_v2"),
            recv_get_no_connections: symbol!("NDIlib_recv_get_no_connections"),
            _library: library,
        })
    }
}

#[cfg(test)]
mod tests {
    //! Offsets from the C headers on an LP64 target, the only kind Present
    //! ships for. `bool` is one byte; everything pads to its own alignment.

    use std::mem::{align_of, offset_of, size_of};

    use super::*;

    #[test]
    fn source_is_two_pointers() {
        assert_eq!(size_of::<RawSource>(), 16);
        assert_eq!(offset_of!(RawSource, p_url_address), 8);
    }

    #[test]
    fn find_create_pads_the_bool_to_the_pointer() {
        assert_eq!(size_of::<FindCreate>(), 24);
        assert_eq!(offset_of!(FindCreate, show_local_sources), 0);
        assert_eq!(offset_of!(FindCreate, p_groups), 8);
        assert_eq!(offset_of!(FindCreate, p_extra_ips), 16);
    }

    #[test]
    fn send_create_puts_both_clocks_after_the_pointers() {
        assert_eq!(size_of::<SendCreate>(), 24);
        assert_eq!(offset_of!(SendCreate, p_groups), 8);
        assert_eq!(offset_of!(SendCreate, clock_video), 16);
        assert_eq!(offset_of!(SendCreate, clock_audio), 17);
    }

    #[test]
    fn a_video_frame_header_matches_the_sdk_field_for_field() {
        // A wrong offset here is not a crash: it is the SDK reading the stride
        // as the data pointer, or the timecode as the aspect ratio.
        assert_eq!(size_of::<VideoFrameV2>(), 72);
        assert_eq!(align_of::<VideoFrameV2>(), 8);
        assert_eq!(offset_of!(VideoFrameV2, xres), 0);
        assert_eq!(offset_of!(VideoFrameV2, yres), 4);
        assert_eq!(offset_of!(VideoFrameV2, fourcc), 8);
        assert_eq!(offset_of!(VideoFrameV2, frame_rate_n), 12);
        assert_eq!(offset_of!(VideoFrameV2, frame_rate_d), 16);
        assert_eq!(offset_of!(VideoFrameV2, picture_aspect_ratio), 20);
        assert_eq!(offset_of!(VideoFrameV2, frame_format_type), 24);
        assert_eq!(offset_of!(VideoFrameV2, timecode), 32);
        assert_eq!(offset_of!(VideoFrameV2, p_data), 40);
        assert_eq!(offset_of!(VideoFrameV2, line_stride_in_bytes), 48);
        assert_eq!(offset_of!(VideoFrameV2, p_metadata), 56);
        assert_eq!(offset_of!(VideoFrameV2, timestamp), 64);
    }

    #[test]
    fn recv_create_puts_the_name_after_the_padded_bool() {
        assert_eq!(size_of::<RecvCreateV3>(), 40);
        assert_eq!(offset_of!(RecvCreateV3, color_format), 16);
        assert_eq!(offset_of!(RecvCreateV3, bandwidth), 20);
        assert_eq!(offset_of!(RecvCreateV3, allow_video_fields), 24);
        assert_eq!(offset_of!(RecvCreateV3, p_ndi_recv_name), 32);
    }
}
