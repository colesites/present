//! A decoded video frame drawn straight into a rectangle of the frame.
//!
//! For the screen composer's regions, each playing its own video. They went
//! the general image way: every pixel of the decoded frame converted, one at a
//! time on one core, into a new pixmap, which tiny-skia then sampled through a
//! pattern into the region. That was about thirty milliseconds a region at
//! 1080p, every frame, so two playing regions took a composed screen to fifteen
//! frames a second and kept its thread busy the whole time.
//!
//! Here each destination pixel is worked out once, in bands across the cores,
//! sampling the decoded BGRA directly: the fit and the rounded corners are
//! arithmetic on the way. The decoder already hands over frames close to the
//! region's size (`ndi::video_feed::region_decode_size`), so the bilinear
//! sample is a copy with a little blending, not a real resize.

use tiny_skia::{ColorU8, PremultipliedColorU8};

use super::images::ObjectFit;
use super::parallel;
use super::Frame;
use crate::services::video::VideoFrame;

/// Draw `video` into `rect` (x, y, width, height, in frame pixels), fitted as
/// `fit` asks and clipped to `rect` with corners of `radius`. Pixels of `rect`
/// the picture does not cover, and the corners, are left as they were: the
/// region's plate is drawn under it first.
pub fn blit_video(
    frame: &mut Frame,
    video: &VideoFrame,
    rect: (f32, f32, f32, f32),
    fit: ObjectFit,
    radius: f32,
) {
    let (rx, ry, rw, rh) = rect;
    if !(video.is_well_formed() && rw > 0.0 && rh > 0.0) {
        return;
    }
    let (vw, vh) = (video.width as f32, video.height as f32);
    let (scale_x, scale_y) = match fit {
        ObjectFit::Cover => {
            let scale = (rw / vw).max(rh / vh);
            (scale, scale)
        }
        ObjectFit::Contain => {
            let scale = (rw / vw).min(rh / vh);
            (scale, scale)
        }
        ObjectFit::Fill => (rw / vw, rh / vh),
    };
    if !(scale_x > 0.0 && scale_y > 0.0) {
        return;
    }
    let (picture_width, picture_height) = (vw * scale_x, vh * scale_y);
    let picture_x = rx + (rw - picture_width) / 2.0;
    let picture_y = ry + (rh - picture_height) / 2.0;

    // Whole pixels whose centres are inside both the picture and the region.
    let (frame_width, frame_height) = (frame.width() as i64, frame.height() as i64);
    let span = |start: f32, end: f32, most: i64| {
        let from = (start.round() as i64).clamp(0, most);
        let to = (end.round() as i64).clamp(0, most);
        (from, to.max(from))
    };
    let (left, right) = span(
        picture_x.max(rx),
        (picture_x + picture_width).min(rx + rw),
        frame_width,
    );
    let (top, bottom) = span(
        picture_y.max(ry),
        (picture_y + picture_height).min(ry + rh),
        frame_height,
    );
    if left >= right || top >= bottom {
        return;
    }

    // Where each column and row samples from: the two source pixels either
    // side, and how far between them, out of 256.
    let taps =
        |from: i64, to: i64, origin: f32, scale: f32, size: u32| -> Vec<(usize, usize, u32)> {
            let last = size.saturating_sub(1) as f32;
            (from..to)
                .map(|at| {
                    let source = ((at as f32 + 0.5 - origin) / scale - 0.5).clamp(0.0, last);
                    let low = source.floor();
                    let weight = ((source - low) * 256.0).round() as u32;
                    let low = low as usize;
                    (low, (low + 1).min(size as usize - 1), weight.min(256))
                })
                .collect()
        };
    let columns = taps(left, right, picture_x, scale_x, video.width);
    let rows = taps(top, bottom, picture_y, scale_y, video.height);

    // The rounded corners, as how far in from each side a row starts.
    let radius = radius.clamp(0.0, rw.min(rh) / 2.0);
    let inset_at = |y: i64| -> f32 {
        if radius <= 0.0 {
            return 0.0;
        }
        let centre = y as f32 + 0.5;
        let from_edge = if centre < ry + radius {
            ry + radius - centre
        } else if centre > ry + rh - radius {
            centre - (ry + rh - radius)
        } else {
            return 0.0;
        };
        radius - (radius * radius - from_edge * from_edge).max(0.0).sqrt()
    };

    let stride = video.width as usize * 4;
    let bgra = &video.bgra;
    let width = frame_width as usize;
    // The usual case: the decoder already made the frame the size the region
    // shows it at, so a pixel of the video is a pixel of the screen.
    let one_to_one = (scale_x - 1.0).abs() < 1e-3 && (scale_y - 1.0).abs() < 1e-3;
    let (shift_x, shift_y) = (picture_x.round() as i64, picture_y.round() as i64);
    parallel::for_each_band(frame.pixmap_mut_pixels(), |band, offset| {
        let first_row = (offset / width) as i64;
        let last_row = ((offset + band.len()).saturating_sub(1) / width) as i64;
        for y in first_row.max(top)..(last_row + 1).min(bottom) {
            let inset = inset_at(y);
            // This row's pixels, within this band and inside the corners.
            let row_start = y as usize * width;
            let from = left
                .max((rx + inset).round() as i64)
                .max(offset.saturating_sub(row_start) as i64);
            let to = right
                .min((rx + rw - inset).round() as i64)
                .min((offset + band.len()).saturating_sub(row_start) as i64);
            if from >= to {
                continue;
            }
            let destination =
                &mut band[row_start + from as usize - offset..row_start + to as usize - offset];

            if one_to_one {
                let source_row = (y - shift_y).clamp(0, i64::from(video.height) - 1) as usize;
                let source_from = ((from - shift_x).max(0) as usize).min(video.width as usize);
                let Some(source) =
                    bgra.get(source_row * stride + source_from * 4..(source_row + 1) * stride)
                else {
                    continue;
                };
                for (slot, pixel) in destination.iter_mut().zip(source.chunks_exact(4)) {
                    *slot = premultiplied(pixel[2], pixel[1], pixel[0], pixel[3]);
                }
                continue;
            }

            let (source_top, source_bottom, weight_y) = rows[(y - top) as usize];
            let (Some(upper), Some(lower)) = (
                bgra.get(source_top * stride..(source_top + 1) * stride),
                bgra.get(source_bottom * stride..(source_bottom + 1) * stride),
            ) else {
                continue;
            };
            let taps = &columns[(from - left) as usize..(to - left) as usize];
            for (slot, &(source_left, source_right, weight_x)) in destination.iter_mut().zip(taps) {
                let (a, b) = (source_left * 4, source_right * 4);
                let (above_a, above_b) = (&upper[a..a + 4], &upper[b..b + 4]);
                let (below_a, below_b) = (&lower[a..a + 4], &lower[b..b + 4]);
                let mut mixed = [0u8; 4];
                for (channel, out) in mixed.iter_mut().enumerate() {
                    let above = u32::from(above_a[channel]) * (256 - weight_x)
                        + u32::from(above_b[channel]) * weight_x;
                    let below = u32::from(below_a[channel]) * (256 - weight_x)
                        + u32::from(below_b[channel]) * weight_x;
                    *out = ((above * (256 - weight_y) + below * weight_y + (1 << 15)) >> 16) as u8;
                }
                *slot = premultiplied(mixed[2], mixed[1], mixed[0], mixed[3]);
            }
        }
    });
}

/// One pixel, premultiplied. Video is opaque in practice, and premultiplying
/// by one changes nothing.
fn premultiplied(red: u8, green: u8, blue: u8, alpha: u8) -> PremultipliedColorU8 {
    if alpha == 255 {
        PremultipliedColorU8::from_rgba(red, green, blue, 255)
            .unwrap_or_else(|| ColorU8::from_rgba(red, green, blue, 255).premultiply())
    } else {
        ColorU8::from_rgba(red, green, blue, alpha).premultiply()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tiny_skia::Color;

    /// A video whose left half is red and right half blue.
    fn halves(width: u32, height: u32) -> VideoFrame {
        let mut bgra = Vec::with_capacity((width * height * 4) as usize);
        for _ in 0..height {
            for x in 0..width {
                bgra.extend_from_slice(if x < width / 2 {
                    &[0, 0, 255, 255]
                } else {
                    &[255, 0, 0, 255]
                });
            }
        }
        VideoFrame {
            width,
            height,
            bgra,
            presentation_seconds: 0.0,
        }
    }

    fn green_frame(width: u32, height: u32) -> Frame {
        let mut frame = Frame::new(width, height).expect("frame");
        frame.clear(Color::from_rgba8(0, 255, 0, 255));
        frame
    }

    #[test]
    fn a_frame_the_size_of_its_region_is_copied_as_it_is() {
        let mut frame = green_frame(200, 100);
        blit_video(
            &mut frame,
            &halves(100, 50),
            (50.0, 25.0, 100.0, 50.0),
            ObjectFit::Cover,
            0.0,
        );
        assert_eq!(
            frame.pixel_at(60, 50),
            Some((255, 0, 0, 255)),
            "red on the left"
        );
        assert_eq!(
            frame.pixel_at(140, 50),
            Some((0, 0, 255, 255)),
            "blue on the right"
        );
        assert_eq!(
            frame.pixel_at(49, 50),
            Some((0, 255, 0, 255)),
            "nothing outside it"
        );
        assert_eq!(frame.pixel_at(150, 50), Some((0, 255, 0, 255)));
        assert_eq!(frame.pixel_at(100, 24), Some((0, 255, 0, 255)));
    }

    #[test]
    fn contain_leaves_the_rest_of_the_region_to_its_plate() {
        // A 2:1 video in a square region: bars above and below.
        let mut frame = green_frame(100, 100);
        blit_video(
            &mut frame,
            &halves(200, 100),
            (0.0, 0.0, 100.0, 100.0),
            ObjectFit::Contain,
            0.0,
        );
        assert_eq!(
            frame.pixel_at(50, 10),
            Some((0, 255, 0, 255)),
            "the bar above"
        );
        assert_eq!(frame.pixel_at(10, 50), Some((255, 0, 0, 255)));
        assert_eq!(frame.pixel_at(90, 50), Some((0, 0, 255, 255)));
        assert_eq!(frame.pixel_at(50, 90), Some((0, 255, 0, 255)), "and below");
    }

    #[test]
    fn cover_fills_the_region_and_crops_the_sides() {
        let mut frame = green_frame(100, 100);
        blit_video(
            &mut frame,
            &halves(200, 100),
            (0.0, 0.0, 100.0, 100.0),
            ObjectFit::Cover,
            0.0,
        );
        // Scaled to the region's height, the video is twice as wide as it:
        // a quarter is cut from each side, and its middle is the region's.
        assert_eq!(frame.pixel_at(45, 50), Some((255, 0, 0, 255)));
        assert_eq!(frame.pixel_at(55, 50), Some((0, 0, 255, 255)));
        assert_eq!(frame.pixel_at(2, 2), Some((255, 0, 0, 255)), "edge to edge");
        assert_eq!(frame.pixel_at(97, 97), Some((0, 0, 255, 255)));
    }

    #[test]
    fn fill_stretches_to_the_region() {
        let mut frame = green_frame(100, 100);
        blit_video(
            &mut frame,
            &halves(200, 100),
            (0.0, 0.0, 100.0, 100.0),
            ObjectFit::Fill,
            0.0,
        );
        assert_eq!(frame.pixel_at(2, 2), Some((255, 0, 0, 255)));
        assert_eq!(frame.pixel_at(20, 97), Some((255, 0, 0, 255)));
        assert_eq!(frame.pixel_at(97, 2), Some((0, 0, 255, 255)));
    }

    #[test]
    fn rounded_corners_are_left_alone() {
        let mut frame = green_frame(100, 100);
        blit_video(
            &mut frame,
            &halves(100, 100),
            (0.0, 0.0, 100.0, 100.0),
            ObjectFit::Cover,
            30.0,
        );
        assert_eq!(
            frame.pixel_at(1, 1),
            Some((0, 255, 0, 255)),
            "the corner stays"
        );
        assert_eq!(frame.pixel_at(98, 98), Some((0, 255, 0, 255)));
        assert_eq!(
            frame.pixel_at(30, 30),
            Some((255, 0, 0, 255)),
            "inside the curve is drawn"
        );
        assert_eq!(
            frame.pixel_at(1, 50),
            Some((255, 0, 0, 255)),
            "the straight edge too"
        );
    }

    #[test]
    fn a_region_off_the_frame_draws_what_is_on_it() {
        let mut frame = green_frame(100, 100);
        blit_video(
            &mut frame,
            &halves(100, 100),
            (50.0, 50.0, 100.0, 100.0),
            ObjectFit::Cover,
            0.0,
        );
        assert_eq!(frame.pixel_at(60, 60), Some((255, 0, 0, 255)));
        assert_eq!(frame.pixel_at(40, 40), Some((0, 255, 0, 255)));
    }
}
