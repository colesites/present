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

use std::time::{Duration, Instant};

use tiny_skia::{Color, FilterQuality, Pixmap, PixmapPaint, Transform};

use crate::services::output::{LayerBox, MediaKind, OutputScene, ScreenLayout};
use crate::services::slide::SlideElementType;

use super::transition;
use crate::services::video::VideoFrame;

use super::scene::{MediaLoader, Rendered};
use super::slide_text::{self, SlideTextLayer};
use super::{color, filters, geometry, images, parallel, shapes, Frame};

/// How long a background image that failed to load is left before trying again.
///
/// Long enough that a missing file is not re-read thirty times a second, short
/// enough that an operator who copies it into place sees it without doing
/// anything else.
const STILL_RETRY: Duration = Duration::from_secs(2);

/// Which of a slide's elements a layer is drawn with.
///
/// A transition needs one side of a change on its own: the elements that did
/// not move, drawn once and left alone, and the ones that did, drawn twice —
/// as they were and as they will be — so the two can be blended between.
#[derive(Debug, Clone, Copy)]
pub enum Keep<'a> {
    Everything,
    /// Only these, by the key `change_detection` matched them under.
    Only(&'a [String]),
    /// Everything but these.
    Except(&'a [String]),
}

impl Keep<'_> {
    fn wants(self, index: usize, element: &crate::services::slide::SlideElement) -> bool {
        // Matched as change detection matched them.
        let named = |ids: &[String]| {
            ids.contains(&transition::change_detection::element_key(
                index,
                &element.id,
            ))
        };
        match self {
            Self::Everything => true,
            Self::Only(ids) => named(ids),
            Self::Except(ids) => !named(ids),
        }
    }
}

/// A background image, decoded once.
struct CachedStill {
    url: String,
    /// `None` when it could not be read or decoded.
    image: Option<Pixmap>,
    tried_at: Instant,
}

/// Draws scenes, remembering what it can.
pub struct SceneCompositor {
    width: u32,
    height: u32,
    /// The slide layers over transparency, valid while `cached_for` holds.
    cached_layers: Option<Pixmap>,
    /// The picture on screen before the one being drawn, for a whole-slide
    /// transition to come from.
    ///
    /// Two buffers take turns rather than one being copied: the finished frame
    /// used to be duplicated into a snapshot every frame — nine megabytes at
    /// 1920x1200, allocated fresh each time, thirty times a second — in case a
    /// transition started later. Now the previous frame is simply kept while
    /// the next is drawn into the other buffer, and the two swap at the end.
    previous: Option<Frame>,
    /// The buffer the next frame is drawn into: the one that was on screen two
    /// frames ago, whose contents are no longer needed.
    spare: Option<Frame>,
    /// A transition part-way through, and the scene it is arriving from.
    ///
    /// The picture it came from cannot be recovered afterwards — the slide is
    /// gone — so it is kept here from the moment the change lands.
    running: Option<(transition::Running, OutputScene)>,
    /// The two slide layers a changed-elements transition draws with: what
    /// stays put and what arrives. Built once as the transition begins, and
    /// the scene they were built from, so they are rebuilt only if it changes.
    ///
    /// Neither changes while the transition runs — they depend on the new
    /// slide and on which elements move, and both are fixed the moment it
    /// starts — but both were laid out and rasterised again on every frame.
    /// That made each frame of the default transition cost about ninety
    /// milliseconds at 1920x1200, so a 600 ms transition was drawn in eight
    /// steps instead of thirty-six.
    transition_layers: Option<(Pixmap, Pixmap, OutputScene)>,
    /// The layer a changed-elements transition draws what moves into, kept
    /// for the length of the transition rather than allocated every frame.
    transition_scratch: Option<Pixmap>,
    /// The frame a whole-slide transition composed its last picture in,
    /// reused for the next one rather than allocated and cleared each frame.
    whole_slide_spare: Option<Frame>,
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
    /// The background image, so a static background is read and decoded once
    /// rather than on every frame. A 1080p JPEG costs tens of milliseconds to
    /// decode; a sender drawing thirty frames a second cannot pay that each
    /// time.
    still: Option<CachedStill>,
    /// The timer, drawn over transparency, apart from the slide layers.
    ///
    /// A countdown changes once a second. Kept inside the slide layer, every
    /// tick rebuilt the whole layer — measured at a median 92 ms for a lyric
    /// slide at 1920x1080, which is a visible stall on a 30 fps stream, once a
    /// second, for as long as the countdown runs. Apart, a tick redraws only
    /// the clock.
    timer_layer: Option<Pixmap>,
    timer_for: Option<TimerKey>,
    /// The message banner and props, over transparency, apart from the slide:
    /// the window draws them above the timer, and the timer above the slide.
    overlay_layer: Option<(Pixmap, OverlayCounts)>,
    overlay_for: Option<OverlayKey>,
    /// A scrolling message's words, drawn once and placed anew each frame
    /// over the band in the overlay layer, and the message they were drawn
    /// from.
    marquee: Option<(
        super::overlays::MarqueeStrip,
        crate::services::output::MessageOverlay,
    )>,
    /// The screen composer's countdown clocks, apart from the regions: they
    /// change once a second, and the regions, which can hold a whole slide
    /// each, do not.
    composer_clock: Option<(Pixmap, ComposerClockKey)>,
    /// Which frame of each composer region's video the last picture showed,
    /// by region id: a picture is drawn again when one of them moves on, and
    /// not in between.
    drawn_regions: Vec<(String, f64)>,
    /// What is under everything: the screen's colour (Screen Configuration),
    /// black unless one is chosen.
    base: Color,
}

/// Which frame of each region's video `regions` holds, in a comparable form.
fn region_marks(regions: &[RegionFrame<'_>]) -> Vec<(String, f64)> {
    let mut marks: Vec<(String, f64)> = regions
        .iter()
        .map(|(id, frame)| (id.clone(), frame.presentation_seconds))
        .collect();
    marks.sort_by(|left, right| left.0.cmp(&right.0));
    marks
}

/// Everything the composer's clocks are drawn from.
#[derive(Debug, Clone, PartialEq)]
struct ComposerClockKey {
    layout: Option<serde_json::Value>,
    text: Option<String>,
    label: Option<String>,
    time_up: Option<crate::services::output::TimeUpStyle>,
    lit: bool,
}

/// A video playing in a screen composer region, by the region's id: this
/// instant's frame, decoded by whoever owns the region's decoder.
pub type RegionFrame<'a> = (String, &'a VideoFrame);

/// Everything `draw_message` and `draw_props` read.
#[derive(Debug, Clone, PartialEq)]
struct OverlayKey {
    message: Option<crate::services::output::MessageOverlay>,
    props: Vec<crate::services::output::PropsOverlayItem>,
    /// Where this screen's layout puts the props; `None` for all of it.
    props_box: Option<LayerBox>,
}

#[derive(Debug, Clone, Copy, Default)]
struct OverlayCounts {
    drawn: usize,
    deferred: usize,
}

/// Where background media landed in the frame, in whole pixels: x, y, width,
/// height. What the operator's filters apply to.
type MediaRect = (u32, u32, u32, u32);

/// Everything `overlays::draw_timer` reads.
#[derive(Debug, Clone, PartialEq)]
struct TimerKey {
    text: Option<String>,
    label: Option<String>,
    layout: Option<crate::services::output::TimerLayout>,
    time_up: Option<crate::services::output::TimeUpStyle>,
    /// A blinking "time up" is drawn twice a second, lit and dark.
    lit: bool,
}

impl TimerKey {
    fn of(scene: &OutputScene, lit: bool) -> Self {
        Self {
            text: scene.timer_text.clone(),
            label: scene.timer_label.clone(),
            layout: scene.timer_layout.clone(),
            time_up: scene.timer_time_up.clone(),
            lit,
        }
    }
}

/// Now, in milliseconds since the Unix epoch: what a blinking "time up"
/// keeps time by.
fn wall_ms() -> u128 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_or(0, |since| since.as_millis())
}

impl SceneCompositor {
    pub fn new(width: u32, height: u32) -> Self {
        Self {
            width,
            height,
            cached_layers: None,
            cached_for: None,
            previous: None,
            spare: None,
            transition_layers: None,
            transition_scratch: None,
            whole_slide_spare: None,
            running: None,
            last_rebuild: false,
            frame: None,
            still: None,
            timer_layer: None,
            timer_for: None,
            overlay_layer: None,
            overlay_for: None,
            marquee: None,
            composer_clock: None,
            drawn_regions: Vec::new(),
            base: Color::BLACK,
        }
    }

    pub fn dimensions(&self) -> (u32, u32) {
        (self.width, self.height)
    }

    /// Whether the last `render` had to redraw the slide layers.
    pub fn rebuilt_last_frame(&self) -> bool {
        self.last_rebuild
    }

    /// A transition is part-way through, so the next frame will look
    /// different even though the scene has not changed.
    ///
    /// Anything that draws only when its scene changes has to ask this, and
    /// does, through [`needs_drawing`](Self::needs_drawing).
    pub fn is_animating(&self) -> bool {
        self.running.is_some()
    }

    /// Whether a consumer that skips unchanged scenes has to draw this one.
    ///
    /// Yes when anything it last drew from differs (the scene, the video
    /// frame, the size), and also when the picture moves by itself while the
    /// scene stands still: a transition part-way through, or a message that
    /// scrolls. The audience window and the operator's preview both skip
    /// unchanged scenes, and both ask here. The preview used to decide for
    /// itself and forgot transitions: it drew the first frame of each one,
    /// which is mostly the slide being left, and kept showing it, so the
    /// preview was always one slide behind whenever a transition was set.
    pub fn needs_drawing(
        &self,
        last: Option<&(OutputScene, Option<f64>, (u32, u32))>,
        scene: &OutputScene,
        video: Option<f64>,
        regions: &[RegionFrame<'_>],
        size: (u32, u32),
    ) -> bool {
        let moving_message = scene
            .message_overlay
            .as_ref()
            .is_some_and(super::overlays::is_moving);
        // A composer region's video moves while the scene stands still, as
        // the background video does: drawn again when a region has a new
        // frame. It used to be drawn again on every tick while any region
        // had a video, sixty whole frames a second for a 25-frame clip, which
        // is what made a composed screen heavy.
        let region_video = region_marks(regions) != self.drawn_regions;
        // A blinking "time up" goes dark and lit again while the scene stands
        // still: drawn each time it turns, and not in between.
        let blink_turned = super::overlays::timer_blinks(scene) && {
            let lit = super::overlays::timer_lit(scene, wall_ms());
            // A composer countdown region shows the timer instead, when there
            // is one; `render` draws one or the other.
            let in_region = scene.screen_composer_enabled
                && scene.screen_composer_layout().is_some_and(|layout| {
                    layout
                        .regions
                        .iter()
                        .any(|region| region.source == super::composer::ComposerSource::Countdown)
                });
            let drawn = if in_region {
                self.composer_clock.as_ref().map(|(_, key)| key.lit)
            } else {
                self.timer_for.as_ref().map(|key| key.lit)
            };
            drawn != Some(lit)
        };
        if moving_message || region_video || blink_turned || self.is_animating() {
            return true;
        }
        !last.is_some_and(|(previous_scene, previous_video, previous_size)| {
            *previous_size == size
                && *previous_video == video
                && !previous_scene.draws_differently(scene)
        })
    }

    /// Throw the cache away. For a resize, or a font change that would alter
    /// text the scene itself does not describe.
    pub fn invalidate(&mut self) {
        self.cached_layers = None;
        self.cached_for = None;
        self.still = None;
        self.timer_layer = None;
        self.timer_for = None;
        self.overlay_layer = None;
        self.overlay_for = None;
        self.marquee = None;
        self.composer_clock = None;
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

    /// Put `color` under everything, where black was. Whether it changed.
    pub fn set_base(&mut self, color: Color) -> bool {
        if self.base == color {
            return false;
        }
        self.base = color;
        true
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
        self.render_with_regions(scene, video, &[], loader)
    }

    /// Compose one frame, with the videos playing in screen composer regions.
    ///
    /// `regions` are this instant's frames of those videos, by region id,
    /// decoded by the caller as `video` is (`ndi::video_feed::RegionVideos`).
    pub fn render_with_regions(
        &mut self,
        scene: &OutputScene,
        video: Option<&VideoFrame>,
        regions: &[RegionFrame<'_>],
        loader: &dyn MediaLoader,
    ) -> Option<(&Frame, Rendered)> {
        let mut report = Rendered::default();
        self.drawn_regions = region_marks(regions);
        // One reading of the clock for the whole frame: a transition drawn
        // from two different instants within one frame would tear.
        let now = Instant::now();

        // The picture on screen stays readable while the next one is drawn into
        // the spare buffer; a transition starting now comes from it. Each buffer
        // is reused while it is the right shape, and only replaced when the
        // output's size changes.
        let right_shape =
            |frame: &Frame| frame.width() == self.width && frame.height() == self.height;
        self.previous = self.frame.take().filter(|frame| right_shape(frame));
        let mut frame = match self.spare.take() {
            Some(frame) if right_shape(&frame) => frame,
            _ => Frame::new(self.width, self.height)?,
        };

        // The layer order is `OutputWindow.tsx`'s, outside the composer:
        //
        //   black ─ media (contain) ─ slide background colour ─ slide text
        //         ─ timer ─ props ─ message banner
        //
        // Inside it the regions are the output, each with its own media and
        // plate, so nothing full-screen is drawn under them.
        let media_url = scene
            .media_url
            .as_deref()
            .filter(|url| !url.is_empty())
            .filter(|_| scene.show_media && !scene.hide_background)
            .filter(|_| !scene.screen_composer_enabled);

        // 1. The background media, letterboxed as `object-contain` does, or
        //    where this screen's layout puts it, fitted or filling its box.
        let media_area = scene
            .screen_layout
            .as_ref()
            .and_then(media_area_of(self.width, self.height));
        let media_rect = match (media_url, video.filter(|video| video.is_well_formed())) {
            (Some(_), Some(video)) if media_area.is_some() => {
                self.draw_video_in(&mut frame, video, media_area, &mut report)
            }
            (Some(_), Some(video)) => self.draw_video(&mut frame, video, &mut report),
            (Some(_), None) if scene.media_type == Some(MediaKind::Video) => {
                // A video with no decoded frame yet is not a still. The image
                // path would read the whole file — hundreds of megabytes — and
                // fail to decode it, on every frame.
                frame.clear(self.base);
                report.background_media_missing = true;
                None
            }
            (Some(url), None) => {
                frame.clear(self.base);
                self.draw_still(&mut frame, url, loader, media_area, &mut report)
            }
            (None, _) => {
                frame.clear(self.base);
                None
            }
        };

        // 2. The operator's adjustments, on the media and nothing else: the
        //    window's `filter` is on the `<video>` or `<img>` alone.
        if let Some(rect) = media_rect {
            apply_media_filters(&mut frame, rect, &scene.media_filter_css);
        }

        // 3. The slide's background colour, over the media. The window draws
        //    it as a full-screen div after the media, whatever the mask says.
        //    A presentation's is its slide's, on the Slide layer with it and
        //    in its box: `draw_presentation_slide`.
        if !scene.screen_composer_enabled && !scene.presentation_slide {
            if let Some(background) = scene.slide_background_color.as_deref() {
                shapes::fill_background(&mut frame.pixmap_mut(), background);
            }
        }

        // 3½. With the composer on, the videos playing in its regions, each
        //     on its plate. The regions' other contents are in the slide
        //     layer drawn over them next, which leaves these clear.
        let composer = scene
            .screen_composer_enabled
            .then(|| scene.screen_composer_layout())
            .flatten();
        if let Some(layout) = composer.as_ref() {
            self.draw_composer_videos(&mut frame, layout, regions);
        }

        // 4. The slide, only rebuilt when it changed.
        if !self.draw_transition_layers(&mut frame, scene, loader, &mut report, now) {
            if let Some(layers) = self.layers_for(scene, loader, &mut report) {
                blend_over(&mut frame, layers);
            }
        }

        // 4½. The composer's countdown clocks, redrawn only when they tick.
        let has_clock = composer.as_ref().is_some_and(|layout| {
            layout
                .regions
                .iter()
                .any(|region| region.source == super::composer::ComposerSource::Countdown)
        });
        if has_clock {
            if let Some(clock) = self.composer_clock_for(scene, composer.as_ref()) {
                blend_over(&mut frame, clock);
            }
        }

        // 5. The timer, redrawn only when it ticks. Not while a composer
        //    region shows it, as the output window leaves it out then too.
        if scene.timer_visible && !has_clock {
            if let Some(timer) = self.timer_for(scene) {
                blend_over(&mut frame, timer);
            }
            report.overlays_drawn += 1;
        }

        // 6. Props and the message banner, on top.
        if let Some((overlays, counts)) = self.overlays_for(scene, loader) {
            report.overlays_drawn += counts.drawn;
            report.elements_deferred += counts.deferred;
            if counts.drawn > 0 {
                blend_over(&mut frame, overlays);
            }
        }
        // 7. A scrolling message's words, over its band, where they are now.
        self.draw_marquee(&mut frame, scene);

        // A whole-slide transition is between two *pictures*, background and
        // all — which is what the operator asked for when they chose it, and
        // what was missing while this only ever crossed the slide layers: a
        // change of background video looked like nothing happening.
        let frame = self.blend_whole_frame(frame, now);

        // The one that was on screen becomes the next spare, and the one just
        // drawn is what is on screen now — which is what the next frame's
        // transition, if one starts, will come from.
        self.spare = self.previous.take();
        self.frame = Some(frame);
        Some((self.frame.as_ref()?, report))
    }

    /// Put a whole-slide transition over the finished frame.
    ///
    /// Only for `Mode::FullSlide`: the changed-elements ones have already been
    /// drawn into the slide layers, where they can leave a playing background
    /// alone.
    fn blend_whole_frame(&mut self, frame: Frame, now: Instant) -> Frame {
        let Some((running, _)) = self.running.as_ref() else {
            return frame;
        };
        if running.mode() != transition::Mode::FullSlide {
            return frame;
        }
        if running.is_over(now) {
            self.running = None;
            self.transition_layers = None;
            self.transition_scratch = None;
            self.whole_slide_spare = None;
            return frame;
        }
        // Into the buffer the last frame of this transition was composed in,
        // which holds nothing needed now; the one composed this frame takes
        // its place for the next.
        let mut out = match self.whole_slide_spare.take() {
            Some(mut out) if out.width() == self.width && out.height() == self.height => {
                out.clear(self.base);
                out
            }
            _ => match Frame::new(self.width, self.height) {
                Some(out) => out,
                None => return frame,
            },
        };
        running.draw(&mut out.pixmap_mut(), frame.pixmap(), now);
        self.whole_slide_spare = Some(frame);
        out
    }

    /// The cached timer layer, redrawn if what it shows changed.
    fn timer_for(&mut self, scene: &OutputScene) -> Option<&Pixmap> {
        let lit = super::overlays::timer_lit(scene, wall_ms());
        let key = TimerKey::of(scene, lit);
        if self.timer_for.as_ref() != Some(&key) || self.timer_layer.is_none() {
            let mut layer = Pixmap::new(self.width, self.height)?;
            super::overlays::draw_timer_at(
                &mut layer.as_mut(),
                scene,
                scene.timer_layout.as_ref(),
                lit,
            );
            self.timer_layer = Some(layer);
            self.timer_for = Some(key);
        }
        self.timer_layer.as_ref()
    }

    /// Put a scrolling message's words where they are at this instant.
    ///
    /// The band behind them is in the overlay layer, drawn once. The words
    /// are drawn once too, and only placed here, every frame.
    fn draw_marquee(&mut self, frame: &mut Frame, scene: &OutputScene) {
        let Some(message) = scene
            .message_overlay
            .as_ref()
            .filter(|message| super::overlays::is_moving(message))
        else {
            self.marquee = None;
            return;
        };
        if self.marquee.as_ref().map(|(_, drawn_from)| drawn_from) != Some(message) {
            self.marquee = super::overlays::MarqueeStrip::new(message, self.width, self.height)
                .map(|strip| (strip, message.clone()));
        }
        let Some((strip, _)) = self.marquee.as_ref() else {
            return;
        };
        // Wall clock rather than the monotonic one: `shown_at_ms` is when the
        // operator sent the message, which is a time of day.
        let now_ms = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map_or(0.0, |since| since.as_secs_f64() * 1000.0);
        let elapsed_seconds = (now_ms - message.shown_at_ms).max(0.0) / 1000.0;
        strip.draw(&mut frame.pixmap_mut(), message, elapsed_seconds);
    }

    /// The cached banner-and-props layer, redrawn if either changed.
    ///
    /// A scrolling message's band is in it, and its words are not: those are
    /// placed each frame by [`draw_marquee`](Self::draw_marquee).
    fn overlays_for(
        &mut self,
        scene: &OutputScene,
        loader: &dyn MediaLoader,
    ) -> Option<(&Pixmap, OverlayCounts)> {
        let key = OverlayKey {
            message: scene.message_overlay.clone(),
            props: scene.props_overlay.clone(),
            props_box: scene
                .screen_layout
                .as_ref()
                .map(|layout| layout.props_box)
                .filter(|area| !area.is_full()),
        };
        if key.message.is_none() && key.props.is_empty() {
            return None;
        }
        if self.overlay_for.as_ref() != Some(&key) || self.overlay_layer.is_none() {
            let mut layer = Pixmap::new(self.width, self.height)?;
            let mut counts = OverlayCounts::default();
            // Props under the banner, as the window stacks them: where the
            // screen's layout puts them, drawn as on the whole screen and
            // scaled evenly into that box.
            match key.props_box {
                Some(area) => {
                    let mut props_layer = Pixmap::new(self.width, self.height)?;
                    let props = super::overlays::draw_props(
                        &mut props_layer.as_mut(),
                        &scene.props_overlay,
                        loader,
                    );
                    counts.drawn += props.drawn;
                    counts.deferred += props.deferred;
                    draw_into_box(&mut layer.as_mut(), &props_layer, &area);
                }
                None => {
                    let props = super::overlays::draw_props(
                        &mut layer.as_mut(),
                        &scene.props_overlay,
                        loader,
                    );
                    counts.drawn += props.drawn;
                    counts.deferred += props.deferred;
                }
            }
            {
                let mut view = layer.as_mut();
                if let Some(message) = scene.message_overlay.as_ref() {
                    if super::overlays::is_moving(message) {
                        super::overlays::draw_message_plate(&mut view, message);
                    } else {
                        super::overlays::draw_message(&mut view, message, 0.0);
                    }
                    counts.drawn += 1;
                }
            }
            self.overlay_layer = Some((layer, counts));
            self.overlay_for = Some(key);
        }
        self.overlay_layer
            .as_ref()
            .map(|(layer, counts)| (layer, *counts))
    }

    /// Draw a scene's slide layers into `layers`.
    ///
    /// Pulled out of the cache so a transition can ask for one side of a
    /// change on its own — `keep` decides which elements are in it.
    fn draw_layer_into(
        &self,
        layers: &mut Pixmap,
        scene: &OutputScene,
        loader: &dyn MediaLoader,
        report: &mut Rendered,
        keep: Keep<'_>,
        viewport: &geometry::Viewport,
    ) {
        let words_box = scene
            .screen_layout
            .as_ref()
            .and_then(|layout| layout.words_box.map(|area| (layout, area)));
        if scene.presentation_slide {
            // The Slide layer's, never in the words' box.
            if scene.show_text && !scene.screen_composer_enabled {
                self.draw_presentation_slide(layers, scene, loader, report, keep, viewport);
            }
        } else if let (true, false, Some((layout, area))) =
            (scene.show_text, scene.screen_composer_enabled, words_box)
        {
            self.draw_words_in_box(layers, scene, loader, report, keep, layout, &area, viewport);
        } else if scene.show_text && !scene.screen_composer_enabled {
            self.draw_slide_as_made(layers, scene, loader, report, keep, viewport);
        }

        // The screen composer replaces the slide rather than sitting above it:
        // when it is on, the regions are the output. So it is drawn instead of
        // the elements above, not as well as them.
        if scene.screen_composer_enabled {
            if let Some(layout) = scene.screen_composer_layout() {
                self.draw_composer_regions(layers, scene, &layout, loader, report);
            }
        }
    }

    /// The slide on the whole screen, as it was made: scripture or plain words
    /// laid out by their style, a designed slide's elements where it put them.
    fn draw_slide_as_made(
        &self,
        layers: &mut Pixmap,
        scene: &OutputScene,
        loader: &dyn MediaLoader,
        report: &mut Rendered,
        keep: Keep<'_>,
        viewport: &geometry::Viewport,
    ) {
        match slide_text::layer_for(scene) {
            SlideTextLayer::Scripture => {
                slide_text::draw_scripture(
                    &mut layers.as_mut(),
                    scene.slide_text.as_deref().unwrap_or_default(),
                    scene.slide_footer.as_deref(),
                    scene.scripture_style.as_ref(),
                );
                report.elements_drawn += 1;
            }
            SlideTextLayer::PlainText => {
                slide_text::draw_plain(
                    &mut layers.as_mut(),
                    scene.slide_text.as_deref().unwrap_or_default(),
                    scene.library_style.as_ref(),
                    viewport,
                );
                report.elements_drawn += 1;
            }
            SlideTextLayer::Elements => {
                for (index, element) in scene
                    .slide_elements()
                    .unwrap_or_default()
                    .into_iter()
                    .enumerate()
                {
                    if !element.is_visible() || !keep.wants(index, &element) {
                        continue;
                    }
                    if !element.element_type.is_composited() {
                        report.elements_deferred += 1;
                        continue;
                    }
                    if super::scene::draw_element_into(layers, &element, viewport, loader) {
                        report.elements_drawn += 1;
                    }
                }
            }
        }
    }

    /// A presentation's slide — a PDF's page, a PowerPoint's slide — with its
    /// background colour, which is the slide's and goes with it: on the whole
    /// screen, or scaled evenly into the box this screen's layout gives it.
    fn draw_presentation_slide(
        &self,
        layers: &mut Pixmap,
        scene: &OutputScene,
        loader: &dyn MediaLoader,
        report: &mut Rendered,
        keep: Keep<'_>,
        viewport: &geometry::Viewport,
    ) {
        let area = scene
            .screen_layout
            .as_ref()
            .map(|layout| layout.slide_box)
            .filter(|area| !area.is_full());
        // Drawn as on the whole screen, then shrunk into its box, as the
        // props are: the slide keeps its shape and everything on it its place.
        let mut boxed = match area {
            Some(_) => match Pixmap::new(layers.width(), layers.height()) {
                Some(pixmap) => Some(pixmap),
                None => return,
            },
            None => None,
        };
        let target = match boxed.as_mut() {
            Some(pixmap) => pixmap,
            None => &mut *layers,
        };
        // The colour stays put through a transition, as a lower third's band
        // does: drawn with what does not move.
        if !matches!(keep, Keep::Only(_)) {
            if let Some(background) = scene.slide_background_color.as_deref() {
                shapes::fill_background(&mut target.as_mut(), background);
            }
        }
        self.draw_slide_as_made(target, scene, loader, report, keep, viewport);
        if let (Some(slide), Some(area)) = (boxed.as_ref(), area) {
            draw_into_box(&mut layers.as_mut(), slide, &area);
        }
    }

    /// The slide's words in the box this screen's layout gives them, over the
    /// layout's backdrop if it has one. Scripture and plain words are laid
    /// out afresh in the box; a designed slide is either scaled evenly into
    /// it, or, for "text only", its words are laid out there in its font.
    #[allow(clippy::too_many_arguments)]
    fn draw_words_in_box(
        &self,
        layers: &mut Pixmap,
        scene: &OutputScene,
        loader: &dyn MediaLoader,
        report: &mut Rendered,
        keep: Keep<'_>,
        layout: &ScreenLayout,
        area: &LayerBox,
        viewport: &geometry::Viewport,
    ) {
        let Some((x, y, w, h)) = area.rect(layers.width(), layers.height()) else {
            return;
        };
        // Nothing to show is nothing at all: not a lower third's empty band.
        let layer = slide_text::layer_for(scene);
        let elements = scene.slide_elements().unwrap_or_default();
        let has_words = match layer {
            // Only chosen with words to show.
            SlideTextLayer::Scripture | SlideTextLayer::PlainText => true,
            SlideTextLayer::Elements if layout.words_text_only => elements.iter().any(|element| {
                element.element_type == SlideElementType::Text
                    && element.is_visible()
                    && super::text::paragraphs_of(element)
                        .iter()
                        .any(|line| !line.trim().is_empty())
            }),
            SlideTextLayer::Elements => elements.iter().any(|element| element.is_visible()),
        };
        if !has_words {
            return;
        }
        // The backdrop stays put through a transition: it is drawn with what
        // does not move, never with what does.
        let backdrop = layout
            .words_backdrop
            .as_deref()
            .filter(|_| !matches!(keep, Keep::Only(_)))
            .and_then(color::parse);
        if let (Some(backdrop), Some(rect)) = (backdrop, tiny_skia::Rect::from_xywh(x, y, w, h)) {
            let mut paint = tiny_skia::Paint::default();
            paint.set_color(backdrop);
            layers.fill_rect(rect, &paint, Transform::identity(), None);
        }
        let Some(mut words) = Pixmap::new(w as u32, h as u32) else {
            return;
        };
        let scale = layout.words_scale();
        match layer {
            SlideTextLayer::Scripture => {
                let mut style = scene
                    .scripture_style
                    .clone()
                    .unwrap_or_else(slide_text::default_scripture_style);
                style.font_size *= f64::from(scale);
                style.footer_font_size *= f64::from(scale);
                // Aligned as the column's box says: a lower third centred
                // along its band, say, whatever the full-screen style has.
                if let Some(position) = scene.text_position.as_ref() {
                    style.text_align = position.text_align.clone();
                    style.vertical_align = position.vertical_align.clone();
                }
                slide_text::draw_scripture(
                    &mut words.as_mut(),
                    scene.slide_text.as_deref().unwrap_or_default(),
                    scene.slide_footer.as_deref(),
                    Some(&style),
                );
                report.elements_drawn += 1;
            }
            SlideTextLayer::PlainText => {
                let mut style = scene
                    .library_style
                    .clone()
                    .unwrap_or_else(slide_text::default_library_style);
                style.font_size *= f64::from(scale);
                slide_text::draw_plain(
                    &mut words.as_mut(),
                    scene.slide_text.as_deref().unwrap_or_default(),
                    Some(&style),
                    viewport,
                );
                report.elements_drawn += 1;
            }
            SlideTextLayer::Elements if layout.words_text_only => {
                // The words are laid out together, so they move together: on
                // the side of a transition any one of them is on.
                let mut texts = elements
                    .iter()
                    .enumerate()
                    .filter(|(_, element)| element.element_type == SlideElementType::Text);
                let here = match keep {
                    Keep::Everything => true,
                    Keep::Only(_) => texts.any(|(index, element)| keep.wants(index, element)),
                    Keep::Except(_) => texts.all(|(index, element)| keep.wants(index, element)),
                };
                if here
                    && slide_text::draw_words_of(
                        &mut words.as_mut(),
                        &elements,
                        viewport,
                        scale,
                        scene.text_position.as_ref(),
                    )
                {
                    report.elements_drawn += 1;
                }
            }
            SlideTextLayer::Elements => {
                // The slide as designed, scaled evenly to fit the box.
                let fit = (f64::from(w) / viewport.canvas_width)
                    .min(f64::from(h) / viewport.canvas_height);
                let (slide_w, slide_h) = (
                    (viewport.canvas_width * fit).round().max(1.0),
                    (viewport.canvas_height * fit).round().max(1.0),
                );
                let Some(mut slide) = Pixmap::new(slide_w as u32, slide_h as u32) else {
                    return;
                };
                let inner = geometry::Viewport {
                    canvas_width: viewport.canvas_width,
                    canvas_height: viewport.canvas_height,
                    frame_width: slide_w,
                    frame_height: slide_h,
                };
                for (index, element) in elements.iter().enumerate() {
                    if !element.is_visible() || !keep.wants(index, element) {
                        continue;
                    }
                    if !element.element_type.is_composited() {
                        report.elements_deferred += 1;
                        continue;
                    }
                    if super::scene::draw_element_into(&mut slide, element, &inner, loader) {
                        report.elements_drawn += 1;
                    }
                }
                words.draw_pixmap(
                    ((f64::from(w) - slide_w) / 2.0).round() as i32,
                    ((f64::from(h) - slide_h) / 2.0).round() as i32,
                    slide.as_ref(),
                    &PixmapPaint::default(),
                    Transform::identity(),
                    None,
                );
            }
        }
        layers.draw_pixmap(
            x as i32,
            y as i32,
            words.as_ref(),
            &PixmapPaint::default(),
            Transform::identity(),
            None,
        );
    }

    /// The screen composer's regions, each drawn inside its own rectangle, as
    /// the output window's `renderRegionContent` draws them: a plate, the
    /// media, and a slides region's slide laid out as its author intended,
    /// scaled to the region rather than the screen.
    ///
    /// Videos are not here: they move, and this layer is drawn once. Their
    /// regions are left clear, plate and all, for `draw_composer_videos`
    /// under it. Nor are the clocks, which tick: `composer_clock_for`.
    fn draw_composer_regions(
        &self,
        layers: &mut Pixmap,
        scene: &OutputScene,
        layout: &super::composer::ComposerLayout,
        loader: &dyn MediaLoader,
        report: &mut Rendered,
    ) {
        use super::composer::ComposerSource;

        let (frame_width, frame_height) = (layers.width() as f32, layers.height() as f32);
        for region in &layout.regions {
            let Some((x, y, width, height)) = region.inner_rect(frame_width, frame_height) else {
                continue;
            };
            if !region.is_composited() {
                // A camera: the webview layer's, like a capture prop.
                report.elements_deferred += 1;
                continue;
            }

            if region.video_url().is_none() {
                super::overlays::draw_region_plate(
                    &mut layers.as_mut(),
                    region,
                    frame_width,
                    frame_height,
                );
            }
            if let Some(url) = region.image_url() {
                super::overlays::draw_region_image(
                    &mut layers.as_mut(),
                    region,
                    url,
                    loader,
                    frame_width,
                    frame_height,
                );
            }

            match region.source {
                ComposerSource::Slides => {
                    let region_scene = region_slide_scene(scene, region);
                    let (inner_width, inner_height) = (
                        width.round().max(1.0) as u32,
                        height.round().max(1.0) as u32,
                    );
                    let Some(mut picture) = Pixmap::new(inner_width, inner_height) else {
                        continue;
                    };
                    if let Some(background) = region_scene
                        .slide_background_color
                        .as_deref()
                        .and_then(color::parse)
                    {
                        picture.fill(background);
                    }
                    let viewport = geometry::Viewport::new(
                        region_scene.slide_canvas_size.as_deref(),
                        inner_width,
                        inner_height,
                    );
                    self.draw_layer_into(
                        &mut picture,
                        &region_scene,
                        loader,
                        report,
                        Keep::Everything,
                        &viewport,
                    );
                    layers.draw_pixmap(
                        x.round() as i32,
                        y.round() as i32,
                        picture.as_ref(),
                        &tiny_skia::PixmapPaint::default(),
                        Transform::identity(),
                        None,
                    );
                }
                // The clock is drawn over the region's own background, and
                // nothing else: a darker panel was always added under it,
                // with no way to choose none.
                ComposerSource::Countdown => report.elements_drawn += 1,
                ComposerSource::Video => report.elements_drawn += 1,
                ComposerSource::CameraFeed | ComposerSource::Unknown => {}
            }
        }
    }

    /// The videos playing in composer regions, each on its plate, at this
    /// instant's frame. A region whose video has no frame yet shows its plate.
    fn draw_composer_videos(
        &self,
        frame: &mut Frame,
        layout: &super::composer::ComposerLayout,
        regions: &[RegionFrame<'_>],
    ) {
        let (frame_width, frame_height) = (frame.width() as f32, frame.height() as f32);
        for region in layout
            .regions
            .iter()
            .filter(|region| region.video_url().is_some())
        {
            super::overlays::draw_region_plate(
                &mut frame.pixmap_mut(),
                region,
                frame_width,
                frame_height,
            );
            let Some((_, video)) = regions.iter().find(|(id, _)| *id == region.id) else {
                continue;
            };
            if let Some(rect) = region.inner_rect(frame_width, frame_height) {
                super::video_blit::blit_video(
                    frame,
                    video,
                    rect,
                    region.fit_mode.to_object_fit(),
                    region.radius(frame_height),
                );
            }
        }
    }

    /// The composer's countdown clocks over transparency, redrawn when the
    /// time, the timer's name or the layout changes.
    fn composer_clock_for(
        &mut self,
        scene: &OutputScene,
        layout: Option<&super::composer::ComposerLayout>,
    ) -> Option<&Pixmap> {
        let layout = layout?;
        let lit = super::overlays::timer_lit(scene, wall_ms());
        let key = ComposerClockKey {
            layout: scene.screen_composer_layout.clone(),
            text: scene.timer_text.clone(),
            label: scene.timer_label.clone(),
            time_up: scene.timer_time_up.clone(),
            lit,
        };
        let current = self
            .composer_clock
            .as_ref()
            .is_some_and(|(_, drawn_for)| *drawn_for == key);
        if !current {
            let mut layer = Pixmap::new(self.width, self.height)?;
            let (frame_width, frame_height) = (self.width as f32, self.height as f32);
            let clock = scene
                .timer_text
                .as_deref()
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .unwrap_or("00:00:00");
            for region in layout
                .regions
                .iter()
                .filter(|region| region.source == super::composer::ComposerSource::Countdown)
            {
                super::overlays::draw_region_clock(
                    &mut layer.as_mut(),
                    region,
                    scene,
                    clock,
                    lit,
                    frame_width,
                    frame_height,
                );
            }
            self.composer_clock = Some((layer, key));
        }
        self.composer_clock.as_ref().map(|(layer, _)| layer)
    }

    /// Draw this frame's slide layers while a changed-elements transition is
    /// running, and say whether it did.
    ///
    /// `false` when there is nothing in flight, or when what is in flight is a
    /// whole-slide transition — that is drawn at the end, over the finished
    /// picture — and the ordinary cached layer is used instead. The video is
    /// not in either: it is drawn beneath, so a background carries on playing
    /// through a change of words without anything here arranging it.
    fn draw_transition_layers(
        &mut self,
        frame: &mut Frame,
        scene: &OutputScene,
        loader: &dyn MediaLoader,
        report: &mut Rendered,
        now: Instant,
    ) -> bool {
        self.start_transition_if_the_slide_moved(scene, loader, report, now);

        let Some((running, _)) = self.running.as_ref() else {
            return false;
        };
        if running.is_over(now) {
            self.running = None;
            self.transition_layers = None;
            self.transition_scratch = None;
            return false;
        }
        if running.mode() == transition::Mode::FullSlide {
            return false;
        }

        // What did not change is drawn once, from the new slide, and never
        // moves. Only the rest is animated over it. Both are built on the
        // first frame and reused after it; only a slide that changes again
        // mid-transition rebuilds them.
        let moving = running.changes().moving();
        let reusable = self
            .transition_layers
            .as_ref()
            .is_some_and(|(_, _, built_for)| !layers_differ(built_for, scene));
        if !reusable {
            let still = self.build_layer(scene, loader, report, Keep::Except(&moving));
            let to = self.build_layer(scene, loader, report, Keep::Only(&moving));
            let (Some(still), Some(to)) = (still, to) else {
                return false;
            };
            self.transition_layers = Some((still, to, scene.clone()));
        }
        let (Some((running, _)), Some((still, to, _))) =
            (self.running.as_ref(), self.transition_layers.as_ref())
        else {
            return false;
        };

        // What stays put goes straight onto the frame. What moves is drawn
        // on nothing first and laid on after, because the arriving words
        // replace the outgoing ones where they are laid — and replacing on
        // the frame itself would take the video beneath with them. The layer
        // is kept for the length of the transition rather than allocated for
        // every frame of it.
        blend_over(frame, still);
        let mut moving = match self.transition_scratch.take() {
            Some(mut layer) if layer.width() == self.width && layer.height() == self.height => {
                super::parallel::for_each_band(layer.data_mut(), |bytes, _| bytes.fill(0));
                layer
            }
            _ => match Pixmap::new(self.width, self.height) {
                Some(layer) => layer,
                None => return false,
            },
        };
        running.draw(&mut moving.as_mut(), to, now);
        blend_over(frame, &moving);
        self.transition_scratch = Some(moving);
        true
    }

    /// Begin one if this scene is a different slide and asks for it.
    fn start_transition_if_the_slide_moved(
        &mut self,
        scene: &OutputScene,
        loader: &dyn MediaLoader,
        report: &mut Rendered,
        now: Instant,
    ) {
        let Some(wanted) = scene.transition.as_ref() else {
            return;
        };
        if !wanted.animates() {
            return;
        }
        let Some(previous) = self.cached_for.clone() else {
            // Nothing was on screen to transition from.
            return;
        };

        // Any visible change, not only the slide layers: choosing another
        // background video is a change the operator expects to see
        // transitioned, and it moves no text at all.
        let changes = transition::compare(&previous, scene);
        if changes.is_nothing() {
            return;
        }

        let from = match wanted.mode {
            // The picture that was on screen, background included.
            transition::Mode::FullSlide => {
                self.previous.as_ref().map(|frame| frame.pixmap().clone())
            }
            transition::Mode::ChangedElements => {
                let moving = changes.moving();
                self.build_layer(&previous, loader, report, Keep::Only(&moving))
            }
        };
        let Some(from) = from else {
            return;
        };
        self.running = transition::Running::begin(from, wanted, changes, now)
            .map(|running| (running, previous));
        // Which elements move depends on where the slide arrives from as well
        // as where it arrives, so a new transition never inherits the last
        // one's layers even when it lands on the same slide.
        self.transition_layers = None;

        // The cache moves to the new slide as the transition begins, not when
        // it ends. Otherwise the next frame sees the cache still holding the
        // old slide, decides the slide has moved again, and starts another
        // transition — for ever, with the old picture on screen throughout.
        if self.running.is_some() {
            self.cached_layers = self.build_layer(scene, loader, report, Keep::Everything);
            self.cached_for = Some(scene.clone());
        }
    }

    /// A slide's own layers — its words, shapes and pictures — on nothing.
    ///
    /// For the transition picker's samples, which put real words over footage
    /// of their own rather than over a video the output decoded.
    pub fn slide_layer(&self, scene: &OutputScene) -> Option<Pixmap> {
        self.build_layer(
            scene,
            &super::scene::NoMedia,
            &mut Rendered::default(),
            Keep::Everything,
        )
    }

    /// Draw the slide layers of `scene`, keeping only what `keep` wants.
    ///
    /// The whole slide for the ordinary frame; one side or the other of a
    /// change while a transition is running.
    fn build_layer(
        &self,
        scene: &OutputScene,
        loader: &dyn MediaLoader,
        report: &mut Rendered,
        keep: Keep<'_>,
    ) -> Option<Pixmap> {
        let mut layers = Pixmap::new(self.width, self.height)?;
        let viewport =
            geometry::Viewport::new(scene.slide_canvas_size.as_deref(), self.width, self.height);
        self.draw_layer_into(&mut layers, scene, loader, report, keep, &viewport);
        Some(layers)
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
            if scene.show_text
                && !scene.screen_composer_enabled
                && slide_text::layer_for(scene) != SlideTextLayer::Elements
            {
                report.elements_drawn += 1;
            }
            return self.cached_layers.as_ref();
        }

        self.last_rebuild = true;
        let mut layers = Pixmap::new(self.width, self.height)?;
        let viewport =
            geometry::Viewport::new(scene.slide_canvas_size.as_deref(), self.width, self.height);
        self.draw_layer_into(
            &mut layers,
            scene,
            loader,
            report,
            Keep::Everything,
            &viewport,
        );

        self.cached_layers = Some(layers);
        self.cached_for = Some(scene.clone());
        self.cached_layers.as_ref()
    }

    /// Paint a decoded video frame, letterboxed. Returns where it landed.
    ///
    /// Three ways, cheapest first. A frame exactly the output's size is the
    /// output. A frame the decoder already scaled to fit — which is what the
    /// stream asks it for — is a centred copy onto black. Anything else is
    /// scaled here.
    fn draw_video(
        &self,
        frame: &mut Frame,
        video: &VideoFrame,
        report: &mut Rendered,
    ) -> Option<MediaRect> {
        let (width, height) = (self.width, self.height);
        if (video.width, video.height) == (width, height) {
            if frame.overwrite_from_bgra(&video.bgra) {
                report.background_media_drawn = true;
                return Some((0, 0, width, height));
            }
            frame.clear(self.base);
            report.background_media_missing = true;
            return None;
        }

        frame.clear(self.base);
        if video.width <= width && video.height <= height {
            let fitted =
                crate::services::video::contain_size((video.width, video.height), (width, height));
            if fitted == (video.width, video.height) {
                let x = (width - video.width) / 2;
                let y = (height - video.height) / 2;
                copy_bgra_into(frame, video, (x, y));
                report.background_media_drawn = true;
                return Some((x, y, video.width, video.height));
            }
        }

        let Some(pixmap) = video_to_pixmap(video) else {
            report.background_media_missing = true;
            return None;
        };
        let rect = contained_rect(video.width, video.height, width, height)?;
        images::draw(
            &mut frame.pixmap_mut(),
            &pixmap,
            Transform::identity(),
            width as f32,
            height as f32,
            images::ObjectFit::Contain,
            None,
        );
        report.background_media_drawn = true;
        Some(rect)
    }
}

impl SceneCompositor {
    fn draw_still(
        &mut self,
        frame: &mut Frame,
        url: &str,
        loader: &dyn MediaLoader,
        area: Option<MediaArea>,
        report: &mut Rendered,
    ) -> Option<MediaRect> {
        let now = Instant::now();
        let reusable = self.still.as_ref().is_some_and(|still| {
            still.url == url
                && (still.image.is_some() || now.duration_since(still.tried_at) < STILL_RETRY)
        });
        if !reusable {
            let image = loader.load(url).and_then(|bytes| images::decode(&bytes));
            self.still = Some(CachedStill {
                url: url.to_owned(),
                image,
                tried_at: now,
            });
        }

        let Some(decoded) = self.still.as_ref().and_then(|still| still.image.as_ref()) else {
            report.background_media_missing = true;
            return None;
        };

        if let Some(area) = area {
            report.background_media_drawn = true;
            return draw_media_in(frame, decoded, area);
        }
        let rect = contained_rect(decoded.width(), decoded.height(), self.width, self.height)?;
        images::draw(
            &mut frame.pixmap_mut(),
            decoded,
            Transform::identity(),
            self.width as f32,
            self.height as f32,
            images::ObjectFit::Contain,
            None,
        );
        report.background_media_drawn = true;
        Some(rect)
    }

    /// A video frame where this screen's layout puts its media.
    fn draw_video_in(
        &self,
        frame: &mut Frame,
        video: &VideoFrame,
        area: Option<MediaArea>,
        report: &mut Rendered,
    ) -> Option<MediaRect> {
        frame.clear(self.base);
        let (Some(area), Some(pixmap)) = (area, video_to_pixmap(video)) else {
            report.background_media_missing = true;
            return None;
        };
        report.background_media_drawn = true;
        draw_media_in(frame, &pixmap, area)
    }
}

/// Where a screen's layout puts the media, in pixels, and how it fits there.
type MediaArea = ((f32, f32, f32, f32), images::ObjectFit);

/// The media's place on a `width` by `height` screen, when its layout moves
/// it or fills its box; `None` for the whole screen, letterboxed, as before.
fn media_area_of(width: u32, height: u32) -> impl Fn(&ScreenLayout) -> Option<MediaArea> {
    move |layout| {
        if layout.media_box.is_full() && !layout.media_fill {
            return None;
        }
        let fit = if layout.media_fill {
            images::ObjectFit::Cover
        } else {
            images::ObjectFit::Contain
        };
        layout.media_box.rect(width, height).map(|rect| (rect, fit))
    }
}

/// Draw media into its box: fitted inside it, or filling it, cropped.
fn draw_media_in(
    frame: &mut Frame,
    source: &Pixmap,
    ((x, y, w, h), fit): MediaArea,
) -> Option<MediaRect> {
    images::draw(
        &mut frame.pixmap_mut(),
        source,
        Transform::from_translate(x, y),
        w,
        h,
        fit,
        None,
    );
    Some((x as u32, y as u32, w as u32, h as u32))
}

/// Draw a whole-screen layer into a box of the screen, scaled evenly to fit
/// it and centred in it.
fn draw_into_box(target: &mut tiny_skia::PixmapMut<'_>, layer: &Pixmap, area: &LayerBox) {
    let (width, height) = (layer.width() as f32, layer.height() as f32);
    let Some((x, y, w, h)) = area.rect(layer.width(), layer.height()) else {
        return;
    };
    let scale = (w / width).min(h / height);
    let paint = PixmapPaint {
        quality: FilterQuality::Bilinear,
        ..PixmapPaint::default()
    };
    target.draw_pixmap(
        0,
        0,
        layer.as_ref(),
        &paint,
        Transform::from_row(
            scale,
            0.0,
            0.0,
            scale,
            x + (w - width * scale) / 2.0,
            y + (h - height * scale) / 2.0,
        ),
        None,
    );
}

/// Where `object-contain` puts a `source`-sized image in the frame.
fn contained_rect(
    source_width: u32,
    source_height: u32,
    width: u32,
    height: u32,
) -> Option<MediaRect> {
    let placement = images::place(
        source_width,
        source_height,
        width as f32,
        height as f32,
        images::ObjectFit::Contain,
    )?;
    let x = placement.offset_x.max(0.0).round() as u32;
    let y = placement.offset_y.max(0.0).round() as u32;
    let w = ((source_width as f32 * placement.scale_x).round() as u32).min(width.saturating_sub(x));
    let h =
        ((source_height as f32 * placement.scale_y).round() as u32).min(height.saturating_sub(y));
    (w > 0 && h > 0).then_some((x, y, w, h))
}

/// Copy a decoded frame's BGRA into the frame at `(x, y)`, unscaled.
fn copy_bgra_into(frame: &mut Frame, video: &VideoFrame, (left, top): (u32, u32)) {
    let frame_width = frame.width() as usize;
    let (video_width, video_height) = (video.width as usize, video.height as usize);
    let (left, top) = (left as usize, top as usize);
    let bgra = &video.bgra;

    parallel::for_each_band(frame.pixmap_mut_pixels(), |band, offset| {
        for (index, slot) in band.iter_mut().enumerate() {
            let at = offset + index;
            let (x, y) = (at % frame_width, at / frame_width);
            if x < left || y < top || x >= left + video_width || y >= top + video_height {
                continue;
            }
            let source = ((y - top) * video_width + (x - left)) * 4;
            let Some(pixel) = bgra.get(source..source + 4) else {
                continue;
            };
            *slot =
                tiny_skia::ColorU8::from_rgba(pixel[2], pixel[1], pixel[0], pixel[3]).premultiply();
        }
    });
}

/// Apply `mediaFilterCSS` to the media's rectangle.
fn apply_media_filters(frame: &mut Frame, (x, y, w, h): MediaRect, css: &str) {
    let parsed = filters::parse(css);
    if parsed.is_empty() {
        return;
    }
    let sigma = filters::blur_sigma(&parsed);
    let frame_width = frame.width();

    if (x, y, w, h) == (0, 0, frame.width(), frame.height()) {
        let pixels = frame.pixmap_mut_pixels();
        filters::apply_color(pixels, &parsed);
        if let Some(sigma) = sigma {
            filters::blur(pixels, w as usize, h as usize, sigma, 1.0);
        }
        return;
    }

    let pixels = frame.pixmap_mut_pixels();
    let mut region: Vec<tiny_skia::PremultipliedColorU8> = Vec::with_capacity((w * h) as usize);
    for row in y..y + h {
        let start = (row * frame_width + x) as usize;
        region.extend_from_slice(&pixels[start..start + w as usize]);
    }
    filters::apply_color(&mut region, &parsed);
    if let Some(sigma) = sigma {
        filters::blur(&mut region, w as usize, h as usize, sigma, 1.0);
    }
    for (offset, row) in (y..y + h).enumerate() {
        let start = (row * frame_width + x) as usize;
        let source = offset * w as usize;
        pixels[start..start + w as usize].copy_from_slice(&region[source..source + w as usize]);
    }
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
/// The slide a composer slides region shows, as a scene of its own: the
/// region's own slide where it has one, field by field, and the one on screen
/// where it does not, as `OutputWindow.tsx` falls back.
fn region_slide_scene(
    scene: &OutputScene,
    region: &super::composer::ComposerRegion,
) -> OutputScene {
    OutputScene {
        show_text: scene.show_text,
        active_slide_id: region
            .slide_id
            .clone()
            .or_else(|| scene.active_slide_id.clone()),
        slide_text: region
            .slide_text
            .clone()
            .or_else(|| scene.slide_text.clone()),
        slide_footer: region
            .slide_footer
            .clone()
            .or_else(|| scene.slide_footer.clone()),
        slide_elements: match region.slide_elements.as_ref() {
            Some(elements) => serde_json::to_value(elements).ok(),
            None => scene.slide_elements.clone(),
        },
        slide_canvas_size: region
            .slide_canvas_size
            .clone()
            .or_else(|| scene.slide_canvas_size.clone()),
        slide_background_color: region
            .slide_background_color
            .clone()
            .or_else(|| scene.slide_background_color.clone()),
        scripture_style: scene.scripture_style.clone(),
        library_style: scene.library_style.clone(),
        ..OutputScene::default()
    }
}

fn blend_over(frame: &mut Frame, layers: &Pixmap) {
    if frame.width() != layers.width() || frame.height() != layers.height() {
        return;
    }
    source_over(layers.pixels(), frame.pixmap_mut_pixels());
}

/// Premultiplied source-over, across cores.
fn source_over(
    source: &[tiny_skia::PremultipliedColorU8],
    destination: &mut [tiny_skia::PremultipliedColorU8],
) {
    super::parallel::zip_bands(source, destination, |source, destination| {
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
    });
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
/// The timer, the banner and the props are ignored for the same reason: each
/// has a layer of its own.
///
/// Only those are ignored. Nothing in the slide layers reads them; every other
/// field might.
fn layers_differ(cached: &OutputScene, scene: &OutputScene) -> bool {
    // What the slide layer is not drawn from. The video's own fields matter
    // most: while a video plays the operator's player reports where it is
    // about ten times a second, and `video_time_sampled_at_ms` changed with
    // each report. Compared here, it redrew the slide ten times a second for
    // as long as any video played, and rebuilt a running transition's layers
    // as often. A plain slide took that in its stride; a themed one, a tenth
    // of a second to draw, stalled the video, the slide changes and every
    // transition.
    let without_clocks = |value: &OutputScene| OutputScene {
        video_current_time: 0.0,
        video_time_sampled_at_ms: None,
        is_video_playing: false,
        should_sync_time: false,
        media_url: None,
        media_id: None,
        media_type: None,
        show_media: false,
        media_filter_css: String::new(),
        video_settings: crate::services::output::VideoSettings {
            loop_: false,
            muted: false,
        },
        timer_label: None,
        timer_text: None,
        timer_running: false,
        timer_visible: false,
        timer_time_up: None,
        timer_layout: None,
        message_overlay: None,
        props_overlay: Vec::new(),
        ..value.clone()
    };
    without_clocks(cached) != without_clocks(scene)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    use crate::services::compositor::scene::NoMedia;

    /// A scene showing a background video, which is the only way a decoded
    /// frame reaches the screen: the window draws media only for a scene that
    /// names some.
    fn video_scene() -> OutputScene {
        OutputScene {
            media_url: Some("local-media://media/clip.mp4".to_owned()),
            media_type: Some(MediaKind::Video),
            ..scene()
        }
    }

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

    /// The whole reason the transition engine is layer-aware.
    ///
    /// The lyric changes and the background video does not: the words are what
    /// transitions, the logo beside them does not move, and the video behind
    /// them is the frame the decoder handed over, untouched. A transition that
    /// restarted or dimmed the background on every line would be unusable in a
    /// service, and it is the default behaviour of every whole-frame
    /// transition system.
    #[test]
    fn a_lyric_changing_over_a_playing_video_moves_only_the_words() {
        let words = |text: &str| {
            json!([
                { "id": "logo", "type": "shape",
                  "x": 0.0, "y": 0.0, "width": 20.0, "height": 20.0,
                  "style": { "backgroundColor": "#00ff00" } },
                { "id": "words", "type": "shape",
                  "x": 40.0, "y": 40.0, "width": 40.0, "height": 40.0,
                  "style": { "backgroundColor": text } },
            ])
        };
        let video = frame_of(100, 100, [200, 100, 50, 255]);

        let first = OutputScene {
            slide_elements: Some(words("#ff0000")),
            ..video_scene()
        };
        let second = OutputScene {
            slide_elements: Some(words("#0000ff")),
            transition: Some(transition::Transition {
                kind: "fade".to_owned(),
                duration_ms: 400,
                ..transition::Transition::none()
            }),
            ..video_scene()
        };

        let mut compositor = SceneCompositor::new(100, 100);
        compositor
            .render(&first, Some(&video), &NoMedia)
            .expect("the first slide");

        // The second arrives, and a frame part way through it is drawn.
        compositor
            .render(&second, Some(&video), &NoMedia)
            .expect("the transition begins");
        std::thread::sleep(std::time::Duration::from_millis(120));
        let (frame, _) = compositor
            .render(&second, Some(&video), &NoMedia)
            .expect("part way through");
        let at = |x, y| frame.pixel_at(x, y).expect("a pixel");

        assert_eq!(
            at(90, 90),
            (50, 100, 200, 255),
            "the background is the frame the decoder handed over"
        );
        assert_eq!(
            at(10, 10),
            (0, 255, 0, 255),
            "the logo did not change, so it does not take part"
        );
        let (red, _, blue, _) = at(60, 60);
        assert!(
            red > 0 && blue > 0,
            "the words are part way between their two colours, not one or the other"
        );
    }

    /// The old words fade out while the new ones fade in, over a video that
    /// carries on beneath both.
    ///
    /// They used to stay at full strength under the arriving words until the
    /// transition ended, then vanish in one frame — which is what made the
    /// default transition look anything but smooth on the audience screen.
    #[test]
    fn the_old_words_fade_out_as_the_new_ones_fade_in() {
        let block = |x: f64, colour: &str| {
            json!([{
                "id": "words", "type": "shape",
                "x": x, "y": 20.0, "width": 30.0, "height": 60.0,
                "style": { "backgroundColor": colour }
            }])
        };
        let video = frame_of(100, 100, [0, 0, 0, 255]);
        let first = OutputScene {
            slide_elements: Some(block(10.0, "#ffffff")),
            ..video_scene()
        };
        let second = OutputScene {
            slide_elements: Some(block(60.0, "#ffffff")),
            transition: Some(transition::Transition {
                kind: "fade".to_owned(),
                duration_ms: 400,
                easing: transition::Easing::Linear,
                ..transition::Transition::none()
            }),
            ..video_scene()
        };

        let mut compositor = SceneCompositor::new(100, 100);
        compositor
            .render(&first, Some(&video), &NoMedia)
            .expect("the first slide");
        compositor
            .render(&second, Some(&video), &NoMedia)
            .expect("the transition begins");
        std::thread::sleep(std::time::Duration::from_millis(200));
        let (frame, _) = compositor
            .render(&second, Some(&video), &NoMedia)
            .expect("part way through");

        let (old, _, _, _) = frame.pixel_at(25, 50).expect("a pixel");
        let (new, _, _, _) = frame.pixel_at(75, 50).expect("a pixel");
        assert!(
            (40..=215).contains(&old),
            "the old words are on their way out, not still at full strength: {old}"
        );
        assert!(
            (40..=215).contains(&new),
            "the new words are on their way in: {new}"
        );
        assert_eq!(
            frame.pixel_at(50, 95),
            Some((0, 0, 0, 255)),
            "the video beneath carries on untouched"
        );
    }

    /// The owner's report: chosen on whole slide, with videos, nothing
    /// happened.
    ///
    /// It was drawing the transition into the slide layers, which a background
    /// video is not in — so a change of background crossed nothing at all. A
    /// whole-slide transition is between two finished pictures.
    #[test]
    fn a_whole_slide_transition_crosses_the_background_as_well() {
        let whole = |url: &str| OutputScene {
            media_url: Some(url.to_owned()),
            media_type: Some(MediaKind::Video),
            transition: Some(transition::Transition {
                kind: "fade".to_owned(),
                duration_ms: 400,
                mode: transition::Mode::FullSlide,
                ..transition::Transition::none()
            }),
            ..scene()
        };

        let mut compositor = SceneCompositor::new(100, 100);
        let first = frame_of(100, 100, [0, 0, 255, 255]);
        compositor
            .render(
                &whole("local-media://media/one.mp4"),
                Some(&first),
                &NoMedia,
            )
            .expect("the first video");

        // A different file, and a frame of a different colour with it.
        let second = frame_of(100, 100, [255, 0, 0, 255]);
        let arriving = whole("local-media://media/two.mp4");
        compositor
            .render(&arriving, Some(&second), &NoMedia)
            .expect("the transition begins");
        std::thread::sleep(std::time::Duration::from_millis(120));

        let (frame, _) = compositor
            .render(&arriving, Some(&second), &NoMedia)
            .expect("part way through");
        let (red, _, blue, _) = frame.pixel_at(50, 50).expect("a pixel");
        assert!(
            red > 0 && blue > 0,
            "part way between the two backgrounds, not one or the other: {red},{blue}"
        );
    }

    /// What a consumer that skips unchanged scenes keeps: the preview and the
    /// audience window both draw like this.
    #[derive(Default)]
    struct Skipping {
        last: Option<(OutputScene, Option<f64>, (u32, u32))>,
        shown: Option<(u8, u8, u8, u8)>,
        draws: usize,
    }

    impl Skipping {
        fn tick(&mut self, compositor: &mut SceneCompositor, scene: &OutputScene) {
            if !compositor.needs_drawing(self.last.as_ref(), scene, None, &[], (100, 100)) {
                return;
            }
            let (frame, _) = compositor.render(scene, None, &NoMedia).expect("a frame");
            self.shown = frame.pixel_at(50, 50);
            self.last = Some((scene.clone(), None, (100, 100)));
            self.draws += 1;
        }
    }

    fn solid_slide(colour: &str, transition: Option<transition::Transition>) -> OutputScene {
        OutputScene {
            slide_elements: Some(json!([{
                "id": "words", "type": "shape",
                "x": 0.0, "y": 0.0, "width": 100.0, "height": 100.0,
                "style": { "backgroundColor": colour }
            }])),
            transition,
            ..scene()
        }
    }

    /// The preview was one slide behind whenever a transition was set: it
    /// drew the first frame of the transition, mostly the slide being left,
    /// and then kept that picture because the scene had not changed.
    #[test]
    fn a_consumer_that_skips_unchanged_scenes_draws_a_transition_to_its_end() {
        let mut compositor = SceneCompositor::new(100, 100);
        let mut preview = Skipping::default();
        preview.tick(&mut compositor, &solid_slide("#ff0000", None));
        assert_eq!(preview.shown, Some((255, 0, 0, 255)), "slide one");

        let slide_two = solid_slide(
            "#0000ff",
            Some(transition::Transition {
                kind: "fade".to_owned(),
                duration_ms: 60,
                ..transition::Transition::none()
            }),
        );
        let started = std::time::Instant::now();
        while started.elapsed() < std::time::Duration::from_millis(200) {
            preview.tick(&mut compositor, &slide_two);
            std::thread::sleep(std::time::Duration::from_millis(4));
        }
        assert_eq!(
            preview.shown,
            Some((0, 0, 255, 255)),
            "slide two, not the start of the fade"
        );
        assert!(
            preview.draws > 3,
            "drawn through the fade, not once: {}",
            preview.draws
        );

        let draws = preview.draws;
        for _ in 0..5 {
            preview.tick(&mut compositor, &slide_two);
        }
        assert_eq!(preview.draws, draws, "and not again once it has ended");
    }

    #[test]
    fn a_still_slide_is_drawn_once_and_a_scrolling_message_every_time() {
        let mut compositor = SceneCompositor::new(100, 100);
        let still = solid_slide("#ff0000", None);
        let mut preview = Skipping::default();
        for _ in 0..4 {
            preview.tick(&mut compositor, &still);
        }
        assert_eq!(preview.draws, 1);

        let scrolling = OutputScene {
            message_overlay: Some(crate::services::output::MessageOverlay {
                id: "m".to_owned(),
                text: "Welcome".to_owned(),
                position: "bottom".to_owned(),
                theme_key: "default".to_owned(),
                shown_at_ms: 0.0,
                dismiss_mode: "manual".to_owned(),
                animation: "marquee-left".to_owned(),
                speed_seconds: 10.0,
                font_scale: 1.0,
            }),
            ..still
        };
        let mut preview = Skipping::default();
        for _ in 0..4 {
            preview.tick(&mut compositor, &scrolling);
        }
        assert_eq!(
            preview.draws, 4,
            "a marquee moves while its scene stands still"
        );
    }

    #[test]
    fn a_scrolling_message_is_somewhere_new_on_frames_a_few_milliseconds_apart() {
        // An output draws sixty frames a second. The words were moved only
        // thirty times a second, so frames drawn close together were the same
        // picture, and then the next leapt: the stutter an operator saw.
        let now_ms = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map_or(0.0, |since| since.as_secs_f64() * 1000.0);
        let scrolling = OutputScene {
            message_overlay: Some(crate::services::output::MessageOverlay {
                id: "m".to_owned(),
                text: "Welcome".to_owned(),
                position: "top".to_owned(),
                theme_key: "default".to_owned(),
                shown_at_ms: now_ms - 500.0,
                dismiss_mode: "manual".to_owned(),
                animation: "marquee-left".to_owned(),
                speed_seconds: 2.0,
                font_scale: 1.0,
            }),
            ..scene()
        };
        let mut compositor = SceneCompositor::new(320, 180);
        let first = compositor
            .render(&scrolling, None, &NoMedia)
            .map(|(frame, _)| frame.pixmap().data().to_vec())
            .expect("a frame");
        std::thread::sleep(std::time::Duration::from_millis(8));
        let second = compositor
            .render(&scrolling, None, &NoMedia)
            .map(|(frame, _)| frame.pixmap().data().to_vec())
            .expect("a frame");
        assert_ne!(first, second, "the words moved between the two frames");
    }

    #[test]
    fn a_transition_ends_and_leaves_the_new_slide_on_screen() {
        let slide = |colour: &str, transition: Option<transition::Transition>| OutputScene {
            slide_elements: Some(json!([{
                "id": "words", "type": "shape",
                "x": 0.0, "y": 0.0, "width": 100.0, "height": 100.0,
                "style": { "backgroundColor": colour }
            }])),
            transition,
            ..scene()
        };

        let mut compositor = SceneCompositor::new(100, 100);
        compositor
            .render(&slide("#ff0000", None), None, &NoMedia)
            .expect("the first slide");

        let arriving = slide(
            "#0000ff",
            Some(transition::Transition {
                kind: "fade".to_owned(),
                // Short enough that the next frame is after the end of it.
                duration_ms: 1,
                ..transition::Transition::none()
            }),
        );
        compositor
            .render(&arriving, None, &NoMedia)
            .expect("mid transition");
        std::thread::sleep(std::time::Duration::from_millis(5));

        let (frame, _) = compositor
            .render(&arriving, None, &NoMedia)
            .expect("after it");
        assert_eq!(
            frame.pixel_at(50, 50),
            Some((0, 0, 255, 255)),
            "the new slide, with nothing of the old one left"
        );
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

    /// Counts reads, and answers with `bytes` or nothing.
    struct CountingLoader {
        bytes: Option<Vec<u8>>,
        reads: std::cell::Cell<usize>,
    }

    impl MediaLoader for CountingLoader {
        fn load(&self, _url: &str) -> Option<Vec<u8>> {
            self.reads.set(self.reads.get() + 1);
            self.bytes.clone()
        }
    }

    fn red_png() -> Vec<u8> {
        let image = image::RgbaImage::from_pixel(4, 4, image::Rgba([255, 0, 0, 255]));
        let mut out = std::io::Cursor::new(Vec::new());
        image::DynamicImage::ImageRgba8(image)
            .write_to(&mut out, image::ImageFormat::Png)
            .expect("encode");
        out.into_inner()
    }

    #[test]
    fn a_video_with_no_frame_yet_is_never_read_as_an_image() {
        // The image path would read the whole video file and fail to decode
        // it — every frame, for as long as the decoder has nothing to give.
        let loader = CountingLoader {
            bytes: Some(vec![0; 64]),
            reads: std::cell::Cell::new(0),
        };
        let scene = OutputScene {
            media_url: Some("local-media://media/loop.mp4".to_owned()),
            media_type: Some(MediaKind::Video),
            ..scene()
        };
        let mut compositor = SceneCompositor::new(100, 100);

        let (_, report) = compositor.render(&scene, None, &loader).expect("frame");
        assert!(report.background_media_missing);
        compositor.render(&scene, None, &loader).expect("frame");
        assert_eq!(loader.reads.get(), 0);
    }

    #[test]
    fn a_background_image_is_read_once_not_every_frame() {
        let loader = CountingLoader {
            bytes: Some(red_png()),
            reads: std::cell::Cell::new(0),
        };
        let scene = OutputScene {
            media_url: Some("local-media://media/bg.png".to_owned()),
            media_type: Some(MediaKind::Image),
            ..scene()
        };
        let mut compositor = SceneCompositor::new(100, 100);

        for _ in 0..3 {
            let (frame, report) = compositor.render(&scene, None, &loader).expect("frame");
            assert!(report.background_media_drawn);
            assert_eq!(frame.pixel_at(50, 50), Some((255, 0, 0, 255)));
        }
        assert_eq!(loader.reads.get(), 1);

        let other = OutputScene {
            media_url: Some("local-media://media/other.png".to_owned()),
            ..scene
        };
        compositor.render(&other, None, &loader).expect("frame");
        assert_eq!(loader.reads.get(), 2, "a different image is read");
    }

    #[test]
    fn a_missing_background_image_is_not_retried_every_frame() {
        let loader = CountingLoader {
            bytes: None,
            reads: std::cell::Cell::new(0),
        };
        let scene = OutputScene {
            media_url: Some("local-media://media/missing.png".to_owned()),
            media_type: Some(MediaKind::Image),
            ..scene()
        };
        let mut compositor = SceneCompositor::new(100, 100);

        for _ in 0..5 {
            let (_, report) = compositor.render(&scene, None, &loader).expect("frame");
            assert!(report.background_media_missing);
        }
        assert_eq!(loader.reads.get(), 1);
    }

    #[test]
    fn a_video_of_another_shape_is_pillarboxed_not_stretched() {
        // `object-contain`, as the window draws it. A 4:3 video on a 16:9
        // output keeps its shape and leaves black either side.
        let mut compositor = SceneCompositor::new(160, 90);
        let video = frame_of(120, 90, [0, 0, 255, 255]);
        let (frame, report) = compositor
            .render(&video_scene(), Some(&video), &NoMedia)
            .expect("frame");

        assert!(report.background_media_drawn);
        assert_eq!(frame.pixel_at(5, 45), Some((0, 0, 0, 255)), "left bar");
        assert_eq!(frame.pixel_at(154, 45), Some((0, 0, 0, 255)), "right bar");
        assert_eq!(
            frame.pixel_at(80, 45),
            Some((255, 0, 0, 255)),
            "the video, unstretched"
        );
        assert_eq!(
            frame.pixel_at(21, 45),
            Some((255, 0, 0, 255)),
            "its left edge where 4:3 puts it"
        );
    }

    #[test]
    fn a_video_the_decoder_has_not_scaled_is_contained_too() {
        let mut compositor = SceneCompositor::new(160, 90);
        let video = frame_of(80, 60, [0, 255, 0, 255]);
        let (frame, _) = compositor
            .render(&video_scene(), Some(&video), &NoMedia)
            .expect("frame");
        assert_eq!(
            frame.pixel_at(3, 45),
            Some((0, 0, 0, 255)),
            "no smeared edge in the bar"
        );
        assert_eq!(frame.pixel_at(80, 45), Some((0, 255, 0, 255)));
    }

    #[test]
    fn the_operators_filters_dim_the_video_and_not_the_bars_or_the_words() {
        let mut compositor = SceneCompositor::new(160, 90);
        let scene = OutputScene {
            media_filter_css: "brightness(50%) contrast(50%)".to_owned(),
            slide_elements: Some(json!([{
                "id": "a", "type": "shape",
                "x": 0.0, "y": 0.0, "width": 100.0, "height": 100.0,
                "style": { "backgroundColor": "#ffffff" }
            }])),
            slide_canvas_size: Some("1920x1080".to_owned()),
            ..video_scene()
        };
        let video = frame_of(120, 90, [200, 200, 200, 255]);
        let (frame, _) = compositor
            .render(&scene, Some(&video), &NoMedia)
            .expect("frame");

        // 200/255 halved is 100/255, then pulled halfway to mid-grey.
        let (r, _, _, _) = frame.pixel_at(80, 60).expect("pixel");
        assert!((105..=118).contains(&r), "the video is dimmed: {r}");
        assert_eq!(
            frame.pixel_at(158, 60),
            Some((0, 0, 0, 255)),
            "the bar is not lifted to grey"
        );
        assert_eq!(
            frame.pixel_at(2, 2),
            Some((255, 255, 255, 255)),
            "the slide is not dimmed"
        );
    }

    #[test]
    fn the_slide_colour_is_drawn_over_the_video() {
        let mut compositor = SceneCompositor::new(100, 100);
        let scene = OutputScene {
            slide_background_color: Some("rgba(0, 0, 255, 0.5)".to_owned()),
            ..video_scene()
        };
        let video = frame_of(100, 100, [0, 0, 255, 255]);
        let (frame, _) = compositor
            .render(&scene, Some(&video), &NoMedia)
            .expect("frame");
        let (r, _, b, _) = frame.pixel_at(50, 50).expect("pixel");
        assert!(
            r > 100 && r < 160 && b > 100 && b < 160,
            "half blue over red: {r} {b}"
        );
    }

    #[test]
    fn the_composer_draws_no_full_screen_background_under_its_regions() {
        let mut compositor = SceneCompositor::new(100, 100);
        let scene = OutputScene {
            screen_composer_enabled: true,
            slide_background_color: Some("#0000ff".to_owned()),
            ..video_scene()
        };
        let video = frame_of(100, 100, [0, 255, 0, 255]);
        let (frame, report) = compositor
            .render(&scene, Some(&video), &NoMedia)
            .expect("frame");
        assert_eq!(frame.pixel_at(50, 50), Some((0, 0, 0, 255)));
        assert!(!report.background_media_drawn);
    }

    #[test]
    fn a_playing_video_reporting_its_place_does_not_redraw_the_slide() {
        // About ten reports a second while a video plays. Each one redrew the
        // slide, which for a themed slide was most of every second.
        let mut compositor = SceneCompositor::new(160, 90);
        let reported_at = |ms: f64| OutputScene {
            video_time_sampled_at_ms: Some(ms),
            video_current_time: ms / 1000.0,
            is_video_playing: true,
            ..solid_slide("#ff0000", None)
        };
        compositor
            .render(&reported_at(1_000.0), None, &NoMedia)
            .expect("frame");
        assert!(
            compositor.rebuilt_last_frame(),
            "the first frame draws the slide"
        );
        for report in 1..=5 {
            compositor
                .render(
                    &reported_at(1_000.0 + f64::from(report) * 100.0),
                    None,
                    &NoMedia,
                )
                .expect("frame");
            assert!(
                !compositor.rebuilt_last_frame(),
                "report {report} redrew a slide that had not changed"
            );
        }
    }

    #[test]
    fn a_verse_reaches_the_frame() {
        // Every Bible verse used to be missing: generated scripture is plain
        // text, and only elements were drawn.
        let mut compositor = SceneCompositor::new(640, 360);
        let scene = OutputScene {
            active_slide_id: Some("scripture:0".to_owned()),
            slide_text: Some("For God so loved the world".to_owned()),
            slide_footer: Some("John 3:16".to_owned()),
            ..scene()
        };
        let (frame, report) = compositor.render(&scene, None, &NoMedia).expect("frame");
        assert_eq!(report.elements_drawn, 1);
        let lit = frame
            .pixmap()
            .pixels()
            .iter()
            .filter(|p| p.red() > 200)
            .count();
        assert!(lit > 500, "the verse is on the frame: {lit} bright pixels");

        compositor.render(&scene, None, &NoMedia).expect("again");
        assert!(
            !compositor.rebuilt_last_frame(),
            "and cached like any slide"
        );
    }

    /// A screen's layout from Looks, with its words in a lower third over a
    /// blue band.
    fn lower_third() -> ScreenLayout {
        ScreenLayout {
            words_box: Some(LayerBox {
                x_percent: 50.0,
                y_percent: 84.0,
                width_percent: 90.0,
                height_percent: 24.0,
            }),
            words_backdrop: Some("#0000ff".to_owned()),
            ..ScreenLayout::NONE
        }
    }

    /// The rows of the frame with words on them: near-white pixels.
    fn rows_with_words(frame: &Frame) -> Vec<u32> {
        let pixmap = frame.pixmap();
        let width = pixmap.width();
        let mut rows: Vec<u32> = pixmap
            .pixels()
            .iter()
            .enumerate()
            .filter(|(_, p)| p.red() > 200 && p.green() > 200)
            .map(|(index, _)| index as u32 / width)
            .collect();
        rows.dedup();
        rows
    }

    #[test]
    fn a_verse_laid_out_as_a_lower_third_stays_in_its_band() {
        let mut compositor = SceneCompositor::new(640, 360);
        let scene = OutputScene {
            active_slide_id: Some("scripture:0".to_owned()),
            slide_text: Some("For God so loved the world".to_owned()),
            slide_footer: Some("John 3:16".to_owned()),
            screen_layout: Some(lower_third()),
            ..scene()
        };
        let (frame, report) = compositor.render(&scene, None, &NoMedia).expect("frame");
        assert_eq!(report.elements_drawn, 1);

        // The band runs from 72% of the way down to 96%.
        let rows = rows_with_words(frame);
        assert!(!rows.is_empty(), "the verse is on the frame");
        assert!(
            rows.iter().all(|row| (259..=346).contains(row)),
            "only in the band: rows {}..{}",
            rows[0],
            rows[rows.len() - 1]
        );
        assert_eq!(
            frame.pixel_at(36, 262),
            Some((0, 0, 255, 255)),
            "on its backdrop"
        );
        assert_eq!(
            frame.pixel_at(320, 100),
            Some((0, 0, 0, 255)),
            "and nothing above it"
        );
    }

    #[test]
    fn a_designed_slide_shown_text_only_is_its_words_in_the_box() {
        let mut compositor = SceneCompositor::new(640, 360);
        let scene = OutputScene {
            slide_canvas_size: Some("1920x1080".to_owned()),
            slide_elements: Some(json!([
                {
                    "id": "shape", "type": "shape",
                    "x": 0.0, "y": 0.0, "width": 1920.0, "height": 400.0,
                    "style": { "backgroundColor": "#00ff00" }
                },
                {
                    "id": "words", "type": "text",
                    "x": 100.0, "y": 100.0, "width": 1720.0, "height": 300.0,
                    "content": "Amazing grace how sweet the sound",
                    "style": { "fontSize": 90, "color": "#ffffff" }
                }
            ])),
            screen_layout: Some(ScreenLayout {
                words_text_only: true,
                ..lower_third()
            }),
            ..scene()
        };
        let (frame, _) = compositor.render(&scene, None, &NoMedia).expect("frame");

        let rows = rows_with_words(frame);
        assert!(!rows.is_empty(), "the words are on the frame");
        assert!(
            rows.iter().all(|row| (259..=346).contains(row)),
            "in the band"
        );
        let green = frame
            .pixmap()
            .pixels()
            .iter()
            .filter(|p| p.green() > 200 && p.red() < 50)
            .count();
        assert_eq!(green, 0, "and nothing of the slide but its words");
    }

    #[test]
    fn a_designed_slide_in_a_box_is_scaled_into_it_whole() {
        let mut compositor = SceneCompositor::new(160, 90);
        let scene = OutputScene {
            slide_canvas_size: Some("1920x1080".to_owned()),
            slide_elements: Some(json!([{
                "id": "a", "type": "shape",
                "x": 0.0, "y": 0.0, "width": 1920.0, "height": 1080.0,
                "style": { "backgroundColor": "#00ff00" }
            }])),
            screen_layout: Some(ScreenLayout {
                // The right half of the screen, a slide's shape in its middle.
                words_box: Some(LayerBox {
                    x_percent: 75.0,
                    y_percent: 50.0,
                    width_percent: 50.0,
                    height_percent: 100.0,
                }),
                ..ScreenLayout::NONE
            }),
            ..scene()
        };
        let (frame, _) = compositor.render(&scene, None, &NoMedia).expect("frame");
        assert_eq!(frame.pixel_at(120, 45), Some((0, 255, 0, 255)), "the slide");
        assert_eq!(
            frame.pixel_at(40, 45),
            Some((0, 0, 0, 255)),
            "not on the left"
        );
        assert_eq!(
            frame.pixel_at(120, 5),
            Some((0, 0, 0, 255)),
            "kept its shape"
        );
    }

    /// A PDF's page: the whole slide one colour, on the Slide layer.
    fn presentation_page() -> OutputScene {
        OutputScene {
            presentation_slide: true,
            slide_canvas_size: Some("1920x1080".to_owned()),
            slide_text: Some("Page 1".to_owned()),
            slide_elements: Some(json!([{
                "id": "page", "type": "shape",
                "x": 0.0, "y": 0.0, "width": 1920.0, "height": 1080.0,
                "style": { "backgroundColor": "#00ff00" }
            }])),
            ..scene()
        }
    }

    #[test]
    fn a_presentation_slide_is_not_squeezed_into_the_words_band() {
        // A lower third is for words. A PDF's page has none, and shrunk into
        // the band it was a sliver of a picture, or nothing at all.
        let mut compositor = SceneCompositor::new(160, 90);
        let scene = OutputScene {
            screen_layout: Some(lower_third()),
            ..presentation_page()
        };
        let (frame, report) = compositor.render(&scene, None, &NoMedia).expect("frame");
        assert_eq!(report.elements_drawn, 1);
        assert_eq!(
            frame.pixel_at(80, 10),
            Some((0, 255, 0, 255)),
            "full screen"
        );
        assert_eq!(
            frame.pixel_at(80, 80),
            Some((0, 255, 0, 255)),
            "with no band"
        );
    }

    #[test]
    fn a_presentation_slide_goes_into_its_own_box_whole() {
        let mut compositor = SceneCompositor::new(160, 90);
        let scene = OutputScene {
            slide_background_color: Some("#0000ff".to_owned()),
            screen_layout: Some(ScreenLayout {
                // The right half of the screen, a slide's shape in its middle.
                slide_box: LayerBox {
                    x_percent: 75.0,
                    y_percent: 50.0,
                    width_percent: 50.0,
                    height_percent: 100.0,
                },
                ..lower_third()
            }),
            ..presentation_page()
        };
        let (frame, _) = compositor.render(&scene, None, &NoMedia).expect("frame");
        assert_eq!(frame.pixel_at(120, 45), Some((0, 255, 0, 255)), "the slide");
        assert_eq!(
            frame.pixel_at(40, 45),
            Some((0, 0, 0, 255)),
            "and its colour, which goes with it, not on the left"
        );
        assert_eq!(
            frame.pixel_at(120, 5),
            Some((0, 0, 0, 255)),
            "kept its shape"
        );
    }

    #[test]
    fn a_presentation_off_its_layer_takes_its_colour_with_it() {
        let mut compositor = SceneCompositor::new(160, 90);
        let hidden = OutputScene {
            show_text: false,
            slide_background_color: Some("#0000ff".to_owned()),
            ..presentation_page()
        };
        let (frame, report) = compositor.render(&hidden, None, &NoMedia).expect("frame");
        assert_eq!(report.elements_drawn, 0);
        assert_eq!(frame.pixel_at(80, 45), Some((0, 0, 0, 255)), "nothing");

        // The words' colour stays when the words go, as it always has.
        let words = OutputScene {
            presentation_slide: false,
            ..hidden
        };
        let (frame, _) = compositor.render(&words, None, &NoMedia).expect("frame");
        assert_eq!(frame.pixel_at(80, 45), Some((0, 0, 255, 255)));
    }

    #[test]
    fn an_empty_slide_leaves_no_band() {
        let mut compositor = SceneCompositor::new(640, 360);
        let scene = OutputScene {
            screen_layout: Some(lower_third()),
            ..scene()
        };
        let (frame, _) = compositor.render(&scene, None, &NoMedia).expect("frame");
        assert_eq!(frame.pixel_at(36, 262), Some((0, 0, 0, 255)));
    }

    #[test]
    fn media_goes_where_the_screens_layout_puts_it() {
        let mut compositor = SceneCompositor::new(160, 90);
        let video = frame_of(160, 90, [0, 0, 255, 255]);
        let layout = |fill| ScreenLayout {
            media_box: LayerBox {
                x_percent: 25.0,
                y_percent: 50.0,
                width_percent: 50.0,
                height_percent: 100.0,
            },
            media_fill: fill,
            ..ScreenLayout::NONE
        };

        let filled = OutputScene {
            screen_layout: Some(layout(true)),
            ..video_scene()
        };
        let (frame, report) = compositor
            .render(&filled, Some(&video), &NoMedia)
            .expect("frame");
        assert!(report.background_media_drawn);
        assert_eq!(
            frame.pixel_at(40, 5),
            Some((255, 0, 0, 255)),
            "filling the left half"
        );
        assert_eq!(
            frame.pixel_at(120, 45),
            Some((0, 0, 0, 255)),
            "and only that"
        );

        let fitted = OutputScene {
            screen_layout: Some(layout(false)),
            ..video_scene()
        };
        let (frame, _) = compositor
            .render(&fitted, Some(&video), &NoMedia)
            .expect("frame");
        assert_eq!(
            frame.pixel_at(40, 45),
            Some((255, 0, 0, 255)),
            "fitted in it"
        );
        assert_eq!(frame.pixel_at(40, 5), Some((0, 0, 0, 255)), "letterboxed");
    }

    #[test]
    fn a_layer_goes_into_a_box_evenly_and_centred() {
        let mut layer = Pixmap::new(100, 100).expect("layer");
        layer.fill(Color::from_rgba8(255, 0, 0, 255));
        let mut target = Pixmap::new(100, 100).expect("target");
        // The right half: the layer at half size, centred down it.
        draw_into_box(
            &mut target.as_mut(),
            &layer,
            &LayerBox {
                x_percent: 75.0,
                y_percent: 50.0,
                width_percent: 50.0,
                height_percent: 100.0,
            },
        );
        let at = |x: u32, y: u32| target.pixel(x, y).map(|p| (p.red(), p.alpha()));
        assert_eq!(at(75, 50), Some((255, 255)));
        assert_eq!(at(25, 50), Some((0, 0)), "not on the left");
        assert_eq!(at(75, 10), Some((0, 0)), "nor stretched to the top");
    }

    #[test]
    fn a_ticking_countdown_redraws_the_clock_but_not_the_slide() {
        let mut compositor = SceneCompositor::new(200, 120);
        let tick = |text: &str| OutputScene {
            slide_elements: Some(json!([{
                "id": "a", "type": "shape",
                "x": 0.0, "y": 0.0, "width": 50.0, "height": 50.0,
                "style": { "backgroundColor": "#ff0000" }
            }])),
            timer_visible: true,
            timer_text: Some(text.to_owned()),
            ..scene()
        };

        let first = compositor
            .render(&tick("05:00"), None, &NoMedia)
            .expect("first")
            .0
            .as_rgba()
            .to_vec();
        let second = compositor
            .render(&tick("04:59"), None, &NoMedia)
            .expect("second")
            .0
            .as_rgba()
            .to_vec();

        assert!(
            !compositor.rebuilt_last_frame(),
            "a tick must not rebuild the slide layer"
        );
        assert_ne!(first, second, "but the clock on screen must change");

        let hidden = OutputScene {
            timer_visible: false,
            ..tick("04:59")
        };
        let without = compositor
            .render(&hidden, None, &NoMedia)
            .expect("hidden")
            .0
            .as_rgba()
            .to_vec();
        assert_ne!(without, second, "hiding the timer takes it off the frame");
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
            .render(&video_scene(), Some(&video), &NoMedia)
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
            .render(&video_scene(), Some(&broken), &NoMedia)
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
        // When the composer is on, the regions *are* the output. A slides
        // region with no slide of its own shows the one on screen, inside the
        // region and scaled to it, as the output window does, and nothing is
        // drawn outside the regions.
        let mut compositor = SceneCompositor::new(200, 100);
        let scene = OutputScene {
            screen_composer_enabled: true,
            screen_composer_layout: Some(json!({
                "regions": [{
                    "x": 0.0, "y": 0.0, "width": 50.0, "height": 100.0,
                    "source": "slides",
                    "backgroundColor": "#00ff00"
                }]
            })),
            slide_elements: Some(json!([{
                "id": "a", "type": "shape",
                "x": 0.0, "y": 0.0, "width": 100.0, "height": 50.0,
                "style": { "backgroundColor": "#ff0000" }
            }])),
            slide_canvas_size: Some("100x100".to_owned()),
            ..scene()
        };

        let (frame, _) = compositor.render(&scene, None, &NoMedia).expect("frame");

        assert_eq!(
            frame.pixel_at(50, 20),
            Some((255, 0, 0, 255)),
            "the slide, drawn inside its region"
        );
        assert_eq!(
            frame.pixel_at(50, 80),
            Some((0, 255, 0, 255)),
            "the region's plate below the slide's shape"
        );
        assert_eq!(
            frame.pixel_at(150, 50),
            Some((0, 0, 0, 255)),
            "and nothing outside the region"
        );
    }

    #[test]
    fn regions_land_where_the_composer_put_them() {
        // The layout is in percentages. Read as fractions of 1, a region 50
        // wide covered the whole screen and one starting at 50 was off it.
        let mut compositor = SceneCompositor::new(200, 100);
        let scene = OutputScene {
            screen_composer_enabled: true,
            screen_composer_layout: Some(json!({
                "regions": [
                    { "x": 0.0, "y": 0.0, "width": 50.0, "height": 100.0,
                      "source": "video", "backgroundColor": "#ff0000" },
                    { "x": 50.0, "y": 0.0, "width": 50.0, "height": 100.0,
                      "source": "video", "backgroundColor": "#0000ff" }
                ]
            })),
            ..scene()
        };
        let (frame, _) = compositor.render(&scene, None, &NoMedia).expect("frame");
        assert_eq!(
            frame.pixel_at(40, 50),
            Some((255, 0, 0, 255)),
            "left region on the left"
        );
        assert_eq!(
            frame.pixel_at(160, 50),
            Some((0, 0, 255, 255)),
            "right region on the right"
        );
    }

    #[test]
    fn a_region_plays_its_own_video() {
        let mut compositor = SceneCompositor::new(200, 100);
        let scene = OutputScene {
            screen_composer_enabled: true,
            screen_composer_layout: Some(json!({
                "regions": [{
                    "id": "left", "x": 0.0, "y": 0.0, "width": 50.0, "height": 100.0,
                    "source": "video", "fitMode": "fill",
                    "mediaUrl": "local-media://media/clip.mp4", "mediaType": "video",
                    "backgroundColor": "#0000ff"
                }]
            })),
            ..scene()
        };
        assert!(compositor.needs_drawing(None, &scene, None, &[], (200, 100)));
        let (frame, _) = compositor.render(&scene, None, &NoMedia).expect("frame");
        assert_eq!(
            frame.pixel_at(50, 50),
            Some((0, 0, 255, 255)),
            "its plate while the video opens"
        );

        let video = frame_of(64, 36, [0, 255, 0, 255]);
        let frames = [("left".to_owned(), &video)];
        let drawn = Some((scene.clone(), None, (200, 100)));
        assert!(
            compositor.needs_drawing(drawn.as_ref(), &scene, None, &frames, (200, 100)),
            "a region's first frame moves the picture while the scene stands still"
        );
        let (frame, _) = compositor
            .render_with_regions(&scene, None, &frames, &NoMedia)
            .expect("frame");
        assert_eq!(
            frame.pixel_at(50, 50),
            Some((0, 255, 0, 255)),
            "then the video, in its region"
        );
        assert_eq!(
            frame.pixel_at(150, 50),
            Some((0, 0, 0, 255)),
            "and only there"
        );

        assert!(
            !compositor.needs_drawing(drawn.as_ref(), &scene, None, &frames, (200, 100)),
            "the same frame is not drawn twice"
        );
        let next = VideoFrame {
            presentation_seconds: 0.04,
            ..frame_of(64, 36, [0, 255, 0, 255])
        };
        let moved_on = [("left".to_owned(), &next)];
        assert!(
            compositor.needs_drawing(drawn.as_ref(), &scene, None, &moved_on, (200, 100)),
            "the next one is"
        );
    }

    #[test]
    fn a_countdown_region_shows_the_running_timer() {
        let mut compositor = SceneCompositor::new(320, 180);
        let clock_at = |text: &str| OutputScene {
            screen_composer_enabled: true,
            screen_composer_layout: Some(json!({
                "regions": [{
                    "x": 0.0, "y": 0.0, "width": 100.0, "height": 100.0,
                    "source": "countdown", "backgroundColor": "transparent",
                    "textContent": "00:00:00"
                }]
            })),
            timer_text: Some(text.to_owned()),
            timer_visible: true,
            ..scene()
        };
        let bright = |frame: &Frame| {
            frame
                .pixmap()
                .pixels()
                .iter()
                .filter(|pixel| pixel.red() > 200)
                .count()
        };
        let (first, _) = compositor
            .render(&clock_at("04:59"), None, &NoMedia)
            .expect("frame");
        let first_ink = bright(first);
        let first_pixels = first.pixmap().data().to_vec();
        assert!(first_ink > 50, "the clock is drawn: {first_ink}");
        let (second, _) = compositor
            .render(&clock_at("04:58"), None, &NoMedia)
            .expect("frame");
        assert_ne!(
            second.pixmap().data(),
            &first_pixels[..],
            "and it is the timer's time, not a fixed 00:00:00"
        );
    }

    #[test]
    fn a_camera_region_is_left_to_the_webview_layer() {
        let mut compositor = SceneCompositor::new(200, 100);
        let scene = OutputScene {
            screen_composer_enabled: true,
            screen_composer_layout: Some(json!({
                "regions": [{
                    "x": 0.0, "y": 0.0, "width": 100.0, "height": 100.0,
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
