//! Shrinking a decoded frame on the GPU before it is copied off (macOS).
//!
//! Copying a 4K frame off the GPU and shrinking it on the CPU cost most of the
//! 33 ms a 30 fps stream has, and with the compositor wanting the same cores
//! the NDI stream fell to under 2 fps (ADR-003). FFmpeg's `scale_vt` shrinks the
//! frame where it already is, so the copy is a quarter of the size and the CPU
//! is left converting colour at the size it will be shown.
//!
//! The scaling is YUV to YUV. The colour rules stay in one place, the CPU
//! conversion in `ffmpeg.rs`.

use std::ffi::CString;
use std::ptr;

use ff::ffi;
use ffmpeg_next as ff;

/// What a graph was built for.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct Shape {
    input: (i32, i32),
    /// The decoder's frames context, by address: a new one needs a new graph.
    frames: usize,
    output: (u32, u32),
}

/// A `buffer → scale_vt → buffersink` graph.
pub struct GpuScaler {
    graph: *mut ffi::AVFilterGraph,
    source: *mut ffi::AVFilterContext,
    sink: *mut ffi::AVFilterContext,
    shape: Shape,
}

fn check(result: i32, what: &str) -> Result<(), String> {
    if result < 0 {
        Err(format!("{what}: {}", ff::Error::from(result)))
    } else {
        Ok(())
    }
}

fn shape_of(frame: &ff::frame::Video, output: (u32, u32)) -> Shape {
    // SAFETY: reading two fields of a valid frame.
    let (input, frames) = unsafe {
        let raw = frame.as_ptr();
        let frames = (*raw).hw_frames_ctx;
        (
            ((*raw).width, (*raw).height),
            if frames.is_null() {
                0
            } else {
                (*frames).data as usize
            },
        )
    };
    Shape {
        input,
        frames,
        output,
    }
}

impl GpuScaler {
    /// A graph that shrinks GPU frames like `frame` to `output`.
    pub fn new(
        frame: &ff::frame::Video,
        time_base: ff::Rational,
        output: (u32, u32),
    ) -> Result<Self, String> {
        let shape = shape_of(frame, output);
        if shape.frames == 0 {
            return Err("the frame has no GPU frames context".to_owned());
        }
        // SAFETY: every pointer is checked before use; the graph owns the
        // filters, and `Drop` frees it on any early return.
        unsafe {
            let mut scaler = Self {
                graph: ffi::avfilter_graph_alloc(),
                source: ptr::null_mut(),
                sink: ptr::null_mut(),
                shape,
            };
            if scaler.graph.is_null() {
                return Err("could not allocate a filter graph".to_owned());
            }
            let find = |name: &std::ffi::CStr| {
                let filter = ffi::avfilter_get_by_name(name.as_ptr());
                if filter.is_null() {
                    Err(format!("this FFmpeg has no {}", name.to_string_lossy()))
                } else {
                    Ok(filter)
                }
            };

            // The source is told about the GPU frames before it is initialised,
            // as FFmpeg asks.
            scaler.source =
                ffi::avfilter_graph_alloc_filter(scaler.graph, find(c"buffer")?, c"in".as_ptr());
            if scaler.source.is_null() {
                return Err("could not create the buffer source".to_owned());
            }
            let raw = frame.as_ptr();
            let parameters = ffi::av_buffersrc_parameters_alloc();
            if parameters.is_null() {
                return Err("could not allocate the source parameters".to_owned());
            }
            (*parameters).format = (*raw).format;
            (*parameters).width = (*raw).width;
            (*parameters).height = (*raw).height;
            (*parameters).time_base = time_base.into();
            (*parameters).sample_aspect_ratio = ffi::AVRational { num: 1, den: 1 };
            (*parameters).hw_frames_ctx = (*raw).hw_frames_ctx;
            let result = ffi::av_buffersrc_parameters_set(scaler.source, parameters);
            ffi::av_free(parameters.cast());
            check(result, "the buffer source refused the frame")?;
            check(
                ffi::avfilter_init_str(scaler.source, ptr::null()),
                "the buffer source would not start",
            )?;

            let mut scale = ptr::null_mut();
            let arguments =
                CString::new(format!("w={}:h={}", output.0, output.1)).expect("digits have no NUL");
            check(
                ffi::avfilter_graph_create_filter(
                    &mut scale,
                    find(c"scale_vt")?,
                    c"scale".as_ptr(),
                    arguments.as_ptr(),
                    ptr::null_mut(),
                    scaler.graph,
                ),
                "scale_vt would not start",
            )?;
            check(
                ffi::avfilter_graph_create_filter(
                    &mut scaler.sink,
                    find(c"buffersink")?,
                    c"out".as_ptr(),
                    ptr::null(),
                    ptr::null_mut(),
                    scaler.graph,
                ),
                "the buffer sink would not start",
            )?;
            check(
                ffi::avfilter_link(scaler.source, 0, scale, 0),
                "could not link the source",
            )?;
            check(
                ffi::avfilter_link(scale, 0, scaler.sink, 0),
                "could not link the sink",
            )?;
            check(
                ffi::avfilter_graph_config(scaler.graph, ptr::null_mut()),
                "the graph would not configure",
            )?;
            Ok(scaler)
        }
    }

    /// Whether this graph takes `frame` to `output`.
    pub fn fits(&self, frame: &ff::frame::Video, output: (u32, u32)) -> bool {
        self.shape == shape_of(frame, output)
    }

    /// Shrink `frame` into `scaled`, which stays on the GPU.
    pub fn scale(
        &mut self,
        frame: &mut ff::frame::Video,
        scaled: &mut ff::frame::Video,
    ) -> Result<(), String> {
        // SAFETY: the graph is configured for frames of this shape (`fits`);
        // the source keeps its own reference to the frame.
        unsafe {
            check(
                ffi::av_buffersrc_add_frame_flags(
                    self.source,
                    frame.as_mut_ptr(),
                    ffi::AV_BUFFERSRC_FLAG_KEEP_REF as i32,
                ),
                "the GPU scaler refused a frame",
            )?;
            ffi::av_frame_unref(scaled.as_mut_ptr());
            check(
                ffi::av_buffersink_get_frame(self.sink, scaled.as_mut_ptr()),
                "the GPU scaler returned no frame",
            )
        }
    }
}

impl Drop for GpuScaler {
    fn drop(&mut self) {
        // SAFETY: allocated by `avfilter_graph_alloc`, and it frees its filters.
        unsafe { ffi::avfilter_graph_free(&mut self.graph) };
    }
}

/// The size to shrink to on the GPU: `output` with even sides, which NV12
/// needs. The CPU scaler covers the last pixel when `output` is odd.
pub fn gpu_size(output: (u32, u32)) -> (u32, u32) {
    ((output.0 + 1) & !1, (output.1 + 1) & !1)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_gpu_size_is_even() {
        assert_eq!(gpu_size((1920, 1080)), (1920, 1080));
        assert_eq!(gpu_size((1439, 1079)), (1440, 1080));
    }
}
