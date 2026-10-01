fn main() {
    ffmpeg_search_path();
    decklink_shim();
    service_keys();
    tauri_build::build();
}

/// The keys the listening agents call AssemblyAI and the AI Gateway with
/// (`src/services/service_keys.rs`), from the build's environment.
///
/// Each is kept scrambled against a mask made fresh for every build, so
/// neither is in the app as readable text: `strings` on the binary does not
/// find it. That is all it does. The app has to put the key back together to
/// use it, so anyone who takes the app apart can too; the spending limits on
/// both accounts are what bound the cost of that.
///
/// A key not in the environment builds as none, and the agent says it is not
/// set up rather than failing to build.
fn service_keys() {
    use std::hash::{BuildHasher, Hasher};

    let random = std::collections::hash_map::RandomState::new();
    let mut counter = 0u64;
    let mut mask_byte = || {
        let mut hasher = random.build_hasher();
        hasher.write_u64(counter);
        counter += 1;
        (hasher.finish() & 0xff) as u8
    };

    let mut source = String::from("// Written by build.rs: each key XORed with its mask.\n");
    for (constant, variable) in [
        ("ASSEMBLYAI", "ASSEMBLYAI_API_KEY"),
        ("AI_GATEWAY", "AI_GATEWAY_API_KEY"),
    ] {
        println!("cargo:rerun-if-env-changed={variable}");
        let key = std::env::var(variable).unwrap_or_default();
        let key = key.trim().as_bytes();
        let mask: Vec<u8> = key.iter().map(|_| mask_byte()).collect();
        let scrambled: Vec<u8> = key
            .iter()
            .zip(&mask)
            .map(|(byte, mask)| byte ^ mask)
            .collect();
        source.push_str(&format!(
            "pub const {constant}: (&[u8], &[u8]) = (&{scrambled:?}, &{mask:?});\n"
        ));
    }
    let out = std::path::PathBuf::from(std::env::var("OUT_DIR").expect("OUT_DIR"));
    std::fs::write(out.join("service_keys.rs"), source).expect("service_keys.rs");
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
