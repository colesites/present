//! Screen Configuration: the audience and stage screens, their outputs, and
//! the ones the operator adds. See `services/screens.rs`.
//!
//! The three built-in screens are turned on and off where they always were
//! (the header's buttons and the Screens menu, through the operator window);
//! turning one on turns on its other outputs with it, and the audience output
//! takes the added audience screens with it too. What is here does the rest,
//! and says what each screen is and where each of its outputs goes, for
//! Settings to draw.

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager, State};

use crate::errors::{AppError, AppResult};
use crate::services::display::Display;
use crate::services::display_identity::DisplayKey;
use crate::services::monitors;
use crate::services::screens::{
    self, layout, with_output, without_output, EdgeBlendSetup, GridSetup, OutputGeometry,
    OutputKind, OutputPatch, OutputSetup, ScreenGroup, ScreenPatch, ScreenSetup, ScreenType,
    MAIN_OUTPUT,
};
use crate::services::window;
use crate::services::window_spec::output_spec;
use crate::state::{DisplayState, ScreenNdiState};

/// Sent to every window with the screens, whenever one changes.
pub const SCREENS_CHANGED_EVENT: &str = "screens:changed";

/// Sent to one output's window, to show what it is for a moment.
pub const IDENTIFY_EVENT: &str = "screens:identify";

/// One output of a screen, as Settings shows it.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OutputInfo {
    #[serde(flatten)]
    pub output: OutputSetup,
    /// The display chosen for it, while that is connected. For the first
    /// output of the three built in, `None` is Automatic.
    pub display_id: Option<i64>,
    /// A display was chosen, and it is not connected now.
    pub output_missing: bool,
    /// Where it goes right now: Automatic worked out, for the built-in ones.
    pub display: Option<Display>,
    /// Its window is open, or it is sending.
    pub open: bool,
    /// Part of the screen as its type has it: a single screen uses its first
    /// output alone.
    pub in_use: bool,
    /// Its window's label, for a display output.
    pub window: Option<String>,
    /// What part of the picture it shows, and where, while in use.
    pub geometry: Option<OutputGeometry>,
    /// The source's name on the network, for an NDI output.
    pub ndi_source: Option<String>,
}

/// A screen as Settings shows it.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScreenInfo {
    pub id: String,
    pub group: ScreenGroup,
    pub name: String,
    pub layout: Option<String>,
    pub color: Option<String>,
    pub screen_type: ScreenType,
    pub grid: GridSetup,
    pub blend: EdgeBlendSetup,
    pub built_in: bool,
    /// The picture's size, in output pixels.
    pub canvas: (u32, u32),
    /// Any of its outputs in use is on.
    pub open: bool,
    pub outputs: Vec<OutputInfo>,
}

fn output_open(app: &AppHandle, screen: &ScreenSetup, output: &OutputSetup) -> bool {
    match output.kind {
        OutputKind::Display => app
            .get_webview_window(&screen.window_label(&output.id))
            .is_some(),
        OutputKind::Ndi => app
            .try_state::<ScreenNdiState>()
            .is_some_and(|ndi| ndi.is_sending(&screen.id, &output.id)),
    }
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
            let destination = |output: &OutputSetup| match output.kind {
                OutputKind::Display => {
                    monitors::resolve_output_among(&identified, &preferences, &screen, &output.id)
                }
                OutputKind::Ndi => None,
            };
            let laid = layout(&screen, |output| {
                destination(output).map(|display| (display.bounds.width, display.bounds.height))
            });
            let in_use: Vec<&str> = screen
                .active_outputs()
                .iter()
                .map(|each| each.id.as_str())
                .collect();
            let outputs: Vec<OutputInfo> = screen
                .outputs
                .iter()
                .map(|output| {
                    let chosen = preferences.display_for_output(&screen.id, &output.id);
                    let chosen_display = chosen.and_then(connected);
                    OutputInfo {
                        display_id: chosen_display.as_ref().map(|display| display.id),
                        output_missing: output.kind == OutputKind::Display
                            && chosen.is_some()
                            && chosen_display.is_none(),
                        display: destination(output),
                        open: output_open(app, &screen, output),
                        in_use: in_use.contains(&output.id.as_str()),
                        window: (output.kind == OutputKind::Display)
                            .then(|| screen.window_label(&output.id)),
                        geometry: laid
                            .outputs
                            .iter()
                            .find(|(id, _)| *id == output.id)
                            .map(|(_, geometry)| *geometry),
                        ndi_source: (output.kind == OutputKind::Ndi)
                            .then(|| ScreenNdiState::source_name(&screen, output)),
                        output: output.clone(),
                    }
                })
                .collect();
            ScreenInfo {
                open: outputs.iter().any(|output| output.in_use && output.open),
                id: screen.id.clone(),
                group: screen.group,
                name: screen.name.clone(),
                layout: screen.layout.clone(),
                color: screen.color.clone(),
                screen_type: screen.screen_type,
                grid: screen.grid,
                blend: screen.blend,
                built_in: screen.is_built_in(),
                canvas: laid.canvas,
                outputs,
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

/// A fresh id of `bytes` random bytes, as hex: safe in a label and a URL.
fn new_id(bytes: usize) -> String {
    let mut random = vec![0u8; bytes];
    if getrandom::getrandom(&mut random).is_err() {
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map_or(0, |since| since.as_nanos());
        for (index, byte) in random.iter_mut().enumerate() {
            *byte = (now >> (index * 8)) as u8;
        }
    }
    random.iter().map(|byte| format!("{byte:02x}")).collect()
}

/// Open one output of a screen: its window on its display, or its NDI
/// source. `false` when a display output has no display to go to.
pub fn open_output(
    app: &AppHandle,
    state: &DisplayState,
    screen: &ScreenSetup,
    output: &str,
) -> AppResult<bool> {
    let Some(setup) = screen.output(output) else {
        return Ok(false);
    };
    match setup.kind {
        OutputKind::Ndi => {
            let Some(ndi) = app.try_state::<ScreenNdiState>() else {
                return Ok(false);
            };
            ndi.start(app, screen, setup).map_err(AppError::Invalid)?;
            Ok(true)
        }
        OutputKind::Display => {
            let Some(spec) = output_spec(screen, output) else {
                return Ok(false);
            };
            let Some(display) = monitors::resolve_output(app, state, screen, output)? else {
                return Ok(false);
            };
            window::open(app, &spec, Some(&display))?;
            Ok(true)
        }
    }
}

fn close_output(app: &AppHandle, screen: &ScreenSetup, output: &OutputSetup) -> AppResult<()> {
    match output.kind {
        OutputKind::Display => {
            window::close(app, &screen.window_label(&output.id))?;
        }
        OutputKind::Ndi => {
            if let Some(ndi) = app.try_state::<ScreenNdiState>() {
                ndi.stop(&screen.id, &output.id);
            }
        }
    }
    // A window left from when this output was a display, or a sender from
    // when it was NDI.
    if output.kind == OutputKind::Ndi {
        window::close(app, &screen.window_label(&output.id))?;
    } else if let Some(ndi) = app.try_state::<ScreenNdiState>() {
        ndi.stop(&screen.id, &output.id);
    }
    Ok(())
}

/// Turn a screen's outputs on or off, as its type has them: those in use on,
/// and every other off. `skip_main` leaves a built-in screen's first output
/// alone, for when it is the operator window turning it on or off.
pub fn set_outputs(
    app: &AppHandle,
    state: &DisplayState,
    screen: &ScreenSetup,
    open: bool,
    skip_main: bool,
) {
    let in_use: Vec<String> = screen
        .active_outputs()
        .iter()
        .map(|output| output.id.clone())
        .collect();
    for output in &screen.outputs {
        if skip_main && output.id == MAIN_OUTPUT && screen.is_built_in() {
            continue;
        }
        let result = if open && in_use.contains(&output.id) {
            if output_open(app, screen, output) {
                Ok(())
            } else {
                open_output(app, state, screen, &output.id).map(|_| ())
            }
        } else {
            close_output(app, screen, output)
        };
        if let Err(error) = result {
            tracing::warn!(%error, screen = %screen.id, output = %output.id, open, "could not turn an output on or off");
        }
    }
    // Senders for outputs that are no longer the screen's.
    if let Some(ndi) = app.try_state::<ScreenNdiState>() {
        let keep: Vec<String> = screen
            .outputs
            .iter()
            .filter(|output| open && output.kind == OutputKind::Ndi && in_use.contains(&output.id))
            .map(|output| screens::display_key(&screen.id, &output.id))
            .collect();
        ndi.stop_others(&screen.id, &keep);
    }
}

/// Everything that goes on and off with a built-in screen, turned on or off
/// with it: its other outputs, and for the audience output the added audience
/// screens too.
pub fn follow_built_in(app: &AppHandle, id: &str, open: bool) {
    let Some(state) = app.try_state::<DisplayState>() else {
        return;
    };
    let all = state.snapshot().screens();
    if let Some(built_in) = all.iter().find(|screen| screen.id == id) {
        set_outputs(app, &state, built_in, open, true);
    }
    if id == screens::AUDIENCE {
        for added in all
            .iter()
            .filter(|screen| screen.group == ScreenGroup::Audience && !screen.is_built_in())
        {
            set_outputs(app, &state, added, open, false);
        }
    }
    announce(app);
}

/// Whether any output of `screen` in use is on.
fn is_on(app: &AppHandle, screen: &ScreenSetup) -> bool {
    screen
        .active_outputs()
        .iter()
        .any(|output| output_open(app, screen, output))
}

/// After a change to a screen that is on: the outputs its type now uses on,
/// the rest off, and a stage screen's windows opened again on a new layout.
fn resync(app: &AppHandle, before: &ScreenSetup, after: &ScreenSetup) -> AppResult<()> {
    if !is_on(app, before) {
        return Ok(());
    }
    let Some(state) = app.try_state::<DisplayState>() else {
        return Ok(());
    };
    if after.group == ScreenGroup::Stage && before.stage_layout() != after.stage_layout() {
        // A stage screen shows its layout from its page, so a new layout is a
        // new page. Closing is not immediate; the new windows wait for it.
        for output in &after.outputs {
            if output.kind == OutputKind::Display {
                window::close(app, &after.window_label(&output.id))?;
            }
        }
        let reopen = app.clone();
        let id = after.id.clone();
        tauri::async_runtime::spawn(async move {
            tokio::time::sleep(std::time::Duration::from_millis(450)).await;
            if let Some(state) = reopen.try_state::<DisplayState>() {
                if let Some(screen) = state.screen(&id) {
                    set_outputs(&reopen, &state, &screen, true, false);
                }
            }
            announce(&reopen);
        });
        return Ok(());
    }
    set_outputs(app, &state, after, true, false);
    Ok(())
}

#[tauri::command]
pub async fn get_screens(
    app: AppHandle,
    state: State<'_, DisplayState>,
) -> AppResult<Vec<ScreenInfo>> {
    describe(&app, &state)
}

/// Add a screen to a group, with its first output on `display_id`, or as an
/// NDI source when `ndi` is set.
#[tauri::command]
pub async fn add_screen(
    app: AppHandle,
    state: State<'_, DisplayState>,
    group: ScreenGroup,
    display_id: Option<i64>,
    ndi: Option<bool>,
) -> AppResult<String> {
    let key = display_id.map(|id| display_key(&app, id)).transpose()?;
    let id = new_id(5);
    let name = screens::next_name(&state.snapshot().screens(), group);
    let mut screen = screens::new_screen(id.clone(), group, name);
    if ndi == Some(true) {
        screen.outputs[0].kind = OutputKind::Ndi;
    }
    state.update(|preferences| {
        preferences.put_screen(screen);
        preferences.set_output_display(&id, MAIN_OUTPUT, key);
    })?;
    announce(&app);
    Ok(id)
}

/// Change a screen: its name, colour, type, grid, blend, and a stage
/// screen's layout.
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
    resync(&app, &before, &after)?;
    announce(&app);
    Ok(())
}

/// Take an added screen away, turning it off.
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
    set_outputs(&app, &state, &screen, false, false);
    let mut removed = false;
    state.update(|preferences| removed = preferences.remove_screen(&id))?;
    announce(&app);
    Ok(removed)
}

/// Give a screen another output: a display, or an NDI source.
#[tauri::command]
pub async fn add_output(
    app: AppHandle,
    state: State<'_, DisplayState>,
    id: String,
    kind: OutputKind,
    display_id: Option<i64>,
) -> AppResult<String> {
    let before = screen(&state, &id)?;
    let key = display_id.map(|id| display_key(&app, id)).transpose()?;
    let output = format!("o{}", new_id(3));
    let after = with_output(&before, output.clone(), kind).ok_or_else(|| {
        AppError::Invalid("That screen has as many outputs as it can.".to_owned())
    })?;
    state.update(|preferences| {
        preferences.put_screen(after.clone());
        preferences.set_output_display(&id, &output, key);
    })?;
    resync(&app, &before, &after)?;
    announce(&app);
    Ok(output)
}

/// Take an output away from a screen. Its first stays.
#[tauri::command]
pub async fn remove_output(
    app: AppHandle,
    state: State<'_, DisplayState>,
    id: String,
    output: String,
) -> AppResult<()> {
    let before = screen(&state, &id)?;
    let removing = before
        .output(&output)
        .cloned()
        .ok_or_else(|| AppError::NotFound(format!("output {output}")))?;
    let after = without_output(&before, &output)
        .ok_or_else(|| AppError::Invalid("A screen keeps its first output.".to_owned()))?;
    close_output(&app, &before, &removing)?;
    state.update(|preferences| {
        preferences.put_screen(after.clone());
        preferences.set_output_display(&id, &output, None);
    })?;
    resync(&app, &before, &after)?;
    announce(&app);
    Ok(())
}

/// Change one output: display or NDI, its NDI name, its target, colour and
/// corner pin.
#[tauri::command]
pub async fn update_output(
    app: AppHandle,
    state: State<'_, DisplayState>,
    id: String,
    output: String,
    patch: OutputPatch,
) -> AppResult<()> {
    let before = screen(&state, &id)?;
    let changing_kind = patch
        .kind
        .is_some_and(|kind| before.output(&output).is_some_and(|each| each.kind != kind));
    let renaming = patch.ndi_name.is_some();
    let after = patch
        .apply(&before, &output)
        .ok_or_else(|| AppError::NotFound(format!("output {output}")))?;
    state.update(|preferences| preferences.put_screen(after.clone()))?;
    if changing_kind || renaming {
        // A different kind of output, or a sender under another name: turned
        // off as it was, and on again as it is.
        if let Some(old) = before.output(&output) {
            if is_on(&app, &before) {
                close_output(&app, &before, old)?;
            }
        }
    }
    resync(&app, &before, &after)?;
    announce(&app);
    Ok(())
}

/// Choose one output's display. `None`: Automatic for the first output of the
/// three built in, and no display for every other, which turns it off.
#[tauri::command]
pub async fn set_output_display(
    app: AppHandle,
    state: State<'_, DisplayState>,
    id: String,
    output: String,
    display_id: Option<i64>,
) -> AppResult<()> {
    let screen = screen(&state, &id)?;
    let key = display_id.map(|id| display_key(&app, id)).transpose()?;
    state.update(|preferences| preferences.set_output_display(&id, &output, key))?;

    // One that is open goes there now.
    if let Some(spec) = output_spec(&screen, &output) {
        if app.get_webview_window(&spec.label).is_some() {
            match monitors::resolve_output(&app, &state, &screen, &output)? {
                Some(display) => window::reconcile(&app, &spec, Some(&display))?,
                None => {
                    window::close(&app, &spec.label)?;
                }
            }
        } else if is_on(&app, &screen)
            && screen.active_outputs().iter().any(|each| each.id == output)
        {
            // Given a display, it joins the rest of its screen, which is on.
            open_output(&app, &state, &screen, &output)?;
        }
    }
    announce(&app);
    Ok(())
}

/// Turn an added screen on: every output its type uses.
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
    set_outputs(&app, &state, &screen, true, false);
    announce(&app);
    Ok(is_on(&app, &screen))
}

#[tauri::command]
pub async fn close_screen(
    app: AppHandle,
    state: State<'_, DisplayState>,
    id: String,
) -> AppResult<()> {
    let screen = screen(&state, &id)?;
    set_outputs(&app, &state, &screen, false, false);
    announce(&app);
    Ok(())
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

/// Show on every output window that is open what it is, for a moment.
#[tauri::command]
pub async fn identify_screens(
    app: AppHandle,
    state: State<'_, DisplayState>,
    mode: IdentifyMode,
) -> AppResult<usize> {
    let mut shown = 0;
    for screen in describe(&app, &state)? {
        let many = screen.outputs.iter().filter(|output| output.in_use).count() > 1;
        for (index, output) in screen.outputs.iter().enumerate() {
            let (Some(window), true) = (&output.window, output.open) else {
                continue;
            };
            let identify = match mode {
                IdentifyMode::Screens => Identify {
                    title: if many {
                        format!("{} · {}", screen.name, index + 1)
                    } else {
                        screen.name.clone()
                    },
                    detail: size_text(screen.canvas.0, screen.canvas.1),
                },
                IdentifyMode::Outputs => Identify {
                    title: output
                        .display
                        .as_ref()
                        .map_or_else(|| "No output".to_owned(), |display| display.label.clone()),
                    detail: output.display.as_ref().map_or_else(String::new, |display| {
                        size_text(display.bounds.width, display.bounds.height)
                    }),
                },
            };
            if app
                .emit_to(window.as_str(), IDENTIFY_EVENT, identify)
                .is_ok()
            {
                shown += 1;
            }
        }
    }
    Ok(shown)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_new_id_is_one_a_window_can_carry() {
        let screen = new_id(5);
        assert_eq!(screen.len(), 10);
        assert!(screens::is_usable_id(&screen));
        assert_ne!(new_id(5), screen);
        let output = format!("o{}", new_id(3));
        assert!(screens::is_usable_output_id(&output));
    }
}
