//! How long a live video takes to show its first frame, to show a frame after
//! a seek, and how fast it decodes after that — the decoder the shared live
//! video uses (`video::live`), on a real file.
//!
//! `cargo run --release --example start_seek_probe -- /path/to/file.mp4 [width height]`
//!
//! Measures what the audience screen waits for: from asking for a video to
//! its first frame (the screen shows no video until then), from a seek to the
//! first frame at the new place, and the frames a second the decoder keeps up
//! after that.

use std::path::PathBuf;
use std::time::Instant;

use present_lib::services::video::{self, VideoDecoder};

fn main() {
    let mut args = std::env::args().skip(1);
    let Some(path) = args.next().map(PathBuf::from) else {
        eprintln!("usage: start_seek_probe <video> [width height]");
        std::process::exit(2);
    };
    let width = args
        .next()
        .and_then(|value| value.parse().ok())
        .unwrap_or(1920);
    let height = args
        .next()
        .and_then(|value| value.parse().ok())
        .unwrap_or(1080);
    println!("{} at {width}x{height}", path.display());

    // Time for a profiler to attach, when asked for.
    if let Some(wait) = std::env::var("PROBE_WAIT_MS")
        .ok()
        .and_then(|value| value.parse().ok())
    {
        std::thread::sleep(std::time::Duration::from_millis(wait));
    }

    // Opening: the file, the decoder, and the first frame.
    let started = Instant::now();
    let opened = video::open_contained(&path, (width, height));
    let mut decoder = match opened {
        Ok(decoder) => decoder,
        Err(error) => {
            eprintln!("  could not open: {error}");
            std::process::exit(1);
        }
    };
    // Without the read-ahead thread, as the shared live video takes it.
    let mut decoder: Box<dyn VideoDecoder> = match decoder.take_unbuffered() {
        Some(inner) => inner,
        None => decoder,
    };
    let open_ms = started.elapsed().as_secs_f64() * 1000.0;
    let first = decoder.next_frame().ok().flatten();
    let first_ms = started.elapsed().as_secs_f64() * 1000.0;
    println!(
        "  open {open_ms:.0} ms, first frame {first_ms:.0} ms ({:?})",
        first.map(|frame| (frame.width, frame.height, frame.presentation_seconds))
    );
    let duration = decoder.duration_seconds().unwrap_or(10.0);

    // Steady decoding from the start: frames a second.
    let steady = Instant::now();
    let mut count = 0;
    while steady.elapsed().as_secs_f64() < 3.0 {
        match decoder.next_frame() {
            Ok(Some(_)) => count += 1,
            _ => break,
        }
    }
    println!(
        "  decodes {:.0} frames a second at this size",
        f64::from(count) / steady.elapsed().as_secs_f64()
    );

    // Seeks: forward, back, and just before the end.
    for fraction in [0.3, 0.75, 0.1, 0.95] {
        let target = duration * fraction;
        let asked = Instant::now();
        if let Err(error) = decoder.seek(target) {
            println!("  seek to {target:.2} s failed: {error}");
            continue;
        }
        let frame = decoder.next_frame().ok().flatten();
        println!(
            "  seek to {target:5.2} s: first frame after {:4.0} ms, at {:?} s",
            asked.elapsed().as_secs_f64() * 1000.0,
            frame.map(|frame| (frame.presentation_seconds * 100.0).round() / 100.0)
        );
    }
}
