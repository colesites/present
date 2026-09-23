//! The system font catalog as the Tauri build lists it, as JSON on stdout.
//!
//! `cargo run --example font_catalog_probe > rust.json`
//!
//! For comparing with the Electron build on the same machine — the only way to
//! know the NSFontManager port and the ported rules agree with font-list on a
//! real font collection — print Electron's catalog from `apps/desktop` and diff:
//!
//! ```text
//! node --input-type=module -e '
//!   import { createRequire } from "node:module";
//!   const fontList = createRequire(import.meta.url)("font-list");
//!   const c = await import("./src/shared/lib/font-catalog.mjs");
//!   console.log(JSON.stringify({
//!     families: c.finishSystemFontFamilies(await fontList.getFonts({ disableQuoting: true })),
//!     faces: c.finishSystemFontFaces(await fontList.getFonts2({ disableQuoting: true })),
//!   }, null, 2));' > electron.json
//! ```

use present_lib::services::{fonts, system_fonts};

fn main() {
    #[cfg(target_os = "macos")]
    let entries = {
        let marker = objc2::MainThreadMarker::new().expect("examples run on the main thread");
        system_fonts::list_families(marker)
    };
    #[cfg(not(target_os = "macos"))]
    let entries = system_fonts::list_families();

    let names: Vec<String> = entries
        .iter()
        .map(|entry| entry.family_name.clone())
        .collect();
    let catalog = serde_json::json!({
        "families": fonts::system_families(&names),
        "faces": fonts::system_faces(&entries),
    });
    println!("{}", serde_json::to_string_pretty(&catalog).expect("json"));
}
