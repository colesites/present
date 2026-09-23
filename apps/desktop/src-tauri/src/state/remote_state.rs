//! The phone remote's settings, and the server while it runs.

use std::path::{Path, PathBuf};
use std::sync::Mutex;

use tauri::AppHandle;

use crate::errors::AppResult;
use crate::services::remote::server::{Announcement, RemoteServer};
use crate::services::remote::{self, RemoteConfig, RemoteStatus};

use super::persist;

const REMOTE_FILE: &str = "remote.json";

#[derive(Default)]
struct Running {
    server: Option<RemoteServer>,
    /// Kept alive beside the server, and never read: dropping it is what
    /// takes the name back off the network.
    #[allow(dead_code)]
    announcement: Option<Announcement>,
    error: Option<String>,
}

pub struct RemoteState {
    config: Mutex<RemoteConfig>,
    running: Mutex<Running>,
    path: PathBuf,
}

impl RemoteState {
    pub fn load(config_dir: &Path) -> Self {
        let path = config_dir.join(REMOTE_FILE);
        Self {
            config: Mutex::new(persist::load_or_default(&path, "remote settings")),
            running: Mutex::new(Running::default()),
            path,
        }
    }

    fn snapshot(&self) -> RemoteConfig {
        self.config
            .lock()
            .unwrap_or_else(|error| error.into_inner())
            .clone()
    }

    /// Start or stop the remote to match the settings.
    ///
    /// Every start is a new token: a code shown last Sunday should not still
    /// work this Sunday.
    pub fn apply(&self, app: &AppHandle) {
        let config = self.snapshot();
        let mut running = self
            .running
            .lock()
            .unwrap_or_else(|error| error.into_inner());
        // The old server goes first; a port cannot be listened on twice.
        *running = Running::default();
        if !config.enabled {
            return;
        }
        match RemoteServer::start(app.clone(), &config, remote::new_token()) {
            Ok(server) => {
                let announcement = remote::local_address()
                    .and_then(|address| Announcement::start(address, server.address.port()));
                if announcement.is_none() {
                    tracing::info!("the remote is running but could not announce itself");
                }
                *running = Running {
                    server: Some(server),
                    announcement,
                    error: None,
                };
            }
            Err(error) => {
                tracing::warn!(%error, "the phone remote could not start");
                *running = Running {
                    server: None,
                    announcement: None,
                    error: Some(error),
                };
            }
        }
    }

    pub fn set(&self, app: &AppHandle, config: RemoteConfig) -> AppResult<()> {
        {
            let mut held = self
                .config
                .lock()
                .unwrap_or_else(|error| error.into_inner());
            *held = config;
            persist::save_atomic(&self.path, &*held)?;
        }
        self.apply(app);
        Ok(())
    }

    /// What the settings screen shows: the address, and the code for it.
    pub fn status(&self) -> RemoteStatus {
        let running = self
            .running
            .lock()
            .unwrap_or_else(|error| error.into_inner());
        let url = running.server.as_ref().and_then(RemoteServer::join_url);
        RemoteStatus {
            config: self.snapshot(),
            qr_svg: url.as_deref().and_then(remote::qr_svg),
            error: running.error.clone().or_else(|| {
                running
                    .server
                    .as_ref()
                    .filter(|_| url.is_none())
                    .map(|_| "This machine is not on a network a phone can reach.".to_owned())
            }),
            url,
        }
    }
}
