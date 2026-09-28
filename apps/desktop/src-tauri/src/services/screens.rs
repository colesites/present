//! The screens Present draws to, as Screen Configuration lists them.
//!
//! Two groups, as ProPresenter has them: **Audience**, what the room sees,
//! and **Stage**, the confidence monitors. Each starts with the screens the
//! app always had — the audience output, the media stage and the worship
//! stage — and the operator can add more to either.
//!
//! A screen is one picture. It goes to one output or more, by its type:
//!
//! * **Single**: one output.
//! * **Mirror**: the same picture on every output.
//! * **Grouped**: one large picture cut across a grid of outputs, a wall of
//!   TVs showing one image.
//! * **Edge blend**: one wide picture across projectors side by side, their
//!   edges overlapping and faded into each other so the join cannot be seen.
//!
//! An output is a display, or an NDI source on the network. Its **Output
//! Target** says where on it the picture goes: the whole of it, or a custom
//! rectangle in its own pixels (an LED wall whose processor takes a 1080p
//! signal and shows only part of it). Each output has its own colour
//! adjustments and corner pin, for projectors that are not the same or not
//! square to their screen.
//!
//! The picture's size follows from that: the first output's target, and for a
//! grouped or blended screen the whole grid or row of them.
//!
//! The three screens the app always had keep their windows and everything
//! that already knows them by name (`output`, `media-stage`, `worship-stage`);
//! an added screen's window is `audience-<id>` or `stage-<id>`, and a screen's
//! second and later outputs add `--<output id>` to it. The display each output
//! goes to is kept with the display preferences under [`display_key`], which
//! for a screen's first output is its id: for the first three, the name their
//! role was always stored under.
//!
//! No Tauri types.

use serde::{Deserialize, Serialize};

use super::display::ScreenRole;

/// The audience output's id: `ScreenRole::Audience`'s stored name.
pub const AUDIENCE: &str = "audience";
/// The media stage's id.
pub const MEDIA: &str = "media";
/// The worship stage's id.
pub const WORSHIP: &str = "worship";

/// Every screen's first output, which cannot be removed.
pub const MAIN_OUTPUT: &str = "main";

/// Label prefixes for the windows of added screens.
pub const AUDIENCE_WINDOW_PREFIX: &str = "audience-";
pub const STAGE_WINDOW_PREFIX: &str = "stage-";
/// Between a screen's window label and an output's id, for its second and
/// later outputs' windows.
pub const OUTPUT_SEPARATOR: &str = "--";

/// A name is shown in a list and across a screen by Identify; this is plenty.
const MAX_NAME: usize = 40;
/// More outputs than this for one screen is a mistake, not a setup.
pub const MAX_OUTPUTS: usize = 16;
/// A picture wider or taller than this is not drawn.
const MAX_SIDE: u32 = 16_384;
/// What a picture with no output to take its size from is drawn at.
pub const FALLBACK_SIZE: (u32, u32) = (1920, 1080);

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum ScreenGroup {
    Audience,
    Stage,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum ScreenType {
    #[default]
    Single,
    Mirror,
    Grouped,
    EdgeBlend,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum OutputKind {
    /// A display connected to this computer.
    #[default]
    Display,
    /// An NDI source on the network, for a streaming computer or a switcher.
    Ndi,
    /// A Syphon server on this Mac, for another app on it: a streaming or
    /// projection-mapping app.
    Syphon,
    /// SDI out of a Blackmagic DeckLink or UltraStudio device, to a switcher
    /// or a projector at the end of a long cable.
    Sdi,
}

impl OutputKind {
    /// Drawn by Present and sent, rather than a window on a display.
    pub fn is_stream(self) -> bool {
        self != Self::Display
    }
}

/// Where the picture goes on its output.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case", tag = "kind")]
pub enum OutputTarget {
    /// The whole output, at its own resolution.
    #[default]
    Full,
    /// A rectangle of it, in its own pixels, the rest left black.
    Custom {
        x: i32,
        y: i32,
        width: u32,
        height: u32,
    },
}

/// An output's colour, for projectors that do not match or a room that is
/// too bright. Every value at its default changes nothing.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct ColorAdjust {
    /// 1 as it is; 0.5 half as bright.
    pub brightness: f32,
    /// 1 as it is.
    pub contrast: f32,
    /// 1 as it is; 0 grey.
    pub saturation: f32,
    /// Degrees round the colour wheel.
    pub hue: f32,
    /// How far black is lifted, 0 to 1: a projector's black is not black,
    /// and where two blended projectors overlap it is twice as bright, so the
    /// rest is lifted to match.
    pub black_level: f32,
}

impl Default for ColorAdjust {
    fn default() -> Self {
        Self {
            brightness: 1.0,
            contrast: 1.0,
            saturation: 1.0,
            hue: 0.0,
            black_level: 0.0,
        }
    }
}

impl ColorAdjust {
    pub fn is_identity(&self) -> bool {
        *self == Self::default()
    }

    fn sanitized(self) -> Self {
        let clamp = |value: f32, low: f32, high: f32, fallback: f32| {
            if value.is_finite() {
                value.clamp(low, high)
            } else {
                fallback
            }
        };
        Self {
            brightness: clamp(self.brightness, 0.0, 2.0, 1.0),
            contrast: clamp(self.contrast, 0.0, 2.0, 1.0),
            saturation: clamp(self.saturation, 0.0, 2.0, 1.0),
            hue: clamp(self.hue, -180.0, 180.0, 0.0),
            black_level: clamp(self.black_level, 0.0, 0.5, 0.0),
        }
    }
}

/// How far each corner of the picture is moved on its output, in the
/// output's pixels, to square it up on a screen the projector is not square
/// to. All zero changes nothing.
#[derive(Debug, Clone, Copy, PartialEq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct CornerPin {
    pub top_left: [f32; 2],
    pub top_right: [f32; 2],
    pub bottom_right: [f32; 2],
    pub bottom_left: [f32; 2],
}

impl CornerPin {
    pub fn is_identity(&self) -> bool {
        *self == Self::default()
    }

    fn sanitized(self) -> Self {
        let point = |[x, y]: [f32; 2]| {
            let clamp = |value: f32| {
                if value.is_finite() {
                    value.clamp(-(MAX_SIDE as f32), MAX_SIDE as f32)
                } else {
                    0.0
                }
            };
            [clamp(x), clamp(y)]
        };
        Self {
            top_left: point(self.top_left),
            top_right: point(self.top_right),
            bottom_right: point(self.bottom_right),
            bottom_left: point(self.bottom_left),
        }
    }
}

/// How the overlap between blended projectors fades.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum BlendCurve {
    /// A straight fade.
    Linear,
    /// Curved, as most projectors' brightness is.
    #[default]
    Cubic,
    /// Curved more.
    Quadratic,
}

impl BlendCurve {
    /// How much of the picture shows at `t` across the overlap, 0 at the
    /// outer edge to 1 where the overlap ends. Two overlapping outputs'
    /// weights add up to one at every point, so the join is as bright as the
    /// rest.
    pub fn weight(self, t: f64) -> f64 {
        let t = t.clamp(0.0, 1.0);
        match self {
            BlendCurve::Linear => t,
            BlendCurve::Cubic => t * t * (3.0 - 2.0 * t),
            BlendCurve::Quadratic => {
                if t < 0.5 {
                    2.0 * t * t
                } else {
                    1.0 - 2.0 * (1.0 - t) * (1.0 - t)
                }
            }
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct EdgeBlendSetup {
    /// How much neighbouring outputs overlap, in their own pixels.
    pub overlap: u32,
    pub curve: BlendCurve,
}

impl Default for EdgeBlendSetup {
    fn default() -> Self {
        Self {
            overlap: 240,
            curve: BlendCurve::Cubic,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct GridSetup {
    /// Outputs across; the rows follow from how many outputs there are.
    pub columns: u32,
}

impl Default for GridSetup {
    fn default() -> Self {
        Self { columns: 2 }
    }
}

/// One output of a screen.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OutputSetup {
    pub id: String,
    #[serde(default)]
    pub kind: OutputKind,
    /// The source's name: an NDI source's on the network, or a Syphon
    /// server's on this Mac.
    #[serde(default, alias = "ndiName", skip_serializing_if = "Option::is_none")]
    pub source_name: Option<String>,
    /// An SDI output's device, by its DeckLink persistent id.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub device: Option<String>,
    /// An SDI output's video mode, by its code in `services/sdi.rs`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub video_mode: Option<String>,
    #[serde(default)]
    pub target: OutputTarget,
    #[serde(default)]
    pub color: ColorAdjust,
    #[serde(default)]
    pub corners: CornerPin,
}

impl OutputSetup {
    pub fn new(id: &str, kind: OutputKind) -> Self {
        Self {
            id: id.to_owned(),
            kind,
            source_name: None,
            device: None,
            video_mode: None,
            target: OutputTarget::Full,
            color: ColorAdjust::default(),
            corners: CornerPin::default(),
        }
    }

    fn sanitized(mut self) -> Self {
        self.target = match self.target {
            OutputTarget::Full => OutputTarget::Full,
            OutputTarget::Custom {
                x,
                y,
                width,
                height,
            } => OutputTarget::Custom {
                x: x.clamp(-(MAX_SIDE as i32), MAX_SIDE as i32),
                y: y.clamp(-(MAX_SIDE as i32), MAX_SIDE as i32),
                width: width.clamp(16, MAX_SIDE),
                height: height.clamp(16, MAX_SIDE),
            },
        };
        self.color = self.color.sanitized();
        self.corners = self.corners.sanitized();
        self.source_name = self
            .source_name
            .map(|name| name.trim().chars().take(64).collect::<String>())
            .filter(|name| !name.is_empty());
        self.device = self
            .device
            .map(|device| device.trim().chars().take(32).collect::<String>())
            .filter(|device| !device.is_empty());
        self.video_mode = self
            .video_mode
            .filter(|code| crate::services::sdi::video_mode(code).is_some());
        self
    }

    /// The size a sent output is drawn at when its target is Full: an SDI
    /// output's video mode's, and 1080p for the others.
    pub fn stream_size(&self) -> (u32, u32) {
        match self.kind {
            OutputKind::Sdi => {
                crate::services::sdi::video_mode_or_default(self.video_mode.as_deref()).size()
            }
            _ => FALLBACK_SIZE,
        }
    }
}

/// One screen.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScreenSetup {
    pub id: String,
    pub group: ScreenGroup,
    pub name: String,
    /// A stage screen's layout, by its id.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub layout: Option<String>,
    /// Behind everything on it. `None`: black.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub color: Option<String>,
    #[serde(default)]
    pub screen_type: ScreenType,
    /// Its outputs, the first always [`MAIN_OUTPUT`]. A single screen uses
    /// the first alone; the others are kept for when it is not single again.
    #[serde(default)]
    pub outputs: Vec<OutputSetup>,
    #[serde(default)]
    pub grid: GridSetup,
    #[serde(default)]
    pub blend: EdgeBlendSetup,
}

impl ScreenSetup {
    /// The three every setup has, as they start.
    pub fn built_ins() -> [ScreenSetup; 3] {
        [
            new_screen(
                AUDIENCE.to_owned(),
                ScreenGroup::Audience,
                "Screen".to_owned(),
            ),
            ScreenSetup {
                layout: Some(MEDIA.to_owned()),
                ..new_screen(
                    MEDIA.to_owned(),
                    ScreenGroup::Stage,
                    "Media stage".to_owned(),
                )
            },
            ScreenSetup {
                layout: Some(WORSHIP.to_owned()),
                ..new_screen(
                    WORSHIP.to_owned(),
                    ScreenGroup::Stage,
                    "Worship stage".to_owned(),
                )
            },
        ]
    }

    pub fn is_built_in(&self) -> bool {
        is_built_in(&self.id)
    }

    /// The role one of the three built in plays; `None` for an added screen.
    pub fn role(&self) -> Option<ScreenRole> {
        match self.id.as_str() {
            AUDIENCE => Some(ScreenRole::Audience),
            MEDIA => Some(ScreenRole::Media),
            WORSHIP => Some(ScreenRole::Worship),
            _ => None,
        }
    }

    /// The stage layout it shows.
    pub fn stage_layout(&self) -> &str {
        self.layout.as_deref().unwrap_or(match self.id.as_str() {
            MEDIA => MEDIA,
            _ => WORSHIP,
        })
    }

    /// The outputs in use: the first alone for a single screen.
    pub fn active_outputs(&self) -> &[OutputSetup] {
        match self.screen_type {
            ScreenType::Single => &self.outputs[..self.outputs.len().min(1)],
            _ => &self.outputs,
        }
    }

    pub fn output(&self, id: &str) -> Option<&OutputSetup> {
        self.outputs.iter().find(|output| output.id == id)
    }

    /// The label of its first output's window, which the others add to.
    fn base_label(&self) -> String {
        match self.id.as_str() {
            AUDIENCE => "output".to_owned(),
            MEDIA => "media-stage".to_owned(),
            WORSHIP => "worship-stage".to_owned(),
            id => match self.group {
                ScreenGroup::Audience => format!("{AUDIENCE_WINDOW_PREFIX}{id}"),
                ScreenGroup::Stage => format!("{STAGE_WINDOW_PREFIX}{id}"),
            },
        }
    }

    /// The label of the window for one of its outputs.
    pub fn window_label(&self, output: &str) -> String {
        if output == MAIN_OUTPUT {
            self.base_label()
        } else {
            format!("{}{OUTPUT_SEPARATOR}{output}", self.base_label())
        }
    }

    /// Every window it has while on: one per display output in use.
    pub fn window_labels(&self) -> Vec<String> {
        self.active_outputs()
            .iter()
            .filter(|output| output.kind == OutputKind::Display)
            .map(|output| self.window_label(&output.id))
            .collect()
    }

    /// Only what an operator may change, and within bounds.
    fn sanitized(mut self) -> Self {
        let name: String = self.name.trim().chars().take(MAX_NAME).collect();
        self.name = if name.is_empty() {
            match self.group {
                ScreenGroup::Audience => "Screen".to_owned(),
                ScreenGroup::Stage => "Stage".to_owned(),
            }
        } else {
            name
        };
        self.color = self
            .color
            .map(|color| color.trim().chars().take(32).collect::<String>())
            .filter(|color| !color.is_empty());
        self.layout = match self.group {
            ScreenGroup::Audience => None,
            ScreenGroup::Stage => self
                .layout
                .map(|layout| layout.trim().chars().take(64).collect::<String>())
                .filter(|layout| !layout.is_empty()),
        };

        // Outputs: unique usable ids, the first always the main one, and
        // never none.
        let mut seen = std::collections::HashSet::new();
        let mut outputs: Vec<OutputSetup> = self
            .outputs
            .into_iter()
            .filter(|output| output.id == MAIN_OUTPUT || is_usable_output_id(&output.id))
            .filter(|output| seen.insert(output.id.clone()))
            .map(OutputSetup::sanitized)
            .take(MAX_OUTPUTS)
            .collect();
        match outputs.iter().position(|output| output.id == MAIN_OUTPUT) {
            Some(0) => {}
            Some(at) => {
                let main = outputs.remove(at);
                outputs.insert(0, main);
            }
            None => outputs.insert(0, OutputSetup::new(MAIN_OUTPUT, OutputKind::Display)),
        }
        self.outputs = outputs;
        self.grid.columns = self.grid.columns.clamp(1, MAX_OUTPUTS as u32);
        self.blend.overlap = self.blend.overlap.min(MAX_SIDE / 2);
        self
    }
}

pub fn is_built_in(id: &str) -> bool {
    matches!(id, AUDIENCE | MEDIA | WORSHIP)
}

/// An id that is safe in a window label and a URL, and is not a built-in's.
pub fn is_usable_id(id: &str) -> bool {
    !id.is_empty()
        && id.len() <= 32
        && !is_built_in(id)
        && !id.contains(OUTPUT_SEPARATOR)
        && id
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
}

/// An output id other than the main one: letters and digits only, so it can
/// follow the separator in a label unambiguously.
pub fn is_usable_output_id(id: &str) -> bool {
    !id.is_empty()
        && id.len() <= 16
        && id != MAIN_OUTPUT
        && id.chars().all(|c| c.is_ascii_alphanumeric())
}

/// Which screen and output a window belongs to, by its label.
pub fn screen_for_label(label: &str) -> Option<(&str, &str)> {
    let (base, output) = match label.rsplit_once(OUTPUT_SEPARATOR) {
        Some((base, output)) if is_usable_output_id(output) => (base, output),
        _ => (label, MAIN_OUTPUT),
    };
    let screen = match base {
        "output" => AUDIENCE,
        "media-stage" => MEDIA,
        "worship-stage" => WORSHIP,
        _ => base
            .strip_prefix(AUDIENCE_WINDOW_PREFIX)
            .or_else(|| base.strip_prefix(STAGE_WINDOW_PREFIX))
            .filter(|id| is_usable_id(id))?,
    };
    Some((screen, output))
}

/// Which screen a window belongs to, by its label.
pub fn screen_id_for_label(label: &str) -> Option<&str> {
    screen_for_label(label).map(|(screen, _)| screen)
}

/// Where the display an output goes to is stored: the screen's id for its
/// first output, so the built-in three keep their roles' saved choices.
pub fn display_key(screen: &str, output: &str) -> String {
    if output == MAIN_OUTPUT {
        screen.to_owned()
    } else {
        format!("{screen}/{output}")
    }
}

/// Every screen, the three built in first in their groups and the added ones
/// after them in the order they were added: what was stored, with anything
/// missing or unusable put right.
pub fn arranged(stored: &[ScreenSetup]) -> Vec<ScreenSetup> {
    let built_in = ScreenSetup::built_ins().map(|default| {
        let Some(saved) = stored.iter().find(|screen| screen.id == default.id) else {
            return default.sanitized();
        };
        // What is chosen is kept; which group it is in is not the
        // operator's to change.
        ScreenSetup {
            id: default.id.clone(),
            group: default.group,
            layout: saved.layout.clone().or(default.layout.clone()),
            ..saved.clone()
        }
        .sanitized()
    });
    let [audience, media, worship] = built_in;
    let added = |group: ScreenGroup| {
        let mut seen = std::collections::HashSet::new();
        stored
            .iter()
            .filter(move |screen| screen.group == group && is_usable_id(&screen.id))
            .filter(move |screen| seen.insert(screen.id.clone()))
            .cloned()
            .map(ScreenSetup::sanitized)
            .collect::<Vec<_>>()
    };

    let mut screens = vec![audience];
    screens.extend(added(ScreenGroup::Audience));
    screens.push(media);
    screens.push(worship);
    screens.extend(added(ScreenGroup::Stage));
    screens
}

/// A name for a screen being added: the group's word and the next number.
pub fn next_name(screens: &[ScreenSetup], group: ScreenGroup) -> String {
    let word = match group {
        ScreenGroup::Audience => "Screen",
        ScreenGroup::Stage => "Stage",
    };
    let count = screens
        .iter()
        .filter(|screen| screen.group == group)
        .count();
    let taken = |name: &str| screens.iter().any(|screen| screen.name == name);
    (count + 1..)
        .map(|number| format!("{word} {number}"))
        .find(|name| !taken(name))
        .unwrap_or_else(|| word.to_owned())
}

/// A new screen, sanitized, with its main output of `kind`.
pub fn new_screen(id: String, group: ScreenGroup, name: String) -> ScreenSetup {
    ScreenSetup {
        id,
        group,
        name,
        layout: (group == ScreenGroup::Stage).then(|| WORSHIP.to_owned()),
        color: None,
        screen_type: ScreenType::Single,
        outputs: vec![OutputSetup::new(MAIN_OUTPUT, OutputKind::Display)],
        grid: GridSetup::default(),
        blend: EdgeBlendSetup::default(),
    }
    .sanitized()
}

/// A change to one screen, as Screen Configuration sends it. A field left out
/// is left as it is; `color` can be `null`, for black.
#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScreenPatch {
    #[serde(default)]
    pub name: Option<String>,
    #[serde(default, deserialize_with = "present")]
    pub color: Option<Option<String>>,
    #[serde(default)]
    pub layout: Option<String>,
    #[serde(default)]
    pub screen_type: Option<ScreenType>,
    #[serde(default)]
    pub grid: Option<GridSetup>,
    #[serde(default)]
    pub blend: Option<EdgeBlendSetup>,
}

/// A change to one output of a screen.
#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OutputPatch {
    #[serde(default)]
    pub kind: Option<OutputKind>,
    #[serde(default, alias = "ndiName", deserialize_with = "present")]
    pub source_name: Option<Option<String>>,
    #[serde(default, deserialize_with = "present")]
    pub device: Option<Option<String>>,
    #[serde(default, deserialize_with = "present")]
    pub video_mode: Option<Option<String>>,
    #[serde(default)]
    pub target: Option<OutputTarget>,
    #[serde(default)]
    pub color: Option<ColorAdjust>,
    #[serde(default)]
    pub corners: Option<CornerPin>,
}

fn present<'de, D, T>(deserializer: D) -> Result<Option<Option<T>>, D::Error>
where
    D: serde::Deserializer<'de>,
    T: Deserialize<'de>,
{
    Option::deserialize(deserializer).map(Some)
}

impl ScreenPatch {
    /// `screen` with this change made.
    pub fn apply(self, screen: &ScreenSetup) -> ScreenSetup {
        let mut next = screen.clone();
        if let Some(name) = self.name {
            next.name = name;
        }
        if let Some(color) = self.color {
            next.color = color;
        }
        if let Some(layout) = self.layout {
            next.layout = Some(layout);
        }
        if let Some(screen_type) = self.screen_type {
            next.screen_type = screen_type;
        }
        if let Some(grid) = self.grid {
            next.grid = grid;
        }
        if let Some(blend) = self.blend {
            next.blend = blend;
        }
        next.sanitized()
    }
}

impl OutputPatch {
    /// `screen` with this change made to its output `output`.
    pub fn apply(self, screen: &ScreenSetup, output: &str) -> Option<ScreenSetup> {
        let mut next = screen.clone();
        let changing = next.outputs.iter_mut().find(|each| each.id == output)?;
        if let Some(kind) = self.kind {
            changing.kind = kind;
        }
        if let Some(name) = self.source_name {
            changing.source_name = name;
        }
        if let Some(device) = self.device {
            changing.device = device;
        }
        if let Some(mode) = self.video_mode {
            changing.video_mode = mode;
        }
        if let Some(target) = self.target {
            changing.target = target;
        }
        if let Some(color) = self.color {
            changing.color = color;
        }
        if let Some(corners) = self.corners {
            changing.corners = corners;
        }
        Some(next.sanitized())
    }
}

/// `screen` with another output, of `kind`, and that output's id.
pub fn with_output(screen: &ScreenSetup, id: String, kind: OutputKind) -> Option<ScreenSetup> {
    if screen.outputs.len() >= MAX_OUTPUTS || !is_usable_output_id(&id) {
        return None;
    }
    let mut next = screen.clone();
    next.outputs.push(OutputSetup::new(&id, kind));
    // A second output makes a single screen a mirror: the operator added it
    // to see the picture there too.
    if next.screen_type == ScreenType::Single {
        next.screen_type = ScreenType::Mirror;
    }
    Some(next.sanitized())
}

/// `screen` without its output `id`. The main output stays.
pub fn without_output(screen: &ScreenSetup, id: &str) -> Option<ScreenSetup> {
    if id == MAIN_OUTPUT || screen.output(id).is_none() {
        return None;
    }
    let mut next = screen.clone();
    next.outputs.retain(|output| output.id != id);
    if next.outputs.len() == 1 {
        next.screen_type = ScreenType::Single;
    }
    Some(next.sanitized())
}

/// Which part of the screen's picture an output shows, and how.
#[derive(Debug, Clone, Copy, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OutputGeometry {
    /// The part of the picture it shows, as fractions of it: x, y, width,
    /// height.
    pub source: [f64; 4],
    /// Where on the output it goes, in the output's pixels, or `None` for
    /// the whole output.
    pub target: Option<[f64; 4]>,
    /// How far in from its left and right edges it fades into its
    /// neighbour, as fractions of its width. Zero without a neighbour.
    pub blend_left: f64,
    pub blend_right: f64,
    pub curve: BlendCurve,
}

/// A screen's picture: its size, in output pixels, and what each output in
/// use shows of it.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScreenLayout {
    pub canvas: (u32, u32),
    pub outputs: Vec<(String, OutputGeometry)>,
}

/// Lay a screen's picture out over its outputs. `size_of` is an output's own
/// resolution, where it has one: its display's, while it is connected.
pub fn layout(
    screen: &ScreenSetup,
    size_of: impl Fn(&OutputSetup) -> Option<(u32, u32)>,
) -> ScreenLayout {
    let outputs = screen.active_outputs();
    let target_size = |output: &OutputSetup| match output.target {
        OutputTarget::Custom { width, height, .. } => (width, height),
        OutputTarget::Full => size_of(output).unwrap_or(FALLBACK_SIZE),
    };
    let target_rect = |output: &OutputSetup| match output.target {
        OutputTarget::Custom {
            x,
            y,
            width,
            height,
        } => Some([
            f64::from(x),
            f64::from(y),
            f64::from(width),
            f64::from(height),
        ]),
        OutputTarget::Full => None,
    };
    let (cell_width, cell_height) = outputs.first().map_or(FALLBACK_SIZE, target_size);
    let whole = |output: &OutputSetup| OutputGeometry {
        source: [0.0, 0.0, 1.0, 1.0],
        target: target_rect(output),
        blend_left: 0.0,
        blend_right: 0.0,
        curve: screen.blend.curve,
    };
    let count = outputs.len().max(1) as u32;
    let clamp =
        |(width, height): (u32, u32)| (width.clamp(16, MAX_SIDE), height.clamp(16, MAX_SIDE));

    match screen.screen_type {
        ScreenType::Single | ScreenType::Mirror => ScreenLayout {
            canvas: clamp((cell_width, cell_height)),
            outputs: outputs
                .iter()
                .map(|output| (output.id.clone(), whole(output)))
                .collect(),
        },
        ScreenType::Grouped => {
            let columns = screen.grid.columns.clamp(1, count);
            let rows = count.div_ceil(columns);
            let canvas = clamp((cell_width * columns, cell_height * rows));
            ScreenLayout {
                canvas,
                outputs: outputs
                    .iter()
                    .enumerate()
                    .map(|(index, output)| {
                        let (column, row) = (index as u32 % columns, index as u32 / columns);
                        let (across, down) = (f64::from(columns), f64::from(rows));
                        (
                            output.id.clone(),
                            OutputGeometry {
                                source: [
                                    f64::from(column) / across,
                                    f64::from(row) / down,
                                    1.0 / across,
                                    1.0 / down,
                                ],
                                ..whole(output)
                            },
                        )
                    })
                    .collect(),
            }
        }
        ScreenType::EdgeBlend => {
            let overlap = screen.blend.overlap.min(cell_width.saturating_sub(1) / 2);
            let step = cell_width - overlap;
            let width = step * (count - 1) + cell_width;
            let canvas = clamp((width, cell_height));
            let (total, cell, blend) = (
                f64::from(width),
                f64::from(cell_width),
                f64::from(overlap) / f64::from(cell_width.max(1)),
            );
            ScreenLayout {
                canvas,
                outputs: outputs
                    .iter()
                    .enumerate()
                    .map(|(index, output)| {
                        let index = index as u32;
                        (
                            output.id.clone(),
                            OutputGeometry {
                                source: [f64::from(index * step) / total, 0.0, cell / total, 1.0],
                                blend_left: if index > 0 { blend } else { 0.0 },
                                blend_right: if index + 1 < count { blend } else { 0.0 },
                                ..whole(output)
                            },
                        )
                    })
                    .collect(),
            }
        }
    }
}

/// The projective transform that moves the corners of a `width` by `height`
/// rectangle by `pin`, as a column-major 4×4 matrix for Core Animation and
/// CSS `matrix3d`, origin at the top left. `None` when the corners fold over.
pub fn corner_pin_matrix(width: f64, height: f64, pin: &CornerPin) -> Option<[f64; 16]> {
    if pin.is_identity() || width <= 0.0 || height <= 0.0 {
        return None;
    }
    let corner =
        |[x, y]: [f32; 2], base_x: f64, base_y: f64| (base_x + f64::from(x), base_y + f64::from(y));
    let (x0, y0) = corner(pin.top_left, 0.0, 0.0);
    let (x1, y1) = corner(pin.top_right, width, 0.0);
    let (x2, y2) = corner(pin.bottom_right, width, height);
    let (x3, y3) = corner(pin.bottom_left, 0.0, height);

    // The square-to-quad homography (Heckbert), then scaled from the unit
    // square to the rectangle.
    let (dx1, dx2, dx3) = (x1 - x2, x3 - x2, x0 - x1 + x2 - x3);
    let (dy1, dy2, dy3) = (y1 - y2, y3 - y2, y0 - y1 + y2 - y3);
    let determinant = dx1 * dy2 - dx2 * dy1;
    if determinant.abs() < 1e-9 {
        return None;
    }
    let g = (dx3 * dy2 - dx2 * dy3) / determinant;
    let h = (dx1 * dy3 - dx3 * dy1) / determinant;
    let a = x1 - x0 + g * x1;
    let b = x3 - x0 + h * x3;
    let c = x0;
    let d = y1 - y0 + g * y1;
    let e = y3 - y0 + h * y3;
    let f = y0;
    // From pixels to the unit square first.
    let (a, b, d, e, g, h) = (
        a / width,
        b / height,
        d / width,
        e / height,
        g / width,
        h / height,
    );
    // [x', y', w'] = [[a b c] [d e f] [g h 1]] · [x y 1], as a 4×4 with z kept.
    Some([
        a, d, 0.0, g, //
        b, e, 0.0, h, //
        0.0, 0.0, 1.0, 0.0, //
        c, f, 0.0, 1.0,
    ])
}

#[cfg(test)]
mod tests {
    use super::*;

    fn with_outputs(screen_type: ScreenType, count: usize) -> ScreenSetup {
        let mut screen = new_screen("wall".into(), ScreenGroup::Audience, "Wall".into());
        for index in 1..count {
            screen = with_output(&screen, format!("o{index}"), OutputKind::Display).unwrap();
        }
        ScreenSetup {
            screen_type,
            ..screen
        }
    }

    #[test]
    fn a_new_setup_has_the_three_screens_the_app_always_had() {
        let screens = arranged(&[]);
        let ids: Vec<&str> = screens.iter().map(|screen| screen.id.as_str()).collect();
        assert_eq!(ids, [AUDIENCE, MEDIA, WORSHIP]);
        let labels: Vec<String> = screens
            .iter()
            .map(|s| s.window_label(MAIN_OUTPUT))
            .collect();
        assert_eq!(labels, ["output", "media-stage", "worship-stage"]);
        assert_eq!(screens[0].name, "Screen");
        assert_eq!(screens[1].stage_layout(), MEDIA);
        assert_eq!(screens[2].stage_layout(), WORSHIP);
        assert!(screens.iter().all(|screen| screen.outputs.len() == 1));
    }

    #[test]
    fn a_screen_saved_before_it_had_outputs_gets_its_main_one() {
        let saved: ScreenSetup = serde_json::from_value(serde_json::json!({
            "id": "lobby", "group": "audience", "name": "Lobby",
            "size": { "width": 1280, "height": 720 }, "target": "fit"
        }))
        .expect("an older screen still reads");
        let lobby = &arranged(&[saved])[1];
        assert_eq!(lobby.outputs.len(), 1);
        assert_eq!(lobby.outputs[0].id, MAIN_OUTPUT);
        assert_eq!(lobby.outputs[0].target, OutputTarget::Full);
    }

    #[test]
    fn every_output_has_a_window_label_that_leads_back_to_it() {
        let wall = with_outputs(ScreenType::Mirror, 3);
        let labels = wall.window_labels();
        assert_eq!(
            labels,
            ["audience-wall", "audience-wall--o1", "audience-wall--o2"]
        );
        assert_eq!(screen_for_label("audience-wall--o2"), Some(("wall", "o2")));
        assert_eq!(
            screen_for_label("audience-wall"),
            Some(("wall", MAIN_OUTPUT))
        );
        assert_eq!(screen_for_label("output--o1"), Some((AUDIENCE, "o1")));
        assert_eq!(screen_for_label("media-stage"), Some((MEDIA, MAIN_OUTPUT)));
        assert_eq!(screen_for_label("settings"), None);
        assert_eq!(display_key("wall", "o2"), "wall/o2");
        assert_eq!(display_key(AUDIENCE, MAIN_OUTPUT), AUDIENCE);
    }

    #[test]
    fn a_single_screen_uses_its_first_output_alone() {
        let mut wall = with_outputs(ScreenType::Mirror, 2);
        wall.screen_type = ScreenType::Single;
        assert_eq!(wall.window_labels(), ["audience-wall"]);
        let laid = layout(&wall, |_| Some((1920, 1080)));
        assert_eq!(laid.outputs.len(), 1);
        assert_eq!(laid.canvas, (1920, 1080));
    }

    #[test]
    fn a_custom_target_sizes_the_picture_and_places_it() {
        let mut screen = new_screen("led".into(), ScreenGroup::Audience, "LED".into());
        screen.outputs[0].target = OutputTarget::Custom {
            x: 100,
            y: 50,
            width: 1536,
            height: 864,
        };
        let laid = layout(&screen, |_| Some((1920, 1080)));
        assert_eq!(laid.canvas, (1536, 864));
        assert_eq!(laid.outputs[0].1.target, Some([100.0, 50.0, 1536.0, 864.0]));
    }

    #[test]
    fn a_grouped_screen_is_cut_into_its_grid() {
        let mut wall = with_outputs(ScreenType::Grouped, 4);
        wall.grid.columns = 2;
        let laid = layout(&wall, |_| Some((1920, 1080)));
        assert_eq!(laid.canvas, (3840, 2160));
        assert_eq!(laid.outputs[0].1.source, [0.0, 0.0, 0.5, 0.5]);
        assert_eq!(laid.outputs[1].1.source, [0.5, 0.0, 0.5, 0.5]);
        assert_eq!(laid.outputs[3].1.source, [0.5, 0.5, 0.5, 0.5]);
    }

    #[test]
    fn edge_blended_outputs_overlap_and_fade_only_where_they_meet() {
        let mut row = with_outputs(ScreenType::EdgeBlend, 3);
        row.blend.overlap = 240;
        let laid = layout(&row, |_| Some((1920, 1080)));
        // Three 1920s with two overlaps of 240.
        assert_eq!(laid.canvas, (5280, 1080));
        let [left, middle, right] = [&laid.outputs[0].1, &laid.outputs[1].1, &laid.outputs[2].1];
        assert_eq!(
            (left.blend_left, right.blend_right),
            (0.0, 0.0),
            "no fade at the outer edges"
        );
        assert!(
            (left.blend_right - 0.125).abs() < 1e-9 && (middle.blend_left - 0.125).abs() < 1e-9
        );
        // The middle one starts where the first's overlap begins.
        assert!((middle.source[0] - 1680.0 / 5280.0).abs() < 1e-9);
        assert!((middle.source[2] - 1920.0 / 5280.0).abs() < 1e-9);
    }

    #[test]
    fn blended_edges_add_up_to_the_whole_picture() {
        for curve in [BlendCurve::Linear, BlendCurve::Cubic, BlendCurve::Quadratic] {
            for step in 0..=10 {
                let t = f64::from(step) / 10.0;
                let sum = curve.weight(t) + curve.weight(1.0 - t);
                assert!((sum - 1.0).abs() < 1e-9, "{curve:?} at {t} adds to {sum}");
            }
            assert_eq!(curve.weight(0.0), 0.0);
            assert_eq!(curve.weight(1.0), 1.0);
        }
    }

    #[test]
    fn a_corner_pin_moves_the_corners_where_it_says() {
        let pin = CornerPin {
            top_left: [40.0, 20.0],
            top_right: [-30.0, 0.0],
            bottom_right: [0.0, -10.0],
            bottom_left: [10.0, 0.0],
        };
        let m = corner_pin_matrix(1920.0, 1080.0, &pin).expect("a transform");
        let apply = |x: f64, y: f64| {
            let (px, py, pw) = (
                m[0] * x + m[4] * y + m[12],
                m[1] * x + m[5] * y + m[13],
                m[3] * x + m[7] * y + m[15],
            );
            (px / pw, py / pw)
        };
        let close = |(ax, ay): (f64, f64), (bx, by): (f64, f64)| {
            (ax - bx).abs() < 1e-6 && (ay - by).abs() < 1e-6
        };
        assert!(close(apply(0.0, 0.0), (40.0, 20.0)));
        assert!(close(apply(1920.0, 0.0), (1890.0, 0.0)));
        assert!(close(apply(1920.0, 1080.0), (1920.0, 1070.0)));
        assert!(close(apply(0.0, 1080.0), (10.0, 1080.0)));
        assert_eq!(
            corner_pin_matrix(1920.0, 1080.0, &CornerPin::default()),
            None,
            "nothing to move"
        );
    }

    #[test]
    fn outputs_are_added_and_taken_away_but_the_main_one_stays() {
        let screen = new_screen("lobby".into(), ScreenGroup::Audience, "Lobby".into());
        let two = with_output(&screen, "b2".into(), OutputKind::Ndi).unwrap();
        assert_eq!(
            two.screen_type,
            ScreenType::Mirror,
            "a second output mirrors"
        );
        assert_eq!(two.outputs[1].kind, OutputKind::Ndi);
        assert!(
            with_output(&two, "b2".into(), OutputKind::Display)
                .unwrap()
                .outputs
                .len()
                == 2,
            "no doubles"
        );
        assert!(without_output(&two, MAIN_OUTPUT).is_none());
        let one = without_output(&two, "b2").unwrap();
        assert_eq!(
            (one.outputs.len(), one.screen_type),
            (1, ScreenType::Single)
        );
    }

    #[test]
    fn added_screens_sit_in_their_group_after_the_built_in_ones() {
        let stored = vec![
            new_screen("back".into(), ScreenGroup::Stage, "Back wall".into()),
            new_screen("lobby".into(), ScreenGroup::Audience, "Lobby".into()),
        ];
        let ids: Vec<String> = arranged(&stored)
            .into_iter()
            .map(|screen| screen.id)
            .collect();
        assert_eq!(ids, [AUDIENCE, "lobby", MEDIA, WORSHIP, "back"]);
    }

    #[test]
    fn a_change_leaves_out_what_it_does_not_mention() {
        let screen = new_screen("lobby".into(), ScreenGroup::Audience, "Lobby".into());
        let patch: ScreenPatch = serde_json::from_value(
            serde_json::json!({ "color": "#102030", "screenType": "grouped" }),
        )
        .unwrap();
        let changed = patch.apply(&screen);
        assert_eq!(changed.name, "Lobby");
        assert_eq!(changed.color.as_deref(), Some("#102030"));
        assert_eq!(changed.screen_type, ScreenType::Grouped);

        let target: OutputPatch = serde_json::from_value(serde_json::json!({
            "target": { "kind": "custom", "x": 0, "y": 0, "width": 1280, "height": 720 },
            "color": { "brightness": 9 }
        }))
        .unwrap();
        let aimed = target.apply(&changed, MAIN_OUTPUT).unwrap();
        assert!(matches!(
            aimed.outputs[0].target,
            OutputTarget::Custom { width: 1280, .. }
        ));
        assert_eq!(aimed.outputs[0].color.brightness, 2.0, "kept within bounds");
        assert_eq!(
            aimed.outputs[0].color.contrast, 1.0,
            "the rest at their defaults"
        );

        let blank: ScreenPatch =
            serde_json::from_value(serde_json::json!({ "name": "   " })).unwrap();
        assert_eq!(blank.apply(&screen).name, "Screen", "never nameless");
    }

    #[test]
    fn an_ndi_name_saved_before_is_the_source_name() {
        let output: OutputSetup =
            serde_json::from_str(r#"{"id":"main","kind":"ndi","ndiName":"Lobby"}"#).unwrap();
        assert_eq!(output.source_name.as_deref(), Some("Lobby"));
        let saved = serde_json::to_string(&output).unwrap();
        assert!(saved.contains(r#""sourceName":"Lobby""#), "{saved}");
    }

    #[test]
    fn an_sdi_output_is_drawn_at_its_video_mode() {
        let mut output = OutputSetup::new("o1", OutputKind::Sdi);
        assert_eq!(output.stream_size(), (1920, 1080));
        output.video_mode = Some("hp59".to_owned());
        assert_eq!(output.clone().sanitized().stream_size(), (1280, 720));
        output.video_mode = Some("nonsense".to_owned());
        assert_eq!(output.sanitized().video_mode, None);
        assert_eq!(
            OutputSetup::new("o2", OutputKind::Ndi).stream_size(),
            FALLBACK_SIZE
        );
    }
}
