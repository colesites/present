//! A verse and a plain-text slide, drawn by the compositor, to PNGs to look at
//! beside the audience window's own rendering.
//!
//! `cargo run --release --example slide_text_sample -- <out-dir>`

use present_lib::services::compositor::scene::{render, NoMedia};
use present_lib::services::output::OutputScene;

fn main() {
    let out = std::path::PathBuf::from(std::env::args().nth(1).unwrap_or_else(|| ".".to_owned()));

    let verse = OutputScene {
        show_text: true,
        active_slide_id: Some("scripture:0".to_owned()),
        slide_text: Some("For God so loved the world, that he gave his only begotten Son, that whosoever believeth in him should not perish, but have everlasting life.".to_owned()),
        slide_footer: Some("John 3:16 KJV".to_owned()),
        ..OutputScene::default()
    };
    let plain = OutputScene {
        show_text: true,
        active_slide_id: Some("song:1".to_owned()),
        slide_text: Some(
            "Amazing grace, how sweet the sound\nThat saved a wretch like me".to_owned(),
        ),
        ..OutputScene::default()
    };

    for (name, scene) in [("rust-scripture.png", verse), ("rust-plain.png", plain)] {
        let started = std::time::Instant::now();
        let (frame, report) = render(&scene, 1920, 1080, &NoMedia).expect("frame");
        let elapsed = started.elapsed();
        let path = out.join(name);
        std::fs::write(&path, frame.to_png().expect("png")).expect("write");
        println!("{} in {elapsed:?}, {report:?}", path.display());
    }
}
