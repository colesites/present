//! Frame-time benchmarks for what the audience output and NDI draw.
//!
//! `cargo bench --bench frame_time` (or `--profile perf`; `profile.release`
//! optimises for size). NDI gives a frame 33.3 ms. Consistency matters more
//! than the best case, so criterion's spread is the number to watch, not only
//! its mean.
//!
//! No media on disk: the video is a generated frame, so the benchmark runs the
//! same on any machine and in CI.

use std::hint::black_box;

use criterion::{criterion_group, criterion_main, Criterion};
use present_lib::services::compositor::scene::NoMedia;
use present_lib::services::compositor::SceneCompositor;
use present_lib::services::output::OutputScene;
use present_lib::services::video::VideoFrame;

const WIDTH: u32 = 1920;
const HEIGHT: u32 = 1080;

/// A verse over a dimmed background, the common case.
fn lyric_scene() -> OutputScene {
    OutputScene {
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
    }
}

/// A 1080p frame whose pixels change with `index`, as a playing video's do.
fn video_frame(index: u32) -> VideoFrame {
    let mut bgra = vec![0u8; WIDTH as usize * HEIGHT as usize * 4];
    for (offset, pixel) in bgra.chunks_exact_mut(4).enumerate() {
        let x = offset as u32 % WIDTH;
        let y = offset as u32 / WIDTH;
        pixel.copy_from_slice(&[
            ((x + index) % 256) as u8,
            ((y + index * 2) % 256) as u8,
            ((x + y) % 256) as u8,
            255,
        ]);
    }
    VideoFrame {
        width: WIDTH,
        height: HEIGHT,
        bgra,
        presentation_seconds: f64::from(index) / 30.0,
    }
}

fn frame_time(c: &mut Criterion) {
    let scene = lyric_scene();
    let frames: Vec<VideoFrame> = (0..8).map(video_frame).collect();

    let mut group = c.benchmark_group("audience frame 1920x1080");
    group.sample_size(30);

    group.bench_function("slide drawn from nothing", |b| {
        let mut compositor = SceneCompositor::new(WIDTH, HEIGHT);
        b.iter(|| {
            compositor.invalidate();
            let (frame, _) = compositor
                .render(black_box(&scene), None, &NoMedia)
                .expect("the scene renders");
            black_box(frame.as_rgba().len());
        });
    });

    group.bench_function("cached slide over a playing video", |b| {
        let mut compositor = SceneCompositor::new(WIDTH, HEIGHT);
        let mut index = 0;
        b.iter(|| {
            let video = &frames[index % frames.len()];
            index += 1;
            let (frame, _) = compositor
                .render(black_box(&scene), Some(video), &NoMedia)
                .expect("the scene renders");
            black_box(frame.as_rgba().len());
        });
    });

    group.bench_function("frame to BGRA for NDI", |b| {
        let mut compositor = SceneCompositor::new(WIDTH, HEIGHT);
        compositor
            .render(&scene, Some(&frames[0]), &NoMedia)
            .expect("the scene renders");
        let frame = compositor.frame().expect("a frame");
        let mut out = Vec::new();
        b.iter(|| {
            frame.write_bgra(black_box(&mut out));
            black_box(out.len());
        });
    });

    group.finish();
}

criterion_group!(benches, frame_time);
criterion_main!(benches);
