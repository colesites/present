//! Pictures handed to Core Animation as IOSurfaces, on macOS.
//!
//! A `CGImage` set as a layer's contents is copied by Core Animation when the
//! change commits — on the main thread — and matched to the display's colours
//! there, pixel by pixel on the processor (`CA::Render::copy_image`, vImage).
//! Measured with a video playing in the audience window, the center pane and
//! the preview, that was nearly half of the main thread: the thread that
//! answers the mouse, so the cursor spun, and every picture's next frame
//! waited behind it.
//!
//! An IOSurface is memory the window server and the GPU read as it is. A frame
//! is written into one on the thread that made it; the main thread only points
//! the layer at it; the window server shows it, matching its colours on the
//! GPU. Each picture keeps a few and writes into one only once the window
//! server has let go of it, so a frame is never written over while it is on
//! screen.

use std::sync::Arc;

use objc2::runtime::AnyObject;
use objc2_core_foundation::{CFDictionary, CFNumber, CFRetained, CFString, CFType};
use objc2_core_graphics::{kCGColorSpaceSRGB, CGColorSpace};
use objc2_io_surface::{
    kIOSurfaceBytesPerElement, kIOSurfaceColorSpace, kIOSurfaceHeight, kIOSurfacePixelFormat,
    kIOSurfaceWidth, IOSurfaceLockOptions, IOSurfaceRef,
};

/// The most surfaces one picture keeps. Measured against the window server
/// with a layer shown sixty frames a second: it holds the surface on screen
/// and up to three it is finishing with, so four left a frame with none free
/// about once in sixty, and six never did.
const MOST: usize = 6;

/// `'BGRA'`: blue, green, red, alpha — premultiplied, as every picture here is.
const BGRA: i32 = i32::from_be_bytes(*b"BGRA");

/// One picture in memory the window server reads as it is.
pub(super) struct Frame(CFRetained<IOSurfaceRef>);

// SAFETY: an IOSurface is a kernel object documented as usable from any
// thread; this one is written only by the picture's own thread, under its
// lock, while nothing shows it.
unsafe impl Send for Frame {}
unsafe impl Sync for Frame {}

impl Frame {
    /// The surface as a layer's `contents`.
    pub(super) fn as_contents(&self) -> &AnyObject {
        // SAFETY: an IOSurfaceRef is toll-free bridged to the `IOSurface`
        // class, which a CALayer takes as its contents.
        unsafe { &*(CFRetained::as_ptr(&self.0).as_ptr() as *const AnyObject) }
    }
}

/// One picture's surfaces, reused frame after frame.
pub(super) struct Surfaces {
    size: (u32, u32),
    pool: Vec<Arc<Frame>>,
    /// The last one handed out. Never written next: the window server may not
    /// yet have said it is using it.
    newest: Option<Arc<Frame>>,
}

impl Surfaces {
    pub(super) fn new() -> Self {
        Self {
            size: (0, 0),
            pool: Vec::new(),
            newest: None,
        }
    }

    /// `bgra` — premultiplied, `width * 4` bytes a row, top row first — in a
    /// surface nothing shows. `None` when every surface is still in use, or
    /// one could not be made: the picture keeps the frame it has.
    pub(super) fn fill(&mut self, width: u32, height: u32, bgra: &[u8]) -> Option<Arc<Frame>> {
        let row = width as usize * 4;
        if width == 0 || height == 0 || bgra.len() != row * height as usize {
            return None;
        }
        if self.size != (width, height) {
            // The old ones go once the layers showing them let go.
            self.pool.clear();
            self.newest = None;
            self.size = (width, height);
        }
        let newest = self.newest.as_ref();
        let free = self.pool.iter().find(|frame| {
            // Held by nothing but this pool — not on its way to the main
            // thread — and not being shown.
            Arc::strong_count(frame) == 1
                && newest.is_none_or(|newest| !Arc::ptr_eq(newest, frame))
                && !frame.0.is_in_use()
        });
        let frame = match free {
            Some(frame) => Arc::clone(frame),
            None if self.pool.len() < MOST => {
                let frame = Arc::new(Frame(create(width, height)?));
                self.pool.push(Arc::clone(&frame));
                frame
            }
            None => return None,
        };
        write(&frame.0, bgra, row, height as usize)?;
        self.newest = Some(Arc::clone(&frame));
        Some(frame)
    }
}

/// A BGRA surface, tagged sRGB — the colours the page and the compositor draw
/// in — so the window server matches it to the display as it does the page.
fn create(width: u32, height: u32) -> Option<CFRetained<IOSurfaceRef>> {
    let numbers = [
        CFNumber::new_i32(i32::try_from(width).ok()?),
        CFNumber::new_i32(i32::try_from(height).ok()?),
        CFNumber::new_i32(4),
        CFNumber::new_i32(BGRA),
    ];
    // SAFETY: the keys are IOSurface's own constants.
    let keys: [&CFString; 4] = unsafe {
        [
            kIOSurfaceWidth,
            kIOSurfaceHeight,
            kIOSurfaceBytesPerElement,
            kIOSurfacePixelFormat,
        ]
    };
    let values: Vec<&CFType> = numbers.iter().map(|number| number.as_ref()).collect();
    let properties = CFDictionary::<CFString, CFType>::from_slices(&keys, &values);
    // SAFETY: the dictionary holds the keys IOSurfaceCreate documents, with
    // number values.
    let surface = unsafe { IOSurfaceRef::new(properties.as_ref()) }?;
    // SAFETY: `kCGColorSpaceSRGB` is Core Graphics' own constant.
    let srgb = CGColorSpace::with_name(Some(unsafe { kCGColorSpaceSRGB }));
    if let Some(colours) = srgb.and_then(|space| space.property_list()) {
        // SAFETY: a colour space's property list is the value
        // `kIOSurfaceColorSpace` documents.
        unsafe { surface.set_value(kIOSurfaceColorSpace, &colours) };
    }
    Some(surface)
}

/// Copy `bgra` into `surface`, row by row: a surface's rows may be longer
/// than the picture's.
fn write(surface: &IOSurfaceRef, bgra: &[u8], row: usize, rows: usize) -> Option<()> {
    // SAFETY: locked for writing by this thread alone; unlocked below.
    let locked = unsafe { surface.lock(IOSurfaceLockOptions::empty(), std::ptr::null_mut()) };
    if locked != 0 {
        return None;
    }
    let stride = surface.bytes_per_row();
    if stride >= row && surface.height() >= rows {
        let base = surface.base_address().as_ptr().cast::<u8>();
        for (index, source) in bgra.chunks_exact(row).take(rows).enumerate() {
            // SAFETY: row `index` of the surface is `stride` bytes from the
            // last, at least `row` of them, inside the locked allocation.
            unsafe {
                std::ptr::copy_nonoverlapping(source.as_ptr(), base.add(index * stride), row);
            }
        }
    }
    // SAFETY: locked above, by this thread.
    unsafe { surface.unlock(IOSurfaceLockOptions::empty(), std::ptr::null_mut()) };
    (stride >= row && surface.height() >= rows).then_some(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn picture(width: u32, height: u32, value: u8) -> Vec<u8> {
        vec![value; width as usize * height as usize * 4]
    }

    /// Read a surface back, row by row, as the picture it holds.
    fn read(frame: &Frame, width: u32, height: u32) -> Vec<u8> {
        let surface = &frame.0;
        let row = width as usize * 4;
        let mut out = Vec::with_capacity(row * height as usize);
        // SAFETY: locked read-only by the test alone.
        unsafe { surface.lock(IOSurfaceLockOptions::ReadOnly, std::ptr::null_mut()) };
        let base = surface.base_address().as_ptr().cast::<u8>();
        for index in 0..height as usize {
            // SAFETY: inside the locked surface, as in `write`.
            let line = unsafe {
                std::slice::from_raw_parts(base.add(index * surface.bytes_per_row()), row)
            };
            out.extend_from_slice(line);
        }
        // SAFETY: locked above.
        unsafe { surface.unlock(IOSurfaceLockOptions::ReadOnly, std::ptr::null_mut()) };
        out
    }

    #[test]
    fn a_frame_lands_in_a_surface_as_it_was_drawn() {
        let mut surfaces = Surfaces::new();
        // An odd width, so the surface's rows are longer than the picture's.
        let (width, height) = (333, 7);
        let mut drawn = picture(width, height, 0);
        for (index, byte) in drawn.iter_mut().enumerate() {
            *byte = (index % 251) as u8;
        }
        let frame = surfaces.fill(width, height, &drawn).expect("a surface");
        assert_eq!(read(&frame, width, height), drawn);
        assert_eq!(frame.0.pixel_format(), BGRA as u32);
        assert!(
            frame.0.value(unsafe { kIOSurfaceColorSpace }).is_some(),
            "tagged sRGB"
        );
    }

    #[test]
    fn a_surface_is_reused_but_never_the_one_just_handed_out() {
        let mut surfaces = Surfaces::new();
        let first = surfaces.fill(64, 36, &picture(64, 36, 1)).unwrap();
        let first_address = Arc::as_ptr(&first);
        drop(first);
        // Free again, but the newest: the window server may not have said
        // it is showing it yet.
        let second = surfaces.fill(64, 36, &picture(64, 36, 2)).unwrap();
        assert_ne!(Arc::as_ptr(&second), first_address);
        drop(second);
        let third = surfaces.fill(64, 36, &picture(64, 36, 3)).unwrap();
        assert_eq!(Arc::as_ptr(&third), first_address, "the first, free again");
        assert_eq!(surfaces.pool.len(), 2);
    }

    #[test]
    fn surfaces_still_held_are_not_written_and_there_are_at_most_six() {
        let mut surfaces = Surfaces::new();
        let held: Vec<_> = (0..MOST)
            .map(|value| {
                surfaces
                    .fill(64, 36, &picture(64, 36, value as u8))
                    .unwrap()
            })
            .collect();
        assert!(
            surfaces.fill(64, 36, &picture(64, 36, 9)).is_none(),
            "every one is held: the frame is dropped"
        );
        for (value, frame) in held.iter().enumerate() {
            assert!(read(frame, 64, 36).iter().all(|byte| *byte == value as u8));
        }
    }

    #[test]
    fn a_new_size_starts_a_new_set_and_a_wrong_length_is_refused() {
        let mut surfaces = Surfaces::new();
        surfaces.fill(64, 36, &picture(64, 36, 1)).unwrap();
        let bigger = surfaces.fill(128, 72, &picture(128, 72, 2)).unwrap();
        assert_eq!((bigger.0.width(), bigger.0.height()), (128, 72));
        assert_eq!(surfaces.pool.len(), 1);
        assert!(surfaces.fill(128, 72, &[0; 10]).is_none());
    }
}
