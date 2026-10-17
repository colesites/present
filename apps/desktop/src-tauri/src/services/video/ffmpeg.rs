//! Decoding video with FFmpeg, on every platform (ADR-003).
//!
//! **Colour is the load-bearing part.** The scaler
//! converts YUV to RGB, and left to itself it uses the SD (BT.601) matrix and
//! assumes limited range — washed-out blacks and shifted skin tones on HD
//! material. So each frame's declared matrix and range are passed to it, and a
//! frame that declares nothing is treated the way players treat one: BT.709
//! from 720 lines up, BT.601 below, limited range unless the pixel format is a
//! full-range (`yuvj`) one. Most of the owner's own library declares nothing.
//!
//! Frames are scaled on the way out to the size the caller asked for, so the
//! compositor never resamples a 4K frame itself.
//!
//! **Decoding is on the GPU where the platform's decoder takes the file**
//! (VideoToolbox, D3D11, VA-API): software decoding a 4K frame costs more than
//! a 30 fps frame's budget on the machines churches run. What the GPU decoder
//! refuses — H.264 4:2:2 on most of them, among others — is decoded in software
//! on every core, found out on the first frame so a service never waits on it.

use std::collections::VecDeque;
use std::path::Path;
use std::ptr;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Once};

use ff::format::Pixel;
use ff::software::scaling;
use ff::util::color;
use ffmpeg_next as ff;

use super::{VideoDecoder, VideoError, VideoFrame};

pub(crate) fn init() {
    static INIT: Once = Once::new();
    INIT.call_once(|| {
        let _ = ff::init();
        // FFmpeg's own lines go to stderr, where a bundled app's are never
        // read, and include a routine "failed setup" every time the GPU
        // decoder turns a file down. What matters reaches callers as errors,
        // and the switch to software is logged here.
        ff::util::log::set_level(ff::util::log::Level::Fatal);

        let (version, license) = library();
        if is_lgpl(license) {
            tracing::info!(version, license, "FFmpeg loaded");
        } else if cfg!(debug_assertions) {
            // A development build against Homebrew's FFmpeg, which is GPL.
            tracing::info!(version, license, "FFmpeg loaded (not the build that ships)");
        } else {
            tracing::error!(
                version,
                license,
                "this build loaded an FFmpeg that must not ship with it (ADR-003)"
            );
        }
    });
}

/// The FFmpeg in use: its version and the licence it was built under.
pub fn library() -> (&'static str, &'static str) {
    // SAFETY: FFmpeg returns a static string.
    let version = unsafe { std::ffi::CStr::from_ptr(ff::ffi::av_version_info()) }
        .to_str()
        .unwrap_or("unknown");
    (version, ff::util::license())
}

/// Whether FFmpeg reports the licence the app may ship it under.
pub fn is_lgpl(license: &str) -> bool {
    license.starts_with("LGPL")
}

fn decode_error(error: ff::Error) -> VideoError {
    VideoError::Decode(error.to_string())
}

/// The matrix a frame's colours are in, filling in what the file left out.
pub fn effective_color_space(declared: color::Space, height: u32) -> color::Space {
    match declared {
        color::Space::Unspecified | color::Space::Reserved => {
            if height >= 720 {
                color::Space::BT709
            } else {
                color::Space::BT470BG
            }
        }
        other => other,
    }
}

/// Whether a frame's values span the full 0–255 range.
pub fn is_full_range(declared: color::Range, format: Pixel) -> bool {
    match declared {
        color::Range::JPEG => true,
        color::Range::MPEG => false,
        _ => matches!(
            format,
            Pixel::YUVJ420P | Pixel::YUVJ422P | Pixel::YUVJ444P | Pixel::YUVJ440P
        ),
    }
}

/// `SWS_CS_*` for a matrix.
// bindgen types the constants differently by platform; the cast is a no-op here.
#[allow(clippy::unnecessary_cast)]
fn sws_colorspace(space: color::Space) -> i32 {
    use ff::ffi::{SWS_CS_BT2020, SWS_CS_FCC, SWS_CS_ITU601, SWS_CS_ITU709, SWS_CS_SMPTE240M};
    (match space {
        color::Space::BT709 => SWS_CS_ITU709,
        color::Space::FCC => SWS_CS_FCC,
        color::Space::SMPTE240M => SWS_CS_SMPTE240M,
        color::Space::BT2020NCL | color::Space::BT2020CL => SWS_CS_BT2020,
        _ => SWS_CS_ITU601,
    }) as i32
}

/// The GPU decoders to try, in order.
fn hardware_types() -> &'static [ff::ffi::AVHWDeviceType] {
    use ff::ffi::AVHWDeviceType::*;
    if cfg!(target_os = "macos") {
        &[AV_HWDEVICE_TYPE_VIDEOTOOLBOX]
    } else if cfg!(target_os = "windows") {
        &[AV_HWDEVICE_TYPE_D3D11VA, AV_HWDEVICE_TYPE_DXVA2]
    } else if cfg!(target_os = "linux") {
        &[AV_HWDEVICE_TYPE_VAAPI]
    } else {
        &[]
    }
}

/// A GPU decoding device.
struct HardwareDevice(*mut ff::ffi::AVBufferRef);

impl HardwareDevice {
    /// The first of the platform's GPU decoders that opens, unless
    /// `PRESENT_VIDEO_SOFTWARE` is set to rule the GPU out while diagnosing.
    fn open() -> Option<Self> {
        if std::env::var_os("PRESENT_VIDEO_SOFTWARE").is_some() {
            return None;
        }
        hardware_types().iter().find_map(|&kind| {
            let mut device = ptr::null_mut();
            // SAFETY: `device` is written only on success, and then owned here.
            let result = unsafe {
                ff::ffi::av_hwdevice_ctx_create(&mut device, kind, ptr::null(), ptr::null_mut(), 0)
            };
            (result >= 0 && !device.is_null()).then(|| Self(device))
        })
    }
}

impl Drop for HardwareDevice {
    fn drop(&mut self) {
        // SAFETY: the reference was created by `av_hwdevice_ctx_create`.
        unsafe { ff::ffi::av_buffer_unref(&mut self.0) };
    }
}

/// Whether a frame's pixels are still on the GPU.
fn is_hardware_frame(frame: &ff::frame::Video) -> bool {
    let format: ff::ffi::AVPixelFormat = frame.format().into();
    // SAFETY: descriptors are static FFmpeg data; null for an unknown format.
    unsafe {
        let descriptor = ff::ffi::av_pix_fmt_desc_get(format);
        !descriptor.is_null() && (*descriptor).flags & ff::ffi::AV_PIX_FMT_FLAG_HWACCEL as u64 != 0
    }
}

/// Open the stream's decoder: on `hardware` when given, else on every core.
fn open_decoder(
    parameters: ff::codec::Parameters,
    hardware: Option<&HardwareDevice>,
    path: &Path,
) -> Result<ff::decoder::Video, VideoError> {
    let mut context =
        ff::codec::context::Context::from_parameters(parameters).map_err(decode_error)?;
    match hardware {
        // One thread: the GPU does the work, and more measured no faster.
        // SAFETY: the codec context takes its own reference, released when it
        // is freed.
        Some(device) => unsafe {
            (*context.as_mut_ptr()).hw_device_ctx = ff::ffi::av_buffer_ref(device.0);
        },
        // Frame threads on every core: decoding a 4K frame on one is the
        // difference between making 30 fps and not.
        // A count of 0 is every core.
        None => context.set_threading(ff::codec::threading::Config::kind(
            ff::codec::threading::Type::Frame,
        )),
    }
    context
        .decoder()
        .video()
        .map_err(|error| VideoError::Unsupported(format!("{}: {error}", path.display())))
}

/// A frame in the form it is scaled from.
type ScalerKey = (Pixel, u32, u32, color::Space, bool);

struct Scaler {
    context: *mut ff::ffi::SwsContext,
    source: ScalerKey,
}

impl Scaler {
    fn new(key: ScalerKey, size: (u32, u32)) -> Result<Self, VideoError> {
        let (format, width, height, space, full_range) = key;
        // SAFETY: a fresh context, configured through its options, and freed on
        // failure or drop.
        unsafe {
            let mut context = ff::ffi::sws_alloc_context();
            if context.is_null() {
                return Err(VideoError::Decode("could not allocate a scaler".to_owned()));
            }
            let src_format: ff::ffi::AVPixelFormat = format.into();
            let dst_format: ff::ffi::AVPixelFormat = Pixel::BGRA.into();
            let options: [(&std::ffi::CStr, i64); 8] = [
                (c"srcw", i64::from(width)),
                (c"srch", i64::from(height)),
                (c"src_format", src_format as i64),
                (c"dstw", i64::from(size.0)),
                (c"dsth", i64::from(size.1)),
                (c"dst_format", dst_format as i64),
                // Bilinear, which widens to a proper average when shrinking 4K.
                // Measured against AVFoundation it was the closest match, and
                // among the fastest; area averaging and full chroma
                // interpolation were no closer and slower. Enlarging — a
                // 480-line video on a 1080p screen — bilinear blurs, and
                // bicubic keeps the edges, as QuickTime does.
                (
                    c"sws_flags",
                    i64::from(if size.0 > width || size.1 > height {
                        scaling::Flags::BICUBIC.bits()
                    } else {
                        scaling::Flags::BILINEAR.bits()
                    }),
                ),
                // Slices on every core (0) when resizing: a quarter of the time
                // of one. A conversion at the same size is swscale's fast path,
                // which slicing made no faster.
                (c"threads", if (width, height) == size { 1 } else { 0 }),
            ];
            for (name, value) in options {
                if ff::ffi::av_opt_set_int(context.cast(), name.as_ptr(), value, 0) < 0 {
                    ff::ffi::sws_free_context(&mut context);
                    return Err(VideoError::Decode(format!(
                        "the scaler refused {}",
                        name.to_string_lossy()
                    )));
                }
            }
            let table = ff::ffi::sws_getCoefficients(sws_colorspace(space));
            let result = ff::ffi::sws_init_context(context, ptr::null_mut(), ptr::null_mut());
            if result < 0 {
                ff::ffi::sws_free_context(&mut context);
                return Err(decode_error(ff::Error::from(result)));
            }
            ff::ffi::sws_setColorspaceDetails(
                context,
                table,
                i32::from(full_range),
                table,
                1,
                0,
                1 << 16,
                1 << 16,
            );
            Ok(Self {
                context,
                source: key,
            })
        }
    }
}

impl Drop for Scaler {
    fn drop(&mut self) {
        // SAFETY: created by `sws_alloc_context`; nulled by the call.
        unsafe { ff::ffi::sws_free_context(&mut self.context) };
    }
}

/// NV12's chroma, interleaved, split into YUV 4:2:0's two planes.
///
/// swscale has a fast path to BGRA from planar YUV at the same size and none
/// from NV12, which is what a GPU decoder hands back: measured 3.1 ms a 1080p
/// frame this way against 8.3 ms directly, on one core.
fn split_nv12(frame: &ff::frame::Video, planar: &mut ff::frame::Video) -> Result<(), VideoError> {
    let (width, height) = (frame.width(), frame.height());
    if planar.format() != Pixel::YUV420P || (planar.width(), planar.height()) != (width, height) {
        *planar = ff::frame::Video::new(Pixel::YUV420P, width, height);
    }
    // SAFETY: both frames are valid; this copies timestamps and colour.
    let result = unsafe { ff::ffi::av_frame_copy_props(planar.as_mut_ptr(), frame.as_ptr()) };
    if result < 0 {
        return Err(decode_error(ff::Error::from(result)));
    }
    let short = || VideoError::Decode("an NV12 frame was short".to_owned());

    let (luma_width, luma_height) = (width as usize, height as usize);
    let (source_stride, target_stride) = (frame.stride(0), planar.stride(0));
    for row in 0..luma_height {
        let line = frame
            .data(0)
            .get(row * source_stride..row * source_stride + luma_width)
            .ok_or_else(short)?;
        planar
            .data_mut(0)
            .get_mut(row * target_stride..row * target_stride + luma_width)
            .ok_or_else(short)?
            .copy_from_slice(line);
    }

    let (chroma_width, chroma_height) = (luma_width.div_ceil(2), luma_height.div_ceil(2));
    let source_stride = frame.stride(1);
    for (plane, offset) in [(1, 0), (2, 1)] {
        let target_stride = planar.stride(plane);
        for row in 0..chroma_height {
            let pairs = frame
                .data(1)
                .get(row * source_stride..row * source_stride + chroma_width * 2)
                .ok_or_else(short)?;
            let target = planar
                .data_mut(plane)
                .get_mut(row * target_stride..row * target_stride + chroma_width)
                .ok_or_else(short)?;
            for (value, pair) in target.iter_mut().zip(pairs.chunks_exact(2)) {
                *value = pair[offset];
            }
        }
    }
    Ok(())
}

/// Scale `frame` into `converted` as BGRA at `size`, and copy the rows out.
/// `planar` is working space for an NV12 frame (`split_nv12`).
fn convert(
    scaler: &mut Option<Scaler>,
    size: (u32, u32),
    frame: &ff::frame::Video,
    planar: &mut ff::frame::Video,
    converted: &mut ff::frame::Video,
) -> Result<Vec<u8>, VideoError> {
    let frame = if frame.format() == Pixel::NV12 && (frame.width(), frame.height()) == size {
        split_nv12(frame, planar)?;
        &*planar
    } else {
        frame
    };
    let format = frame.format();
    let (width, height) = (frame.width(), frame.height());
    let space = effective_color_space(frame.color_space(), height);
    let full_range = is_full_range(frame.color_range(), format);
    let key = (format, width, height, space, full_range);

    if scaler.as_ref().is_none_or(|scaler| scaler.source != key) {
        *scaler = Some(Scaler::new(key, size)?);
    }
    let scaler = scaler.as_mut().expect("just created");

    // An empty frame's format is `None`.
    if converted.format() != Pixel::BGRA || (converted.width(), converted.height()) != size {
        *converted = ff::frame::Video::new(Pixel::BGRA, size.0, size.1);
    }
    // SAFETY: both frames are valid, and the destination is allocated at the
    // scaler's output size and format.
    let result =
        unsafe { ff::ffi::sws_scale_frame(scaler.context, converted.as_mut_ptr(), frame.as_ptr()) };
    if result < 0 {
        return Err(decode_error(ff::Error::from(result)));
    }

    let (out_width, out_height) = (size.0 as usize, size.1 as usize);
    let stride = converted.stride(0);
    let data = converted.data(0);
    let mut bgra = Vec::with_capacity(out_width * out_height * 4);
    for row in 0..out_height {
        let start = row * stride;
        let line = data
            .get(start..start + out_width * 4)
            .ok_or_else(|| VideoError::Decode("the scaled frame was short".to_owned()))?;
        bgra.extend_from_slice(line);
    }
    Ok(bgra)
}

/// Whether a GPU frame is shrunk before it is copied off (`gpu_scale.rs`).
#[cfg(target_os = "macos")]
enum GpuScaling {
    /// Not needed yet, or the frames changed shape.
    Unbuilt,
    Built(super::gpu_scale::GpuScaler),
    /// It failed for this video, which the CPU scales from then on.
    Off,
}

/// How much wider than high a stored pixel is shown: 1 for square pixels. A
/// DVD-shaped 720x480 meant to be seen at 16:9 says 32:27; shown as stored,
/// it was squeezed to 3:2. The container's word wins over the stream's, as
/// players take it.
///
/// # Safety
///
/// `stream` is a stream of an open input.
unsafe fn pixel_aspect(stream: *const ff::ffi::AVStream) -> f64 {
    let ratio = |value: ff::ffi::AVRational| {
        (value.num > 0 && value.den > 0).then(|| f64::from(value.num) / f64::from(value.den))
    };
    // SAFETY: the caller's: a stream, and its parameters, of an open input.
    let (container, codec) = unsafe {
        (
            (*stream).sample_aspect_ratio,
            (*(*stream).codecpar).sample_aspect_ratio,
        )
    };
    ratio(container)
        .or_else(|| ratio(codec))
        .filter(|aspect| (0.1..=10.0).contains(aspect))
        .unwrap_or(1.0)
}

/// How many quarter turns clockwise a stream's pictures are shown turned by.
/// A phone keeps a portrait video lying on its side and says how to stand it
/// up; ignored, it played on its side.
///
/// # Safety
///
/// `stream` is a stream of an open input.
unsafe fn quarter_turns(stream: *const ff::ffi::AVStream) -> u8 {
    // SAFETY: the caller's; the side data is the stream's own, read only.
    let degrees = unsafe {
        let parameters = (*stream).codecpar;
        let side = ff::ffi::av_packet_side_data_get(
            (*parameters).coded_side_data,
            (*parameters).nb_coded_side_data,
            ff::ffi::AVPacketSideDataType::AV_PKT_DATA_DISPLAYMATRIX,
        );
        if side.is_null() || (*side).data.is_null() || (*side).size < 9 * 4 {
            return 0;
        }
        ff::ffi::av_display_rotation_get((*side).data.cast::<i32>())
    };
    if !degrees.is_finite() {
        return 0;
    }
    // FFmpeg's angle turns counter-clockwise; standing it up turns it back.
    ((-degrees / 90.0).round() as i64).rem_euclid(4) as u8
}

/// The size a stream's pictures are shown at: its pixels made square, then
/// stood the way it is shown.
fn shown_size(coded: (u32, u32), aspect: f64, turns: u8) -> (u32, u32) {
    let width = ((f64::from(coded.0) * aspect).round() as u32).max(1);
    if turns % 2 == 1 {
        (coded.1, width)
    } else {
        (width, coded.1)
    }
}

/// `bgra`, `size` as recorded, turned `turns` quarter turns clockwise: a
/// quarter or three quarters swaps its width and height. In square tiles, so
/// a 1080p frame is read and written a cache line at a time rather than a
/// pixel a row.
fn turn_bgra(bgra: &[u8], (width, height): (u32, u32), turns: u8) -> Vec<u8> {
    let (width, height) = (width as usize, height as usize);
    let mut out = vec![0u8; bgra.len()];
    if bgra.len() != width * height * 4 {
        return bgra.to_vec();
    }
    const TILE: usize = 32;
    let turned_width = if turns % 2 == 1 { height } else { width };
    for tile_y in (0..height).step_by(TILE) {
        for tile_x in (0..width).step_by(TILE) {
            for y in tile_y..(tile_y + TILE).min(height) {
                for x in tile_x..(tile_x + TILE).min(width) {
                    let (to_x, to_y) = match turns {
                        1 => (height - 1 - y, x),
                        2 => (width - 1 - x, height - 1 - y),
                        _ => (y, width - 1 - x),
                    };
                    let from = (y * width + x) * 4;
                    let to = (to_y * turned_width + to_x) * 4;
                    out[to..to + 4].copy_from_slice(&bgra[from..from + 4]);
                }
            }
        }
    }
    out
}

/// How far short of a seek's target the decoder stops skipping the frames
/// nothing else is decoded from (`decode_next`): more than any file holds
/// frames back for reordering, so every frame near the target is decoded.
const CATCH_UP_MARGIN: f64 = 0.5;

/// What turns a decoded frame into BGRA at the size asked for: shrunk on the
/// GPU if it is there and larger, copied off it, and converted. It runs on a
/// thread of its own (`Pipeline`) while the decoder decodes the next frame.
///
/// They took turns: the GPU decoder is driven one frame at a time, and while
/// a 4K frame decoded — some 24 ms on the owner's MacBook Pro — the copy and
/// the conversion waited, and while they ran the decoder did. A 30 fps 4K
/// file came out at 21 to 25 frames a second, and the screens skipped to
/// keep up with the sound. Side by side, a frame costs the longer of the two.
struct Conversion {
    /// The size the frame is scaled to, lying as it was recorded.
    size: (u32, u32),
    /// Quarter turns clockwise it is shown turned by (`quarter_turns`).
    turns: u8,
    /// The video stream's time base, which the GPU scaler is built with.
    #[cfg_attr(not(target_os = "macos"), allow(dead_code))]
    time_base: ff::Rational,
    /// For the GPU scaler's warnings.
    #[cfg_attr(not(target_os = "macos"), allow(dead_code))]
    path: std::path::PathBuf,
    scaler: Option<Scaler>,
    /// A GPU frame shrunk on the GPU, before it is copied off.
    gpu_scaled: ff::frame::Video,
    #[cfg(target_os = "macos")]
    gpu_scaling: GpuScaling,
    /// A GPU frame's pixels, copied into memory.
    transferred: ff::frame::Video,
    /// `transferred` as planar YUV, when that converts faster.
    planar: ff::frame::Video,
    converted: ff::frame::Video,
    /// Set once a frame has been shrunk on the GPU.
    shrunk_on_gpu: Arc<AtomicBool>,
}

// SAFETY: the FFmpeg objects inside are only ever used by one thread: made on
// the decoder's, then moved to the conversion thread for good.
unsafe impl Send for Conversion {}

impl Conversion {
    fn new(size: (u32, u32), turns: u8, time_base: ff::Rational, path: &Path) -> Self {
        Self {
            size,
            turns,
            time_base,
            path: path.to_path_buf(),
            scaler: None,
            gpu_scaled: ff::frame::Video::empty(),
            #[cfg(target_os = "macos")]
            gpu_scaling: GpuScaling::Unbuilt,
            transferred: ff::frame::Video::empty(),
            planar: ff::frame::Video::empty(),
            converted: ff::frame::Video::empty(),
            shrunk_on_gpu: Arc::default(),
        }
    }

    /// `decoded` as BGRA, copied off the GPU first if it is there, and turned
    /// the way it is shown.
    fn deliver(&mut self, decoded: &mut ff::frame::Video) -> Result<Vec<u8>, VideoError> {
        let bgra = self.lying(decoded)?;
        Ok(match self.turns {
            0 => bgra,
            turns => turn_bgra(&bgra, self.size, turns),
        })
    }

    /// `decoded` as BGRA at `size`, as it was recorded.
    fn lying(&mut self, decoded: &mut ff::frame::Video) -> Result<Vec<u8>, VideoError> {
        if !is_hardware_frame(decoded) {
            return convert(
                &mut self.scaler,
                self.size,
                decoded,
                &mut self.planar,
                &mut self.converted,
            );
        }
        let shrunk = self.shrink_on_gpu(decoded);
        // SAFETY: both are valid frames.
        let source = unsafe {
            if shrunk {
                self.gpu_scaled.as_ptr()
            } else {
                decoded.as_ptr()
            }
        };
        // SAFETY: both frames are valid; the destination is reset so the
        // transfer allocates it in the GPU frame's software format.
        let result = unsafe {
            ff::ffi::av_frame_unref(self.transferred.as_mut_ptr());
            let result =
                ff::ffi::av_hwframe_transfer_data(self.transferred.as_mut_ptr(), source, 0);
            if result >= 0 {
                // Timestamps and the colour description.
                ff::ffi::av_frame_copy_props(self.transferred.as_mut_ptr(), decoded.as_ptr())
            } else {
                result
            }
        };
        if result < 0 {
            return Err(decode_error(ff::Error::from(result)));
        }
        convert(
            &mut self.scaler,
            self.size,
            &self.transferred,
            &mut self.planar,
            &mut self.converted,
        )
    }

    /// Shrink the GPU frame on the GPU when it is larger than wanted; `true`
    /// when `gpu_scaled` holds the result.
    #[cfg(target_os = "macos")]
    fn shrink_on_gpu(&mut self, decoded: &mut ff::frame::Video) -> bool {
        use super::gpu_scale::{gpu_size, GpuScaler};

        let larger = decoded.width() > self.size.0 || decoded.height() > self.size.1;
        if !larger || matches!(self.gpu_scaling, GpuScaling::Off) {
            return false;
        }
        let output = gpu_size(self.size);
        let fits =
            matches!(&self.gpu_scaling, GpuScaling::Built(scaler) if scaler.fits(decoded, output));
        if !fits {
            self.gpu_scaling = match GpuScaler::new(decoded, self.time_base, output) {
                Ok(scaler) => GpuScaling::Built(scaler),
                Err(error) => {
                    tracing::warn!(
                        path = %self.path.display(),
                        error,
                        "could not shrink this video on the GPU; the CPU will"
                    );
                    GpuScaling::Off
                }
            };
        }
        let GpuScaling::Built(scaler) = &mut self.gpu_scaling else {
            return false;
        };
        match scaler.scale(decoded, &mut self.gpu_scaled) {
            Ok(()) => {
                self.shrunk_on_gpu.store(true, Ordering::Relaxed);
                true
            }
            Err(error) => {
                tracing::warn!(
                    path = %self.path.display(),
                    error,
                    "shrinking on the GPU failed; the CPU will from here"
                );
                self.gpu_scaling = GpuScaling::Off;
                false
            }
        }
    }

    #[cfg(not(target_os = "macos"))]
    fn shrink_on_gpu(&mut self, _decoded: &mut ff::frame::Video) -> bool {
        false
    }
}

/// A decoded frame on its way to the conversion thread: moved, never shared.
struct Handed(ff::frame::Video);

// SAFETY: the frame, and the GPU buffer it holds a reference to, are only
// touched by whichever thread has it.
unsafe impl Send for Handed {}

/// The conversion thread: decoded frames in, BGRA out, in the same order.
struct Pipeline {
    frames: Option<std::sync::mpsc::SyncSender<Handed>>,
    converted: Option<std::sync::mpsc::Receiver<Result<Vec<u8>, VideoError>>>,
    thread: Option<std::thread::JoinHandle<()>>,
    /// Whether the conversion has shrunk a frame on the GPU.
    #[cfg_attr(not(test), allow(dead_code))]
    shrunk_on_gpu: Arc<AtomicBool>,
}

impl Pipeline {
    fn start(mut conversion: Conversion) -> Result<Self, VideoError> {
        let shrunk_on_gpu = Arc::clone(&conversion.shrunk_on_gpu);
        // One frame waiting while one converts: the decoder never has more
        // than two out.
        let (frames, incoming) = std::sync::mpsc::sync_channel::<Handed>(1);
        let (done, converted) = std::sync::mpsc::sync_channel(2);
        let thread = std::thread::Builder::new()
            .name("present-video-convert".to_owned())
            .spawn(move || {
                while let Ok(Handed(mut frame)) = incoming.recv() {
                    if done.send(conversion.deliver(&mut frame)).is_err() {
                        break;
                    }
                }
            })
            .map_err(|error| {
                VideoError::Decode(format!("the conversion thread would not start: {error}"))
            })?;
        Ok(Self {
            frames: Some(frames),
            converted: Some(converted),
            thread: Some(thread),
            shrunk_on_gpu,
        })
    }

    fn hand(&self, frame: ff::frame::Video) -> Result<(), VideoError> {
        self.frames
            .as_ref()
            .and_then(|frames| frames.send(Handed(frame)).ok())
            .ok_or_else(|| VideoError::Decode("the conversion thread stopped".to_owned()))
    }

    /// The next frame converted, in the order they were handed over.
    fn take(&self) -> Result<Vec<u8>, VideoError> {
        self.converted
            .as_ref()
            .and_then(|converted| converted.recv().ok())
            .unwrap_or_else(|| {
                Err(VideoError::Decode(
                    "the conversion thread stopped".to_owned(),
                ))
            })
    }
}

impl Drop for Pipeline {
    fn drop(&mut self) {
        // Closed both ways, so the thread ends after the frame it has.
        self.frames = None;
        self.converted = None;
        if let Some(thread) = self.thread.take() {
            let _ = thread.join();
        }
    }
}

pub struct FfmpegVideoDecoder {
    input: ff::format::context::Input,
    stream_index: usize,
    /// Seconds per timestamp unit.
    time_base: f64,
    decoder: ff::decoder::Video,
    size: (u32, u32),
    duration_seconds: Option<f64>,
    decoded: ff::frame::Video,
    /// Turns decoded frames into BGRA on a thread of its own, while this one
    /// decodes the next (`Pipeline`).
    pipeline: Pipeline,
    /// When the frames handed to it are, in order, not yet taken back.
    in_flight: VecDeque<f64>,
    /// A frame has been shown since the last open or seek: from then on the
    /// next is decoded while the one before it converts.
    flowing: bool,
    /// The demuxer has run out and the decoder has been told.
    drained: bool,
    finished: bool,
    /// After a seek, frames before this are decoded and dropped.
    seek_target: Option<f64>,
    frame_seconds: f64,
    /// Set while decoding on the GPU.
    hardware: Option<HardwareDevice>,
    /// `decoded` holds a frame not yet handed out: the first-frame probe's.
    primed: bool,
    /// The last frame handed out, where a switch to software resumes from.
    last_seconds: Option<f64>,
    path: std::path::PathBuf,
}

impl FfmpegVideoDecoder {
    /// Open, choosing the size frames are delivered at from the video's own.
    pub fn open_sized(
        path: &Path,
        size: impl FnOnce((u32, u32)) -> Option<(u32, u32)>,
    ) -> Result<Self, VideoError> {
        init();
        let input = ff::format::input(path).map_err(|error| match error {
            ff::Error::Other { errno } if errno == libc_enoent() => {
                VideoError::NotFound(path.display().to_string())
            }
            other => VideoError::Unsupported(format!("{}: {other}", path.display())),
        })?;
        let stream = input
            .streams()
            .best(ff::media::Type::Video)
            .ok_or_else(|| VideoError::Unsupported(format!("{} has no video", path.display())))?;
        let stream_index = stream.index();
        let stream_time_base = stream.time_base();
        let time_base = f64::from(stream_time_base);
        let rate = stream.avg_frame_rate();
        let frame_seconds = if rate.numerator() > 0 && rate.denominator() > 0 {
            f64::from(rate.denominator()) / f64::from(rate.numerator())
        } else {
            1.0 / 30.0
        };
        let duration_seconds = if stream.duration() > 0 {
            Some(stream.duration() as f64 * time_base)
        } else if input.duration() > 0 {
            Some(input.duration() as f64 / f64::from(ff::ffi::AV_TIME_BASE))
        } else {
            None
        };

        let hardware = HardwareDevice::open();
        let decoder = open_decoder(stream.parameters(), hardware.as_ref(), path)?;

        let coded = (decoder.width(), decoder.height());
        if coded.0 == 0 || coded.1 == 0 {
            return Err(VideoError::Unsupported(format!(
                "{} reports no picture size",
                path.display()
            )));
        }
        // SAFETY: a stream of the input just opened.
        let (aspect, turns) = unsafe {
            (
                pixel_aspect(stream.as_ptr()),
                quarter_turns(stream.as_ptr()),
            )
        };
        // The size it is meant to be seen at, which is what callers fit.
        let natural = shown_size(coded, aspect, turns);
        let requested = size(natural).unwrap_or(natural);
        let size = (requested.0.max(1), requested.1.max(1));
        // Scaled lying as it was recorded, then turned.
        let lying = if turns % 2 == 1 {
            (size.1, size.0)
        } else {
            size
        };
        let pipeline = Pipeline::start(Conversion::new(lying, turns, stream_time_base, path))?;

        let mut decoder = Self {
            input,
            stream_index,
            time_base,
            decoder,
            size,
            duration_seconds,
            decoded: ff::frame::Video::empty(),
            pipeline,
            in_flight: VecDeque::new(),
            flowing: false,
            drained: false,
            finished: false,
            seek_target: None,
            frame_seconds,
            hardware,
            primed: false,
            last_seconds: None,
            path: path.to_path_buf(),
        };
        decoder.probe_hardware()?;
        Ok(decoder)
    }

    /// Decode the first frame, and move to software if the GPU did not.
    ///
    /// A GPU decoder that cannot take a stream says so in different ways — an
    /// error, no frames at all, or quietly handing FFmpeg's software decoder
    /// the job on one thread — and all three are settled here, at open, rather
    /// than as a stall mid-service.
    fn probe_hardware(&mut self) -> Result<(), VideoError> {
        if self.hardware.is_none() {
            return Ok(());
        }
        let reason = match self.receive() {
            Ok(true) if is_hardware_frame(&self.decoded) => {
                self.primed = true;
                return Ok(());
            }
            Ok(true) => "it decoded the first frame in software".to_owned(),
            Ok(false) => "it produced no frames".to_owned(),
            Err(error) => error.to_string(),
        };
        tracing::info!(
            path = %self.path.display(),
            reason,
            "the GPU decoder did not take this video; decoding it in software"
        );
        self.use_software(0.0)
    }

    /// Reopen the decoder in software and carry on from `seconds`.
    fn use_software(&mut self, seconds: f64) -> Result<(), VideoError> {
        self.hardware = None;
        self.primed = false;
        let parameters = self
            .input
            .stream(self.stream_index)
            .ok_or_else(|| VideoError::Decode("the video stream went away".to_owned()))?
            .parameters();
        self.decoder = open_decoder(parameters, None, &self.path)?;
        self.seek(seconds)
    }

    /// Decode the next frame into `decoded`; `false` at the end.
    fn receive(&mut self) -> Result<bool, VideoError> {
        if self.finished {
            return Ok(false);
        }
        loop {
            match self.decoder.receive_frame(&mut self.decoded) {
                Ok(()) => return Ok(true),
                Err(ff::Error::Other { errno }) if errno == ff::ffi::EAGAIN => {
                    if self.drained {
                        self.finished = true;
                        return Ok(false);
                    }
                    self.feed()?;
                }
                Err(ff::Error::Eof) => {
                    self.finished = true;
                    return Ok(false);
                }
                Err(error) => return Err(decode_error(error)),
            }
        }
    }

    /// The next frame to show, converted. Once frames are flowing, the one
    /// after it is decoded and handed over first, so it decodes while this
    /// one converts; the first after an open or a seek comes as soon as it
    /// can, with nothing decoded ahead of it.
    fn next_converted(&mut self) -> Result<Option<VideoFrame>, VideoError> {
        let ahead = if self.flowing { 2 } else { 1 };
        while self.in_flight.len() < ahead {
            let Some(seconds) = self.decode_next()? else {
                break;
            };
            let frame = std::mem::replace(&mut self.decoded, ff::frame::Video::empty());
            self.pipeline.hand(frame)?;
            self.in_flight.push_back(seconds);
        }
        let Some(seconds) = self.in_flight.pop_front() else {
            return Ok(None);
        };
        let bgra = self.pipeline.take()?;
        self.flowing = true;
        self.last_seconds = Some(seconds);
        Ok(Some(VideoFrame {
            width: self.size.0,
            height: self.size.1,
            bgra,
            presentation_seconds: seconds,
        }))
    }

    /// Decode the next frame to show into `decoded`, those before a seek's
    /// target decoded and dropped, and say when it is. `None` at the end.
    ///
    /// On the way to a target more than [`CATCH_UP_MARGIN`] off, the frames
    /// no other frame is decoded from are not decoded at all — most of a file
    /// with B-frames. A seek decoded every frame from the key frame before it,
    /// seconds of them in a file whose key frames are far apart; the screens
    /// held their last frame all that time. The last stretch is decoded whole,
    /// so the frame asked for is there, whatever kind it is.
    fn decode_next(&mut self) -> Result<Option<f64>, VideoError> {
        loop {
            if !(std::mem::take(&mut self.primed) || self.receive()?) {
                self.skip_unreferenced(false);
                return Ok(None);
            }
            let seconds = self.seconds_of(&self.decoded);
            if let Some(target) = self.seek_target {
                // Within half a frame counts as there.
                if seconds + self.frame_seconds / 2.0 < target {
                    self.skip_unreferenced(seconds + CATCH_UP_MARGIN < target);
                    continue;
                }
                self.skip_unreferenced(false);
                self.seek_target = None;
            }
            return Ok(Some(seconds));
        }
    }

    /// Whether the frames nothing else is decoded from are skipped.
    fn skip_unreferenced(&mut self, skip: bool) {
        self.decoder.skip_frame(if skip {
            ff::codec::discard::Discard::NonReference
        } else {
            ff::codec::discard::Discard::Default
        });
    }

    /// Take back and drop whatever is converting: it is from before a move.
    fn discard_in_flight(&mut self) {
        while self.in_flight.pop_front().is_some() {
            let _ = self.pipeline.take();
        }
        self.flowing = false;
    }

    /// Feed the decoder the next packet of our stream, or tell it the file ended.
    fn feed(&mut self) -> Result<(), VideoError> {
        let mut next = None;
        for (stream, packet) in self.input.packets() {
            if stream.index() == self.stream_index {
                next = Some(packet);
                break;
            }
        }
        match next {
            Some(packet) => match self.decoder.send_packet(&packet) {
                // A damaged packet is skipped, as a player would.
                Ok(()) | Err(ff::Error::InvalidData) => Ok(()),
                Err(error) => Err(decode_error(error)),
            },
            None => {
                self.drained = true;
                self.decoder.send_eof().map_err(decode_error)
            }
        }
    }

    fn seconds_of(&self, frame: &ff::frame::Video) -> f64 {
        frame
            .timestamp()
            .or_else(|| frame.pts())
            .map_or(0.0, |timestamp| timestamp as f64 * self.time_base)
    }
}

// The FFmpeg objects are only touched behind `&mut self`, and the decoder is
// owned by one caller at a time: moved to the read-ahead thread, not shared.
unsafe impl Send for FfmpegVideoDecoder {}

/// `ENOENT`, which FFmpeg reports as a negated errno.
fn libc_enoent() -> i32 {
    2
}

impl VideoDecoder for FfmpegVideoDecoder {
    fn next_frame(&mut self) -> Result<Option<VideoFrame>, VideoError> {
        loop {
            match self.next_converted() {
                Ok(frame) => return Ok(frame),
                // A GPU decoder can give up partway — a stream that changes
                // profile, a device lost to sleep. The video carries on in
                // software from the frame after the last one shown.
                Err(error) if self.hardware.is_some() => {
                    tracing::warn!(
                        path = %self.path.display(),
                        %error,
                        "GPU video decoding failed; carrying on in software"
                    );
                    let resume = self
                        .seek_target
                        .or(self
                            .last_seconds
                            .map(|seconds| seconds + self.frame_seconds / 2.0))
                        .unwrap_or(0.0);
                    self.use_software(resume)?;
                }
                Err(error) => {
                    self.discard_in_flight();
                    return Err(error);
                }
            }
        }
    }

    fn seek(&mut self, seconds: f64) -> Result<(), VideoError> {
        if !seconds.is_finite() || seconds < 0.0 {
            return Err(VideoError::Decode(format!("cannot seek to {seconds}")));
        }
        // What is converting is from before the move.
        self.discard_in_flight();
        // Every frame decoded until the first one says how far there is to go.
        self.skip_unreferenced(false);
        let timestamp = (seconds * f64::from(ff::ffi::AV_TIME_BASE)) as i64;
        // To the key frame at or before the time; the frames between are
        // decoded and dropped in `decode_next`.
        self.input
            .seek(timestamp, i64::MIN..timestamp.saturating_add(1))
            .map_err(decode_error)?;
        self.decoder.flush();
        self.drained = false;
        self.finished = false;
        self.primed = false;
        self.seek_target = Some(seconds);
        Ok(())
    }

    fn duration_seconds(&self) -> Option<f64> {
        self.duration_seconds
    }

    fn dimensions(&self) -> (u32, u32) {
        self.size
    }
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;
    use std::path::PathBuf;

    pub(crate) enum Codec {
        Id(ff::codec::Id),
        /// By encoder name; only the Mac's hardware encoder so far.
        #[cfg_attr(not(target_os = "macos"), allow(dead_code))]
        Named(&'static str),
    }

    /// A clip written for one test, deleted after it.
    pub(crate) struct Clip(pub(crate) PathBuf);

    impl Drop for Clip {
        fn drop(&mut self) {
            let _ = std::fs::remove_file(&self.0);
        }
    }

    pub(crate) struct ClipSpec {
        pub(crate) codec: Codec,
        pub(crate) size: (u32, u32),
        pub(crate) frames: i64,
        pub(crate) fps: i32,
        /// A key frame every this many frames.
        pub(crate) gop: u32,
        pub(crate) space: color::Space,
        pub(crate) range: color::Range,
    }

    /// Write a clip whose frame `i` is filled with `fill(i)` as Y, Cb, Cr.
    /// `None` when this FFmpeg cannot encode `spec.codec`.
    pub(crate) fn write_clip(
        name: &str,
        spec: &ClipSpec,
        fill: impl Fn(i64) -> (u8, u8, u8),
    ) -> Option<Clip> {
        init();
        let codec = match spec.codec {
            Codec::Id(id) => ff::encoder::find(id)?,
            Codec::Named(name) => ff::encoder::find_by_name(name)?,
        };
        let clip = Clip(
            std::env::temp_dir().join(format!("present-ffmpeg-{}-{name}.mkv", std::process::id())),
        );
        let mut output = ff::format::output(&clip.0).expect("an output file");
        let global_header = output
            .format()
            .flags()
            .contains(ff::format::Flags::GLOBAL_HEADER);
        let mut stream = output.add_stream(codec).expect("a stream");
        let mut encoder = ff::codec::context::Context::new_with_codec(codec)
            .encoder()
            .video()
            .expect("a video encoder");
        encoder.set_width(spec.size.0);
        encoder.set_height(spec.size.1);
        encoder.set_format(Pixel::YUV420P);
        encoder.set_time_base((1, spec.fps));
        encoder.set_frame_rate(Some((spec.fps, 1)));
        encoder.set_gop(spec.gop);
        encoder.set_bit_rate(8_000_000);
        encoder.set_colorspace(spec.space);
        encoder.set_color_range(spec.range);
        if global_header {
            encoder.set_flags(ff::codec::Flags::GLOBAL_HEADER);
        }
        let mut encoder = encoder.open_as(codec).expect("the encoder opens");
        stream.set_parameters(&encoder);
        output.write_header().expect("a header");
        let stream_time_base = output.stream(0).expect("the stream").time_base();

        let write_packets = |encoder: &mut ff::encoder::Video,
                             output: &mut ff::format::context::Output| {
            let mut packet = ff::Packet::empty();
            while encoder.receive_packet(&mut packet).is_ok() {
                packet.set_stream(0);
                packet.rescale_ts((1, spec.fps), stream_time_base);
                packet.write_interleaved(output).expect("a packet written");
            }
        };
        for index in 0..spec.frames {
            let (y, cb, cr) = fill(index);
            let mut frame = ff::frame::Video::new(Pixel::YUV420P, spec.size.0, spec.size.1);
            frame.data_mut(0).fill(y);
            frame.data_mut(1).fill(cb);
            frame.data_mut(2).fill(cr);
            frame.set_color_space(spec.space);
            frame.set_color_range(spec.range);
            frame.set_pts(Some(index));
            encoder.send_frame(&frame).expect("a frame encoded");
            write_packets(&mut encoder, &mut output);
        }
        encoder.send_eof().expect("the encoder drains");
        write_packets(&mut encoder, &mut output);
        output.write_trailer().expect("a trailer");
        Some(clip)
    }

    /// A clip whose pixels are `aspect` wide for each high, flagged to be
    /// shown turned by `rotation` degrees as FFmpeg counts them — what a DVD
    /// rip or a phone writes. Its top-left quarter is white and the rest
    /// black, so which way it was turned can be seen.
    fn write_shaped_clip(
        name: &str,
        size: (u32, u32),
        aspect: (i32, i32),
        rotation: Option<f64>,
    ) -> Option<Clip> {
        init();
        let codec = ff::encoder::find(ff::codec::Id::MPEG4)?;
        let clip = Clip(
            std::env::temp_dir().join(format!("present-ffmpeg-{}-{name}.mkv", std::process::id())),
        );
        let mut output = ff::format::output(&clip.0).expect("an output file");
        let global_header = output
            .format()
            .flags()
            .contains(ff::format::Flags::GLOBAL_HEADER);
        let mut stream = output.add_stream(codec).expect("a stream");
        let mut encoder = ff::codec::context::Context::new_with_codec(codec)
            .encoder()
            .video()
            .expect("a video encoder");
        encoder.set_width(size.0);
        encoder.set_height(size.1);
        encoder.set_format(Pixel::YUV420P);
        encoder.set_time_base((1, 10));
        encoder.set_frame_rate(Some((10, 1)));
        encoder.set_aspect_ratio(aspect);
        encoder.set_bit_rate(4_000_000);
        if global_header {
            encoder.set_flags(ff::codec::Flags::GLOBAL_HEADER);
        }
        let mut encoder = encoder.open_as(codec).expect("the encoder opens");
        stream.set_parameters(&encoder);
        // SAFETY: the stream's own parameters, before the header is written.
        unsafe {
            let raw = stream.as_mut_ptr();
            (*raw).sample_aspect_ratio = ff::ffi::AVRational {
                num: aspect.0,
                den: aspect.1,
            };
            if let Some(degrees) = rotation {
                let parameters = (*raw).codecpar;
                let side = ff::ffi::av_packet_side_data_new(
                    &mut (*parameters).coded_side_data,
                    &mut (*parameters).nb_coded_side_data,
                    ff::ffi::AVPacketSideDataType::AV_PKT_DATA_DISPLAYMATRIX,
                    9 * 4,
                    0,
                );
                assert!(!side.is_null(), "room for the rotation");
                ff::ffi::av_display_rotation_set((*side).data.cast::<i32>(), degrees);
            }
        }
        output.write_header().expect("a header");
        let stream_time_base = output.stream(0).expect("the stream").time_base();
        let write_packets = |encoder: &mut ff::encoder::Video,
                             output: &mut ff::format::context::Output| {
            let mut packet = ff::Packet::empty();
            while encoder.receive_packet(&mut packet).is_ok() {
                packet.set_stream(0);
                packet.rescale_ts((1, 10), stream_time_base);
                packet.write_interleaved(output).expect("a packet written");
            }
        };
        for index in 0..5 {
            let mut frame = ff::frame::Video::new(Pixel::YUV420P, size.0, size.1);
            let stride = frame.stride(0);
            for y in 0..size.1 as usize {
                for x in 0..size.0 as usize {
                    let marked = x < size.0 as usize / 2 && y < size.1 as usize / 2;
                    frame.data_mut(0)[y * stride + x] = if marked { 235 } else { 16 };
                }
            }
            frame.data_mut(1).fill(128);
            frame.data_mut(2).fill(128);
            frame.set_pts(Some(index));
            encoder.send_frame(&frame).expect("a frame encoded");
            write_packets(&mut encoder, &mut output);
        }
        encoder.send_eof().expect("the encoder drains");
        write_packets(&mut encoder, &mut output);
        output.write_trailer().expect("a trailer");
        Some(clip)
    }

    /// Whether the pixel at `x`, `y` of a frame is the white marker.
    fn marked(frame: &VideoFrame, x: u32, y: u32) -> bool {
        let index = ((y * frame.width + x) * 4) as usize;
        frame.bgra[index + 1] > 128
    }

    /// The owner's report: a 720x480 video meant to be seen at 16:9 (853x480
    /// in QuickTime) was shown squeezed to 3:2.
    #[test]
    fn pixels_that_are_not_square_are_shown_the_shape_they_are_meant_to_be() {
        let Some(clip) = write_shaped_clip("sar", (72, 48), (32, 27), None) else {
            return;
        };
        let mut decoder = FfmpegVideoDecoder::open_sized(&clip.0, Some).expect("it opens");
        assert_eq!(decoder.dimensions(), (85, 48), "72 x 32/27 is 85 across");
        let frame = decoder.next_frame().unwrap().expect("a frame");
        assert_eq!((frame.width, frame.height), (85, 48));
        // Asked to fit 16:9, it fills it.
        let mut fitted = FfmpegVideoDecoder::open_sized(&clip.0, |natural| {
            Some(crate::services::video::contain_size(natural, (1920, 1080)))
        })
        .expect("it opens");
        assert_eq!(fitted.dimensions(), (1913, 1080));
        assert!(fitted.next_frame().unwrap().is_some());
    }

    /// A phone's portrait video, kept lying on its side with a flag to stand
    /// it up, is shown standing — and turned the right way, as FFmpeg's own
    /// player turns it (`av_display_rotation_set` takes the angle clockwise,
    /// and a phone's reads as -90 in ffprobe).
    #[test]
    fn a_video_flagged_to_be_turned_is_shown_turned() {
        // Where the top-left quarter lands, as (left, top).
        let cases = [
            ("phone", 90.0, (32, 64), (false, true)),
            ("other-way", -90.0, (32, 64), (true, false)),
            ("upside-down", 180.0, (64, 32), (false, false)),
        ];
        for (name, degrees, size, (left, top)) in cases {
            let Some(clip) = write_shaped_clip(name, (64, 32), (1, 1), Some(degrees)) else {
                return;
            };
            let mut decoder = FfmpegVideoDecoder::open_sized(&clip.0, Some).expect("it opens");
            if name == "phone" && decoder.dimensions() == (64, 32) {
                // This FFmpeg's Matroska did not keep the flag: nothing to check.
                return;
            }
            assert_eq!(decoder.dimensions(), size, "{name}");
            let frame = decoder.next_frame().unwrap().expect("a frame");
            let (width, height) = (frame.width, frame.height);
            let x = if left { 4 } else { width - 4 };
            let y = if top { 4 } else { height - 4 };
            assert!(
                marked(&frame, x, y),
                "{name}: the marked quarter at ({x}, {y})"
            );
            assert!(
                !marked(&frame, width - 1 - x, height - 1 - y),
                "{name}: and not across from it"
            );
        }
    }

    #[test]
    fn the_shown_size_squares_the_pixels_then_stands_the_picture_up() {
        assert_eq!(shown_size((720, 480), 32.0 / 27.0, 0), (853, 480));
        assert_eq!(shown_size((1920, 1080), 1.0, 1), (1080, 1920));
        assert_eq!(shown_size((1920, 1080), 1.0, 2), (1920, 1080));
        assert_eq!(shown_size((720, 480), 32.0 / 27.0, 3), (480, 853));
    }

    #[test]
    fn a_frame_is_turned_a_quarter_a_half_and_three_quarters() {
        // 3 x 2, each pixel numbered in its blue byte.
        let numbered: Vec<u8> = (0..6u8).flat_map(|n| [n, 0, 0, 255]).collect();
        let blues = |bgra: &[u8]| bgra.chunks(4).map(|pixel| pixel[0]).collect::<Vec<_>>();
        // 0 1 2      3 0
        // 3 4 5  ->  4 1
        //            5 2
        assert_eq!(blues(&turn_bgra(&numbered, (3, 2), 1)), [3, 0, 4, 1, 5, 2]);
        assert_eq!(blues(&turn_bgra(&numbered, (3, 2), 2)), [5, 4, 3, 2, 1, 0]);
        assert_eq!(blues(&turn_bgra(&numbered, (3, 2), 3)), [2, 5, 1, 4, 0, 3]);
    }

    /// Y'CbCr to R'G'B', as the standards write it.
    fn expected_rgb(y: u8, cb: u8, cr: u8, bt709: bool, full_range: bool) -> [f64; 3] {
        let (kr, kb) = if bt709 {
            (0.2126, 0.0722)
        } else {
            (0.299, 0.114)
        };
        let (luma, chroma) = if full_range {
            (f64::from(y) / 255.0, 1.0 / 255.0)
        } else {
            ((f64::from(y) - 16.0) / 219.0, 1.0 / 224.0)
        };
        let pb = (f64::from(cb) - 128.0) * chroma;
        let pr = (f64::from(cr) - 128.0) * chroma;
        let r = luma + 2.0 * (1.0 - kr) * pr;
        let b = luma + 2.0 * (1.0 - kb) * pb;
        let g = (luma - kr * r - kb * b) / (1.0 - kr - kb);
        [r, g, b].map(|value| (value * 255.0).clamp(0.0, 255.0))
    }

    /// The centre pixel as R, G, B.
    fn centre(frame: &VideoFrame) -> [u8; 3] {
        let index = ((frame.height / 2 * frame.width + frame.width / 2) * 4) as usize;
        let pixel = &frame.bgra[index..index + 4];
        [pixel[2], pixel[1], pixel[0]]
    }

    fn assert_close(actual: [u8; 3], expected: [f64; 3], what: &str) {
        for (channel, (a, e)) in actual.iter().zip(expected).enumerate() {
            assert!(
                (f64::from(*a) - e).abs() <= 3.0,
                "{what}: channel {channel} is {a}, expected {e:.1} (all {actual:?} vs {expected:?})"
            );
        }
    }

    /// A colour whose BT.601 and BT.709 readings are 10 levels apart.
    const COLOUR: (u8, u8, u8) = (100, 100, 180);

    fn lossless(size: (u32, u32), space: color::Space, range: color::Range) -> ClipSpec {
        ClipSpec {
            codec: Codec::Id(ff::codec::Id::FFV1),
            size,
            frames: 3,
            fps: 30,
            gop: 1,
            space,
            range,
        }
    }

    fn first_frame_centre(clip: &Clip, size: (u32, u32)) -> [u8; 3] {
        let mut decoder =
            FfmpegVideoDecoder::open_sized(&clip.0, |_| Some(size)).expect("the clip opens");
        let frame = decoder
            .next_frame()
            .expect("it decodes")
            .expect("a first frame");
        assert_eq!((frame.width, frame.height), size);
        assert_eq!(frame.bgra.len(), (size.0 * size.1 * 4) as usize);
        centre(&frame)
    }

    #[test]
    fn hd_that_declares_nothing_decodes_as_bt709() {
        let spec = lossless(
            (1280, 720),
            color::Space::Unspecified,
            color::Range::Unspecified,
        );
        let Some(clip) = write_clip("hd-undeclared", &spec, |_| COLOUR) else {
            return;
        };
        let (y, cb, cr) = COLOUR;
        assert_close(
            first_frame_centre(&clip, (1280, 720)),
            expected_rgb(y, cb, cr, true, false),
            "untagged 720p",
        );
    }

    #[test]
    fn sd_that_declares_nothing_decodes_as_bt601() {
        let spec = lossless(
            (640, 480),
            color::Space::Unspecified,
            color::Range::Unspecified,
        );
        let Some(clip) = write_clip("sd-undeclared", &spec, |_| COLOUR) else {
            return;
        };
        let (y, cb, cr) = COLOUR;
        assert_close(
            first_frame_centre(&clip, (640, 480)),
            expected_rgb(y, cb, cr, false, false),
            "untagged 480p",
        );
    }

    #[test]
    fn a_declared_matrix_and_range_are_followed_and_scaling_keeps_colour() {
        let spec = lossless((1280, 720), color::Space::BT470BG, color::Range::JPEG);
        let Some(clip) = write_clip("hd-declared", &spec, |_| COLOUR) else {
            return;
        };
        let (y, cb, cr) = COLOUR;
        assert_close(
            first_frame_centre(&clip, (640, 360)),
            expected_rgb(y, cb, cr, false, true),
            "BT.601 full range, scaled to half",
        );
    }

    /// Frame `i` of the seek clip: its index in the luma, five levels a frame.
    ///
    /// Five, because swscale's fast same-size conversion rounds down: a level
    /// low with FFmpeg's assembly, two without it.
    fn numbered(index: i64) -> (u8, u8, u8) {
        (20 + (index as u8) * 5, 128, 128)
    }

    /// Which frame a decoded one is, read back from its grey level.
    fn frame_number(frame: &VideoFrame) -> i64 {
        let grey = f64::from(centre(frame)[1]);
        let luma = grey * 219.0 / 255.0 + 16.0;
        ((luma - 20.0) / 5.0).round() as i64
    }

    fn seek_clip(codec: Codec) -> ClipSpec {
        ClipSpec {
            codec,
            size: (640, 360),
            frames: 40,
            fps: 30,
            gop: 12,
            space: color::Space::BT709,
            range: color::Range::MPEG,
        }
    }

    #[test]
    fn seeking_lands_on_the_frame_asked_for_between_key_frames() {
        let spec = seek_clip(Codec::Id(ff::codec::Id::MPEG4));
        if let Some(clip) = write_clip("seek", &spec, numbered) {
            check_seeking(&clip);
        }
    }

    /// H.264 from the Mac's own encoder, with B-frames, which is what the GPU
    /// decoder takes: the same checks on that path. A Mac without the GPU
    /// decoder (a CI virtual machine) runs them in software instead.
    #[cfg(target_os = "macos")]
    #[test]
    fn seeking_h264_lands_on_the_frame_asked_for() {
        let spec = seek_clip(Codec::Named("h264_videotoolbox"));
        if let Some(clip) = write_clip("seek-h264", &spec, numbered) {
            check_seeking(&clip);
        }
    }

    /// A seek far from the key frame before it skips, on the way, the frames
    /// nothing else is decoded from — and still lands on the frame asked for,
    /// B-frame or not, and plays on from it.
    #[cfg(target_os = "macos")]
    #[test]
    fn seeking_far_from_a_key_frame_skips_on_the_way_and_lands_exactly() {
        let spec = ClipSpec {
            codec: Codec::Named("h264_videotoolbox"),
            size: (640, 360),
            frames: 45,
            fps: 10,
            gop: 30,
            space: color::Space::BT709,
            range: color::Range::MPEG,
        };
        let Some(clip) = write_clip("seek-far-h264", &spec, numbered) else {
            return;
        };
        let mut decoder = FfmpegVideoDecoder::open_sized(&clip.0, Some).expect("it opens");
        for target in [25, 7, 29, 12, 40, 26] {
            let seconds = f64::from(target) / 10.0;
            decoder.seek(seconds).unwrap();
            let frame = decoder.next_frame().unwrap().expect("a frame");
            assert_eq!(
                i64::from(target),
                frame_number(&frame),
                "the frame at {seconds} s"
            );
            let next = decoder.next_frame().unwrap().expect("the one after");
            assert_eq!(
                i64::from(target) + 1,
                frame_number(&next),
                "after {seconds} s"
            );
        }
    }

    /// A GPU frame larger than wanted is shrunk on the GPU, and keeps its
    /// colour through that — including to an odd size, which the GPU cannot
    /// make and the CPU finishes.
    #[cfg(target_os = "macos")]
    #[test]
    fn a_frame_shrunk_on_the_gpu_keeps_its_colour() {
        let spec = ClipSpec {
            codec: Codec::Named("h264_videotoolbox"),
            size: (1280, 720),
            frames: 10,
            fps: 30,
            gop: 5,
            space: color::Space::BT709,
            range: color::Range::MPEG,
        };
        let Some(clip) = write_clip("shrink-h264", &spec, |_| COLOUR) else {
            return;
        };
        let (y, cb, cr) = COLOUR;
        for size in [(640, 360), (639, 359)] {
            let mut decoder =
                FfmpegVideoDecoder::open_sized(&clip.0, |_| Some(size)).expect("it opens");
            let frame = decoder.next_frame().unwrap().expect("a frame");
            assert_eq!((frame.width, frame.height), size);
            assert_close(
                centre(&frame),
                expected_rgb(y, cb, cr, true, false),
                &format!("H.264 shrunk to {size:?}"),
            );
            if decoder.hardware.is_some() {
                assert!(
                    decoder.pipeline.shrunk_on_gpu.load(Ordering::Relaxed),
                    "decoded on the GPU, so shrunk there too"
                );
            }
        }
    }

    fn check_seeking(clip: &Clip) {
        let mut decoder = FfmpegVideoDecoder::open_sized(&clip.0, Some).expect("it opens");
        eprintln!(
            "{}: decoding on the {}",
            clip.0.display(),
            if decoder.hardware.is_some() {
                "GPU"
            } else {
                "CPU"
            }
        );
        let duration = decoder.duration_seconds().expect("a duration");
        assert!((duration - 40.0 / 30.0).abs() < 0.1, "duration {duration}");

        let first = decoder.next_frame().unwrap().expect("a first frame");
        assert_eq!(first.presentation_seconds, 0.0);
        assert_eq!(frame_number(&first), 0);

        // Frame 17 sits five after the key frame at 12.
        for (seconds, expected) in [(17.0 / 30.0, 17), (1.0, 30), (0.1, 3)] {
            decoder.seek(seconds).expect("a seek");
            let frame = decoder
                .next_frame()
                .unwrap()
                .expect("a frame after the seek");
            assert!(
                (frame.presentation_seconds - seconds).abs() < 1.0 / 60.0,
                "asked for {seconds}, landed on {}",
                frame.presentation_seconds
            );
            assert_eq!(frame_number(&frame), expected, "the picture at {seconds}");
            let next = decoder.next_frame().unwrap().expect("the frame after");
            assert_eq!(frame_number(&next), expected + 1);
        }
    }

    #[test]
    fn the_end_stays_the_end_until_a_seek_starts_again() {
        let spec = ClipSpec {
            codec: Codec::Id(ff::codec::Id::MPEG4),
            size: (320, 180),
            frames: 10,
            fps: 30,
            gop: 5,
            space: color::Space::BT709,
            range: color::Range::MPEG,
        };
        let Some(clip) = write_clip("end", &spec, numbered) else {
            return;
        };
        let mut decoder = FfmpegVideoDecoder::open_sized(&clip.0, Some).expect("it opens");
        let mut count = 0;
        while decoder.next_frame().unwrap().is_some() {
            count += 1;
        }
        assert_eq!(count, 10);
        assert!(decoder.next_frame().unwrap().is_none());
        assert!(decoder.next_frame().unwrap().is_none());

        // A loop goes back to the start.
        decoder.seek(0.0).unwrap();
        let frame = decoder
            .next_frame()
            .unwrap()
            .expect("the first frame again");
        assert_eq!(frame_number(&frame), 0);
    }

    #[test]
    fn nv12_splits_into_planar_yuv_at_an_odd_size() {
        init();
        let (width, height) = (5, 3);
        let mut nv12 = ff::frame::Video::new(Pixel::NV12, width, height);
        let luma_stride = nv12.stride(0);
        for row in 0..3 {
            for column in 0..5 {
                nv12.data_mut(0)[row * luma_stride + column] = (row * 10 + column) as u8;
            }
        }
        let chroma_stride = nv12.stride(1);
        for row in 0..2 {
            for column in 0..3 {
                let at = row * chroma_stride + column * 2;
                nv12.data_mut(1)[at] = (100 + row * 10 + column) as u8;
                nv12.data_mut(1)[at + 1] = (200 + row * 10 + column) as u8;
            }
        }
        nv12.set_color_space(color::Space::BT709);

        let mut planar = ff::frame::Video::empty();
        split_nv12(&nv12, &mut planar).expect("it splits");
        assert_eq!(planar.format(), Pixel::YUV420P);
        assert_eq!(planar.color_space(), color::Space::BT709);
        let (y, u, v) = (planar.stride(0), planar.stride(1), planar.stride(2));
        for row in 0..3 {
            for column in 0..5 {
                assert_eq!(planar.data(0)[row * y + column], (row * 10 + column) as u8);
            }
        }
        for row in 0..2 {
            for column in 0..3 {
                assert_eq!(
                    planar.data(1)[row * u + column],
                    (100 + row * 10 + column) as u8
                );
                assert_eq!(
                    planar.data(2)[row * v + column],
                    (200 + row * 10 + column) as u8
                );
            }
        }
    }

    #[test]
    fn the_licence_check_tells_lgpl_from_gpl() {
        assert!(is_lgpl("LGPL version 2.1 or later"));
        assert!(!is_lgpl("GPL version 2 or later"));
        assert!(!is_lgpl("nonfree and unredistributable"));
    }

    /// Run with `PRESENT_EXPECT_LGPL_FFMPEG=1` against the build that ships, to
    /// prove the tests ran against it and not a system FFmpeg.
    #[test]
    fn the_ffmpeg_in_use_is_the_expected_one() {
        init();
        let (version, license) = library();
        assert!(!version.is_empty());
        if std::env::var_os("PRESENT_EXPECT_LGPL_FFMPEG").is_some() {
            assert!(is_lgpl(license), "FFmpeg {version} is {license}");
        }
    }

    #[test]
    fn a_missing_file_is_not_found() {
        let missing = std::env::temp_dir().join("present-ffmpeg-no-such-file.mp4");
        assert!(matches!(
            FfmpegVideoDecoder::open_sized(&missing, |_| None),
            Err(VideoError::NotFound(_))
        ));
    }

    #[test]
    fn an_undeclared_matrix_is_bt709_for_hd_and_bt601_below() {
        assert_eq!(
            effective_color_space(color::Space::Unspecified, 1080),
            color::Space::BT709
        );
        assert_eq!(
            effective_color_space(color::Space::Unspecified, 720),
            color::Space::BT709
        );
        assert_eq!(
            effective_color_space(color::Space::Unspecified, 576),
            color::Space::BT470BG
        );
        assert_eq!(
            effective_color_space(color::Space::BT470BG, 2160),
            color::Space::BT470BG,
            "a declared one wins"
        );
    }

    #[test]
    fn range_is_limited_unless_declared_or_a_jpeg_format() {
        assert!(!is_full_range(color::Range::Unspecified, Pixel::YUV420P));
        assert!(is_full_range(color::Range::Unspecified, Pixel::YUVJ422P));
        assert!(is_full_range(color::Range::JPEG, Pixel::YUV420P));
        assert!(
            !is_full_range(color::Range::MPEG, Pixel::YUVJ420P),
            "a declared one wins"
        );
    }
}
