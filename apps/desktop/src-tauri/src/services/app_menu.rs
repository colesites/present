//! The application menu: every control the operator has, where a Mac user
//! looks for it.
//!
//! Laid out the way presentation software on the Mac is — ProPresenter's bar
//! is the one an operator already knows — but holding only what Present
//! actually does, under the names its own screens use:
//!
//! ```text
//! Present       About, Settings, Hide, Quit (macOS)
//! File          new library item, service, library; import; close
//! Edit          the standard text items; search
//! View          the header's modes, the bottom panels, the sidebar, themes
//! Presentation  the live controls: slides, items, what is on the output
//! Screens       the audience output, the stage displays, looks, composer
//! Window        minimize, zoom, close
//! Help          the website
//! ```
//!
//! **No item has behaviour of its own.** The live controls go through
//! [`control::dispatch`], the path a foot pedal and a lighting desk take; the
//! rest are sent to the operator window as [`MENU_COMMAND_EVENT`] and run the
//! handler its own button runs. A menu that did things its own way would
//! drift from the screen it describes.
//!
//! **The ticks are the screen's.** An item that says whether something is on
//! — text on the output, the audience window open — is set by the operator
//! window whenever that changes (`set_menu_checks`), so the menu never claims
//! what the output is not doing.
//!
//! **Few shortcuts, and none that fight typing.** The window already owns
//! ⌘K, ⌘L, ⌘B, ⌘M and the arrow keys. The menu shows ⌘K, ⌘L and ⌘B, which the
//! window handles first and marks handled, so a press runs once — and each
//! only brings something on screen, so it would be harmless if it ran twice.
//! ⌘M stays the media panel, as it always has been, so Minimize has none. The
//! arrows and ⌘T are left to the window alone: it deliberately ignores them
//! while the operator is typing, and a menu shortcut would not.

use std::collections::HashMap;
use std::sync::Mutex;

use tauri::menu::{
    AboutMetadata, CheckMenuItem, CheckMenuItemBuilder, Menu, MenuBuilder, MenuEvent,
    MenuItemBuilder, Submenu, SubmenuBuilder,
};
use tauri::{AppHandle, Emitter, Manager, Wry};

use crate::errors::AppResult;
use crate::services::control::{self, Action, Switch};
use crate::services::window_spec::WindowRole;

/// Sent to the operator window when File ▸ Import is chosen. Matches the
/// Electron channel name (`app.menu.ts:22`).
pub const OPEN_IMPORT_EVENT: &str = "open-import";

/// Sent to the operator window with the id of any item it carries out
/// (`renderer/tauri/menu-commands.ts`).
pub const MENU_COMMAND_EVENT: &str = "menu:command";

const SETTINGS_ITEM: &str = "present:settings";
const IMPORT_PRESENTATION_ITEM: &str = "present:import-presentation";
const IMPORT_IMAGES_ITEM: &str = "present:import-images";
const MINIMIZE_ITEM: &str = "window.minimize";

/// The live controls, and the action each one asks for.
const CONTROLS: &[(&str, &str)] = &[
    ("presentation.next-slide", "Next Slide"),
    ("presentation.previous-slide", "Previous Slide"),
    ("presentation.next-item", "Next Item"),
    ("presentation.previous-item", "Previous Item"),
];

fn control_for(id: &str) -> Option<Action> {
    Some(match id {
        "presentation.next-slide" => Action::NextSlide,
        "presentation.previous-slide" => Action::PreviousSlide,
        "presentation.next-item" => Action::NextItem,
        "presentation.previous-item" => Action::PreviousItem,
        "presentation.text" => Action::Text { to: Switch::Toggle },
        "presentation.media" => Action::Media { to: Switch::Toggle },
        "presentation.background" => Action::Background { to: Switch::Toggle },
        "presentation.freeze" => Action::Freeze { to: Switch::Toggle },
        "presentation.clear-media" => Action::ClearMedia,
        _ => return None,
    })
}

/// Items that say whether something is on, by the key the operator window
/// reports it under.
pub struct MenuChecks(Mutex<HashMap<&'static str, CheckMenuItem<Wry>>>);

/// Build the menu and install it as the application menu.
pub fn install(app: &AppHandle) -> AppResult<()> {
    let mut checks = HashMap::new();
    let menu = build(app, &mut checks)?;
    app.manage(MenuChecks(Mutex::new(checks)));
    app.set_menu(menu)?;
    Ok(())
}

/// Tick or untick the items the operator window reports on. Keys it does not
/// know are ignored: a newer window may know more than this menu does.
pub fn set_checks(app: &AppHandle, states: &HashMap<String, bool>) {
    let Some(checks) = app.try_state::<MenuChecks>() else {
        return;
    };
    let checks = checks
        .0
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    for (key, on) in states {
        if let Some(item) = checks.get(key.as_str()) {
            if let Err(error) = item.set_checked(*on) {
                tracing::warn!(%error, key, "could not update a menu tick");
            }
        }
    }
}

type Checks = HashMap<&'static str, CheckMenuItem<Wry>>;

fn build(app: &AppHandle, checks: &mut Checks) -> AppResult<Menu<Wry>> {
    let item = |id: &str, text: &str| MenuItemBuilder::with_id(id, text).build(app);
    let keyed = |id: &str, text: &str, keys: &str| {
        MenuItemBuilder::with_id(id, text)
            .accelerator(keys)
            .build(app)
    };
    let mut check = |key: &'static str, id: &str, text: &str| -> AppResult<CheckMenuItem<Wry>> {
        let made = CheckMenuItemBuilder::with_id(id, text)
            .checked(false)
            .build(app)?;
        checks.insert(key, made.clone());
        Ok(made)
    };
    let mac = cfg!(target_os = "macos");

    let mut bar = MenuBuilder::new(app);

    // --- Present -----------------------------------------------------------
    // "Check for Updates…", or "Restart to Update to 0.4.4" once one is
    // waiting (`services/updates.rs`): under Settings on a Mac, in Help
    // elsewhere.
    #[cfg(desktop)]
    let updates = {
        let made = MenuItemBuilder::with_id(
            crate::services::updates::MENU_ITEM,
            crate::services::updates::CHECK_LABEL,
        )
        .build(app)?;
        crate::services::updates::remember_menu_item(app, made.clone());
        made
    };

    if mac {
        // As other Mac apps lay it out: About, then Settings and the update
        // item together.
        let present = SubmenuBuilder::new(app, "Present")
            .about(Some(AboutMetadata::default()))
            .separator()
            .item(&keyed(SETTINGS_ITEM, "Settings…", "CmdOrCtrl+,")?);
        #[cfg(desktop)]
        let present = present.item(&updates);
        let present = present
            .separator()
            .services()
            .separator()
            .hide()
            .hide_others()
            .show_all()
            .separator()
            .quit()
            .build()?;
        bar = bar.item(&present);
    }

    // --- File --------------------------------------------------------------
    let import = SubmenuBuilder::new(app, "Import")
        .item(&keyed(
            IMPORT_PRESENTATION_ITEM,
            "PowerPoint or PDF…",
            "CmdOrCtrl+O",
        )?)
        .item(&item(IMPORT_IMAGES_ITEM, "PowerPoint or PDF as Images…")?)
        .separator()
        .item(&item("file.add-media-folder", "Media Folder…")?)
        .build()?;
    let mut file = SubmenuBuilder::new(app, "File")
        .item(&keyed(
            "file.new-library-item",
            "New Library Item",
            "CmdOrCtrl+N",
        )?)
        .item(&item("file.new-service", "New Service…")?)
        .item(&item("file.new-library", "New Library…")?)
        .separator()
        .item(&import)
        .separator();
    if !mac {
        file = file
            .item(&keyed(SETTINGS_ITEM, "Settings…", "CmdOrCtrl+,")?)
            .separator();
    }
    file = if mac {
        file.close_window()
    } else {
        file.quit()
    };

    // --- Edit --------------------------------------------------------------
    let edit = SubmenuBuilder::new(app, "Edit")
        .undo()
        .redo()
        .separator()
        .cut()
        .copy()
        .paste()
        .select_all()
        .separator()
        .item(&keyed("edit.search", "Search…", "CmdOrCtrl+K")?)
        .build()?;

    // --- View --------------------------------------------------------------
    let sidebar = SubmenuBuilder::new(app, "Sidebar")
        .item(&item("view.sidebar.audio", "Audio")?)
        .item(&item("view.sidebar.text", "Text")?)
        .item(&item("view.sidebar.timer", "Timer")?)
        .item(&item("view.sidebar.messages", "Messages")?)
        .item(&item("view.sidebar.layers", "Layers")?)
        .item(&item("view.sidebar.masters", "Masters")?)
        .build()?;
    let view = SubmenuBuilder::new(app, "View")
        .item(&item("view.show", "Show")?)
        .item(&keyed("view.libraries", "Libraries", "CmdOrCtrl+L")?)
        .item(&item("view.edit", "Edit")?)
        .item(&keyed("view.bible", "Bible", "CmdOrCtrl+B")?)
        .item(&item("view.browser", "Browser")?)
        .separator()
        .item(&check("grid", "view.slide-grid", "Slide Grid")?)
        .item(&sidebar)
        .separator()
        .item(&item("view.themes", "Themes…")?)
        .separator()
        .fullscreen()
        .build()?;

    // --- Presentation ------------------------------------------------------
    let timer = SubmenuBuilder::new(app, "Timer")
        .item(&item("presentation.timer-play", "Start/Pause Timer")?)
        .item(&item("presentation.timer-reset", "Reset Timer")?)
        .item(&item("presentation.timer-stop-all", "Stop All Timers")?)
        .build()?;
    let mut presentation = SubmenuBuilder::new(app, "Presentation");
    for (index, (id, text)) in CONTROLS.iter().enumerate() {
        if index == 2 {
            presentation = presentation.separator();
        }
        presentation = presentation.item(&item(id, text)?);
    }
    let presentation = presentation
        .separator()
        .item(&check("text", "presentation.text", "Text on Output")?)
        .item(&check("media", "presentation.media", "Media on Output")?)
        .item(&check(
            "background",
            "presentation.background",
            "Background on Output",
        )?)
        .item(&check("timer", "presentation.timer", "Timer on Output")?)
        .item(&check(
            "messages",
            "presentation.messages",
            "Messages on Output",
        )?)
        .separator()
        .item(&item("presentation.play-media", "Play/Pause Media")?)
        .item(&item("presentation.clear-media", "Clear Media")?)
        .item(&check("freeze", "presentation.freeze", "Freeze Output")?)
        .separator()
        .item(&timer)
        .build()?;

    // --- Screens -----------------------------------------------------------
    let screens = SubmenuBuilder::new(app, "Screens")
        .item(&keyed(
            "screens.configure",
            "Configure Screens…",
            "CmdOrCtrl+Alt+1",
        )?)
        .separator()
        .item(&check("output", "screens.output", "Audience Output")?)
        .item(&check("mediaStage", "screens.media-stage", "Media Stage")?)
        .item(&check(
            "worshipStage",
            "screens.worship-stage",
            "Worship Stage",
        )?)
        .separator()
        .item(&item("screens.looks", "Looks…")?)
        .item(&item("screens.composer", "Screen Composer…")?)
        .build()?;

    // --- Window ------------------------------------------------------------
    // Minimize is an item of its own rather than the predefined one, which
    // brings ⌘M with it: the window has always used ⌘M for the media panel.
    let window = SubmenuBuilder::new(app, "Window")
        .item(&item(MINIMIZE_ITEM, "Minimize")?)
        .maximize()
        .separator()
        .close_window()
        .build()?;

    // --- Help --------------------------------------------------------------
    let help = SubmenuBuilder::new(app, "Help")
        .item(&item("help.website", "Present Website")?)
        .item(&item("help.download", "Download the Latest Version")?);
    #[cfg(desktop)]
    let help = if mac {
        help
    } else {
        help.separator().item(&updates)
    };
    let help = help.build()?;
    mark_as_help(&help);

    Ok(bar
        .item(&file.build()?)
        .item(&edit)
        .item(&view)
        .item(&presentation)
        .item(&screens)
        .item(&window)
        .item(&help)
        .build()?)
}

/// On macOS the Help menu gets the system's search field.
fn mark_as_help(help: &Submenu<Wry>) {
    #[cfg(target_os = "macos")]
    if let Err(error) = help.set_as_help_menu_for_nsapp() {
        tracing::debug!(%error, "could not mark the Help menu");
    }
    #[cfg(not(target_os = "macos"))]
    let _ = help;
}

/// Act on a menu choice.
pub fn handle(app: &AppHandle, event: MenuEvent) {
    let id = event.id().as_ref();
    match id {
        SETTINGS_ITEM => open_settings(app),
        IMPORT_PRESENTATION_ITEM => send_import(app, "presentation"),
        IMPORT_IMAGES_ITEM => send_import(app, "images"),
        MINIMIZE_ITEM => minimize_focused(app),
        #[cfg(desktop)]
        crate::services::updates::MENU_ITEM => crate::services::updates::menu_chosen(app),
        _ => {
            if let Some(action) = control_for(id) {
                control::dispatch(app, &action, "menu");
            } else {
                send_command(app, id);
            }
        }
    }
}

fn open_settings(app: &AppHandle) {
    use crate::services::window_spec::spec_for;

    if let Err(error) = crate::services::window::open(app, &spec_for(WindowRole::Settings), None) {
        tracing::error!(%error, "could not open the settings window from the menu");
    }
}

/// `sendImportEvent` from `app.menu.ts:15-25`: focus the operator window first,
/// because the import flow opens a dialog inside it.
fn send_import(app: &AppHandle, mode: &str) {
    let Some(window) = app.get_webview_window(WindowRole::Main.label()) else {
        tracing::warn!("import chosen from the menu with no operator window open");
        return;
    };

    let _ = window.set_focus();
    if let Err(error) = window.emit(OPEN_IMPORT_EVENT, mode) {
        tracing::error!(%error, mode, "could not deliver the import menu event");
    }
}

/// Everything the operator window carries out itself.
fn send_command(app: &AppHandle, id: &str) {
    let Some(window) = app.get_webview_window(WindowRole::Main.label()) else {
        tracing::warn!(id, "a menu item was chosen with no operator window open");
        return;
    };
    // Its dialogs and panels open in it, so it comes forward — except for the
    // items that are about other windows, which should not be hidden behind it.
    if !id.starts_with("screens.") {
        let _ = window.set_focus();
    }
    if let Err(error) = window.emit(MENU_COMMAND_EVENT, id) {
        tracing::error!(%error, id, "could not deliver a menu command");
    }
}

fn minimize_focused(app: &AppHandle) {
    let focused = app
        .webview_windows()
        .into_values()
        .find(|window| window.is_focused().unwrap_or(false));
    if let Some(window) = focused {
        let _ = window.minimize();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_live_control_is_one_a_pedal_can_send() {
        for (id, _) in CONTROLS {
            assert!(control_for(id).is_some(), "{id} has no control action");
        }
        for id in [
            "presentation.text",
            "presentation.media",
            "presentation.background",
            "presentation.freeze",
            "presentation.clear-media",
        ] {
            assert!(control_for(id).is_some(), "{id} has no control action");
        }
    }

    #[test]
    fn the_output_toggles_ask_for_a_toggle() {
        // A tick the menu flips itself, then the window reports the state it
        // arrived at: asking for "on" instead would leave the two disagreeing
        // whenever the menu was out of date.
        for id in [
            "presentation.text",
            "presentation.media",
            "presentation.background",
            "presentation.freeze",
        ] {
            let action = control_for(id).expect("an action");
            let json = serde_json::to_value(&action).expect("serialises");
            assert_eq!(json["to"], "toggle", "{id}");
        }
    }

    #[test]
    fn items_the_window_carries_out_are_not_mistaken_for_controls() {
        for id in [
            "presentation.timer",
            "presentation.messages",
            "screens.output",
            "view.show",
        ] {
            assert!(control_for(id).is_none(), "{id}");
        }
    }
}
