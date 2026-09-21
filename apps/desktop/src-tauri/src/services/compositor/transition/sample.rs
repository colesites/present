//! A picture of a transition at one moment, for the picker.
//!
//! The tiles in the picker run **the transition engine**, not an imitation of
//! it in CSS: what an operator sees when they hover over `Circle Reveal` is
//! the same code that will run in front of the congregation, so a preset
//! cannot look like one thing in the menu and be another on the screen.
//!
//! The two slides are canned and deliberately plain — a colour and a bar where
//! the words would be — because a thumbnail is forty pixels tall and the thing
//! being judged is the movement.

use tiny_skia::{Color, FillRule, Paint, PathBuilder, Pixmap, Rect, Transform};

use super::config::Direction;
use super::registry;

/// The largest a sample is drawn. A tile, not a projector.
pub const MAX_SIDE: u32 = 480;

/// What the outgoing slide looks like.
const BEFORE: (u8, u8, u8) = (28, 32, 54);
/// And the incoming one.
const AFTER: (u8, u8, u8) = (86, 44, 132);

/// One moment of `id`, at `progress`, as premultiplied BGRA.
///
/// `None` for a preset nothing knows about.
pub fn draw(id: &str, progress: f64, width: u32, height: u32) -> Option<Pixmap> {
    let preset = registry::find(id)?;
    let primitive = preset.primitive.fallback();
    let direction = preset.direction.unwrap_or(Direction::Left);
    let width = width.clamp(16, MAX_SIDE);
    let height = height.clamp(16, MAX_SIDE);

    let from = slide(width, height, BEFORE, 0.30);
    let to = slide(width, height, AFTER, 0.55);
    let mut out = Pixmap::new(width, height)?;
    super::draw::draw(
        &mut out.as_mut(),
        &from,
        &to,
        primitive,
        direction,
        progress,
    );
    Some(out)
}

/// A slide: a flat colour with a bar across it where the words would be.
fn slide(width: u32, height: u32, colour: (u8, u8, u8), bar_at: f32) -> Pixmap {
    let mut pixmap = Pixmap::new(width, height).unwrap_or_else(|| {
        Pixmap::new(1, 1).expect("a pixel")
    });
    pixmap.fill(Color::from_rgba8(colour.0, colour.1, colour.2, 255));

    let (w, h) = (width as f32, height as f32);
    let bar = Rect::from_xywh(w * 0.18, h * bar_at, w * 0.64, h * 0.14);
    if let Some(bar) = bar {
        let mut paint = Paint {
            anti_alias: true,
            ..Paint::default()
        };
        paint.set_color(Color::from_rgba8(255, 255, 255, 210));
        pixmap.fill_path(
            &PathBuilder::from_rect(bar),
            &paint,
            FillRule::Winding,
            Transform::identity(),
            None,
        );
    }
    pixmap
}

/// Whether this preset is one the engine draws, or one standing in as a fade.
pub fn is_drawn(id: &str) -> bool {
    registry::find(id).is_some_and(|preset| preset.primitive.is_drawn())
}

/// The primitive a sample will actually use, for the tests.
#[cfg(test)]
fn primitive_of(id: &str) -> Option<super::registry::Primitive> {
    registry::find(id).map(|preset| preset.primitive.fallback())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn pixel(pixmap: &Pixmap, x: u32, y: u32) -> (u8, u8, u8) {
        let pixel = pixmap.pixel(x, y).expect("a pixel");
        (pixel.red(), pixel.green(), pixel.blue())
    }

    #[test]
    fn a_sample_starts_on_one_slide_and_ends_on_the_other() {
        let start = draw("fade", 0.0, 80, 45).expect("a sample");
        let end = draw("fade", 1.0, 80, 45).expect("a sample");
        assert_eq!(pixel(&start, 4, 4), BEFORE);
        assert_eq!(pixel(&end, 4, 4), AFTER);
    }

    #[test]
    fn every_transition_in_the_library_can_be_shown() {
        for preset in registry::PRESETS {
            let sample = draw(preset.id, 0.5, 64, 36);
            assert!(sample.is_some(), "{} has no picture", preset.id);
            assert_eq!(
                primitive_of(preset.id).map(super::registry::Primitive::is_drawn),
                Some(true),
                "{} would be shown by something that cannot draw",
                preset.id
            );
        }
    }

    #[test]
    fn a_name_from_somewhere_else_has_no_picture() {
        assert!(draw("invented-later", 0.5, 64, 36).is_none());
    }

    #[test]
    fn a_sample_is_a_tile_however_big_it_is_asked_for() {
        let huge = draw("fade", 0.5, 4000, 4000).expect("a sample");
        assert_eq!((huge.width(), huge.height()), (MAX_SIDE, MAX_SIDE));
        let tiny = draw("fade", 0.5, 1, 1).expect("a sample");
        assert_eq!((tiny.width(), tiny.height()), (16, 16));
    }

    #[test]
    fn the_ones_that_need_a_gpu_say_so_rather_than_pretending() {
        assert!(is_drawn("fade"));
        assert!(is_drawn("circle-reveal"));
        assert!(!is_drawn("particle-dissolve"));
        assert!(!is_drawn("cube-left"));
    }
}
