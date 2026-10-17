//! What the audience sees, as one authoritative value.
//!
//! This replaces the `send-to-output` / `send-to-stage` relay, which the audit
//! is explicit about: those channels "are not an API — they are a symptom of
//! state living in the wrong process and must be replaced by Rust-owned state
//! and typed events, not renamed" (§4).
//!
//! What they do today is worth spelling out, because the shape of the fix
//! follows from it. `useOutputBroadcast.ts` builds four partial payloads from
//! React state, JSON-stringifies each one to compare it with the last, and
//! forwards the ones that changed through a main process that only relays
//! `unknown`. The receiving window then **merges those partials into its own
//! React state** (`OutputWindow.tsx:264-370`). So the authoritative scene
//! exists nowhere: it is split across a sender that knows what it last sent and
//! a receiver that knows what it has accumulated, and the two can disagree with
//! nothing to reconcile them.
//!
//! Here there is one scene. The operator sends updates, Rust merges them, and
//! every surface receives the whole scene. Three things fall out of that:
//!
//! * **Late join stops needing a handshake.** A window that opens mid-service
//!   asks for the scene. The `output-ready` / `worship-stage-ready` round trip
//!   and its re-send exist only because the sender had to be told to repeat
//!   itself.
//! * **Change detection stops being string comparison.** `JSON.stringify` of
//!   every payload on every React render becomes one structural comparison.
//! * **A blank audience screen becomes hard rather than easy.** The receiver
//!   renders a value instead of reconstructing one.
//!
//! **Where the typing stops.** Rust types everything it reasons about — the
//! flags, the media reference, playback position, the overlays, the styles.
//! Slide *elements* and the screen-composer layout are carried verbatim as
//! JSON, because nothing in Rust interprets them until the wgpu compositor in
//! Stage 5 has to draw them (ADR-001). Carrying them is not the same as the
//! opaque relay this replaces: they sit in a typed field of a typed scene, and
//! the day the compositor needs them is the day they get a struct.

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum MediaKind {
    Image,
    Video,
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VideoSettings {
    /// `loop` on the wire, which is a Rust keyword.
    #[serde(rename = "loop")]
    pub loop_: bool,
    pub muted: bool,
}

impl VideoSettings {
    const DEFAULT: Self = Self {
        loop_: true,
        muted: false,
    };
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OutputTextPosition {
    pub x_percent: f64,
    pub y_percent: f64,
    pub width_percent: f64,
    pub height_percent: f64,
    /// Alignment is carried as written rather than parsed into an enum: these
    /// are values the renderer turns into CSS, and one Rust does not recognise
    /// should reach the browser rather than be replaced by a guess.
    pub text_align: String,
    pub vertical_align: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScriptureStyle {
    pub font_size: f64,
    pub footer_font_size: f64,
    pub font_family: String,
    pub font_weight: String,
    pub text_align: String,
    pub vertical_align: String,
    pub footer_align: String,
    pub footer_position: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LibraryStyle {
    pub font_family: String,
    pub font_size: f64,
    pub font_bold: bool,
    pub font_italic: bool,
    pub font_underline: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TimerLayout {
    pub x_percent: f64,
    pub y_percent: f64,
    pub clock_font_px: f64,
    pub name_font_px: f64,
    pub name_banner_height_px: f64,
    pub clock_color: String,
    pub name_color: String,
    pub name_banner_enabled: bool,
    pub name_banner_color: String,
    pub title_position: String,
    /// Behind the clock, and the name when it sits with the clock. None, or
    /// an empty string, for nothing: what the screens drew before it could be
    /// chosen.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub box_color: Option<String>,
}

/// A box on a screen, as percentages of it: where its centre is, and its
/// size. How a screen's layout in Looks places a layer.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LayerBox {
    pub x_percent: f64,
    pub y_percent: f64,
    pub width_percent: f64,
    pub height_percent: f64,
}

impl LayerBox {
    /// All of the screen: where every layer is unless a layout says otherwise.
    pub const FULL: Self = Self {
        x_percent: 50.0,
        y_percent: 50.0,
        width_percent: 100.0,
        height_percent: 100.0,
    };

    pub fn is_full(&self) -> bool {
        let near = |a: f64, b: f64| (a - b).abs() < 0.01;
        near(self.x_percent, 50.0)
            && near(self.y_percent, 50.0)
            && near(self.width_percent, 100.0)
            && near(self.height_percent, 100.0)
    }

    /// In pixels of a `width` by `height` screen, kept on it: left, top,
    /// width, height. `None` for a box with nothing left of it.
    pub fn rect(&self, width: u32, height: u32) -> Option<(f32, f32, f32, f32)> {
        let finite = |value: f64, fallback: f64| if value.is_finite() { value } else { fallback };
        let (w, h) = (f64::from(width), f64::from(height));
        let box_w = finite(self.width_percent, 100.0).clamp(0.0, 100.0) / 100.0 * w;
        let box_h = finite(self.height_percent, 100.0).clamp(0.0, 100.0) / 100.0 * h;
        let left = (finite(self.x_percent, 50.0) / 100.0 * w - box_w / 2.0).clamp(0.0, w);
        let top = (finite(self.y_percent, 50.0) / 100.0 * h - box_h / 2.0).clamp(0.0, h);
        let right = (left + box_w).min(w);
        let bottom = (top + box_h).min(h);
        let (box_w, box_h) = ((right - left).round(), (bottom - top).round());
        (box_w >= 1.0 && box_h >= 1.0).then_some((
            left.round() as f32,
            top.round() as f32,
            box_w as f32,
            box_h as f32,
        ))
    }
}

/// How one screen lays its layers out, where it is not as the slide was
/// made: from its column of the live look (`services/look_scene.rs`). Put on
/// the scene for each screen it is drawn for; the operator never sends it.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScreenLayout {
    /// Where the words go. `None`: where the slide puts them.
    pub words_box: Option<LayerBox>,
    /// A designed slide's words laid out afresh in their box, in its first
    /// text's font and colour, rather than the whole slide scaled into it.
    /// Scripture and plain words are always laid out in the box.
    pub words_text_only: bool,
    /// The words' size, as a share of what the slide asks for.
    pub words_scale: f64,
    /// Behind the words' box, a colour: what makes a lower third.
    pub words_backdrop: Option<String>,
    /// A presentation's slide, scaled evenly into this box. Its own, not the
    /// words': a lower third is for words, and a PDF's page has none.
    pub slide_box: LayerBox,
    pub media_box: LayerBox,
    /// The media fills its box, cropped, rather than fitting inside it.
    pub media_fill: bool,
    /// The props, as on the whole screen, scaled evenly into this box. The
    /// timer and the message banner are placed through their own fields
    /// instead (`timer_layout`, `message_overlay`), so they are drawn at the
    /// size they are shown rather than shrunk.
    pub props_box: LayerBox,
}

impl ScreenLayout {
    /// Everything where the slide and the operator put it.
    pub const NONE: Self = Self {
        words_box: None,
        words_text_only: false,
        words_scale: 1.0,
        words_backdrop: None,
        slide_box: LayerBox::FULL,
        media_box: LayerBox::FULL,
        media_fill: false,
        props_box: LayerBox::FULL,
    };

    /// The words' size multiplier, never nothing and never absurd.
    pub fn words_scale(&self) -> f32 {
        if self.words_scale.is_finite() {
            self.words_scale.clamp(0.25, 4.0) as f32
        } else {
            1.0
        }
    }
}

/// How whole-screen media meets a screen of another shape: inside it with
/// bars — the default, which keeps all of it in view — filling it and cropped
/// at the edges, or stretched to it. Chosen per media in the operator's media
/// settings, so a background loop can fill a screen while a phone's portrait
/// testimony stays whole. `mediaFit` on the wire.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum MediaFit {
    #[default]
    Fit,
    Fill,
    Stretch,
}

/// How the live timer looks once it has run out, `timerTimeUp` on the wire:
/// its words are then the operator's message (Settings, Timer), drawn in this
/// colour, and blinking if asked.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TimeUpStyle {
    pub color: String,
    #[serde(default)]
    pub blink: bool,
}

/// The banner message currently on screen. `MessageOverlay` in
/// `src/shared/types/index.ts:45-58`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MessageOverlay {
    pub id: String,
    pub text: String,
    pub position: String,
    pub theme_key: String,
    pub shown_at_ms: f64,
    pub dismiss_mode: String,
    pub animation: String,
    pub speed_seconds: f64,
    pub font_scale: f64,
}

/// One prop overlaid above the slide. `PropsOverlayItem` in
/// `src/shared/types/output-window.ts:93-117`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PropsOverlayItem {
    pub id: String,
    pub kind: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub media_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub image_url: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub media_url: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub youtube_url: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub ndi_source_name: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub capture_device_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub capture_device_label: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub shown_at_ms: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub text: Option<String>,
    pub position: String,
    pub opacity: f64,
    pub size_percent: f64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub color: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub font_size: Option<f64>,
}

/// The whole audience scene.
///
/// Every surface renders from this: the audience output, both stage displays,
/// the operator's preview, and — from Stage 6 — the NDI sender. Which parts
/// each one actually draws is the looks configuration's business, not this
/// struct's.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OutputScene {
    pub media_url: Option<String>,
    pub media_id: Option<String>,
    pub media_type: Option<MediaKind>,
    /// Whether the slide on screen shows. The operator sends it as the layer
    /// the slide is on says: the Slide layer for a presentation's, the Text
    /// layer for any other (`presentation_slide`). Everything that draws the
    /// slide asks this alone.
    pub show_text: bool,
    pub show_media: bool,
    pub hide_background: bool,
    pub text_position: Option<OutputTextPosition>,
    pub video_settings: VideoSettings,
    /// `mediaFilterCSS` on the wire. `rename_all = "camelCase"` would make it
    /// `mediaFilterCss`, which the output window does not read — the kind of
    /// mismatch that shows up as a background filter silently not applying.
    #[serde(rename = "mediaFilterCSS")]
    pub media_filter_css: String,
    /// How the media meets a screen of another shape (`MediaFit`).
    #[serde(default)]
    pub media_fit: MediaFit,
    pub is_video_playing: bool,
    pub video_current_time: f64,
    /// When the operator's video was at `video_current_time`, in milliseconds
    /// since the Unix epoch; `MediaPlayback::position_sampled_at_ms`.
    #[serde(default)]
    pub video_time_sampled_at_ms: Option<f64>,
    /// Whether the mirrors should seek to `video_current_time`.
    ///
    /// Deliberately excluded from change detection — see [`OutputScene::differs`].
    pub should_sync_time: bool,

    pub active_slide_id: Option<String>,
    pub slide_text: Option<String>,
    pub slide_footer: Option<String>,
    /// Carried verbatim. Stage 5 gives this a struct when the compositor has
    /// to draw it; until then Rust only ever asks whether it is empty.
    pub slide_elements: Option<serde_json::Value>,
    pub slide_canvas_size: Option<String>,
    pub slide_background_color: Option<String>,
    /// The slide is a presentation's — a PDF's page, a PowerPoint's slide —
    /// so it is on the Slide layer rather than the Text layer: a column shows
    /// it as its Slide switch says, in its slide box rather than its words'.
    #[serde(default)]
    pub presentation_slide: bool,

    pub scripture_style: Option<ScriptureStyle>,
    pub library_style: Option<LibraryStyle>,
    pub timer_layout: Option<TimerLayout>,

    /// How this slide should arrive: `services/compositor/transition`.
    ///
    /// On the scene rather than beside it because it belongs to the moment —
    /// the operator chose it for this slide, and the compositor is told the
    /// scene and nothing else.
    #[serde(default)]
    pub transition: Option<crate::services::compositor::transition::Transition>,

    pub screen_composer_enabled: bool,
    /// Carried verbatim, like `slide_elements`.
    pub screen_composer_layout: Option<serde_json::Value>,

    pub message_overlay: Option<MessageOverlay>,
    pub props_overlay: Vec<PropsOverlayItem>,

    pub timer_label: Option<String>,
    pub timer_text: Option<String>,
    pub timer_running: bool,
    pub timer_visible: bool,
    /// Set while the live timer has run out and nothing followed it.
    #[serde(default)]
    pub timer_time_up: Option<TimeUpStyle>,

    /// This screen's layout of the layers, from Looks; `None` for as made.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub screen_layout: Option<ScreenLayout>,
}

impl Default for OutputScene {
    fn default() -> Self {
        Self {
            media_url: None,
            media_id: None,
            media_type: None,
            show_text: false,
            show_media: false,
            hide_background: false,
            transition: None,
            text_position: None,
            video_settings: VideoSettings::DEFAULT,
            media_filter_css: "none".to_owned(),
            media_fit: MediaFit::Fit,
            is_video_playing: false,
            video_current_time: 0.0,
            video_time_sampled_at_ms: None,
            should_sync_time: false,
            active_slide_id: None,
            slide_text: None,
            slide_footer: None,
            slide_elements: None,
            slide_canvas_size: None,
            slide_background_color: None,
            presentation_slide: false,
            scripture_style: None,
            library_style: None,
            timer_layout: None,
            screen_composer_enabled: false,
            screen_composer_layout: None,
            message_overlay: None,
            props_overlay: Vec::new(),
            timer_label: None,
            timer_text: None,
            timer_running: false,
            timer_visible: false,
            timer_time_up: None,
            screen_layout: None,
        }
    }
}

impl OutputScene {
    /// The slide's elements, typed.
    ///
    /// The field itself stays a `serde_json::Value` on purpose, now that there
    /// is a struct it could have been. Two reasons, both about not breaking
    /// what already works:
    ///
    /// * **The scene is relayed to windows that still render it in React.**
    ///   After ADR-001's hybrid amendment that stays true even once the
    ///   compositor lands. Carrying the value verbatim is the only way to
    ///   guarantee the renderer gets back exactly what it sent.
    /// * **A typed field fails as a whole.** One element serde cannot read
    ///   would fail the entire scene, and a scene that fails to deserialise
    ///   mid-service is a black screen. `parse_elements` skips the unreadable
    ///   element and keeps the other eleven.
    ///
    /// So the typing happens here, at the boundary that needs it, rather than
    /// on the way past.
    pub fn slide_elements(&self) -> Option<Vec<crate::services::slide::SlideElement>> {
        crate::services::slide::parse_elements(self.slide_elements.as_ref())
    }

    /// Just the elements the Rust compositor draws.
    ///
    /// Hidden elements and the `web` ones are filtered out: the latter belong
    /// to the transparent webview layer above the composited surface, and
    /// drawing anything in their place would cover them.
    pub fn composited_elements(&self) -> Vec<crate::services::slide::SlideElement> {
        self.slide_elements()
            .unwrap_or_default()
            .into_iter()
            .filter(crate::services::slide::SlideElement::is_composited)
            .collect()
    }

    /// The screen composer's layout, typed.
    ///
    /// The field stays a `serde_json::Value` for the same two reasons
    /// `slide_elements` does: the scene is relayed to windows that still render
    /// it in React, and a typed field fails as a whole where one unreadable
    /// region should cost one region.
    pub fn screen_composer_layout(
        &self,
    ) -> Option<crate::services::compositor::composer::ComposerLayout> {
        crate::services::compositor::composer::parse_layout(self.screen_composer_layout.as_ref())
    }

    /// Does this scene differ from `other` in a way worth sending?
    ///
    /// `should_sync_time` is excluded, exactly as the Electron signature
    /// excludes it (`useOutputBroadcast.ts:270-273`). It is an instruction
    /// rather than a fact — "seek now" — and including it would make every
    /// 10 Hz position sample look like a change and re-send the whole scene.
    /// Whether the two would be *drawn* differently, given the same video
    /// frame.
    ///
    /// Where the video has got to is not a picture: the compositor draws the
    /// frame it is handed, and which frame that is, is already known. Counting
    /// the transport as a change made every position report — ten a second —
    /// redraw the slide and re-encode the picture for a screen that had not
    /// altered, which is most of a core spent to produce the frame that was
    /// already on it, and taken from the thread decoding the video.
    pub fn draws_differently(&self, other: &Self) -> bool {
        let mut probe = other.clone();
        probe.should_sync_time = self.should_sync_time;
        probe.video_current_time = self.video_current_time;
        probe.video_time_sampled_at_ms = self.video_time_sampled_at_ms;
        probe.is_video_playing = self.is_video_playing;
        *self != probe
    }

    pub fn differs(&self, other: &Self) -> bool {
        if self.should_sync_time == other.should_sync_time {
            return self != other;
        }
        let mut probe = other.clone();
        probe.should_sync_time = self.should_sync_time;
        *self != probe
    }

    #[cfg(test)]
    fn transport_test_scene() -> Self {
        Self {
            media_url: Some("local-media://media/loop.mp4".to_owned()),
            show_media: true,
            slide_text: Some("Amazing grace".to_owned()),
            video_current_time: 4.0,
            is_video_playing: true,
            ..Self::default()
        }
    }

    /// Whether the slide half of the scene has anything to show.
    ///
    /// `hasSlideContent` in `OutputWindow.tsx`, and the same test
    /// `useOutputBroadcast.ts:274-278` applies before deciding to keep the
    /// previous slide.
    pub fn has_slide_content(&self) -> bool {
        let has_text = self
            .slide_text
            .as_deref()
            .is_some_and(|text| !text.trim().is_empty());
        let has_elements = self
            .slide_elements
            .as_ref()
            .and_then(serde_json::Value::as_array)
            .is_some_and(|elements| !elements.is_empty());

        has_text || has_elements || self.slide_background_color.is_some()
    }
}

/// A partial update from the operator window.
///
/// The four shapes `useOutputBroadcast` already builds, tagged the way it
/// already tags them, so the sending side did not have to change while the
/// receiving side did.
#[derive(Debug, Clone, Deserialize)]
#[serde(tag = "type", rename_all = "kebab-case")]
pub enum OutputUpdate {
    /// Boxed because it is far larger than the other variants, and an enum is
    /// as big as its biggest member — every `OutputUpdate` on the stack would
    /// otherwise carry the media payload's footprint.
    MediaUpdate(Box<MediaUpdate>),
    #[serde(rename_all = "camelCase")]
    ActiveSlide {
        slide_id: Option<String>,
        #[serde(default)]
        transition: Option<crate::services::compositor::transition::Transition>,
        slide_text: Option<String>,
        slide_footer: Option<String>,
        #[serde(default)]
        slide_elements: Option<serde_json::Value>,
        #[serde(default)]
        slide_canvas_size: Option<String>,
        #[serde(default)]
        slide_background_color: Option<String>,
        /// A presentation's slide, on the Slide layer.
        #[serde(default)]
        presentation_slide: bool,
        /// Whether it shows, as its layer says. Sent with the slide so a deck
        /// on a layer that is off is never on screen for the moment between
        /// the slide arriving and the switch that hides it.
        #[serde(default)]
        show_text: Option<bool>,
    },
    #[serde(rename_all = "camelCase")]
    MessageOverlay { overlay: Option<MessageOverlay> },
    #[serde(rename_all = "camelCase")]
    PropsOverlay {
        #[serde(default)]
        props: Vec<PropsOverlayItem>,
    },
    #[serde(rename_all = "camelCase")]
    TimerUpdate {
        #[serde(default)]
        timer_label: Option<String>,
        #[serde(default)]
        timer_text: Option<String>,
        #[serde(default)]
        timer_running: bool,
        #[serde(default)]
        timer_visible: Option<bool>,
        #[serde(default)]
        timer_time_up: Option<TimeUpStyle>,
    },
    /// Blank the slide and the media, leaving everything else alone.
    Clear,
}

/// The media half of the scene, as the operator window sends it.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MediaUpdate {
    pub media_url: Option<String>,
    pub media_id: Option<String>,
    pub media_type: Option<MediaKind>,
    pub show_text: bool,
    pub show_media: bool,
    #[serde(default)]
    pub hide_background: Option<bool>,
    #[serde(default)]
    pub text_position: Option<OutputTextPosition>,
    pub video_settings: VideoSettings,
    #[serde(rename = "mediaFilterCSS")]
    pub media_filter_css: String,
    #[serde(default)]
    pub media_fit: MediaFit,
    pub is_video_playing: bool,
    pub video_current_time: f64,
    #[serde(default)]
    pub video_time_sampled_at_ms: Option<f64>,
    pub should_sync_time: bool,
    #[serde(default)]
    pub scripture_style: Option<ScriptureStyle>,
    #[serde(default)]
    pub library_style: Option<LibraryStyle>,
    #[serde(default)]
    pub timer_layout: Option<TimerLayout>,
    #[serde(default)]
    pub screen_composer_enabled: Option<bool>,
    #[serde(default)]
    pub screen_composer_layout: Option<serde_json::Value>,
}

/// Merge an update into the scene.
///
/// Absent optional fields keep their current value, which is what the receiving
/// window does today when a payload omits one (`OutputWindow.tsx:267-311`).
pub fn apply(scene: &mut OutputScene, update: OutputUpdate) {
    match update {
        OutputUpdate::MediaUpdate(media) => {
            let MediaUpdate {
                media_url,
                media_id,
                media_type,
                show_text,
                show_media,
                hide_background,
                text_position,
                video_settings,
                media_filter_css,
                media_fit,
                is_video_playing,
                video_current_time,
                video_time_sampled_at_ms,
                should_sync_time,
                scripture_style,
                library_style,
                timer_layout,
                screen_composer_enabled,
                screen_composer_layout,
            } = *media;
            scene.media_url = media_url;
            scene.media_id = media_id;
            scene.media_type = media_type;
            scene.show_text = show_text;
            scene.show_media = show_media;
            if let Some(value) = hide_background {
                scene.hide_background = value;
            }
            if text_position.is_some() {
                scene.text_position = text_position;
            }
            scene.video_settings = video_settings;
            scene.media_filter_css = media_filter_css;
            scene.media_fit = media_fit;
            scene.is_video_playing = is_video_playing;
            scene.video_current_time = video_current_time;
            scene.video_time_sampled_at_ms = video_time_sampled_at_ms;
            scene.should_sync_time = should_sync_time;
            if scripture_style.is_some() {
                scene.scripture_style = scripture_style;
            }
            if library_style.is_some() {
                scene.library_style = library_style;
            }
            if timer_layout.is_some() {
                scene.timer_layout = timer_layout;
            }
            if let Some(value) = screen_composer_enabled {
                scene.screen_composer_enabled = value;
            }
            if screen_composer_layout.is_some() {
                scene.screen_composer_layout = screen_composer_layout;
            }
        }
        OutputUpdate::ActiveSlide {
            slide_id,
            transition,
            slide_text,
            slide_footer,
            slide_elements,
            slide_canvas_size,
            slide_background_color,
            presentation_slide,
            show_text,
        } => {
            let incoming = OutputScene {
                slide_text: slide_text.clone(),
                slide_elements: slide_elements.clone(),
                slide_background_color: slide_background_color.clone(),
                ..OutputScene::default()
            };

            // An empty slide arriving while text is showing and a slide is
            // already up is a transient, not an instruction to go blank — it
            // happens as the operator moves between items. Blanking on it
            // shows the congregation an empty screen for a frame.
            // `OutputWindow.tsx:334-341`.
            if scene.show_text && !incoming.has_slide_content() && scene.has_slide_content() {
                return;
            }

            // How it should arrive. Cleared when the slide does not ask for
            // one, so last slide's transition is not used for this one.
            scene.transition = transition;
            scene.active_slide_id = slide_id;
            scene.slide_text = slide_text;
            scene.slide_footer = slide_footer;
            scene.slide_elements = slide_elements;
            scene.slide_canvas_size = slide_canvas_size;
            scene.slide_background_color = slide_background_color;
            scene.presentation_slide = presentation_slide;
            if let Some(show) = show_text {
                scene.show_text = show;
            }
        }
        OutputUpdate::MessageOverlay { overlay } => {
            scene.message_overlay = overlay;
        }
        OutputUpdate::PropsOverlay { props } => {
            scene.props_overlay = props;
        }
        OutputUpdate::TimerUpdate {
            timer_label,
            timer_text,
            timer_running,
            timer_visible,
            timer_time_up,
        } => {
            scene.timer_label = timer_label.filter(|value| !value.is_empty());
            scene.timer_text = timer_text.filter(|value| !value.is_empty());
            scene.timer_running = timer_running;
            scene.timer_time_up = timer_time_up;
            if let Some(value) = timer_visible {
                scene.timer_visible = value;
            }
        }
        OutputUpdate::Clear => {
            scene.active_slide_id = None;
            scene.slide_text = None;
            scene.slide_footer = None;
            scene.slide_elements = None;
            scene.slide_canvas_size = None;
            scene.presentation_slide = false;
            scene.media_url = None;
            scene.media_type = None;
            scene.media_id = None;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn where_a_video_has_got_to_is_not_a_reason_to_redraw() {
        let before = OutputScene::transport_test_scene();

        // Ten times a second, this is all that arrives.
        let mut later = before.clone();
        later.video_current_time = 4.1;
        later.video_time_sampled_at_ms = Some(1_700_000_000_000.0);
        assert!(
            !before.draws_differently(&later),
            "the picture is whatever frame the decoder hands over"
        );
        assert!(before.differs(&later), "the scene itself did change");

        let mut paused = before.clone();
        paused.is_video_playing = false;
        assert!(
            !before.draws_differently(&paused),
            "a paused video still draws the frame it is on"
        );
    }

    #[test]
    fn anything_that_is_a_picture_is_a_reason_to_redraw() {
        let before = OutputScene::transport_test_scene();
        for (name, changed) in [
            ("new words", {
                let mut next = before.clone();
                next.slide_text = Some("How sweet the sound".to_owned());
                next
            }),
            ("another video", {
                let mut next = before.clone();
                next.media_url = Some("local-media://media/other.mp4".to_owned());
                next
            }),
            ("the media switched off", {
                let mut next = before.clone();
                next.show_media = false;
                next
            }),
            ("the background masked", {
                let mut next = before.clone();
                next.hide_background = true;
                next
            }),
            ("a filter", {
                let mut next = before.clone();
                next.media_filter_css = "brightness(0.5)".to_owned();
                next
            }),
        ] {
            assert!(before.draws_differently(&changed), "{name}");
        }
    }

    fn slide(
        id: Option<&str>,
        text: Option<&str>,
        elements: Option<serde_json::Value>,
        background: Option<&str>,
    ) -> OutputUpdate {
        OutputUpdate::ActiveSlide {
            transition: None,
            slide_id: id.map(str::to_owned),
            slide_text: text.map(str::to_owned),
            slide_footer: None,
            slide_elements: elements,
            slide_canvas_size: None,
            slide_background_color: background.map(str::to_owned),
            presentation_slide: false,
            show_text: None,
        }
    }

    #[test]
    fn a_slide_with_text_replaces_the_one_before_it() {
        let mut scene = OutputScene {
            show_text: true,
            ..OutputScene::default()
        };
        apply(
            &mut scene,
            slide(Some("a"), Some("Amazing grace"), None, None),
        );
        apply(
            &mut scene,
            slide(Some("b"), Some("How sweet the sound"), None, None),
        );

        assert_eq!(scene.active_slide_id.as_deref(), Some("b"));
        assert_eq!(scene.slide_text.as_deref(), Some("How sweet the sound"));
    }

    /// `update`, a presentation's slide or not, showing or not.
    fn on_layer(mut update: OutputUpdate, presentation: bool, show: bool) -> OutputUpdate {
        if let OutputUpdate::ActiveSlide {
            presentation_slide,
            show_text,
            ..
        } = &mut update
        {
            *presentation_slide = presentation;
            *show_text = Some(show);
        }
        update
    }

    #[test]
    fn a_presentation_slide_arrives_showing_as_its_own_layer_says() {
        // The words are up and the Slide layer is off: a PDF's page clicked
        // now must not be on screen for the moment before the switch that
        // hides it arrives. It comes with whether it shows.
        let mut scene = OutputScene {
            show_text: true,
            ..OutputScene::default()
        };
        apply(
            &mut scene,
            slide(Some("a"), Some("Amazing grace"), None, None),
        );
        apply(
            &mut scene,
            on_layer(
                slide(
                    Some("presentation_deck:0"),
                    Some("Page 1"),
                    Some(serde_json::json!([{ "id": "page", "type": "image" }])),
                    None,
                ),
                true,
                false,
            ),
        );
        assert!(scene.presentation_slide);
        assert!(!scene.show_text, "the Slide layer is off");

        // And the words after it, on the Text layer again.
        apply(
            &mut scene,
            on_layer(
                slide(Some("b"), Some("How sweet the sound"), None, None),
                false,
                true,
            ),
        );
        assert!(!scene.presentation_slide);
        assert!(scene.show_text);

        // Clearing leaves no presentation on screen.
        scene.presentation_slide = true;
        apply(&mut scene, OutputUpdate::Clear);
        assert!(!scene.presentation_slide);
    }

    /// The rule that stops the audience screen flickering blank between items.
    #[test]
    fn an_empty_slide_does_not_blank_a_showing_one() {
        let mut scene = OutputScene {
            show_text: true,
            ..OutputScene::default()
        };
        apply(
            &mut scene,
            slide(Some("a"), Some("Amazing grace"), None, None),
        );

        apply(&mut scene, slide(None, None, None, None));

        assert_eq!(
            scene.slide_text.as_deref(),
            Some("Amazing grace"),
            "the congregation must not see a blank frame between items"
        );
    }

    #[test]
    fn an_empty_slide_does_blank_when_text_is_already_hidden() {
        // Nothing is showing, so there is no flicker to avoid and the operator
        // gets the clean state they asked for.
        let mut scene = OutputScene {
            show_text: false,
            ..OutputScene::default()
        };
        apply(
            &mut scene,
            slide(Some("a"), Some("Amazing grace"), None, None),
        );

        apply(&mut scene, slide(None, None, None, None));

        assert_eq!(scene.slide_text, None);
    }

    #[test]
    fn an_empty_slide_applies_when_nothing_was_showing_anyway() {
        let mut scene = OutputScene {
            show_text: true,
            ..OutputScene::default()
        };

        apply(&mut scene, slide(Some("a"), None, None, None));

        assert_eq!(scene.active_slide_id.as_deref(), Some("a"));
    }

    #[test]
    fn whitespace_is_not_slide_content() {
        let mut scene = OutputScene {
            show_text: true,
            ..OutputScene::default()
        };
        apply(
            &mut scene,
            slide(Some("a"), Some("Amazing grace"), None, None),
        );

        apply(&mut scene, slide(Some("b"), Some("   \n  "), None, None));

        assert_eq!(scene.slide_text.as_deref(), Some("Amazing grace"));
    }

    #[test]
    fn elements_alone_count_as_slide_content() {
        let mut scene = OutputScene {
            show_text: true,
            ..OutputScene::default()
        };
        apply(
            &mut scene,
            slide(Some("a"), Some("Amazing grace"), None, None),
        );

        apply(
            &mut scene,
            slide(
                Some("b"),
                None,
                Some(serde_json::json!([{ "id": "e1" }])),
                None,
            ),
        );

        assert_eq!(scene.active_slide_id.as_deref(), Some("b"));
        assert_eq!(scene.slide_text, None);
    }

    #[test]
    fn an_empty_element_array_is_not_slide_content() {
        let mut scene = OutputScene {
            show_text: true,
            ..OutputScene::default()
        };
        apply(
            &mut scene,
            slide(Some("a"), Some("Amazing grace"), None, None),
        );

        apply(
            &mut scene,
            slide(Some("b"), None, Some(serde_json::json!([])), None),
        );

        assert_eq!(scene.slide_text.as_deref(), Some("Amazing grace"));
    }

    #[test]
    fn a_background_colour_alone_counts_as_slide_content() {
        let mut scene = OutputScene {
            show_text: true,
            ..OutputScene::default()
        };
        apply(
            &mut scene,
            slide(Some("a"), Some("Amazing grace"), None, None),
        );

        apply(&mut scene, slide(Some("b"), None, None, Some("#000000")));

        assert_eq!(scene.active_slide_id.as_deref(), Some("b"));
    }

    #[test]
    fn clear_blanks_the_slide_and_the_media_and_nothing_else() {
        let mut scene = OutputScene {
            show_text: true,
            media_url: Some("local-media://media/clip.mp4".to_owned()),
            media_id: Some("clip".to_owned()),
            media_type: Some(MediaKind::Video),
            slide_text: Some("Amazing grace".to_owned()),
            active_slide_id: Some("a".to_owned()),
            message_overlay: Some(MessageOverlay {
                id: "m1".to_owned(),
                text: "Welcome".to_owned(),
                position: "bottom".to_owned(),
                theme_key: "default".to_owned(),
                shown_at_ms: 1.0,
                dismiss_mode: "manual".to_owned(),
                animation: "static".to_owned(),
                speed_seconds: 10.0,
                font_scale: 1.0,
            }),
            ..OutputScene::default()
        };

        apply(&mut scene, OutputUpdate::Clear);

        assert_eq!(scene.slide_text, None);
        assert_eq!(scene.media_url, None);
        assert!(
            scene.message_overlay.is_some(),
            "a message banner survives a clear"
        );
        assert!(scene.show_text, "the layer flag is not a clear's business");
    }

    #[test]
    fn a_message_overlay_can_be_set_and_cleared() {
        let mut scene = OutputScene::default();
        let overlay = MessageOverlay {
            id: "m1".to_owned(),
            text: "Welcome".to_owned(),
            position: "bottom".to_owned(),
            theme_key: "default".to_owned(),
            shown_at_ms: 1.0,
            dismiss_mode: "manual".to_owned(),
            animation: "static".to_owned(),
            speed_seconds: 10.0,
            font_scale: 1.0,
        };

        apply(
            &mut scene,
            OutputUpdate::MessageOverlay {
                overlay: Some(overlay),
            },
        );
        assert!(scene.message_overlay.is_some());

        apply(&mut scene, OutputUpdate::MessageOverlay { overlay: None });
        assert!(scene.message_overlay.is_none());
    }

    #[test]
    fn props_replace_rather_than_accumulate() {
        let mut scene = OutputScene::default();
        let prop = |id: &str| PropsOverlayItem {
            id: id.to_owned(),
            kind: "text".to_owned(),
            media_id: None,
            image_url: None,
            media_url: None,
            youtube_url: None,
            ndi_source_name: None,
            capture_device_id: None,
            capture_device_label: None,
            shown_at_ms: None,
            text: Some("Hello".to_owned()),
            position: "center".to_owned(),
            opacity: 1.0,
            size_percent: 50.0,
            color: None,
            font_size: None,
        };

        apply(
            &mut scene,
            OutputUpdate::PropsOverlay {
                props: vec![prop("p1"), prop("p2")],
            },
        );
        assert_eq!(scene.props_overlay.len(), 2);

        apply(
            &mut scene,
            OutputUpdate::PropsOverlay {
                props: vec![prop("p3")],
            },
        );
        assert_eq!(scene.props_overlay.len(), 1);
        assert_eq!(scene.props_overlay[0].id, "p3");
    }

    #[test]
    fn a_timer_update_treats_empty_strings_as_absent() {
        let mut scene = OutputScene::default();
        apply(
            &mut scene,
            OutputUpdate::TimerUpdate {
                timer_label: Some(String::new()),
                timer_text: Some("00:00".to_owned()),
                timer_running: true,
                timer_visible: Some(true),
                timer_time_up: None,
            },
        );

        assert_eq!(scene.timer_label, None);
        assert_eq!(scene.timer_text.as_deref(), Some("00:00"));
        assert!(scene.timer_running);
        assert!(scene.timer_visible);
    }

    #[test]
    fn time_up_arrives_with_the_timer_and_leaves_with_the_next_update() {
        let update: OutputUpdate = serde_json::from_value(serde_json::json!({
            "type": "timer-update",
            "timerText": "TIME UP",
            "timerRunning": false,
            "timerVisible": true,
            "timerTimeUp": { "color": "#ef4444", "blink": true },
        }))
        .expect("the operator window's payload");
        let mut scene = OutputScene::default();
        apply(&mut scene, update);
        assert_eq!(
            scene.timer_time_up,
            Some(TimeUpStyle {
                color: "#ef4444".to_owned(),
                blink: true
            })
        );

        // Played again or reset: the next update says nothing of it.
        let running: OutputUpdate = serde_json::from_value(serde_json::json!({
            "type": "timer-update",
            "timerText": "00:05:00",
            "timerRunning": true,
        }))
        .expect("an update from before time up existed");
        apply(&mut scene, running);
        assert_eq!(scene.timer_time_up, None);
    }

    #[test]
    fn an_absent_optional_field_keeps_what_the_scene_had() {
        // The receiving window does this today when a payload omits a field.
        let mut scene = OutputScene {
            hide_background: true,
            screen_composer_enabled: true,
            ..OutputScene::default()
        };

        apply(
            &mut scene,
            OutputUpdate::MediaUpdate(Box::new(MediaUpdate {
                media_url: None,
                media_id: None,
                media_type: None,
                show_text: false,
                show_media: false,
                hide_background: None,
                text_position: None,
                video_settings: VideoSettings::DEFAULT,
                media_filter_css: "none".to_owned(),
                media_fit: crate::services::output::MediaFit::Fit,
                is_video_playing: false,
                video_current_time: 0.0,
                video_time_sampled_at_ms: None,
                should_sync_time: false,
                scripture_style: None,
                library_style: None,
                timer_layout: None,
                screen_composer_enabled: None,
                screen_composer_layout: None,
            })),
        );

        assert!(scene.hide_background, "an omitted flag is not a false");
        assert!(scene.screen_composer_enabled);
    }

    #[test]
    fn the_update_shapes_deserialise_from_what_the_react_side_sends() {
        // The exact payloads `useOutputBroadcast` builds.
        let media: OutputUpdate = serde_json::from_value(serde_json::json!({
            "type": "media-update",
            "mediaUrl": "local-media://media/clip.mp4",
            "mediaId": "clip",
            "mediaType": "video",
            "showText": true,
            "showMedia": true,
            "hideBackground": false,
            "textPosition": {
                "xPercent": 50, "yPercent": 50, "widthPercent": 92, "heightPercent": 84,
                "textAlign": "center", "verticalAlign": "middle",
            },
            "videoSettings": { "loop": true, "muted": false },
            "mediaFilterCSS": "none",
            "isVideoPlaying": true,
            "videoCurrentTime": 12.5,
            "shouldSyncTime": true,
        }))
        .expect("media-update");
        assert!(matches!(media, OutputUpdate::MediaUpdate(_)));

        let slide: OutputUpdate = serde_json::from_value(serde_json::json!({
            "type": "active-slide",
            "slideId": "a",
            "slideText": "Amazing grace",
            "slideFooter": null,
            "slideElements": [],
        }))
        .expect("active-slide");
        assert!(matches!(slide, OutputUpdate::ActiveSlide { .. }));

        let message: OutputUpdate = serde_json::from_value(serde_json::json!({
            "type": "message-overlay",
            "overlay": null,
        }))
        .expect("message-overlay");
        assert!(matches!(message, OutputUpdate::MessageOverlay { .. }));

        let props: OutputUpdate = serde_json::from_value(serde_json::json!({
            "type": "props-overlay",
            "props": [],
        }))
        .expect("props-overlay");
        assert!(matches!(props, OutputUpdate::PropsOverlay { .. }));
    }

    #[test]
    fn the_scene_serialises_with_the_names_the_output_window_reads() {
        let json = serde_json::to_value(OutputScene::default()).expect("serialisable");

        assert_eq!(json["showText"], false);
        assert_eq!(json["mediaFilterCSS"], "none");
        assert_eq!(json["videoSettings"]["loop"], true);
        assert_eq!(json["propsOverlay"], serde_json::json!([]));
        assert_eq!(json["activeSlideId"], serde_json::Value::Null);
    }
}

#[cfg(test)]
mod slide_element_tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn the_scene_types_its_elements_without_retyping_the_field() {
        let scene = OutputScene {
            slide_elements: Some(json!([
                { "id": "a", "type": "text", "content": "Amazing grace" },
                { "id": "b", "type": "web", "content": "https://youtu.be/x" },
                { "id": "c", "type": "shape", "isVisible": false },
                { "id": "d", "type": "hologram" },
            ])),
            ..OutputScene::default()
        };

        let all = scene.slide_elements().expect("elements");
        assert_eq!(all.len(), 4, "every element is carried");

        // Only the two the Rust surface owns: the hidden shape, the web prop
        // and the unknown type are all left alone.
        let drawn = scene.composited_elements();
        assert_eq!(
            drawn.iter().map(|e| e.id.as_str()).collect::<Vec<_>>(),
            vec!["a"]
        );
    }

    #[test]
    fn a_scene_with_one_unreadable_element_still_draws_the_rest() {
        // The blank-screen case. A typed field would have failed the whole
        // scene here.
        let scene = OutputScene {
            slide_elements: Some(json!([{ "id": "a", "type": "text" }, 42])),
            ..OutputScene::default()
        };

        assert_eq!(scene.composited_elements().len(), 1);
    }

    #[test]
    fn a_scene_with_no_slide_has_no_elements() {
        let scene = OutputScene::default();
        assert!(scene.slide_elements().is_none());
        assert!(scene.composited_elements().is_empty());
    }
}
