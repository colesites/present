fn main() {
    ffmpeg_search_path();
    decklink_shim();
    tauri_build::build();
}

/// SDI out on a Mac (`src/services/sdi.rs`): a small C++ layer over
/// Blackmagic's DeckLink API, built with the SDK's headers and its loader,
/// which finds Desktop Video in `/Library/Frameworks` at run time. Nothing is
/// linked against Desktop Video, so a Mac without it runs Present as before.
fn decklink_shim() {
    if std::env::var("CARGO_CFG_TARGET_OS").as_deref() != Ok("macos") {
        return;
    }
    println!("cargo:rerun-if-changed=sdi");
    cc::Build::new()
        .cpp(true)
        .std("c++17")
        .include("sdi/decklink-sdk")
        .file("sdi/decklink_shim.cpp")
        .file("sdi/decklink-sdk/DeckLinkAPIDispatch.cpp")
        // The SDK's own sources are Blackmagic's, not held to this crate's warnings.
        .warnings(false)
        .compile("present_decklink");
    println!("cargo:rustc-link-lib=framework=CoreFoundation");
}

/// Where the app finds the FFmpeg libraries it ships (ADR-003).
///
/// macOS: `Contents/Frameworks`, where the bundle copies them; the libraries
/// are named `@rpath/…` by `scripts/build-ffmpeg.sh`. Linux: the `.deb`'s and
/// the AppImage's `lib/present-ffmpeg`, beside `bin/`. Windows needs nothing:
/// the DLLs sit beside the executable.
///
/// A build against `FFMPEG_DIR` also looks there, so `cargo test` and
/// `cargo run` work against the LGPL build without bundling — except when
/// `scripts/tauri-build.mjs` builds the bundle, which must not carry a path
/// from the machine that built it.
fn ffmpeg_search_path() {
    println!("cargo:rerun-if-env-changed=FFMPEG_DIR");
    println!("cargo:rerun-if-env-changed=PRESENT_BUNDLE_BUILD");
    let target = std::env::var("CARGO_CFG_TARGET_OS").unwrap_or_default();
    let rpath = |path: &str| println!("cargo:rustc-link-arg=-Wl,-rpath,{path}");
    match target.as_str() {
        "macos" => rpath("@executable_path/../Frameworks"),
        "linux" => rpath("$ORIGIN/../lib/present-ffmpeg"),
        _ => {}
    }
    let bundling = std::env::var_os("PRESENT_BUNDLE_BUILD").is_some();
    if let (Some(dir), false, true) = (
        std::env::var_os("FFMPEG_DIR"),
        bundling,
        matches!(target.as_str(), "macos" | "linux"),
    ) {
        rpath(&std::path::Path::new(&dir).join("lib").to_string_lossy());
    }
}
