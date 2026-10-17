//! What one live video costs when four pictures show it: each with a decoder
//! of its own, as before `video::live`, or all from one.
//!
//! `cargo run --example live_share_probe -- /path/to/file.mp4 own|shared [seconds]`
//!
//! Four pictures, each on its own thread and asking sixty times a second as
//! the app's loops do: the audience screen at 1920x1080, the operator's
//! preview and the center pane at 960x540 — each of those encoded as a JPEG
//! when its frame changes, as they are for the webview — and a stage display
//! at 640x360. Run it under `/usr/bin/time -l` for the processor time and the
//! memory, one mode a process.

use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};

use present_lib::services::ndi::video_feed::{Opener, VideoFeed};
use present_lib::services::output::{MediaKind, OutputScene, VideoSettings};
use present_lib::services::sound::clock::{self, HeardClock, Segment};
use present_lib::services::{thumbnails, video};

const PICTURES: [(&str, (u32, u32), bool); 4] = [
    ("screen", (1920, 1080), false),
    ("preview", (960, 540), true),
    ("center pane", (960, 540), true),
    ("stage", (640, 360), false),
];

fn main() {
    let mut args = std::env::args().skip(1);
    let (Some(path), Some(mode)) = (args.next(), args.next()) else {
        eprintln!("usage: live_share_probe <video> own|shared [seconds]");
        std::process::exit(2);
    };
    let shared = match mode.as_str() {
        "own" => false,
        "shared" => true,
        _ => {
            eprintln!("the mode is `own` or `shared`");
            std::process::exit(2);
        }
    };
    let seconds: u64 = args
        .next()
        .and_then(|value| value.parse().ok())
        .unwrap_or(15);
    let path = PathBuf::from(path);
    let url = format!("local-media://media{}", path.display());

    let start = Instant::now();
    if shared {
        // The sound's clock, as the engine publishes it: every picture of the
        // live video reads it and shares its one decoder.
        clock::publish(Some(HeardClock {
            now: Segment {
                path: Some(path.clone()),
                seconds: 0.0,
                playing: true,
                at: start,
                rate: 1.0,
            },
            scheduled: Vec::new(),
        }));
    }

    let for_open = path.clone();
    let open: Opener = Arc::new(move |_url: &str, size: (u32, u32)| {
        video::open_contained(&for_open, size).map_err(|error| error.to_string())
    });
    let stop = Arc::new(AtomicBool::new(false));
    let mut threads = Vec::new();
    for (name, size, encodes) in PICTURES {
        let (open, stop, url) = (Arc::clone(&open), Arc::clone(&stop), url.clone());
        let distinct = Arc::new(AtomicU64::new(0));
        let counted = Arc::clone(&distinct);
        threads.push((
            name,
            distinct,
            std::thread::spawn(move || {
                let mut feed = if shared {
                    VideoFeed::new()
                } else {
                    VideoFeed::new().with_own_clock()
                };
                let scene = OutputScene {
                    media_url: Some(url),
                    media_type: Some(MediaKind::Video),
                    show_media: true,
                    is_video_playing: true,
                    video_settings: VideoSettings {
                        loop_: true,
                        muted: true,
                    },
                    ..OutputScene::default()
                };
                let mut last = None;
                while !stop.load(Ordering::Relaxed) {
                    let turn = Instant::now();
                    if !shared {
                        // Its own time, kept exactly: a decoder of its own.
                        feed.set_exact(Some((start.elapsed().as_secs_f64(), true)));
                    }
                    if let Some(frame) = feed.frame_for(&scene, turn, size, &open) {
                        if last != Some(frame.presentation_seconds) {
                            last = Some(frame.presentation_seconds);
                            counted.fetch_add(1, Ordering::Relaxed);
                            if encodes {
                                let _ =
                                    thumbnails::encode_jpeg(frame.width, frame.height, &frame.bgra);
                            }
                        }
                    }
                    if let Some(rest) = Duration::from_micros(16_667).checked_sub(turn.elapsed()) {
                        std::thread::sleep(rest);
                    }
                }
            }),
        ));
    }

    std::thread::sleep(Duration::from_secs(seconds));
    stop.store(true, Ordering::Relaxed);
    let elapsed = start.elapsed().as_secs_f64();
    println!("mode: {mode}, {elapsed:.1} s");
    for (name, distinct, thread) in threads {
        let _ = thread.join();
        println!(
            "  {name:<12} {:>5.1} frames a second",
            distinct.load(Ordering::Relaxed) as f64 / elapsed
        );
    }
}
