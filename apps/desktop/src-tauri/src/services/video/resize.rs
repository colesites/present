//! A decoded frame made smaller, for a picture that shows the video smaller
//! than the size it was decoded at (`live.rs`).
//!
//! The live video is decoded once, at the largest size any picture of it asks
//! for. The operator's preview and the center pane show it a fraction of that
//! size, and the compositor copies a frame of the right size where it would
//! resample one of the wrong size slowly, so each of them shrinks its frame
//! here first — once a size, shared by every picture that size (`live.rs`).
//!
//! **swscale's fast bilinear, on one core.** Measured on the owner's 2018
//! MacBook Pro, 1080p to 960x540 (`examples/live_share_probe`): plain bilinear
//! with full chroma 9.1 ms, plain bilinear 9.6 ms, area 5.1 ms, fast bilinear
//! 4.0 ms. An average of each box of pixels in Rust, across every core, was
//! 3 ms of waiting but ten times the processor time, which is what counts
//! with a dozen other threads drawing. For a picture a few inches across the
//! difference between the filters does not show.

use std::ptr;

use ff::format::Pixel;
use ff::software::scaling;
use ffmpeg_next as ff;

use super::VideoFrame;

/// A scaler from BGRA to smaller BGRA, kept between frames of one size.
pub struct Resizer {
    context: *mut ff::ffi::SwsContext,
    /// The sizes the context was made for: from, to.
    sizes: Option<((u32, u32), (u32, u32))>,
}

// SAFETY: the context is only used through `&mut self`, so never from two
// threads at once, and swscale keeps no thread-local state.
unsafe impl Send for Resizer {}

impl Default for Resizer {
    fn default() -> Self {
        Self::new()
    }
}

impl Resizer {
    pub fn new() -> Self {
        Self {
            context: ptr::null_mut(),
            sizes: None,
        }
    }

    /// `frame` at `size`. `None` if either is empty, or the scaler refuses.
    pub fn resize(&mut self, frame: &VideoFrame, size: (u32, u32)) -> Option<VideoFrame> {
        if !frame.is_well_formed() || size.0 == 0 || size.1 == 0 {
            return None;
        }
        let from = (frame.width, frame.height);
        if from == size {
            return Some(frame.clone());
        }
        if self.sizes != Some((from, size)) {
            self.rebuild(from, size)?;
        }

        let mut bgra = vec![0u8; size.0 as usize * size.1 as usize * 4];
        let source = [frame.bgra.as_ptr(), ptr::null(), ptr::null(), ptr::null()];
        let source_stride = [frame.width as i32 * 4, 0, 0, 0];
        let destination = [
            bgra.as_mut_ptr(),
            ptr::null_mut(),
            ptr::null_mut(),
            ptr::null_mut(),
        ];
        let destination_stride = [size.0 as i32 * 4, 0, 0, 0];
        // SAFETY: the context was made for exactly these two sizes and BGRA
        // on both sides; the source holds `height` rows of `width * 4` bytes
        // (`is_well_formed`) and the destination was allocated for `size`.
        let rows = unsafe {
            ff::ffi::sws_scale(
                self.context,
                source.as_ptr(),
                source_stride.as_ptr(),
                0,
                frame.height as i32,
                destination.as_ptr(),
                destination_stride.as_ptr(),
            )
        };
        (rows > 0).then_some(VideoFrame {
            width: size.0,
            height: size.1,
            bgra,
            presentation_seconds: frame.presentation_seconds,
        })
    }

    fn rebuild(&mut self, from: (u32, u32), to: (u32, u32)) -> Option<()> {
        self.free();
        // SAFETY: a fresh context, configured through its options, and freed on
        // failure or drop — the same steps as the decoder's own scaler.
        unsafe {
            let mut context = ff::ffi::sws_alloc_context();
            if context.is_null() {
                return None;
            }
            let format: ff::ffi::AVPixelFormat = Pixel::BGRA.into();
            let options: [(&std::ffi::CStr, i64); 8] = [
                (c"srcw", i64::from(from.0)),
                (c"srch", i64::from(from.1)),
                (c"src_format", format as i64),
                (c"dstw", i64::from(to.0)),
                (c"dsth", i64::from(to.1)),
                (c"dst_format", format as i64),
                (
                    c"sws_flags",
                    i64::from(scaling::Flags::FAST_BILINEAR.bits()),
                ),
                (c"threads", 1),
            ];
            for (name, value) in options {
                if ff::ffi::av_opt_set_int(context.cast(), name.as_ptr(), value, 0) < 0 {
                    ff::ffi::sws_free_context(&mut context);
                    return None;
                }
            }
            if ff::ffi::sws_init_context(context, ptr::null_mut(), ptr::null_mut()) < 0 {
                ff::ffi::sws_free_context(&mut context);
                return None;
            }
            self.context = context;
        }
        self.sizes = Some((from, to));
        Some(())
    }

    fn free(&mut self) {
        if !self.context.is_null() {
            // SAFETY: created by `sws_alloc_context`; nulled by the call.
            unsafe { ff::ffi::sws_free_context(&mut self.context) };
        }
        self.sizes = None;
    }
}

impl Drop for Resizer {
    fn drop(&mut self) {
        self.free();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn solid(width: u32, height: u32, bgra: [u8; 4], seconds: f64) -> VideoFrame {
        VideoFrame {
            width,
            height,
            bgra: bgra.repeat(width as usize * height as usize),
            presentation_seconds: seconds,
        }
    }

    fn close_to(pixel: &[u8], colour: [u8; 4]) -> bool {
        pixel
            .iter()
            .zip(colour)
            .all(|(got, wanted)| got.abs_diff(wanted) <= 3)
    }

    #[test]
    fn a_frame_made_smaller_keeps_its_colour_and_its_moment() {
        super::super::ffmpeg::init();
        let mut resizer = Resizer::new();
        let colour = [40, 120, 200, 255];
        let small = resizer
            .resize(&solid(64, 36, colour, 1.5), (32, 18))
            .expect("resized");
        assert!(small.is_well_formed());
        assert_eq!((small.width, small.height), (32, 18));
        assert_eq!(small.presentation_seconds, 1.5);
        let centre = &small.bgra[(9 * 32 + 16) * 4..][..4];
        assert!(close_to(centre, colour), "{centre:?} against {colour:?}");
        // Again at a size that does not divide evenly, through a scaler made
        // for that one.
        let smaller = resizer
            .resize(&solid(64, 36, colour, 2.0), (21, 11))
            .expect("resized again");
        assert_eq!((smaller.width, smaller.height), (21, 11));
        let centre = &smaller.bgra[(5 * 21 + 10) * 4..][..4];
        assert!(close_to(centre, colour), "{centre:?} against {colour:?}");
    }

    #[test]
    fn nothing_comes_of_an_empty_frame_or_an_empty_size() {
        super::super::ffmpeg::init();
        let mut resizer = Resizer::new();
        assert!(resizer.resize(&solid(4, 4, [0; 4], 0.0), (0, 2)).is_none());
        let broken = VideoFrame {
            bgra: vec![0; 3],
            ..solid(4, 4, [0; 4], 0.0)
        };
        assert!(resizer.resize(&broken, (2, 2)).is_none());
    }
}
