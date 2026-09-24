//! What every frame of a transition costs, at the size it is shown.
//!
//! `cargo run --profile perf --example transition_rate -- [width] [height] [kind] [mode] [video]`
//!
//! A transition is smooth when every one of its frames is drawn inside a tick
//! of the display. This changes the slide with a transition, then draws on the
//! audience surface's 60 Hz tick for as long as the compositor says it is
//! animating, and reports the cost of each frame and how many were drawn — a
//! 600 ms transition at 60 Hz should be about 36 frames, and fewer means the
//! audience saw it in steps.
//!
//! `video` is a file to play underneath, which is how the operator uses it.

use std::sync::Arc;
use std::time::{Duration, Instant};

use present_lib::services::compositor::scene::NoMedia;
use present_lib::services::compositor::transition::Transition;
use present_lib::services::compositor::SceneCompositor;
use present_lib::services::ndi::video_feed::{Opener, VideoFeed};
use present_lib::services::output::{MediaKind, OutputScene, VideoSettings};
use present_lib::services::surface::TICK;
use present_lib::services::video;

fn slide(text: &str) -> serde_json::Value {
    serde_json::json!([
        { "id": "verse", "type": "text",
          "x": 120.0, "y": 300.0, "width": 1680.0, "height": 480.0,
          "content": text,
          "style": { "fontSize": 72.0, "color": "#ffffff", "textAlign": "center" } }
    ])
}

fn main() {
    let mut args = std::env::args().skip(1);
    let width: u32 = args.next().and_then(|v| v.parse().ok()).unwrap_or(1920);
    let height: u32 = args.next().and_then(|v| v.parse().ok()).unwrap_or(1200);
    let kind = args.next().unwrap_or_else(|| "fade".to_owned());
    let mode = args.next().unwrap_or_else(|| "changed-elements".to_owned());
    let video_path = args.next();

    let transition: Transition = serde_json::from_value(serde_json::json!({
        // `TRANSITION_MS` lengthens it, so a profiler can sample one.
        "type": kind,
        "durationMs": std::env::var("TRANSITION_MS").ok().and_then(|v| v.parse::<u32>().ok()).unwrap_or(600),
        "easing": "ease-in-out", "mode": mode,
    }))
    .expect("a transition");

    let open: Option<Opener> = video_path.as_ref().map(|path| {
        let path = std::path::PathBuf::from(path);
        let opener: Opener = Arc::new(move |_url: &str, size: (u32, u32)| {
            video::open_contained(&path, size).map_err(|error| error.to_string())
        });
        opener
    });

    let mut base = OutputScene {
        show_text: true,
        slide_canvas_size: Some("1920x1080".to_owned()),
        ..OutputScene::default()
    };
    if open.is_some() {
        base.media_url = Some("local-media://media/probe.mp4".to_owned());
        base.media_type = Some(MediaKind::Video);
        base.show_media = true;
        base.is_video_playing = true;
        base.video_settings = VideoSettings {
            loop_: true,
            muted: true,
        };
    }

    let mut from = base.clone();
    from.slide_elements = Some(slide("Amazing grace, how sweet the sound"));
    let mut to = base.clone();
    to.slide_elements = Some(slide("That saved a wretch like me"));
    to.transition = Some(transition);

    let mut compositor = SceneCompositor::new(width, height);
    let mut feed = VideoFeed::default();
    let started = Instant::now();

    // Settle on the first slide, as the operator's screen would be, and let a
    // video get past opening.
    let settle_until = started + Duration::from_millis(if open.is_some() { 1500 } else { 200 });
    while Instant::now() < settle_until {
        let frame = open.as_ref().and_then(|open| {
            let mut scene = from.clone();
            scene.video_current_time = started.elapsed().as_secs_f64();
            feed.frame_for(&scene, Instant::now(), (width, height), open)
                .cloned()
        });
        let _ = compositor.render(&from, frame.as_ref(), &NoMedia);
        std::thread::sleep(TICK);
    }

    // The change, and every frame of the transition it starts.
    let mut costs = Vec::new();
    let transition_began = Instant::now();
    loop {
        let tick = Instant::now();
        let frame = open.as_ref().and_then(|open| {
            let mut scene = to.clone();
            scene.video_current_time = started.elapsed().as_secs_f64();
            feed.frame_for(&scene, Instant::now(), (width, height), open)
                .cloned()
        });
        let a = Instant::now();
        let _ = compositor.render(&to, frame.as_ref(), &NoMedia);
        costs.push(a.elapsed().as_secs_f64() * 1000.0);
        if !compositor.is_animating() || transition_began.elapsed() > Duration::from_secs(30) {
            break;
        }
        if let Some(rest) = TICK.checked_sub(tick.elapsed()) {
            std::thread::sleep(rest);
        }
    }
    let lasted = transition_began.elapsed();

    let mut sorted = costs.clone();
    sorted.sort_by(|a, b| a.total_cmp(b));
    let at = |p: f64| sorted[((sorted.len() - 1) as f64 * p).round() as usize];
    let over = costs
        .iter()
        .filter(|cost| **cost > TICK.as_secs_f64() * 1000.0)
        .count();
    println!(
        "{kind} ({mode}) at {width}x{height}{}: {} frames over {:.0}ms, expected ~{:.0}",
        if open.is_some() { " over video" } else { "" },
        costs.len(),
        lasted.as_secs_f64() * 1000.0,
        0.6 * 60.0
    );
    println!(
        "  per frame  p50 {:.1}ms  p95 {:.1}ms  max {:.1}ms   over the 16.7ms tick: {over}",
        at(0.5),
        at(0.95),
        sorted.last().copied().unwrap_or(0.0)
    );
}
