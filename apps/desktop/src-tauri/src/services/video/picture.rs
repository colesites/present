//! A decoded frame left where the GPU decoder put it.
//!
//! On macOS VideoToolbox decodes into an IOSurface: memory the window server
//! and the GPU read as it is. Every frame used to be copied out of it, split,
//! converted to BGRA on the processor and copied again before Core Animation
//! was handed a picture — and then copied once more for each window. Core
//! Animation shows the decoder's own YUV surface directly, converting colour
//! on the GPU as it composites, so a screen that shows the video as it is
//! needs none of that (`surface::layers`).
//!
//! **Colour is tagged to match the processor's conversion exactly.** Core
//! Animation reads the matrix, primaries and transfer function from the
//! surface. Left untagged it treats HD as SD; tagged with the BT.709 transfer
//! function it lifts mid-greys by about five percent (128 became 140),
//! QuickTime's long-standing gamma shift. The processor's conversion applies
//! the matrix and treats the result as sRGB, so the surface is tagged with the
//! same matrix (`ffmpeg::effective_color_space`), BT.709 primaries and the sRGB
//! transfer function. Measured on the owner's MacBook Pro: every patch of a
//! test chart within one level of the processor's picture.
//!
//! Anything that still needs the pixels in memory (NDI, a screen mid
//! transition, the composer's regions) converts a picture once per size it
//! needs (`Resizer::convert_picture`), from the same frame.

use std::fmt;

use ff::util::color;
use ffmpeg_next as ff;

/// A decoded frame still on the GPU, shared by everything that shows it.
pub struct GpuPicture {
    /// A reference of its own to the decoder's hardware frame. Holding it
    /// keeps the surface from being decoded into again.
    frame: ff::frame::Video,
    /// The surface's own size, which may differ from the size it is shown at.
    size: (u32, u32),
    space: color::Space,
    full_range: bool,
}

// SAFETY: the frame is never written after it is made; FFmpeg's buffer
// references are atomically counted, and an IOSurface is usable from any
// thread.
unsafe impl Send for GpuPicture {}
unsafe impl Sync for GpuPicture {}

impl fmt::Debug for GpuPicture {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("GpuPicture")
            .field("size", &self.size)
            .field("space", &self.space)
            .field("full_range", &self.full_range)
            .finish()
    }
}

/// Two pictures are the same picture only if they are the same frame.
impl PartialEq for GpuPicture {
    fn eq(&self, other: &Self) -> bool {
        std::ptr::eq(self, other)
    }
}

impl GpuPicture {
    /// A reference to `frame`, which must be a hardware frame, with the colour
    /// it is to be shown in. `None` if FFmpeg could not take a reference.
    pub(super) fn new(
        frame: &ff::frame::Video,
        space: color::Space,
        full_range: bool,
    ) -> Option<Self> {
        let mut held = ff::frame::Video::empty();
        // SAFETY: both frames are valid; this takes a new reference to the
        // same buffers, released when `held` is dropped.
        let result = unsafe { ff::ffi::av_frame_ref(held.as_mut_ptr(), frame.as_ptr()) };
        if result < 0 {
            return None;
        }
        let picture = Self {
            size: (held.width(), held.height()),
            frame: held,
            space,
            full_range,
        };
        #[cfg(target_os = "macos")]
        picture.tag_colour();
        Some(picture)
    }

    /// The surface's size in pixels.
    pub fn size(&self) -> (u32, u32) {
        self.size
    }

    /// The hardware frame, for copying off the GPU.
    pub(super) fn hardware_frame(&self) -> &ff::frame::Video {
        &self.frame
    }
}

#[cfg(target_os = "macos")]
mod mac {
    use std::ffi::c_void;
    use std::ptr::NonNull;

    use objc2_core_foundation::CFString;
    use objc2_io_surface::IOSurfaceRef;

    use super::{color, GpuPicture};

    /// `kCVAttachmentMode_ShouldPropagate`: copied to the surface, which is
    /// where Core Animation reads it.
    const SHOULD_PROPAGATE: u32 = 1;

    #[link(name = "CoreVideo", kind = "framework")]
    extern "C" {
        static kCVImageBufferYCbCrMatrixKey: &'static CFString;
        static kCVImageBufferYCbCrMatrix_ITU_R_709_2: &'static CFString;
        static kCVImageBufferYCbCrMatrix_ITU_R_601_4: &'static CFString;
        static kCVImageBufferYCbCrMatrix_ITU_R_2020: &'static CFString;
        static kCVImageBufferYCbCrMatrix_SMPTE_240M_1995: &'static CFString;
        static kCVImageBufferColorPrimariesKey: &'static CFString;
        static kCVImageBufferColorPrimaries_ITU_R_709_2: &'static CFString;
        static kCVImageBufferTransferFunctionKey: &'static CFString;
        static kCVImageBufferTransferFunction_sRGB: &'static CFString;
        fn CVBufferSetAttachment(buffer: *mut c_void, key: &CFString, value: &CFString, mode: u32);
        fn CVPixelBufferGetIOSurface(buffer: *mut c_void) -> Option<NonNull<IOSurfaceRef>>;
    }

    impl GpuPicture {
        /// The decoder's `CVPixelBuffer`: a VideoToolbox frame keeps it in
        /// its fourth data pointer.
        fn pixel_buffer(&self) -> *mut c_void {
            // SAFETY: reading a field of a valid frame.
            unsafe { (*self.frame.as_ptr()).data[3].cast() }
        }

        /// The surface the picture is in, for a layer's contents. Valid while
        /// this picture is.
        pub fn io_surface(&self) -> Option<&IOSurfaceRef> {
            let buffer = self.pixel_buffer();
            if buffer.is_null() {
                return None;
            }
            // SAFETY: a VideoToolbox frame's buffer is a CVPixelBuffer; the
            // surface lives as long as the buffer, which this picture holds.
            unsafe { CVPixelBufferGetIOSurface(buffer).map(|surface| surface.as_ref()) }
        }

        /// Whether the window server is still showing, or about to show, the
        /// surface. A picture is let go only once it is not, so the decoder
        /// never writes a new frame into one on screen.
        pub fn is_in_use(&self) -> bool {
            self.io_surface().is_some_and(IOSurfaceRef::is_in_use)
        }

        pub(super) fn tag_colour(&self) {
            let buffer = self.pixel_buffer();
            if buffer.is_null() {
                return;
            }
            // SAFETY: Core Video's own constants, on a CVPixelBuffer.
            unsafe {
                let matrix = match self.space {
                    color::Space::BT709 => kCVImageBufferYCbCrMatrix_ITU_R_709_2,
                    color::Space::BT2020NCL | color::Space::BT2020CL => {
                        kCVImageBufferYCbCrMatrix_ITU_R_2020
                    }
                    color::Space::SMPTE240M => kCVImageBufferYCbCrMatrix_SMPTE_240M_1995,
                    _ => kCVImageBufferYCbCrMatrix_ITU_R_601_4,
                };
                CVBufferSetAttachment(
                    buffer,
                    kCVImageBufferYCbCrMatrixKey,
                    matrix,
                    SHOULD_PROPAGATE,
                );
                CVBufferSetAttachment(
                    buffer,
                    kCVImageBufferColorPrimariesKey,
                    kCVImageBufferColorPrimaries_ITU_R_709_2,
                    SHOULD_PROPAGATE,
                );
                CVBufferSetAttachment(
                    buffer,
                    kCVImageBufferTransferFunctionKey,
                    kCVImageBufferTransferFunction_sRGB,
                    SHOULD_PROPAGATE,
                );
            }
        }
    }
}
