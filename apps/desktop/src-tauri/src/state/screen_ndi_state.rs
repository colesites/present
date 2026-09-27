//! The NDI outputs of screens in Screen Configuration, while their screens are
//! on. Each is a sender of its own, by the output's display key
//! (`services/screens.rs`).

use std::collections::HashMap;
use std::sync::{Arc, Mutex, MutexGuard};

use tauri::{AppHandle, Manager};

use crate::services::ndi::output::{NdiStatus, OutputWorker};
use crate::services::ndi::rules;
use crate::services::ndi::screen_stream::ScreenFrameSource;
use crate::services::ndi::sender::Sender;
use crate::services::screens::{display_key, OutputSetup, ScreenSetup};
use crate::state::NdiState;

#[derive(Default)]
pub struct ScreenNdiState {
    senders: Mutex<HashMap<String, OutputWorker>>,
}

impl ScreenNdiState {
    fn senders(&self) -> MutexGuard<'_, HashMap<String, OutputWorker>> {
        self.senders
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }

    /// The source's name on the network: the operator's, or the screen's.
    pub fn source_name(screen: &ScreenSetup, output: &OutputSetup) -> String {
        rules::normalize_source_name(
            output
                .ndi_name
                .as_deref()
                .unwrap_or(&format!("Present {}", screen.name)),
        )
    }

    pub fn is_sending(&self, screen: &str, output: &str) -> bool {
        self.senders().contains_key(&display_key(screen, output))
    }

    /// Start sending this output, if it is not already.
    pub fn start(
        &self,
        app: &AppHandle,
        screen: &ScreenSetup,
        output: &OutputSetup,
    ) -> Result<(), String> {
        let key = display_key(&screen.id, &output.id);
        if self.senders().contains_key(&key) {
            return Ok(());
        }
        let ndi = app
            .try_state::<NdiState>()
            .ok_or_else(|| "NDI is still starting".to_owned())?;
        let resources = app.path().resource_dir().ok();
        let lib = ndi
            .runtime(resources.as_deref())
            .map_err(|error| format!("NDI isn't installed on this computer. {error}"))?;
        let rate = rules::frame_rate(None);
        let sender = Sender::new(lib, &Self::source_name(screen, output), "", rate)?;
        let worker = OutputWorker::spawn(
            ScreenFrameSource::new(app.clone(), &screen.id, &output.id),
            sender,
            Arc::new(Mutex::new(NdiStatus::default())),
            rate,
        )
        .map_err(|error| format!("The NDI output could not start: {error}"))?;
        tracing::info!(screen = %screen.id, output = %output.id, "a screen's NDI output started");
        self.senders().insert(key, worker);
        Ok(())
    }

    /// Stop sending this output. The source leaves the network at once.
    pub fn stop(&self, screen: &str, output: &str) {
        let worker = self.senders().remove(&display_key(screen, output));
        if let Some(worker) = worker {
            worker.stop();
        }
    }

    /// Stop every output of a screen that is not in `keep`.
    pub fn stop_others(&self, screen: &str, keep: &[String]) {
        let prefix = format!("{screen}/");
        let stale: Vec<String> = self
            .senders()
            .keys()
            .filter(|key| {
                (key.as_str() == screen || key.starts_with(&prefix)) && !keep.contains(key)
            })
            .cloned()
            .collect();
        for key in stale {
            if let Some(worker) = self.senders().remove(&key) {
                worker.stop();
            }
        }
    }
}
