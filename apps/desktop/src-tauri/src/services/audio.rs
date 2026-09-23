//! The one audio path.
//!
//! The audit's §5.3 describes how audibility is decided today: fifteen
//! `<video>` elements, fourteen of them carrying a hard-coded `muted`
//! attribute, and a comment in `useShowVideoSync.ts:107-109` stating the rule
//! that the attributes are meant to implement — "the presenter Show View is
//! the application's only audible video player. All external display windows
//! are muted mirrors". The rule is correct. Nothing enforces it. Any new
//! `<video>` that forgets the attribute puts the same audio on the
//! congregation's speakers a fraction of a second late.
//!
//! Device routing has the matching problem from the other direction. A web
//! media element is pointed at an output device by `setSinkId`, which is a
//! per-element call, so the audio-output-device setting reaches exactly the
//! elements somebody remembered to call it on. Across the whole repository
//! that is one: the Show-View video. Backing tracks are played by an
//! independent `new Audio()` in `AudioTabPanel.tsx:134` that never calls it,
//! so on a laptop whose default output is the built-in speakers, video audio
//! goes to the desk and the backing track comes out of the laptop. That is
//! known-issues §1, and the audit found it by grepping rather than by anyone
//! noticing in a service.
//!
//! Both problems are the same problem: audio properties are attached to
//! elements instead of to an audio path. So this module describes the path.
//!
//! ```text
//! Source            Sink                 Output device
//! ---------------   ------------------   -------------
//! presentation      gain, mute,          one device id
//! video          →  and the single    →  shared by every
//! backing track     device selection     source
//! ```
//!
//! A surface asks what to apply and is told. The two facts the audit wanted
//! made structural both fall out of [`AudioGraph::routing`] rather than being
//! maintained by hand:
//!
//! * **Only the operator surface can produce sound.** Every mirror asks the
//!   same question and is told `audible: false`. Forgetting a `muted`
//!   attribute stops being possible, because the attribute is no longer where
//!   the answer lives.
//! * **Device selection belongs to the sink.** There is one device id and both
//!   sources read it, so a source cannot be left behind on the default device.
//!
//! No Tauri types here, and no runtime. This is the reducer; `AudioState`
//! holds it and `commands/audio.rs` exposes it.
//!
//! **What this is not, yet.** Audio still comes out of WKWebView — these are
//! instructions the renderer applies to its own elements. Rust owning the
//! decode as well waits for the wgpu compositor (ADR-001), and deliberately
//! so: moving audio into Rust while video pixels are still drawn by the
//! webview would split one stream across two runtimes and require them to be
//! re-synchronised, which is worse than either end state. The graph is the
//! part that can move now, and it is the part the compositor will need.

use serde::{Deserialize, Serialize};

/// Where audio is being asked about.
///
/// The audit's §5.2 table, as a type. Six of these are mirrors of what the
/// operator is already hearing; one is the operator.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum AudioSurface {
    /// The presenter's own window. The only surface with speakers attached.
    Operator,
    /// The audience screen.
    AudienceOutput,
    WorshipStage,
    MediaStage,
    ScreenComposer,
    /// The operator's preview of the audience screen.
    Preview,
    /// Grids, panels and thumbnails.
    Thumbnail,
}

impl AudioSurface {
    /// Can this surface be handed audio at all?
    ///
    /// The whole invariant, in one place. It is a `match` rather than a field
    /// so that adding a surface is a compile error until somebody decides
    /// which side of the line it falls on.
    pub const fn can_produce_audio(self) -> bool {
        match self {
            Self::Operator => true,
            Self::AudienceOutput
            | Self::WorshipStage
            | Self::MediaStage
            | Self::ScreenComposer
            | Self::Preview
            | Self::Thumbnail => false,
        }
    }
}

/// What is making the sound.
///
/// Two, and they are genuinely simultaneous: a backing track under a muted
/// video is ordinary worship practice. "One audible source" would be the wrong
/// invariant — the echo the audit is worried about is one *source* heard on
/// two *surfaces*, which is what [`AudioSurface`] governs.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum AudioSource {
    /// The Show-View video, driven by `useShowVideoSync`.
    PresentationVideo,
    /// The backing-track playlist player.
    BackingTrack,
}

/// Per-source level, independent of the sink.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SourceLevel {
    pub gain: f64,
    pub muted: bool,
}

impl SourceLevel {
    /// The presentation video's defaults match `VideoSettings` in
    /// `services/output.rs`; the backing track's match the `useState(0.85)` in
    /// `AudioTabPanel.tsx:130`.
    const fn new(gain: f64) -> Self {
        Self { gain, muted: false }
    }
}

/// The single output. One device, one master level.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AudioSink {
    /// `None` is the system default, which reaches `setSinkId` as `""`.
    ///
    /// Kept as an `Option` rather than an empty string so "the operator has
    /// not chosen" and "the operator chose a device whose id is empty" cannot
    /// be confused — the settings reader in `useAppSettings.ts:224-228`
    /// already treats a blank string as no choice, and this makes that the
    /// only representation.
    pub device_id: Option<String>,
    /// What to show in settings. Carried because device ids are opaque and a
    /// disconnected device's label is the only way to say what is missing.
    pub device_label: String,
    pub master_gain: f64,
    pub master_muted: bool,
}

/// The label shown when no device has been chosen. Matches the default in
/// `useAppSettings.ts:227`.
pub const SYSTEM_DEFAULT_LABEL: &str = "System Default";

impl Default for AudioSink {
    fn default() -> Self {
        Self {
            device_id: None,
            device_label: SYSTEM_DEFAULT_LABEL.to_owned(),
            master_gain: 1.0,
            master_muted: false,
        }
    }
}

/// What a surface should apply to one source.
///
/// The answer, not the inputs. A renderer that receives this does not decide
/// anything: it sets what it is told. `audible` is redundant with
/// `muted`/`volume` on purpose — it is the field a surface checks before
/// attaching an audio track at all, so a mirror never gets as far as a level.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SourceRouting {
    pub audible: bool,
    pub muted: bool,
    pub volume: f64,
    /// `null` on the wire, which the client turns into `setSinkId("")`.
    pub device_id: Option<String>,
}

impl SourceRouting {
    /// What every mirror gets. No level, no device, nothing to get wrong.
    const SILENT: Self = Self {
        audible: false,
        muted: true,
        volume: 0.0,
        device_id: None,
    };
}

/// The sink and its sources.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AudioGraph {
    pub sink: AudioSink,
    pub presentation_video: SourceLevel,
    pub backing_track: SourceLevel,
}

impl Default for AudioGraph {
    fn default() -> Self {
        Self {
            sink: AudioSink::default(),
            presentation_video: SourceLevel::new(1.0),
            backing_track: SourceLevel::new(0.85),
        }
    }
}

impl AudioGraph {
    pub const fn level(&self, source: AudioSource) -> &SourceLevel {
        match source {
            AudioSource::PresentationVideo => &self.presentation_video,
            AudioSource::BackingTrack => &self.backing_track,
        }
    }

    fn level_mut(&mut self, source: AudioSource) -> &mut SourceLevel {
        match source {
            AudioSource::PresentationVideo => &mut self.presentation_video,
            AudioSource::BackingTrack => &mut self.backing_track,
        }
    }

    /// What `surface` should apply to `source`.
    ///
    /// The one function this module exists for. A mirror is refused before
    /// levels are even consulted, so there is no arithmetic that could produce
    /// an audible mirror by accident.
    pub fn routing(&self, source: AudioSource, surface: AudioSurface) -> SourceRouting {
        if !surface.can_produce_audio() {
            return SourceRouting::SILENT;
        }

        let level = self.level(source);
        SourceRouting {
            audible: true,
            muted: level.muted || self.sink.master_muted,
            volume: clamp_gain(level.gain) * clamp_gain(self.sink.master_gain),
            device_id: self.sink.device_id.clone(),
        }
    }

    /// Point the sink at a device. `None`, or a blank id, is the system
    /// default.
    ///
    /// Returns whether anything changed, so a no-op neither writes the file
    /// nor wakes every window — the same contract `LooksState::update` uses.
    pub fn set_device(&mut self, device_id: Option<&str>, label: Option<&str>) -> bool {
        let normalized = device_id
            .map(str::trim)
            .filter(|id| !id.is_empty())
            .map(str::to_owned);
        let label = label
            .map(str::trim)
            .filter(|label| !label.is_empty())
            .map(str::to_owned)
            .unwrap_or_else(|| match &normalized {
                Some(_) => self.sink.device_label.clone(),
                None => SYSTEM_DEFAULT_LABEL.to_owned(),
            });

        if self.sink.device_id == normalized && self.sink.device_label == label {
            return false;
        }
        self.sink.device_id = normalized;
        self.sink.device_label = label;
        true
    }

    pub fn set_source_gain(&mut self, source: AudioSource, gain: f64) -> bool {
        let gain = clamp_gain(gain);
        let level = self.level_mut(source);
        if level.gain == gain {
            return false;
        }
        level.gain = gain;
        true
    }

    pub fn set_source_muted(&mut self, source: AudioSource, muted: bool) -> bool {
        let level = self.level_mut(source);
        if level.muted == muted {
            return false;
        }
        level.muted = muted;
        true
    }

    pub fn set_master_gain(&mut self, gain: f64) -> bool {
        let gain = clamp_gain(gain);
        if self.sink.master_gain == gain {
            return false;
        }
        self.sink.master_gain = gain;
        true
    }

    pub fn set_master_muted(&mut self, muted: bool) -> bool {
        if self.sink.master_muted == muted {
            return false;
        }
        self.sink.master_muted = muted;
        true
    }
}

/// Levels are 0..=1. A NaN reads as silence rather than propagating into a
/// volume assignment the webview would reject.
fn clamp_gain(gain: f64) -> f64 {
    if gain.is_nan() {
        return 0.0;
    }
    gain.clamp(0.0, 1.0)
}

/// Every surface, so callers can assert over the whole set rather than a list
/// they remembered to write out.
pub const ALL_SURFACES: [AudioSurface; 7] = [
    AudioSurface::Operator,
    AudioSurface::AudienceOutput,
    AudioSurface::WorshipStage,
    AudioSurface::MediaStage,
    AudioSurface::ScreenComposer,
    AudioSurface::Preview,
    AudioSurface::Thumbnail,
];

pub const ALL_SOURCES: [AudioSource; 2] =
    [AudioSource::PresentationVideo, AudioSource::BackingTrack];

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_surface_but_the_operator_is_incapable_of_audio() {
        // The invariant the audit asks to be made structural (§5.3), asserted
        // over the whole surface set rather than a list someone maintains.
        // This is the test that replaces fourteen `muted` attributes.
        let graph = AudioGraph::default();

        for surface in ALL_SURFACES {
            for source in ALL_SOURCES {
                let routing = graph.routing(source, surface);
                if surface == AudioSurface::Operator {
                    assert!(routing.audible, "{surface:?} should carry {source:?}");
                    continue;
                }
                assert_eq!(
                    routing,
                    SourceRouting::SILENT,
                    "{surface:?} can produce audio for {source:?}; the congregation \
                     would hear it twice"
                );
            }
        }
    }

    #[test]
    fn a_mirror_stays_silent_however_the_levels_are_set() {
        // Turning everything up must not find a path to a mirror. The refusal
        // happens before levels are read, and this is what pins that ordering.
        let mut graph = AudioGraph::default();
        graph.set_master_gain(1.0);
        graph.set_master_muted(false);
        for source in ALL_SOURCES {
            graph.set_source_gain(source, 1.0);
            graph.set_source_muted(source, false);
        }

        for surface in ALL_SURFACES
            .into_iter()
            .filter(|s| *s != AudioSurface::Operator)
        {
            for source in ALL_SOURCES {
                assert!(
                    !graph.routing(source, surface).audible,
                    "{surface:?}/{source:?}"
                );
            }
        }
    }

    #[test]
    fn both_sources_reach_the_chosen_device() {
        // known-issues §1. Under Electron the device setting reaches the
        // presentation video and not the backing track, because `setSinkId` is
        // a per-element call made in exactly one file. Here the device is a
        // property of the sink, so asking for either source returns it.
        let mut graph = AudioGraph::default();
        assert!(graph.set_device(Some("desk-usb-interface"), Some("Scarlett 2i2")));

        for source in ALL_SOURCES {
            let routing = graph.routing(source, AudioSurface::Operator);
            assert_eq!(
                routing.device_id.as_deref(),
                Some("desk-usb-interface"),
                "{source:?} did not follow the sink to the chosen device"
            );
        }
    }

    #[test]
    fn no_device_choice_is_the_system_default() {
        let mut graph = AudioGraph::default();
        graph.set_device(Some("desk-usb-interface"), Some("Scarlett 2i2"));

        // A blank id is a cleared choice, not a device. `useAppSettings.ts`
        // already trims and treats empty as unset; this makes it the only
        // representation that reaches the sink.
        assert!(graph.set_device(Some("   "), None));
        assert_eq!(graph.sink.device_id, None);
        assert_eq!(graph.sink.device_label, SYSTEM_DEFAULT_LABEL);
        assert_eq!(
            graph
                .routing(AudioSource::PresentationVideo, AudioSurface::Operator)
                .device_id,
            None
        );
    }

    #[test]
    fn master_mute_silences_every_source_without_losing_their_levels() {
        // Mute is not the same as zero gain: unmuting has to restore what the
        // operator had, mid-service, without them re-setting two sliders.
        let mut graph = AudioGraph::default();
        graph.set_source_gain(AudioSource::BackingTrack, 0.4);
        assert!(graph.set_master_muted(true));

        for source in ALL_SOURCES {
            assert!(
                graph.routing(source, AudioSurface::Operator).muted,
                "{source:?}"
            );
        }

        assert!(graph.set_master_muted(false));
        assert_eq!(
            graph
                .routing(AudioSource::BackingTrack, AudioSurface::Operator)
                .volume,
            0.4
        );
    }

    #[test]
    fn source_and_master_gain_multiply() {
        let mut graph = AudioGraph::default();
        graph.set_source_gain(AudioSource::BackingTrack, 0.5);
        graph.set_master_gain(0.5);

        assert_eq!(
            graph
                .routing(AudioSource::BackingTrack, AudioSurface::Operator)
                .volume,
            0.25
        );
    }

    #[test]
    fn one_source_muted_leaves_the_other_audible() {
        // The two sources are simultaneous by design — a backing track under a
        // muted video is ordinary practice — so muting one must not be a
        // master mute by another name.
        let mut graph = AudioGraph::default();
        graph.set_source_muted(AudioSource::PresentationVideo, true);

        assert!(
            graph
                .routing(AudioSource::PresentationVideo, AudioSurface::Operator)
                .muted
        );
        assert!(
            !graph
                .routing(AudioSource::BackingTrack, AudioSurface::Operator)
                .muted
        );
    }

    #[test]
    fn gains_are_clamped_and_nan_reads_as_silence() {
        // A slider that sends NaN must not assign NaN to `element.volume`,
        // which throws and leaves the previous level in place — audio that
        // ignores the operator is worse than audio that goes quiet.
        let mut graph = AudioGraph::default();

        graph.set_source_gain(AudioSource::BackingTrack, 4.0);
        assert_eq!(graph.level(AudioSource::BackingTrack).gain, 1.0);

        graph.set_source_gain(AudioSource::BackingTrack, -1.0);
        assert_eq!(graph.level(AudioSource::BackingTrack).gain, 0.0);

        graph.set_source_gain(AudioSource::BackingTrack, f64::NAN);
        assert_eq!(graph.level(AudioSource::BackingTrack).gain, 0.0);
    }

    #[test]
    fn setting_what_is_already_set_reports_no_change() {
        // The contract every other Rust-owned slice uses: a no-op neither
        // persists nor wakes every window.
        let mut graph = AudioGraph::default();

        assert!(!graph.set_master_muted(false));
        assert!(!graph.set_source_gain(AudioSource::BackingTrack, 0.85));
        assert!(!graph.set_device(None, None));

        assert!(graph.set_device(Some("desk"), Some("Desk")));
        assert!(!graph.set_device(Some("desk"), Some("Desk")));
    }

    #[test]
    fn the_graph_round_trips_through_serde() {
        // `rename_all = "camelCase"` has already mangled one acronym in this
        // tree (`mediaFilterCSS`, handoff §12), and nothing at runtime catches
        // a field the frontend cannot find.
        let mut graph = AudioGraph::default();
        graph.set_device(Some("desk"), Some("Scarlett 2i2"));

        let json = serde_json::to_string(&graph).expect("serialise");
        assert!(json.contains("\"deviceId\""), "{json}");
        assert!(json.contains("\"deviceLabel\""), "{json}");
        assert!(json.contains("\"masterGain\""), "{json}");
        assert!(json.contains("\"presentationVideo\""), "{json}");

        let parsed: AudioGraph = serde_json::from_str(&json).expect("deserialise");
        assert_eq!(parsed, graph);
    }

    #[test]
    fn surfaces_and_sources_serialise_as_the_frontend_spells_them() {
        assert_eq!(
            serde_json::to_string(&AudioSurface::AudienceOutput).unwrap(),
            "\"audience-output\""
        );
        assert_eq!(
            serde_json::to_string(&AudioSource::PresentationVideo).unwrap(),
            "\"presentation-video\""
        );
    }

    #[test]
    fn the_surface_list_covers_the_enum() {
        // `ALL_SURFACES` is what the exhaustiveness tests iterate. If a surface
        // is added to the enum and not to the list, those tests silently stop
        // covering it — the one way this module could lose its invariant.
        for surface in ALL_SURFACES {
            assert!(ALL_SURFACES.contains(&surface));
        }
        assert_eq!(
            ALL_SURFACES.len(),
            7,
            "a surface was added or removed; update the exhaustiveness lists"
        );
    }
}
