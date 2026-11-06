//! What this computer can do for projection: its GPUs, which codecs their
//! decoders take, and its displays' sizes and refresh rates.
//!
//! Asked once and kept: none of it changes while the app runs, except the
//! displays, which are read fresh each time they are asked about.

use std::sync::OnceLock;

use serde::Serialize;

/// One GPU.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Gpu {
    pub name: String,
    /// An integrated GPU, sharing the processor's memory and power.
    pub low_power: bool,
    /// An external GPU, in its own box.
    pub removable: bool,
    /// The memory it works in comfortably, in megabytes.
    pub memory_mb: u64,
}

/// Whether the GPU decodes a codec.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CodecSupport {
    pub codec: &'static str,
    pub gpu: bool,
}

/// One display, as it is set now.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DisplayMode {
    pub width: u32,
    pub height: u32,
    /// Frames a second; 0 where the display does not say.
    pub refresh_hz: f64,
    pub built_in: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Capabilities {
    pub gpus: Vec<Gpu>,
    pub decoding: Vec<CodecSupport>,
    pub displays: Vec<DisplayMode>,
    /// Screens can be shown as layers the GPU puts together.
    pub layers: bool,
}

/// The codecs worth asking about: what churches' media libraries hold.
const CODECS: [(&str, u32); 6] = [
    ("H.264", u32::from_be_bytes(*b"avc1")),
    ("HEVC", u32::from_be_bytes(*b"hvc1")),
    ("ProRes", u32::from_be_bytes(*b"apcn")),
    ("VP9", u32::from_be_bytes(*b"vp09")),
    ("AV1", u32::from_be_bytes(*b"av01")),
    ("MPEG-4", u32::from_be_bytes(*b"mp4v")),
];

/// Everything, displays read now.
pub fn capabilities() -> Capabilities {
    Capabilities {
        gpus: gpus().to_vec(),
        decoding: decoding().to_vec(),
        displays: displays(),
        layers: cfg!(target_os = "macos"),
    }
}

/// Whether this computer's GPU decodes the codec FFmpeg calls `codec`. `true`
/// where it cannot be told: FFmpeg's own attempt then decides.
pub fn gpu_decodes(codec: ffmpeg_next::codec::Id) -> bool {
    use ffmpeg_next::codec::Id;
    let name = match codec {
        Id::H264 => "H.264",
        Id::HEVC => "HEVC",
        // VideoToolbox decodes ProRes on every Mac: on a ProRes engine where
        // there is one, in its own optimised software where there is not.
        // Either way its frames come out as surfaces the screens show with no
        // copy, so it is always tried.
        Id::PRORES => return true,
        Id::VP9 => "VP9",
        Id::AV1 => "AV1",
        Id::MPEG4 => "MPEG-4",
        _ => return true,
    };
    decoding()
        .iter()
        .find(|support| support.codec == name)
        .is_none_or(|support| support.gpu)
}

fn decoding() -> &'static [CodecSupport] {
    static DECODING: OnceLock<Vec<CodecSupport>> = OnceLock::new();
    DECODING.get_or_init(|| {
        CODECS
            .iter()
            .map(|(codec, fourcc)| CodecSupport {
                codec,
                gpu: platform::hardware_decodes(*fourcc),
            })
            .collect()
    })
}

fn gpus() -> &'static [Gpu] {
    static GPUS: OnceLock<Vec<Gpu>> = OnceLock::new();
    GPUS.get_or_init(platform::gpus)
}

fn displays() -> Vec<DisplayMode> {
    platform::displays()
}

#[cfg(target_os = "macos")]
mod platform {
    use objc2::msg_send;
    use objc2::rc::Retained;
    use objc2::runtime::AnyObject;
    use objc2_foundation::{NSArray, NSString};

    use super::{DisplayMode, Gpu};

    #[link(name = "VideoToolbox", kind = "framework")]
    extern "C" {
        fn VTIsHardwareDecodeSupported(codec: u32) -> u8;
    }

    #[link(name = "Metal", kind = "framework")]
    extern "C" {
        fn MTLCopyAllDevices() -> *mut AnyObject;
    }

    pub fn hardware_decodes(fourcc: u32) -> bool {
        // SAFETY: a plain query, on macOS 10.13 and later.
        unsafe { VTIsHardwareDecodeSupported(fourcc) != 0 }
    }

    pub fn gpus() -> Vec<Gpu> {
        // SAFETY: returns a retained NSArray of Metal devices, or null.
        let devices = unsafe { MTLCopyAllDevices() }.cast::<NSArray<AnyObject>>();
        let Some(devices) = (unsafe { Retained::from_raw(devices) }) else {
            return Vec::new();
        };
        devices
            .iter()
            .map(|device| {
                // SAFETY: every MTLDevice answers these.
                unsafe {
                    let name: Retained<NSString> = msg_send![&*device, name];
                    let low_power: bool = msg_send![&*device, isLowPower];
                    let removable: bool = msg_send![&*device, isRemovable];
                    let memory: u64 = msg_send![&*device, recommendedMaxWorkingSetSize];
                    Gpu {
                        name: name.to_string(),
                        low_power,
                        removable,
                        memory_mb: memory / (1024 * 1024),
                    }
                }
            })
            .collect()
    }

    pub fn displays() -> Vec<DisplayMode> {
        use core_graphics::display::CGDisplay;
        let Ok(ids) = CGDisplay::active_displays() else {
            return Vec::new();
        };
        ids.into_iter()
            .filter_map(|id| {
                let display = CGDisplay::new(id);
                let mode = display.display_mode()?;
                Some(DisplayMode {
                    width: u32::try_from(mode.pixel_width()).unwrap_or(0),
                    height: u32::try_from(mode.pixel_height()).unwrap_or(0),
                    refresh_hz: mode.refresh_rate(),
                    built_in: display.is_builtin(),
                })
            })
            .collect()
    }
}

#[cfg(not(target_os = "macos"))]
mod platform {
    use super::{DisplayMode, Gpu};

    /// Not known here: FFmpeg's own attempt on the GPU decides.
    pub fn hardware_decodes(_fourcc: u32) -> bool {
        true
    }

    pub fn gpus() -> Vec<Gpu> {
        Vec::new()
    }

    pub fn displays() -> Vec<DisplayMode> {
        Vec::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_codec_asked_about_has_an_answer_and_unknown_ones_are_left_to_ffmpeg() {
        let found = capabilities();
        assert_eq!(found.decoding.len(), CODECS.len());
        assert!(gpu_decodes(ffmpeg_next::codec::Id::THEORA));
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn a_mac_has_a_gpu_that_decodes_h264() {
        let found = capabilities();
        assert!(!found.gpus.is_empty(), "{found:?}");
        assert!(gpu_decodes(ffmpeg_next::codec::Id::H264), "{found:?}");
    }
}
