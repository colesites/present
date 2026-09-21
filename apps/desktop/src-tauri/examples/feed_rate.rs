//! How many distinct frames a `VideoFeed` gives back when it is polled the way
//! the preview polls it.
//!
//! `cargo run --example feed_rate -- /path/to/file.mp4 [polls-per-second]`
//!
//! The decoder can do a hundred frames a second and the preview's loop turns
//! fifty-five times a second, and the picture still only changed fourteen
//! times a second. This is the piece in between.

use std::sync::Arc;
use std::time::{Duration, Instant};

use present_lib::services::ndi::video_feed::{Opener, VideoFeed};
use present_lib::services::output::{MediaKind, OutputScene, VideoSettings};
use present_lib::services::video;

fn main() {
    let mut args = std::env::args().skip(1);
    let Some(path) = args.next() else {
        eprintln!("usage: feed_rate <video> [polls-per-second] [seconds]");
        std::process::exit(2);
    };
    let polls: u32 = args.next().and_then(|value| value.parse().ok()).unwrap_or(55);
    let seconds: u64 = args.next().and_then(|value| value.parse().ok()).unwrap_or(5);
    // How often the operator's player reports where it is. The app's is ten a
    // second; polling it more often than that is not the same test.
    let reports: u32 = args.next().and_then(|value| value.parse().ok()).unwrap_or(10);
    let path = std::path::PathBuf::from(path);
    let size = (480u32, 270u32);

    let for_open = path.clone();
    let open: Opener = Arc::new(move |_url: &str, size: (u32, u32)| {
        video::open_contained(&for_open, size).map_err(|error| error.to_string())
    });

    let mut feed = VideoFeed::default();
    let mut scene = OutputScene {
        media_url: Some("local-media://media/probe.mp4".to_owned()),
        media_type: Some(MediaKind::Video),
        show_media: true,
        is_video_playing: true,
        video_settings: VideoSettings {
            loop_: true,
            muted: true,
        },
        ..OutputScene::default()
    };

    let started = Instant::now();
    let gap = Duration::from_secs_f64(1.0 / f64::from(polls));
    let mut turns = 0u32;
    let mut distinct = 0u32;
    let mut previous: Option<f64> = None;
    let mut waited_for_open = None;

    while started.elapsed() < Duration::from_secs(seconds) {
        let now = Instant::now();
        // What the operator's player last reported, at its own rate.
        let elapsed = started.elapsed().as_secs_f64();
        let step = 1.0 / f64::from(reports);
        scene.video_current_time = (elapsed / step).floor() * step;

        turns += 1;
        let shown = feed
            .frame_for(&scene, now, size, &open)
            .map(|frame| frame.presentation_seconds);
        if shown.is_some() && waited_for_open.is_none() {
            waited_for_open = Some(started.elapsed());
        }
        if shown.is_some() && shown != previous {
            distinct += 1;
            previous = shown;
        }
        std::thread::sleep(gap);
    }

    let ran = started.elapsed().as_secs_f64();
    println!(
        "polled {:.0}/s for {ran:.1}s — {:.1} distinct frames a second (first frame after {:?})",
        f64::from(turns) / ran,
        f64::from(distinct) / ran,
        waited_for_open
    );
}
