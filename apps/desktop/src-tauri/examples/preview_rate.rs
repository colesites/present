//! What one preview frame costs, split into drawing it and encoding it.
//!
//! `cargo run --example preview_rate -- [width] [height] [frames]`
//!
//! The preview draws in a loop and hands the newest frame to an `<img>`. If a
//! turn of that loop costs more than a frame of video, the picture skips — so
//! this is the number that decides whether it can keep up, measured in the
//! profile the app is actually running.

use std::time::Instant;

use present_lib::services::compositor::scene::NoMedia;
use present_lib::services::compositor::SceneCompositor;
use present_lib::services::output::OutputScene;
use present_lib::services::thumbnails;
use present_lib::services::video::VideoFrame;

fn main() {
    let mut args = std::env::args().skip(1);
    let width: u32 = args
        .next()
        .and_then(|value| value.parse().ok())
        .unwrap_or(480);
    let height: u32 = args
        .next()
        .and_then(|value| value.parse().ok())
        .unwrap_or(270);
    let rounds: usize = args
        .next()
        .and_then(|value| value.parse().ok())
        .unwrap_or(120);

    let scene = OutputScene {
        show_media: true,
        show_text: true,
        slide_canvas_size: Some(format!("{width}x{height}")),
        media_url: Some("local-media://media/loop.mp4".to_owned()),
        slide_elements: Some(serde_json::json!([
            { "id": "verse", "type": "text",
              "x": 40.0, "y": 80.0, "width": 400.0, "height": 120.0,
              "content": "Amazing grace, how sweet the sound",
              "style": { "fontSize": 24.0, "color": "#ffffff", "textAlign": "center" } }
        ])),
        ..OutputScene::default()
    };

    let mut compositor = SceneCompositor::new(width, height);
    let frames: Vec<VideoFrame> = (0..8)
        .map(|index| {
            let mut bgra = vec![0u8; width as usize * height as usize * 4];
            for (offset, pixel) in bgra.chunks_exact_mut(4).enumerate() {
                let value = ((offset + index * 977) % 256) as u8;
                pixel.copy_from_slice(&[value, value / 2, 255 - value, 255]);
            }
            VideoFrame {
                width,
                height,
                bgra,
                presentation_seconds: index as f64 / 30.0,
            }
        })
        .collect();

    let (mut drawing, mut writing, mut encoding) = (
        std::time::Duration::ZERO,
        std::time::Duration::ZERO,
        std::time::Duration::ZERO,
    );
    let mut bgra = Vec::new();
    let started = Instant::now();
    for round in 0..rounds {
        let at = Instant::now();
        let (rendered, _) = compositor
            .render(&scene, Some(&frames[round % frames.len()]), &NoMedia)
            .expect("the scene renders");
        drawing += at.elapsed();

        let at = Instant::now();
        rendered.write_bgra(&mut bgra);
        writing += at.elapsed();

        let at = Instant::now();
        let jpeg = thumbnails::encode_jpeg(width, height, &bgra).expect("a jpeg");
        encoding += at.elapsed();
        std::hint::black_box(jpeg.len());
    }

    let each = |total: std::time::Duration| total.as_secs_f64() * 1000.0 / rounds as f64;
    println!(
        "{width}x{height}: draw {:.2} ms, to bgra {:.2} ms, encode {:.2} ms — {:.1} frames a second",
        each(drawing),
        each(writing),
        each(encoding),
        rounds as f64 / started.elapsed().as_secs_f64()
    );
}
