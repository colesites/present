//! Decode a real video and report what came out.
//!
//! `cargo run --example decode_probe -- /path/to/file.mp4 [frame.png]`
//!
//! The unit tests cover the support check, which needs no file. They cannot
//! cover the decoder, because a decoder test needs a video and this repository
//! does not carry one. This is how the AVFoundation path gets exercised against
//! something real, including the two things most likely to be silently wrong:
//! the row padding in a pixel buffer, and the BGRA channel order.

use present_lib::services::video;

fn main() {
    let mut args = std::env::args().skip(1);
    let Some(path) = args.next() else {
        eprintln!("usage: decode_probe <video> [frame.png]");
        std::process::exit(2);
    };
    let png_path = args.next();
    let path = std::path::PathBuf::from(path);

    println!("support: {:?}", video::support_for(&path));

    let started = std::time::Instant::now();
    let mut decoder = match video::open(&path) {
        Ok(decoder) => decoder,
        Err(error) => {
            eprintln!("open failed: {error}");
            std::process::exit(1);
        }
    };
    println!(
        "opened in {:.1} ms",
        started.elapsed().as_secs_f64() * 1000.0
    );
    println!("  dimensions: {:?}", decoder.dimensions());
    println!("  duration:   {:?}", decoder.duration_seconds());

    // Decode a run of frames and time them. The per-frame number is what says
    // whether hardware decode is actually being used: software H.264 would be
    // an order of magnitude slower.
    let mut decoded = 0usize;
    let mut first: Option<video::VideoFrame> = None;
    let run = std::time::Instant::now();

    while decoded < 60 {
        match decoder.next_frame() {
            Ok(Some(frame)) => {
                if !frame.is_well_formed() {
                    eprintln!(
                        "frame {decoded} is malformed: {}x{} but {} bytes",
                        frame.width,
                        frame.height,
                        frame.bgra.len()
                    );
                    std::process::exit(1);
                }
                if first.is_none() {
                    first = Some(frame);
                }
                decoded += 1;
            }
            Ok(None) => break,
            Err(error) => {
                eprintln!("decode failed after {decoded} frames: {error}");
                std::process::exit(1);
            }
        }
    }

    let elapsed = run.elapsed().as_secs_f64() * 1000.0;
    println!("  decoded {decoded} frames in {elapsed:.1} ms");
    if decoded > 0 {
        println!("  {:.2} ms per frame", elapsed / decoded as f64);
    }

    let Some(frame) = first else {
        eprintln!("no frames decoded");
        std::process::exit(1);
    };
    println!(
        "  first frame: {}x{} at {:.3}s, {} bytes",
        frame.width,
        frame.height,
        frame.presentation_seconds,
        frame.bgra.len()
    );

    // Seek, and confirm the next frame comes back from somewhere later.
    if let Some(duration) = decoder.duration_seconds() {
        let target = (duration / 2.0).max(0.0);
        match decoder.seek(target) {
            Ok(()) => match decoder.next_frame() {
                Ok(Some(after)) => println!(
                    "  after seeking to {target:.2}s: frame at {:.3}s",
                    after.presentation_seconds
                ),
                Ok(None) => println!("  after seeking to {target:.2}s: no frame"),
                Err(error) => println!("  seek then decode failed: {error}"),
            },
            Err(error) => println!("  seek failed: {error}"),
        }
    }

    // Write the first frame out, so the channel order can be checked by eye.
    // BGRA read as RGBA turns skin tones blue, which a person spots instantly
    // and an assertion about byte values does not.
    if let Some(png_path) = png_path {
        let mut rgba = Vec::with_capacity(frame.bgra.len());
        for pixel in frame.bgra.chunks_exact(4) {
            rgba.extend_from_slice(&[pixel[2], pixel[1], pixel[0], pixel[3]]);
        }
        match image::RgbaImage::from_raw(frame.width, frame.height, rgba) {
            Some(buffer) => {
                if let Err(error) = image::DynamicImage::ImageRgba8(buffer).save(&png_path) {
                    eprintln!("could not write {png_path}: {error}");
                } else {
                    println!("  wrote {png_path}");
                }
            }
            None => eprintln!("could not build an image from the frame"),
        }
    }
}
