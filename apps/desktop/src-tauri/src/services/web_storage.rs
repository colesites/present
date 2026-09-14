//! The browser-storage keys the Tauri build keeps in Rust, and reading the
//! Electron build's copy of them once.
//!
//! Known-issues §2. `localStorage` is partitioned by origin, so every build of
//! Present had its own settings, layout, timers and templates. Under Tauri the
//! durable copy is `web-storage.json` (`state/web_storage_state.rs`), and
//! `localStorage` stays the synchronous cache the components read. Which keys,
//! and what a window does at start, is `src/shared/lib/web-storage.mjs`.
//!
//! **Electron's copy** is Chromium's localStorage: a LevelDB under the app's
//! data folder, one entry per key, named `_<origin>\0<key>`. Key and value each
//! start with a byte saying how the rest is encoded — `1` for Latin-1, `0` for
//! UTF-16LE. It is read from a copy, so the Electron build's own files are never
//! opened, locked or compacted.
//!
//! No Tauri types.

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

use crate::errors::{AppError, AppResult};

pub const MIRRORED_PREFIXES: [&str; 2] = ["present-", "present:"];

/// See `EXCLUDED_KEYS` in `web-storage.mjs` for why each is left out.
pub const EXCLUDED_KEYS: [&str; 7] = [
    "present-looks-config",
    "present-service-state",
    "present-desktop-session",
    "present-local-data-v1",
    "present-local-data-meta-v1",
    "present-sync-queue-v1",
    "present-sync-id-map-v1",
];

/// The packaged Electron build's folder, under the OS's per-user application
/// data (Electron's `appData`), and its renderer's origin.
pub const ELECTRON_APP_FOLDER: &str = "Present";
pub const ELECTRON_ORIGIN: &str = "app://app";

pub fn is_mirrored_key(key: &str) -> bool {
    MIRRORED_PREFIXES
        .iter()
        .any(|prefix| key.starts_with(prefix))
        && !EXCLUDED_KEYS.contains(&key)
}

/// Where Chromium keeps localStorage for a data folder.
pub fn chromium_local_storage(user_data: &Path) -> PathBuf {
    user_data.join("Local Storage").join("leveldb")
}

/// A Chromium localStorage string: a format byte, then the text.
pub fn decode_chromium_string(bytes: &[u8]) -> Option<String> {
    let (format, rest) = bytes.split_first()?;
    match format {
        1 => Some(rest.iter().map(|byte| char::from(*byte)).collect()),
        0 if rest.len() % 2 == 0 => {
            let units: Vec<u16> = rest
                .chunks_exact(2)
                .map(|pair| u16::from_le_bytes([pair[0], pair[1]]))
                .collect();
            Some(String::from_utf16_lossy(&units))
        }
        _ => None,
    }
}

/// The key of a localStorage entry for `origin`, or `None` for another
/// origin's entry or Chromium's own bookkeeping (`VERSION`, `META:…`).
pub fn decode_chromium_key(raw: &[u8], origin: &str) -> Option<String> {
    let name = raw
        .strip_prefix(b"_")?
        .strip_prefix(origin.as_bytes())?
        .strip_prefix(b"\0")?;
    decode_chromium_string(name)
}

/// Every mirrored key the Electron build's localStorage holds for `origin`.
///
/// An absent folder is an empty result: most machines never ran Electron.
pub fn read_chromium_local_storage(
    leveldb: &Path,
    origin: &str,
) -> AppResult<BTreeMap<String, String>> {
    use rusty_leveldb::{LdbIterator, Options, DB};

    if !leveldb.is_dir() {
        return Ok(BTreeMap::new());
    }

    let copy = std::env::temp_dir().join(format!(
        "present-electron-local-storage-{}-{}",
        std::process::id(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map_or(0, |elapsed| elapsed.as_nanos())
    ));
    copy_folder(leveldb, &copy)?;

    let result = (|| {
        let options = Options {
            create_if_missing: false,
            ..Options::default()
        };
        let mut database = DB::open(&copy, options).map_err(|error| {
            AppError::Invalid(format!("Could not open the Electron settings: {error}"))
        })?;
        let mut entries = database.new_iter().map_err(|error| {
            AppError::Invalid(format!("Could not read the Electron settings: {error}"))
        })?;

        let mut items = BTreeMap::new();
        while entries.advance() {
            let Some((raw_key, raw_value)) = entries.current() else {
                continue;
            };
            let Some(key) = decode_chromium_key(&raw_key, origin) else {
                continue;
            };
            if !is_mirrored_key(&key) {
                continue;
            }
            if let Some(value) = decode_chromium_string(&raw_value) {
                items.insert(key, value);
            }
        }
        Ok(items)
    })();

    let _ = std::fs::remove_dir_all(&copy);
    result
}

/// Copy the files directly in `from` — a LevelDB folder is flat — leaving out
/// the lock the running Electron build may hold.
fn copy_folder(from: &Path, to: &Path) -> AppResult<()> {
    std::fs::create_dir_all(to)?;
    for entry in std::fs::read_dir(from)? {
        let entry = entry?;
        if !entry.file_type()?.is_file() || entry.file_name() == "LOCK" {
            continue;
        }
        std::fs::copy(entry.path(), to.join(entry.file_name()))?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn present_and_present_colon_keys_are_mirrored_and_others_and_the_excluded_are_not() {
        for key in [
            "present-settings",
            "present-timer-state-v1",
            "present:resizable:present-main-layout-v13",
            "present-props-cache-v1:j974y6jtddmkntznebptvfy70986qr3s",
        ] {
            assert!(is_mirrored_key(key), "{key}");
        }
        for key in [
            "present-looks-config",
            "present-service-state",
            "present-desktop-session",
            "present-local-data-v1",
            "present-local-data-meta-v1",
            "present-sync-queue-v1",
            "present-sync-id-map-v1",
            "__clerk_environment",
            "presentation",
            "Present-settings",
        ] {
            assert!(!is_mirrored_key(key), "{key}");
        }
    }

    #[test]
    fn chromium_strings_are_latin1_or_utf16le_by_their_first_byte() {
        assert_eq!(
            decode_chromium_string(b"\x01caf\xe9").as_deref(),
            Some("café")
        );
        let utf16: Vec<u8> = std::iter::once(0u8)
            .chain("😀 ok".encode_utf16().flat_map(u16::to_le_bytes))
            .collect();
        assert_eq!(decode_chromium_string(&utf16).as_deref(), Some("😀 ok"));
        assert_eq!(
            decode_chromium_string(b"\x00abc"),
            None,
            "odd UTF-16 is not a string"
        );
        assert_eq!(decode_chromium_string(b"\x02x"), None);
        assert_eq!(decode_chromium_string(b""), None);
    }

    #[test]
    fn only_this_origins_entries_are_keys() {
        assert_eq!(
            decode_chromium_key(b"_app://app\0\x01present-settings", "app://app").as_deref(),
            Some("present-settings")
        );
        assert_eq!(
            decode_chromium_key(b"_app://-\0\x01present-settings", "app://app"),
            None
        );
        assert_eq!(
            decode_chromium_key(b"_app://apple\0\x01x", "app://app"),
            None
        );
        assert_eq!(decode_chromium_key(b"META:app://app", "app://app"), None);
        assert_eq!(decode_chromium_key(b"VERSION", "app://app"), None);
    }

    #[test]
    fn a_machine_that_never_ran_electron_imports_nothing() {
        let missing = std::env::temp_dir()
            .join("present-no-electron-here")
            .join("leveldb");
        assert!(read_chromium_local_storage(&missing, ELECTRON_ORIGIN)
            .unwrap()
            .is_empty());
    }

    #[test]
    fn a_leveldb_written_the_way_chromium_writes_it_is_read_back() {
        use rusty_leveldb::{Options, DB};

        let folder =
            std::env::temp_dir().join(format!("present-chromium-ls-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&folder);
        {
            let mut database = DB::open(&folder, Options::default()).unwrap();
            let put =
                |database: &mut DB, key: &[u8], value: &[u8]| database.put(key, value).unwrap();
            put(&mut database, b"VERSION", b"1");
            put(&mut database, b"META:app://app", b"\x08\x01");
            put(
                &mut database,
                b"_app://app\0\x01present-settings",
                b"\x01{\"theme\":\"dark\"}",
            );
            let utf16: Vec<u8> = std::iter::once(0u8)
                .chain("[\"é\"]".encode_utf16().flat_map(u16::to_le_bytes))
                .collect();
            put(
                &mut database,
                b"_app://app\0\x01present-browser-history-v1",
                &utf16,
            );
            put(
                &mut database,
                b"_app://app\0\x01present-looks-config",
                b"\x01{}",
            );
            put(
                &mut database,
                b"_app://app\0\x01__clerk_environment",
                b"\x01{}",
            );
            put(
                &mut database,
                b"_http://localhost:3000\0\x01present-settings",
                b"\x01dev",
            );
            database.flush().unwrap();
        }
        std::fs::write(folder.join("LOCK"), b"").unwrap();

        let items = read_chromium_local_storage(&folder, ELECTRON_ORIGIN).unwrap();
        assert_eq!(
            items,
            BTreeMap::from([
                (
                    "present-browser-history-v1".to_owned(),
                    "[\"é\"]".to_owned()
                ),
                (
                    "present-settings".to_owned(),
                    "{\"theme\":\"dark\"}".to_owned()
                ),
            ])
        );
        let _ = std::fs::remove_dir_all(folder);
    }
}
