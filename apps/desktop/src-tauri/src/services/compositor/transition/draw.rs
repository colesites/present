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

use tiny_skia::{FillRule, Mask, PathBuilder, Pixmap, PixmapMut, PixmapPaint, Transform};

use super::config::Direction;
use super::registry::Primitive;
use crate::services::compositor::filters;

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

    match primitive {
        // Nothing between: whichever picture belongs now.
        Primitive::Cut => place(out, if progress >= 1.0 { to } else { from }, 0.0, 0.0, 1.0),
        // The outgoing picture is held, then replaced at the end.
        Primitive::Hold => place(out, if progress >= 1.0 { to } else { from }, 0.0, 0.0, 1.0),
        Primitive::Fade => {
            place(out, from, 0.0, 0.0, 1.0);
            place(out, to, 0.0, 0.0, progress);
        }
        Primitive::DipToColor => {
            // Out through the colour and in again, so the two pictures never
            // overlap — which is the difference between a dip and a fade.
            if progress < 0.5 {
                place(out, from, 0.0, 0.0, 1.0 - progress * 2.0);
            } else {
                place(out, to, 0.0, 0.0, (progress - 0.5) * 2.0);
            }
        }
        // The four ways two pictures can pass each other. The pictures move
        // the way the name says — `Slide Right` moves rightwards — so the one
        // arriving comes in from the opposite edge.
        Primitive::Slide | Primitive::Push => {
            let (x, y) = travel(direction, width, height);
            place(out, from, x * progress, y * progress, 1.0);
            place(
                out,
                to,
                x * (progress - TRAVEL),
                y * (progress - TRAVEL),
                1.0,
            );
        }
        // The new one moves in over a still old one.
        Primitive::Cover => {
            let (x, y) = travel(direction, width, height);
            place(out, from, 0.0, 0.0, 1.0);
            place(
                out,
                to,
                x * (progress - TRAVEL),
                y * (progress - TRAVEL),
                1.0,
            );
        }
        // The old one moves away, uncovering a still new one.
        Primitive::Reveal => {
            let (x, y) = travel(direction, width, height);
            place(out, to, 0.0, 0.0, 1.0);
            place(out, from, x * progress, y * progress, 1.0);
        }
        Primitive::Wipe | Primitive::Blinds | Primitive::Split | Primitive::Sweep => {
            place(out, from, 0.0, 0.0, 1.0);
            if let Some(mask) = wipe_mask(out.width(), out.height(), direction, progress) {
                through(out, to, &mask);
            }
        }
        Primitive::RadialWipe | Primitive::Shape => {
            place(out, from, 0.0, 0.0, 1.0);
            if let Some(mask) = shape_mask(out.width(), out.height(), direction, progress) {
                through(out, to, &mask);
            }
        }
        Primitive::Zoom | Primitive::ZoomBlur | Primitive::Rotate => {
            place(out, from, 0.0, 0.0, 1.0);
            let growing = direction != Direction::Out;
            let scale = if growing {
                ZOOM_FROM + (1.0 - ZOOM_FROM) * progress
            } else {
                1.0 + (1.0 - ZOOM_FROM) * (1.0 - progress)
            };
            scaled(out, to, scale, progress);
        }
        Primitive::Blur => {
            // Out of focus and back in, which is what reads as a blur
            // transition — a cross-fade with both sides softened at the point
            // they cross.
            let softness = BLUR_PEAK * (1.0 - (progress * 2.0 - 1.0).abs());
            place(out, &softened(from, softness), 0.0, 0.0, 1.0);
            place(out, &softened(to, softness), 0.0, 0.0, progress);
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
            place(out, from, 0.0, 0.0, 1.0);
            place(out, to, 0.0, 0.0, progress);
        }
    }
}

/// How far a whole screen is, in the direction asked for.
fn travel(direction: Direction, width: f32, height: f32) -> (f32, f32) {
    let (x, y) = direction.vector().unwrap_or((-1.0, 0.0));
    (x as f32 * width, y as f32 * height)
}

/// Draw a layer at an offset and an opacity.
fn place(out: &mut PixmapMut<'_>, layer: &Pixmap, x: f32, y: f32, opacity: f32) {
    if opacity <= 0.0 {
        return;
    }
    out.draw_pixmap(
        0,
        0,
        layer.as_ref(),
        &PixmapPaint {
            opacity: opacity.clamp(0.0, 1.0),
            ..PixmapPaint::default()
        },
        Transform::from_translate(x, y),
        None,
    );
}

/// Draw a layer scaled about the middle.
fn scaled(out: &mut PixmapMut<'_>, layer: &Pixmap, scale: f32, opacity: f32) {
    if opacity <= 0.0 || scale <= 0.0 {
        return;
    }
    let (width, height) = (out.width() as f32, out.height() as f32);
    let transform = Transform::from_translate(width / 2.0, height / 2.0)
        .pre_scale(scale, scale)
        .pre_translate(-width / 2.0, -height / 2.0);
    out.draw_pixmap(
        0,
        0,
        layer.as_ref(),
        &PixmapPaint {
            opacity: opacity.clamp(0.0, 1.0),
            ..PixmapPaint::default()
        },
        transform,
        None,
    );
}

/// Draw a layer through a mask.
fn through(out: &mut PixmapMut<'_>, layer: &Pixmap, mask: &Mask) {
    out.draw_pixmap(
        0,
        0,
        layer.as_ref(),
        &PixmapPaint::default(),
        Transform::identity(),
        Some(mask),
    );
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

/// A softened copy of a layer.
fn softened(layer: &Pixmap, sigma: f32) -> Pixmap {
    let mut copy = layer.clone();
    if sigma >= 0.5 {
        let (width, height) = (copy.width() as usize, copy.height() as usize);
        filters::blur(copy.pixels_mut(), width, height, sigma, 1.0);
    }
    copy
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

    #[test]
    fn a_mask_that_lets_everything_through_draws_the_whole_picture() {
        let mask = open_mask(W, H).expect("a mask");
        let mut out = Pixmap::new(W, H).expect("a pixmap");
        through(&mut out.as_mut(), &filled(0, 255, 0), &mask);
        assert_eq!(at(&out, 0, 0), (0, 255, 0));
        assert_eq!(at(&out, W - 1, H - 1), (0, 255, 0));
    }
}
