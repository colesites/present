//! How many frames a second a real file decodes at, at a real output size.
//!
//! `cargo run --profile perf --example decode_rate -- /path/to/file.mp4 480 270`
//!
//! The preview and the stream ask the decoder for frames at the size they draw
//! at, and if it cannot produce them as fast as the video runs the picture
//! skips however good everything downstream is. This measures that one number.

use std::time::Instant;

use present_lib::services::video;

fn main() {
    let mut args = std::env::args().skip(1);
    let Some(path) = args.next() else {
        eprintln!("usage: decode_rate <video> [width] [height] [frames]");
        std::process::exit(2);
    };
    let width: u32 = args.next().and_then(|value| value.parse().ok()).unwrap_or(480);
    let height: u32 = args.next().and_then(|value| value.parse().ok()).unwrap_or(270);
    let wanted: usize = args.next().and_then(|value| value.parse().ok()).unwrap_or(120);
    let path = std::path::PathBuf::from(path);

    let opened = Instant::now();
    let mut decoder = match video::open_contained(&path, (width, height)) {
        Ok(decoder) => decoder,
        Err(error) => {
            eprintln!("open failed: {error}");
            std::process::exit(1);
        }
    };
    println!(
        "opened in {:?}, {}x{} at {:?}s long",
        opened.elapsed(),
        decoder.dimensions().0,
        decoder.dimensions().1,
        decoder.duration_seconds()
    );

    // A first frame often costs more than the rest: it is not in the average.
    let _ = decoder.next_frame();

    let started = Instant::now();
    let mut decoded = 0usize;
    let mut slowest = std::time::Duration::ZERO;
    while decoded < wanted {
        let at = Instant::now();
        match decoder.next_frame() {
            Ok(Some(_)) => {
                slowest = slowest.max(at.elapsed());
                decoded += 1;
            }
            Ok(None) => {
                if decoder.seek(0.0).is_err() {
                    break;
                }
            }
            Err(error) => {
                eprintln!("decode failed after {decoded}: {error}");
                break;
            }
        }
    }

    let seconds = started.elapsed().as_secs_f64();
    println!(
        "{decoded} frames in {seconds:.2}s — {:.1} a second, slowest {slowest:?}",
        decoded as f64 / seconds
    );
}
