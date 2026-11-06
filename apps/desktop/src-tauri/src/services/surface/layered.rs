//! A screen drawn as layers: the video shown by the GPU as the decoder left
//! it, and the slide drawn over transparency above it.
//!
//! Every frame of a playing video used to cost, for each screen: the frame
//! copied off the GPU, converted to BGRA, copied into the compositor's frame,
//! the slide blended over it, the result swizzled for the view, and copied
//! again into the view's surface — and once more into the preview's. Fifty to
//! sixty megabytes of memory traffic and several milliseconds of processor a
//! frame at 1080p, for a picture whose slide had not changed.
//!
//! Drawn as layers, a new video frame is a new surface on the video layer:
//! no copy, no conversion, nothing drawn. The slide is drawn when it changes,
//! as it already was, into a layer of its own (`SceneCompositor::
//! set_omit_media`), and the window server puts the two together on the GPU
//! with the screen's colour under them (`layers.rs`).
//!
//! **Whole pictures are still drawn where layers cannot show the screen**:
//! a transition that blends whole pictures (it fades the video too), the
//! operator's colour adjustments on the media, the screen composer's regions,
//! a video decoded on the processor, a screen shown in parts over several
//! windows. Going from layers to a whole picture, the screen as it last stood
//! is drawn whole first, from the very frame of video it showed, so a
//! transition starts from exactly what was on screen.

use std::sync::Arc;
use std::time::Instant;

use tiny_skia::Color;

use crate::services::compositor::pipeline::{video_geometry, VideoGeometry};
use crate::services::compositor::transition::Mode;
use crate::services::compositor::{MediaLoader, SceneCompositor};
use crate::services::ndi::video_feed::{Opener, RegionVideos, VideoFeed, Waiting};
use crate::services::output::{MediaKind, OutputScene};
use crate::services::video::resize::Resizer;
use crate::services::video::{contain_size, GpuPicture, VideoFrame};

/// The video on a screen drawn as layers.
#[derive(Clone)]
pub struct VideoLayer {
    pub picture: Arc<GpuPicture>,
    /// Where it goes, in the canvas's pixels.
    pub geometry: VideoGeometry,
    pub seconds: f64,
}

/// What is over the video.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Overlay {
    /// As it was: nothing was drawn.
    Same,
    /// Drawn this time, into the buffer `render` was handed.
    Drawn,
    /// Nothing: the slide, timer and the rest show nothing over the video.
    Empty,
}

/// A screen drawn as layers this time.
#[derive(Clone)]
pub struct Layers {
    pub canvas: (u32, u32),
    /// Under everything: red, green, blue, alpha, 0 to 1.
    pub base: [f64; 4],
    pub video: Option<VideoLayer>,
    pub overlay: Overlay,
}

/// What `ScreenRenderer::render` did.
#[derive(Clone)]
pub enum Drew {
    /// Nothing changed; the screen keeps what it shows.
    Unchanged,
    /// A whole picture, in the buffer it was handed.
    Whole,
    Layers(Layers),
}

/// The scene the last whole picture was drawn from, the video frame in it,
/// and the size.
type DrawnWhole = (Arc<OutputScene>, Option<f64>, (u32, u32));

/// What the layers last showed.
struct Shown {
    scene: Arc<OutputScene>,
    size: (u32, u32),
    overlay_empty: bool,
    /// The video frame on the video layer, kept whole: a picture drawn from it
    /// again is the picture that was on screen.
    video: Option<Arc<VideoFrame>>,
    base: Color,
}

/// One screen's picture, drawn as layers where it can be and whole where it
/// cannot.
pub struct ScreenRenderer {
    compositor: SceneCompositor,
    video: VideoFeed,
    regions: RegionVideos,
    /// For a frame shown on the GPU that has to be drawn whole after all.
    resizer: Resizer,
    whole: Option<DrawnWhole>,
    layers: Option<Shown>,
    base: Color,
    /// Something on the screen moved by itself at the last render.
    busy: bool,
}

impl ScreenRenderer {
    pub fn new(width: u32, height: u32) -> Self {
        Self {
            compositor: SceneCompositor::new(width, height),
            video: VideoFeed::new(),
            regions: RegionVideos::new(),
            resizer: Resizer::new(),
            whole: None,
            layers: None,
            base: Color::BLACK,
            busy: true,
        }
    }

    /// Whether something on the screen moves by itself — a playing video, a
    /// transition, a scrolling message — as of the last render.
    pub fn busy(&self) -> bool {
        self.busy
    }

    /// Where in the video the frame on screen is, as of the last render: for
    /// measuring how closely a screen follows the sound.
    pub fn shown_seconds(&self) -> Option<f64> {
        match (&self.layers, &self.whole) {
            (Some(shown), _) => shown.video.as_ref().map(|frame| frame.presentation_seconds),
            (None, Some((_, seconds, _))) => *seconds,
            (None, None) => None,
        }
    }

    /// The screen's own colour, under everything. `true` if it changed.
    pub fn set_base(&mut self, color: Color) -> bool {
        self.base = color;
        self.compositor.set_base(color)
    }

    /// Draw again next time, whatever has or has not changed: the picture
    /// is laid out differently, though the scene is the same.
    pub fn invalidate(&mut self) {
        self.whole = None;
        self.layers = None;
    }

    /// Draw `scene` at `size`, as layers if `layers` allows it and the scene
    /// can be, into `out` where anything is drawn.
    #[allow(clippy::too_many_arguments)]
    pub fn render(
        &mut self,
        scene: &Arc<OutputScene>,
        size: (u32, u32),
        now: Instant,
        open: &Opener,
        loader: &dyn MediaLoader,
        layers: bool,
        out: &mut Vec<u8>,
    ) -> Result<Drew, String> {
        self.compositor.resize(size.0, size.1);
        self.busy = (scene.is_video_playing && scene.media_type == Some(MediaKind::Video))
            || self.compositor.is_animating()
            || scene
                .message_overlay
                .as_ref()
                .is_some_and(crate::services::compositor::overlays::is_moving)
            || scene.screen_composer_enabled;
        let blending = self.compositor.is_blending_whole_frames()
            || (self.moved(scene) && blends_whole_frames(scene));
        if layers && can_layer(scene) && !blending {
            if let Some(drew) = self.render_layers(scene, size, now, open, loader, out)? {
                return Ok(drew);
            }
        }
        self.render_whole(scene, size, now, open, loader, out)
    }

    /// Whether `scene` is not the one last drawn, in either way.
    fn moved(&self, scene: &Arc<OutputScene>) -> bool {
        let last = self
            .layers
            .as_ref()
            .map(|shown| &shown.scene)
            .or(self.whole.as_ref().map(|(last, _, _)| last));
        !last.is_some_and(|last| Arc::ptr_eq(last, scene) || !last.draws_differently(scene))
    }

    fn render_layers(
        &mut self,
        scene: &Arc<OutputScene>,
        size: (u32, u32),
        now: Instant,
        open: &Opener,
        loader: &dyn MediaLoader,
        out: &mut Vec<u8>,
    ) -> Result<Option<Drew>, String> {
        self.video.set_pictures(true);
        let frame = match self.video.frame_or_wait(scene, now, size, open) {
            Ok(Some(frame)) => {
                let at = std::ptr::from_ref(frame);
                self.video.shared(at)
            }
            Ok(None) => None,
            // The scene's video has not given its first frame: the screen
            // keeps what it shows, as a whole picture would.
            Err(Waiting) if self.layers.is_some() || self.whole.is_some() => {
                return Ok(Some(Drew::Unchanged));
            }
            Err(Waiting) => None,
        };
        // A video decoded on the processor, or none to show: drawn whole.
        let Some((frame, picture)) =
            frame.and_then(|frame| frame.gpu.clone().map(|picture| (frame, picture)))
        else {
            return Ok(None);
        };
        let Some(geometry) = video_geometry(scene, size.0, size.1, (frame.width, frame.height))
        else {
            return Ok(None);
        };

        let fresh_mode = self.compositor.set_omit_media(true);
        let last = self
            .layers
            .as_ref()
            .filter(|_| !fresh_mode)
            .map(|shown| (shown.scene.as_ref(), None, shown.size));
        let redraw = last.is_none() || self.compositor.needs_drawing(last, scene, None, &[], size);
        let overlay = if redraw {
            let (rendered, _) = self
                .compositor
                .render_with_regions(scene, None, &[], loader)
                .ok_or_else(|| {
                    format!(
                        "the compositor could not draw a {}x{} slide",
                        size.0, size.1
                    )
                })?;
            rendered.write_bgra_premultiplied(out);
            if anything_drawn(out) {
                Overlay::Drawn
            } else {
                Overlay::Empty
            }
        } else {
            Overlay::Same
        };

        let previous = self.layers.as_ref();
        let video_moved = !previous
            .and_then(|shown| shown.video.as_ref())
            .is_some_and(|shown| Arc::ptr_eq(shown, &frame));
        let base_moved = previous.is_none_or(|shown| shown.base != self.base);
        let overlay_empty = match overlay {
            Overlay::Same => previous.is_some_and(|shown| shown.overlay_empty),
            Overlay::Drawn => false,
            Overlay::Empty => true,
        };
        let unchanged = overlay == Overlay::Same && !video_moved && !base_moved;
        self.layers = Some(Shown {
            scene: Arc::clone(scene),
            size,
            overlay_empty,
            video: Some(Arc::clone(&frame)),
            base: self.base,
        });
        self.whole = None;
        if unchanged {
            return Ok(Some(Drew::Unchanged));
        }
        Ok(Some(Drew::Layers(Layers {
            canvas: size,
            base: rgba(self.base),
            video: Some(VideoLayer {
                picture,
                geometry,
                seconds: frame.presentation_seconds,
            }),
            overlay,
        })))
    }

    fn render_whole(
        &mut self,
        scene: &Arc<OutputScene>,
        size: (u32, u32),
        now: Instant,
        open: &Opener,
        loader: &dyn MediaLoader,
        out: &mut Vec<u8>,
    ) -> Result<Drew, String> {
        self.video.set_pictures(false);
        let from_layers = self.layers.take();
        if self.compositor.set_omit_media(false) {
            self.whole = None;
        }
        let had_picture = self.whole.is_some() || from_layers.is_some();
        let frame = match self.video.frame_or_wait(scene, now, size, open) {
            Ok(frame) => frame,
            Err(Waiting) if had_picture => {
                // Kept for when the frame arrives: a transition then starts
                // from what is on screen.
                self.layers = from_layers;
                return Ok(Drew::Unchanged);
            }
            Err(Waiting) => None,
        };

        // From layers to a whole picture: the screen as it stood first, from
        // the very frame of video it showed, so that a transition starting
        // now starts from what the audience saw.
        if let Some(shown) = from_layers.filter(|shown| shown.scene.draws_differently(scene)) {
            let old = shown.video.as_ref().and_then(|video| {
                let fitted = contain_size((video.width, video.height), size);
                self.resizer.convert_picture(video, fitted)
            });
            let _ = self
                .compositor
                .render_with_regions(&shown.scene, old.as_ref(), &[], loader);
        }

        let shown = frame.as_ref().map(|frame| frame.presentation_seconds);
        let region_frames = self.regions.frames_for(scene, now, size, open);
        let drawn = self
            .whole
            .as_ref()
            .map(|(scene, video, size)| (scene.as_ref(), *video, *size));
        if !self
            .compositor
            .needs_drawing(drawn, scene, shown, &region_frames, size)
        {
            return Ok(Drew::Unchanged);
        }
        let (rendered, _) = self
            .compositor
            .render_with_regions(scene, frame, &region_frames, loader)
            .ok_or_else(|| {
                format!(
                    "the compositor could not draw a {}x{} frame",
                    size.0, size.1
                )
            })?;
        rendered.write_bgra_premultiplied(out);
        self.whole = Some((Arc::clone(scene), shown, size));
        Ok(Drew::Whole)
    }
}

/// Whether a screen showing `scene` can be drawn as layers at all: a video
/// in the background, nothing done to it the layers cannot do.
pub fn can_layer(scene: &OutputScene) -> bool {
    scene.media_type == Some(MediaKind::Video)
        && scene.media_url.as_deref().is_some_and(|url| !url.is_empty())
        && scene.show_media
        && !scene.hide_background
        && !scene.screen_composer_enabled
        // `"none"` when the operator has adjusted nothing: whatever the
        // compositor would apply, by its own reading of the CSS.
        && crate::services::compositor::filters::parse(&scene.media_filter_css).is_empty()
}

/// Whether a change to `scene` starts a transition that blends whole
/// pictures, which only a whole picture can show.
fn blends_whole_frames(scene: &OutputScene) -> bool {
    scene
        .transition
        .as_ref()
        .is_some_and(|transition| transition.duration_ms > 0 && transition.mode == Mode::FullSlide)
}

/// Whether a premultiplied picture has anything in it: transparent pixels are
/// all zero.
fn anything_drawn(bgra: &[u8]) -> bool {
    // SAFETY: every bit pattern is a valid u64.
    let (head, words, tail) = unsafe { bgra.align_to::<u64>() };
    head.iter().any(|byte| *byte != 0)
        || words.iter().any(|word| *word != 0)
        || tail.iter().any(|byte| *byte != 0)
}

fn rgba(color: Color) -> [f64; 4] {
    [
        f64::from(color.red()),
        f64::from(color.green()),
        f64::from(color.blue()),
        f64::from(color.alpha()),
    ]
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_background_video_with_nothing_done_to_it_is_layered() {
        let scene = OutputScene {
            media_url: Some("local-media://media/loop.mp4".to_owned()),
            media_type: Some(MediaKind::Video),
            show_media: true,
            ..OutputScene::default()
        };
        assert_eq!(
            scene.media_filter_css, "none",
            "what an untouched scene says"
        );
        assert!(can_layer(&scene));
        for refused in [
            OutputScene {
                media_filter_css: "brightness(1.2)".to_owned(),
                ..scene.clone()
            },
            OutputScene {
                screen_composer_enabled: true,
                ..scene.clone()
            },
            OutputScene {
                hide_background: true,
                ..scene.clone()
            },
            OutputScene {
                media_type: Some(MediaKind::Image),
                ..scene.clone()
            },
        ] {
            assert!(!can_layer(&refused), "{refused:?}");
        }
    }

    use crate::services::compositor::NoMedia;
    use crate::services::video::{VideoDecoder, VideoError};
    use std::time::Duration;

    /// Thirty frames a second of a flat colour, decoded on the processor:
    /// what a file the GPU turns down gives.
    struct Flat {
        next: usize,
        size: (u32, u32),
    }

    impl VideoDecoder for Flat {
        fn next_frame(&mut self) -> Result<Option<VideoFrame>, VideoError> {
            let frame = VideoFrame {
                width: self.size.0,
                height: self.size.1,
                // Opaque, as video is: a grey of 200.
                bgra: [200, 200, 200, 255].repeat(self.size.0 as usize * self.size.1 as usize),
                presentation_seconds: self.next as f64 / 30.0,
                gpu: None,
            };
            self.next += 1;
            Ok(Some(frame))
        }
        fn seek(&mut self, seconds: f64) -> Result<(), VideoError> {
            self.next = (seconds * 30.0).round() as usize;
            Ok(())
        }
        fn duration_seconds(&self) -> Option<f64> {
            None
        }
        fn dimensions(&self) -> (u32, u32) {
            self.size
        }
    }

    /// A video decoded on the processor has no picture for the layers: the
    /// screen is drawn whole, as it was before layers.
    #[test]
    fn a_video_with_no_gpu_picture_is_drawn_whole() {
        let path = "/layered-flat-test.mp4";
        crate::services::sound::clock::publish(Some(crate::services::sound::clock::HeardClock {
            now: crate::services::sound::clock::Segment {
                path: Some(path.into()),
                seconds: 1.0,
                playing: false,
                at: Instant::now(),
                rate: 1.0,
            },
            scheduled: Vec::new(),
        }));
        let scene = Arc::new(OutputScene {
            media_url: Some(format!("local-media://media{path}")),
            media_type: Some(MediaKind::Video),
            show_media: true,
            ..OutputScene::default()
        });
        let open: Opener = Arc::new(|_url: &str, size: (u32, u32)| {
            Ok(Box::new(Flat { next: 0, size }) as Box<dyn VideoDecoder>)
        });
        let mut renderer = ScreenRenderer::new(64, 36);
        let mut out = Vec::new();
        let deadline = Instant::now() + Duration::from_secs(5);
        loop {
            let drew = renderer
                .render(
                    &scene,
                    (64, 36),
                    Instant::now(),
                    &open,
                    &NoMedia,
                    true,
                    &mut out,
                )
                .expect("drawn");
            match drew {
                Drew::Whole if out.chunks_exact(4).any(|pixel| pixel[0] == 200) => break,
                Drew::Layers(_) => panic!("no GPU picture to put on a layer"),
                _ => {}
            }
            assert!(Instant::now() < deadline, "the video never showed");
            std::thread::sleep(Duration::from_millis(5));
        }
        // Held, with nothing moving: nothing more to draw.
        let again = renderer
            .render(
                &scene,
                (64, 36),
                Instant::now(),
                &open,
                &NoMedia,
                true,
                &mut out,
            )
            .expect("drawn");
        assert!(matches!(again, Drew::Unchanged));
        crate::services::sound::clock::publish(None);
    }

    #[test]
    fn a_transparent_picture_has_nothing_in_it() {
        assert!(!anything_drawn(&[0; 64 * 4 + 3]));
        let mut one = vec![0; 64 * 4 + 3];
        one[64 * 4 + 1] = 9;
        assert!(anything_drawn(&one));
        one = vec![0; 64 * 4 + 3];
        one[17] = 1;
        assert!(anything_drawn(&one));
    }
}
