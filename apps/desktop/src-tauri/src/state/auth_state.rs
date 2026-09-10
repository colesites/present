//! Where the auth session is kept.
//!
//! Electron encrypts it with `safeStorage` into a file under `userData`, and
//! picks a *different* file depending on whether the app is packaged
//! (`session-storage.service.ts:38-41`). On a developer machine that is two
//! sessions, and which one you get depends on how the app was launched — half
//! of known-issues §2, and the reason for "sometimes when I open the app I am
//! signed out".
//!
//! Here there is one session, in the OS keychain, keyed by nothing but the app.
//! macOS and Windows have a real credential store and that is what is used.
//! Linux falls back to a file with `0600` permissions, which is what Electron
//! does on a host where `safeStorage` is unavailable — the keychain crate's
//! Linux backend needs libdbus at build time, and this build has never run on
//! Linux at all.

use std::path::{Path, PathBuf};
use std::sync::RwLock;

use crate::errors::{AppError, AppResult};
use crate::services::auth::{self, StoredSession};

/// Keychain service and account. Stable: changing either signs everyone out.
const KEYCHAIN_SERVICE: &str = "space.multivrs.present";
const KEYCHAIN_ACCOUNT: &str = "desktop-auth-session";
/// The Linux fallback, and the migration source on every platform.
const SESSION_FILE: &str = "desktop-auth-session.json";

/// Where a session is actually written.
///
/// Explicit rather than decided per call, so a test can be given the file
/// backend and be structurally unable to reach the login keychain. An earlier
/// version chose per call and its tests wrote a fake session into the real
/// keychain, which is exactly the kind of thing a security-adjacent module
/// should make impossible rather than merely avoid.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SessionStore {
    /// The OS credential store. macOS and Windows.
    Keychain,
    /// A `0600` file. Linux, and every test.
    File,
}

pub struct AuthState {
    /// Mirrored in memory so the common read — every Convex query's token —
    /// does not hit the keychain, which prompts on some configurations.
    cached: RwLock<Option<StoredSession>>,
    fallback_path: PathBuf,
    store: SessionStore,
}

impl AuthState {
    pub fn load(config_dir: &Path) -> Self {
        let store = if cfg!(any(target_os = "macos", target_os = "windows")) {
            SessionStore::Keychain
        } else {
            SessionStore::File
        };
        let state = Self {
            cached: RwLock::new(None),
            fallback_path: config_dir.join(SESSION_FILE),
            store,
        };

        let restored = state.read_from_store();
        if restored.is_some() {
            tracing::info!("restored a stored desktop session");
        }
        *state.write_cache() = restored;
        state
    }

    pub fn get(&self) -> Option<StoredSession> {
        self.read_cache().clone()
    }

    /// Store a session. Returns false for one that is not usable, matching
    /// `saveStoredDesktopSession`, which the React side treats as a soft
    /// failure rather than an error.
    pub fn set(&self, value: &serde_json::Value) -> AppResult<bool> {
        let Some(session) = auth::normalize_session(value) else {
            return Ok(false);
        };

        let serialized = serde_json::to_string(&session)
            .map_err(|error| AppError::Invalid(format!("Could not encode the session: {error}")))?;

        self.write_to_store(&serialized)?;
        *self.write_cache() = Some(session);
        Ok(true)
    }

    pub fn clear(&self) -> AppResult<bool> {
        *self.write_cache() = None;
        self.delete_from_store();
        // Always true: "there is no session now" is the postcondition, and it
        // holds whether or not there was one to delete.
        Ok(true)
    }

    // --- storage ---------------------------------------------------------

    fn read_from_store(&self) -> Option<StoredSession> {
        if self.store == SessionStore::Keychain {
            if let Some(raw) = self.read_keychain() {
                return parse_session(&raw);
            }
        }

        // Nothing in the credential store. A file may still be there — from a
        // Linux host, or from a build before the keychain was used — so read it
        // and, where there is a keychain, move it in.
        let session = parse_session(&std::fs::read_to_string(&self.fallback_path).ok()?)?;

        if self.store == SessionStore::Keychain {
            if let Ok(serialized) = serde_json::to_string(&session) {
                if self.write_keychain(&serialized).is_ok() {
                    // Only remove the file once the keychain has it.
                    let _ = std::fs::remove_file(&self.fallback_path);
                    tracing::info!("moved the stored session into the OS keychain");
                }
            }
        }

        Some(session)
    }

    fn write_to_store(&self, serialized: &str) -> AppResult<()> {
        match self.store {
            SessionStore::Keychain => self.write_keychain(serialized),
            SessionStore::File => self.write_fallback_file(serialized),
        }
    }

    fn delete_from_store(&self) {
        if self.store == SessionStore::Keychain {
            self.delete_keychain();
        }
        let _ = std::fs::remove_file(&self.fallback_path);
    }

    #[cfg(any(target_os = "macos", target_os = "windows"))]
    fn delete_keychain(&self) {
        if let Ok(entry) = keyring::Entry::new(KEYCHAIN_SERVICE, KEYCHAIN_ACCOUNT) {
            let _ = entry.delete_credential();
        }
    }

    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    fn delete_keychain(&self) {}

    #[cfg(any(target_os = "macos", target_os = "windows"))]
    fn read_keychain(&self) -> Option<String> {
        keyring::Entry::new(KEYCHAIN_SERVICE, KEYCHAIN_ACCOUNT)
            .ok()?
            .get_password()
            .ok()
    }

    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    fn read_keychain(&self) -> Option<String> {
        None
    }

    #[cfg(any(target_os = "macos", target_os = "windows"))]
    fn write_keychain(&self, serialized: &str) -> AppResult<()> {
        let entry = keyring::Entry::new(KEYCHAIN_SERVICE, KEYCHAIN_ACCOUNT)
            .map_err(|error| AppError::Invalid(format!("Keychain unavailable: {error}")))?;
        entry
            .set_password(serialized)
            .map_err(|error| AppError::Invalid(format!("Could not save to the keychain: {error}")))
    }

    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    fn write_keychain(&self, _serialized: &str) -> AppResult<()> {
        Err(AppError::Invalid(
            "No keychain on this platform.".to_owned(),
        ))
    }

    /// The Linux path. Not encrypted — the same position Electron is in when
    /// `safeStorage` is unavailable — but readable only by the user, which is
    /// the protection that actually applies on a single-user machine.
    fn write_fallback_file(&self, serialized: &str) -> AppResult<()> {
        if let Some(parent) = self.fallback_path.parent() {
            std::fs::create_dir_all(parent)?;
        }
        std::fs::write(&self.fallback_path, serialized)?;

        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            std::fs::set_permissions(&self.fallback_path, std::fs::Permissions::from_mode(0o600))?;
        }

        Ok(())
    }

    fn read_cache(&self) -> std::sync::RwLockReadGuard<'_, Option<StoredSession>> {
        self.cached
            .read()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }

    fn write_cache(&self) -> std::sync::RwLockWriteGuard<'_, Option<StoredSession>> {
        self.cached
            .write()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }
}

fn parse_session(raw: &str) -> Option<StoredSession> {
    serde_json::from_str::<serde_json::Value>(raw)
        .ok()
        .as_ref()
        .and_then(auth::normalize_session)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_dir(label: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "present-auth-state-{label}-{}-{:?}",
            std::process::id(),
            std::thread::current().id()
        ));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).expect("temp dir");
        dir
    }

    fn session_value() -> serde_json::Value {
        serde_json::json!({
            "sessionToken": "session-abc",
            "organizations": [],
            "savedAtMs": 1_700_000_000_000i64,
        })
    }

    /// A file-backed store, exercised on every platform.
    ///
    /// The keychain path is deliberately unreachable from here. Touching the
    /// real login keychain from a test suite prompts, leaks state between
    /// runs, and fails on headless CI — and an earlier version of this module
    /// decided the backend per call, which let a test write a fake session
    /// into the developer's own keychain. `SessionStore::File` makes that
    /// impossible rather than merely unlikely.
    fn file_backed(dir: &Path) -> AuthState {
        AuthState {
            cached: RwLock::new(None),
            fallback_path: dir.join(SESSION_FILE),
            store: SessionStore::File,
        }
    }

    #[test]
    fn a_session_written_to_the_file_is_read_back() {
        let dir = temp_dir("file");
        let state = file_backed(&dir);

        state
            .write_fallback_file(&serde_json::to_string(&session_value()).expect("json"))
            .expect("written");

        let restored = state.read_from_store().expect("restored");
        assert_eq!(restored.session_token, "session-abc");
    }

    #[cfg(unix)]
    #[test]
    fn the_fallback_file_is_not_world_readable() {
        use std::os::unix::fs::PermissionsExt;

        let dir = temp_dir("perms");
        let state = file_backed(&dir);
        state.write_fallback_file("{}").expect("written");

        let mode = std::fs::metadata(&state.fallback_path)
            .expect("metadata")
            .permissions()
            .mode();
        assert_eq!(
            mode & 0o777,
            0o600,
            "a session token must not be readable by others"
        );
    }

    #[test]
    fn an_unusable_session_is_refused_rather_than_stored() {
        let dir = temp_dir("refuse");
        let state = file_backed(&dir);

        assert!(!state
            .set(&serde_json::json!({ "organizations": [] }))
            .expect("handled"));
        assert_eq!(state.get(), None);
    }

    #[test]
    fn clearing_leaves_no_session_anywhere() {
        let dir = temp_dir("clear");
        let state = file_backed(&dir);
        state
            .write_fallback_file(&serde_json::to_string(&session_value()).expect("json"))
            .expect("written");
        *state.write_cache() = auth::normalize_session(&session_value());

        assert!(state.clear().expect("cleared"));
        assert_eq!(state.get(), None);
        assert!(!state.fallback_path.exists());
        assert!(state.read_from_store().is_none());
    }

    #[test]
    fn clearing_a_session_that_is_not_there_still_succeeds() {
        let dir = temp_dir("clear-empty");
        let state = file_backed(&dir);

        assert!(state.clear().expect("cleared"));
    }

    #[test]
    fn a_corrupt_stored_session_reads_as_signed_out_rather_than_failing() {
        let dir = temp_dir("corrupt");
        let state = file_backed(&dir);
        std::fs::write(&state.fallback_path, "{ not json").expect("written");

        assert!(state.read_from_store().is_none());
    }

    #[test]
    fn a_stored_session_missing_its_token_reads_as_signed_out() {
        let dir = temp_dir("tokenless");
        let state = file_backed(&dir);
        std::fs::write(&state.fallback_path, r#"{"organizations":[]}"#).expect("written");

        assert!(state.read_from_store().is_none());
    }
}
