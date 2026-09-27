//! Screen Configuration: the audience and stage screens, the outputs they go
//! to, and the ones the operator adds. See `services/screens.rs`.
//!
//! The three built-in screens are also opened and closed where they always
//! were (the header's buttons and the Screens menu, through the operator
//! window); what is here opens and closes the ones added, and says what each
//! screen is and where it goes, for Settings to draw.

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager, State};

use crate::errors::{AppError, AppResult};
use crate::services::display::Display;
use crate::services::display_identity::DisplayKey;
use crate::services::monitors;
use crate::services::screens::{self, ScreenGroup, ScreenPatch, ScreenSetup};
use crate::services::window;
use crate::services::window_spec::screen_spec;
use crate::state::DisplayState;

/// Sent to every window with the screens, whenever one changes.
pub const SCREENS_CHANGED_EVENT: &str = "screens:changed";

/// Sent to one screen's window, to show what it is for a moment.
pub const IDENTIFY_EVENT: &str = "screens:identify";

/// A screen as Settings shows it.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScreenInfo {
    #[serde(flatten)]
    pub screen: ScreenSetup,
    pub built_in: bool,
    /// The output chosen for it, while that is connected. For the three
    /// built in, `None` is Automatic.
    pub display_id: Option<i64>,
    /// An output was chosen, and it is not connected now.
    pub output_missing: bool,
    /// Where it goes right now: Automatic worked out, for the built-in ones.
    pub output: Option<Display>,
    pub open: bool,
    pub window: String,
}

fn describe(app: &AppHandle, state: &DisplayState) -> AppResult<Vec<ScreenInfo>> {
    let identified = monitors::current_displays(app)?;
    let preferences = state.snapshot();
    let connected = |key: &DisplayKey| {
        identified
            .iter()
            .find(|(candidate, _)| candidate == key)
            .map(|(_, display)| display.clone())
    };
    Ok(preferences
        .screens()
        .into_iter()
        .map(|screen| {
            let chosen = preferences.display_for_screen(&screen.id);
            let chosen_display = chosen.and_then(connected);
            let output = match screen.role() {
                Some(role) => monitors::resolve_role_among(&identified, &preferences, role)
                    .map(|resolved| resolved.display),
                None => chosen_display.clone(),
            };
            let window = screen.window_label();
            ScreenInfo {
                built_in: screen.is_built_in(),
                display_id: chosen_display.as_ref().map(|display| display.id),
                output_missing: chosen.is_some() && chosen_display.is_none(),
                output,
                open: app.get_webview_window(&window).is_some(),
                window,
                screen,
            }
        })
        .collect())
}

/// Tell every window what the screens are now.
pub fn announce(app: &AppHandle) {
    let Some(state) = app.try_state::<DisplayState>() else {
        return;
    };
    match describe(app, &state) {
        Ok(screens) => {
            if let Err(error) = app.emit(SCREENS_CHANGED_EVENT, screens) {
                tracing::warn!(%error, "could not announce the screens");
            }
        }
        Err(error) => tracing::warn!(%error, "could not describe the screens"),
    }
}

fn screen(state: &DisplayState, id: &str) -> AppResult<ScreenSetup> {
    state
        .screen(id)
        .ok_or_else(|| AppError::NotFound(format!("screen {id}")))
}

fn display_key(app: &AppHandle, display_id: i64) -> AppResult<DisplayKey> {
    monitors::current_displays(app)?
        .into_iter()
        .find(|(_, display)| display.id == display_id)
        .map(|(key, _)| key)
        .ok_or_else(|| AppError::NotFound(format!("display {display_id}")))
}

/// A fresh id: short, and safe in a window label and a URL.
fn new_id() -> String {
    let mut bytes = [0u8; 5];
    if getrandom::getrandom(&mut bytes).is_err() {
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map_or(0, |since| since.as_nanos());
        bytes.copy_from_slice(&now.to_le_bytes()[..5]);
    }
    bytes.iter().map(|byte| format!("{byte:02x}")).collect()
}

/// Open an added screen's window on its output, or move it there if it is
/// open. `false` when it has no output connected to go to.
pub fn open_added(app: &AppHandle, state: &DisplayState, screen: &ScreenSetup) -> AppResult<bool> {
    let Some(spec) = screen_spec(screen) else {
        return Ok(false);
    };
    let Some(display) = monitors::resolve_screen(app, state, screen)? else {
        return Ok(false);
    };
    window::open(app, &spec, Some(&display))?;
    Ok(true)
}

/// Open or close every added screen in `group`, alongside its built-in one.
pub fn set_added_open(app: &AppHandle, group: ScreenGroup, open: bool) {
    let Some(state) = app.try_state::<DisplayState>() else {
        return;
    };
    for screen in state
        .snapshot()
        .screens()
        .into_iter()
        .filter(|screen| screen.group == group && !screen.is_built_in())
    {
        let result = if open {
            open_added(app, &state, &screen).map(|_| ())
        } else {
            window::close(app, &screen.window_label()).map(|_| ())
        };
        if let Err(error) = result {
            tracing::warn!(%error, screen = %screen.id, open, "could not open or close an added screen");
        }
    }
}

#[tauri::command]
pub async fn get_screens(
    app: AppHandle,
    state: State<'_, DisplayState>,
) -> AppResult<Vec<ScreenInfo>> {
    describe(&app, &state)
}

/// Add a screen to a group, going to `display_id` if one is given.
#[tauri::command]
pub async fn add_screen(
    app: AppHandle,
    state: State<'_, DisplayState>,
    group: ScreenGroup,
    display_id: Option<i64>,
) -> AppResult<String> {
    let key = display_id.map(|id| display_key(&app, id)).transpose()?;
    let id = new_id();
    let name = screens::next_name(&state.snapshot().screens(), group);
    let screen = screens::new_screen(id.clone(), group, name);
    state.update(|preferences| {
        preferences.put_screen(screen);
        preferences.set_screen_display(&id, key);
    })?;
    announce(&app);
    Ok(id)
}

/// Change a screen: its name, size, colour, how it fits its output, and for
/// an added stage screen its layout.
#[tauri::command]
pub async fn update_screen(
    app: AppHandle,
    state: State<'_, DisplayState>,
    id: String,
    patch: ScreenPatch,
) -> AppResult<()> {
    let before = screen(&state, &id)?;
    let after = patch.apply(&before);
    state.update(|preferences| preferences.put_screen(after.clone()))?;

    // A stage screen shows its layout from its page, so a new layout is a new
    // page: an open one is opened again on it.
    let open = app.get_webview_window(&after.window_label()).is_some();
    if open && !after.is_built_in() && before.stage_layout() != after.stage_layout() {
        window::close(&app, &after.window_label())?;
        // Closing is not immediate; the new window waits for the label.
        let reopen = app.clone();
        tauri::async_runtime::spawn(async move {
            tokio::time::sleep(std::time::Duration::from_millis(400)).await;
            if let Some(state) = reopen.try_state::<DisplayState>() {
                if let Some(screen) = state.screen(&after.id) {
                    if let Err(error) = open_added(&reopen, &state, &screen) {
                        tracing::warn!(%error, "could not reopen a stage screen on its new layout");
                    }
                }
            }
            announce(&reopen);
        });
    }
    announce(&app);
    Ok(())
}

/// Take an added screen away, closing it.
#[tauri::command]
pub async fn remove_screen(
    app: AppHandle,
    state: State<'_, DisplayState>,
    id: String,
) -> AppResult<bool> {
    let screen = screen(&state, &id)?;
    if screen.is_built_in() {
        return Err(AppError::Invalid(
            "The audience screen and the two stage screens are always there.".to_owned(),
        ));
    }
    window::close(&app, &screen.window_label())?;
    let mut removed = false;
    state.update(|preferences| removed = preferences.remove_screen(&id))?;
    announce(&app);
    Ok(removed)
}

/// Choose a screen's output. `None`: Automatic for the three built in, and
/// no output for an added screen, which closes it.
#[tauri::command]
pub async fn set_screen_display(
    app: AppHandle,
    state: State<'_, DisplayState>,
    id: String,
    display_id: Option<i64>,
) -> AppResult<()> {
    let screen = screen(&state, &id)?;
    let key = display_id.map(|id| display_key(&app, id)).transpose()?;
    state.update(|preferences| preferences.set_screen_display(&id, key))?;

    // One that is open goes there now.
    if let Some(spec) = screen_spec(&screen) {
        if app.get_webview_window(&spec.label).is_some() {
            match monitors::resolve_screen(&app, &state, &screen)? {
                Some(display) => window::reconcile(&app, &spec, Some(&display))?,
                None if !screen.is_built_in() => {
                    window::close(&app, &spec.label)?;
                }
                None => {}
            }
        }
    }
    announce(&app);
    Ok(())
}

/// Turn an added screen on. `false` when it has no output to go to.
#[tauri::command]
pub async fn open_screen(
    app: AppHandle,
    state: State<'_, DisplayState>,
    id: String,
) -> AppResult<bool> {
    let screen = screen(&state, &id)?;
    if screen.is_built_in() {
        return Err(AppError::Invalid(
            "The built-in screens are turned on from the operator window.".to_owned(),
        ));
    }
    let opened = open_added(&app, &state, &screen)?;
    announce(&app);
    Ok(opened)
}

#[tauri::command]
pub async fn close_screen(
    app: AppHandle,
    state: State<'_, DisplayState>,
    id: String,
) -> AppResult<bool> {
    let screen = screen(&state, &id)?;
    let closed = window::close(&app, &screen.window_label())?;
    announce(&app);
    Ok(closed)
}

/// What Identify shows: each screen's name, or the name of the output it is on.
#[derive(Debug, Clone, Copy, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum IdentifyMode {
    Screens,
    Outputs,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct Identify {
    title: String,
    detail: String,
}

fn size_text(width: u32, height: u32) -> String {
    format!("{width} × {height}")
}

/// Show on every screen that is on what it is, for a moment.
#[tauri::command]
pub async fn identify_screens(
    app: AppHandle,
    state: State<'_, DisplayState>,
    mode: IdentifyMode,
) -> AppResult<usize> {
    let mut shown = 0;
    for info in describe(&app, &state)?.into_iter().filter(|info| info.open) {
        let output = info.output.as_ref();
        let identify = match mode {
            IdentifyMode::Screens => Identify {
                title: info.screen.name.clone(),
                detail: match (info.screen.size, output) {
                    (Some(size), _) => size_text(size.width, size.height),
                    (None, Some(display)) => {
                        let scale = display.scale_factor.max(1.0);
                        size_text(
                            (f64::from(display.bounds.width) / scale).round() as u32,
                            (f64::from(display.bounds.height) / scale).round() as u32,
                        )
                    }
                    (None, None) => String::new(),
                },
            },
            IdentifyMode::Outputs => Identify {
                title: output
                    .map_or_else(|| "No output".to_owned(), |display| display.label.clone()),
                detail: output.map_or_else(String::new, |display| {
                    size_text(display.bounds.width, display.bounds.height)
                }),
            },
        };
        if app
            .emit_to(info.window.as_str(), IDENTIFY_EVENT, identify)
            .is_ok()
        {
            shown += 1;
        }
    }
    Ok(shown)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn an_added_screen_gets_an_id_a_window_can_carry() {
        let id = new_id();
        assert_eq!(id.len(), 10);
        assert!(screens::is_usable_id(&id));
        assert_ne!(new_id(), id);
    }
}
