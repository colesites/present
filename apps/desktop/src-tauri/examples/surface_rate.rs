//! The audience surface's loop, headless, with the time each part takes.
//!
//! `cargo run --profile perf --example surface_rate -- <video> [width] [height] [seconds]`
//!
//! The preview can play a video smoothly while the audience window skips it,
//! and the two differ in exactly the places this measures: the audience asks
//! the decoder for a picture the size of the window rather than a thumbnail,
//! composites every pixel of it, and copies the result for the view each time.
//! This runs the same `VideoFeed` and the same compositor on the same 60 Hz
//! tick, and reports whether new frames arrive evenly — a video can average
//! thirty frames a second and still skip, if some of them come two ticks late.

use std::sync::Arc;
use std::time::{Duration, Instant};

use present_lib::services::compositor::scene::NoMedia;
use present_lib::services::compositor::SceneCompositor;
use present_lib::services::ndi::video_feed::{Opener, VideoFeed};
use present_lib::services::output::{MediaKind, OutputScene, VideoSettings};
use present_lib::services::surface::TICK;
use present_lib::services::video;

fn percentile(sorted: &[f64], at: f64) -> f64 {
    if sorted.is_empty() {
        return 0.0;
    }
    let index = ((sorted.len() - 1) as f64 * at).round() as usize;
    sorted[index.min(sorted.len() - 1)]
}

fn summary(label: &str, samples: &mut [f64]) {
    samples.sort_by(|a, b| a.total_cmp(b));
    println!(
        "  {label:<22} p50 {:>6.1}ms   p95 {:>6.1}ms   max {:>6.1}ms",
        percentile(samples, 0.5),
        percentile(samples, 0.95),
        samples.last().copied().unwrap_or(0.0),
    );
}

fn main() {
    let mut args = std::env::args().skip(1);
    let Some(path) = args.next() else {
        eprintln!("usage: surface_rate <video> [width] [height] [seconds]");
        std::process::exit(2);
    };
    let width: u32 = args.next().and_then(|v| v.parse().ok()).unwrap_or(1920);
    let height: u32 = args.next().and_then(|v| v.parse().ok()).unwrap_or(1080);
    let seconds: u64 = args.next().and_then(|v| v.parse().ok()).unwrap_or(8);
    let size = (width, height);

    let for_open = std::path::PathBuf::from(&path);
    let open: Opener = Arc::new(move |_url: &str, size: (u32, u32)| {
        video::open_contained(&for_open, size).map_err(|error| error.to_string())
    });

    let mut feed = VideoFeed::default();
    let mut compositor = SceneCompositor::new(width, height);
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

    let mut buffer = Vec::new();
    let (mut feed_ms, mut draw_ms, mut copy_ms, mut tick_ms) =
        (Vec::new(), Vec::new(), Vec::new(), Vec::new());
    let mut fresh_gaps = Vec::new();
    let mut previous_shown: Option<f64> = None;
    let mut last_fresh_at: Option<Instant> = None;
    let (mut ticks, mut fresh, mut over_budget) = (0u32, 0u32, 0u32);

    let started = Instant::now();
    // The first second is the decoder opening; it is not what an audience sees.
    let warm = Duration::from_millis(1500);

    while started.elapsed() < Duration::from_secs(seconds) + warm {
        let tick = Instant::now();
        // The operator's player reports its position ten times a second.
        let elapsed = started.elapsed().as_secs_f64();
        scene.video_current_time = (elapsed * 10.0).floor() / 10.0;

        let a = Instant::now();
        let frame = feed.frame_for(&scene, a, size, &open);
        let b = Instant::now();
        let shown = frame.as_ref().map(|frame| frame.presentation_seconds);

        let counting = started.elapsed() > warm;
        let is_fresh = shown.is_some() && shown != previous_shown;

        if is_fresh {
            // What `stream.rs` does for a changed frame: draw, then copy it
            // for the view.
            if let Some((rendered, _)) = compositor.render(&scene, frame, &NoMedia) {
                rendered.write_bgra_premultiplied(&mut buffer);
            }
            let c = Instant::now();
            let handed = buffer.clone();
            std::hint::black_box(&handed);
            let d = Instant::now();

            if counting {
                fresh += 1;
                draw_ms.push((c - b).as_secs_f64() * 1000.0);
                copy_ms.push((d - c).as_secs_f64() * 1000.0);
                if let Some(at) = last_fresh_at {
                    fresh_gaps.push((d - at).as_secs_f64() * 1000.0);
                }
            }
            last_fresh_at = Some(d);
            previous_shown = shown;
        }

        if counting {
            ticks += 1;
            feed_ms.push((b - a).as_secs_f64() * 1000.0);
            let spent = tick.elapsed();
            tick_ms.push(spent.as_secs_f64() * 1000.0);
            if spent > TICK {
                over_budget += 1;
            }
        }

        if let Some(rest) = TICK.checked_sub(tick.elapsed()) {
            std::thread::sleep(rest);
        }
    }

    let ran = seconds as f64;
    println!("surface loop at {width}x{height}, {seconds}s after warm-up");
    println!(
        "  ticks {:.1}/s   new video frames {:.1}/s   ticks over the 16.7ms budget: {over_budget}",
        f64::from(ticks) / ran,
        f64::from(fresh) / ran
    );
    summary("feed (decode+scale)", &mut feed_ms);
    summary("draw (composite)", &mut draw_ms);
    summary("copy for the view", &mut copy_ms);
    summary("whole tick", &mut tick_ms);

    // The skip itself: how evenly new frames arrive. At 30fps every gap is
    // ~33ms; a gap of 50ms or more is a frame the audience never saw.
    fresh_gaps.sort_by(|a, b| a.total_cmp(b));
    let long = fresh_gaps.iter().filter(|gap| **gap >= 50.0).count();
    println!(
        "  gap between new frames: p50 {:.1}ms  p95 {:.1}ms  max {:.1}ms   gaps >= 50ms: {long} of {}",
        percentile(&fresh_gaps, 0.5),
        percentile(&fresh_gaps, 0.95),
        fresh_gaps.last().copied().unwrap_or(0.0),
        fresh_gaps.len()
    );
}
