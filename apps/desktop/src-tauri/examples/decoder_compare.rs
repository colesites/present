//! FFmpeg against AVFoundation on the same files: speed, pixels, seeking.
//!
//! `cargo run --profile perf --example decoder_compare -- <video>...`
//!
//! Each file is decoded at 1920x1080 (contained) by both decoders. Frames are
//! paired by timestamp and compared channel by channel; a mean difference of a
//! few levels is scaling and rounding, a large one is a colour mistake.

#[cfg(target_os = "macos")]
fn main() {
    use present_lib::services::video::ffmpeg::FfmpegVideoDecoder;
    use present_lib::services::video::macos::MacVideoDecoder;
    use present_lib::services::video::{contain_size, VideoDecoder, VideoFrame};
    use std::time::Instant;

    const FRAMES: usize = 90;
    let bounds = (1920, 1080);
    let out_dir = std::env::var("COMPARE_OUT").ok();

    fn decode(decoder: &mut dyn VideoDecoder, frames: usize) -> (Vec<VideoFrame>, f64) {
        let mut decoded = Vec::new();
        let started = Instant::now();
        while decoded.len() < frames {
            match decoder.next_frame() {
                Ok(Some(frame)) => decoded.push(frame),
                Ok(None) => break,
                Err(error) => {
                    eprintln!("  decode error: {error}");
                    break;
                }
            }
        }
        let ms = started.elapsed().as_secs_f64() * 1000.0 / decoded.len().max(1) as f64;
        (decoded, ms)
    }

    fn difference(a: &VideoFrame, b: &VideoFrame) -> Option<([f64; 3], u8)> {
        if (a.width, a.height) != (b.width, b.height) {
            return None;
        }
        let mut sums = [0u64; 3];
        let mut max = 0u8;
        for (pa, pb) in a.bgra.chunks_exact(4).zip(b.bgra.chunks_exact(4)) {
            for channel in 0..3 {
                let d = pa[channel].abs_diff(pb[channel]);
                sums[channel] += u64::from(d);
                max = max.max(d);
            }
        }
        let n = (a.width * a.height) as f64;
        Some((
            [sums[2] as f64 / n, sums[1] as f64 / n, sums[0] as f64 / n],
            max,
        ))
    }

    fn save(frame: &VideoFrame, path: &str) {
        let rgba: Vec<u8> = frame
            .bgra
            .chunks_exact(4)
            .flat_map(|p| [p[2], p[1], p[0], 255])
            .collect();
        if let Some(image) = image::RgbaImage::from_raw(frame.width, frame.height, rgba) {
            let _ = image.save(path);
        }
    }

    for path in std::env::args().skip(1) {
        let path = std::path::PathBuf::from(path);
        let name = path.file_name().unwrap().to_string_lossy().into_owned();
        println!("{name}");
        let contained = |natural| Some(contain_size(natural, bounds));

        let mut av = match MacVideoDecoder::open_sized(&path, contained) {
            Ok(decoder) => decoder,
            Err(error) => {
                println!("  AVFoundation cannot open it: {error}");
                continue;
            }
        };
        let mut ff = match FfmpegVideoDecoder::open_sized(&path, contained) {
            Ok(decoder) => decoder,
            Err(error) => {
                println!("  FFmpeg cannot open it: {error}");
                continue;
            }
        };
        println!(
            "  size av {:?} ff {:?}, duration av {:?} ff {:?}",
            av.dimensions(),
            ff.dimensions(),
            av.duration_seconds().map(|d| (d * 1000.0).round() / 1000.0),
            ff.duration_seconds().map(|d| (d * 1000.0).round() / 1000.0)
        );

        let (av_frames, av_ms) = decode(&mut av, FRAMES);
        let (ff_frames, ff_ms) = decode(&mut ff, FRAMES);
        println!(
            "  decode+scale per frame: AVFoundation {av_ms:.2} ms ({} frames), FFmpeg {ff_ms:.2} ms ({} frames)",
            av_frames.len(),
            ff_frames.len()
        );

        let mut worst = [0.0f64; 3];
        let mut max_diff = 0u8;
        let mut paired = 0;
        let mut time_gap = 0.0f64;
        for (index, a) in av_frames.iter().enumerate() {
            let Some(b) = ff_frames.iter().min_by(|x, y| {
                (x.presentation_seconds - a.presentation_seconds)
                    .abs()
                    .total_cmp(&(y.presentation_seconds - a.presentation_seconds).abs())
            }) else {
                continue;
            };
            time_gap = time_gap.max((b.presentation_seconds - a.presentation_seconds).abs());
            if let Some((means, max)) = difference(a, b) {
                paired += 1;
                for channel in 0..3 {
                    worst[channel] = worst[channel].max(means[channel]);
                }
                max_diff = max_diff.max(max);
            }
            if index == 30 {
                if let Some(dir) = &out_dir {
                    save(a, &format!("{dir}/{name}.av.png"));
                    save(b, &format!("{dir}/{name}.ff.png"));
                }
            }
        }
        println!(
            "  {paired} frames paired (timestamps within {:.4} s); worst mean difference R {:.2} G {:.2} B {:.2}, largest single {max_diff}",
            time_gap, worst[0], worst[1], worst[2]
        );

        for target in [3.0, 1.0] {
            let seek_ms = |decoder: &mut dyn VideoDecoder| -> (f64, Option<f64>) {
                let started = Instant::now();
                if decoder.seek(target).is_err() {
                    return (0.0, None);
                }
                let frame = decoder.next_frame().ok().flatten();
                (
                    started.elapsed().as_secs_f64() * 1000.0,
                    frame.map(|f| (f.presentation_seconds * 1000.0).round() / 1000.0),
                )
            };
            let (av_time, av_at) = seek_ms(&mut av);
            let (ff_time, ff_at) = seek_ms(&mut ff);
            println!(
                "  seek to {target}: AVFoundation {av_time:.1} ms -> {av_at:?}, FFmpeg {ff_time:.1} ms -> {ff_at:?}"
            );
        }
    }
}

#[cfg(not(target_os = "macos"))]
fn main() {
    eprintln!("decoder_compare compares against AVFoundation and runs on macOS only");
}
