//! Finding and loading the NDI runtime.
//!
//! **Loaded at runtime, not linked at build time.** The Rust NDI crates that
//! cover sending and receiving link against an installed NDI SDK and generate
//! bindings with libclang, so every machine that *builds* Present — including
//! the three CI bundle runners — would need the SDK installed. Loading the
//! runtime when NDI is first used keeps the build free of it, and keeps the
//! app launching on a machine that has no NDI at all. That is how Electron
//! behaves today: `libraryLoaded: false` and a message, not a failed start.
//!
//! Where it looks, first match wins:
//!
//! 1. `PRESENT_NDI_LIBRARY`, a full path — for pointing a build at a specific
//!    runtime without moving files.
//! 2. Beside the app, where the bundle puts the copy Present ships — the same
//!    `libndi` the Electron build ships inside grandi.
//! 3. `NDI_RUNTIME_DIR_V6`, which the NDI runtime installer sets on Windows
//!    and Linux (`NDILIB_REDIST_FOLDER` in `Processing.NDI.Lib.h`).
//! 4. Where the NDI Tools installer puts the runtime on macOS.
//! 5. In a debug build only, the copy grandi installed into the workspace's
//!    `node_modules`, so `tauri dev` has NDI without a staging step.
//! 6. The bare library name, left to the platform's own search path.

use std::ffi::CStr;
use std::path::{Path, PathBuf};
use std::sync::Arc;

use libloading::Library;

use super::sys::NdiLib;

/// `NDILIB_LIBRARY_NAME` for this platform.
#[cfg(target_os = "macos")]
pub const LIBRARY_NAME: &str = "libndi.dylib";
#[cfg(target_os = "windows")]
pub const LIBRARY_NAME: &str = "Processing.NDI.Lib.x64.dll";
#[cfg(not(any(target_os = "macos", target_os = "windows")))]
pub const LIBRARY_NAME: &str = "libndi.so.6";

/// The explicit override.
pub const OVERRIDE_ENV: &str = "PRESENT_NDI_LIBRARY";
/// `NDILIB_REDIST_FOLDER`.
pub const RUNTIME_DIR_ENV: &str = "NDI_RUNTIME_DIR_V6";

/// Where the bundle puts the shipped copy, relative to the resource directory.
pub const BUNDLED_SUBDIR: &str = "ndi";

/// Every path worth trying, in order. Pure: the environment and the resource
/// directory are passed in, so the order is testable.
pub fn candidates(
    override_path: Option<&str>,
    resource_dir: Option<&Path>,
    runtime_dir: Option<&str>,
) -> Vec<PathBuf> {
    let mut paths = Vec::new();

    if let Some(path) = override_path.filter(|value| !value.trim().is_empty()) {
        paths.push(PathBuf::from(path));
    }
    if let Some(dir) = resource_dir {
        paths.push(dir.join(BUNDLED_SUBDIR).join(LIBRARY_NAME));
    }
    if let Some(dir) = runtime_dir.filter(|value| !value.trim().is_empty()) {
        paths.push(Path::new(dir).join(LIBRARY_NAME));
    }
    #[cfg(target_os = "macos")]
    paths.push(PathBuf::from("/usr/local/lib").join(LIBRARY_NAME));
    if let Some(dev) = workspace_copy() {
        paths.push(dev);
    }
    paths.push(PathBuf::from(LIBRARY_NAME));

    paths
}

/// grandi's own copy, found from where this crate was compiled. Debug only: a
/// release build must never depend on a developer's checkout.
fn workspace_copy() -> Option<PathBuf> {
    if !cfg!(debug_assertions) {
        return None;
    }
    let arch = match std::env::consts::ARCH {
        "x86_64" => "x64",
        "aarch64" => "arm64",
        other => other,
    };
    let platform = match std::env::consts::OS {
        "macos" => "darwin",
        "windows" => "win32",
        other => other,
    };
    Some(
        Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../../../node_modules/@grandi")
            .join(format!("{platform}-{arch}"))
            .join(LIBRARY_NAME),
    )
}

/// A loaded, initialised runtime and where it came from.
pub struct LoadedRuntime {
    pub lib: Arc<NdiLib>,
    pub path: PathBuf,
    pub version: String,
}

/// Load the first candidate that opens and initialises.
///
/// The error names every path tried and why each failed, because the operator
/// reading it is deciding whether to install NDI Tools, and "not found" alone
/// does not say where it was looked for.
pub fn load(candidates: &[PathBuf]) -> Result<LoadedRuntime, String> {
    let mut failures = Vec::new();

    for path in candidates {
        // A bare name has no parent and is resolved by the platform's search
        // path, so only a full path is checked for existence first — skipping
        // a missing file keeps the error about the paths that were there.
        if path.components().count() > 1 && !path.exists() {
            continue;
        }

        // SAFETY: loading a library runs its initialisers. Every candidate is
        // an NDI runtime location or an explicit override; none comes from the
        // frontend.
        let library = match unsafe { Library::new(path) } {
            Ok(library) => library,
            Err(error) => {
                failures.push(format!("{}: {error}", path.display()));
                continue;
            }
        };

        // SAFETY: the library was found where an NDI runtime lives, and the
        // signatures in `sys` are the SDK's own.
        let lib = match unsafe { NdiLib::resolve(library) } {
            Ok(lib) => lib,
            Err(error) => {
                failures.push(format!("{}: {error}", path.display()));
                continue;
            }
        };

        // SAFETY: no arguments; returns false on a CPU the SDK does not support.
        if !unsafe { (lib.initialize)() } {
            failures.push(format!(
                "{}: NDI could not initialise on this CPU",
                path.display()
            ));
            continue;
        }

        // SAFETY: a static string owned by the library, which is never unloaded.
        let version = unsafe {
            let raw = (lib.version)();
            if raw.is_null() {
                String::new()
            } else {
                CStr::from_ptr(raw).to_string_lossy().into_owned()
            }
        };

        return Ok(LoadedRuntime {
            lib: Arc::new(lib),
            path: path.clone(),
            version,
        });
    }

    if failures.is_empty() {
        Err(format!(
            "The NDI runtime is not installed. Install NDI Tools from ndi.video and restart Present. Looked for {LIBRARY_NAME} in: {}",
            candidates
                .iter()
                .map(|path| path.display().to_string())
                .collect::<Vec<_>>()
                .join(", ")
        ))
    } else {
        Err(format!(
            "The NDI runtime could not be loaded. {}",
            failures.join(" | ")
        ))
    }
}

/// The candidates for this process: the real environment, and the resource
/// directory when the app has one.
pub fn candidates_from_env(resource_dir: Option<&Path>) -> Vec<PathBuf> {
    candidates(
        std::env::var(OVERRIDE_ENV).ok().as_deref(),
        resource_dir,
        std::env::var(RUNTIME_DIR_ENV).ok().as_deref(),
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn an_explicit_override_is_tried_before_anything_shipped_or_installed() {
        let paths = candidates(
            Some("/opt/ndi/libndi-test"),
            Some(Path::new("/App/Resources")),
            Some("/runtime"),
        );
        assert_eq!(paths[0], PathBuf::from("/opt/ndi/libndi-test"));
        assert_eq!(
            paths[1],
            Path::new("/App/Resources").join("ndi").join(LIBRARY_NAME)
        );
        assert_eq!(paths[2], Path::new("/runtime").join(LIBRARY_NAME));
    }

    #[test]
    fn the_shipped_copy_is_preferred_to_an_installed_runtime() {
        // An operator who installs an older NDI Tools must not silently change
        // the runtime a service was rehearsed on.
        let paths = candidates(None, Some(Path::new("/App/Resources")), Some("/runtime"));
        let shipped = paths
            .iter()
            .position(|p| p.starts_with("/App/Resources"))
            .unwrap();
        let installed = paths
            .iter()
            .position(|p| p.starts_with("/runtime"))
            .unwrap();
        assert!(shipped < installed);
    }

    #[test]
    fn blank_environment_values_are_ignored_rather_than_joined_onto_nothing() {
        assert_eq!(
            candidates(Some("  "), None, Some("")),
            candidates(None, None, None)
        );
    }

    #[test]
    fn the_platform_search_path_is_the_last_resort() {
        let paths = candidates(None, None, None);
        assert_eq!(paths.last(), Some(&PathBuf::from(LIBRARY_NAME)));
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn the_ndi_tools_install_location_is_searched_on_macos() {
        let paths = candidates(None, None, None);
        assert!(paths.contains(&PathBuf::from("/usr/local/lib/libndi.dylib")));
    }

    #[test]
    fn nothing_found_names_every_place_it_looked() {
        let error = match load(&[
            PathBuf::from("/nonexistent/one/libndi.dylib"),
            PathBuf::from("/nonexistent/two/libndi.dylib"),
        ]) {
            Ok(_) => panic!("nothing there to load"),
            Err(error) => error,
        };
        assert!(error.contains("not installed"), "{error}");
        assert!(error.contains("/nonexistent/one/libndi.dylib"), "{error}");
        assert!(error.contains("/nonexistent/two/libndi.dylib"), "{error}");
    }

    #[test]
    fn a_file_that_is_not_a_library_is_reported_rather_than_skipped() {
        let dir = std::env::temp_dir().join(format!("present-ndi-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let fake = dir.join(LIBRARY_NAME);
        std::fs::write(&fake, b"not a library").unwrap();

        let error = match load(std::slice::from_ref(&fake)) {
            Ok(_) => panic!("a text file is not an NDI runtime"),
            Err(error) => error,
        };
        assert!(error.contains("could not be loaded"), "{error}");
        assert!(error.contains(&fake.display().to_string()), "{error}");

        std::fs::remove_dir_all(dir).ok();
    }
}
