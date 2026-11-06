//! What recording from the microphone costs: Present's recorder as the
//! recording window drives it, against a bare capture that does nothing with
//! the sound.
//!
//! ```text
//! cargo run --release --example record_probe -- present|meter|bare [seconds]
//! ```
//!
//! - `present` records a take, reading the window's snapshot every 60 ms as
//!   the window does while recording;
//! - `meter` has an input chosen but is not recording: the window's meter,
//!   read every 120 ms;
//! - `bare` opens the default input with `cpal` and only counts the samples.
//!
//! It reports this process's processor time, and `coreaudiod`'s: the macOS
//! audio service, which does the device's side of any recording.

use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};

use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};

#[repr(C)]
#[derive(Default)]
struct TimeVal {
    seconds: i64,
    micros: i32,
}

#[repr(C)]
#[derive(Default)]
struct Usage {
    user: TimeVal,
    system: TimeVal,
    rest: [i64; 14],
}

extern "C" {
    fn getrusage(who: i32, usage: *mut Usage) -> i32;
}

fn own_seconds() -> f64 {
    let mut usage = Usage::default();
    // SAFETY: RUSAGE_SELF into a struct laid out as the C one.
    unsafe { getrusage(0, &mut usage) };
    let seconds = |time: &TimeVal| time.seconds as f64 + f64::from(time.micros) / 1e6;
    seconds(&usage.user) + seconds(&usage.system)
}

fn cpu_seconds_of(name: &str) -> f64 {
    let out = std::process::Command::new("ps")
        .args(["-A", "-o", "time=,comm="])
        .output()
        .map(|out| String::from_utf8_lossy(&out.stdout).into_owned())
        .unwrap_or_default();
    out.lines()
        .filter(|line| line.trim_end().ends_with(name))
        .filter_map(|line| line.split_whitespace().next())
        .map(|time| {
            time.split(':').fold(0.0, |total, part| {
                total * 60.0 + part.parse::<f64>().unwrap_or(0.0)
            })
        })
        .sum()
}

fn main() {
    let mut args = std::env::args().skip(1);
    let mode = args.next().unwrap_or_else(|| "present".to_owned());
    let seconds: u64 = args.next().and_then(|n| n.parse().ok()).unwrap_or(20);

    let host = cpal::default_host();
    let device = host.default_input_device().expect("a default input");
    let config = device.default_input_config().expect("its format");
    println!(
        "input: {} — {} Hz, {} channel(s), {:?}, buffer {:?}",
        device
            .description()
            .map(|d| d.to_string())
            .unwrap_or_default(),
        config.sample_rate(),
        config.channels(),
        config.sample_format(),
        config.buffer_size()
    );
    let id = device.id().expect("an id").to_string();

    let samples = Arc::new(AtomicU64::new(0));
    let callbacks = Arc::new(AtomicU64::new(0));
    let recorder = present_lib::services::recorder::Recorder::new();
    let mut bare = None;
    let mut agent = None;
    let mut track = None;
    match mode.as_str() {
        "bare" => {
            let (counted, calls) = (Arc::clone(&samples), Arc::clone(&callbacks));
            let mut chosen = config.config();
            if let Some(frames) = std::env::var("BUFFER").ok().and_then(|n| n.parse().ok()) {
                chosen.buffer_size = cpal::BufferSize::Fixed(frames);
            }
            let stream = device
                .build_input_stream(
                    &chosen,
                    move |data: &[f32], _| {
                        counted.fetch_add(data.len() as u64, Ordering::Relaxed);
                        calls.fetch_add(1, Ordering::Relaxed);
                    },
                    |error| eprintln!("stream error: {error}"),
                    None,
                )
                .expect("the stream opens");
            stream.play().expect("it plays");
            bare = Some(stream);
        }
        "present" | "meter" | "monitored" => {
            recorder.set_input(Some(id)).expect("the input is set");
            if mode == "monitored" {
                // Hearing yourself, with every effect the strip has on.
                recorder
                    .set_strip(1, present_lib::services::recorder::ChannelStrip {
                        monitor: true,
                        auto_level: true,
                        noise_gate: true,
                        compressor: true,
                        compressor_amount: 60.0,
                        eq: true,
                        eq_low: 70.0,
                        eq_high: 65.0,
                        ambience: 30.0,
                        reverb: 40.0,
                        ..Default::default()
                    })
                    .expect("the strip is set");
            }
            if mode != "meter" {
                let added = recorder.add_track();
                recorder.start(added.id, 0.0).expect("recording starts");
                track = Some(added.id);
            }
        }
        "agent" => {
            // The Bible and song agents' microphone (`sound::input`): 16 kHz
            // chunks, about ten a second, handed to the page in the app.
            let (counted, calls) = (Arc::clone(&samples), Arc::clone(&callbacks));
            let microphone =
                present_lib::services::sound::input::Microphone::open(Some(&id), move |bytes| {
                    counted.fetch_add(bytes.len() as u64 / 2, Ordering::Relaxed);
                    calls.fetch_add(1, Ordering::Relaxed);
                })
                .expect("the microphone opens");
            agent = Some(microphone);
        }
        other => {
            eprintln!("no mode {other}");
            std::process::exit(2);
        }
    }

    // Settle, then measure.
    std::thread::sleep(Duration::from_secs(2));
    let (own_before, audio_before) = (own_seconds(), cpu_seconds_of("coreaudiod"));
    let started = Instant::now();
    let poll = if mode == "meter" { 120 } else { 60 };
    let mut level = 0.0f32;
    let mut snapshots = 0u32;
    while started.elapsed() < Duration::from_secs(seconds) {
        if mode != "bare" && mode != "agent" {
            let snapshot = recorder.snapshot();
            level = level.max(snapshot.level);
            snapshots += 1;
            // What crosses to the window: serialised as Tauri does.
            let _ = std::hint::black_box(serde_json::to_vec(&snapshot).map(|bytes| bytes.len()));
        }
        std::thread::sleep(Duration::from_millis(poll));
    }
    let wall = started.elapsed().as_secs_f64();
    let (own_after, audio_after) = (own_seconds(), cpu_seconds_of("coreaudiod"));
    if track.is_some() {
        recorder.stop();
    }
    drop(bare);
    drop(agent);

    println!("{mode}, {wall:.1} s:");
    println!(
        "  this process {:.1}% of one core   coreaudiod {:.1}%",
        (own_after - own_before) / wall * 100.0,
        (audio_after - audio_before) / wall * 100.0
    );
    if mode == "bare" || mode == "agent" {
        println!(
            "  {} callbacks a second, {} samples a second",
            callbacks.load(Ordering::Relaxed) as f64 / (wall + 2.0),
            samples.load(Ordering::Relaxed) as f64 / (wall + 2.0)
        );
    } else {
        println!("  {snapshots} snapshots, loudest level {level:.3}");
    }
}
