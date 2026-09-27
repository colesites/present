//! The app updating itself in place.
//!
//! Present asks the website whether there is a newer version
//! (`/api/desktop/update/<os>/<arch>/<version>`), which answers from the
//! release manifest the build jobs keep beside the installers. A newer one is
//! downloaded in the background, checked against the public key built into
//! the app (`plugins.updater.pubkey` in `tauri.conf.json`), and held until the
//! operator chooses to restart. The menu item says which it is: "Check for
//! Updates…" while there is nothing new, and "Restart to Update to 0.4.4" once
//! there is, as other Mac apps do.
//!
//! It never restarts by itself. A restart takes the audience screen away, and
//! only the person at the desk knows whether this is the moment.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use std::time::Duration;

use tauri::menu::MenuItem;
use tauri::{AppHandle, Emitter, Manager, Wry};
use tauri_plugin_dialog::{DialogExt, MessageDialogButtons, MessageDialogKind};
use tauri_plugin_updater::{Update, UpdaterExt};

use crate::services::window_spec::WindowRole;

/// The menu item's id: under Settings in the Present menu on a Mac, in Help
/// elsewhere.
pub const MENU_ITEM: &str = "present:updates";

/// What the menu item says while there is no update waiting.
pub const CHECK_LABEL: &str = "Check for Updates…";

/// Told to the operator window when an update is ready, with its version, so
/// it can offer the restart too.
pub const READY_EVENT: &str = "update:ready";

/// The website's page of every version, for a build that cannot update itself.
const DOWNLOADS_URL: &str = "https://present.multivrs.space/download";

/// Long enough after launch that the check never competes with the first
/// minutes of a service being set up.
const FIRST_CHECK_AFTER: Duration = Duration::from_secs(45);
const CHECK_EVERY: Duration = Duration::from_secs(6 * 60 * 60);

/// What the menu item says once an update is downloaded and waiting.
pub fn restart_label(version: &str) -> String {
    format!("Restart to Update to {version}")
}

/// An update, downloaded and checked, waiting for the restart.
struct Ready {
    update: Update,
    bytes: Vec<u8>,
}

#[derive(Default)]
pub struct UpdateState {
    item: Mutex<Option<MenuItem<Wry>>>,
    ready: Mutex<Option<Ready>>,
    busy: AtomicBool,
}

/// Who asked: the operator from the menu, who is told the answer whatever it
/// is, or the timer, which says something only when there is an update.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Asked {
    ByOperator,
    Quietly,
}

pub fn install(app: &AppHandle) {
    app.manage(UpdateState::default());
}

/// Hold on to the menu item, so its words can change.
pub fn remember_menu_item(app: &AppHandle, item: MenuItem<Wry>) {
    if let Some(state) = app.try_state::<UpdateState>() {
        *lock(&state.item) = Some(item);
    }
}

/// Whether this build can update itself: it was built with the key updates
/// are signed with. Without one, every update would be refused, so it does
/// not look.
fn configured(app: &AppHandle) -> bool {
    app.config()
        .plugins
        .0
        .get("updater")
        .and_then(|updater| updater.get("pubkey"))
        .and_then(|key| key.as_str())
        .is_some_and(|key| !key.trim().is_empty())
}

/// Look now and then, from a little after launch.
pub fn start(app: AppHandle) {
    if !configured(&app) {
        tracing::info!("this build has no update key; it will not look for updates");
        return;
    }
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(FIRST_CHECK_AFTER).await;
        loop {
            check(&app, Asked::Quietly).await;
            tokio::time::sleep(CHECK_EVERY).await;
        }
    });
}

/// The menu item was chosen: restart into the update that is waiting, or look
/// for one.
pub fn menu_chosen(app: &AppHandle) {
    let waiting = app
        .try_state::<UpdateState>()
        .is_some_and(|state| lock(&state.ready).is_some());
    if waiting {
        restart_to_update(app.clone());
        return;
    }
    let app = app.clone();
    tauri::async_runtime::spawn(async move { check(&app, Asked::ByOperator).await });
}

async fn check(app: &AppHandle, asked: Asked) {
    if !configured(app) {
        if asked == Asked::ByOperator {
            let opener = app.clone();
            app.dialog()
                .message(
                    "This copy of Present can't update itself. Download the newest version from the website.",
                )
                .title("Check for Updates")
                .buttons(MessageDialogButtons::OkCancelCustom(
                    "Open Downloads".to_owned(),
                    "Close".to_owned(),
                ))
                .show(move |open| {
                    if open {
                        open_downloads(&opener);
                    }
                });
        }
        return;
    }
    let Some(state) = app.try_state::<UpdateState>() else {
        return;
    };
    if state.busy.swap(true, Ordering::SeqCst) {
        if asked == Asked::ByOperator {
            app.dialog()
                .message(
                    "Present is checking for an update now. The menu will say when one is ready.",
                )
                .title("Check for Updates")
                .kind(MessageDialogKind::Info)
                .show(|_| {});
        }
        return;
    }

    let current = app.package_info().version.to_string();
    let found = match app.updater() {
        Ok(updater) => updater.check().await,
        Err(error) => Err(error),
    };
    match found {
        Ok(Some(update)) => download(app, update, asked).await,
        Ok(None) => {
            tracing::info!(%current, "no newer version");
            if asked == Asked::ByOperator {
                app.dialog()
                    .message(format!("Present {current} is the newest version."))
                    .title("You're up to date")
                    .kind(MessageDialogKind::Info)
                    .show(|_| {});
            }
        }
        Err(error) => {
            tracing::warn!(%error, "could not check for an update");
            if asked == Asked::ByOperator {
                app.dialog()
                    .message("Present couldn't check for updates. Check the internet connection and try again.")
                    .title("Check for Updates")
                    .kind(MessageDialogKind::Warning)
                    .show(|_| {});
            }
        }
    }
    state.busy.store(false, Ordering::SeqCst);
}

async fn download(app: &AppHandle, update: Update, asked: Asked) {
    let Some(state) = app.try_state::<UpdateState>() else {
        return;
    };
    let version = update.version.clone();
    let already = lock(&state.ready)
        .as_ref()
        .is_some_and(|ready| ready.update.version == version);
    if !already {
        set_label(app, &format!("Downloading Present {version}…"), false);
        match update.download(|_, _| {}, || {}).await {
            Ok(bytes) => {
                *lock(&state.ready) = Some(Ready {
                    update: update.clone(),
                    bytes,
                });
                tracing::info!(%version, "an update is downloaded and waiting");
            }
            Err(error) => {
                tracing::warn!(%error, %version, "could not download the update");
                set_label(app, CHECK_LABEL, true);
                if asked == Asked::ByOperator {
                    app.dialog()
                        .message(format!(
                            "Present {version} couldn't be downloaded. Try again in a moment."
                        ))
                        .title("Check for Updates")
                        .kind(MessageDialogKind::Warning)
                        .show(|_| {});
                }
                return;
            }
        }
    }

    set_label(app, &restart_label(&version), true);
    if let Some(window) = app.get_webview_window(WindowRole::Main.label()) {
        let _ = window.emit(READY_EVENT, &version);
    }
    if asked == Asked::ByOperator {
        let restarting = app.clone();
        app.dialog()
            .message(format!(
                "Present {version} is ready. It takes a few seconds to restart into it."
            ))
            .title("Update ready")
            .buttons(MessageDialogButtons::OkCancelCustom(
                "Restart Now".to_owned(),
                "Later".to_owned(),
            ))
            .show(move |now| {
                if now {
                    restart_to_update(restarting);
                }
            });
    }
}

/// Install the waiting update and start again, asking first when the audience
/// screen is open.
pub fn restart_to_update(app: AppHandle) {
    let live = app.get_webview_window(WindowRole::Output.label()).is_some();
    if !live {
        install_and_restart(&app);
        return;
    }
    let restarting = app.clone();
    app.dialog()
        .message(
            "The audience screen is open. Restarting takes it off for a few seconds while Present updates.",
        )
        .title("Restart to update?")
        .kind(MessageDialogKind::Warning)
        .buttons(MessageDialogButtons::OkCancelCustom(
            "Restart Now".to_owned(),
            "Not Now".to_owned(),
        ))
        .show(move |now| {
            if now {
                install_and_restart(&restarting);
            }
        });
}

fn install_and_restart(app: &AppHandle) {
    let Some(state) = app.try_state::<UpdateState>() else {
        return;
    };
    let Some(ready) = lock(&state.ready).take() else {
        return;
    };
    let version = ready.update.version.clone();
    match ready.update.install(&ready.bytes) {
        // On Windows the installer takes over and opens Present again itself.
        Ok(()) => app.restart(),
        Err(error) => {
            tracing::error!(%error, %version, "could not install the update");
            set_label(app, CHECK_LABEL, true);
            app.dialog()
                .message(format!(
                    "Present {version} couldn't be installed. Download it from the website instead."
                ))
                .title("Update failed")
                .kind(MessageDialogKind::Error)
                .show(|_| {});
        }
    }
}

fn set_label(app: &AppHandle, text: &str, enabled: bool) {
    let Some(state) = app.try_state::<UpdateState>() else {
        return;
    };
    let item = lock(&state.item).clone();
    if let Some(item) = item {
        if let Err(error) = item.set_text(text).and_then(|()| item.set_enabled(enabled)) {
            tracing::warn!(%error, "could not relabel the update menu item");
        }
    }
}

fn open_downloads(app: &AppHandle) {
    use tauri_plugin_opener::OpenerExt;
    if let Err(error) = app.opener().open_url(DOWNLOADS_URL, None::<&str>) {
        tracing::warn!(%error, "could not open the downloads page");
    }
}

fn lock<T>(mutex: &Mutex<T>) -> std::sync::MutexGuard<'_, T> {
    mutex
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}

/// Restart into the waiting update, from the operator window's own prompt.
#[tauri::command]
pub fn restart_to_update_command(app: AppHandle) {
    restart_to_update(app);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_menu_says_which_version_it_will_restart_into() {
        assert_eq!(restart_label("0.4.4"), "Restart to Update to 0.4.4");
        assert_eq!(CHECK_LABEL, "Check for Updates…");
    }
}
