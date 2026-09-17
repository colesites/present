//! The NDI stream end to end: a lyric slide over a real video, through the NDI
//! look, the compositor, the send loop and the SDK, to a receiver.
//!
//! `cargo run --release --example ndi_stream_probe -- /path/to/video.mp4 [seconds] [frame.png] [program]`
//!
//! `program` draws through the program column instead of the NDI one, which
//! shows the countdown timer — the case that ticks once a second.
//!
//! Measures what the stream costs and what arrives: render time per frame, the
//! rate frames reach a receiver, and the longest gap between two of them — a
//! stutter a livestream viewer would see. And the video inside it: how many
//! of its frames made it into the stream, and how far behind the clock they
//! were, since the stream shows the last frame it has rather than wait. The operator's player is simulated
//! the way it really behaves: position reports ten times a second, each 40 ms
//! stale, and a timer that changes once a second.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use present_lib::services::compositor::scene::NoMedia;
use present_lib::services::compositor::SceneCompositor;
use present_lib::services::looks::LookPreset;
use present_lib::services::ndi::finder::Finder;
use present_lib::services::ndi::look::scene_for_ndi;
use present_lib::services::ndi::output::{FrameSource, NdiStatus, OutputWorker};
use present_lib::services::ndi::receiver::{Capture, Receiver};
use present_lib::services::ndi::sender::Sender;
use present_lib::services::ndi::video_feed::{Opener, VideoFeed};
use present_lib::services::ndi::{library, rules};
use present_lib::services::output::{MediaKind, OutputScene, VideoSettings};
use present_lib::services::video;

const WIDTH: u32 = 1920;
const HEIGHT: u32 = 1080;
const BANDWIDTH_HIGHEST: i32 = 100;

/// Per render: seconds since the start, and the video frame drawn.
type VideoLog = Arc<Mutex<Vec<(f64, Option<f64>)>>>;

struct ProbeSource {
    video_path: std::path::PathBuf,
    compositor: SceneCompositor,
    feed: VideoFeed,
    started: Instant,
    render_ms: Arc<Mutex<Vec<f64>>>,
    video: VideoLog,
    program: bool,
}

impl ProbeSource {
    fn scene(&self, now: Instant) -> OutputScene {
        let elapsed = now.duration_since(self.started).as_secs_f64();
        // The operator's player: a report every 100 ms, 40 ms old on arrival.
        let reported = ((elapsed * 10.0).floor() / 10.0 - 0.04).max(0.0);
        let remaining = 300 - elapsed as u64;

        OutputScene {
            show_text: true,
            show_media: true,
            media_url: Some("local-media://media/probe.mp4".to_owned()),
            media_type: Some(MediaKind::Video),
            is_video_playing: true,
            video_current_time: reported,
            video_settings: VideoSettings {
                loop_: true,
                muted: true,
            },
            slide_canvas_size: Some("1920x1080".to_owned()),
            slide_elements: Some(serde_json::json!([
                { "id": "scrim", "type": "shape",
                  "x": 0.0, "y": 0.0, "width": 1920.0, "height": 1080.0,
                  "style": { "backgroundColor": "#000000", "opacity": 0.35 } },
                { "id": "verse", "type": "text",
                  "x": 160.0, "y": 300.0, "width": 1600.0, "height": 480.0,
                  "content": "Amazing grace, how sweet the sound\nThat saved a wretch like me",
                  "style": { "fontSize": 84.0, "color": "#ffffff", "textAlign": "center",
                             "verticalAlign": "middle", "fontWeight": "600" } }
            ])),
            timer_label: Some("Service starts in".to_owned()),
            timer_text: Some(format!("00:{:02}:{:02}", remaining / 60, remaining % 60)),
            timer_running: true,
            // The program column shows the timer; the default NDI column does
            // not. Projected below, so this is what the projector would show.
            timer_visible: true,
            ..OutputScene::default()
        }
    }
}

impl FrameSource for ProbeSource {
    fn render(&mut self, out: &mut Vec<u8>) -> Result<(u32, u32), String> {
        let started = Instant::now();
        let targets = LookPreset::default_preset().targets;
        let look = if self.program {
            targets.program
        } else {
            targets.ndi
        };
        let scene = scene_for_ndi(&self.scene(started), &look);

        let path = self.video_path.clone();
        let open: Opener = std::sync::Arc::new(move |_url: &str, size: (u32, u32)| {
            video::open_contained(&path, size).map_err(|error| error.to_string())
        });
        let Self {
            compositor, feed, ..
        } = self;
        let frame = feed.frame_for(&scene, started, (WIDTH, HEIGHT), &open);
        self.video.lock().map_err(|_| "poisoned")?.push((
            started.duration_since(self.started).as_secs_f64(),
            frame.map(|frame| frame.presentation_seconds),
        ));
        let (rendered, _) = compositor
            .render(&scene, frame, &NoMedia)
            .ok_or("the compositor refused the frame")?;
        rendered.write_bgra(out);

        self.render_ms
            .lock()
            .map_err(|_| "poisoned")?
            .push(started.elapsed().as_secs_f64() * 1000.0);
        Ok((WIDTH, HEIGHT))
    }
}

fn percentile(sorted: &[f64], fraction: f64) -> f64 {
    let index = ((sorted.len() as f64 - 1.0) * fraction).round() as usize;
    sorted[index.min(sorted.len() - 1)]
}

fn main() {
    let mut args = std::env::args().skip(1);
    let Some(video_path) = args.next() else {
        eprintln!("usage: ndi_stream_probe <video> [seconds] [frame.png]");
        std::process::exit(2);
    };
    let seconds: u64 = args
        .next()
        .and_then(|value| value.parse().ok())
        .unwrap_or(10);
    let png = args.next().filter(|value| value != "-");
    let program = args.next().as_deref() == Some("program");

    let runtime = library::load(&library::candidates_from_env(None)).unwrap_or_else(|error| {
        eprintln!("{error}");
        std::process::exit(1);
    });
    println!("runtime  {} ({})", runtime.path.display(), runtime.version);

    let name = format!("Present Stream Probe {}", std::process::id());
    let sender = Sender::new(runtime.lib.clone(), &name, rules::DEFAULT_GROUP_NAME, rules::DEFAULT_FRAME_RATE)
        .expect("create the sender");
    let render_ms = Arc::new(Mutex::new(Vec::new()));
    let video_shown = Arc::new(Mutex::new(Vec::new()));
    let duration = video::open(std::path::Path::new(&video_path))
        .ok()
        .and_then(|decoder| decoder.duration_seconds());
    let source = ProbeSource {
        video_path: video_path.into(),
        compositor: SceneCompositor::new(WIDTH, HEIGHT),
        feed: VideoFeed::new(),
        started: Instant::now(),
        render_ms: render_ms.clone(),
        video: video_shown.clone(),
        program,
    };
    let status = Arc::new(Mutex::new(NdiStatus::default()));
    let worker = OutputWorker::spawn(source, sender, status.clone(), rules::DEFAULT_FRAME_RATE).expect("start the stream");

    // Find it and watch it, the way a switcher on the network would.
    let suffix = format!("({name})");
    let mut finder = Finder::new(runtime.lib.clone(), None).expect("discovery");
    let found = Instant::now();
    let source = loop {
        finder.wait(Duration::from_millis(250));
        if let Some(source) = finder
            .sources()
            .into_iter()
            .find(|s| s.name.ends_with(&suffix))
        {
            break source;
        }
        if found.elapsed() > Duration::from_secs(15) {
            eprintln!("the stream was never discovered");
            std::process::exit(1);
        }
    };
    println!("found    \"{}\" after {:?}", source.name, found.elapsed());

    let mut receiver = Receiver::connect(
        runtime.lib.clone(),
        &source,
        rules::INPUT_COLOR_FORMAT_BGRX_BGRA,
        BANDWIDTH_HIGHEST,
        "Present Stream Probe Receiver",
    )
    .expect("connect");

    let stop = AtomicBool::new(false);
    let watch_until = Instant::now() + Duration::from_secs(seconds);
    let mut arrivals = Vec::new();
    let mut saved = false;
    while Instant::now() < watch_until && !stop.load(Ordering::Relaxed) {
        if let Capture::Video(frame) = receiver.capture(Duration::from_millis(500)) {
            arrivals.push(Instant::now());
            assert_eq!(
                (frame.width(), frame.height()),
                (WIDTH as i32, HEIGHT as i32)
            );
            if !saved && arrivals.len() > 60 {
                if let (Some(path), Some(bgra)) = (png.as_deref(), frame.tight_pixels()) {
                    let mut rgba = bgra;
                    for pixel in rgba.chunks_exact_mut(4) {
                        pixel.swap(0, 2);
                    }
                    image::RgbaImage::from_raw(WIDTH, HEIGHT, rgba)
                        .expect("buffer")
                        .save(path)
                        .expect("write png");
                    println!("saved    {path}");
                }
                saved = true;
            }
        }
    }
    stop.store(true, Ordering::Relaxed);
    worker.stop();

    let status = status.lock().expect("status").clone();
    let mut renders = render_ms.lock().expect("renders").clone();
    renders.sort_by(f64::total_cmp);
    let gaps: Vec<f64> = arrivals
        .windows(2)
        .map(|pair| pair[1].duration_since(pair[0]).as_secs_f64() * 1000.0)
        .collect();
    let watched = arrivals
        .last()
        .zip(arrivals.first())
        .map(|(last, first)| last.duration_since(*first).as_secs_f64())
        .unwrap_or(0.0);

    println!(
        "sent     {} frames, fallback={}, error={:?}",
        status.frames_sent, status.using_fallback_frame, status.last_error
    );
    println!(
        "render   mean {:.1} ms  p95 {:.1} ms  max {:.1} ms  (budget 33.3)",
        renders.iter().sum::<f64>() / renders.len().max(1) as f64,
        percentile(&renders, 0.95),
        renders.last().copied().unwrap_or(0.0)
    );
    println!(
        "received {} frames in {:.1} s = {:.1} fps, longest gap {:.1} ms, gaps over 50 ms: {}",
        arrivals.len(),
        watched,
        (arrivals.len().saturating_sub(1)) as f64 / watched.max(f64::EPSILON),
        gaps.iter().copied().fold(0.0, f64::max),
        gaps.iter().filter(|gap| **gap > 50.0).count()
    );
    let slow: Vec<String> = render_ms
        .lock()
        .expect("renders")
        .iter()
        .enumerate()
        .skip(1)
        .filter(|(_, ms)| **ms > 33.3)
        .map(|(index, ms)| format!("#{index} {ms:.0}"))
        .collect();
    println!(
        "over budget after the first frame: {} {:?}",
        slow.len(),
        slow
    );

    // The video inside the stream. The probe's clock starts the video at 0,
    // so where it should be is the time since the start, wrapped at its length.
    let shown = video_shown.lock().expect("video").clone();
    let changes = shown
        .windows(2)
        .filter(|pair| pair[1].1.is_some() && pair[1].1 != pair[0].1)
        .count();
    let span = shown
        .last()
        .zip(shown.first())
        .map(|(last, first)| last.0 - first.0)
        .unwrap_or(0.0);
    let mut lags: Vec<f64> = shown
        .iter()
        .filter_map(|(at, frame)| {
            let frame = (*frame)?;
            let mut lag = at - frame;
            if let Some(length) = duration.filter(|length| *length > 0.0) {
                lag = lag.rem_euclid(length);
                if lag > length / 2.0 {
                    lag -= length;
                }
            }
            Some(lag * 1000.0)
        })
        .collect();
    lags.sort_by(f64::total_cmp);
    println!(
        "video    {changes} new frames in {span:.1} s = {:.1} fps; behind the clock median {:.0} ms p95 {:.0} ms; {} renders without one",
        changes as f64 / span.max(f64::EPSILON),
        if lags.is_empty() { 0.0 } else { percentile(&lags, 0.5) },
        if lags.is_empty() { 0.0 } else { percentile(&lags, 0.95) },
        shown.iter().filter(|(_, frame)| frame.is_none()).count()
    );

    // What one slide-layer rebuild costs on its own, without video: the price
    // of a scene change, paid once per change.
    let scene = ProbeSource {
        video_path: std::path::PathBuf::new(),
        compositor: SceneCompositor::new(WIDTH, HEIGHT),
        feed: VideoFeed::new(),
        started: Instant::now(),
        render_ms: Arc::default(),
        video: Arc::default(),
        program,
    }
    .scene(Instant::now());
    let mut compositor = SceneCompositor::new(WIDTH, HEIGHT);
    let mut rebuilds = Vec::new();
    let mut cached = Vec::new();
    for index in 0..20 {
        let changed = OutputScene {
            slide_text: Some(format!("change {index}")),
            ..scene.clone()
        };
        let started = Instant::now();
        compositor.render(&changed, None, &NoMedia).expect("render");
        rebuilds.push(started.elapsed().as_secs_f64() * 1000.0);
        let started = Instant::now();
        compositor.render(&changed, None, &NoMedia).expect("render");
        cached.push(started.elapsed().as_secs_f64() * 1000.0);
    }
    rebuilds.sort_by(f64::total_cmp);
    cached.sort_by(f64::total_cmp);
    println!(
        "rebuild  median {:.1} ms max {:.1} ms; cached median {:.1} ms",
        percentile(&rebuilds[1..], 0.5),
        rebuilds.last().copied().unwrap_or(0.0),
        percentile(&cached, 0.5)
    );
}
