//! A video file's pictures, decoded by FFmpeg, for a panel in the webview.
//!
//! The webview's `<video>` elements were WebKit decoding the files a second
//! (and third, and fourth) time: in the operator's center pane, on the stage
//! displays, behind the audience window until its native view had a frame, and
//! for video props. Each kept its own clock and chased the transport, and each
//! refused what WebKit does not open. Now each is a player here, decoding at
//! the size it is shown and handing back JPEGs for an `<img>`
//! (`state::media_frames_state`), the shape the operator's preview of the
//! audience screen already has (`services::preview`).
//!
//! A player keeps time one of three ways ([`Clock`]): with the scene, for the
//! video on screen; on its own, for the operator previewing a video before it
//! goes out; or looping from the start, for a prop.

use std::time::Instant;

use crate::services::media_protocol;
use crate::services::ndi::video_feed::{Opener, VideoFeed};
use crate::services::output::{MediaKind, OutputScene, VideoSettings};
use crate::services::video::VideoFrame;

/// How a player keeps time.
#[derive(Debug, Clone, PartialEq)]
pub enum Clock {
    /// With the scene, when the scene's video is this one — where the sound
    /// has it, as every screen has it (`sound::clock`). Any other video holds
    /// its first frame: it is not on screen, so it is not running.
    Scene,
    /// Its own: the operator previewing a video before it goes out. Was at
    /// `position` at `at`, running or held.
    Local {
        playing: bool,
        position: f64,
        at: Instant,
        looping: bool,
    },
    /// From the start, round and round: a prop.
    Loop,
}

/// One panel's video.
pub struct Player {
    pub url: String,
    pub clock: Clock,
    feed: VideoFeed,
}

impl Player {
    pub fn new(url: String, clock: Clock) -> Self {
        let feed = feed_for(&clock);
        Self { url, clock, feed }
    }

    /// Keep time a new way. A video that moves between following the
    /// screens and keeping its own time gets a decoder that does the same.
    pub fn set_clock(&mut self, clock: Clock) {
        if matches!(clock, Clock::Scene) != matches!(self.clock, Clock::Scene) {
            self.feed = feed_for(&clock);
        }
        self.clock = clock;
    }

    /// The scene this player's video is drawn from at `now`: its URL, and a
    /// clock as [`Clock`] says.
    pub fn scene(&self, live: &OutputScene, now: Instant) -> OutputScene {
        let (playing, seconds, looping) = match &self.clock {
            Clock::Scene if same_file(live.media_url.as_deref(), &self.url) => (
                live.is_video_playing,
                live.video_current_time,
                live.video_settings.loop_,
            ),
            Clock::Scene => (false, 0.0, false),
            Clock::Loop => (true, 0.0, true),
            Clock::Local {
                playing,
                position,
                at,
                looping,
            } => {
                let elapsed = if *playing {
                    now.saturating_duration_since(*at).as_secs_f64()
                } else {
                    0.0
                };
                (*playing, position + elapsed, *looping)
            }
        };
        OutputScene {
            media_url: Some(self.url.clone()),
            media_type: Some(MediaKind::Video),
            show_media: true,
            hide_background: false,
            is_video_playing: playing,
            video_current_time: seconds,
            video_settings: VideoSettings {
                loop_: looping,
                ..live.video_settings
            },
            ..OutputScene::default()
        }
    }

    /// The frame due at `now`, decoded to fit `size`. `None` while the video
    /// is opening, or if it will not.
    ///
    /// `now` may be ahead of the clock on the wall: a panel whose frames take
    /// a while to reach the screen asks for the one due when they get there.
    pub fn frame(
        &mut self,
        live: &OutputScene,
        now: Instant,
        size: (u32, u32),
        open: &Opener,
    ) -> Option<&VideoFrame> {
        let scene = self.scene(live, now);
        self.feed.frame_for(&scene, now, size, open)
    }
}

/// The decoder a clock needs: one that follows the sound for the screens'
/// video, and one that keeps its own time for anything else.
fn feed_for(clock: &Clock) -> VideoFeed {
    match clock {
        Clock::Scene => VideoFeed::new(),
        Clock::Local { .. } | Clock::Loop => VideoFeed::new().with_own_clock(),
    }
}

/// Whether two media URLs name the same file: the scene's and a panel's are
/// built in different places, and need not be spelled the same.
fn same_file(scene: Option<&str>, url: &str) -> bool {
    let Some(scene) = scene else {
        return false;
    };
    if scene == url {
        return true;
    }
    match (
        media_protocol::path_from_uri(scene),
        media_protocol::path_from_uri(url),
    ) {
        (Some(a), Some(b)) => a == b,
        _ => false,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::Duration;

    fn live(url: &str, playing: bool, seconds: f64) -> OutputScene {
        OutputScene {
            media_url: Some(url.into()),
            media_type: Some(MediaKind::Video),
            is_video_playing: playing,
            video_current_time: seconds,
            ..OutputScene::default()
        }
    }

    #[test]
    fn the_video_on_screen_keeps_the_screens_time() {
        let player = Player::new("local-media://media/a.mp4".into(), Clock::Scene);
        let scene = player.scene(
            &live("local-media://media/a.mp4", false, 42.0),
            Instant::now(),
        );
        assert!(!scene.is_video_playing);
        assert_eq!(scene.video_current_time, 42.0);
    }

    #[test]
    fn a_video_not_on_screen_holds_its_first_frame() {
        let player = Player::new("local-media://media/b.mp4".into(), Clock::Scene);
        let scene = player.scene(
            &live("local-media://media/a.mp4", true, 42.0),
            Instant::now(),
        );
        assert!(
            !scene.is_video_playing,
            "only the operator starts a video that is not live"
        );
        assert_eq!(scene.video_current_time, 0.0);
        assert_eq!(
            scene.media_url.as_deref(),
            Some("local-media://media/b.mp4")
        );
    }

    #[test]
    fn the_screens_video_is_found_however_its_url_is_spelled() {
        let player = Player::new(
            "local-media://media/Users/me/My%20Clip.mp4".into(),
            Clock::Scene,
        );
        let scene = player.scene(
            &live("local-media://media/Users/me/My Clip.mp4", true, 7.0),
            Instant::now(),
        );
        assert!(scene.is_video_playing);
        assert_eq!(scene.video_current_time, 7.0);
    }

    #[test]
    fn a_preview_runs_on_its_own_clock() {
        let at = Instant::now();
        let player = Player::new(
            "local-media://media/b.mp4".into(),
            Clock::Local {
                playing: true,
                position: 10.0,
                at,
                looping: false,
            },
        );
        let scene = player.scene(&OutputScene::default(), at + Duration::from_secs(3));
        assert!((scene.video_current_time - 13.0).abs() < 1e-6);
        assert!(scene.show_media && !scene.hide_background);
    }
}
