//! Drawing one moment of a transition between two pictures.
//!
//! Both sides arrive as finished layers — whatever the outgoing slide looked
//! like, and whatever the incoming one looks like — and this puts the frame
//! that belongs at `progress` onto the output. Everything is expressed as the
//! same handful of operations: draw a layer somewhere, at some opacity, at
//! some scale, through some mask. A hundred and eight presets are parameters
//! to these, not implementations of their own.
//!
//! `progress` has already been eased by the time it arrives here, and is
//! clamped to 0..=1: `Back` and `Elastic` overshoot, and a mask or an offset
//! built from a number outside the range would draw outside the frame.

use tiny_skia::{FillRule, Mask, PathBuilder, Pixmap, PixmapMut, Transform};

use super::config::Direction;
use super::registry::Primitive;
use crate::services::compositor::{filters, parallel};

/// How much of the layer's own size a slide moves by. One whole screen.
const TRAVEL: f32 = 1.0;

/// How far a zoom starts from, as a fraction of the picture.
const ZOOM_FROM: f32 = 0.7;

/// The strongest blur a blur transition reaches, in pixels of the frame.
const BLUR_PEAK: f32 = 24.0;

/// Put the moment at `progress` of this transition onto `out`.
///
/// `from` is what was on screen, `to` is what is arriving. Both are the same
/// size as `out`.
pub fn draw(
    out: &mut PixmapMut<'_>,
    from: &Pixmap,
    to: &Pixmap,
    primitive: Primitive,
    direction: Direction,
    progress: f64,
) {
    let progress = progress.clamp(0.0, 1.0) as f32;
    let (width, height) = (out.width() as f32, out.height() as f32);

    // The first picture is laid over whatever is there. The second always
    // *replaces* it, by as much as it is laid: see [`Blend::Replace`].
    use Blend::{Over, Replace};
    match primitive {
        // Nothing between: whichever picture belongs now.
        Primitive::Cut | Primitive::Hold => {
            // The outgoing picture is held, then replaced at the end.
            place(
                out,
                if progress >= 1.0 { to } else { from },
                0.0,
                0.0,
                1.0,
                Over,
            );
        }
        Primitive::Fade => {
            place(out, from, 0.0, 0.0, 1.0, Over);
            place(out, to, 0.0, 0.0, progress, Replace);
        }
        Primitive::DipToColor => {
            // Out through the colour and in again, so the two pictures never
            // overlap — which is the difference between a dip and a fade.
            if progress < 0.5 {
                place(out, from, 0.0, 0.0, 1.0 - progress * 2.0, Over);
            } else {
                place(out, to, 0.0, 0.0, (progress - 0.5) * 2.0, Over);
            }
        }
        // The four ways two pictures can pass each other. The pictures move
        // the way the name says — `Slide Right` moves rightwards — so the one
        // arriving comes in from the opposite edge.
        Primitive::Slide | Primitive::Push => {
            let (x, y) = travel(direction, width, height);
            place(out, from, x * progress, y * progress, 1.0, Over);
            place(
                out,
                to,
                x * (progress - TRAVEL),
                y * (progress - TRAVEL),
                1.0,
                Replace,
            );
        }
        // The new one moves in over a still old one.
        Primitive::Cover => {
            let (x, y) = travel(direction, width, height);
            place(out, from, 0.0, 0.0, 1.0, Over);
            place(
                out,
                to,
                x * (progress - TRAVEL),
                y * (progress - TRAVEL),
                1.0,
                Replace,
            );
        }
        // The old one moves away, uncovering a still new one.
        Primitive::Reveal => {
            let (x, y) = travel(direction, width, height);
            place(out, to, 0.0, 0.0, 1.0, Over);
            place(out, from, x * progress, y * progress, 1.0, Replace);
        }
        Primitive::Wipe | Primitive::Blinds | Primitive::Split | Primitive::Sweep => {
            place(out, from, 0.0, 0.0, 1.0, Over);
            if let Some(mask) = wipe_mask(out.width(), out.height(), direction, progress) {
                through(out, to, &mask, Replace);
            }
        }
        Primitive::RadialWipe | Primitive::Shape => {
            place(out, from, 0.0, 0.0, 1.0, Over);
            if let Some(mask) = shape_mask(out.width(), out.height(), direction, progress) {
                through(out, to, &mask, Replace);
            }
        }
        Primitive::Zoom | Primitive::ZoomBlur | Primitive::Rotate => {
            place(out, from, 0.0, 0.0, 1.0, Over);
            let growing = direction != Direction::Out;
            let scale = if growing {
                ZOOM_FROM + (1.0 - ZOOM_FROM) * progress
            } else {
                1.0 + (1.0 - ZOOM_FROM) * (1.0 - progress)
            };
            scaled(out, to, scale, progress, Replace);
        }
        Primitive::Blur => {
            // Out of focus and back in, which is what reads as a blur
            // transition — a cross-fade with both sides softened at the point
            // they cross.
            let softness = BLUR_PEAK * (1.0 - (progress * 2.0 - 1.0).abs());
            blurred_between(out, from, to, softness, progress);
        }
        // Not drawn yet: the registry falls these back to a fade before they
        // reach here, so this is only the belt to that braces.
        Primitive::Cube
        | Primitive::Flip
        | Primitive::PageCurl
        | Primitive::Flash
        | Primitive::Glitch
        | Primitive::Pixelate
        | Primitive::Distort
        | Primitive::Particle => {
            place(out, from, 0.0, 0.0, 1.0, Over);
            place(out, to, 0.0, 0.0, progress, Replace);
        }
    }
}

/// How a layer meets what is already on `out`.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Blend {
    /// Laid on top: where the layer is transparent, what is beneath shows.
    Over,
    /// Where the layer is laid, what is beneath gives way to it — by as much
    /// as the layer is laid, whatever the layer's own transparency.
    ///
    /// For the second picture of a transition. When both pictures are opaque,
    /// as a whole-slide transition's are, this is exactly `Over`. It matters
    /// for a changed-elements transition, whose pictures are words on nothing:
    /// laid `Over`, the old words stayed at full strength beneath the new ones
    /// for the whole of a fade, a wipe or a cover, and vanished all at once
    /// when it ended. Replaced, they fade out as the new ones fade in, and go
    /// where the wipe or the cover has passed.
    Replace,
}

impl Blend {
    #[inline(always)]
    fn lay(self, over: [u8; 4], under: &mut [u8; 4], amount: u32) {
        match self {
            Self::Over => over_at(over, under, amount),
            Self::Replace => replace_at(over, under, amount),
        }
    }
}

/// How far a whole screen is, in the direction asked for.
fn travel(direction: Direction, width: f32, height: f32) -> (f32, f32) {
    let (x, y) = direction.vector().unwrap_or((-1.0, 0.0));
    (x as f32 * width, y as f32 * height)
}

/// Draw a layer at an offset and an opacity.
///
/// Integer arithmetic on whole-pixel offsets, rather than `draw_pixmap`.
/// That call runs every pixel through tiny-skia's floating-point shader
/// pipeline even for a plain translate at an opacity, and profiled over a
/// transition it was nine tenths of each frame — a 600 ms fade was drawn in
/// eight steps at 1920x1200. Most transitions are exactly this operation, so
/// this is where they get smooth.
///
/// The offset is rounded to a whole pixel. A slide crossing the screen in
/// 600 ms moves about fifty pixels a frame, and half a pixel of that is not
/// something an audience can see.
fn place(out: &mut PixmapMut<'_>, layer: &Pixmap, x: f32, y: f32, opacity: f32, blend: Blend) {
    let Some(opacity) = opacity_of(opacity) else {
        return;
    };
    let width = i64::from(out.width());
    let (layer_width, layer_height) = (i64::from(layer.width()), i64::from(layer.height()));
    // `as` saturates, so an offset of a whole screen or more is simply off it.
    let (dx, dy) = (x.round() as i64, y.round() as i64);
    // The columns of the output the layer lands on, and how far into the
    // layer the first of them is.
    let (first, last) = (dx.max(0), dx.saturating_add(layer_width).min(width));
    if first >= last {
        return;
    }
    let (skip, span) = ((first - dx) as usize, (last - first) as usize);
    let (first, width, layer_width) = (first as usize, width as usize, layer_width as usize);

    let source = layer.data();
    parallel::for_each_row_band(out.data_mut(), width * 4, |rows, first_row| {
        for (offset, row) in rows.chunks_exact_mut(width * 4).enumerate() {
            let from_row = (first_row + offset) as i64 - dy;
            if from_row < 0 || from_row >= layer_height {
                continue;
            }
            let start = (from_row as usize * layer_width + skip) * 4;
            let landing = &mut row[first * 4..(first + span) * 4];
            for (under, over) in each_mut(landing).zip(each(&source[start..start + span * 4])) {
                blend.lay(over, under, opacity);
            }
        }
    });
}

/// Draw a layer scaled about the middle.
///
/// Nearest-neighbour, as `draw_pixmap`'s default quality was, and for the
/// same reason as [`place`]: that call's pipeline is floating point for every
/// pixel, and a zoom is two million of them a frame.
fn scaled(out: &mut PixmapMut<'_>, layer: &Pixmap, scale: f32, opacity: f32, blend: Blend) {
    let Some(opacity) = opacity_of(opacity) else {
        return;
    };
    if scale.is_nan() || scale <= 0.0 {
        return;
    }
    let (width, height) = (out.width() as usize, out.height() as usize);
    let (layer_width, layer_height) = (layer.width(), layer.height());
    // Which pixel of the layer lands on output pixel `at`, along one axis:
    // the output pixel's centre, taken back through the scale about the
    // middle of the output.
    let sample = move |at: usize, middle: f32, size: u32| -> Option<usize> {
        let from = middle + (at as f32 + 0.5 - middle) / scale;
        (from >= 0.0 && from < size as f32).then_some(from as usize)
    };
    let (middle_x, middle_y) = (width as f32 / 2.0, height as f32 / 2.0);
    let columns: Vec<Option<usize>> = (0..width)
        .map(|x| sample(x, middle_x, layer_width))
        .collect();

    let source = layer.data();
    let layer_width = layer_width as usize;
    parallel::for_each_row_band(out.data_mut(), width * 4, |rows, first_row| {
        for (offset, row) in rows.chunks_exact_mut(width * 4).enumerate() {
            let Some(from_row) = sample(first_row + offset, middle_y, layer_height) else {
                continue;
            };
            let line = &source[from_row * layer_width * 4..(from_row + 1) * layer_width * 4];
            for (under, column) in each_mut(row).zip(&columns) {
                if let Some(column) = column {
                    blend.lay(at(line, *column), under, opacity);
                }
            }
        }
    });
}

/// Draw a layer through a mask.
fn through(out: &mut PixmapMut<'_>, layer: &Pixmap, mask: &Mask, blend: Blend) {
    if (out.width(), out.height()) != (layer.width(), layer.height())
        || (mask.width(), mask.height()) != (layer.width(), layer.height())
    {
        return;
    }
    let width = out.width() as usize;
    let (source, coverage) = (layer.data(), mask.data());
    parallel::for_each_row_band(out.data_mut(), width * 4, |rows, first_row| {
        let start = first_row * width;
        let end = start + rows.len() / 4;
        for ((under, over), cover) in each_mut(rows)
            .zip(each(&source[start * 4..end * 4]))
            .zip(&coverage[start..end])
        {
            if *cover != 0 {
                blend.lay(over, under, u32::from(*cover));
            }
        }
    });
}

/// An opacity as a weight out of 255, or `None` when nothing would show.
fn opacity_of(opacity: f32) -> Option<u32> {
    // `NaN` clamps to `NaN`, which `as` turns into 0 — nothing drawn.
    let weight = (opacity.clamp(0.0, 1.0) * 255.0).round() as u32;
    (weight > 0).then_some(weight)
}

/// The RGBA pixels in a run of a pixmap's bytes.
#[inline(always)]
fn each(bytes: &[u8]) -> impl Iterator<Item = [u8; 4]> + '_ {
    bytes
        .chunks_exact(4)
        .map(|pixel| [pixel[0], pixel[1], pixel[2], pixel[3]])
}

/// The RGBA pixels in a run of a pixmap's bytes, to write.
///
/// Byte chunks rather than `as_chunks_mut`, which is newer than the Rust this
/// crate promises to build on; every chunk is four bytes, so the conversion
/// never fails and compiles to nothing.
#[inline(always)]
fn each_mut(bytes: &mut [u8]) -> impl Iterator<Item = &mut [u8; 4]> + '_ {
    bytes
        .chunks_exact_mut(4)
        .filter_map(|pixel| <&mut [u8; 4]>::try_from(pixel).ok())
}

/// The pixel at `index` of a pixmap's bytes.
#[inline(always)]
fn at(bytes: &[u8], index: usize) -> [u8; 4] {
    let start = index * 4;
    [
        bytes[start],
        bytes[start + 1],
        bytes[start + 2],
        bytes[start + 3],
    ]
}

/// One premultiplied pixel over another, the upper one at `opacity` out of
/// 255.
///
/// Premultiplied throughout, so an opacity scales every channel alike and
/// source-over is a multiply-add. Neither can take a channel above its
/// alpha, so what is written stays a valid premultiplied pixel, and no
/// channel's sum can carry into the next.
///
/// On the pixel as one `u32`, two channels at a time, rather than on its
/// four bytes: written per channel, the arithmetic compiled to a function
/// call for every pixel, and a full-screen fade is two million of them.
#[inline(always)]
fn over_at(over: [u8; 4], under: &mut [u8; 4], opacity: u32) {
    let source = u32::from_le_bytes(over);
    let alpha = source >> 24;
    if alpha == 0 {
        return;
    }
    let source = if opacity >= 255 {
        if alpha == 255 {
            *under = over;
            return;
        }
        source
    } else {
        scale_pixel(source, opacity)
    };
    let destination = u32::from_le_bytes(*under);
    *under = (source + scale_pixel(destination, 255 - (source >> 24))).to_le_bytes();
}

/// One premultiplied pixel giving way to another by `amount` out of 255: a
/// straight mix of the two, the upper one's transparency included.
///
/// The two parts can sum to no more than 255 in any channel, so again nothing
/// carries into the next.
#[inline(always)]
fn replace_at(over: [u8; 4], under: &mut [u8; 4], amount: u32) {
    if amount == 0 {
        return;
    }
    if amount >= 255 {
        *under = over;
        return;
    }
    let (over, kept) = (u32::from_le_bytes(over), u32::from_le_bytes(*under));
    if over | kept == 0 {
        // Nothing giving way to nothing: most of a layer of words.
        return;
    }
    *under = (scale_pixel(over, amount) + scale_pixel(kept, 255 - amount)).to_le_bytes();
}

/// Every channel of a pixel multiplied by `by` out of 255, rounded.
#[inline(always)]
fn scale_pixel(pixel: u32, by: u32) -> u32 {
    scale_lanes(pixel & 0x00FF_00FF, by) | (scale_lanes((pixel >> 8) & 0x00FF_00FF, by) << 8)
}

/// The two channels in the low bytes of a `u32`'s halves, each multiplied by
/// `by` and divided by 255, rounded — `(x + 128 + ((x + 128) >> 8)) >> 8` in
/// both halves at once. A channel times 255 fits in a half without carrying.
#[inline(always)]
fn scale_lanes(lanes: u32, by: u32) -> u32 {
    let scaled = lanes * by + 0x0080_0080;
    ((scaled + ((scaled >> 8) & 0x00FF_00FF)) >> 8) & 0x00FF_00FF
}

/// Two pixels mixed, `weight` out of 256 of the second.
#[inline(always)]
fn mix(first: u32, second: u32, weight: u32) -> u32 {
    let keep = 256 - weight;
    let lanes = |pixel: u32| pixel & 0x00FF_00FF;
    let mixed = |first: u32, second: u32| {
        ((lanes(first) * keep + lanes(second) * weight + 0x0080_0080) >> 8) & 0x00FF_00FF
    };
    mixed(first, second) | (mixed(first >> 8, second >> 8) << 8)
}

/// The part of the screen a wipe has uncovered.
fn wipe_mask(width: u32, height: u32, direction: Direction, progress: f32) -> Option<Mask> {
    let (w, h) = (width as f32, height as f32);
    let rect = match direction {
        Direction::Right | Direction::Diagonal => {
            tiny_skia::Rect::from_xywh(0.0, 0.0, w * progress, h)
        }
        Direction::Left => tiny_skia::Rect::from_xywh(w * (1.0 - progress), 0.0, w * progress, h),
        Direction::Down => tiny_skia::Rect::from_xywh(0.0, 0.0, w, h * progress),
        Direction::Up => tiny_skia::Rect::from_xywh(0.0, h * (1.0 - progress), w, h * progress),
        // Outwards from the middle, and inwards to it.
        Direction::Out | Direction::Clockwise | Direction::CounterClockwise => {
            tiny_skia::Rect::from_xywh(w / 2.0 * (1.0 - progress), 0.0, w * progress, h)
        }
        Direction::In => tiny_skia::Rect::from_xywh(0.0, 0.0, w, h * progress),
    }?;
    let mut mask = Mask::new(width, height)?;
    let path = PathBuilder::from_rect(rect);
    mask.fill_path(&path, FillRule::Winding, true, Transform::identity());
    Some(mask)
}

/// The part of the screen a shape has uncovered.
///
/// A circle by default — the reveals and the irises — grown from the middle,
/// or shrunk towards it for the closing ones.
fn shape_mask(width: u32, height: u32, direction: Direction, progress: f32) -> Option<Mask> {
    let (w, h) = (width as f32, height as f32);
    // The corner distance, so the shape has covered everything at 1.
    let full = (w * w + h * h).sqrt() / 2.0;
    let radius = match direction {
        Direction::In => full * (1.0 - progress),
        _ => full * progress,
    };
    if radius <= 0.0 {
        return Mask::new(width, height);
    }
    let mut mask = Mask::new(width, height)?;
    let mut builder = PathBuilder::new();
    builder.push_circle(w / 2.0, h / 2.0, radius);
    let path = builder.finish()?;
    mask.fill_path(&path, FillRule::Winding, true, Transform::identity());
    // Closing shapes uncover everything *outside* the circle.
    if direction == Direction::In {
        invert(&mut mask, width, height);
    }
    Some(mask)
}

/// Turn a mask inside out.
fn invert(mask: &mut Mask, width: u32, height: u32) {
    let mut inverted = match Mask::new(width, height) {
        Some(mask) => mask,
        None => return,
    };
    let rect = match tiny_skia::Rect::from_xywh(0.0, 0.0, width as f32, height as f32) {
        Some(rect) => rect,
        None => return,
    };
    inverted.fill_path(
        &PathBuilder::from_rect(rect),
        FillRule::Winding,
        true,
        Transform::identity(),
    );
    for (out, inside) in inverted.data_mut().iter_mut().zip(mask.data()) {
        *out = out.saturating_sub(*inside);
    }
    *mask = inverted;
}

/// A cross-fade from `from` to `to`, the two softened by a blur of `sigma`
/// pixels.
///
/// Crossed first and blurred once, rather than each blurred and then
/// crossed. A blur is linear, so for the opaque pictures of a whole-slide
/// transition the answer is the same; for the layers of a changed-elements
/// one it differs only at the edges of what moves, which are out of focus
/// anyway. It halves the work.
///
/// Blurred at a quarter of the size and drawn back up, rather than at full
/// size: the full-size blur cost 125 ms a picture at 1920x1200, so the
/// audience saw four frames of a 600 ms transition. A quarter-size picture is
/// a sixteenth of the work, and what a blur throws away is exactly the
/// detail the smaller picture lacks.
///
/// Shrinking and growing again softens by about [`SHRUNK_SOFTNESS`] on its
/// own. A blur weaker than that is drawn as a mix of the sharp pictures and
/// the shrunk ones, so the start and end of the transition ease out of focus
/// rather than jumping to it.
fn blurred_between(out: &mut PixmapMut<'_>, from: &Pixmap, to: &Pixmap, sigma: f32, progress: f32) {
    if sigma.is_nan() || sigma < 0.5 {
        place(out, from, 0.0, 0.0, 1.0, Blend::Over);
        place(out, to, 0.0, 0.0, progress, Blend::Replace);
        return;
    }
    let (width, height) = (out.width() as usize, out.height() as usize);
    let fits =
        |layer: &Pixmap| (layer.width() as usize, layer.height() as usize) == (width, height);
    if !fits(from) || !fits(to) {
        return;
    }

    // The outgoing picture giving way to the arriving one by as much as the
    // cross-fade has reached — as `Blend::Replace` does for a fade.
    let arriving = opacity_of(progress).unwrap_or(0);
    let crossed = move |under: [u8; 4], over: [u8; 4]| -> [u8; 4] {
        let mut pixel = under;
        replace_at(over, &mut pixel, arriving);
        pixel
    };
    let (from_pixels, to_pixels) = (from.data(), to.data());

    let (mut small, small_width, small_height) = shrink(from_pixels, width, height);
    let (small_to, _, _) = shrink(to_pixels, width, height);
    for (under, over) in small.iter_mut().zip(&small_to) {
        *under = crossed(*under, *over);
    }
    let mut small: Vec<tiny_skia::PremultipliedColorU8> = small
        .iter()
        .map(|&[red, green, blue, alpha]| {
            tiny_skia::PremultipliedColorU8::from_rgba(red, green, blue, alpha)
                .unwrap_or(tiny_skia::PremultipliedColorU8::TRANSPARENT)
        })
        .collect();
    // What the blur adds to what shrinking already did: blurs compose as the
    // sum of their variances.
    let remaining = (sigma * sigma - SHRUNK_SOFTNESS * SHRUNK_SOFTNESS)
        .max(0.0)
        .sqrt();
    filters::blur(
        &mut small,
        small_width,
        small_height,
        remaining / SHRINK as f32,
        1.0,
    );
    let small: Vec<u32> = small
        .iter()
        .map(|pixel| u32::from_le_bytes([pixel.red(), pixel.green(), pixel.blue(), pixel.alpha()]))
        .collect();
    // How much of the sharp pictures is left, out of 256.
    let sharp = (256.0 * (1.0 - sigma / SHRUNK_SOFTNESS)).clamp(0.0, 256.0) as u32;

    // For each output column: the two small columns either side of it, and
    // how far towards the second it is, out of 256. The same for rows.
    let taps = |size: usize, small_size: usize| -> Vec<(usize, usize, u32)> {
        (0..size)
            .map(|at| {
                let from = ((at as f32 + 0.5) / SHRINK as f32 - 0.5).max(0.0);
                let first = (from as usize).min(small_size - 1);
                let second = (first + 1).min(small_size - 1);
                (first, second, ((from - first as f32) * 256.0) as u32)
            })
            .collect()
    };
    let (columns, rows) = (taps(width, small_width), taps(height, small_height));
    let small = &small;

    parallel::for_each_row_band(out.data_mut(), width * 4, |band, first_row| {
        // The small row that belongs at this output row, mixed from the two
        // either side of it once, so each output pixel mixes only across.
        let mut line = vec![0u32; small_width];
        for (offset, row) in band.chunks_exact_mut(width * 4).enumerate() {
            let y = first_row + offset;
            let (top, bottom, down) = rows[y];
            let top = &small[top * small_width..(top + 1) * small_width];
            let bottom = &small[bottom * small_width..(bottom + 1) * small_width];
            for ((mixed, upper), lower) in line.iter_mut().zip(top).zip(bottom) {
                *mixed = mix(*upper, *lower, down);
            }
            let start = y * width;
            for (x, (under, &(left, right, across))) in each_mut(row).zip(&columns).enumerate() {
                let soft = mix(line[left], line[right], across);
                let pixel = if sharp == 0 {
                    soft
                } else {
                    let crisp = crossed(at(from_pixels, start + x), at(to_pixels, start + x));
                    mix(soft, u32::from_le_bytes(crisp), sharp)
                };
                over_at(pixel.to_le_bytes(), under, 255);
            }
        }
    });
}

/// How many pixels a side of the full picture each pixel of the shrunk one
/// stands for.
const SHRINK: usize = 4;

/// Roughly how soft shrinking by [`SHRINK`] and growing back leaves a
/// picture, as a blur's deviation in full-size pixels: the average over four
/// pixels, then the interpolation back across four.
const SHRUNK_SOFTNESS: f32 = 2.0;

/// A picture at a [`SHRINK`]th of the size each way, each pixel the average
/// of the ones it stands for.
///
/// Averaging premultiplied pixels keeps them premultiplied, so what comes out
/// can be blended and blurred as it is.
fn shrink(source: &[u8], width: usize, height: usize) -> (Vec<[u8; 4]>, usize, usize) {
    let (small_width, small_height) = (width.div_ceil(SHRINK), height.div_ceil(SHRINK));
    let mut small = vec![[0u8; 4]; small_width * small_height];
    parallel::for_each_row_band(&mut small, small_width, |band, first_row| {
        for (offset, row) in band.chunks_exact_mut(small_width).enumerate() {
            let top = (first_row + offset) * SHRINK;
            let bottom = (top + SHRINK).min(height);
            for (column, pixel) in row.iter_mut().enumerate() {
                let left = column * SHRINK;
                let right = (left + SHRINK).min(width);
                let mut sums = [0u32; 4];
                for y in top..bottom {
                    for over in each(&source[(y * width + left) * 4..(y * width + right) * 4]) {
                        for channel in 0..4 {
                            sums[channel] += u32::from(over[channel]);
                        }
                    }
                }
                let count = ((bottom - top) * (right - left)) as u32;
                let half = count / 2;
                for channel in 0..4 {
                    pixel[channel] = ((sums[channel] + half) / count).min(255) as u8;
                }
            }
        }
    });
    (small, small_width, small_height)
}

/// A mask that lets everything through. Kept for the tests and for the
/// primitives that build one only some of the time.
#[cfg(test)]
fn open_mask(width: u32, height: u32) -> Option<Mask> {
    let mut mask = Mask::new(width, height)?;
    let rect = tiny_skia::Rect::from_xywh(0.0, 0.0, width as f32, height as f32)?;
    mask.fill_path(
        &PathBuilder::from_rect(rect),
        FillRule::Winding,
        true,
        Transform::identity(),
    );
    Some(mask)
}

#[cfg(test)]
mod tests {
    use super::*;

    const W: u32 = 40;
    const H: u32 = 20;

    fn filled(red: u8, green: u8, blue: u8) -> Pixmap {
        let mut pixmap = Pixmap::new(W, H).expect("a pixmap");
        pixmap.fill(tiny_skia::Color::from_rgba8(red, green, blue, 255));
        pixmap
    }

    fn at(pixmap: &Pixmap, x: u32, y: u32) -> (u8, u8, u8) {
        let pixel = pixmap.pixel(x, y).expect("a pixel");
        (pixel.red(), pixel.green(), pixel.blue())
    }

    fn drawn(primitive: Primitive, direction: Direction, progress: f64) -> Pixmap {
        let (from, to) = (filled(255, 0, 0), filled(0, 0, 255));
        let mut out = Pixmap::new(W, H).expect("a pixmap");
        draw(
            &mut out.as_mut(),
            &from,
            &to,
            primitive,
            direction,
            progress,
        );
        out
    }

    #[test]
    fn every_transition_starts_on_the_old_picture_and_ends_on_the_new_one() {
        for primitive in [
            Primitive::Fade,
            Primitive::Slide,
            Primitive::Push,
            Primitive::Cover,
            Primitive::Reveal,
            Primitive::Wipe,
            Primitive::Shape,
            Primitive::Zoom,
            Primitive::Blur,
            Primitive::DipToColor,
        ] {
            let start = drawn(primitive, Direction::Left, 0.0);
            let end = drawn(primitive, Direction::Left, 1.0);
            assert_eq!(at(&start, W / 2, H / 2), (255, 0, 0), "{primitive:?} at 0");
            assert_eq!(at(&end, W / 2, H / 2), (0, 0, 255), "{primitive:?} at 1");
        }
    }

    #[test]
    fn a_fade_is_both_pictures_at_once_and_a_dip_is_neither() {
        let (red, green, blue) = at(&drawn(Primitive::Fade, Direction::Left, 0.5), W / 2, H / 2);
        assert!(red > 0 && blue > 0, "halfway through a fade shows both");

        let middle = at(
            &drawn(Primitive::DipToColor, Direction::Left, 0.5),
            W / 2,
            H / 2,
        );
        assert_eq!(middle, (0, 0, 0), "a dip passes through the colour");
        assert_eq!(green, 0);
    }

    #[test]
    fn a_wipe_uncovers_the_new_picture_from_the_side_it_was_asked_for() {
        let half = drawn(Primitive::Wipe, Direction::Right, 0.5);
        assert_eq!(at(&half, 2, H / 2), (0, 0, 255), "the left has been wiped");
        assert_eq!(at(&half, W - 2, H / 2), (255, 0, 0), "the right has not");

        let other = drawn(Primitive::Wipe, Direction::Left, 0.5);
        assert_eq!(at(&other, W - 2, H / 2), (0, 0, 255));
        assert_eq!(at(&other, 2, H / 2), (255, 0, 0));
    }

    #[test]
    fn a_slide_moves_both_pictures_and_a_cover_moves_only_the_new_one() {
        // Halfway through a slide to the left, the new picture holds the right
        // half and the old one the left.
        let sliding = drawn(Primitive::Slide, Direction::Right, 0.5);
        assert_eq!(at(&sliding, 2, H / 2), (0, 0, 255));
        assert_eq!(at(&sliding, W - 2, H / 2), (255, 0, 0));

        // A reveal leaves the new picture still and takes the old one away.
        let revealing = drawn(Primitive::Reveal, Direction::Right, 0.5);
        assert_eq!(at(&revealing, 2, H / 2), (0, 0, 255));
        assert_eq!(at(&revealing, W - 2, H / 2), (255, 0, 0));
    }

    #[test]
    fn a_circle_opens_from_the_middle_and_closes_towards_it() {
        let opening = drawn(Primitive::Shape, Direction::Out, 0.5);
        assert_eq!(at(&opening, W / 2, H / 2), (0, 0, 255), "the middle first");
        assert_eq!(at(&opening, 0, 0), (255, 0, 0), "the corner last");

        let closing = drawn(Primitive::Shape, Direction::In, 0.5);
        assert_eq!(at(&closing, 0, 0), (0, 0, 255), "the corner first");
        assert_eq!(at(&closing, W / 2, H / 2), (255, 0, 0), "the middle last");
    }

    #[test]
    fn progress_outside_the_transition_does_not_draw_outside_the_picture() {
        for primitive in [
            Primitive::Slide,
            Primitive::Wipe,
            Primitive::Shape,
            Primitive::Zoom,
        ] {
            // What `Back` and `Elastic` hand over at their extremes.
            let under = drawn(primitive, Direction::Left, -0.4);
            let over = drawn(primitive, Direction::Left, 1.4);
            assert_eq!(at(&under, W / 2, H / 2), (255, 0, 0), "{primitive:?}");
            assert_eq!(at(&over, W / 2, H / 2), (0, 0, 255), "{primitive:?}");
        }
    }

    /// Words on nothing, as a changed-elements transition hands them over:
    /// opaque in a block on one side, transparent everywhere else.
    fn words(red: u8, green: u8, blue: u8, left: bool) -> Pixmap {
        let mut pixmap = Pixmap::new(W, H).expect("a pixmap");
        let x = if left { 2.0 } else { W as f32 / 2.0 + 2.0 };
        let rect = tiny_skia::Rect::from_xywh(x, 4.0, W as f32 / 2.0 - 4.0, H as f32 - 8.0)
            .expect("a rect");
        let mut paint = tiny_skia::Paint::default();
        paint.set_color_rgba8(red, green, blue, 255);
        pixmap.fill_rect(rect, &paint, Transform::identity(), None);
        pixmap
    }

    fn alpha(pixmap: &Pixmap, x: u32, y: u32) -> u8 {
        pixmap.pixel(x, y).expect("a pixel").alpha()
    }

    fn drawn_words(primitive: Primitive, direction: Direction, progress: f64) -> Pixmap {
        let (from, to) = (words(255, 0, 0, true), words(0, 0, 255, false));
        let mut out = Pixmap::new(W, H).expect("a pixmap");
        draw(
            &mut out.as_mut(),
            &from,
            &to,
            primitive,
            direction,
            progress,
        );
        out
    }

    #[test]
    fn a_fade_of_words_takes_the_old_ones_away_as_it_brings_the_new() {
        // Laid over them, the old words stayed at full strength for the whole
        // fade and vanished at once at the end — the jump that made the
        // default transition look anything but smooth.
        let old_words = (W / 4, H / 2);
        let new_words = (3 * W / 4, H / 2);
        let halfway = drawn_words(Primitive::Fade, Direction::Left, 0.5);
        let old = alpha(&halfway, old_words.0, old_words.1);
        let new = alpha(&halfway, new_words.0, new_words.1);
        assert!(
            (120..=135).contains(&old),
            "the old words are half gone: {old}"
        );
        assert!(
            (120..=135).contains(&new),
            "the new words are half there: {new}"
        );

        let nearly = drawn_words(Primitive::Fade, Direction::Left, 0.95);
        assert!(
            alpha(&nearly, old_words.0, old_words.1) < 20,
            "the old words have all but gone"
        );

        let start = drawn_words(Primitive::Fade, Direction::Left, 0.0);
        assert_eq!(alpha(&start, old_words.0, old_words.1), 255);
        assert_eq!(alpha(&start, new_words.0, new_words.1), 0);
    }

    #[test]
    fn a_wipe_or_a_cover_takes_the_old_words_where_it_has_passed() {
        // Wiped from the left, halfway: the left half is the new picture —
        // which has nothing there — so the old words on the left are gone.
        let wiped = drawn_words(Primitive::Wipe, Direction::Right, 0.55);
        assert_eq!(
            alpha(&wiped, W / 4, H / 2),
            0,
            "the wipe took the old words"
        );

        // Covered by the new picture coming in from the right: where it has
        // arrived, the old words are under it and do not show through.
        let covered = drawn_words(Primitive::Cover, Direction::Left, 0.9);
        assert_eq!(
            alpha(&covered, W / 4, H / 2),
            0,
            "the cover hid the old words"
        );
    }

    #[test]
    fn whole_pictures_cross_exactly_as_they_always_did() {
        // Opaque pictures are what `Over` already handled; replacing them must
        // change nothing a whole-slide transition draws.
        let (red, _, blue) = at(&drawn(Primitive::Fade, Direction::Left, 0.5), W / 2, H / 2);
        assert!((126..=129).contains(&red) && (126..=129).contains(&blue));
        let opaque = drawn(Primitive::Fade, Direction::Left, 0.5);
        assert_eq!(opaque.pixel(W / 2, H / 2).expect("a pixel").alpha(), 255);
    }

    #[test]
    fn a_mask_that_lets_everything_through_draws_the_whole_picture() {
        let mask = open_mask(W, H).expect("a mask");
        let mut out = Pixmap::new(W, H).expect("a pixmap");
        through(&mut out.as_mut(), &filled(0, 255, 0), &mask, Blend::Replace);
        assert_eq!(at(&out, 0, 0), (0, 255, 0));
        assert_eq!(at(&out, W - 1, H - 1), (0, 255, 0));
    }
}
