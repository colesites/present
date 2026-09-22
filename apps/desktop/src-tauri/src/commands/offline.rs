//! The offline library, as the React tree reaches it.
//!
//! Thin on purpose: the rules about what a library item is live in the React
//! types, and `services::store` keeps rows without opinions about them.

use tauri::State;

use crate::errors::AppResult;
use crate::services::store::{self, Document, Kind, QueuedChange};
use crate::state::StoreState;

#[tauri::command]
pub async fn offline_list(
    state: State<'_, StoreState>,
    workspace: String,
    kind: Kind,
) -> AppResult<Vec<Document>> {
    state.with(|store| store.list(&workspace, kind))
}

#[tauri::command]
pub async fn offline_put(
    state: State<'_, StoreState>,
    workspace: String,
    kind: Kind,
    id: String,
    body: serde_json::Value,
    now_ms: Option<i64>,
) -> AppResult<Document> {
    let at = now_ms.unwrap_or_else(now);
    state.with(|store| store.put(&workspace, kind, &id, &body, at))
}

#[tauri::command]
pub async fn offline_remove(
    state: State<'_, StoreState>,
    workspace: String,
    kind: Kind,
    id: String,
) -> AppResult<bool> {
    state.with(|store| store.remove(&workspace, kind, &id))
}

/// Make a workspace's documents of one kind exactly these — what arrives from
/// Convex — in one transaction.
#[tauri::command]
pub async fn offline_replace(
    state: State<'_, StoreState>,
    workspace: String,
    kind: Kind,
    documents: Vec<(String, serde_json::Value)>,
    now_ms: Option<i64>,
) -> AppResult<usize> {
    let at = now_ms.unwrap_or_else(now);
    state.with(|store| store.replace(&workspace, kind, &documents, at))
}

#[tauri::command]
pub async fn offline_enqueue(state: State<'_, StoreState>, change: QueuedChange) -> AppResult<()> {
    state.with(|store| store.enqueue(&change))
}

/// The changes waiting, for one workspace or — without one — every workspace
/// this machine holds, which is what the sync reads when it wakes up.
#[tauri::command]
pub async fn offline_queued(
    state: State<'_, StoreState>,
    workspace: Option<String>,
    limit: Option<usize>,
) -> AppResult<Vec<QueuedChange>> {
    let limit = limit.unwrap_or(500).clamp(1, 10_000);
    state.with(|store| store.queued(workspace.as_deref(), limit))
}

/// Every workspace this machine holds anything for, so the app can read its
/// library back before it has been told which workspaces exist.
#[tauri::command]
pub async fn offline_workspaces(state: State<'_, StoreState>) -> AppResult<Vec<String>> {
    state.with(|store| store.workspaces())
}

#[tauri::command]
pub async fn offline_dequeue(state: State<'_, StoreState>, ids: Vec<String>) -> AppResult<usize> {
    state.with(|store| store.dequeue(&ids))
}

/// How many changes are waiting to reach Convex, for the whole machine.
#[tauri::command]
pub async fn offline_queue_depth(state: State<'_, StoreState>) -> AppResult<i64> {
    state.with(|store| store.queue_depth())
}

/// An id for something made on this machine: unique without asking anybody,
/// and sortable by when it was made.
#[tauri::command]
pub async fn offline_new_id() -> AppResult<String> {
    Ok(store::new_id())
}

fn now() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|since| since.as_millis() as i64)
        .unwrap_or_default()
}
