//! What projecting a video costs, as the app's own loops do it, headless.
//!
//! ```text
//! cargo run --profile perf --example projection_bench -- <scenario> <video> [<video> <video>] [--seconds N]
//! ```
//!
//! Scenarios:
//!
//! - `one`        one screen, one window, the operator's preview of it
//! - `mirror3`    one screen shown on three windows (the same picture)
//! - `screens3`   three screens of the same live video, a window each
//! - `different3` three screens, each its own video (the first is the live one)
//!
//! `--center` adds the center pane's video panel; `--size WxH` sets the
//! screens' size (1920x1080); `--engine layers|whole` chooses how screens are
//! drawn: as layers the GPU puts together (the default), or whole pictures on
//! the processor (the Compatibility rendering mode, and the app before
//! layers).
//!
//! Each screen runs the audience surface's loop (`surface::run`): the live
//! video's frame for this tick, the compositor drawing a lyric slide over it,
//! and every window's IOSurface written. The preview panel takes the screen's
//! frame as `state::preview_state` does. What is not here is Core Animation
//! and the window server showing the surfaces: `present_probe` measures that.
//!
//! It reports the process's processor time over the run (100% is one core),
//! its peak memory, how evenly each screen gets new frames, and how far each
//! screen's frame is from where the sound's clock says the video is.

use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use present_lib::services::compositor::scene::NoMedia;
use present_lib::services::ndi::video_feed::{Opener, VideoFeed};
use present_lib::services::output::{MediaKind, OutputScene, VideoSettings};
use present_lib::services::sound::clock::{self, HeardClock, Segment};
use present_lib::services::surface::layered::{Drew, Overlay, ScreenRenderer};
use present_lib::services::surface::{tap, TICK};
use present_lib::services::video;

#[cfg(target_os = "macos")]
use present_lib::services::surface::iosurface::Surfaces;

/// `getrusage`, for the process's processor time and peak memory.
#[repr(C)]
#[derive(Default)]
struct TimeVal {
    seconds: i64,
    micros: i32,
}

#[repr(C)]
#[derive(Default)]
struct Usage {
    user: TimeVal,
    system: TimeVal,
    max_rss: i64,
    rest: [i64; 13],
}

extern "C" {
    fn getrusage(who: i32, usage: *mut Usage) -> i32;
}

/// Set once the screens are playing and warmed up: what counts.
static MEASURING: AtomicBool = AtomicBool::new(false);

fn usage() -> (f64, f64) {
    let mut usage = Usage::default();
    // SAFETY: RUSAGE_SELF (0) into a struct laid out as the C one.
    unsafe { getrusage(0, &mut usage) };
    let seconds = |time: &TimeVal| time.seconds as f64 + f64::from(time.micros) / 1e6;
    // macOS reports the peak in bytes, Linux in kilobytes.
    let rss = if cfg!(target_os = "macos") {
        usage.max_rss as f64 / 1_048_576.0
    } else {
        usage.max_rss as f64 / 1024.0
    };
    (seconds(&usage.user) + seconds(&usage.system), rss)
}

fn percentile(sorted: &[f64], at: f64) -> f64 {
    if sorted.is_empty() {
        return 0.0;
    }
    sorted[((sorted.len() - 1) as f64 * at).round() as usize]
}

/// A lyric over the video, as the app shows one most of a service.
fn lyric_scene(url: &str) -> OutputScene {
    OutputScene {
        show_text: true,
        show_media: true,
        media_url: Some(url.to_owned()),
        media_type: Some(MediaKind::Video),
        is_video_playing: true,
        video_settings: VideoSettings {
            loop_: true,
            muted: true,
        },
        slide_canvas_size: Some("1920x1080".to_owned()),
        slide_elements: Some(serde_json::json!([
            { "id": "verse", "type": "text",
              "x": 160.0, "y": 300.0, "width": 1600.0, "height": 480.0,
              "content": "Amazing grace, how sweet the sound\nThat saved a wretch like me",
              "style": { "fontSize": 84.0, "color": "#ffffff", "textAlign": "center",
                         "verticalAlign": "middle", "fontWeight": "600" } }
        ])),
        ..OutputScene::default()
    }
}

#[derive(Default)]
struct ScreenStats {
    ticks: u64,
    fresh: u64,
    /// Milliseconds between new frames.
    gaps: Vec<f64>,
    /// How far the frame shown is from the clock, in milliseconds.
    off: Vec<f64>,
}

struct Screen {
    name: String,
    url: String,
    live: bool,
    windows: usize,
    tapped: bool,
}

fn main() {
    let mut args: Vec<String> = std::env::args().skip(1).collect();
    let flag = |args: &mut Vec<String>, name: &str| -> Option<String> {
        let at = args.iter().position(|each| each == name)?;
        args.remove(at);
        (at < args.len()).then(|| args.remove(at))
    };
    let seconds: u64 = flag(&mut args, "--seconds")
        .and_then(|value| value.parse().ok())
        .unwrap_or(20);
    let size: (u32, u32) = flag(&mut args, "--size")
        .and_then(|value| {
            let (w, h) = value.split_once('x')?;
            Some((w.parse().ok()?, h.parse().ok()?))
        })
        .unwrap_or((1920, 1080));
    let layers = flag(&mut args, "--engine").is_none_or(|engine| engine != "whole");
    let center = if let Some(at) = args.iter().position(|each| each == "--center") {
        args.remove(at);
        true
    } else {
        false
    };
    if args.len() < 2 {
        eprintln!("usage: projection_bench one|mirror3|screens3|different3 <video> [<video> <video>] [--seconds N] [--size WxH] [--center]");
        std::process::exit(2);
    }
    let scenario = args.remove(0);
    let videos: Vec<PathBuf> = args.iter().map(PathBuf::from).collect();
    let url = |path: &PathBuf| format!("local-media://media{}", path.display());
    let screen = |name: &str, video: &PathBuf, live: bool, windows: usize, tapped: bool| Screen {
        name: name.to_owned(),
        url: url(video),
        live,
        windows,
        tapped,
    };
    let screens: Vec<Screen> = match scenario.as_str() {
        "one" => vec![screen("screen", &videos[0], true, 1, true)],
        "mirror3" => vec![screen("screen", &videos[0], true, 3, true)],
        "screens3" => (0..3)
            .map(|index| screen(&format!("screen{index}"), &videos[0], true, 1, index == 0))
            .collect(),
        "different3" => (0..3)
            .map(|index| {
                let video = videos.get(index).unwrap_or(&videos[0]);
                screen(&format!("screen{index}"), video, index == 0, 1, index == 0)
            })
            .collect(),
        other => {
            eprintln!("no scenario {other}");
            std::process::exit(2);
        }
    };

    let start = Instant::now();
    // The sound's clock, as the engine publishes it for the live video: held
    // at the start until the screens' first frame is decoded, then running —
    // the sound waits for the picture (`sound::Engine::apply_due`), so a
    // file's opening time is not counted as the video being late.
    let held = |playing: bool, at: Instant| {
        clock::publish(Some(HeardClock {
            now: Segment {
                path: Some(videos[0].clone()),
                seconds: 0.0,
                playing,
                at,
                rate: 1.0,
            },
            scheduled: Vec::new(),
        }));
    };
    held(false, start);
    let open: Opener = Arc::new(move |url: &str, size: (u32, u32)| {
        let path = clock::path_of(url).ok_or("not a media URL")?;
        video::open_contained(&path, size).map_err(|error| error.to_string())
    });

    let stop = Arc::new(AtomicBool::new(false));
    // The first seconds are files opening; not what an audience sees.
    let warm = Duration::from_secs(2);
    let mut threads = Vec::new();
    for each in screens {
        let (open, stop) = (Arc::clone(&open), Arc::clone(&stop));
        let stats = Arc::new(Mutex::new(ScreenStats::default()));
        let out = Arc::clone(&stats);
        let name = each.name.clone();
        threads.push((
            name,
            stats,
            std::thread::spawn(move || {
                screen_loop(&each, size, layers, &open, &stop, start, warm, &out)
            }),
        ));
    }
    let preview = {
        let stop = Arc::clone(&stop);
        std::thread::spawn(move || preview_loop(&stop))
    };
    let center_pane = center.then(|| {
        let (open, stop, url) = (Arc::clone(&open), Arc::clone(&stop), url(&videos[0]));
        std::thread::spawn(move || center_loop(&url, &open, &stop))
    });

    let ready_by = Instant::now() + Duration::from_secs(10);
    while present_lib::services::video::live::LiveHub::global().readiness(&videos[0], 0.0)
        != present_lib::services::video::live::Readiness::Ready
        && Instant::now() < ready_by
    {
        std::thread::sleep(Duration::from_millis(5));
    }
    held(true, Instant::now());
    std::thread::sleep(warm);
    let (cpu_before, _) = usage();
    MEASURING.store(true, Ordering::Relaxed);
    let measured_from = Instant::now();
    std::thread::sleep(Duration::from_secs(seconds));
    let (cpu_after, rss) = usage();
    let wall = measured_from.elapsed().as_secs_f64();
    stop.store(true, Ordering::Relaxed);

    println!(
        "{scenario}{} at {}x{}, {} engine, {wall:.1} s measured",
        if center { " + center pane" } else { "" },
        size.0,
        size.1,
        if layers { "layers" } else { "whole-picture" }
    );
    println!(
        "  processor {:.0}% of one core   peak memory {rss:.0} MB",
        (cpu_after - cpu_before) / wall * 100.0
    );
    for (name, stats, thread) in threads {
        let _ = thread.join();
        let mut stats = stats.lock().unwrap();
        stats.gaps.sort_by(f64::total_cmp);
        stats.off.sort_by(f64::total_cmp);
        let fresh_rate = stats.fresh as f64 / wall;
        // A gap of more than one and a half frames is a frame not shown.
        let expected = 1000.0 / fresh_rate.max(1.0);
        let late = stats
            .gaps
            .iter()
            .filter(|gap| **gap > expected * 1.5)
            .count();
        println!(
            "  {name:<8} {fresh_rate:5.1} new frames/s   gap p50 {:5.1} p99 {:5.1} max {:5.1} ms   late {late}   off clock p50 {:5.1} p99 {:5.1} ms",
            percentile(&stats.gaps, 0.5),
            percentile(&stats.gaps, 0.99),
            stats.gaps.last().copied().unwrap_or(0.0),
            percentile(&stats.off, 0.5),
            percentile(&stats.off, 0.99),
        );
    }
    let _ = preview.join();
    if let Some(center_pane) = center_pane {
        let _ = center_pane.join();
    }
}

/// `surface::run` for one screen, with `AppSurfaceSource::render`'s work.
#[allow(clippy::too_many_arguments)]
fn screen_loop(
    screen: &Screen,
    size: (u32, u32),
    layers: bool,
    open: &Opener,
    stop: &AtomicBool,
    start: Instant,
    warm: Duration,
    stats: &Mutex<ScreenStats>,
) {
    let mut renderer = ScreenRenderer::new(size.0, size.1);
    let scene = Arc::new(lyric_scene(&screen.url));
    #[cfg(target_os = "macos")]
    let mut windows: Vec<Surfaces> = (0..screen.windows).map(|_| Surfaces::new()).collect();
    // What each window last wrote the slide from, as `MacPresenter` keeps it.
    #[cfg(target_os = "macos")]
    let mut overlays: Vec<Option<Arc<Vec<u8>>>> = vec![None; screen.windows];
    let mut overlay: Option<Arc<Vec<u8>>> = None;
    let mut buffer = Vec::new();
    let mut last: Option<f64> = None;
    let mut last_fresh: Option<Instant> = None;
    if !screen.live {
        eprintln!("{}: not the live video, so drawn whole", screen.name);
    }
    while !stop.load(Ordering::Relaxed) {
        let tick = Instant::now();
        let counting = MEASURING.load(Ordering::Relaxed) && start.elapsed() > warm;
        let drew = renderer
            .render(
                &scene,
                size,
                tick,
                open,
                &NoMedia,
                layers && screen.live,
                &mut buffer,
            )
            .unwrap_or(Drew::Unchanged);
        let shown = match drew {
            Drew::Unchanged => None,
            Drew::Whole => {
                let frame = Arc::new(std::mem::take(&mut buffer));
                #[cfg(target_os = "macos")]
                for window in &mut windows {
                    std::hint::black_box(window.fill(size.0, size.1, &frame));
                }
                if screen.tapped {
                    tap::publish(&screen.name, Arc::clone(&frame), size);
                }
                buffer = Arc::try_unwrap(frame).unwrap_or_default();
                Some(None)
            }
            Drew::Layers(drawn) => {
                match drawn.overlay {
                    Overlay::Drawn => overlay = Some(Arc::new(buffer.clone())),
                    Overlay::Empty => overlay = None,
                    Overlay::Same => {}
                }
                // Each window writes the slide into a surface only when it
                // changed; the video is the decoder's own surface.
                #[cfg(target_os = "macos")]
                for (window, written) in windows.iter_mut().zip(overlays.iter_mut()) {
                    if let Some(now) = &overlay {
                        if !written.as_ref().is_some_and(|was| Arc::ptr_eq(was, now)) {
                            std::hint::black_box(window.fill(size.0, size.1, now));
                            *written = Some(Arc::clone(now));
                        }
                    }
                }
                let seconds = drawn.video.as_ref().map(|video| video.seconds);
                if screen.tapped {
                    tap::publish_layers(
                        &screen.name,
                        present_lib::services::surface::LayeredShow {
                            canvas: drawn.canvas,
                            base: drawn.base,
                            video: drawn.video,
                            overlay: overlay.clone(),
                        },
                    );
                }
                Some(seconds)
            }
        };
        // The video frame now on this screen.
        let seconds = match shown {
            Some(Some(seconds)) => Some(seconds),
            Some(None) => renderer.shown_seconds(),
            None => last,
        };
        if seconds.is_some() && seconds != last {
            if counting {
                let mut stats = stats.lock().unwrap();
                stats.fresh += 1;
                if let Some(at) = last_fresh {
                    stats
                        .gaps
                        .push(tick.duration_since(at).as_secs_f64() * 1000.0);
                }
                if screen.live {
                    if let (Some(shown), Some((now, _))) =
                        (seconds, clock::position_for(&screen.url, tick))
                    {
                        stats.off.push((now - shown).abs() * 1000.0);
                        if std::env::var_os("BENCH_TRACE").is_some() && (now - shown).abs() > 0.08 {
                            eprintln!(
                                "TRACE {} t={:.3} clock={now:.3} shown={shown:.3} off={:.0}ms",
                                screen.name,
                                start.elapsed().as_secs_f64(),
                                (now - shown) * 1000.0
                            );
                        }
                    }
                }
            }
            last = seconds;
            last_fresh = Some(tick);
        }
        if counting {
            stats.lock().unwrap().ticks += 1;
        }
        if let Some(rest) = TICK.checked_sub(tick.elapsed()) {
            std::thread::sleep(rest);
        }
    }
}

/// The operator's preview of the first screen: its frame, as it was drawn,
/// written into the panel's own surface (`state::preview_state`).
fn preview_loop(stop: &AtomicBool) {
    #[cfg(target_os = "macos")]
    let mut surfaces = Surfaces::new();
    let mut shown = None;
    let mut written: Option<Arc<Vec<u8>>> = None;
    while !stop.load(Ordering::Relaxed) {
        let tick = Instant::now();
        let tapped = tap::latest("screen").or_else(|| tap::latest("screen0"));
        if let Some(tapped) = tapped {
            if shown != Some(tapped.seq) {
                shown = Some(tapped.seq);
                match &tapped.layers {
                    // The screen's own surfaces: only a changed slide is
                    // written into the panel's.
                    Some(layers) => {
                        if let Some(now) = &layers.overlay {
                            if !written.as_ref().is_some_and(|was| Arc::ptr_eq(was, now)) {
                                #[cfg(target_os = "macos")]
                                std::hint::black_box(surfaces.fill(
                                    layers.canvas.0,
                                    layers.canvas.1,
                                    now,
                                ));
                                written = Some(Arc::clone(now));
                            }
                        }
                    }
                    None => {
                        #[cfg(target_os = "macos")]
                        std::hint::black_box(surfaces.fill(
                            tapped.size.0,
                            tapped.size.1,
                            &tapped.frame,
                        ));
                    }
                }
            }
        }
        if let Some(rest) = TICK.checked_sub(tick.elapsed()) {
            std::thread::sleep(rest);
        }
    }
}

/// The center pane's video panel (`state::media_frames_state::NativeMedia`):
/// the live video's frame at whatever size it was decoded, into its surface.
fn center_loop(url: &str, open: &Opener, stop: &AtomicBool) {
    let mut feed = VideoFeed::new();
    feed.set_any_size(true);
    // As `NativeMedia` asks: the frame on the GPU where it can be.
    feed.set_pictures(cfg!(target_os = "macos"));
    let scene = OutputScene {
        media_url: Some(url.to_owned()),
        media_type: Some(MediaKind::Video),
        show_media: true,
        is_video_playing: true,
        ..OutputScene::default()
    };
    #[cfg(target_os = "macos")]
    let mut surfaces = Surfaces::new();
    let mut shown: Option<f64> = None;
    while !stop.load(Ordering::Relaxed) {
        let tick = Instant::now();
        if let Some(frame) = feed.frame_for_shared(&scene, tick, (960, 540), open) {
            if shown != Some(frame.presentation_seconds) {
                shown = Some(frame.presentation_seconds);
                #[cfg(target_os = "macos")]
                if frame.is_well_formed() {
                    std::hint::black_box(surfaces.fill(frame.width, frame.height, &frame.bgra));
                }
            }
        }
        if let Some(rest) = TICK.checked_sub(tick.elapsed()) {
            std::thread::sleep(rest);
        }
    }
}
