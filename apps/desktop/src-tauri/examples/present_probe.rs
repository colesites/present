//! A screen shown in real windows, as the audience view shows it: for what
//! the window server costs as well as the app, and for a capture of the
//! picture to check.
//!
//! ```text
//! cargo run --release --example present_probe -- <video> [--engine layers|whole] [--windows N] [--seconds N] [--capture out.png]
//! ```
//!
//! Each window is the audience view's layer (`surface::layers`), drawn from
//! the app's own screen renderer on its own thread, with a lyric over the
//! video. It reports this process's processor time and the window server's
//! over the run (100% is one core), and with `--capture` saves the first
//! window as the screen shows it.

#[cfg(target_os = "macos")]
fn main() {
    mac::main();
}

#[cfg(not(target_os = "macos"))]
fn main() {
    eprintln!("macOS only");
}

#[cfg(target_os = "macos")]
mod mac {
    use std::path::PathBuf;
    use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
    use std::sync::Arc;
    use std::time::{Duration, Instant};

    use objc2::rc::Retained;
    use objc2::runtime::AnyObject;
    use objc2::{class, msg_send};
    use objc2_core_foundation::{CGPoint, CGRect, CGSize};
    use objc2_quartz_core::{CALayer, CATransaction};

    use present_lib::services::compositor::scene::NoMedia;
    use present_lib::services::ndi::video_feed::Opener;
    use present_lib::services::output::{MediaKind, OutputScene, VideoSettings};
    use present_lib::services::sound::clock::{self, HeardClock, Segment};
    use present_lib::services::surface::iosurface::Surfaces;
    use present_lib::services::surface::layered::{Drew, Overlay, ScreenRenderer};
    use present_lib::services::surface::layers::{self, Fit, Layered};
    use present_lib::services::video;

    extern "C" {
        fn CFRunLoopRunInMode(mode: *const AnyObject, seconds: f64, return_after_source: u8)
            -> i32;
        static kCFRunLoopDefaultMode: *const AnyObject;
    }

    /// A layer another thread may carry.
    struct Host(Retained<CALayer>);
    // SAFETY: only touched inside explicit transactions, which Core Animation
    // allows from any thread for layers no view is drawing into.
    unsafe impl Send for Host {}
    unsafe impl Sync for Host {}

    fn cpu_seconds_of(pid: u32) -> f64 {
        let out = std::process::Command::new("ps")
            .args(["-o", "time=", "-p", &pid.to_string()])
            .output()
            .ok()
            .map(|out| String::from_utf8_lossy(&out.stdout).trim().to_owned())
            .unwrap_or_default();
        // [[hh:]mm:]ss.ss
        out.split(':').fold(0.0, |total, part| {
            total * 60.0 + part.parse::<f64>().unwrap_or(0.0)
        })
    }

    fn window_server() -> Option<u32> {
        let out = std::process::Command::new("pgrep")
            .arg("WindowServer")
            .output()
            .ok()?;
        String::from_utf8_lossy(&out.stdout)
            .lines()
            .next()?
            .trim()
            .parse()
            .ok()
    }

    pub fn main() {
        let mut args: Vec<String> = std::env::args().skip(1).collect();
        let flag = |args: &mut Vec<String>, name: &str| -> Option<String> {
            let at = args.iter().position(|each| each == name)?;
            args.remove(at);
            (at < args.len()).then(|| args.remove(at))
        };
        let layers = flag(&mut args, "--engine").is_none_or(|engine| engine != "whole");
        let windows: usize = flag(&mut args, "--windows")
            .and_then(|value| value.parse().ok())
            .unwrap_or(1);
        let seconds: u64 = flag(&mut args, "--seconds")
            .and_then(|value| value.parse().ok())
            .unwrap_or(15);
        let capture = flag(&mut args, "--capture");
        let Some(path) = args.first().map(PathBuf::from) else {
            eprintln!("usage: present_probe <video> [--engine layers|whole] [--windows N] [--seconds N] [--capture out.png]");
            std::process::exit(2);
        };
        let url = format!("local-media://media{}", path.display());

        // SAFETY: AppKit on the main thread, set up as an app would.
        let (app, hosts, numbers) = unsafe {
            let app: *mut AnyObject = msg_send![class!(NSApplication), sharedApplication];
            let _: bool = msg_send![app, setActivationPolicy: 0isize];
            let _: () = msg_send![app, finishLaunching];
            let mut hosts = Vec::new();
            let mut numbers = Vec::new();
            for index in 0..windows {
                let frame = CGRect {
                    origin: CGPoint {
                        x: 40.0 + 30.0 * index as f64,
                        y: 120.0 + 30.0 * index as f64,
                    },
                    size: CGSize {
                        width: 960.0,
                        height: 540.0,
                    },
                };
                let window: *mut AnyObject = msg_send![class!(NSWindow), alloc];
                let window: *mut AnyObject = msg_send![
                    window,
                    initWithContentRect: frame,
                    styleMask: 1usize,
                    backing: 2usize,
                    defer: false
                ];
                let _: () = msg_send![window, setReleasedWhenClosed: false];
                let view: *mut AnyObject = msg_send![window, contentView];
                let _: () = msg_send![view, setWantsLayer: true];
                let layer: Retained<CALayer> = msg_send![view, layer];
                let _: () = msg_send![window, makeKeyAndOrderFront: std::ptr::null::<AnyObject>()];
                let number: isize = msg_send![window, windowNumber];
                hosts.push(Arc::new(Host(layer)));
                numbers.push(number);
            }
            let _: () = msg_send![app, activateIgnoringOtherApps: true];
            (app, hosts, numbers)
        };
        let _ = app;

        let start = Instant::now();
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
        let open: Opener = Arc::new(move |url: &str, size: (u32, u32)| {
            let path = clock::path_of(url).ok_or("not a media URL")?;
            video::open_contained(&path, size).map_err(|error| error.to_string())
        });

        let stop = Arc::new(AtomicBool::new(false));
        let presented = Arc::new(AtomicU64::new(0));
        let drawer = {
            let (stop, presented, hosts) =
                (Arc::clone(&stop), Arc::clone(&presented), hosts.clone());
            std::thread::spawn(move || draw(&url, layers, &open, &hosts, &stop, &presented))
        };

        // The main thread runs the windows; the screens are drawn on theirs.
        let run_for = |duration: Duration| {
            let until = Instant::now() + duration;
            while Instant::now() < until {
                // SAFETY: the main thread's run loop, in its default mode.
                unsafe { CFRunLoopRunInMode(kCFRunLoopDefaultMode, 0.05, 0) };
            }
        };
        run_for(Duration::from_secs(3));
        let me = std::process::id();
        let server = window_server();
        let (mine_before, server_before) = (cpu_seconds_of(me), server.map(cpu_seconds_of));
        let shown_before = presented.load(Ordering::Relaxed);
        let measured = Instant::now();
        run_for(Duration::from_secs(seconds));
        let wall = measured.elapsed().as_secs_f64();
        let (mine_after, server_after) = (cpu_seconds_of(me), server.map(cpu_seconds_of));
        let shown = presented.load(Ordering::Relaxed) - shown_before;

        if let Some(out) = &capture {
            let status = std::process::Command::new("screencapture")
                .args(["-x", "-o", "-l", &numbers[0].to_string(), out])
                .status();
            println!("  captured the first window to {out}: {status:?}");
        }
        stop.store(true, Ordering::Relaxed);
        let _ = drawer.join();

        println!(
            "{} engine, {windows} window(s), {wall:.1} s: {:.1} pictures/s handed over",
            if layers { "layers" } else { "whole-picture" },
            shown as f64 / wall / windows as f64
        );
        println!(
            "  this process {:.0}% of one core   window server {}",
            (mine_after - mine_before) / wall * 100.0,
            match (server_before, server_after) {
                (Some(before), Some(after)) => format!("{:.0}%", (after - before) / wall * 100.0),
                _ => "unknown".to_owned(),
            }
        );
    }

    fn scene(url: &str) -> OutputScene {
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

    /// The screen's loop: drawn once, shown on every window, as
    /// `surface::run` does.
    fn draw(
        url: &str,
        layers_on: bool,
        open: &Opener,
        hosts: &[Arc<Host>],
        stop: &AtomicBool,
        presented: &AtomicU64,
    ) {
        let size = (1920, 1080);
        let mut renderer = ScreenRenderer::new(size.0, size.1);
        let scene = Arc::new(scene(url));
        let mut surfaces: Vec<Surfaces> = hosts.iter().map(|_| Surfaces::new()).collect();
        let mut overlay_frames: Vec<Option<Arc<present_lib::services::surface::iosurface::Frame>>> =
            vec![None; hosts.len()];
        let mut buffer = Vec::new();
        let mut pictures = std::collections::VecDeque::new();
        let tick = Duration::from_micros(16_667);
        while !stop.load(Ordering::Relaxed) {
            let started = Instant::now();
            match renderer.render(
                &scene,
                size,
                started,
                open,
                &NoMedia,
                layers_on,
                &mut buffer,
            ) {
                Ok(Drew::Whole) => {
                    for (host, surfaces) in hosts.iter().zip(&mut surfaces) {
                        if let Some(frame) = surfaces.fill(size.0, size.1, &buffer) {
                            // SAFETY: an explicit transaction, flushed.
                            unsafe { layers::show_whole(&host.0, frame.as_contents()) };
                            presented.fetch_add(1, Ordering::Relaxed);
                        }
                    }
                    CATransaction::flush();
                }
                Ok(Drew::Layers(drawn)) => {
                    for ((host, surfaces), overlay) in
                        hosts.iter().zip(&mut surfaces).zip(&mut overlay_frames)
                    {
                        match drawn.overlay {
                            Overlay::Drawn => *overlay = surfaces.fill(size.0, size.1, &buffer),
                            Overlay::Empty => *overlay = None,
                            Overlay::Same => {}
                        }
                        let layered = Layered {
                            canvas: drawn.canvas,
                            base: drawn.base,
                            video: drawn
                                .video
                                .as_ref()
                                .map(|video| (Arc::clone(&video.picture), video.geometry)),
                            overlay: overlay.clone(),
                        };
                        // SAFETY: an explicit transaction, flushed.
                        unsafe { layers::show_layered(&host.0, &layered, Fit::Stretch) };
                        presented.fetch_add(1, Ordering::Relaxed);
                    }
                    CATransaction::flush();
                    if let Some(video) = drawn.video {
                        pictures.push_back(video.picture);
                    }
                    // As `MacPresenter`: each picture kept until the window
                    // server lets it go.
                    while pictures.len() > 1 && !pictures[0].is_in_use() {
                        pictures.pop_front();
                    }
                }
                Ok(Drew::Unchanged) => {}
                Err(error) => eprintln!("  could not draw: {error}"),
            }
            if let Some(rest) = tick.checked_sub(started.elapsed()) {
                std::thread::sleep(rest);
            }
        }
    }
}
