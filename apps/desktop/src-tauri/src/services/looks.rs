//! Output layer flags and text placement — the "looks" configuration.
//!
//! Ported from `src/shared/lib/looks-config.mjs`, which was extracted from
//! `useLooksConfig.ts` and pinned by `tests/looks-config.test.mjs`. Every case
//! in that suite has a twin below, so the two implementations can be compared
//! rather than trusted.
//!
//! This is the first slice of the presentation core to become Rust-owned, and
//! it was chosen first for a reason. These flags decide what the congregation
//! sees, and today two windows agree on them through `localStorage` — which
//! fires no event in the window that wrote it, so the operator window **polls
//! every 400 ms** (`useLooksConfig.ts:87`). A layer the operator toggles can
//! take that long to reach the audience screen, and two windows writing in the
//! same tick lose one of the writes with no sign that anything happened.
//!
//! No Tauri types here: the rules are testable on their own.

use serde::{Deserialize, Serialize};

const CURRENT_VERSION: u32 = 2;

/// Which surface a look is describing.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum LookTarget {
    /// The audience output.
    Program,
    /// Both stage displays.
    Stage,
    /// The NDI sender.
    Ndi,
}

impl LookTarget {
    pub const ALL: [Self; 3] = [Self::Program, Self::Stage, Self::Ndi];
}

/// One toggleable layer on a surface.
///
/// An enum rather than a string so a command cannot name a layer that does not
/// exist, and a struct rather than a map below so a layer cannot go missing.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum LookLayer {
    Mask,
    Messages,
    Props,
    Announcements,
    Presentation,
    Slide,
    Media,
    VideoInput,
}

impl LookLayer {
    /// The order the Looks window lists them in (`LOOK_LAYER_ORDER`).
    pub const ALL: [Self; 8] = [
        Self::Mask,
        Self::Messages,
        Self::Props,
        Self::Announcements,
        Self::Presentation,
        Self::Slide,
        Self::Media,
        Self::VideoInput,
    ];

    /// The key this layer has in the JSON the React side reads and writes.
    pub fn key(self) -> &'static str {
        match self {
            Self::Mask => "mask",
            Self::Messages => "messages",
            Self::Props => "props",
            Self::Announcements => "announcements",
            Self::Presentation => "presentation",
            Self::Slide => "slide",
            Self::Media => "media",
            Self::VideoInput => "videoInput",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LookLayers {
    pub mask: bool,
    pub messages: bool,
    pub props: bool,
    pub announcements: bool,
    pub presentation: bool,
    pub slide: bool,
    pub media: bool,
    pub video_input: bool,
}

impl LookLayers {
    pub fn get(&self, layer: LookLayer) -> bool {
        match layer {
            LookLayer::Mask => self.mask,
            LookLayer::Messages => self.messages,
            LookLayer::Props => self.props,
            LookLayer::Announcements => self.announcements,
            LookLayer::Presentation => self.presentation,
            LookLayer::Slide => self.slide,
            LookLayer::Media => self.media,
            LookLayer::VideoInput => self.video_input,
        }
    }

    pub fn set(&mut self, layer: LookLayer, enabled: bool) {
        match layer {
            LookLayer::Mask => self.mask = enabled,
            LookLayer::Messages => self.messages = enabled,
            LookLayer::Props => self.props = enabled,
            LookLayer::Announcements => self.announcements = enabled,
            LookLayer::Presentation => self.presentation = enabled,
            LookLayer::Slide => self.slide = enabled,
            LookLayer::Media => self.media = enabled,
            LookLayer::VideoInput => self.video_input = enabled,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum TextAlign {
    Left,
    Center,
    Right,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum VerticalAlign {
    Top,
    Middle,
    Bottom,
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LookTextPosition {
    pub x_percent: f64,
    pub y_percent: f64,
    pub width_percent: f64,
    pub height_percent: f64,
    pub text_align: TextAlign,
    pub vertical_align: VerticalAlign,
}

/// A patch from the frontend. Every field optional, matching the JS
/// `Partial<LookTextPosition>`.
#[derive(Debug, Clone, Copy, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LookTextPositionPatch {
    pub x_percent: Option<f64>,
    pub y_percent: Option<f64>,
    pub width_percent: Option<f64>,
    pub height_percent: Option<f64>,
    pub text_align: Option<TextAlign>,
    pub vertical_align: Option<VerticalAlign>,
}

impl LookTextPosition {
    const DEFAULT: Self = Self {
        x_percent: 50.0,
        y_percent: 50.0,
        width_percent: 92.0,
        height_percent: 84.0,
        text_align: TextAlign::Center,
        vertical_align: VerticalAlign::Middle,
    };

    /// Percentages outside 0-100 would place text off the audience screen.
    fn clamped(mut self) -> Self {
        self.x_percent = clamp_percent(self.x_percent);
        self.y_percent = clamp_percent(self.y_percent);
        self.width_percent = clamp_percent(self.width_percent);
        self.height_percent = clamp_percent(self.height_percent);
        self
    }

    fn patched(mut self, patch: LookTextPositionPatch) -> Self {
        if let Some(value) = patch.x_percent {
            self.x_percent = value;
        }
        if let Some(value) = patch.y_percent {
            self.y_percent = value;
        }
        if let Some(value) = patch.width_percent {
            self.width_percent = value;
        }
        if let Some(value) = patch.height_percent {
            self.height_percent = value;
        }
        if let Some(value) = patch.text_align {
            self.text_align = value;
        }
        if let Some(value) = patch.vertical_align {
            self.vertical_align = value;
        }
        self.clamped()
    }
}

fn clamp_percent(value: f64) -> f64 {
    // NaN would survive `min`/`max` and reach the layout as a garbage
    // percentage; the JS `Math.min(Math.max(v, 0), 100)` produces NaN there
    // too, which is a latent bug worth not carrying over.
    if value.is_nan() {
        return 0.0;
    }
    value.clamp(0.0, 100.0)
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LookTargetState {
    pub layers: LookLayers,
    pub text_position: LookTextPosition,
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LookTargets {
    pub program: LookTargetState,
    pub stage: LookTargetState,
    pub ndi: LookTargetState,
}

impl LookTargets {
    pub fn get(&self, target: LookTarget) -> &LookTargetState {
        match target {
            LookTarget::Program => &self.program,
            LookTarget::Stage => &self.stage,
            LookTarget::Ndi => &self.ndi,
        }
    }

    fn get_mut(&mut self, target: LookTarget) -> &mut LookTargetState {
        match target {
            LookTarget::Program => &mut self.program,
            LookTarget::Stage => &mut self.stage,
            LookTarget::Ndi => &mut self.ndi,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LookPreset {
    pub id: String,
    pub name: String,
    pub targets: LookTargets,
}

impl LookPreset {
    /// The shipped default. Matches `createDefaultLookPreset`.
    ///
    /// Note what the stage target does *not* show: media and video input. The
    /// stage display is what the worship team reads from, and a background
    /// video behind the words makes them harder to read, not easier.
    pub fn default_preset() -> Self {
        Self {
            id: "default".to_owned(),
            name: "Default".to_owned(),
            targets: LookTargets {
                program: LookTargetState {
                    layers: LookLayers {
                        mask: false,
                        messages: false,
                        props: true,
                        announcements: false,
                        presentation: true,
                        slide: true,
                        media: true,
                        video_input: true,
                    },
                    text_position: LookTextPosition::DEFAULT,
                },
                stage: LookTargetState {
                    layers: LookLayers {
                        mask: false,
                        messages: true,
                        props: true,
                        announcements: false,
                        presentation: true,
                        slide: true,
                        media: false,
                        video_input: false,
                    },
                    text_position: LookTextPosition {
                        y_percent: 44.0,
                        height_percent: 70.0,
                        ..LookTextPosition::DEFAULT
                    },
                },
                ndi: LookTargetState {
                    layers: LookLayers {
                        mask: false,
                        messages: true,
                        props: false,
                        announcements: false,
                        presentation: true,
                        slide: true,
                        media: true,
                        video_input: true,
                    },
                    text_position: LookTextPosition::DEFAULT,
                },
            },
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LooksConfig {
    pub version: u32,
    pub selected_target: LookTarget,
    pub selected_look_id: String,
    pub live_look_id: String,
    pub looks: Vec<LookPreset>,
    pub updated_at: i64,
}

impl LooksConfig {
    pub fn default_config(now: i64) -> Self {
        Self {
            version: CURRENT_VERSION,
            selected_target: LookTarget::Program,
            selected_look_id: "default".to_owned(),
            live_look_id: "default".to_owned(),
            looks: vec![LookPreset::default_preset()],
            updated_at: now,
        }
    }

    /// The look currently on the audience screen.
    ///
    /// Falls back to the first rather than returning nothing: there is always
    /// something on screen, and a `None` here would mean a black output.
    pub fn live_look(&self) -> &LookPreset {
        self.looks
            .iter()
            .find(|look| look.id == self.live_look_id)
            .or_else(|| self.looks.first())
            .expect("a config always holds at least one look")
    }

    pub fn selected_look(&self) -> &LookPreset {
        self.looks
            .iter()
            .find(|look| look.id == self.selected_look_id)
            .or_else(|| self.looks.first())
            .expect("a config always holds at least one look")
    }

    fn look_mut(&mut self, look_id: &str) -> Option<&mut LookPreset> {
        self.looks.iter_mut().find(|look| look.id == look_id)
    }
}

// --- normalisation -------------------------------------------------------

/// Turn whatever was stored into a usable config.
///
/// Deliberately forgiving, and deliberately biased. This reads data that
/// survives app versions and hand-editing, so it must never fail — but a value
/// it cannot understand falls back to the *default*, never to "on". A layer
/// that turns itself on puts something on the audience screen that the operator
/// did not ask for.
///
/// Ports `normalizeLooksConfig`. `now` and `new_id` are passed in for the same
/// reason they are in the JS: so the result is a function of its inputs.
pub fn normalize(
    candidate: Option<&serde_json::Value>,
    now: i64,
    new_id: &mut dyn FnMut() -> String,
) -> LooksConfig {
    let fallback = LooksConfig::default_config(now);
    let Some(candidate) = candidate.filter(|value| !value.is_null()) else {
        return fallback;
    };

    let selected_target = match candidate.get("selectedTarget").and_then(|v| v.as_str()) {
        Some("program") => LookTarget::Program,
        Some("stage") => LookTarget::Stage,
        Some("ndi") => LookTarget::Ndi,
        _ => fallback.selected_target,
    };

    let updated_at = candidate
        .get("updatedAt")
        .and_then(serde_json::Value::as_f64)
        .filter(|value| value.is_finite())
        .map(|value| value as i64)
        .unwrap_or(now);

    let version = candidate.get("version").and_then(serde_json::Value::as_u64);
    let looks_array = candidate
        .get("looks")
        .and_then(serde_json::Value::as_array)
        .filter(|looks| !looks.is_empty());

    if version == Some(2) {
        if let Some(raw_looks) = looks_array {
            let looks: Vec<LookPreset> = raw_looks
                .iter()
                .enumerate()
                .map(|(index, look)| normalize_preset(Some(look), index, new_id))
                .collect();

            let first_id = looks[0].id.clone();
            let resolve = |key: &str| -> String {
                candidate
                    .get(key)
                    .and_then(serde_json::Value::as_str)
                    .filter(|id| looks.iter().any(|look| look.id == *id))
                    .map(str::to_owned)
                    .unwrap_or_else(|| first_id.clone())
            };

            return LooksConfig {
                version: CURRENT_VERSION,
                selected_target,
                selected_look_id: resolve("selectedLookId"),
                live_look_id: resolve("liveLookId"),
                looks,
                updated_at,
            };
        }
    }

    // Version 1 held a single unnamed preset. It is the operator's own layer
    // setup; migrating it beats making them rebuild it before a service.
    if version == Some(1) {
        if let Some(targets) = candidate.get("targets").filter(|value| !value.is_null()) {
            let name = candidate
                .get("presetName")
                .and_then(serde_json::Value::as_str)
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .unwrap_or("Default");

            let migrated = normalize_preset(
                Some(&serde_json::json!({
                    "id": "default",
                    "name": name,
                    "targets": targets,
                })),
                0,
                new_id,
            );

            return LooksConfig {
                version: CURRENT_VERSION,
                selected_target,
                selected_look_id: migrated.id.clone(),
                live_look_id: migrated.id.clone(),
                looks: vec![migrated],
                updated_at,
            };
        }
    }

    LooksConfig {
        version: CURRENT_VERSION,
        selected_target,
        selected_look_id: fallback.selected_look_id,
        live_look_id: fallback.live_look_id,
        looks: fallback.looks,
        updated_at,
    }
}

fn normalize_preset(
    candidate: Option<&serde_json::Value>,
    index: usize,
    new_id: &mut dyn FnMut() -> String,
) -> LookPreset {
    let default_preset = LookPreset::default_preset();

    let id = candidate
        .and_then(|value| value.get("id"))
        .and_then(serde_json::Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_owned)
        .unwrap_or_else(|| {
            if index == 0 {
                "default".to_owned()
            } else {
                new_id()
            }
        });

    let name = candidate
        .and_then(|value| value.get("name"))
        .and_then(serde_json::Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_owned)
        .unwrap_or_else(|| {
            if index == 0 {
                "Default".to_owned()
            } else {
                format!("Look {}", index + 1)
            }
        });

    let targets = candidate.and_then(|value| value.get("targets"));
    let target_state = |key: &str, fallback: LookTargetState| -> LookTargetState {
        let raw = targets.and_then(|value| value.get(key));
        LookTargetState {
            layers: normalize_layers(fallback.layers, raw.and_then(|value| value.get("layers"))),
            text_position: normalize_text_position(
                fallback.text_position,
                raw.and_then(|value| value.get("textPosition")),
            ),
        }
    };

    LookPreset {
        id,
        name,
        targets: LookTargets {
            program: target_state("program", default_preset.targets.program),
            stage: target_state("stage", default_preset.targets.stage),
            ndi: target_state("ndi", default_preset.targets.ndi),
        },
    }
}

/// Only an actual boolean is honoured. A truthy string or number falls back to
/// the default — `"yes"` must not turn the mask on.
fn normalize_layers(fallback: LookLayers, candidate: Option<&serde_json::Value>) -> LookLayers {
    let mut layers = fallback;
    for layer in LookLayer::ALL {
        if let Some(value) = candidate
            .and_then(|value| value.get(layer.key()))
            .and_then(serde_json::Value::as_bool)
        {
            layers.set(layer, value);
        }
    }
    layers
}

fn normalize_text_position(
    fallback: LookTextPosition,
    candidate: Option<&serde_json::Value>,
) -> LookTextPosition {
    let number = |key: &str| -> Option<f64> {
        candidate
            .and_then(|value| value.get(key))
            .and_then(serde_json::Value::as_f64)
    };
    let align = |key: &str| -> Option<&str> {
        candidate
            .and_then(|value| value.get(key))
            .and_then(serde_json::Value::as_str)
    };

    LookTextPosition {
        x_percent: number("xPercent").unwrap_or(fallback.x_percent),
        y_percent: number("yPercent").unwrap_or(fallback.y_percent),
        width_percent: number("widthPercent").unwrap_or(fallback.width_percent),
        height_percent: number("heightPercent").unwrap_or(fallback.height_percent),
        text_align: match align("textAlign") {
            Some("left") => TextAlign::Left,
            Some("center") => TextAlign::Center,
            Some("right") => TextAlign::Right,
            _ => fallback.text_align,
        },
        vertical_align: match align("verticalAlign") {
            Some("top") => VerticalAlign::Top,
            Some("middle") => VerticalAlign::Middle,
            Some("bottom") => VerticalAlign::Bottom,
            _ => fallback.vertical_align,
        },
    }
    .clamped()
}

// --- transitions ---------------------------------------------------------

pub fn set_selected_target(config: &mut LooksConfig, target: LookTarget, now: i64) {
    config.selected_target = target;
    config.updated_at = now;
}

/// Selecting a look also takes it live. That is the product behaviour: the
/// Looks list is a "what is on screen" control, not a preview.
///
/// Returns whether anything changed, so a caller can skip the event.
pub fn set_selected_look(config: &mut LooksConfig, look_id: &str, now: i64) -> bool {
    if !config.looks.iter().any(|look| look.id == look_id) {
        return false;
    }
    config.selected_look_id = look_id.to_owned();
    config.live_look_id = look_id.to_owned();
    config.updated_at = now;
    true
}

/// Adds a copy of whichever look is live, selects it, and leaves it *off* air.
/// The operator sets a new look up before the audience sees it.
pub fn add_look(
    config: &mut LooksConfig,
    name: Option<&str>,
    now: i64,
    new_id: &mut dyn FnMut() -> String,
) -> String {
    let source = config.live_look().clone();
    let look_name = name
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_owned)
        .unwrap_or_else(|| format!("Look {}", config.looks.len() + 1));

    let id = new_id();
    config.looks.push(LookPreset {
        id: id.clone(),
        name: look_name,
        targets: source.targets,
    });
    config.selected_look_id = id.clone();
    config.updated_at = now;
    id
}

/// Remove a look, unless it is the only one left.
///
/// There is always a look: every destination reads its layers from one, and a
/// configuration with none would leave the audience screen with nothing to
/// draw. The last one therefore cannot be removed — which is also why there is
/// nothing special about "Default" beyond being first. A church that renames
/// and rebuilds its looks should not be left with one it cannot get rid of.
///
/// Removing the look that is selected, or the one on air, moves both to the
/// first of what remains rather than leaving a dangling id behind.
pub fn remove_look(config: &mut LooksConfig, look_id: &str, now: i64) -> bool {
    if config.looks.len() <= 1 {
        return false;
    }
    let Some(index) = config.looks.iter().position(|look| look.id == look_id) else {
        return false;
    };
    config.looks.remove(index);

    let fallback = config.looks[0].id.clone();
    if config.selected_look_id == look_id {
        config.selected_look_id = fallback.clone();
    }
    if config.live_look_id == look_id {
        config.live_look_id = fallback;
    }
    config.updated_at = now;
    true
}

pub fn set_look_name(config: &mut LooksConfig, look_id: &str, name: &str, now: i64) {
    let trimmed = name.trim();
    let next = if trimmed.is_empty() {
        "Untitled Look"
    } else {
        trimmed
    };
    if let Some(look) = config.look_mut(look_id) {
        look.name = next.to_owned();
    }
    config.updated_at = now;
}

pub fn set_layer_enabled(
    config: &mut LooksConfig,
    look_id: &str,
    target: LookTarget,
    layer: LookLayer,
    enabled: bool,
    now: i64,
) {
    if let Some(look) = config.look_mut(look_id) {
        look.targets.get_mut(target).layers.set(layer, enabled);
    }
    config.updated_at = now;
}

pub fn set_text_position(
    config: &mut LooksConfig,
    look_id: &str,
    target: LookTarget,
    patch: LookTextPositionPatch,
    now: i64,
) {
    if let Some(look) = config.look_mut(look_id) {
        let state = look.targets.get_mut(target);
        state.text_position = state.text_position.patched(patch);
    }
    config.updated_at = now;
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Fixed clock and id source, matching `CLOCK` in
    /// `tests/looks-config.test.mjs` so the two suites compare directly.
    const NOW: i64 = 1_700_000_000_000;

    fn fixed_id() -> impl FnMut() -> String {
        || "look-fixed".to_owned()
    }

    fn normalize_value(value: serde_json::Value) -> LooksConfig {
        let mut new_id = fixed_id();
        normalize(Some(&value), NOW, &mut new_id)
    }

    fn normalize_nothing() -> LooksConfig {
        let mut new_id = fixed_id();
        normalize(None, NOW, &mut new_id)
    }

    #[test]
    fn no_stored_config_yields_the_defaults() {
        let config = normalize_nothing();

        assert_eq!(config.version, 2);
        assert_eq!(config.selected_target, LookTarget::Program);
        assert_eq!(config.selected_look_id, "default");
        assert_eq!(config.live_look_id, "default");
        assert_eq!(config.looks.len(), 1);
        assert_eq!(config.updated_at, NOW);
    }

    #[test]
    fn the_default_program_look_shows_presentation_slide_media_and_props() {
        let layers = LookPreset::default_preset().targets.program.layers;

        assert!(!layers.mask);
        assert!(!layers.messages);
        assert!(layers.props);
        assert!(!layers.announcements);
        assert!(layers.presentation);
        assert!(layers.slide);
        assert!(layers.media);
        assert!(layers.video_input);
    }

    #[test]
    fn the_default_stage_look_shows_messages_but_not_media() {
        let layers = LookPreset::default_preset().targets.stage.layers;

        assert!(layers.messages);
        assert!(!layers.media);
        assert!(!layers.video_input);
        assert!(layers.slide);
    }

    #[test]
    fn a_v1_config_is_migrated_rather_than_discarded() {
        let migrated = normalize_value(serde_json::json!({
            "version": 1,
            "presetName": "Sunday Morning",
            "targets": {
                "program": { "layers": { "media": false }, "textPosition": {} },
                "stage": { "layers": {}, "textPosition": {} },
                "ndi": { "layers": {}, "textPosition": {} },
            },
        }));

        assert_eq!(migrated.version, 2);
        assert_eq!(migrated.looks.len(), 1);
        assert_eq!(migrated.looks[0].name, "Sunday Morning");
        assert_eq!(migrated.looks[0].id, "default");
        assert!(!migrated.looks[0].targets.program.layers.media);
        // Layers the v1 config did not mention keep the default.
        assert!(migrated.looks[0].targets.program.layers.slide);
        assert_eq!(migrated.selected_look_id, "default");
        assert_eq!(migrated.live_look_id, "default");
    }

    #[test]
    fn a_v1_config_with_no_preset_name_gets_the_default_name() {
        let migrated = normalize_value(serde_json::json!({
            "version": 1,
            "presetName": "   ",
            "targets": { "program": {}, "stage": {}, "ndi": {} },
        }));

        assert_eq!(migrated.looks[0].name, "Default");
    }

    #[test]
    fn an_unrecognised_version_falls_back_to_the_defaults() {
        let config = normalize_value(serde_json::json!({ "version": 99, "looks": [] }));

        assert_eq!(config.version, 2);
        assert_eq!(config.looks.len(), 1);
        assert_eq!(config.looks[0].id, "default");
    }

    #[test]
    fn a_v2_config_with_an_empty_look_list_falls_back_to_the_defaults() {
        let config = normalize_value(serde_json::json!({ "version": 2, "looks": [] }));

        assert_eq!(config.looks.len(), 1);
        assert_eq!(config.looks[0].id, "default");
    }

    #[test]
    fn a_non_boolean_layer_value_takes_the_default_and_never_becomes_visible() {
        let config = normalize_value(serde_json::json!({
            "version": 2,
            "looks": [{
                "id": "default",
                "name": "Default",
                "targets": {
                    "program": {
                        "layers": { "mask": "yes", "messages": 1, "props": null },
                        "textPosition": {},
                    },
                    "stage": { "layers": {}, "textPosition": {} },
                    "ndi": { "layers": {}, "textPosition": {} },
                },
            }],
        }));

        let layers = config.looks[0].targets.program.layers;
        assert!(!layers.mask, "a truthy string must not enable the mask");
        assert!(!layers.messages, "a truthy number must not enable messages");
        assert!(
            layers.props,
            "null falls back to the default, which is true"
        );
        assert!(layers.slide);
    }

    #[test]
    fn every_layer_is_present_after_normalisation() {
        // Structural in Rust rather than a runtime check: `LookLayers` has a
        // field per layer, so one cannot go missing. This asserts the accessor
        // agrees with the enum, which is what a command depends on.
        let config = normalize_value(serde_json::json!({
            "version": 2,
            "looks": [{ "id": "a", "name": "A", "targets": {} }],
        }));

        for target in LookTarget::ALL {
            let layers = config.looks[0].targets.get(target).layers;
            for layer in LookLayer::ALL {
                let mut probe = layers;
                probe.set(layer, !layers.get(layer));
                assert_ne!(probe.get(layer), layers.get(layer), "{:?}", layer);
            }
        }
    }

    #[test]
    fn text_position_percentages_are_clamped() {
        let config = normalize_value(serde_json::json!({
            "version": 2,
            "looks": [{
                "id": "a",
                "name": "A",
                "targets": {
                    "program": {
                        "layers": {},
                        "textPosition": {
                            "xPercent": -40, "yPercent": 300,
                            "widthPercent": 150, "heightPercent": -1,
                        },
                    },
                },
            }],
        }));

        let position = config.looks[0].targets.program.text_position;
        assert_eq!(position.x_percent, 0.0);
        assert_eq!(position.y_percent, 100.0);
        assert_eq!(position.width_percent, 100.0);
        assert_eq!(position.height_percent, 0.0);
    }

    #[test]
    fn a_selected_look_id_that_names_no_look_falls_back_to_the_first() {
        let config = normalize_value(serde_json::json!({
            "version": 2,
            "selectedLookId": "deleted",
            "liveLookId": "also-deleted",
            "looks": [{ "id": "first", "name": "First", "targets": {} }],
        }));

        assert_eq!(config.selected_look_id, "first");
        assert_eq!(config.live_look_id, "first");
    }

    #[test]
    fn an_unrecognised_target_falls_back_to_program() {
        let config = normalize_value(serde_json::json!({
            "version": 2, "selectedTarget": "hologram",
        }));

        assert_eq!(config.selected_target, LookTarget::Program);
    }

    #[test]
    fn the_first_look_is_always_called_default_even_when_unnamed() {
        let config = normalize_value(serde_json::json!({
            "version": 2,
            "looks": [{ "targets": {} }],
        }));

        assert_eq!(config.looks[0].id, "default");
        assert_eq!(config.looks[0].name, "Default");
    }

    #[test]
    fn later_unnamed_looks_are_numbered_by_position() {
        let config = normalize_value(serde_json::json!({
            "version": 2,
            "looks": [{ "targets": {} }, { "targets": {} }],
        }));

        assert_eq!(config.looks[1].name, "Look 2");
        assert_eq!(config.looks[1].id, "look-fixed");
    }

    // --- transitions -----------------------------------------------------

    #[test]
    fn selecting_a_look_also_takes_it_live() {
        let mut config = LooksConfig::default_config(NOW);
        let mut new_id = fixed_id();
        add_look(&mut config, Some("Second"), NOW, &mut new_id);

        assert!(set_selected_look(&mut config, "look-fixed", NOW));
        assert_eq!(config.selected_look_id, "look-fixed");
        assert_eq!(config.live_look_id, "look-fixed");
    }

    #[test]
    fn selecting_a_look_that_does_not_exist_changes_nothing() {
        let mut config = LooksConfig::default_config(NOW);
        let before = config.clone();

        assert!(!set_selected_look(&mut config, "missing", NOW + 1));
        assert_eq!(config, before, "not even updatedAt moves");
    }

    #[test]
    fn adding_a_look_copies_the_one_that_is_live_not_the_one_selected() {
        let mut config = LooksConfig::default_config(NOW);
        set_layer_enabled(
            &mut config,
            "default",
            LookTarget::Program,
            LookLayer::Media,
            false,
            NOW,
        );

        let mut new_id = fixed_id();
        add_look(&mut config, Some("Copy"), NOW, &mut new_id);

        assert_eq!(config.looks.len(), 2);
        assert!(
            !config.looks[1].targets.program.layers.media,
            "the copy inherits the edit"
        );
    }

    #[test]
    fn the_last_look_cannot_be_removed() {
        let mut config = LooksConfig::default_config(NOW);
        assert_eq!(config.looks.len(), 1);
        assert!(
            !remove_look(&mut config, "default", NOW),
            "there is always a look for a destination to read"
        );
        assert_eq!(config.looks.len(), 1);
    }

    #[test]
    fn removing_the_look_on_air_falls_back_to_what_remains() {
        let mut config = LooksConfig::default_config(NOW);
        let mut new_id = fixed_id();
        let second = add_look(&mut config, Some("Evening"), NOW, &mut new_id);
        set_selected_look(&mut config, &second, NOW);
        assert_eq!(config.live_look_id, second);

        assert!(remove_look(&mut config, &second, NOW));
        assert_eq!(config.looks.len(), 1);
        assert_eq!(config.selected_look_id, "default", "nothing dangles");
        assert_eq!(
            config.live_look_id, "default",
            "and the screen keeps drawing"
        );
    }

    #[test]
    fn a_look_that_is_not_there_is_not_removed() {
        let mut config = LooksConfig::default_config(NOW);
        let mut new_id = fixed_id();
        add_look(&mut config, Some("Evening"), NOW, &mut new_id);
        assert!(!remove_look(&mut config, "no-such-look", NOW));
        assert_eq!(config.looks.len(), 2);
    }

    #[test]
    fn adding_a_look_selects_it_but_does_not_take_it_live() {
        let mut config = LooksConfig::default_config(NOW);
        let mut new_id = fixed_id();
        let id = add_look(&mut config, Some("Copy"), NOW, &mut new_id);

        assert_eq!(config.selected_look_id, id);
        assert_eq!(
            config.live_look_id, "default",
            "a new look must not go live on creation"
        );
    }

    #[test]
    fn a_copied_look_does_not_share_state_with_its_source() {
        let mut config = LooksConfig::default_config(NOW);
        let mut new_id = fixed_id();
        add_look(&mut config, Some("Copy"), NOW, &mut new_id);

        set_layer_enabled(
            &mut config,
            "look-fixed",
            LookTarget::Program,
            LookLayer::Slide,
            false,
            NOW,
        );

        assert!(
            config.looks[0].targets.program.layers.slide,
            "the source is untouched"
        );
        assert!(!config.looks[1].targets.program.layers.slide);
    }

    #[test]
    fn an_unnamed_added_look_is_numbered_by_the_list_length() {
        let mut config = LooksConfig::default_config(NOW);
        let mut new_id = fixed_id();
        add_look(&mut config, None, NOW, &mut new_id);

        assert_eq!(config.looks[1].name, "Look 2");
    }

    #[test]
    fn a_blank_look_name_becomes_untitled_look() {
        let mut config = LooksConfig::default_config(NOW);

        set_look_name(&mut config, "default", "   ", NOW);
        assert_eq!(config.looks[0].name, "Untitled Look");

        set_look_name(&mut config, "default", " Evening ", NOW);
        assert_eq!(config.looks[0].name, "Evening");
    }

    #[test]
    fn toggling_a_layer_affects_one_look_and_one_target_only() {
        let mut config = LooksConfig::default_config(NOW);
        let mut new_id = fixed_id();
        add_look(&mut config, Some("Second"), NOW, &mut new_id);

        set_layer_enabled(
            &mut config,
            "default",
            LookTarget::Program,
            LookLayer::Slide,
            false,
            NOW,
        );

        assert!(!config.looks[0].targets.program.layers.slide);
        assert!(
            config.looks[0].targets.stage.layers.slide,
            "the stage target is untouched"
        );
        assert!(
            config.looks[1].targets.program.layers.slide,
            "the other look is untouched"
        );
    }

    #[test]
    fn text_position_updates_are_patched_and_clamped() {
        let mut config = LooksConfig::default_config(NOW);
        set_text_position(
            &mut config,
            "default",
            LookTarget::Program,
            LookTextPositionPatch {
                y_percent: Some(250.0),
                ..LookTextPositionPatch::default()
            },
            NOW,
        );

        let position = config.looks[0].targets.program.text_position;
        assert_eq!(position.y_percent, 100.0, "clamped");
        assert_eq!(
            position.x_percent, 50.0,
            "unpatched fields keep their value"
        );
        assert_eq!(position.text_align, TextAlign::Center);
    }

    #[test]
    fn every_transition_stamps_updated_at() {
        let stamp = 999;
        let mut config = LooksConfig::default_config(1);

        set_selected_target(&mut config, LookTarget::Stage, stamp);
        assert_eq!(config.updated_at, stamp);

        config.updated_at = 1;
        set_look_name(&mut config, "default", "x", stamp);
        assert_eq!(config.updated_at, stamp);

        config.updated_at = 1;
        set_layer_enabled(
            &mut config,
            "default",
            LookTarget::Program,
            LookLayer::Slide,
            false,
            stamp,
        );
        assert_eq!(config.updated_at, stamp);

        config.updated_at = 1;
        set_text_position(
            &mut config,
            "default",
            LookTarget::Program,
            LookTextPositionPatch::default(),
            stamp,
        );
        assert_eq!(config.updated_at, stamp);
    }

    /// The wire format is the contract with the React side, which still reads
    /// the same shape out of `localStorage` today.
    #[test]
    fn the_json_shape_matches_what_the_react_side_expects() {
        let config = LooksConfig::default_config(NOW);
        let json = serde_json::to_value(&config).expect("serialisable");

        assert_eq!(json["version"], 2);
        assert_eq!(json["selectedTarget"], "program");
        assert_eq!(json["selectedLookId"], "default");
        assert_eq!(json["liveLookId"], "default");
        assert_eq!(json["updatedAt"], NOW);

        let program = &json["looks"][0]["targets"]["program"];
        assert_eq!(program["layers"]["videoInput"], true);
        assert_eq!(program["textPosition"]["xPercent"], 50.0);
        assert_eq!(program["textPosition"]["textAlign"], "center");
        assert_eq!(program["textPosition"]["verticalAlign"], "middle");
    }

    #[test]
    fn a_config_survives_a_round_trip_through_json() {
        let config = LooksConfig::default_config(NOW);
        let encoded = serde_json::to_value(&config).expect("serialisable");
        let mut new_id = fixed_id();

        assert_eq!(normalize(Some(&encoded), NOW, &mut new_id), config);
    }

    /// The one place the Rust port is stricter than the JS.
    #[test]
    fn a_nan_percentage_becomes_zero_rather_than_reaching_the_layout() {
        let position = LookTextPosition {
            x_percent: f64::NAN,
            ..LookTextPosition::DEFAULT
        }
        .clamped();

        assert_eq!(position.x_percent, 0.0);
    }

    #[test]
    fn the_live_look_falls_back_to_the_first_rather_than_going_black() {
        let mut config = LooksConfig::default_config(NOW);
        config.live_look_id = "deleted".to_owned();

        assert_eq!(config.live_look().id, "default");
        assert_eq!(config.selected_look().id, "default");
    }
}
