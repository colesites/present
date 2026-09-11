//! The whole per-frame cost: decode a real video, composite a slide over it.
//!
//! `cargo run --release --example pipeline_probe -- /path/to/video.mp4`
//!
//! This is the number NDI turns on. Thirty frames a second leaves 33.3 ms, and
//! the two halves were measured separately before this existed: about 29.5 ms
//! to draw a static slide, and 2.5 to 12 ms to decode a 1080p frame. Added
//! naively that is over budget, which is why the slide layers are cached. This
//! measures what the caching actually leaves.

use present_lib::services::compositor::scene::NoMedia;
use present_lib::services::compositor::SceneCompositor;
use present_lib::services::output::OutputScene;
use present_lib::services::video;

fn main() {
    let Some(path) = std::env::args().nth(1) else {
        eprintln!("usage: pipeline_probe <video>");
        std::process::exit(2);
    };
    let path = std::path::PathBuf::from(path);

    // Ask the decoder for frames at the output size so the hardware scaler
    // does the resizing, not the compositor.
    let mut decoder = match video::open_scaled(&path, Some((1920, 1080))) {
        Ok(decoder) => decoder,
        Err(error) => {
            eprintln!("open failed: {error}");
            std::process::exit(1);
        }
    };
    let (video_width, video_height) = decoder.dimensions();

    // A realistic slide: a verse over the video, with a lower third.
    let scene = OutputScene {
        show_text: true,
        show_media: true,
        slide_canvas_size: Some("1920x1080".to_owned()),
        media_url: Some("local-media://media/loop.mp4".to_owned()),
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
        ..OutputScene::default()
    };

    let mut compositor = SceneCompositor::new(1920, 1080);

    let mut decode_ms = 0.0f64;
    let mut composite_ms = 0.0f64;
    let mut frames = 0usize;
    let mut rebuilds = 0usize;

    while frames < 90 {
        let started = std::time::Instant::now();
        let decoded = match decoder.next_frame() {
            Ok(Some(frame)) => frame,
            Ok(None) => break,
            Err(error) => {
                eprintln!("decode failed: {error}");
                break;
            }
        };
        decode_ms += started.elapsed().as_secs_f64() * 1000.0;

        let started = std::time::Instant::now();
        let Some((frame, _)) = compositor.render(&scene, Some(&decoded), &NoMedia) else {
            eprintln!("composite failed");
            break;
        };
        composite_ms += started.elapsed().as_secs_f64() * 1000.0;

        if compositor.rebuilt_last_frame() {
            rebuilds += 1;
        }
        std::hint::black_box(&frame);
        frames += 1;
    }

    if frames == 0 {
        eprintln!("no frames");
        std::process::exit(1);
    }

    let decode = decode_ms / frames as f64;
    let composite = composite_ms / frames as f64;
    let total = decode + composite;
    let budget = 1000.0 / 30.0;

    println!("{}x{} source, {frames} frames", video_width, video_height);
    println!("  decode     {decode:6.2} ms");
    println!("  composite  {composite:6.2} ms");
    println!("  total      {total:6.2} ms   (budget {budget:.1} ms)");
    println!("  slide rebuilds: {rebuilds} of {frames}");
    println!(
        "  {} — {:.0}% of budget",
        if total <= budget {
            "within budget"
        } else {
            "OVER BUDGET"
        },
        total / budget * 100.0
    );
}
