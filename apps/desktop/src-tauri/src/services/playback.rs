//! Where a video is up to, and whether it is running.
//!
//! **A video chosen again starts from the beginning** (owner, 2026-09-15).
//! Electron's `useShowVideoSync.ts` kept a resume point per media item in two
//! refs, and this transport first carried them over — for the whole service
//! rather than until the component remounted, which made it resume far more
//! often. Choosing a video in the media panel should play it from the start.
//! What still holds its place is the video already selected: selecting it
//! again, or a window reloading, does not rewind it.
//!
//! The position itself is sampled from the `<video>` element at roughly 10 Hz
//! and pushed through the scene, which makes the *element* the source of truth
//! and everything else a follower reconstructing it (audit §5.5). Here the
//! transport owns the answer and the element reports to it.
//!
//! **The two drift thresholds are different on purpose**, and the audit's §5.5
//! records only one of them. The operator's own player is corrected at 0.5 s
//! (`useShowVideoSync.ts:141`) because seeking under the hands of somebody
//! scrubbing is worse than being slightly out. The audience mirror is corrected
//! at 0.12 s (`OutputWindow.tsx:437`) because nobody is touching it and it has
//! to stay locked to what the operator hears. Both are kept, named, and tested,
//! rather than collapsed into one number that would be wrong for one of them.
//!
//! No Tauri types and no timer. This is the reducer; the element still decodes.
//! Rust owning the decode waits for the compositor, for the reason in
//! `services::audio`: splitting one stream across two runtimes would mean
//! re-synchronising them.

use serde::{Deserialize, Serialize};

/// How far the operator's own player may drift before it is corrected.
/// `useShowVideoSync.ts:141`.
pub const OPERATOR_DRIFT_TOLERANCE: f64 = 0.5;

/// How far a mirror may drift. `OutputWindow.tsx:437`.
pub const MIRROR_DRIFT_TOLERANCE: f64 = 0.12;

/// The slowest and fastest a video plays: what the sound's tempo keeps its
/// pitch through (`sound/decoder.rs`).
pub const SLOWEST: f64 = 0.5;
pub const FASTEST: f64 = 2.0;

/// The transport.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MediaPlayback {
    /// The item the operator is on, if it is a video.
    pub media_id: Option<String>,
    pub playing: bool,
    pub position_seconds: f64,
    /// `None` until the element reports it. Nothing may be inferred from its
    /// absence — a video whose duration is unknown is still playable.
    pub duration_seconds: Option<f64>,
    /// When the element was at `position_seconds`, in milliseconds since the
    /// Unix epoch — the same clock in every window. A mirror adds the time
    /// since then while the video runs, rather than chasing a position that
    /// was already behind by the time it arrived. `None` when the position was
    /// set rather than observed (a new item, a stop, play or pause).
    #[serde(default)]
    pub position_sampled_at_ms: Option<f64>,
    /// How fast it plays: 1 as recorded. The sound and every picture keep it.
    #[serde(default = "normal_rate")]
    pub rate: f64,
}

fn normal_rate() -> f64 {
    1.0
}

impl Default for MediaPlayback {
    fn default() -> Self {
        Self {
            media_id: None,
            playing: false,
            position_seconds: 0.0,
            duration_seconds: None,
            position_sampled_at_ms: None,
            rate: 1.0,
        }
    }
}

impl MediaPlayback {
    /// Move to a media item, from its beginning.
    ///
    /// `auto_play` is the operator's "advance and play" gesture: the item
    /// starts running. The item already selected keeps its place — `auto_play`
    /// on it only starts it.
    ///
    /// Returns whether anything changed.
    pub fn select_media(&mut self, media_id: Option<&str>, auto_play: bool) -> bool {
        let next_id = media_id.map(str::to_owned);
        if self.media_id == next_id {
            if auto_play && self.media_id.is_some() {
                return self.set_playing(true);
            }
            return false;
        }

        self.media_id = next_id;
        self.duration_seconds = None;
        self.position_seconds = 0.0;
        self.position_sampled_at_ms = None;
        self.playing = auto_play && self.media_id.is_some();
        true
    }

    pub fn play(&mut self) -> bool {
        self.set_playing(true)
    }

    /// Play faster or slower, within [`SLOWEST`] and [`FASTEST`]. It stays
    /// at that rate from video to video, as a player's speed does.
    pub fn set_rate(&mut self, rate: f64) -> bool {
        let rate = if rate.is_finite() {
            rate.clamp(SLOWEST, FASTEST)
        } else {
            1.0
        };
        if (self.rate - rate).abs() < 1e-6 {
            return false;
        }
        self.rate = rate;
        // A sample taken at the old rate would be extrapolated at the new one.
        self.position_sampled_at_ms = None;
        true
    }

    pub fn pause(&mut self) -> bool {
        self.set_playing(false)
    }

    pub fn toggle(&mut self) -> bool {
        // Refuses rather than guessing when there is nothing loaded, the same
        // way slide navigation does (`services::presentation`).
        if self.media_id.is_none() {
            return false;
        }
        self.playing = !self.playing;
        self.position_sampled_at_ms = None;
        true
    }

    fn set_playing(&mut self, playing: bool) -> bool {
        if self.media_id.is_none() || self.playing == playing {
            return false;
        }
        self.playing = playing;
        // The last sample was taken while the state was the other one; carried
        // across a pause it would have a mirror jump ahead by the pause.
        self.position_sampled_at_ms = None;
        true
    }

    /// Stop and return to the start.
    pub fn stop(&mut self) -> bool {
        if self.media_id.is_none() {
            return false;
        }
        self.playing = false;
        self.position_seconds = 0.0;
        self.position_sampled_at_ms = None;
        true
    }

    /// Move to a position. The operator's gesture, so it is authoritative.
    pub fn seek(&mut self, position_seconds: f64, sampled_at_ms: Option<f64>) -> bool {
        if self.media_id.is_none() {
            return false;
        }
        let clamped = self.clamp_position(position_seconds);
        if self.position_seconds == clamped {
            return false;
        }
        self.position_seconds = clamped;
        self.position_sampled_at_ms = sampled_at_ms.filter(|value| value.is_finite());
        true
    }

    /// The element saying where it actually is.
    ///
    /// Distinct from [`seek`](Self::seek) on purpose: a report is an
    /// observation and a seek is an instruction. Collapsing them is how a
    /// stale sample from a mirror ends up dragging the operator's playhead
    /// backwards.
    pub fn report_position(&mut self, position_seconds: f64, sampled_at_ms: Option<f64>) -> bool {
        if self.media_id.is_none() || !position_seconds.is_finite() {
            return false;
        }
        let clamped = self.clamp_position(position_seconds);
        if self.position_seconds == clamped {
            return false;
        }
        self.position_seconds = clamped;
        self.position_sampled_at_ms = sampled_at_ms.filter(|value| value.is_finite());
        true
    }

    pub fn set_duration(&mut self, duration_seconds: Option<f64>) -> bool {
        let sanitised = duration_seconds.filter(|value| value.is_finite() && *value > 0.0);
        if self.duration_seconds == sanitised {
            return false;
        }
        self.duration_seconds = sanitised;
        true
    }

    /// The item ended. With loop on it returns to the start and keeps running,
    /// which is what `VideoSettings::loop_` means on the scene.
    pub fn ended(&mut self, looping: bool) -> bool {
        if self.media_id.is_none() {
            return false;
        }
        self.position_seconds = 0.0;
        self.position_sampled_at_ms = None;
        self.playing = looping;
        true
    }

    /// Forget everything. Called when the deck changes under the operator.
    pub fn clear(&mut self) -> bool {
        if *self == Self::default() {
            return false;
        }
        *self = Self::default();
        true
    }

    fn clamp_position(&self, position_seconds: f64) -> f64 {
        if !position_seconds.is_finite() {
            return 0.0;
        }
        let floored = position_seconds.max(0.0);
        match self.duration_seconds {
            Some(duration) => floored.min(duration),
            None => floored,
        }
    }
}

/// Should a surface at `element_position` seek to `target`?
///
/// The one rule both drift thresholds feed, so a caller picks a tolerance
/// rather than reimplementing the comparison. A non-finite reading never
/// triggers a seek: an element that has not loaded reports `NaN`, and seeking
/// to it would throw.
pub fn needs_seek(element_position: f64, target: f64, tolerance: f64) -> bool {
    if !element_position.is_finite() || !target.is_finite() {
        return false;
    }
    (element_position - target).abs() > tolerance
}

#[cfg(test)]
mod tests {
    use super::*;

    fn on_video(id: &str) -> MediaPlayback {
        let mut playback = MediaPlayback::default();
        playback.select_media(Some(id), false);
        playback
    }

    #[test]
    fn a_video_chosen_again_starts_from_the_beginning() {
        // The owner's call: choosing a video plays it from the start, however
        // far it got last time and whether or not it was running.
        let mut playback = on_video("bumper");
        playback.play();
        playback.report_position(42.0, None);

        playback.select_media(Some("countdown"), false);
        assert_eq!(playback.position_seconds, 0.0);
        assert!(!playback.playing, "a new item waits to be played");

        playback.select_media(Some("bumper"), false);
        assert_eq!(playback.position_seconds, 0.0);
        assert!(!playback.playing);
    }

    #[test]
    fn advance_and_play_starts_the_new_item_running_from_the_start() {
        let mut playback = on_video("bumper");
        playback.report_position(10.0, None);

        assert!(playback.select_media(Some("countdown"), true));
        assert!(playback.playing);
        assert_eq!(playback.position_seconds, 0.0);
    }

    #[test]
    fn the_item_already_selected_keeps_its_place() {
        // A window reloading or the panel re-rendering selects the same item
        // again; that must not rewind it in front of the congregation.
        let mut playback = on_video("bumper");
        playback.play();
        playback.report_position(42.0, None);

        assert!(!playback.select_media(Some("bumper"), false));
        assert_eq!(playback.position_seconds, 42.0);
        assert!(playback.playing);

        playback.pause();
        assert!(
            playback.select_media(Some("bumper"), true),
            "play starts it"
        );
        assert_eq!(playback.position_seconds, 42.0, "without rewinding");
        assert!(!playback.select_media(Some("bumper"), true));
        assert!(
            !MediaPlayback::default().select_media(None, true),
            "nothing to start"
        );
    }

    #[test]
    fn nothing_transports_when_no_media_is_loaded() {
        // Bounded rather than guessing, like slide navigation.
        let mut playback = MediaPlayback::default();

        assert!(!playback.play());
        assert!(!playback.pause());
        assert!(!playback.toggle());
        assert!(!playback.stop());
        assert!(!playback.seek(10.0, None));
        assert!(!playback.report_position(10.0, None));
        assert!(!playback.ended(true));
        assert_eq!(playback, MediaPlayback::default());
    }

    #[test]
    fn an_observed_position_keeps_when_it_was_seen_and_a_set_one_does_not() {
        let mut playback = on_video("bumper");
        playback.play();
        assert!(playback.report_position(4.0, Some(1_000.0)));
        assert_eq!(playback.position_sampled_at_ms, Some(1_000.0));

        playback.pause();
        assert_eq!(
            playback.position_sampled_at_ms, None,
            "carried across a pause it would jump a mirror ahead"
        );
        playback.seek(9.0, Some(2_000.0));
        assert_eq!(playback.position_sampled_at_ms, Some(2_000.0));
        playback.report_position(9.5, Some(f64::NAN));
        assert_eq!(
            playback.position_sampled_at_ms, None,
            "a nonsense time is not kept"
        );

        playback.select_media(Some("countdown"), false);
        assert_eq!(playback.position_sampled_at_ms, None);
    }

    #[test]
    fn stopping_returns_to_the_start() {
        // Stop is "start this again", which is different from pause.
        let mut playback = on_video("bumper");
        playback.play();
        playback.report_position(42.0, None);

        assert!(playback.stop());
        assert_eq!(playback.position_seconds, 0.0);
        assert!(!playback.playing);
    }

    #[test]
    fn a_position_is_clamped_to_the_duration_once_it_is_known() {
        let mut playback = on_video("bumper");
        playback.set_duration(Some(30.0));

        playback.seek(45.0, None);
        assert_eq!(playback.position_seconds, 30.0);

        playback.seek(-5.0, None);
        assert_eq!(playback.position_seconds, 0.0);
    }

    #[test]
    fn an_unknown_duration_does_not_cap_the_position() {
        // A stream, or an element that has not reported yet. Capping at zero
        // here would pin the playhead to the start of every such video.
        let mut playback = on_video("stream");
        assert!(playback.seek(45.0, None));
        assert_eq!(playback.position_seconds, 45.0);
    }

    #[test]
    fn a_nonsense_duration_is_refused_rather_than_stored() {
        // `video.duration` is NaN until metadata loads and Infinity for a live
        // stream. Storing either would clamp every later seek to nonsense.
        let mut playback = on_video("bumper");

        assert!(!playback.set_duration(Some(f64::NAN)));
        assert!(!playback.set_duration(Some(f64::INFINITY)));
        assert!(!playback.set_duration(Some(0.0)));
        assert_eq!(playback.duration_seconds, None);

        assert!(playback.set_duration(Some(30.0)));
        assert_eq!(playback.duration_seconds, Some(30.0));
    }

    #[test]
    fn a_non_finite_report_is_ignored() {
        // An element that has not loaded reports NaN. Taking it would move the
        // playhead to zero and drag every mirror with it.
        let mut playback = on_video("bumper");
        playback.report_position(20.0, None);

        assert!(!playback.report_position(f64::NAN, None));
        assert_eq!(playback.position_seconds, 20.0);
    }

    #[test]
    fn ending_loops_or_stops_according_to_the_setting() {
        let mut playback = on_video("bumper");
        playback.play();
        playback.report_position(29.0, None);

        assert!(playback.ended(true));
        assert_eq!(playback.position_seconds, 0.0);
        assert!(playback.playing, "a looping video keeps running");

        playback.report_position(29.0, None);
        assert!(playback.ended(false));
        assert!(!playback.playing);
    }

    #[test]
    fn the_two_drift_tolerances_stay_different() {
        // The audit's §5.5 records only one of them. The operator's player is
        // corrected loosely so scrubbing is not fought; the audience mirror is
        // corrected tightly because nothing is touching it and it has to stay
        // locked to what the operator hears.
        // A const block, so the relationship is a compile error rather than
        // a test failure: the two tolerances existing in the wrong order would
        // mean the audience screen was corrected more loosely than the player
        // nobody is touching.
        const { assert!(MIRROR_DRIFT_TOLERANCE < OPERATOR_DRIFT_TOLERANCE) };

        // A third of a second out: the mirror corrects, the operator does not.
        assert!(needs_seek(10.0, 10.33, MIRROR_DRIFT_TOLERANCE));
        assert!(!needs_seek(10.0, 10.33, OPERATOR_DRIFT_TOLERANCE));
    }

    #[test]
    fn a_surface_already_in_step_is_left_alone() {
        // Seeking a video that is already right is an audible stutter on the
        // audience screen, so the tolerance is a floor and not a target.
        assert!(!needs_seek(10.0, 10.0, MIRROR_DRIFT_TOLERANCE));
        assert!(!needs_seek(10.0, 10.1, MIRROR_DRIFT_TOLERANCE));
        assert!(needs_seek(10.0, 10.2, MIRROR_DRIFT_TOLERANCE));
    }

    #[test]
    fn an_unloaded_element_is_never_seeked() {
        assert!(!needs_seek(f64::NAN, 10.0, MIRROR_DRIFT_TOLERANCE));
        assert!(!needs_seek(10.0, f64::NAN, MIRROR_DRIFT_TOLERANCE));
    }

    #[test]
    fn a_no_op_reports_no_change() {
        let mut playback = on_video("bumper");
        playback.play();

        assert!(!playback.play());
        assert!(!playback.select_media(Some("bumper"), false));
        assert!(playback.select_media(Some("other"), false));
    }

    #[test]
    fn the_transport_round_trips_through_serde() {
        let mut playback = on_video("bumper");
        playback.play();
        playback.report_position(12.5, None);
        playback.set_duration(Some(30.0));

        let json = serde_json::to_string(&playback).expect("serialise");
        assert!(json.contains("\"mediaId\""), "{json}");
        assert!(json.contains("\"positionSeconds\""), "{json}");
        assert!(json.contains("\"durationSeconds\""), "{json}");

        let parsed: MediaPlayback = serde_json::from_str(&json).expect("deserialise");
        assert_eq!(parsed, playback);
    }
}
