//! A recording put through the microphone's own path (`sound::input::Pipeline`)
//! as the song agent hears it, with the singers' voices picked out of the band
//! or not, to measure what the speech service is sent.
//!
//! ```text
//! ffmpeg -i clip.mp4 -ac 1 -ar 48000 -f f32le clip.f32
//! cargo run --release --example voice_filter_probe -- clip.f32 48000 out.pcm [plain]
//! ```
//!
//! `out.pcm` is 16 kHz mono 16-bit, as streamed (`tests/song-agent-eval/capture.mjs`).

use present_lib::services::sound::input::Pipeline;

fn main() {
    let args: Vec<String> = std::env::args().collect();
    let (input, rate, output) = (&args[1], args[2].parse::<u32>().expect("a rate"), &args[3]);
    let voice = args.get(4).map(String::as_str) != Some("plain");
    let bytes = std::fs::read(input).expect("the recording");
    let samples: Vec<f32> = bytes
        .chunks_exact(4)
        .map(|b| f32::from_le_bytes([b[0], b[1], b[2], b[3]]))
        .collect();
    let mut pipeline = Pipeline::new(rate, voice).expect("the pipeline");
    let started = std::time::Instant::now();
    let mut out = Vec::new();
    // 20 ms at a time, as the microphone thread looks.
    for piece in samples.chunks(rate as usize / 50) {
        out.extend(pipeline.convert(piece).expect("converted"));
    }
    let seconds = samples.len() as f64 / f64::from(rate);
    println!(
        "{seconds:.1} s of sound, voice filter {}, in {:.2?} ({:.2}x real time)",
        if voice { "on" } else { "off" },
        started.elapsed(),
        started.elapsed().as_secs_f64() / seconds
    );
    std::fs::write(output, out).expect("written");
}
