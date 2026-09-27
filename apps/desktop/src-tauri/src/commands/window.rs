//! Window commands.
//!
//! Replaces the twelve open/close IPC handlers in `window.ipc.ts:89-140`.
//!
//! Those twelve are two commands here, parameterised by role, because they
//! differed only by which constant they closed over — the differences that
//! actually matter live in `services/window_spec.rs` as data, where they are
//! covered by tests. Mini lyrics keeps its own pair: it is the one role with
//! more than one live window, so it is keyed by library rather than by role.
//!
//! **Every open command is `async` on purpose.** Building a window from a
//! synchronous command deadlocks on Windows (WebView2; see the note on
//! `WebviewWindowBuilder::new`). The deadlock does not reproduce on macOS, so
//! nothing here would catch it locally.

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager, State};

use crate::errors::{AppError, AppResult};
use crate::services::display::ScreenRole;
use crate::services::mini_lyrics::{MiniLyricsPayload, MiniLyricsState};
use crate::services::monitors::{self, ResolvedDisplay};
use crate::services::window;
use crate::services::window_spec::{mini_lyrics_spec, spec_for, WindowRole, WindowSpec};
use crate::state::display_state::Resolution;
use crate::state::DisplayState;

/// The optional display/resolution arguments the Electron handlers accept
/// (`window.ipc.ts:89-108`). Passing a display id here both moves the window
/// *and* remembers the choice, which is what the existing UI relies on.
///
/// Both fields are doubly optional because Electron distinguishes the two
/// cases and the UI depends on it: `if (options?.displayId !== undefined)`
/// (`output.window.ts:35`) means an omitted field leaves the stored preference
/// alone, while an explicit `null` clears it and returns the role to automatic
/// selection. A plain `Option` would collapse "the operator cleared their
/// screen choice" into "the caller said nothing".
#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenOptions {
    #[serde(default, deserialize_with = "present_field")]
    pub display_id: Option<Option<i64>>,
    #[serde(default, deserialize_with = "present_field")]
    pub resolution: Option<Option<String>>,
}

/// Deserialise a field into `Some(_)` whenever it was present at all, so an
/// explicit `null` stays distinguishable from an omitted key.
fn present_field<'de, D, T>(deserializer: D) -> Result<Option<Option<T>>, D::Error>
where
    D: serde::Deserializer<'de>,
    T: Deserialize<'de>,
{
    Option::deserialize(deserializer).map(Some)
}

/// Apply the display and resolution a caller passed alongside `open`.
///
/// Electron applies these before deciding where the window goes
/// (`output.window.ts:35-39`), so the freshly-passed choice wins over the
/// stored one on the very first open.
fn apply_options(
    app: &AppHandle,
    state: &DisplayState,
    role: ScreenRole,
    options: &OpenOptions,
) -> AppResult<()> {
    match options.display_id {
        // Explicitly cleared: back to automatic selection.
        Some(None) => state.update(|preferences| preferences.set_display(role, None))?,
        Some(Some(display_id)) => {
            let key = monitors::current_displays(app)?
                .into_iter()
                .find(|(_, display)| display.id == display_id)
                .map(|(key, _)| key);

            // A display id that no longer resolves means the monitor was
            // unplugged between the picker rendering and the operator
            // clicking. Electron stores it regardless and lets selection fall
            // back; do the same rather than refusing to open the window.
            match key {
                Some(key) => {
                    state.update(|preferences| preferences.set_display(role, Some(key)))?;
                }
                None => tracing::warn!(
                    display_id,
                    ?role,
                    "requested display is no longer connected; falling back to automatic selection"
                ),
            }
        }
        None => {}
    }

    // `parseResolution` returns null for anything unrecognised — including an
    // explicit null — and the Electron setter then ignores it
    // (`display.service.ts:77-91`), so a cleared resolution keeps the stored
    // one rather than resetting it.
    if let Some(Some(resolution)) = options.resolution.as_ref() {
        match Resolution::parse(resolution) {
            Some(parsed) => {
                state.update(|preferences| preferences.set_resolution(role, parsed))?;
            }
            None => tracing::warn!(resolution, ?role, "ignoring unrecognised resolution"),
        }
    }

    Ok(())
}

/// Resolve the monitor a spec's placement wants, if it wants one.
fn target_for(
    app: &AppHandle,
    state: &DisplayState,
    spec: &WindowSpec,
) -> AppResult<Option<ResolvedDisplay>> {
    match spec.placement.screen_role() {
        Some(role) => monitors::resolve_role(app, state, role),
        None => Ok(None),
    }
}

/// Open a window, or focus and reposition the one already open.
#[tauri::command]
pub async fn open_window(
    app: AppHandle,
    state: State<'_, DisplayState>,
    role: WindowRole,
    options: Option<OpenOptions>,
) -> AppResult<bool> {
    if role == WindowRole::MiniLyrics {
        return Err(AppError::Invalid(
            "Mini lyrics windows are opened with open_mini_lyrics_window.".to_owned(),
        ));
    }
    if matches!(role, WindowRole::AudienceScreen | WindowRole::StageScreen) {
        return Err(AppError::Invalid(
            "An added screen is opened with open_screen.".to_owned(),
        ));
    }

    let spec = spec_for(role);
    let options = options.unwrap_or_default();

    if let Some(screen_role) = spec.placement.screen_role() {
        apply_options(&app, &state, screen_role, &options)?;
    }

    let target = target_for(&app, &state, &spec)?;
    window::open(
        &app,
        &spec,
        target.as_ref().map(|resolved| &resolved.display),
    )?;
    // The audience is a group: every audience screen added in Screen
    // Configuration goes on with the Output.
    if role == WindowRole::Output {
        crate::commands::screens::set_added_open(
            &app,
            crate::services::screens::ScreenGroup::Audience,
            true,
        );
    }
    Ok(true)
}

/// Close a window. `false` when it was not open — matching the Electron
/// handlers, which return a boolean rather than failing.
#[tauri::command]
pub async fn close_window(app: AppHandle, role: WindowRole) -> AppResult<bool> {
    if role == WindowRole::MiniLyrics {
        return Err(AppError::Invalid(
            "Mini lyrics windows are closed with close_mini_lyrics_window.".to_owned(),
        ));
    }
    if matches!(role, WindowRole::AudienceScreen | WindowRole::StageScreen) {
        return Err(AppError::Invalid(
            "An added screen is closed with close_screen.".to_owned(),
        ));
    }
    if role == WindowRole::Output {
        crate::commands::screens::set_added_open(
            &app,
            crate::services::screens::ScreenGroup::Audience,
            false,
        );
    }
    window::close(&app, role.label())
}

/// Opens an editor, remembering what it is for.
///
/// The payload used to carry only the id and the title, because that was all
/// the window spec needed. It carries the body too now: the editor asks the
/// core what it is editing instead of waiting to be sent it, so the core has to
/// know. See `services/mini_lyrics.rs`.
#[tauri::command]
pub async fn open_mini_lyrics_window(
    app: AppHandle,
    state: State<'_, MiniLyricsState>,
    payload: MiniLyricsPayload,
) -> AppResult<bool> {
    let spec = mini_lyrics_spec(&payload.library_id, &payload.title).ok_or_else(|| {
        AppError::Invalid(format!(
            "'{}' is not a usable library id.",
            payload.library_id
        ))
    })?;

    crate::commands::mini_lyrics::remember(&state, payload)?;
    window::open(&app, &spec, None)?;
    Ok(true)
}

#[tauri::command]
pub async fn close_mini_lyrics_window(
    app: AppHandle,
    state: State<'_, MiniLyricsState>,
    library_id: String,
) -> AppResult<bool> {
    let Some(spec) = mini_lyrics_spec(&library_id, "") else {
        return Ok(false);
    };
    state.forget(&library_id);
    window::close(&app, &spec.label)
}

/// One open window, as the frontend and the diagnostics probe see it.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenWindow {
    pub label: String,
    pub visible: bool,
    pub fullscreen: bool,
}

/// Which windows are open right now.
///
/// Electron has no equivalent; the React side tracks window state itself and
/// gets it wrong whenever a window is closed from the OS. Having Rust answer
/// the question is the point of moving window ownership here.
#[tauri::command]
pub async fn list_open_windows(app: AppHandle) -> AppResult<Vec<OpenWindow>> {
    let mut windows: Vec<OpenWindow> = app
        .webview_windows()
        .into_iter()
        .map(|(label, window)| OpenWindow {
            label,
            visible: window.is_visible().unwrap_or(false),
            fullscreen: window.is_fullscreen().unwrap_or(false),
        })
        .collect();

    // Stable order so a caller diffing this list does not see phantom changes.
    windows.sort_by(|a, b| a.label.cmp(&b.label));
    Ok(windows)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn options(json: &str) -> OpenOptions {
        serde_json::from_str(json).expect("deserializable")
    }

    #[test]
    fn an_omitted_display_leaves_the_stored_preference_alone() {
        let parsed = options("{}");
        assert_eq!(parsed.display_id, None);
        assert_eq!(parsed.resolution, None);
    }

    #[test]
    fn an_explicit_null_display_clears_the_preference() {
        // `ProjectButton.tsx:62` passes the result of `getPreferredOutputDisplay()`
        // straight through, which is null when nothing is chosen. Collapsing this
        // into "omitted" would make clearing a screen choice impossible.
        let parsed = options(r#"{"displayId": null}"#);
        assert_eq!(parsed.display_id, Some(None));
    }

    #[test]
    fn a_chosen_display_survives_the_round_trip() {
        // Ids are 53-bit FNV hashes; this one is the real value this machine
        // reports, so the JSON number path is exercised at full width.
        let parsed = options(r#"{"displayId": 2103039239563972}"#);
        assert_eq!(parsed.display_id, Some(Some(2_103_039_239_563_972)));
    }

    #[test]
    fn resolutions_arrive_as_the_strings_the_pickers_produce() {
        let parsed = options(r#"{"displayId": null, "resolution": "1920x1080"}"#);
        assert_eq!(parsed.resolution, Some(Some("1920x1080".to_owned())));
    }

    #[test]
    fn options_are_camel_case_as_the_frontend_sends_them() {
        // A snake_case key must not silently satisfy the field, or the UI would
        // pass a display id that is quietly ignored.
        let parsed = options(r#"{"display_id": 42}"#);
        assert_eq!(parsed.display_id, None);
    }

    #[test]
    fn window_roles_deserialize_from_their_frontend_spelling() {
        let role: WindowRole = serde_json::from_str("\"screen-composer\"").expect("deserializable");
        assert_eq!(role, WindowRole::ScreenComposer);
        assert!(serde_json::from_str::<WindowRole>("\"nonsense\"").is_err());
    }

    #[test]
    fn a_mini_lyrics_payload_deserializes_without_a_title() {
        // `PresentContainer.tsx:1221` may send an untitled song.
        let payload: MiniLyricsPayload =
            serde_json::from_str(r#"{"libraryId": "abc123"}"#).expect("deserializable");
        assert_eq!(payload.library_id, "abc123");
        assert_eq!(payload.title, "");
    }
}

/// The page in the calling window has drawn; show the window.
///
/// Windows are created hidden and shown on this rather than when their document
/// loads, which is before React has painted anything but white.
#[tauri::command]
pub async fn window_ready(window: tauri::WebviewWindow) -> AppResult<()> {
    window::reveal_when_drawn(&window);
    Ok(())
}

/// What the splash window says now.
#[tauri::command]
pub async fn get_splash_status(
    state: State<'_, crate::services::splash::SplashState>,
) -> AppResult<String> {
    Ok(state.get())
}

/// Say what the app is doing while it starts.
#[tauri::command]
pub async fn set_splash_status(app: AppHandle, status: String) -> AppResult<()> {
    crate::services::splash::set_status(&app, &status);
    Ok(())
}
