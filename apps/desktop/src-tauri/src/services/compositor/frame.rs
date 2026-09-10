//! One composited frame.
//!
//! The interface every consumer sees, and the reason it is shaped this way is
//! worth stating because it is a deviation from ADR-001's letter.
//!
//! **The scene layers are rasterised on the CPU, not with wgpu.** The ADR chose
//! *compositing in Rust* over OS capture and offscreen Chromium, and named wgpu
//! as the how before anyone had looked at how slides are actually drawn. They
//! are drawn with the Canvas 2D API — `measureText`, `fillText`, paths, rounded
//! rects, `drawImage` (`CanvasSlideLayer.tsx`, 60 context calls). `tiny-skia`
//! is a Skia subset with that same model, so this is a port rather than a
//! reimplementation.
//!
//! Three things follow from choosing it:
//!
//! * **NDI wants a CPU-side BGRA bitmap** — that is what `capturePage` produced
//!   and what `grandi` consumes (audit §10.1). A GPU compositor would have to
//!   read every frame back from the GPU to feed it. Rasterising on the CPU
//!   removes that readback rather than adding one.
//! * **It is testable headlessly**, with assertions about actual pixels. A wgpu
//!   path needs a GPU adapter, which CI runners frequently do not have.
//! * **There is nothing yet for a GPU to composite.** The expensive case is
//!   video frames at 30 fps, and there is no Rust video decoder in this tree.
//!   Building the GPU pipeline before there are frames to put through it is
//!   laying pipe before there is water.
//!
//! `Frame` is deliberately a plain buffer so that when video decode arrives and
//! a GPU path earns its place, it can replace the internals without any
//! consumer changing.

use tiny_skia::{Color, Pixmap, PixmapMut};

/// The largest frame that will be allocated, per side.
///
/// A scene carries its canvas size as text from the renderer, and a malformed
/// or hostile one must not become a multi-gigabyte allocation on a machine
/// running a service. 8K covers every real projector.
const MAX_DIMENSION: u32 = 7680;

pub struct Frame {
    pixmap: Pixmap,
}

impl Frame {
    /// A new frame, filled with opaque black.
    ///
    /// Black rather than transparent because that is what the audience surface
    /// is: `main.window.ts` gives the output window a black background so a
    /// frame that has not drawn yet is black rather than white. A white flash
    /// on a projector mid-service is the failure this avoids.
    pub fn new(width: u32, height: u32) -> Option<Self> {
        if width == 0 || height == 0 || width > MAX_DIMENSION || height > MAX_DIMENSION {
            return None;
        }

        let mut pixmap = Pixmap::new(width, height)?;
        pixmap.fill(Color::BLACK);
        Some(Self { pixmap })
    }

    pub fn width(&self) -> u32 {
        self.pixmap.width()
    }

    pub fn height(&self) -> u32 {
        self.pixmap.height()
    }

    /// Fill the whole frame with one colour.
    pub fn clear(&mut self, color: Color) {
        self.pixmap.fill(color);
    }

    /// The drawing surface, for the layers.
    pub fn pixmap_mut(&mut self) -> PixmapMut<'_> {
        self.pixmap.as_mut()
    }

    pub fn pixmap(&self) -> &Pixmap {
        &self.pixmap
    }

    /// Premultiplied RGBA, which is what tiny-skia works in.
    pub fn as_rgba(&self) -> &[u8] {
        self.pixmap.data()
    }

    /// BGRA, un-premultiplied, which is what NDI takes.
    ///
    /// Both halves matter. `grandi` receives what `capturePage` used to
    /// produce, and Chromium's `toBitmap` gives BGRA with straight alpha. Send
    /// premultiplied pixels instead and every semi-transparent overlay — the
    /// message banner, a lower third — arrives on the NDI destination darkened
    /// against black.
    pub fn to_bgra(&self) -> Vec<u8> {
        let mut out = Vec::with_capacity(self.pixmap.data().len());

        for pixel in self.pixmap.pixels() {
            let alpha = pixel.alpha();
            let (r, g, b) = if alpha == 0 {
                // Nothing to recover, and dividing by zero would not be
                // recoverable either.
                (0, 0, 0)
            } else if alpha == 255 {
                (pixel.red(), pixel.green(), pixel.blue())
            } else {
                (
                    unpremultiply(pixel.red(), alpha),
                    unpremultiply(pixel.green(), alpha),
                    unpremultiply(pixel.blue(), alpha),
                )
            };
            out.extend_from_slice(&[b, g, r, alpha]);
        }

        out
    }

    /// The colour at a pixel, un-premultiplied. For tests and diagnostics.
    pub fn pixel_at(&self, x: u32, y: u32) -> Option<(u8, u8, u8, u8)> {
        if x >= self.width() || y >= self.height() {
            return None;
        }
        let pixel = self.pixmap.pixels()[(y * self.width() + x) as usize];
        let alpha = pixel.alpha();
        if alpha == 0 {
            return Some((0, 0, 0, 0));
        }
        if alpha == 255 {
            return Some((pixel.red(), pixel.green(), pixel.blue(), alpha));
        }
        Some((
            unpremultiply(pixel.red(), alpha),
            unpremultiply(pixel.green(), alpha),
            unpremultiply(pixel.blue(), alpha),
            alpha,
        ))
    }

    /// Encode as PNG. The verification path: a frame somebody can look at.
    ///
    /// Encoded through `image` rather than tiny-skia's own `png-format`
    /// feature, which is off: the decoder is already a dependency for slide
    /// images, and pulling a second PNG encoder in for diagnostics would be
    /// paying twice.
    pub fn to_png(&self) -> Option<Vec<u8>> {
        let mut straight = Vec::with_capacity(self.pixmap.data().len());
        for y in 0..self.height() {
            for x in 0..self.width() {
                let (r, g, b, a) = self.pixel_at(x, y)?;
                straight.extend_from_slice(&[r, g, b, a]);
            }
        }

        let buffer = image::RgbaImage::from_raw(self.width(), self.height(), straight)?;
        let mut out = std::io::Cursor::new(Vec::new());
        image::DynamicImage::ImageRgba8(buffer)
            .write_to(&mut out, image::ImageFormat::Png)
            .ok()?;
        Some(out.into_inner())
    }
}

fn unpremultiply(channel: u8, alpha: u8) -> u8 {
    ((channel as u32 * 255 + alpha as u32 / 2) / alpha as u32).min(255) as u8
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_new_frame_is_black_rather_than_transparent() {
        // The audience window's own background is black so that a frame which
        // has not drawn yet is black. A white or transparent flash on a
        // projector mid-service is what this prevents.
        let frame = Frame::new(16, 9).expect("frame");
        assert_eq!(frame.pixel_at(0, 0), Some((0, 0, 0, 255)));
        assert_eq!(frame.pixel_at(15, 8), Some((0, 0, 0, 255)));
    }

    #[test]
    fn an_impossible_size_is_refused_rather_than_allocated() {
        // The canvas size arrives as text from the renderer. A malformed one
        // must not become a multi-gigabyte allocation on a machine that is
        // running a service.
        assert!(Frame::new(0, 100).is_none());
        assert!(Frame::new(100, 0).is_none());
        assert!(Frame::new(100_000, 100).is_none());
        assert!(Frame::new(1920, 1080).is_some());
        assert!(
            Frame::new(7680, 4320).is_some(),
            "8K is a real projector size"
        );
    }

    #[test]
    fn bgra_reorders_the_channels_for_ndi() {
        let mut frame = Frame::new(1, 1).expect("frame");
        frame.clear(Color::from_rgba8(10, 20, 30, 255));

        assert_eq!(frame.to_bgra(), vec![30, 20, 10, 255], "B, G, R, A");
    }

    #[test]
    fn bgra_is_unpremultiplied() {
        // tiny-skia stores premultiplied pixels; Chromium's `toBitmap` produced
        // straight alpha. Sending premultiplied pixels would darken every
        // semi-transparent overlay against black on the NDI destination.
        let mut frame = Frame::new(1, 1).expect("frame");
        frame.clear(Color::from_rgba8(255, 255, 255, 128));

        let bgra = frame.to_bgra();
        assert_eq!(bgra[3], 128, "alpha is carried through");
        assert!(
            bgra[0] > 250 && bgra[1] > 250 && bgra[2] > 250,
            "white at half alpha must stay white, not become grey: {bgra:?}"
        );
    }

    #[test]
    fn a_fully_transparent_pixel_does_not_divide_by_zero() {
        let mut frame = Frame::new(1, 1).expect("frame");
        frame.clear(Color::from_rgba8(0, 0, 0, 0));

        assert_eq!(frame.to_bgra(), vec![0, 0, 0, 0]);
        assert_eq!(frame.pixel_at(0, 0), Some((0, 0, 0, 0)));
    }

    #[test]
    fn the_buffer_is_the_size_the_frame_says_it_is() {
        let frame = Frame::new(1920, 1080).expect("frame");

        assert_eq!(frame.as_rgba().len(), 1920 * 1080 * 4);
        assert_eq!(frame.to_bgra().len(), 1920 * 1080 * 4);
    }

    #[test]
    fn a_pixel_outside_the_frame_is_none_rather_than_a_panic() {
        let frame = Frame::new(4, 4).expect("frame");
        assert!(frame.pixel_at(4, 0).is_none());
        assert!(frame.pixel_at(0, 4).is_none());
    }

    #[test]
    fn a_frame_encodes_as_png() {
        let frame = Frame::new(8, 8).expect("frame");
        let png = frame.to_png().expect("png");
        assert_eq!(&png[1..4], b"PNG", "PNG magic bytes");
    }
}
