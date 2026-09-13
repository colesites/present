//! Watch an NDI source from the terminal: find it, receive it, save a frame.
//!
//! `cargo run --example ndi_watch -- "Present Main Output" [seconds] [frame.png]`
//!
//! For looking at what Present sends without NDI Tools, and for timing it from
//! the receiving end. Matches any source whose name contains the argument,
//! since NDI prefixes the machine name.

use std::time::{Duration, Instant};

use present_lib::services::ndi::finder::Finder;
use present_lib::services::ndi::receiver::{Capture, Receiver};
use present_lib::services::ndi::{library, rules};

/// `NDIlib_recv_bandwidth_highest`.
const BANDWIDTH_HIGHEST: i32 = 100;

fn main() {
    let mut args = std::env::args().skip(1);
    let Some(wanted) = args.next() else {
        eprintln!("usage: ndi_watch <source name> [seconds] [frame.png]");
        std::process::exit(2);
    };
    let seconds: u64 = args
        .next()
        .and_then(|value| value.parse().ok())
        .unwrap_or(10);
    let png = args.next();

    let runtime = library::load(&library::candidates_from_env(None)).unwrap_or_else(|error| {
        eprintln!("{error}");
        std::process::exit(1);
    });

    let mut finder = Finder::new(runtime.lib.clone(), None).expect("discovery");
    let looking = Instant::now();
    let source = loop {
        finder.wait(Duration::from_millis(250));
        let sources = rules::order_sources(finder.sources());
        if let Some(source) = sources.iter().find(|source| source.name.contains(&wanted)) {
            break source.clone();
        }
        if looking.elapsed() > Duration::from_secs(20) {
            let names: Vec<_> = sources.iter().map(|source| source.name.as_str()).collect();
            eprintln!("no source matching \"{wanted}\"; saw {names:?}");
            std::process::exit(1);
        }
    };
    println!("found    \"{}\" after {:?}", source.name, looking.elapsed());

    let mut receiver = Receiver::connect(
        runtime.lib.clone(),
        &source,
        rules::INPUT_COLOR_FORMAT_BGRX_BGRA,
        BANDWIDTH_HIGHEST,
        "Present NDI Watch",
    )
    .expect("connect");

    let until = Instant::now() + Duration::from_secs(seconds);
    let mut arrivals: Vec<Instant> = Vec::new();
    let mut size = (0, 0);
    let mut saved = png.is_none();
    while Instant::now() < until {
        if let Capture::Video(frame) = receiver.capture(Duration::from_millis(500)) {
            arrivals.push(Instant::now());
            size = (frame.width(), frame.height());
            // A frame from a second in, once the stream has settled.
            if !saved && arrivals.len() > 30 {
                if let (Some(path), Some(mut pixels)) = (png.as_deref(), frame.tight_pixels()) {
                    for pixel in pixels.chunks_exact_mut(4) {
                        pixel.swap(0, 2);
                    }
                    let (width, height) = (frame.width() as u32, frame.height() as u32);
                    match image::RgbaImage::from_raw(width, height, pixels)
                        .map(|image| image.save(path))
                    {
                        Some(Ok(())) => println!("saved    {path}"),
                        _ => eprintln!("could not save {path}"),
                    }
                }
                saved = true;
            }
        }
    }

    let gaps: Vec<f64> = arrivals
        .windows(2)
        .map(|pair| pair[1].duration_since(pair[0]).as_secs_f64() * 1000.0)
        .collect();
    let span = match (arrivals.first(), arrivals.last()) {
        (Some(first), Some(last)) => last.duration_since(*first).as_secs_f64(),
        _ => 0.0,
    };
    println!(
        "received {} frames of {}x{} in {:.1} s = {:.1} fps, longest gap {:.1} ms, gaps over 50 ms: {}",
        arrivals.len(),
        size.0,
        size.1,
        span,
        arrivals.len().saturating_sub(1) as f64 / span.max(f64::EPSILON),
        gaps.iter().copied().fold(0.0, f64::max),
        gaps.iter().filter(|gap| **gap > 50.0).count()
    );
}
