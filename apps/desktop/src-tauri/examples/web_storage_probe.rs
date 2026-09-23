//! What the Tauri build would import from the Electron build's localStorage:
//! each mirrored key and the length of its value, never the value itself.
//!
//! `cargo run --example web_storage_probe [electron-user-data-folder]`
//!
//! Defaults to the packaged Electron build's folder for this user.

use present_lib::services::web_storage;

fn main() {
    let user_data = std::env::args()
        .nth(1)
        .map(std::path::PathBuf::from)
        .unwrap_or_else(|| {
            let home = std::env::var_os("HOME")
                .map(std::path::PathBuf::from)
                .unwrap_or_default();
            if cfg!(target_os = "macos") {
                home.join("Library/Application Support")
                    .join(web_storage::ELECTRON_APP_FOLDER)
            } else {
                home.join(".config").join(web_storage::ELECTRON_APP_FOLDER)
            }
        });
    let leveldb = web_storage::chromium_local_storage(&user_data);
    match web_storage::read_chromium_local_storage(&leveldb, web_storage::ELECTRON_ORIGIN) {
        Ok(items) => {
            println!("{} mirrored key(s) in {}", items.len(), leveldb.display());
            for (key, value) in items {
                println!("  {key}\t{} chars", value.chars().count());
            }
        }
        Err(error) => eprintln!("could not read {}: {error}", leveldb.display()),
    }
}
