//! NDI end to end on this machine: discover, connect, send, receive, and
//! reconnect after the source goes away.
//!
//! The unit tests in `services::ndi` pin struct layouts and rules; they cannot
//! say whether the SDK agrees. This does, against the real runtime, with a
//! Rust sender and a Rust receiver in one process and the network stack
//! between them. It is the evidence for Stage 6's gate at the library level.
//!
//! Ignored by default because it needs an NDI runtime and a working local
//! network stack, which CI runners do not have:
//!
//! ```text
//! cargo test --test ndi_loopback -- --ignored --nocapture
//! PRESENT_NDI_LIBRARY=/path/to/libndi.dylib cargo test --test ndi_loopback -- --ignored --nocapture
//! ```

use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Arc;
use std::thread;
use std::time::{Duration, Instant};

use present_lib::services::ndi::finder::Finder;
use present_lib::services::ndi::receiver::{Capture, Receiver};
use present_lib::services::ndi::rules::{self, Source};
use present_lib::services::ndi::sender::Sender;
use present_lib::services::ndi::{library, NdiLib};

const WIDTH: u32 = 640;
const HEIGHT: u32 = 360;
/// `NDIlib_recv_bandwidth_highest`: full resolution, so pixels can be compared.
const BANDWIDTH_HIGHEST: i32 = 100;

/// Four quadrants, BGRA: red, green / blue, white. Distinct in every channel,
/// so a swapped channel order or a flipped frame lands on the wrong colour.
const QUADRANTS: [[u8; 4]; 4] = [
    [0, 0, 255, 255],     // top left: red
    [0, 255, 0, 255],     // top right: green
    [255, 0, 0, 255],     // bottom left: blue
    [255, 255, 255, 255], // bottom right: white
];

fn pattern() -> Vec<u8> {
    let mut pixels = Vec::with_capacity((WIDTH * HEIGHT * 4) as usize);
    for y in 0..HEIGHT {
        for x in 0..WIDTH {
            let quadrant = usize::from(y >= HEIGHT / 2) * 2 + usize::from(x >= WIDTH / 2);
            pixels.extend_from_slice(&QUADRANTS[quadrant]);
        }
    }
    pixels
}

struct Sending {
    stop: Arc<AtomicBool>,
    sent: Arc<AtomicU64>,
    handle: Option<thread::JoinHandle<()>>,
}

impl Sending {
    fn start(lib: Arc<NdiLib>, name: &str) -> Self {
        let stop = Arc::new(AtomicBool::new(false));
        let sent = Arc::new(AtomicU64::new(0));
        let mut sender = Sender::new(lib, name, rules::DEFAULT_GROUP_NAME).expect("create sender");
        let (stop_flag, counter) = (stop.clone(), sent.clone());
        let handle = thread::spawn(move || {
            let frame = pattern();
            while !stop_flag.load(Ordering::Relaxed) {
                sender
                    .send_bgra(WIDTH, HEIGHT, &frame)
                    .expect("send a frame");
                counter.fetch_add(1, Ordering::Relaxed);
            }
            // Dropping the sender here is the source leaving the network.
        });
        Self {
            stop,
            sent,
            handle: Some(handle),
        }
    }

    fn frames(&self) -> u64 {
        self.sent.load(Ordering::Relaxed)
    }
}

impl Drop for Sending {
    fn drop(&mut self) {
        self.stop.store(true, Ordering::Relaxed);
        if let Some(handle) = self.handle.take() {
            handle.join().expect("sender thread");
        }
    }
}

fn discover(lib: &Arc<NdiLib>, name: &str, within: Duration) -> Option<(Source, Duration)> {
    // NDI publishes a source as `MACHINE (name)`.
    let suffix = format!("({name})");
    let started = Instant::now();
    let mut finder = Finder::new(lib.clone(), None).expect("start discovery");
    let mut seen = Vec::new();
    while started.elapsed() < within {
        finder.wait(Duration::from_millis(250));
        seen = rules::order_sources(finder.sources());
        if let Some(found) = seen.iter().find(|source| source.name.ends_with(&suffix)) {
            return Some((found.clone(), started.elapsed()));
        }
    }
    println!("not found; discovery saw: {seen:?}");
    None
}

/// The next video frame within `within`, as tight pixels.
fn next_frame(receiver: &mut Receiver, within: Duration) -> Option<(i32, i32, u32, Vec<u8>)> {
    let started = Instant::now();
    while started.elapsed() < within {
        if let Capture::Video(video) = receiver.capture(Duration::from_millis(200)) {
            let pixels = video.tight_pixels()?;
            return Some((video.width(), video.height(), video.fourcc(), pixels));
        }
    }
    None
}

fn pixel(pixels: &[u8], width: i32, x: i32, y: i32) -> [u8; 4] {
    let at = ((y * width + x) * 4) as usize;
    [pixels[at], pixels[at + 1], pixels[at + 2], pixels[at + 3]]
}

fn assert_close(actual: [u8; 4], expected: [u8; 4], what: &str) {
    // NDI's codec is lossy. A flat colour survives within a few levels; a
    // wrong channel is off by two hundred.
    for channel in 0..3 {
        let difference = i32::from(actual[channel]).abs_diff(i32::from(expected[channel]));
        assert!(
            difference <= 24,
            "{what}: expected BGR {:?}, received {:?}",
            &expected[..3],
            &actual[..3]
        );
    }
}

#[test]
#[ignore = "needs the NDI runtime; run with --ignored"]
fn a_frame_sent_over_ndi_arrives_intact_and_the_receiver_survives_the_source_restarting() {
    let runtime = library::load(&library::candidates_from_env(None)).expect("load the NDI runtime");
    println!("runtime: {} ({})", runtime.path.display(), runtime.version);
    let lib = runtime.lib;

    // A name nothing else on the network is using.
    let name = format!("Present Loopback {}", std::process::id());

    // --- discovery ---------------------------------------------------------
    let sending = Sending::start(lib.clone(), &name);
    let (source, found_after) =
        discover(&lib, &name, Duration::from_secs(15)).expect("the sender is discovered");
    println!(
        "discovered \"{}\" at {:?} after {found_after:?}",
        source.name, source.url_address
    );
    assert!(source.name.contains(&name), "NDI prefixes the machine name");

    // --- connect -----------------------------------------------------------
    let mut receiver = Receiver::connect(
        lib.clone(),
        &source,
        rules::INPUT_COLOR_FORMAT_BGRX_BGRA,
        BANDWIDTH_HIGHEST,
        "Present Loopback Receiver",
    )
    .expect("connect a receiver");

    // --- output ------------------------------------------------------------
    let (width, height, fourcc, pixels) =
        next_frame(&mut receiver, Duration::from_secs(10)).expect("a frame arrives");
    println!(
        "received {width}x{height} fourcc={:?} after {} frames sent",
        String::from_utf8_lossy(&fourcc.to_le_bytes()),
        sending.frames()
    );
    assert_eq!((width, height), (WIDTH as i32, HEIGHT as i32));
    assert_eq!(pixels.len(), (WIDTH * HEIGHT * 4) as usize);
    let (quarter_x, quarter_y) = (width / 4, height / 4);
    assert_close(
        pixel(&pixels, width, quarter_x, quarter_y),
        QUADRANTS[0],
        "top left",
    );
    assert_close(
        pixel(&pixels, width, 3 * quarter_x, quarter_y),
        QUADRANTS[1],
        "top right",
    );
    assert_close(
        pixel(&pixels, width, quarter_x, 3 * quarter_y),
        QUADRANTS[2],
        "bottom left",
    );
    assert_close(
        pixel(&pixels, width, 3 * quarter_x, 3 * quarter_y),
        QUADRANTS[3],
        "bottom right",
    );
    assert_eq!(
        receiver.connections(),
        1,
        "the receiver reports its connection"
    );

    // --- the pace the SDK clocks the sender at -----------------------------
    let (before, clock) = (sending.frames(), Instant::now());
    thread::sleep(Duration::from_secs(2));
    let rate = (sending.frames() - before) as f64 / clock.elapsed().as_secs_f64();
    println!("sender rate while connected: {rate:.1} fps");
    assert!(
        (25.0..=35.0).contains(&rate),
        "clock_video should hold the sender near 30 fps, got {rate:.1}"
    );

    // --- disconnect --------------------------------------------------------
    drop(sending);
    let gone = Instant::now();
    while receiver.connections() > 0 && gone.elapsed() < Duration::from_secs(10) {
        let _ = receiver.capture(Duration::from_millis(100));
    }
    println!("receiver saw the source leave after {:?}", gone.elapsed());
    assert_eq!(
        receiver.connections(),
        0,
        "the receiver notices the source is gone"
    );

    // --- reconnect ---------------------------------------------------------
    // The same name comes back. The receiver is not recreated: NDI reconnects
    // by name on its own, which is what a camera rebooting mid-service needs.
    let restarted = Instant::now();
    let _sending_again = Sending::start(lib.clone(), &name);
    let (width, height, _, pixels) = next_frame(&mut receiver, Duration::from_secs(20))
        .expect("the same receiver picks the source up again");
    println!(
        "frames resumed {:?} after the source restarted",
        restarted.elapsed()
    );
    assert_eq!((width, height), (WIDTH as i32, HEIGHT as i32));
    assert_close(
        pixel(&pixels, width, quarter_x, quarter_y),
        QUADRANTS[0],
        "top left after reconnect",
    );
}
