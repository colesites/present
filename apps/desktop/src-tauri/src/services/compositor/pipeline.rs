//! The stateful half of the compositor.
//!
//! `scene::render` draws a whole frame from scratch every time, which is the
//! right shape for a test and the wrong one for thirty frames a second.
//! Measured: a static slide costs about 29.5 ms of the 33 ms an NDI frame has,
//! and a 1080p video frame costs another 5 to 12 ms to decode. Added together
//! that is over budget before anything has been blended.
//!
//! The fix is not a faster rasteriser. **A slide does not change while it is on
//! screen.** It can sit unaltered for four minutes of a song while the video
//! behind it moves, so redrawing its text and shapes thirty times a second is
//! work whose result is byte-for-byte identical each time.
//!
//! So the layers are split by how often they change:
//!
//! ```text
//! every frame      background colour
//!                  video frame           ← the only genuinely per-frame work
//! on scene change  slide elements        ← cached, drawn over transparency
//! ```
//!
//! The cached layer is composited over the video with one blit. What used to be
//! a full re-render becomes a fill, a blit and a blit.

use tiny_skia::{Color, Pixmap, Transform};

use crate::services::output::OutputScene;
use crate::services::video::VideoFrame;

use super::scene::{MediaLoader, Rendered};
use super::{color, geometry, images, shapes, Frame};

/// Draws scenes, remembering what it can.
pub struct SceneCompositor {
    width: u32,
    height: u32,
    /// The slide layers over transparency, valid while `cached_for` holds.
    cached_layers: Option<Pixmap>,
    /// The scene the cache was built from. Compared structurally, which is what
    /// typing the scene in Stage 4 bought — the Electron path compared
    /// `JSON.stringify` output on every render (audit §5.5).
    cached_for: Option<OutputScene>,
    /// What the cached layer cost to build, for diagnostics.
    last_rebuild: bool,
    /// The output buffer, kept between frames.
    ///
    /// Eight megabytes at 1920x1080. Allocating and freeing that thirty times a
    /// second is a quarter of a gigabyte a second of allocator traffic for a
    /// buffer whose size only changes when the output does.
    frame: Option<Frame>,
}

impl SceneCompositor {
    pub fn new(width: u32, height: u32) -> Self {
        Self {
            width,
            height,
            cached_layers: None,
            cached_for: None,
            last_rebuild: false,
            frame: None,
        }
    }

    pub fn dimensions(&self) -> (u32, u32) {
        (self.width, self.height)
    }

    /// Whether the last `render` had to redraw the slide layers.
    pub fn rebuilt_last_frame(&self) -> bool {
        self.last_rebuild
    }

    /// Throw the cache away. For a resize, or a font change that would alter
    /// text the scene itself does not describe.
    pub fn invalidate(&mut self) {
        self.cached_layers = None;
        self.cached_for = None;
    }

    /// The frame from the last successful `render`.
    pub fn frame(&self) -> Option<&Frame> {
        self.frame.as_ref()
    }

    /// Take the frame out, giving up the reuse.
    ///
    /// For a caller that wants one frame and is finished — the one-shot
    /// `scene::render`, a diagnostic, a test. A compositor that is going to
    /// draw again should read [`frame`](Self::frame) instead and keep the
    /// buffer.
    pub fn take_frame(&mut self) -> Option<Frame> {
        self.frame.take()
    }

    pub fn resize(&mut self, width: u32, height: u32) {
        if (self.width, self.height) == (width, height) {
            return;
        }
        self.width = width;
        self.height = height;
        self.frame = None;
        self.invalidate();
    }

    /// Compose one frame.
    ///
    /// `video` is the decoded frame for this instant, or `None` when the scene
    /// has no video or none has been decoded yet. It is passed in rather than
    /// pulled here because `services::playback` owns where the video is, and a
    /// compositor that decoded on its own schedule would be a second opinion
    /// about the position (ADR-002).
    pub fn render(
        &mut self,
        scene: &OutputScene,
        video: Option<&VideoFrame>,
        loader: &dyn MediaLoader,
    ) -> Option<(&Frame, Rendered)> {
        let mut report = Rendered::default();

        // Reuse the buffer when it is the right shape. Only its contents change
        // between frames; its size changes when the output does.
        let mut frame = match self.frame.take() {
            Some(frame) if frame.width() == self.width && frame.height() == self.height => frame,
            _ => Frame::new(self.width, self.height)?,
        };

        // The fast path: a video that already matches the frame *is* the
        // background. Overwriting the buffer from its bytes skips the black
        // fill, the colour fill, an intermediate pixmap and a bilinear
        // resample — four passes over two million pixels that reproduce what
        // the video already was.
        let direct_video = video
            .filter(|_| !scene.hide_background && scene.show_media)
            .filter(|frame| frame.width == self.width && frame.height == self.height)
            .filter(|frame| frame.is_well_formed());

        match direct_video {
            Some(video) => {
                if frame.overwrite_from_bgra(&video.bgra) {
                    report.background_media_drawn = true;
                } else {
                    report.background_media_missing = true;
                    frame.clear(Color::BLACK);
                }
            }
            None => {
                if scene.hide_background {
                    frame.clear(Color::BLACK);
                } else if let Some(background) = scene.slide_background_color.as_deref() {
                    // The reused buffer still holds the previous frame, so the
                    // background must cover it rather than assume black.
                    if !shapes::fill_background(&mut frame.pixmap_mut(), background) {
                        frame.clear(Color::BLACK);
                    }
                } else {
                    frame.clear(Color::BLACK);
                }

                if !scene.hide_background && scene.show_media {
                    if let Some(video) = video {
                        self.draw_video(&mut frame, video, &mut report);
                    } else if let Some(url) =
                        scene.media_url.as_deref().filter(|url| !url.is_empty())
                    {
                        draw_still(&mut frame, url, loader, &mut report);
                    }
                }
            }
        }

        // 3. The slide layers, only when the scene has actually changed.
        if let Some(layers) = self.layers_for(scene, loader, &mut report) {
            blend_over(&mut frame, layers);
        }

        self.frame = Some(frame);
        Some((self.frame.as_ref()?, report))
    }

    /// The cached slide layer, rebuilt if the scene moved.
    fn layers_for(
        &mut self,
        scene: &OutputScene,
        loader: &dyn MediaLoader,
        report: &mut Rendered,
    ) -> Option<&Pixmap> {
        let unchanged = self
            .cached_for
            .as_ref()
            .is_some_and(|cached| !layers_differ(cached, scene));

        if unchanged && self.cached_layers.is_some() {
            self.last_rebuild = false;
            // The counts belong to the frame being reported on, not to the one
            // the cache happened to be built from, so they are recomputed.
            // Counting is cheap; drawing is what was expensive.
            if scene.show_text && !scene.screen_composer_enabled {
                for element in scene.slide_elements().unwrap_or_default() {
                    if !element.is_visible() {
                        continue;
                    }
                    if element.element_type.is_composited() {
                        report.elements_drawn += 1;
                    } else {
                        report.elements_deferred += 1;
                    }
                }
            }
            report.overlays_drawn = count_overlays(scene, &mut report.elements_deferred);
            return self.cached_layers.as_ref();
        }

        self.last_rebuild = true;
        let mut layers = Pixmap::new(self.width, self.height)?;
        let viewport =
            geometry::Viewport::new(scene.slide_canvas_size.as_deref(), self.width, self.height);

        if scene.show_text && !scene.screen_composer_enabled {
            for element in scene.slide_elements().unwrap_or_default() {
                if !element.is_visible() {
                    continue;
                }
                if !element.element_type.is_composited() {
                    report.elements_deferred += 1;
                    continue;
                }
                if super::scene::draw_element_into(&mut layers, &element, &viewport, loader) {
                    report.elements_drawn += 1;
                }
            }
        }

        // The screen composer replaces the slide rather than sitting above it:
        // when it is on, the regions are the output. So it is drawn instead of
        // the elements above, not as well as them.
        if scene.screen_composer_enabled {
            if let Some(layout) = scene.screen_composer_layout() {
                let mut view = layers.as_mut();
                let regions = super::overlays::draw_composer(&mut view, &layout, loader);
                report.elements_drawn += regions.drawn;
                report.elements_deferred += regions.deferred;
            }
        }

        // Overlays sit above the slide and below nothing. They live in the
        // cached layer rather than being drawn per frame because they change
        // when the scene does — a banner is put up and taken down by the
        // operator, not animated by the clock.
        {
            let mut view = layers.as_mut();

            if let Some(message) = scene.message_overlay.as_ref() {
                super::overlays::draw_message(&mut view, message);
                report.overlays_drawn += 1;
            }

            let props = super::overlays::draw_props(&mut view, &scene.props_overlay, loader);
            report.overlays_drawn += props.drawn;
            report.elements_deferred += props.deferred;

            if scene.timer_visible {
                super::overlays::draw_timer(&mut view, scene, scene.timer_layout.as_ref());
                report.overlays_drawn += 1;
            }
        }

        self.cached_layers = Some(layers);
        self.cached_for = Some(scene.clone());
        self.cached_layers.as_ref()
    }

    /// Paint a decoded video frame across the whole surface.
    fn draw_video(&self, frame: &mut Frame, video: &VideoFrame, report: &mut Rendered) {
        let Some(pixmap) = video_to_pixmap(video) else {
            report.background_media_missing = true;
            return;
        };

        let (width, height) = (frame.width() as f32, frame.height() as f32);
        images::draw(
            &mut frame.pixmap_mut(),
            &pixmap,
            Transform::identity(),
            width,
            height,
            images::ObjectFit::Cover,
            None,
        );
        report.background_media_drawn = true;
    }
}

fn draw_still(frame: &mut Frame, url: &str, loader: &dyn MediaLoader, report: &mut Rendered) {
    let Some(bytes) = loader.load(url) else {
        report.background_media_missing = true;
        return;
    };
    let Some(decoded) = images::decode(&bytes) else {
        report.background_media_missing = true;
        return;
    };

    let (width, height) = (frame.width() as f32, frame.height() as f32);
    images::draw(
        &mut frame.pixmap_mut(),
        &decoded,
        Transform::identity(),
        width,
        height,
        images::ObjectFit::Cover,
        None,
    );
    report.background_media_drawn = true;
}

/// Composite the cached slide layer onto the frame.
///
/// A hand-written source-over rather than `draw_pixmap`, for two reasons that
/// only showed up once the frame time was measured.
///
/// `draw_pixmap` goes through tiny-skia's shader and pattern machinery, which
/// is the right thing for a transformed or filtered blit and pure overhead for
/// an aligned one-to-one composite.
///
/// And **most of a slide layer is nothing at all.** Lyrics over a video cover
/// maybe a sixth of the screen; the rest of the layer is fully transparent
/// pixels whose contribution is arithmetically zero. Skipping them turns the
/// common case from two million blends into a few hundred thousand.
fn blend_over(frame: &mut Frame, layers: &Pixmap) {
    if frame.width() != layers.width() || frame.height() != layers.height() {
        return;
    }

    super::parallel::zip_bands(
        layers.pixels(),
        frame.pixmap_mut_pixels(),
        |source, destination| {
            for (over, under) in source.iter().zip(destination.iter_mut()) {
                let alpha = over.alpha();
                if alpha == 0 {
                    // Transparent: the frame already holds the answer.
                    continue;
                }
                if alpha == 255 {
                    // Opaque: the frame's pixel does not contribute.
                    *under = *over;
                    continue;
                }

                // Both sides are premultiplied, so source-over is one
                // multiply-add per channel with no division.
                let inverse = 255 - u32::from(alpha);
                let mix = |src: u8, dst: u8| -> u8 {
                    (u32::from(src) + (u32::from(dst) * inverse + 127) / 255).min(255) as u8
                };
                *under = tiny_skia::PremultipliedColorU8::from_rgba(
                    mix(over.red(), under.red()),
                    mix(over.green(), under.green()),
                    mix(over.blue(), under.blue()),
                    (u32::from(alpha) + (u32::from(under.alpha()) * inverse + 127) / 255).min(255)
                        as u8,
                )
                .unwrap_or(*under);
            }
        },
    );
}

/// A decoded frame as something tiny-skia can paint.
///
/// The decoder hands back straight-alpha BGRA and tiny-skia stores
/// premultiplied RGBA, so this reorders and premultiplies in one pass. Video
/// frames are opaque in practice, which is why the common case is a plain
/// channel swap rather than arithmetic.
pub fn video_to_pixmap(video: &VideoFrame) -> Option<Pixmap> {
    if !video.is_well_formed() {
        return None;
    }

    let mut pixmap = Pixmap::new(video.width, video.height)?;
    for (index, pixel) in video.bgra.chunks_exact(4).enumerate() {
        let (b, g, r, a) = (pixel[0], pixel[1], pixel[2], pixel[3]);
        pixmap.pixels_mut()[index] = tiny_skia::ColorU8::from_rgba(r, g, b, a).premultiply();
    }
    Some(pixmap)
}

/// The colour a scene's background resolves to, if any.
pub fn background_color(scene: &OutputScene) -> Option<Color> {
    if scene.hide_background {
        return Some(Color::BLACK);
    }
    scene
        .slide_background_color
        .as_deref()
        .and_then(color::parse)
}

/// Whether the slide layers drawn for `cached` could look different for `scene`.
///
/// Deliberately not [`OutputScene::differs`], which answers "is this worth
/// broadcasting" — and the video's clock is, because the mirrors seek on it.
/// It is not worth redrawing text for. `video_current_time` moves every time
/// the operator's player reports, about ten times a second while a video
/// plays, and comparing it here rebuilt the slide layer — the most expensive
/// thing a frame does — on every report, which is exactly when a frame also
/// has a video to decode. The Stage 5 measurement used a static scene, where
/// the clock never moves, so it could not see this.
///
/// Only the transport is ignored. Nothing in the layers reads it; every other
/// field might.
fn layers_differ(cached: &OutputScene, scene: &OutputScene) -> bool {
    let without_transport = |value: &OutputScene| OutputScene {
        video_current_time: 0.0,
        is_video_playing: false,
        should_sync_time: false,
        ..value.clone()
    };
    without_transport(cached) != without_transport(scene)
}

/// How many overlays a scene shows, without drawing them.
///
/// The cached path needs the counts for the frame it is reporting on, not for
/// the frame the cache happened to be built from. Counting is cheap; drawing is
/// what was worth avoiding.
fn count_overlays(scene: &OutputScene, deferred: &mut usize) -> usize {
    let mut drawn = 0;

    if scene.message_overlay.is_some() {
        drawn += 1;
    }
    for prop in &scene.props_overlay {
        if matches!(prop.kind.as_str(), "image" | "text" | "media") {
            drawn += 1;
        } else {
            *deferred += 1;
        }
    }
    if scene.timer_visible {
        drawn += 1;
    }

    drawn
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    use crate::services::compositor::scene::NoMedia;

    fn scene() -> OutputScene {
        OutputScene {
            show_text: true,
            show_media: true,
            slide_canvas_size: Some("100x100".to_owned()),
            ..OutputScene::default()
        }
    }

    /// A solid video frame of a known colour.
    fn frame_of(width: u32, height: u32, bgra: [u8; 4]) -> VideoFrame {
        VideoFrame {
            width,
            height,
            bgra: bgra
                .iter()
                .copied()
                .cycle()
                .take((width * height * 4) as usize)
                .collect(),
            presentation_seconds: 0.0,
        }
    }

    #[test]
    fn an_unchanged_scene_is_not_redrawn() {
        // The whole point. A slide can sit unaltered for four minutes of a song
        // while the video behind it moves; redrawing its text thirty times a
        // second produces a byte-identical result each time.
        let mut compositor = SceneCompositor::new(100, 100);
        let scene = OutputScene {
            slide_elements: Some(json!([{
                "id": "a", "type": "shape",
                "x": 10.0, "y": 10.0, "width": 80.0, "height": 80.0,
                "style": { "backgroundColor": "#ff0000" }
            }])),
            ..scene()
        };

        compositor.render(&scene, None, &NoMedia).expect("first");
        assert!(
            compositor.rebuilt_last_frame(),
            "the first frame must build the cache"
        );

        compositor.render(&scene, None, &NoMedia).expect("second");
        assert!(
            !compositor.rebuilt_last_frame(),
            "an unchanged scene must reuse it"
        );
    }

    #[test]
    fn a_playing_videos_clock_does_not_redraw_the_slide() {
        // The operator's player reports its position about ten times a second.
        // Each report changes the scene; none of them changes the lyrics.
        let mut compositor = SceneCompositor::new(100, 100);
        let playing = OutputScene {
            slide_elements: Some(json!([{
                "id": "a", "type": "shape",
                "x": 10.0, "y": 10.0, "width": 80.0, "height": 80.0,
                "style": { "backgroundColor": "#ff0000" }
            }])),
            is_video_playing: true,
            video_current_time: 12.0,
            ..scene()
        };
        compositor.render(&playing, None, &NoMedia).expect("first");

        for (time, playing_now, sync) in [
            (12.1, true, false),
            (12.2, true, true),
            (12.2, false, false),
        ] {
            let reported = OutputScene {
                video_current_time: time,
                is_video_playing: playing_now,
                should_sync_time: sync,
                ..playing.clone()
            };
            assert!(
                reported.differs(&playing),
                "the report is still a broadcast"
            );
            compositor
                .render(&reported, None, &NoMedia)
                .expect("report");
            assert!(
                !compositor.rebuilt_last_frame(),
                "a clock report at {time}s must reuse the slide layer"
            );
        }
    }

    #[test]
    fn a_changed_scene_is_redrawn() {
        let mut compositor = SceneCompositor::new(100, 100);
        let first = scene();
        compositor.render(&first, None, &NoMedia).expect("first");

        let second = OutputScene {
            slide_text: Some("Amazing grace".to_owned()),
            ..first
        };
        compositor.render(&second, None, &NoMedia).expect("second");
        assert!(
            compositor.rebuilt_last_frame(),
            "a changed scene must rebuild"
        );
    }

    #[test]
    fn a_cached_frame_looks_the_same_as_a_rebuilt_one() {
        // A cache that returns different pixels is worse than no cache.
        let mut compositor = SceneCompositor::new(100, 100);
        let scene = OutputScene {
            slide_background_color: Some("#0000ff".to_owned()),
            slide_elements: Some(json!([{
                "id": "a", "type": "shape",
                "x": 20.0, "y": 20.0, "width": 60.0, "height": 60.0,
                "style": { "backgroundColor": "#ff0000", "borderRadius": 12.0 }
            }])),
            ..scene()
        };

        // Copied out before the second render: the compositor now hands back a
        // borrow of the buffer it reuses, which is the whole point of reusing.
        let built = compositor
            .render(&scene, None, &NoMedia)
            .expect("first")
            .0
            .as_rgba()
            .to_vec();
        let cached = compositor
            .render(&scene, None, &NoMedia)
            .expect("second")
            .0
            .as_rgba()
            .to_vec();

        assert_eq!(built, cached, "the cached frame differs");
    }

    #[test]
    fn the_reported_counts_are_the_same_whether_cached_or_not() {
        // The counts describe the frame being reported on, not the one the
        // cache happened to be built from.
        let mut compositor = SceneCompositor::new(100, 100);
        let scene = OutputScene {
            slide_elements: Some(json!([
                { "id": "a", "type": "shape", "x": 0.0, "y": 0.0, "width": 50.0, "height": 50.0,
                  "style": { "backgroundColor": "#ff0000" } },
                { "id": "b", "type": "web", "x": 0.0, "y": 0.0, "width": 50.0, "height": 50.0 }
            ])),
            ..scene()
        };

        let (_, first) = compositor.render(&scene, None, &NoMedia).expect("first");
        let (_, second) = compositor.render(&scene, None, &NoMedia).expect("second");

        assert_eq!(first.elements_drawn, 1);
        assert_eq!(first.elements_deferred, 1);
        assert_eq!(first, second, "a cached frame must report what it shows");
    }

    #[test]
    fn a_video_frame_is_painted_under_the_slide() {
        // The layer order that makes lyrics readable over a moving background.
        let mut compositor = SceneCompositor::new(100, 100);
        let scene = OutputScene {
            media_url: Some("local-media://media/loop.mp4".to_owned()),
            slide_elements: Some(json!([{
                "id": "a", "type": "shape",
                "x": 0.0, "y": 0.0, "width": 50.0, "height": 100.0,
                "style": { "backgroundColor": "#ff0000" }
            }])),
            ..scene()
        };

        // Solid green video: B=0, G=255, R=0.
        let video = frame_of(100, 100, [0, 255, 0, 255]);
        let (frame, report) = compositor
            .render(&scene, Some(&video), &NoMedia)
            .expect("frame");

        assert!(report.background_media_drawn);
        assert_eq!(
            frame.pixel_at(75, 50),
            Some((0, 255, 0, 255)),
            "video shows through"
        );
        assert_eq!(
            frame.pixel_at(25, 50),
            Some((255, 0, 0, 255)),
            "the slide covers it"
        );
    }

    #[test]
    fn video_channels_are_not_swapped_on_the_way_in() {
        // The decoder produces BGRA and tiny-skia stores RGBA. Getting this
        // backwards turns skin tones blue, which no assertion about "some
        // colour is present" would catch.
        let mut compositor = SceneCompositor::new(4, 4);
        // Pure red in BGRA is B=0, G=0, R=255.
        let video = frame_of(4, 4, [0, 0, 255, 255]);

        let (frame, _) = compositor
            .render(&scene(), Some(&video), &NoMedia)
            .expect("frame");

        assert_eq!(
            frame.pixel_at(2, 2),
            Some((255, 0, 0, 255)),
            "red must stay red"
        );
    }

    #[test]
    fn a_malformed_video_frame_is_reported_rather_than_drawn() {
        let mut compositor = SceneCompositor::new(100, 100);
        let broken = VideoFrame {
            width: 100,
            height: 100,
            bgra: vec![0; 16],
            presentation_seconds: 0.0,
        };

        let (_, report) = compositor
            .render(&scene(), Some(&broken), &NoMedia)
            .expect("frame");

        assert!(report.background_media_missing);
        assert!(!report.background_media_drawn);
    }

    #[test]
    fn the_media_layer_being_off_hides_the_video() {
        let mut compositor = SceneCompositor::new(100, 100);
        let scene = OutputScene {
            show_media: false,
            slide_background_color: Some("#0000ff".to_owned()),
            ..scene()
        };
        let video = frame_of(100, 100, [0, 255, 0, 255]);

        let (frame, report) = compositor
            .render(&scene, Some(&video), &NoMedia)
            .expect("frame");
        assert!(!report.background_media_drawn);
        assert_eq!(frame.pixel_at(50, 50), Some((0, 0, 255, 255)));
    }

    #[test]
    fn hiding_the_background_hides_the_video_too() {
        let mut compositor = SceneCompositor::new(100, 100);
        let scene = OutputScene {
            hide_background: true,
            ..scene()
        };
        let video = frame_of(100, 100, [0, 255, 0, 255]);

        let (frame, _) = compositor
            .render(&scene, Some(&video), &NoMedia)
            .expect("frame");
        assert_eq!(frame.pixel_at(50, 50), Some((0, 0, 0, 255)));
    }

    #[test]
    fn a_resize_throws_the_cache_away() {
        // The cached layer is sized to the frame, so keeping it across a resize
        // would blit a differently-sized image over the new one.
        let mut compositor = SceneCompositor::new(100, 100);
        compositor.render(&scene(), None, &NoMedia).expect("first");

        compositor.resize(200, 200);
        assert_eq!(compositor.dimensions(), (200, 200));

        let size = {
            let (frame, _) = compositor.render(&scene(), None, &NoMedia).expect("second");
            (frame.width(), frame.height())
        };
        assert!(compositor.rebuilt_last_frame(), "a resize must rebuild");
        assert_eq!(size, (200, 200));
    }

    #[test]
    fn resizing_to_the_same_size_keeps_the_cache() {
        let mut compositor = SceneCompositor::new(100, 100);
        compositor.render(&scene(), None, &NoMedia).expect("first");

        compositor.resize(100, 100);
        compositor.render(&scene(), None, &NoMedia).expect("second");
        assert!(
            !compositor.rebuilt_last_frame(),
            "a no-op resize must not rebuild"
        );
    }

    #[test]
    fn the_composer_replaces_the_slide_rather_than_sitting_over_it() {
        // When the composer is on, the regions *are* the output. Drawing the
        // ordinary slide as well would put two things on the screen at once.
        let mut compositor = SceneCompositor::new(200, 100);
        let scene = OutputScene {
            screen_composer_enabled: true,
            screen_composer_layout: Some(json!({
                "regions": [{
                    "x": 0.0, "y": 0.0, "width": 0.5, "height": 1.0,
                    "source": "slides",
                    "backgroundColor": "#00ff00"
                }]
            })),
            slide_elements: Some(json!([{
                "id": "a", "type": "shape",
                "x": 0.0, "y": 0.0, "width": 100.0, "height": 100.0,
                "style": { "backgroundColor": "#ff0000" }
            }])),
            slide_canvas_size: Some("200x100".to_owned()),
            ..scene()
        };

        let (frame, report) = compositor.render(&scene, None, &NoMedia).expect("frame");

        assert_eq!(
            frame.pixel_at(50, 50),
            Some((0, 255, 0, 255)),
            "the region, not the slide"
        );
        assert_eq!(
            frame.pixel_at(150, 50),
            Some((0, 0, 0, 255)),
            "outside the region"
        );
        assert_eq!(
            report.elements_drawn, 1,
            "one region, not the slide element"
        );
    }

    #[test]
    fn a_camera_region_is_left_to_the_webview_layer() {
        let mut compositor = SceneCompositor::new(200, 100);
        let scene = OutputScene {
            screen_composer_enabled: true,
            screen_composer_layout: Some(json!({
                "regions": [{
                    "x": 0.0, "y": 0.0, "width": 1.0, "height": 1.0,
                    "source": "camera-feed",
                    "backgroundColor": "#00ff00"
                }]
            })),
            ..scene()
        };

        let (frame, report) = compositor.render(&scene, None, &NoMedia).expect("frame");
        assert_eq!(report.elements_deferred, 1);
        assert_eq!(
            frame.pixel_at(100, 50),
            Some((0, 0, 0, 255)),
            "nothing painted where the webview layer goes"
        );
    }

    #[test]
    fn a_message_banner_reaches_the_frame() {
        use crate::services::output::MessageOverlay;

        let mut compositor = SceneCompositor::new(320, 180);
        let scene = OutputScene {
            message_overlay: Some(MessageOverlay {
                id: "m".to_owned(),
                text: "Cry room open".to_owned(),
                position: "top".to_owned(),
                theme_key: "info".to_owned(),
                shown_at_ms: 0.0,
                dismiss_mode: "manual".to_owned(),
                animation: "none".to_owned(),
                speed_seconds: 0.0,
                font_scale: 1.0,
            }),
            ..scene()
        };

        let (frame, report) = compositor.render(&scene, None, &NoMedia).expect("frame");
        assert_eq!(report.overlays_drawn, 1);

        let (_, _, blue, _) = frame.pixel_at(160, 8).expect("pixel");
        assert!(blue > 150, "the info banner should be blue, got {blue}");
    }

    #[test]
    fn overlays_are_counted_the_same_whether_cached_or_not() {
        use crate::services::output::MessageOverlay;

        let mut compositor = SceneCompositor::new(320, 180);
        let scene = OutputScene {
            message_overlay: Some(MessageOverlay {
                id: "m".to_owned(),
                text: "Notice".to_owned(),
                position: "top".to_owned(),
                theme_key: "info".to_owned(),
                shown_at_ms: 0.0,
                dismiss_mode: "manual".to_owned(),
                animation: "none".to_owned(),
                speed_seconds: 0.0,
                font_scale: 1.0,
            }),
            timer_visible: true,
            timer_text: Some("05:00".to_owned()),
            ..scene()
        };

        let (_, first) = compositor.render(&scene, None, &NoMedia).expect("first");
        let (_, second) = compositor.render(&scene, None, &NoMedia).expect("second");

        assert_eq!(first.overlays_drawn, 2, "banner and timer");
        assert_eq!(first, second, "a cached frame must report what it shows");
    }

    #[test]
    fn a_moving_video_does_not_rebuild_the_slide() {
        // The case the whole design exists for: thirty different video frames
        // over one unchanged slide should build the slide exactly once.
        let mut compositor = SceneCompositor::new(100, 100);
        let scene = OutputScene {
            media_url: Some("local-media://media/loop.mp4".to_owned()),
            slide_elements: Some(json!([{
                "id": "a", "type": "text", "content": "Amazing grace",
                "x": 0.0, "y": 0.0, "width": 100.0, "height": 100.0,
                "style": { "fontSize": 12.0 }
            }])),
            ..scene()
        };

        let mut rebuilds = 0;
        for tick in 0..30u8 {
            let video = frame_of(100, 100, [tick, 255 - tick, 128, 255]);
            compositor
                .render(&scene, Some(&video), &NoMedia)
                .expect("frame");
            if compositor.rebuilt_last_frame() {
                rebuilds += 1;
            }
        }

        assert_eq!(
            rebuilds, 1,
            "the slide should be drawn once for thirty frames"
        );
    }
}
