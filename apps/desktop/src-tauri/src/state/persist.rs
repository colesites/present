//! Reading and writing the small JSON files the Rust core owns.
//!
//! Two rules, both learned from what the Electron build does badly. A file that
//! cannot be parsed must not stop the app starting — an operator ten minutes
//! before a service needs a working app more than they need a saved preference.
//! And every write is atomic, because a crash mid-write that truncates the file
//! would lose the operator's setup silently.

use std::path::{Path, PathBuf};

use serde::{de::DeserializeOwned, Serialize};

use crate::errors::{AppError, AppResult};

/// Load `path`, falling back to `T::default()` for anything that goes wrong.
///
/// `label` names the file in the warning so a log line is actionable.
pub fn load_or_default<T: DeserializeOwned + Default>(path: &Path, label: &str) -> T {
    match std::fs::read_to_string(path) {
        Ok(contents) => match serde_json::from_str::<T>(&contents) {
            Ok(parsed) => parsed,
            Err(error) => {
                tracing::warn!(
                    %error,
                    path = %path.display(),
                    "{label} was unreadable; starting from defaults"
                );
                T::default()
            }
        },
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => T::default(),
        Err(error) => {
            tracing::warn!(
                %error,
                path = %path.display(),
                "could not read {label}; starting from defaults"
            );
            T::default()
        }
    }
}

/// Serialise and replace `path` atomically: write a sibling, then rename.
pub fn save_atomic<T: Serialize>(path: &PathBuf, value: &T) -> AppResult<()> {
    let serialized = serde_json::to_string_pretty(value)
        .map_err(|error| AppError::Invalid(format!("Could not encode preferences: {error}")))?;

    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }

    let temporary = path.with_extension("json.tmp");
    std::fs::write(&temporary, serialized)?;
    std::fs::rename(&temporary, path)?;

    Ok(())
}
