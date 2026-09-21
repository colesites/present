//! The transition library, for the picker.
//!
//! One command. The registry is the list — the React side has none of its own
//! to fall out of step with, and adding a transition is a row in
//! `services/compositor/transition/registry.rs` rather than a change in two
//! places.

use serde::Serialize;

use crate::errors::AppResult;
use crate::services::compositor::transition::registry::{Category, Preset, PRESETS};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TransitionCategory {
    pub id: Category,
    pub title: &'static str,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TransitionLibrary {
    pub categories: Vec<TransitionCategory>,
    pub presets: &'static [Preset],
}

#[tauri::command]
pub async fn get_transitions() -> AppResult<TransitionLibrary> {
    Ok(TransitionLibrary {
        categories: Category::ALL
            .into_iter()
            .map(|id| TransitionCategory {
                id,
                title: id.title(),
            })
            .collect(),
        presets: PRESETS,
    })
}
