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

/// 4K, which is what a modern projector or an LED wall asks for.
const WIDTH_4K: u32 = 3840;
const HEIGHT_4K: u32 = 2160;

/// A verse over a dimmed background, the common case.
fn lyric_scene() -> OutputScene {
    scene_at(1920.0, 1080.0)
}

/// The same scene at whatever size the output is, laid out to match.
fn scene_at(width: f64, height: f64) -> OutputScene {
    let scale = width / 1920.0;
    OutputScene {
        show_text: true,
        show_media: true,
        slide_canvas_size: Some(format!("{}x{}", width as u32, height as u32)),
        media_url: Some("local-media://media/loop.mp4".to_owned()),
        slide_elements: Some(serde_json::json!([
            { "id": "scrim", "type": "shape",
              "x": 0.0, "y": 0.0, "width": width, "height": height,
              "style": { "backgroundColor": "#000000", "opacity": 0.35 } },
            { "id": "verse", "type": "text",
              "x": 160.0 * scale, "y": 300.0 * scale,
              "width": 1600.0 * scale, "height": 480.0 * scale,
              "content": "Amazing grace, how sweet the sound\nThat saved a wretch like me",
              "style": { "fontSize": 84.0 * scale, "color": "#ffffff", "textAlign": "center",
                         "verticalAlign": "middle", "fontWeight": "600" } }
        ])),
        ..OutputScene::default()
    }
}

/// A 1080p frame whose pixels change with `index`, as a playing video's do.
fn video_frame(index: u32) -> VideoFrame {
    video_frame_at(index, WIDTH, HEIGHT)
}

fn video_frame_at(index: u32, width: u32, height: u32) -> VideoFrame {
    let mut bgra = vec![0u8; width as usize * height as usize * 4];
    for (offset, pixel) in bgra.chunks_exact_mut(4).enumerate() {
        let x = offset as u32 % width;
        let y = offset as u32 / width;
        pixel.copy_from_slice(&[
            ((x + index) % 256) as u8,
            ((y + index * 2) % 256) as u8,
            ((x + y) % 256) as u8,
            255,
        ]);
    }
    VideoFrame {
        width,
        height,
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

/// The same work at 4K, where a frame is four times the pixels.
///
/// The budget is what the stream is set to: 33.3 ms at 30 fps, 16.7 ms at 60.
/// This is the measurement that says whether the compositor needs a GPU.
fn frame_time_4k(c: &mut Criterion) {
    let scene = scene_at(f64::from(WIDTH_4K), f64::from(HEIGHT_4K));
    let frames: Vec<VideoFrame> = (0..4)
        .map(|index| video_frame_at(index, WIDTH_4K, HEIGHT_4K))
        .collect();

    let mut group = c.benchmark_group("audience frame 3840x2160");
    group.sample_size(20);

    group.bench_function("slide drawn from nothing", |b| {
        let mut compositor = SceneCompositor::new(WIDTH_4K, HEIGHT_4K);
        b.iter(|| {
            compositor.invalidate();
            let (frame, _) = compositor
                .render(black_box(&scene), None, &NoMedia)
                .expect("the scene renders");
            black_box(frame.as_rgba().len());
        });
    });

    group.bench_function("cached slide over a playing video", |b| {
        let mut compositor = SceneCompositor::new(WIDTH_4K, HEIGHT_4K);
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
        let mut compositor = SceneCompositor::new(WIDTH_4K, HEIGHT_4K);
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

/// Where the first draw of a 4K slide goes.
///
/// It is drawn once and cached, but it is paid on every slide change, and at
/// 4K the whole of it lands inside one frame's budget or the change stutters.
/// Splitting it says whether a GPU would help or whether something cheaper
/// would: filling a full-screen scrim is pixels, and laying out text is not.
fn first_draw_4k(c: &mut Criterion) {
    let width = f64::from(WIDTH_4K);
    let height = f64::from(HEIGHT_4K);
    let scale = width / 1920.0;

    let scrim_only = OutputScene {
        slide_elements: Some(serde_json::json!([
            { "id": "scrim", "type": "shape",
              "x": 0.0, "y": 0.0, "width": width, "height": height,
              "style": { "backgroundColor": "#000000", "opacity": 0.35 } }
        ])),
        ..scene_at(width, height)
    };
    let text_only = OutputScene {
        slide_elements: Some(serde_json::json!([
            { "id": "verse", "type": "text",
              "x": 160.0 * scale, "y": 300.0 * scale,
              "width": 1600.0 * scale, "height": 480.0 * scale,
              "content": "Amazing grace, how sweet the sound\nThat saved a wretch like me",
              "style": { "fontSize": 84.0 * scale, "color": "#ffffff", "textAlign": "center",
                         "verticalAlign": "middle", "fontWeight": "600" } }
        ])),
        ..scene_at(width, height)
    };
    let empty = OutputScene {
        slide_elements: Some(serde_json::json!([])),
        ..scene_at(width, height)
    };

    let mut group = c.benchmark_group("first draw 3840x2160");
    group.sample_size(20);
    for (name, scene) in [
        ("nothing on the slide", &empty),
        ("a full-screen scrim", &scrim_only),
        ("two lines of text", &text_only),
    ] {
        group.bench_function(name, |b| {
            let mut compositor = SceneCompositor::new(WIDTH_4K, HEIGHT_4K);
            b.iter(|| {
                compositor.invalidate();
                let (frame, _) = compositor
                    .render(black_box(scene), None, &NoMedia)
                    .expect("the scene renders");
                black_box(frame.as_rgba().len());
            });
        });
    }
    group.finish();
}

criterion_group!(benches, frame_time, frame_time_4k, first_draw_4k);
criterion_main!(benches);
