//! The core's log, kept on disk as well as printed.
//!
//! Until now tracing went only to the terminal, so a problem during a service
//! left nothing behind but the redacted error log (`error_log.rs`), which
//! records errors and nothing that led up to them. This keeps every line the
//! terminal shows in a file per day, the last [`KEEP_DAYS`] of them, where
//! Tauri's own `app_log_dir` would put them.
//!
//! Set up before Tauri exists, so the folder is worked out here the way Tauri
//! works it out.

use std::path::{Path, PathBuf};

use tracing_appender::rolling::{RollingFileAppender, Rotation};

/// The app identifier in `tauri.conf.json`.
pub const IDENTIFIER: &str = "space.multivrs.present";
pub const FILE_PREFIX: &str = "present";
pub const FILE_SUFFIX: &str = "log";
/// Two weeks: a Sunday's log is still there the Sunday after.
pub const KEEP_DAYS: usize = 14;

/// `PathResolver::app_log_dir`: `~/Library/Logs/<identifier>` on macOS,
/// `<local data>/<identifier>/logs` elsewhere.
pub fn log_dir() -> Option<PathBuf> {
    #[cfg(target_os = "macos")]
    {
        dirs::home_dir().map(|home| home.join("Library/Logs").join(IDENTIFIER))
    }
    #[cfg(not(target_os = "macos"))]
    {
        dirs::data_local_dir().map(|dir| dir.join(IDENTIFIER).join("logs"))
    }
}

/// A daily file in `dir`, pruned to [`KEEP_DAYS`]. Written synchronously: the
/// app exits without unwinding, and a buffered writer would lose the lines
/// closest to whatever ended it.
pub fn appender(dir: &Path) -> Result<RollingFileAppender, String> {
    std::fs::create_dir_all(dir).map_err(|error| error.to_string())?;
    RollingFileAppender::builder()
        .rotation(Rotation::DAILY)
        .filename_prefix(FILE_PREFIX)
        .filename_suffix(FILE_SUFFIX)
        .max_log_files(KEEP_DAYS)
        .build(dir)
        .map_err(|error| error.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[cfg(target_os = "macos")]
    #[test]
    fn the_folder_is_where_tauri_puts_app_logs() {
        let dir = log_dir().unwrap();
        assert!(
            dir.ends_with("Library/Logs/space.multivrs.present"),
            "{dir:?}"
        );
    }

    #[test]
    fn the_identifier_matches_the_app_config() {
        let config = include_str!("../../tauri.conf.json");
        assert!(config.contains(&format!("\"identifier\": \"{IDENTIFIER}\"")));
    }

    #[test]
    fn lines_land_in_a_dated_file() {
        use tracing_subscriber::prelude::*;

        let dir = std::env::temp_dir().join(format!("present-log-files-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        let subscriber = tracing_subscriber::registry().with(
            tracing_subscriber::fmt::layer()
                .with_ansi(false)
                .with_writer(appender(&dir).unwrap()),
        );
        tracing::subscriber::with_default(subscriber, || {
            tracing::info!(label = "main", "window shown");
        });

        let files: Vec<_> = std::fs::read_dir(&dir).unwrap().flatten().collect();
        assert_eq!(files.len(), 1);
        let name = files[0].file_name().to_string_lossy().into_owned();
        assert!(
            name.starts_with("present.") && name.ends_with(".log"),
            "{name}"
        );
        let contents = std::fs::read_to_string(files[0].path()).unwrap();
        assert!(
            contents.contains("window shown") && contents.contains("label=\"main\""),
            "{contents}"
        );
        assert!(
            !contents.contains('\u{1b}'),
            "no terminal colour codes in the file"
        );
        let _ = std::fs::remove_dir_all(&dir);
    }
}
