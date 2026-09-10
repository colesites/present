//! Where a video is up to, and whether it is running.
//!
//! Today this lives in React refs inside `useShowVideoSync.ts`, and the shape
//! of the problem is visible in the two of them that matter:
//! `showPlaybackByMediaIdRef` and `showTimeByMediaIdRef`. They remember, per
//! media item, whether it was playing and where it had got to, so that an
//! operator who steps away to another item and comes back resumes instead of
//! restarting. That is domain behaviour — an operator mid-service relies on it
//! — held in a ref that dies with the component and is invisible to every other
//! window.
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

use std::collections::HashMap;

use serde::{Deserialize, Serialize};

/// How far the operator's own player may drift before it is corrected.
/// `useShowVideoSync.ts:141`.
pub const OPERATOR_DRIFT_TOLERANCE: f64 = 0.5;

/// How far a mirror may drift. `OutputWindow.tsx:437`.
pub const MIRROR_DRIFT_TOLERANCE: f64 = 0.12;

/// What is remembered about one media item between visits.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ResumePoint {
    pub position_seconds: f64,
    pub was_playing: bool,
}

/// The transport.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct MediaPlayback {
    /// The item the operator is on, if it is a video.
    pub media_id: Option<String>,
    pub playing: bool,
    pub position_seconds: f64,
    /// `None` until the element reports it. Nothing may be inferred from its
    /// absence — a video whose duration is unknown is still playable.
    pub duration_seconds: Option<f64>,

    /// Per-item resume points, replacing the two React refs.
    ///
    /// Keyed by media id and bounded only by how many videos one service
    /// touches, which is dozens. Cleared with the deck rather than pruned.
    #[serde(default)]
    pub resume: HashMap<String, ResumePoint>,
}

impl MediaPlayback {
    /// Move to a media item, restoring where it was left.
    ///
    /// `auto_play` is the operator's "advance and play" gesture and wins over a
    /// remembered pause: they asked for it to run now.
    ///
    /// Returns whether anything changed.
    pub fn select_media(&mut self, media_id: Option<&str>, auto_play: bool) -> bool {
        let previous = self.snapshot_current();

        let next_id = media_id.map(str::to_owned);
        if self.media_id == next_id && !auto_play {
            return false;
        }

        // Remember where the outgoing item was before leaving it.
        if let Some(point) = previous {
            self.resume.insert(point.0, point.1);
        }

        self.media_id = next_id;
        self.duration_seconds = None;

        let resumed = self
            .media_id
            .as_ref()
            .and_then(|id| self.resume.get(id).copied())
            .unwrap_or_default();

        self.position_seconds = resumed.position_seconds;
        self.playing = auto_play || resumed.was_playing;
        true
    }

    fn snapshot_current(&self) -> Option<(String, ResumePoint)> {
        let id = self.media_id.clone()?;
        Some((
            id,
            ResumePoint {
                position_seconds: self.position_seconds,
                was_playing: self.playing,
            },
        ))
    }

    pub fn play(&mut self) -> bool {
        self.set_playing(true)
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
        true
    }

    fn set_playing(&mut self, playing: bool) -> bool {
        if self.media_id.is_none() || self.playing == playing {
            return false;
        }
        self.playing = playing;
        true
    }

    /// Stop and return to the start, forgetting where this item was.
    pub fn stop(&mut self) -> bool {
        if self.media_id.is_none() {
            return false;
        }
        if let Some(id) = &self.media_id {
            self.resume.remove(id);
        }
        self.playing = false;
        self.position_seconds = 0.0;
        true
    }

    /// Move to a position. The operator's gesture, so it is authoritative.
    pub fn seek(&mut self, position_seconds: f64) -> bool {
        if self.media_id.is_none() {
            return false;
        }
        let clamped = self.clamp_position(position_seconds);
        if self.position_seconds == clamped {
            return false;
        }
        self.position_seconds = clamped;
        true
    }

    /// The element saying where it actually is.
    ///
    /// Distinct from [`seek`](Self::seek) on purpose: a report is an
    /// observation and a seek is an instruction. Collapsing them is how a
    /// stale sample from a mirror ends up dragging the operator's playhead
    /// backwards.
    pub fn report_position(&mut self, position_seconds: f64) -> bool {
        if self.media_id.is_none() || !position_seconds.is_finite() {
            return false;
        }
        let clamped = self.clamp_position(position_seconds);
        if self.position_seconds == clamped {
            return false;
        }
        self.position_seconds = clamped;
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
    fn coming_back_to_an_item_resumes_where_it_was_left() {
        // The behaviour the two React refs exist for, and the reason this is
        // worth moving: an operator who steps to another item mid-video and
        // comes back must not restart it in front of the congregation.
        let mut playback = on_video("bumper");
        playback.play();
        playback.report_position(42.0);

        playback.select_media(Some("countdown"), false);
        assert_eq!(
            playback.position_seconds, 0.0,
            "the new item starts at its own place"
        );

        playback.select_media(Some("bumper"), false);
        assert_eq!(playback.position_seconds, 42.0);
        assert!(playback.playing, "it was running when it was left");
    }

    #[test]
    fn a_paused_item_comes_back_paused() {
        let mut playback = on_video("bumper");
        playback.play();
        playback.report_position(10.0);
        playback.pause();

        playback.select_media(Some("countdown"), false);
        playback.select_media(Some("bumper"), false);

        assert_eq!(playback.position_seconds, 10.0);
        assert!(!playback.playing);
    }

    #[test]
    fn advance_and_play_beats_a_remembered_pause() {
        // `shouldAutoPlay` is the operator asking for it to run *now*.
        let mut playback = on_video("bumper");
        playback.report_position(10.0);
        playback.pause();
        playback.select_media(Some("countdown"), false);

        playback.select_media(Some("bumper"), true);
        assert!(playback.playing);
        assert_eq!(
            playback.position_seconds, 10.0,
            "auto-play resumes, it does not rewind"
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
        assert!(!playback.seek(10.0));
        assert!(!playback.report_position(10.0));
        assert!(!playback.ended(true));
        assert_eq!(playback, MediaPlayback::default());
    }

    #[test]
    fn stopping_forgets_the_resume_point() {
        // Stop is "start this again", which is different from pause.
        let mut playback = on_video("bumper");
        playback.play();
        playback.report_position(42.0);

        assert!(playback.stop());
        assert_eq!(playback.position_seconds, 0.0);
        assert!(!playback.playing);

        playback.select_media(Some("countdown"), false);
        playback.select_media(Some("bumper"), false);
        assert_eq!(playback.position_seconds, 0.0, "stop cleared the memory");
    }

    #[test]
    fn a_position_is_clamped_to_the_duration_once_it_is_known() {
        let mut playback = on_video("bumper");
        playback.set_duration(Some(30.0));

        playback.seek(45.0);
        assert_eq!(playback.position_seconds, 30.0);

        playback.seek(-5.0);
        assert_eq!(playback.position_seconds, 0.0);
    }

    #[test]
    fn an_unknown_duration_does_not_cap_the_position() {
        // A stream, or an element that has not reported yet. Capping at zero
        // here would pin the playhead to the start of every such video.
        let mut playback = on_video("stream");
        assert!(playback.seek(45.0));
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
        playback.report_position(20.0);

        assert!(!playback.report_position(f64::NAN));
        assert_eq!(playback.position_seconds, 20.0);
    }

    #[test]
    fn ending_loops_or_stops_according_to_the_setting() {
        let mut playback = on_video("bumper");
        playback.play();
        playback.report_position(29.0);

        assert!(playback.ended(true));
        assert_eq!(playback.position_seconds, 0.0);
        assert!(playback.playing, "a looping video keeps running");

        playback.report_position(29.0);
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
        playback.report_position(12.5);
        playback.set_duration(Some(30.0));
        playback.select_media(Some("countdown"), false);

        let json = serde_json::to_string(&playback).expect("serialise");
        assert!(json.contains("\"mediaId\""), "{json}");
        assert!(json.contains("\"positionSeconds\""), "{json}");
        assert!(json.contains("\"durationSeconds\""), "{json}");

        let parsed: MediaPlayback = serde_json::from_str(&json).expect("deserialise");
        assert_eq!(parsed, playback);
        assert_eq!(
            parsed.resume.get("bumper").map(|r| r.position_seconds),
            Some(12.5)
        );
    }
}
