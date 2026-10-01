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
use tauri_plugin_updater::{Update, Updater, UpdaterExt};

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

/// The updater, trusting Mozilla's roots as well as the computer's.
///
/// Its client trusted only the computer's own store, where the app's other
/// requests trust the roots built into it. The update site's certificate is
/// from Let's Encrypt's newest roots, reached from the long-standing ISRG
/// Root X1 only by a cross-signature, and a Windows store that cannot vouch
/// for that refused every check and every download: "couldn't check for
/// updates" on any network. The computer's store is still asked first.
fn updater(app: &AppHandle) -> tauri_plugin_updater::Result<Updater> {
    app.updater_builder()
        .configure_client(|client| client.tls_certs_merge(bundled_roots()))
        .build()
}

fn bundled_roots() -> impl Iterator<Item = reqwest_updater::Certificate> {
    webpki_root_certs::TLS_SERVER_ROOT_CERTS
        .iter()
        .filter_map(|der| reqwest_updater::Certificate::from_der(der).ok())
}

/// An error and what caused it, as one line. The updater's errors keep the
/// reason they failed — a refused certificate, a timeout — in their source,
/// and "error sending request" alone says nothing.
fn reason(error: &(dyn std::error::Error + 'static)) -> String {
    let mut parts = vec![error.to_string()];
    let mut source = error.source();
    while let Some(cause) = source {
        let text = cause.to_string();
        if !parts.iter().any(|part| part.contains(&text)) {
            parts.push(text);
        }
        source = cause.source();
    }
    parts.join(": ")
}

/// Tell the operator an update could not be had, why, and where else to get it.
fn could_not(app: &AppHandle, message: String) {
    let opener = app.clone();
    app.dialog()
        .message(message)
        .title("Check for Updates")
        .kind(MessageDialogKind::Warning)
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
    let found = match updater(app) {
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
            let why = reason(&error);
            tracing::warn!(error = %why, "could not check for an update");
            if asked == Asked::ByOperator {
                could_not(
                    app,
                    format!(
                        "Present couldn't check for updates. The newest version can also be downloaded from the website.\n\n{why}"
                    ),
                );
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
                let why = reason(&error);
                tracing::warn!(error = %why, %version, "could not download the update");
                set_label(app, CHECK_LABEL, true);
                if asked == Asked::ByOperator {
                    could_not(
                        app,
                        format!(
                            "Present {version} couldn't be downloaded. It can also be downloaded from the website.\n\n{why}"
                        ),
                    );
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
    fn the_updater_falls_back_on_the_roots_built_into_the_app() {
        let roots: Vec<_> = bundled_roots().collect();
        assert!(
            roots.len() > 100,
            "Mozilla's roots, all readable: {}",
            roots.len()
        );
    }

    #[test]
    fn a_failure_says_what_caused_it() {
        #[derive(Debug)]
        struct Outer(std::io::Error);
        impl std::fmt::Display for Outer {
            fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                f.write_str("error sending request")
            }
        }
        impl std::error::Error for Outer {
            fn source(&self) -> Option<&(dyn std::error::Error + 'static)> {
                Some(&self.0)
            }
        }
        let error = Outer(std::io::Error::other(
            "invalid peer certificate: UnknownIssuer",
        ));
        assert_eq!(
            reason(&error),
            "error sending request: invalid peer certificate: UnknownIssuer"
        );
    }

    #[test]
    fn the_menu_says_which_version_it_will_restart_into() {
        assert_eq!(restart_label("0.4.4"), "Restart to Update to 0.4.4");
        assert_eq!(CHECK_LABEL, "Check for Updates…");
    }
}
