//! What a web-view panel's JPEG costs per frame, at the sizes panels ask for.
//! `cargo run --release --example jpeg_probe -- <video>`
use std::time::Instant;

use present_lib::services::thumbnails::encode_jpeg;
use present_lib::services::video;

fn main() {
    let path = std::path::PathBuf::from(std::env::args().nth(1).expect("a video"));
    for size in [(1920u32, 1080u32), (1280, 720), (960, 540)] {
        let mut decoder = video::open_scaled(&path, Some(size)).expect("opens");
        let mut frames = Vec::new();
        while frames.len() < 60 {
            match decoder.next_frame() {
                Ok(Some(frame)) => frames.push(frame),
                _ => break,
            }
        }
        let started = Instant::now();
        let mut bytes = 0;
        for frame in &frames {
            bytes += encode_jpeg(frame.width, frame.height, &frame.bgra)
                .expect("encodes")
                .len();
        }
        let each = started.elapsed().as_secs_f64() * 1000.0 / frames.len() as f64;
        println!(
            "{}x{}: {each:.1} ms a frame ({:.0}% of a core at 30 fps), {} KB",
            size.0,
            size.1,
            each * 30.0 / 10.0,
            bytes / frames.len() / 1024
        );
    }
}
