//! Bitmaps on a slide, and behind one.
//!
//! Two callers: an `image` element, and the scene's background media. Both need
//! the same thing — fit a decoded bitmap into a box under an `object-fit` rule
//! — so the fitting lives here once.
//!
//! **Decoding takes bytes, not a path.** The compositor never opens a file. Any
//! path reaching it came from the frontend, and `services::file_scope` is the
//! one place allowed to turn one of those into a read (handoff §12: "anything
//! new that takes a path from the frontend goes through `FileState`"). Passing
//! bytes keeps this module unable to reopen known-issues §3 even by accident,
//! and makes it testable without touching a disk.

use image::GenericImageView;
use tiny_skia::{FilterQuality, Pattern, Pixmap, PixmapMut, Rect, SpreadMode, Transform};

/// How a bitmap fills a box it does not match the shape of.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ObjectFit {
    /// Fill the box, cropping the overflow. The default, and what a background
    /// wants: letterboxing a worship background would show black bars.
    Cover,
    /// Fit entirely inside the box, leaving gaps.
    Contain,
    /// Stretch to the box, ignoring the aspect ratio.
    Fill,
}

impl ObjectFit {
    pub fn parse(value: Option<&str>) -> Self {
        match value.map(str::trim) {
            Some(v) if v.eq_ignore_ascii_case("contain") => Self::Contain,
            Some(v) if v.eq_ignore_ascii_case("fill") => Self::Fill,
            _ => Self::Cover,
        }
    }
}

/// Where a bitmap lands inside its box: the scale and the offset.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Placement {
    pub scale_x: f32,
    pub scale_y: f32,
    pub offset_x: f32,
    pub offset_y: f32,
}

/// Fit `(source_width, source_height)` into `(box_width, box_height)`.
pub fn place(
    source_width: u32,
    source_height: u32,
    box_width: f32,
    box_height: f32,
    fit: ObjectFit,
) -> Option<Placement> {
    if source_width == 0 || source_height == 0 || box_width <= 0.0 || box_height <= 0.0 {
        return None;
    }

    let source_width = source_width as f32;
    let source_height = source_height as f32;
    let fit_x = box_width / source_width;
    let fit_y = box_height / source_height;

    let (scale_x, scale_y) = match fit {
        ObjectFit::Fill => (fit_x, fit_y),
        // Cover takes the larger scale so no gap is left; contain takes the
        // smaller so nothing is cropped.
        ObjectFit::Cover => {
            let scale = fit_x.max(fit_y);
            (scale, scale)
        }
        ObjectFit::Contain => {
            let scale = fit_x.min(fit_y);
            (scale, scale)
        }
    };

    // Centred on both axes, which is what `fitImageRect` does and what anyone
    // cropping a background expects.
    Some(Placement {
        scale_x,
        scale_y,
        offset_x: (box_width - source_width * scale_x) / 2.0,
        offset_y: (box_height - source_height * scale_y) / 2.0,
    })
}

/// Decode image bytes into something tiny-skia can paint.
///
/// Returns `None` for anything that will not decode rather than propagating an
/// error: a slide whose background failed to load should show its background
/// colour, not stop the frame.
pub fn decode(bytes: &[u8]) -> Option<Pixmap> {
    let decoded = image::load_from_memory(bytes).ok()?;
    let (width, height) = decoded.dimensions();
    let rgba = decoded.to_rgba8();

    let mut pixmap = Pixmap::new(width, height)?;
    for (index, pixel) in rgba.pixels().enumerate() {
        let [r, g, b, a] = pixel.0;
        // tiny-skia stores premultiplied pixels; `image` gives straight alpha.
        pixmap.pixels_mut()[index] = tiny_skia::ColorU8::from_rgba(r, g, b, a).premultiply();
    }
    Some(pixmap)
}

/// Paint a decoded bitmap into a box.
pub fn draw(
    pixmap: &mut PixmapMut<'_>,
    source: &Pixmap,
    transform: Transform,
    box_width: f32,
    box_height: f32,
    fit: ObjectFit,
    opacity: Option<f64>,
) {
    let Some(placement) = place(source.width(), source.height(), box_width, box_height, fit) else {
        return;
    };
    // The box, or for `contain` only the part the image covers. The pattern
    // pads its edge pixels outwards, so filling the whole box would smear the
    // image's edges across the letterbox instead of leaving it empty.
    let (left, top, right, bottom) = match fit {
        ObjectFit::Contain => (
            placement.offset_x.max(0.0),
            placement.offset_y.max(0.0),
            (placement.offset_x + source.width() as f32 * placement.scale_x).min(box_width),
            (placement.offset_y + source.height() as f32 * placement.scale_y).min(box_height),
        ),
        ObjectFit::Cover | ObjectFit::Fill => (0.0, 0.0, box_width, box_height),
    };
    let Some(rect) = Rect::from_ltrb(left, top, right, bottom) else {
        return;
    };

    // The pattern carries the bitmap's own placement; the box clips it, which
    // is what makes `cover` crop instead of overflowing onto the rest of the
    // slide.
    let pattern_transform = Transform::from_translate(placement.offset_x, placement.offset_y)
        .pre_scale(placement.scale_x, placement.scale_y);

    let mut paint = tiny_skia::Paint {
        shader: Pattern::new(
            source.as_ref(),
            SpreadMode::Pad,
            FilterQuality::Bilinear,
            opacity
                .filter(|value| value.is_finite())
                .map(|value| value.clamp(0.0, 1.0) as f32)
                .unwrap_or(1.0),
            pattern_transform,
        ),
        ..tiny_skia::Paint::default()
    };
    paint.anti_alias = true;

    pixmap.fill_rect(rect, &paint, transform, None);
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A solid PNG of a known size, so placement can be asserted on.
    fn png(width: u32, height: u32, rgba: [u8; 4]) -> Vec<u8> {
        let mut buffer = image::RgbaImage::new(width, height);
        for pixel in buffer.pixels_mut() {
            pixel.0 = rgba;
        }
        let mut out = std::io::Cursor::new(Vec::new());
        image::DynamicImage::ImageRgba8(buffer)
            .write_to(&mut out, image::ImageFormat::Png)
            .expect("encode");
        out.into_inner()
    }

    #[test]
    fn cover_fills_the_box_and_crops_the_overflow() {
        // A wide image in a square box: scaled to the box's height, overflowing
        // sideways. Letterboxing a worship background would show black bars.
        let placement = place(200, 100, 100.0, 100.0, ObjectFit::Cover).expect("placed");

        assert_eq!(placement.scale_x, 1.0, "scaled to cover the taller axis");
        assert_eq!(placement.scale_y, 1.0);
        assert_eq!(placement.offset_x, -50.0, "centred, so it overflows evenly");
        assert_eq!(placement.offset_y, 0.0);
    }

    #[test]
    fn contain_fits_entirely_and_leaves_a_gap() {
        let placement = place(200, 100, 100.0, 100.0, ObjectFit::Contain).expect("placed");

        assert_eq!(placement.scale_x, 0.5);
        assert_eq!(placement.offset_x, 0.0);
        assert_eq!(placement.offset_y, 25.0, "centred vertically in the gap");
    }

    #[test]
    fn fill_stretches_each_axis_independently() {
        let placement = place(200, 100, 100.0, 100.0, ObjectFit::Fill).expect("placed");

        assert_eq!(placement.scale_x, 0.5);
        assert_eq!(placement.scale_y, 1.0);
        assert_eq!((placement.offset_x, placement.offset_y), (0.0, 0.0));
    }

    #[test]
    fn cover_is_the_default_for_anything_unrecognised() {
        assert_eq!(ObjectFit::parse(None), ObjectFit::Cover);
        assert_eq!(ObjectFit::parse(Some("cover")), ObjectFit::Cover);
        assert_eq!(ObjectFit::parse(Some("scale-down")), ObjectFit::Cover);
        assert_eq!(ObjectFit::parse(Some("CONTAIN")), ObjectFit::Contain);
        assert_eq!(ObjectFit::parse(Some(" fill ")), ObjectFit::Fill);
    }

    #[test]
    fn a_degenerate_box_or_image_places_nothing() {
        assert!(place(0, 100, 10.0, 10.0, ObjectFit::Cover).is_none());
        assert!(place(100, 0, 10.0, 10.0, ObjectFit::Cover).is_none());
        assert!(place(100, 100, 0.0, 10.0, ObjectFit::Cover).is_none());
        assert!(place(100, 100, 10.0, -1.0, ObjectFit::Cover).is_none());
    }

    #[test]
    fn a_png_decodes_with_its_colours_intact() {
        let decoded = decode(&png(4, 4, [255, 0, 0, 255])).expect("decoded");

        assert_eq!((decoded.width(), decoded.height()), (4, 4));
        let pixel = decoded.pixels()[0];
        assert_eq!((pixel.red(), pixel.green(), pixel.blue()), (255, 0, 0));
    }

    #[test]
    fn rubbish_bytes_decode_to_nothing_rather_than_failing_the_frame() {
        // A slide whose background will not load should show its background
        // colour, not stop the frame.
        assert!(decode(b"not an image at all").is_none());
        assert!(decode(&[]).is_none());
    }

    #[test]
    fn a_drawn_image_lands_inside_its_box_and_not_outside() {
        use crate::services::compositor::Frame;

        let source = decode(&png(10, 10, [0, 0, 255, 255])).expect("decoded");
        let mut frame = Frame::new(100, 100).expect("frame");

        draw(
            &mut frame.pixmap_mut(),
            &source,
            Transform::from_translate(20.0, 20.0),
            40.0,
            40.0,
            ObjectFit::Cover,
            None,
        );

        assert_eq!(
            frame.pixel_at(40, 40),
            Some((0, 0, 255, 255)),
            "inside the box"
        );
        assert_eq!(frame.pixel_at(10, 10), Some((0, 0, 0, 255)), "outside it");
        assert_eq!(frame.pixel_at(70, 70), Some((0, 0, 0, 255)), "past it");
    }

    #[test]
    fn opacity_blends_the_image() {
        use crate::services::compositor::Frame;

        let source = decode(&png(10, 10, [255, 255, 255, 255])).expect("decoded");
        let mut frame = Frame::new(20, 20).expect("frame");

        draw(
            &mut frame.pixmap_mut(),
            &source,
            Transform::identity(),
            20.0,
            20.0,
            ObjectFit::Cover,
            Some(0.5),
        );

        let (red, _, _, _) = frame.pixel_at(10, 10).expect("pixel");
        assert!((100..=160).contains(&red), "expected mid grey, got {red}");
    }
}
