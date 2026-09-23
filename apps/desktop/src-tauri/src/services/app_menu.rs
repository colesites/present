//! The application menu.
//!
//! Ports `src/main/menu/app.menu.ts` item for item, including the accelerators
//! an operator has in muscle memory: `Cmd+,` for settings and `Cmd+O` for
//! importing a presentation.
//!
//! Two differences from Electron, both forced by the platform rather than
//! chosen. Tauri has no `pasteAndMatchStyle` predefined item, so the macOS Edit
//! menu is one entry shorter. And Tauri's `reload`/`forceReload`/`toggleDevTools`
//! roles do not exist either; the View menu keeps what Tauri does provide and
//! drops the rest, which is no loss to an operator and a small one in
//! development.

use tauri::menu::{AboutMetadata, Menu, MenuBuilder, MenuEvent, MenuItemBuilder, SubmenuBuilder};
use tauri::{AppHandle, Emitter, Manager, Wry};

use crate::errors::AppResult;
use crate::services::window_spec::WindowRole;

/// Sent to the operator window when File ▸ Import is chosen. Matches the
/// Electron channel name (`app.menu.ts:22`).
pub const OPEN_IMPORT_EVENT: &str = "open-import";

const SETTINGS_ITEM: &str = "present:settings";
const IMPORT_PRESENTATION_ITEM: &str = "present:import-presentation";
const IMPORT_IMAGES_ITEM: &str = "present:import-images";

/// Build the menu and install it as the application menu.
pub fn install(app: &AppHandle) -> AppResult<()> {
    let menu = build(app)?;
    app.set_menu(menu)?;
    Ok(())
}

fn build(app: &AppHandle) -> AppResult<Menu<Wry>> {
    let settings = MenuItemBuilder::with_id(SETTINGS_ITEM, "Settings…")
        .accelerator("CmdOrCtrl+,")
        .build(app)?;
    let settings_in_file = MenuItemBuilder::with_id(SETTINGS_ITEM, "Settings…")
        .accelerator("CmdOrCtrl+,")
        .build(app)?;

    let mut builder = MenuBuilder::new(app);

    if cfg!(target_os = "macos") {
        let app_menu = SubmenuBuilder::new(app, "Present")
            .about(Some(AboutMetadata::default()))
            .separator()
            .item(&settings)
            .separator()
            .hide()
            .hide_others()
            .show_all()
            .separator()
            .quit()
            .build()?;
        builder = builder.item(&app_menu);
    }

    let import = SubmenuBuilder::new(app, "Import")
        .item(
            &MenuItemBuilder::with_id(IMPORT_PRESENTATION_ITEM, "Presentation…")
                .accelerator("CmdOrCtrl+O")
                .build(app)?,
        )
        .item(&MenuItemBuilder::with_id(IMPORT_IMAGES_ITEM, "Presentation As Images…").build(app)?)
        .build()?;

    let mut file = SubmenuBuilder::new(app, "File")
        .item(&import)
        .separator()
        .item(&settings_in_file)
        .separator();
    file = if cfg!(target_os = "macos") {
        file.close_window()
    } else {
        file.quit()
    };

    let mut edit = SubmenuBuilder::new(app, "Edit")
        .undo()
        .redo()
        .separator()
        .cut()
        .copy()
        .paste();
    edit = if cfg!(target_os = "macos") {
        edit.select_all()
    } else {
        edit.separator().select_all()
    };

    let view = SubmenuBuilder::new(app, "View").fullscreen().build()?;

    // Electron's macOS Window menu ends with `front`, which brings every window
    // of the app forward. Tauri has no equivalent role, so the menu stops at
    // the three items it can offer.
    let window = SubmenuBuilder::new(app, "Window")
        .minimize()
        .maximize()
        .separator()
        .close_window()
        .build()?;

    Ok(builder
        .item(&file.build()?)
        .item(&edit.build()?)
        .item(&view)
        .item(&window)
        .build()?)
}

/// Act on a menu choice.
///
/// The import items send an event to the operator window, exactly as Electron
/// does, because the importer is React state. Settings opens a window, which is
/// Rust's job since Stage 2.
pub fn handle(app: &AppHandle, event: MenuEvent) {
    match event.id().as_ref() {
        SETTINGS_ITEM => open_settings(app),
        IMPORT_PRESENTATION_ITEM => send_import(app, "presentation"),
        IMPORT_IMAGES_ITEM => send_import(app, "images"),
        _ => {}
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
