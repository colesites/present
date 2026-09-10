//! Presentation position commands.
//!
//! The last of Stage 4's slices. These are the verbs the AI Operator's tool
//! catalogue already names — `next_slide`, `previous_slide`, `go_to_slide` —
//! which is the architecture the audit asks for: the operator panel and the UI
//! call the same commands rather than the panel reaching into React setters.
//!
//! Slide indices are 0-based here. The AI tool surface is 1-based because that
//! is what a person means by "slide three", and the conversion belongs at that
//! boundary rather than in the core.

use tauri::{AppHandle, Emitter, State};

use crate::errors::{AppError, AppResult};
use crate::services::presentation::{NavigationRefusal, PresentationPosition};
use crate::state::PresentationState;

/// Emitted to every window when the position moves.
pub const PRESENTATION_CHANGED_EVENT: &str = "presentation:changed";

fn broadcast(
    app: &AppHandle,
    state: &PresentationState,
    changed: Option<PresentationPosition>,
) -> AppResult<PresentationPosition> {
    let Some(position) = changed else {
        return Ok(state.snapshot());
    };

    if let Err(error) = app.emit(PRESENTATION_CHANGED_EVENT, &position) {
        tracing::error!(%error, "could not broadcast the presentation position");
    }
    Ok(position)
}

fn refusal(error: NavigationRefusal) -> AppError {
    match error {
        NavigationRefusal::NoSlides => {
            AppError::Invalid("There are no slides to control.".to_owned())
        }
    }
}

#[tauri::command]
pub async fn get_presentation_position(
    state: State<'_, PresentationState>,
) -> AppResult<PresentationPosition> {
    Ok(state.snapshot())
}

/// Enter or leave a service.
#[tauri::command]
pub async fn set_presentation_service(
    app: AppHandle,
    state: State<'_, PresentationState>,
    service_id: Option<String>,
    is_inside: bool,
) -> AppResult<PresentationPosition> {
    let changed = state.update(|position| position.set_service(service_id, is_inside))?;
    broadcast(&app, &state, changed)
}

#[tauri::command]
pub async fn set_presentation_service_item(
    app: AppHandle,
    state: State<'_, PresentationState>,
    index: Option<usize>,
) -> AppResult<PresentationPosition> {
    let changed = state.update(|position| position.set_service_item(index))?;
    broadcast(&app, &state, changed)
}

#[tauri::command]
pub async fn set_presentation_service_group(
    app: AppHandle,
    state: State<'_, PresentationState>,
    group_id: Option<String>,
) -> AppResult<PresentationPosition> {
    let changed = state.update(|position| position.set_service_group(group_id))?;
    broadcast(&app, &state, changed)
}

/// Tell the core which deck is live and how many slides it has.
///
/// The count comes from the frontend because it is the frontend that knows how
/// a library item expands into slides. Rust needs only the number, and that is
/// enough to bound navigation.
#[tauri::command]
pub async fn set_presentation_deck(
    app: AppHandle,
    state: State<'_, PresentationState>,
    library_id: Option<String>,
    slide_count: usize,
) -> AppResult<PresentationPosition> {
    let changed = state.update(|position| position.set_deck(library_id, slide_count))?;
    broadcast(&app, &state, changed)
}

#[tauri::command]
pub async fn go_to_slide(
    app: AppHandle,
    state: State<'_, PresentationState>,
    index: i64,
) -> AppResult<PresentationPosition> {
    let mut refused = None;
    let changed = state.update(|position| match position.go_to_slide(index) {
        Ok(changed) => changed,
        Err(error) => {
            refused = Some(error);
            false
        }
    })?;

    if let Some(error) = refused {
        return Err(refusal(error));
    }
    broadcast(&app, &state, changed)
}

#[tauri::command]
pub async fn next_slide(
    app: AppHandle,
    state: State<'_, PresentationState>,
) -> AppResult<PresentationPosition> {
    let mut refused = None;
    let changed = state.update(|position| match position.next_slide() {
        Ok(changed) => changed,
        Err(error) => {
            refused = Some(error);
            false
        }
    })?;

    if let Some(error) = refused {
        return Err(refusal(error));
    }
    broadcast(&app, &state, changed)
}

#[tauri::command]
pub async fn previous_slide(
    app: AppHandle,
    state: State<'_, PresentationState>,
) -> AppResult<PresentationPosition> {
    let mut refused = None;
    let changed = state.update(|position| match position.previous_slide() {
        Ok(changed) => changed,
        Err(error) => {
            refused = Some(error);
            false
        }
    })?;

    if let Some(error) = refused {
        return Err(refusal(error));
    }
    broadcast(&app, &state, changed)
}

/// Drop a service that no longer exists.
///
/// Called with the services the frontend can actually see, after a sync. A
/// service deleted on another machine must not leave the operator inside a
/// running order that is gone.
#[tauri::command]
pub async fn reconcile_presentation_services(
    app: AppHandle,
    state: State<'_, PresentationState>,
    known_service_ids: Vec<String>,
) -> AppResult<PresentationPosition> {
    let changed = state.update(|position| position.forget_missing_service(&known_service_ids))?;
    broadcast(&app, &state, changed)
}
