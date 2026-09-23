//! The mini lyrics editor's round trip.
//!
//! A small window that edits one library item's lyrics and saves them back. It
//! cannot do the save itself: the write goes through Convex and the offline
//! queue, both of which live in the operator window's React tree. So the save
//! is a request/response across windows.
//!
//! Electron does that with three channels and a map of pending callbacks in the
//! main process (`window.ipc.ts:142-190`), plus a `mini-lyrics:ready` handshake
//! so the editor can be told what it is editing. Here the handshake is gone —
//! the window asks for its payload the same way a late-joining output window
//! asks for the scene — and the pending saves are a typed map rather than
//! closures keyed by a generated string.
//!
//! The ten-second timeout is kept. An operator who has typed a verse and hit
//! save needs an answer either way; a promise that never settles leaves the
//! editor looking like it is still working.

use std::collections::HashMap;
use std::sync::Mutex;
use std::time::Duration;

use serde::{Deserialize, Serialize};

/// What the editor is editing. `MiniLyricsPayload` in `electron.d.ts:96-101`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MiniLyricsPayload {
    pub library_id: String,
    #[serde(default)]
    pub title: String,
    #[serde(default)]
    pub body: String,
    #[serde(default)]
    pub initial_slide_index: Option<i64>,
}

/// What the editor sends back when the operator saves.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MiniLyricsSavePayload {
    pub library_id: String,
    pub body: String,
}

/// The request forwarded to the operator window, which does the actual write.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MiniLyricsSaveRequest {
    pub request_id: String,
    pub payload: MiniLyricsSavePayload,
}

/// The operator window's answer.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MiniLyricsSaveResponse {
    pub request_id: String,
    pub ok: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

/// What the editor is told. Carries no request id — that is bookkeeping.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MiniLyricsSaveResult {
    pub ok: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

impl MiniLyricsSaveResult {
    pub fn failed(message: impl Into<String>) -> Self {
        Self {
            ok: false,
            error: Some(message.into()),
        }
    }
}

/// How long the editor waits for the operator window to write the lyrics.
/// `window.ipc.ts:157`.
pub const SAVE_TIMEOUT: Duration = Duration::from_secs(10);

/// Open editors and the saves they are waiting on.
#[derive(Default)]
pub struct MiniLyricsState {
    payloads: Mutex<HashMap<String, MiniLyricsPayload>>,
    pending: Mutex<HashMap<String, tokio::sync::oneshot::Sender<MiniLyricsSaveResult>>>,
    next_request: std::sync::atomic::AtomicU64,
}

impl MiniLyricsState {
    pub fn new() -> Self {
        Self::default()
    }

    /// Remember what an editor is for, before its window opens.
    pub fn set_payload(&self, payload: MiniLyricsPayload) {
        self.payloads().insert(payload.library_id.clone(), payload);
    }

    /// What this editor is editing.
    ///
    /// Replaces the `mini-lyrics:ready` handshake: the window asks rather than
    /// announcing itself and waiting to be told.
    pub fn payload(&self, library_id: &str) -> Option<MiniLyricsPayload> {
        self.payloads().get(library_id).cloned()
    }

    pub fn forget(&self, library_id: &str) {
        self.payloads().remove(library_id);
    }

    /// Register a save and get the id to send with it, plus the receiver to
    /// await.
    pub fn begin_save(&self) -> (String, tokio::sync::oneshot::Receiver<MiniLyricsSaveResult>) {
        use std::sync::atomic::Ordering;

        // A counter rather than a random suffix: ids only need to be unique
        // within this process, and a counter cannot collide.
        let request_id = format!("mini_{}", self.next_request.fetch_add(1, Ordering::Relaxed));
        let (sender, receiver) = tokio::sync::oneshot::channel();
        self.pending().insert(request_id.clone(), sender);
        (request_id, receiver)
    }

    /// Settle a save. Returns whether anything was waiting for it.
    ///
    /// A response for an id nobody is waiting on is dropped rather than
    /// treated as an error: it means the editor gave up first, which the
    /// timeout already reported.
    pub fn complete_save(&self, response: MiniLyricsSaveResponse) -> bool {
        let Some(sender) = self.pending().remove(&response.request_id) else {
            return false;
        };
        sender
            .send(MiniLyricsSaveResult {
                ok: response.ok,
                error: response.error,
            })
            .is_ok()
    }

    /// Give up on a save that timed out, so the map does not grow.
    pub fn abandon_save(&self, request_id: &str) {
        self.pending().remove(request_id);
    }

    fn payloads(&self) -> std::sync::MutexGuard<'_, HashMap<String, MiniLyricsPayload>> {
        self.payloads
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }

    #[allow(clippy::type_complexity)]
    fn pending(
        &self,
    ) -> std::sync::MutexGuard<
        '_,
        HashMap<String, tokio::sync::oneshot::Sender<MiniLyricsSaveResult>>,
    > {
        self.pending
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn payload(library_id: &str) -> MiniLyricsPayload {
        MiniLyricsPayload {
            library_id: library_id.to_owned(),
            title: "Amazing Grace".to_owned(),
            body: "Amazing grace, how sweet the sound".to_owned(),
            initial_slide_index: Some(1),
        }
    }

    #[test]
    fn an_editor_can_ask_what_it_is_editing() {
        let state = MiniLyricsState::new();
        state.set_payload(payload("song-1"));

        let found = state.payload("song-1").expect("payload");
        assert_eq!(found.title, "Amazing Grace");
        assert_eq!(found.initial_slide_index, Some(1));
    }

    #[test]
    fn an_editor_with_no_payload_gets_nothing_rather_than_a_guess() {
        let state = MiniLyricsState::new();

        assert_eq!(state.payload("song-1"), None);
    }

    #[test]
    fn closing_an_editor_forgets_its_payload() {
        let state = MiniLyricsState::new();
        state.set_payload(payload("song-1"));
        state.forget("song-1");

        assert_eq!(state.payload("song-1"), None);
    }

    #[test]
    fn two_editors_do_not_share_a_payload() {
        let state = MiniLyricsState::new();
        state.set_payload(payload("song-1"));
        state.set_payload(MiniLyricsPayload {
            library_id: "song-2".to_owned(),
            title: "Psalm 23".to_owned(),
            ..payload("song-2")
        });

        assert_eq!(state.payload("song-1").expect("one").title, "Amazing Grace");
        assert_eq!(state.payload("song-2").expect("two").title, "Psalm 23");
    }

    #[test]
    fn request_ids_do_not_repeat() {
        let state = MiniLyricsState::new();
        let (first, _a) = state.begin_save();
        let (second, _b) = state.begin_save();

        assert_ne!(first, second);
    }

    #[test]
    fn a_save_is_settled_by_its_response() {
        let state = MiniLyricsState::new();
        let (request_id, receiver) = state.begin_save();

        assert!(state.complete_save(MiniLyricsSaveResponse {
            request_id,
            ok: true,
            error: None,
        }));

        let result = tauri::async_runtime::block_on(receiver).expect("settled");
        assert!(result.ok);
    }

    #[test]
    fn a_failure_carries_its_message_back_to_the_editor() {
        let state = MiniLyricsState::new();
        let (request_id, receiver) = state.begin_save();

        state.complete_save(MiniLyricsSaveResponse {
            request_id,
            ok: false,
            error: Some("Offline".to_owned()),
        });

        let result = tauri::async_runtime::block_on(receiver).expect("settled");
        assert!(!result.ok);
        assert_eq!(result.error.as_deref(), Some("Offline"));
    }

    #[test]
    fn a_response_nobody_is_waiting_for_is_dropped() {
        // The editor timed out first; the timeout already told the operator.
        let state = MiniLyricsState::new();

        assert!(!state.complete_save(MiniLyricsSaveResponse {
            request_id: "mini_999".to_owned(),
            ok: true,
            error: None,
        }));
    }

    #[test]
    fn abandoning_a_save_stops_a_late_response_settling_it() {
        let state = MiniLyricsState::new();
        let (request_id, _receiver) = state.begin_save();
        state.abandon_save(&request_id);

        assert!(!state.complete_save(MiniLyricsSaveResponse {
            request_id,
            ok: true,
            error: None,
        }));
    }

    #[test]
    fn two_saves_in_flight_settle_independently() {
        let state = MiniLyricsState::new();
        let (first_id, first) = state.begin_save();
        let (second_id, second) = state.begin_save();

        state.complete_save(MiniLyricsSaveResponse {
            request_id: second_id,
            ok: false,
            error: Some("Second failed".to_owned()),
        });
        state.complete_save(MiniLyricsSaveResponse {
            request_id: first_id,
            ok: true,
            error: None,
        });

        assert!(tauri::async_runtime::block_on(first).expect("settled").ok);
        assert_eq!(
            tauri::async_runtime::block_on(second)
                .expect("settled")
                .error
                .as_deref(),
            Some("Second failed")
        );
    }
}
