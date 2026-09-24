//! A picture of a transition at one moment, for the picker.
//!
//! The tiles in the picker run **the transition engine**, not an imitation of
//! it in CSS: what an operator sees when they hover over `Circle Reveal` is
//! the same code that will run in front of the congregation, so a preset
//! cannot look like one thing in the menu and be another on the screen.
//!
//! And what crosses is what an operator actually puts on a screen: two lines
//! of a hymn over a moving background, the words drawn by the compositor that
//! draws the audience output. The background plays through the tile, so a
//! changed-elements transition shows what it is for — the words change while
//! the video carries on — and a whole-slide one crosses the whole picture.
//! It replaced two flat colours with a white bar where the words would be,
//! which showed the movement and nothing of what it would look like.

use std::sync::{Arc, Mutex, OnceLock};

use tiny_skia::{Color, FilterQuality, IntSize, Pixmap, PixmapPaint, Transform};

use super::config::{Direction, Mode};
use super::registry;
use crate::services::compositor::SceneCompositor;
use crate::services::output::OutputScene;

/// The largest a sample is drawn. A tile, not a projector.
pub const MAX_SIDE: u32 = 480;

/// The footage: a motion background, its frames one under another.
///
/// Made by `scripts/make-transition-sample.sh`. Generated rather than filmed,
/// so there is nobody's footage in the app, and it can be made again.
const FOOTAGE: &[u8] = include_bytes!("../../../../assets/transition-sample.jpg");

/// How many frames it holds: one for every step of a tile's play
/// (`TransitionTile.tsx`'s `STEPS`, and the last).
const FOOTAGE_FRAMES: u32 = 17;

/// The words on each side of the change: the first lines of "Amazing Grace"
/// (John Newton, 1779), the hymn most likely to be on a screen somewhere.
const BEFORE: &str = "Amazing grace,\nhow sweet the sound";
const AFTER: &str = "That saved a wretch\nlike me";

/// One moment of `id`, at `progress`, as the operator's `mode` would draw it.
///
/// `None` for a preset nothing knows about.
pub fn draw(id: &str, progress: f64, width: u32, height: u32, mode: Mode) -> Option<Pixmap> {
    let preset = registry::find(id)?;
    let primitive = preset.primitive.fallback();
    let direction = preset.direction.unwrap_or(Direction::Left);
    let width = width.clamp(16, MAX_SIDE);
    let height = height.clamp(16, MAX_SIDE);

    let stock = stock(width, height)?;
    let playing = stock.frames.get(step_of(progress))?;

    match mode {
        Mode::ChangedElements => {
            // Only the words cross, drawn on nothing and laid over the video
            // as it plays — as the compositor draws them on the audience
            // screen.
            let mut moving = Pixmap::new(width, height)?;
            super::draw::draw(
                &mut moving.as_mut(),
                &stock.before,
                &stock.after,
                primitive,
                direction,
                progress,
            );
            let mut out = playing.clone();
            lay_over(&mut out, &moving);
            Some(out)
        }
        Mode::FullSlide => {
            // The picture as it stood the moment the slide changed, crossing
            // to the picture now.
            let mut from = stock.frames.first()?.clone();
            lay_over(&mut from, &stock.before);
            let mut to = playing.clone();
            lay_over(&mut to, &stock.after);

            let mut out = Pixmap::new(width, height)?;
            out.fill(Color::BLACK);
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
    }
}

/// Which frame of the footage belongs at `progress`.
fn step_of(progress: f64) -> usize {
    // `NaN` clamps to `NaN`, which `as` makes the first frame.
    (progress.clamp(0.0, 1.0) * f64::from(FOOTAGE_FRAMES - 1)).round() as usize
}

/// Everything a sample of one size is drawn from.
struct Stock {
    size: (u32, u32),
    frames: Vec<Pixmap>,
    before: Pixmap,
    after: Pixmap,
}

/// The stock for this size, made the first time it is asked for.
///
/// A picker asks for seventeen frames of each of a hundred and eight presets,
/// all at one size, all at once. Laying the words out and scaling the footage
/// for every one of those would be the cost of opening the menu; this does it
/// once, and each frame after that is only the transition itself.
fn stock(width: u32, height: u32) -> Option<Arc<Stock>> {
    static STOCK: Mutex<Option<Arc<Stock>>> = Mutex::new(None);

    let mut held = STOCK
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    if let Some(stock) = held.as_ref().filter(|stock| stock.size == (width, height)) {
        return Some(Arc::clone(stock));
    }
    let stock = Arc::new(Stock {
        size: (width, height),
        frames: footage()?
            .iter()
            .map(|frame| filled(frame, width, height))
            .collect::<Option<_>>()?,
        before: words(BEFORE, width, height)?,
        after: words(AFTER, width, height)?,
    });
    *held = Some(Arc::clone(&stock));
    Some(stock)
}

/// The footage's frames, decoded once.
fn footage() -> Option<&'static [Pixmap]> {
    static FRAMES: OnceLock<Option<Vec<Pixmap>>> = OnceLock::new();
    FRAMES
        .get_or_init(|| {
            let sheet = image::load_from_memory_with_format(FOOTAGE, image::ImageFormat::Jpeg)
                .ok()?
                .to_rgba8();
            let (width, height) = (sheet.width(), sheet.height() / FOOTAGE_FRAMES);
            let size = IntSize::from_wh(width, height)?;
            let frame_bytes = width as usize * height as usize * 4;
            // A JPEG is opaque, and an opaque pixel is its own premultiplied
            // form, so the bytes go in as they come out.
            sheet
                .as_raw()
                .chunks_exact(frame_bytes)
                .take(FOOTAGE_FRAMES as usize)
                .map(|bytes| Pixmap::from_vec(bytes.to_vec(), size))
                .collect()
        })
        .as_deref()
}

/// A frame of footage filling `width` by `height`, cropped rather than
/// letterboxed, as a background fills a screen.
fn filled(frame: &Pixmap, width: u32, height: u32) -> Option<Pixmap> {
    if (frame.width(), frame.height()) == (width, height) {
        return Some(frame.clone());
    }
    let (from_width, from_height) = (frame.width() as f32, frame.height() as f32);
    let scale = (width as f32 / from_width).max(height as f32 / from_height);
    let mut out = Pixmap::new(width, height)?;
    out.draw_pixmap(
        0,
        0,
        frame.as_ref(),
        &PixmapPaint {
            quality: FilterQuality::Bilinear,
            ..PixmapPaint::default()
        },
        Transform::from_translate(
            (width as f32 - from_width * scale) / 2.0,
            (height as f32 - from_height * scale) / 2.0,
        )
        .pre_scale(scale, scale),
        None,
    );
    Some(out)
}

/// Lines of a hymn as a slide sets them: large, white, centred, on nothing.
fn words(text: &str, width: u32, height: u32) -> Option<Pixmap> {
    let scene = OutputScene {
        show_text: true,
        slide_canvas_size: Some("1920x1080".to_owned()),
        slide_elements: Some(serde_json::json!([{
            "id": "lyrics",
            "type": "text",
            "x": 120.0, "y": 290.0, "width": 1680.0, "height": 500.0,
            "content": text,
            "style": {
                "fontSize": 124.0,
                "fontWeight": "700",
                "color": "#ffffff",
                "textAlign": "center",
                "verticalAlign": "middle",
                "shadow": "0 6px 24px rgba(0, 0, 0, 0.55)"
            }
        }])),
        ..OutputScene::default()
    };
    SceneCompositor::new(width, height).slide_layer(&scene)
}

/// Lay one picture over another. Sample-sized, so tiny-skia's own blend.
fn lay_over(out: &mut Pixmap, layer: &Pixmap) {
    out.draw_pixmap(
        0,
        0,
        layer.as_ref(),
        &PixmapPaint::default(),
        Transform::identity(),
        None,
    );
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

    const W: u32 = 320;
    const H: u32 = 180;

    /// A frame of the footage with a side's words over it, as either end of
    /// a sample should be.
    fn still(frame: usize, words: &Pixmap) -> Pixmap {
        let mut picture = footage().expect("the footage")[frame].clone();
        lay_over(&mut picture, words);
        picture
    }

    #[test]
    fn the_footage_is_a_frame_for_every_step_of_a_play() {
        let frames = footage().expect("the footage decodes");
        assert_eq!(frames.len(), FOOTAGE_FRAMES as usize);
        assert!(frames
            .iter()
            .all(|frame| (frame.width(), frame.height()) == (W, H)));
        // It moves: a sample over a still picture would not be footage.
        assert_ne!(frames[0].data(), frames[16].data(), "the background plays");
    }

    #[test]
    fn the_words_are_real_words() {
        let stock = stock(W, H).expect("the stock");
        let drawn = |layer: &Pixmap| {
            layer
                .pixels()
                .iter()
                .filter(|pixel| pixel.alpha() > 128)
                .count()
        };
        // Two lines of 124-pixel type at a sixth of the size: a few thousand
        // pixels each, and not the same ones.
        assert!(drawn(&stock.before) > 1_500, "the first lines are drawn");
        assert!(drawn(&stock.after) > 1_500, "the next lines are drawn");
        assert_ne!(stock.before.data(), stock.after.data());
    }

    #[test]
    fn a_sample_starts_on_one_slide_and_ends_on_the_other() {
        let stock = stock(W, H).expect("the stock");
        for mode in [Mode::ChangedElements, Mode::FullSlide] {
            let start = draw("fade", 0.0, W, H, mode).expect("a sample");
            let end = draw("fade", 1.0, W, H, mode).expect("a sample");
            assert_eq!(
                start.data(),
                still(0, &stock.before).data(),
                "{mode:?} at 0"
            );
            assert_eq!(end.data(), still(16, &stock.after).data(), "{mode:?} at 1");
        }
    }

    #[test]
    fn changing_only_the_words_leaves_the_video_playing_beneath_them() {
        // A corner holds no words, so there the sample is the footage itself,
        // frame for frame, all the way through — which is the difference
        // between the two modes an operator is choosing between.
        let frames = footage().expect("the footage");
        let corner = |pixmap: &Pixmap| pixmap.pixel(4, 4).expect("a pixel");
        for (step, progress) in [(0, 0.0), (8, 0.5), (16, 1.0)] {
            let sample =
                draw("push-left", progress, W, H, Mode::ChangedElements).expect("a sample");
            assert_eq!(corner(&sample), corner(&frames[step]), "at {progress}");
        }
        let whole = draw("push-left", 0.5, W, H, Mode::FullSlide).expect("a sample");
        assert_ne!(
            corner(&whole),
            corner(&frames[8]),
            "a whole-slide push moves the background as well"
        );
    }

    #[test]
    fn every_transition_in_the_library_can_be_shown() {
        for preset in registry::PRESETS {
            let sample = draw(preset.id, 0.5, 64, 36, Mode::ChangedElements);
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
        assert!(draw("invented-later", 0.5, 64, 36, Mode::ChangedElements).is_none());
    }

    #[test]
    fn a_sample_is_a_tile_however_big_it_is_asked_for() {
        let huge = draw("fade", 0.5, 4000, 4000, Mode::ChangedElements).expect("a sample");
        assert_eq!((huge.width(), huge.height()), (MAX_SIDE, MAX_SIDE));
        let tiny = draw("fade", 0.5, 1, 1, Mode::ChangedElements).expect("a sample");
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
