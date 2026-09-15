//! A PowerPoint file as the Tauri importer reads it, as JSON on stdout.
//!
//! `cargo run --example pptx_import_probe -- deck.pptx > rust.json`
//!
//! For comparing with the Electron importer on decks that cannot be committed
//! as fixtures: `node scripts/pptx-expected.mjs`'s `importWithElectron` gives
//! the other side.

fn main() {
    let Some(path) = std::env::args().nth(1) else {
        eprintln!("usage: pptx_import_probe <deck.pptx>");
        std::process::exit(2);
    };
    match present_lib::services::pptx::import(std::path::Path::new(&path)) {
        Ok(presentation) => println!("{presentation}"),
        Err(error) => {
            eprintln!("{error}");
            std::process::exit(1);
        }
    }
}
