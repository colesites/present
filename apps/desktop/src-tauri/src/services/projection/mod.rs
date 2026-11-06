//! How the audience screens are drawn: the operator's projection settings,
//! what this computer can do, and the automatic adjustment between them.
//!
//! **These are output targets, not limits on the source.** A 4K video on a
//! 1080p projector is decoded in full by the GPU and made the projector's size
//! there, never larger than the screen shows (`video::live`). The resolution
//! setting caps what the processor draws — the slide over the video, and
//! whole pictures — and the size the video is scaled to; a window smaller
//! than the cap is drawn at its own size, as before. The frame rate setting
//! caps how often a screen is drawn; a video still plays at its own rate up to
//! it.
//!
//! The settings are read on every screen's every tick, so they live in a
//! process-wide cell (`settings`), written by the command that changes them
//! and loaded from `projection.json` at start.

use std::path::{Path, PathBuf};
use std::sync::RwLock;
use std::time::Duration;

use serde::{Deserialize, Serialize};

pub mod adjust;
pub mod capabilities;

/// A named set of targets, from the operator's table.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Preset {
    /// 1280×720 at 24 frames a second.
    VeryLow,
    /// 1920×1080 at 30.
    Low,
    /// 1920×1080, 30 when nothing needs more and 60 when it does.
    Medium,
    /// 1920×1080 at 60.
    Balanced,
    /// 2560×1440 at 60.
    High,
    /// 3840×2160 at 60: as large as any projector this app drives, so in
    /// practice each screen at its own size.
    #[default]
    Highest,
    /// The resolution and frame rate as set, not from the table.
    Custom,
}

/// The most pixels a screen's picture is drawn at.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Resolution {
    R720,
    R1080,
    R1440,
    #[default]
    R2160,
    /// Each screen at its own size, however large.
    Native,
}

impl Resolution {
    /// Width and height, or `None` for no cap.
    pub fn size(self) -> Option<(u32, u32)> {
        match self {
            Self::R720 => Some((1280, 720)),
            Self::R1080 => Some((1920, 1080)),
            Self::R1440 => Some((2560, 1440)),
            Self::R2160 => Some((3840, 2160)),
            Self::Native => None,
        }
    }

    /// One step smaller, for the automatic adjustment: no lower than 720.
    pub fn lower(self) -> Self {
        match self {
            Self::Native | Self::R2160 => Self::R1440,
            Self::R1440 => Self::R1080,
            Self::R1080 | Self::R720 => Self::R720,
        }
    }
}

/// How often a screen is drawn, at most.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum FrameRate {
    Fps24,
    Fps30,
    /// 30, and 60 while a video of more than 30 frames a second plays or
    /// something moves on the processor (a transition, a scrolling message).
    Adaptive,
    #[default]
    Fps60,
}

impl FrameRate {
    /// The most frames a second, and the fewest it settles to when nothing
    /// needs more.
    pub fn bounds(self) -> (u32, u32) {
        match self {
            Self::Fps24 => (24, 24),
            Self::Fps30 => (30, 30),
            Self::Adaptive => (60, 30),
            Self::Fps60 => (60, 60),
        }
    }

    /// One step slower, for the automatic adjustment: no slower than 24.
    pub fn lower(self) -> Self {
        match self {
            Self::Fps60 => Self::Adaptive,
            Self::Adaptive => Self::Fps30,
            Self::Fps30 | Self::Fps24 => Self::Fps24,
        }
    }
}

/// How carefully the video is scaled where it is shown smaller or larger
/// than it was decoded.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum VideoQuality {
    /// Bilinear: what the window server does by default.
    Standard,
    /// Trilinear, from a chain of smaller copies the GPU keeps: smoother
    /// fine detail when a video is shown much smaller than it was decoded,
    /// such as a 4K video in the operator's preview. A little more GPU work.
    #[default]
    High,
}

/// Whether video is decoded on the GPU.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum HardwareDecoding {
    /// On the GPU for the codecs this computer's GPU decodes, which are
    /// asked about once (`capabilities`); in software for the rest, with no
    /// attempt on the GPU first.
    #[default]
    Auto,
    /// On the GPU first for every file, falling back to software only when
    /// it refuses one.
    Enabled,
    /// In software, on every core. For diagnosis.
    Disabled,
}

/// How a screen's picture is put together.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum RenderingMode {
    /// The video shown by the GPU as it was decoded, the slide drawn over it
    /// in a layer of its own, wherever a screen can be shown so; a whole
    /// picture drawn on the processor where it cannot.
    #[default]
    Automatic,
    /// As automatic. Kept apart so a later GPU compositor for the remaining
    /// cases has a place to be chosen.
    Gpu,
    /// Every picture drawn whole on the processor, as before layers: for
    /// telling whether a problem is in the layers.
    Compatibility,
}

/// What the app favours when it has a choice.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum PowerMode {
    /// Every screen checked as often as the frame rate allows.
    #[default]
    Performance,
    /// Anything drawn on the processor — transitions, scrolling messages,
    /// whole pictures — at no more than 30 frames a second, and still screens
    /// checked 30 times a second. A video still plays at its own rate.
    Efficiency,
}

/// The operator's projection settings, as saved.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct ProjectionSettings {
    pub preset: Preset,
    pub resolution: Resolution,
    pub frame_rate: FrameRate,
    pub video_quality: VideoQuality,
    pub hardware_decoding: HardwareDecoding,
    pub rendering: RenderingMode,
    pub power: PowerMode,
    /// Step the resolution, then the frame rate, down when the screens fall
    /// behind, and back up when they have kept up for a while (`adjust`).
    pub auto_adjust: bool,
}

impl Default for ProjectionSettings {
    fn default() -> Self {
        Self {
            preset: Preset::Highest,
            resolution: Resolution::R2160,
            frame_rate: FrameRate::Fps60,
            video_quality: VideoQuality::High,
            hardware_decoding: HardwareDecoding::Auto,
            rendering: RenderingMode::Automatic,
            power: PowerMode::Performance,
            auto_adjust: true,
        }
    }
}

impl Preset {
    /// The resolution and frame rate the preset stands for; `None` for
    /// `Custom`, which keeps what is set.
    pub fn targets(self) -> Option<(Resolution, FrameRate)> {
        Some(match self {
            Self::VeryLow => (Resolution::R720, FrameRate::Fps24),
            Self::Low => (Resolution::R1080, FrameRate::Fps30),
            Self::Medium => (Resolution::R1080, FrameRate::Adaptive),
            Self::Balanced => (Resolution::R1080, FrameRate::Fps60),
            Self::High => (Resolution::R1440, FrameRate::Fps60),
            Self::Highest => (Resolution::R2160, FrameRate::Fps60),
            Self::Custom => return None,
        })
    }
}

impl ProjectionSettings {
    /// With the preset's own resolution and frame rate, unless it is custom.
    pub fn normalised(mut self) -> Self {
        if let Some((resolution, frame_rate)) = self.preset.targets() {
            self.resolution = resolution;
            self.frame_rate = frame_rate;
        }
        self
    }

    /// Whether screens may be drawn as layers (`surface::layered`).
    pub fn layers_allowed(&self) -> bool {
        self.rendering != RenderingMode::Compatibility
    }

    /// The resolution and frame rate in force: the operator's, stepped down
    /// by the automatic adjustment while it has stepped them down.
    pub fn effective(&self) -> (Resolution, FrameRate) {
        if !self.auto_adjust {
            return (self.resolution, self.frame_rate);
        }
        adjust::apply(self.resolution, self.frame_rate)
    }

    /// The largest picture a screen of `size` is drawn at: its own size, or
    /// as large as fits inside the resolution in force, its shape kept.
    pub fn canvas_for(&self, size: (u32, u32)) -> (u32, u32) {
        let Some(cap) = self.effective().0.size() else {
            return size;
        };
        // The cap is a landscape box; a portrait screen is capped by the
        // same number of pixels on its long side.
        let cap = if size.1 > size.0 { (cap.1, cap.0) } else { cap };
        if size.0 <= cap.0 && size.1 <= cap.1 {
            return size;
        }
        crate::services::video::contain_size(size, cap)
    }

    /// How long a screen waits between ticks: `busy` when something on it
    /// moves — a playing video, a transition, a scrolling message.
    pub fn tick(&self, busy: bool) -> Duration {
        let (most, least) = self.effective().1.bounds();
        let mut rate = if busy { most } else { least };
        if self.power == PowerMode::Efficiency {
            rate = rate.min(30);
        }
        Duration::from_secs_f64(1.0 / f64::from(rate.max(1)))
    }
}

static SETTINGS: RwLock<Option<ProjectionSettings>> = RwLock::new(None);
static PATH: RwLock<Option<PathBuf>> = RwLock::new(None);

const FILE: &str = "projection.json";

/// The settings in force: the operator's, or the defaults before any are
/// loaded.
pub fn settings() -> ProjectionSettings {
    SETTINGS
        .read()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
        .unwrap_or_default()
}

/// Load the saved settings from `config_dir`, at start.
pub fn load(config_dir: &Path) -> ProjectionSettings {
    let path = config_dir.join(FILE);
    let loaded: ProjectionSettings =
        crate::state::persist::load_or_default(&path, "the projection settings");
    let loaded = loaded.normalised();
    *PATH
        .write()
        .unwrap_or_else(|poisoned| poisoned.into_inner()) = Some(path);
    *SETTINGS
        .write()
        .unwrap_or_else(|poisoned| poisoned.into_inner()) = Some(loaded);
    loaded
}

/// Put `settings` in force and save them.
pub fn set(settings: ProjectionSettings) -> crate::errors::AppResult<ProjectionSettings> {
    let settings = settings.normalised();
    *SETTINGS
        .write()
        .unwrap_or_else(|poisoned| poisoned.into_inner()) = Some(settings);
    adjust::reset();
    let path = PATH
        .read()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
        .clone();
    if let Some(path) = path {
        crate::state::persist::save_atomic(&path, &settings)?;
    }
    Ok(settings)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn each_preset_stands_for_its_row_of_the_table() {
        let row = |preset: Preset| {
            let settings = ProjectionSettings {
                preset,
                auto_adjust: false,
                ..ProjectionSettings::default()
            }
            .normalised();
            (settings.resolution.size(), settings.frame_rate.bounds())
        };
        assert_eq!(row(Preset::VeryLow), (Some((1280, 720)), (24, 24)));
        assert_eq!(row(Preset::Low), (Some((1920, 1080)), (30, 30)));
        assert_eq!(row(Preset::Medium), (Some((1920, 1080)), (60, 30)));
        assert_eq!(row(Preset::Balanced), (Some((1920, 1080)), (60, 60)));
        assert_eq!(row(Preset::High), (Some((2560, 1440)), (60, 60)));
        assert_eq!(row(Preset::Highest), (Some((3840, 2160)), (60, 60)));
    }

    #[test]
    fn a_custom_setting_keeps_what_was_chosen() {
        let custom = ProjectionSettings {
            preset: Preset::Custom,
            resolution: Resolution::R1440,
            frame_rate: FrameRate::Fps30,
            ..ProjectionSettings::default()
        }
        .normalised();
        assert_eq!(custom.resolution, Resolution::R1440);
        assert_eq!(custom.frame_rate, FrameRate::Fps30);
    }

    #[test]
    fn the_cap_shrinks_a_larger_screen_and_leaves_a_smaller_one() {
        let at = |resolution: Resolution, size: (u32, u32)| {
            ProjectionSettings {
                preset: Preset::Custom,
                resolution,
                auto_adjust: false,
                ..ProjectionSettings::default()
            }
            .canvas_for(size)
        };
        assert_eq!(at(Resolution::R1080, (3840, 2160)), (1920, 1080));
        assert_eq!(
            at(Resolution::R1080, (1280, 720)),
            (1280, 720),
            "never enlarged"
        );
        assert_eq!(
            at(Resolution::R1080, (1920, 1200)),
            (1728, 1080),
            "its shape kept"
        );
        assert_eq!(
            at(Resolution::R1080, (1080, 1920)),
            (1080, 1920),
            "a portrait screen"
        );
        assert_eq!(at(Resolution::Native, (5120, 2880)), (5120, 2880));
    }

    #[test]
    fn a_still_screen_is_checked_less_often_where_the_rate_allows() {
        let settings = |frame_rate: FrameRate, power: PowerMode| ProjectionSettings {
            preset: Preset::Custom,
            frame_rate,
            power,
            auto_adjust: false,
            ..ProjectionSettings::default()
        };
        let fps = |tick: Duration| (1.0 / tick.as_secs_f64()).round() as u32;
        let adaptive = settings(FrameRate::Adaptive, PowerMode::Performance);
        assert_eq!(
            (fps(adaptive.tick(true)), fps(adaptive.tick(false))),
            (60, 30)
        );
        let full = settings(FrameRate::Fps60, PowerMode::Performance);
        assert_eq!((fps(full.tick(true)), fps(full.tick(false))), (60, 60));
        let saving = settings(FrameRate::Fps60, PowerMode::Efficiency);
        assert_eq!((fps(saving.tick(true)), fps(saving.tick(false))), (30, 30));
    }

    #[test]
    fn saved_settings_from_an_older_build_load_with_defaults_for_the_rest() {
        let parsed: ProjectionSettings =
            serde_json::from_str(r#"{ "preset": "low" }"#).expect("parses");
        let parsed = parsed.normalised();
        assert_eq!(parsed.resolution, Resolution::R1080);
        assert_eq!(parsed.frame_rate, FrameRate::Fps30);
        assert_eq!(parsed.rendering, RenderingMode::Automatic);
    }
}
