//! Render a sample audience frame and write it out.
//!
//! `cargo run --example render_sample -- [path]`
//!
//! The pixel tests assert about ink and colour, which is what keeps them
//! independent of which fonts a machine has. They cannot tell you whether the
//! result *looks right*. This can: it produces a frame somebody can open.
//!
//! Kept as an example rather than a test because its output is for a person,
//! and because ADR-001 requires the Rust and React renderings of the same slide
//! to stay visually identical — which is a judgement only a human eye makes.

use present_lib::services::compositor::{render, NoMedia};
use present_lib::services::output::OutputScene;

fn main() {
    let path = std::env::args()
        .nth(1)
        .unwrap_or_else(|| "output-frame.png".to_owned());

    let scene = OutputScene {
        show_text: true,
        show_media: true,
        slide_canvas_size: Some("1920x1080".to_owned()),
        slide_background_color: Some("#0d1b2a".to_owned()),
        slide_elements: Some(serde_json::json!([
            // A lower-third band, to exercise shapes, radius and opacity.
            {
                "id": "band", "type": "shape",
                "x": 160.0, "y": 780.0, "width": 1600.0, "height": 160.0,
                "style": {
                    "backgroundColor": "#1b263b",
                    "borderColor": "#415a77",
                    "borderWidth": 3.0,
                    "borderRadius": 24.0,
                    "opacity": 0.85
                }
            },
            // The verse.
            {
                "id": "verse", "type": "text",
                "x": 160.0, "y": 260.0, "width": 1600.0, "height": 420.0,
                "content": "Amazing grace, how sweet the sound\nThat saved a wretch like me",
                "style": {
                    "fontSize": 84.0,
                    "color": "#ffffff",
                    "textAlign": "center",
                    "verticalAlign": "middle",
                    "fontWeight": "600"
                }
            },
            // The footer, in the band.
            {
                "id": "footer", "type": "text",
                "x": 200.0, "y": 800.0, "width": 1520.0, "height": 120.0,
                "content": "John Newton, 1779",
                "style": {
                    "fontSize": 40.0,
                    "color": "#a9c0d8",
                    "textAlign": "center",
                    "verticalAlign": "middle",
                    "fontStyle": "italic"
                }
            },
            // Left for the webview layer above (ADR-001's amendment).
            {
                "id": "yt", "type": "web",
                "x": 1500.0, "y": 60.0, "width": 360.0, "height": 202.0,
                "content": "https://youtu.be/example"
            }
        ])),
        ..OutputScene::default()
    };

    // The first render pays for the system font scan, which happens once per
    // process. NDI cares about every frame after that, so both are reported:
    // one number is a startup cost and the other is the frame budget.
    let cold_started = std::time::Instant::now();
    let Some((frame, report)) = render(&scene, 1920, 1080, &NoMedia) else {
        eprintln!("could not render the frame");
        std::process::exit(1);
    };
    let cold = cold_started.elapsed();

    let warm_started = std::time::Instant::now();
    let runs = 20;
    for _ in 0..runs {
        let _ = render(&scene, 1920, 1080, &NoMedia);
    }
    let elapsed = warm_started.elapsed() / runs;

    let Some(png) = frame.to_png() else {
        eprintln!("could not encode the frame");
        std::process::exit(1);
    };
    if let Err(error) = std::fs::write(&path, png) {
        eprintln!("could not write {path}: {error}");
        std::process::exit(1);
    }

    println!("wrote {path}");
    println!(
        "  {}x{}  first frame {:.1} ms (font scan), then {:.1} ms",
        frame.width(),
        frame.height(),
        cold.as_secs_f64() * 1000.0,
        elapsed.as_secs_f64() * 1000.0
    );
    let budget = 1000.0 / 30.0;
    println!(
        "  30 fps budget is {:.1} ms — {}",
        budget,
        if elapsed.as_secs_f64() * 1000.0 <= budget {
            "within it"
        } else {
            "OVER"
        }
    );
    println!(
        "  drawn: {}, deferred to the webview: {}",
        report.elements_drawn, report.elements_deferred
    );
    println!("  BGRA for NDI: {} bytes", frame.to_bgra().len());
}
