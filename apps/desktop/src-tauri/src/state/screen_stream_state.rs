//! The outputs of screens in Screen Configuration that Present draws and
//! sends rather than shows in a window, while their screens are on: NDI
//! sources, Syphon servers and SDI outputs. Each is a send loop of its own
//! (`services/ndi/output.rs`), by the output's display key
//! (`services/screens.rs`), fed the screen's picture by `ScreenFrameSource`.

use std::collections::HashMap;
use std::sync::{Arc, Mutex, MutexGuard};

use tauri::{AppHandle, Manager};

use crate::services::ndi::output::{FrameSink, NdiStatus, OutputWorker};
use crate::services::ndi::rules;
use crate::services::ndi::screen_stream::ScreenFrameSource;
use crate::services::ndi::sender::Sender;
use crate::services::screens::{display_key, OutputKind, OutputSetup, ScreenSetup};
use crate::services::sdi::{self, SdiSink};
use crate::services::syphon::SyphonSink;
use crate::state::NdiState;

#[derive(Default)]
pub struct ScreenStreamState {
    streams: Mutex<HashMap<String, OutputWorker>>,
    /// Why each output that could not start didn't, until it does.
    failures: Mutex<HashMap<String, String>>,
}

impl ScreenStreamState {
    fn streams(&self) -> MutexGuard<'_, HashMap<String, OutputWorker>> {
        self.streams
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }

    /// What receivers see it as: an NDI source's name on the network, the
    /// operator's or the screen's, or a Syphon server's, which other apps
    /// list beside Present's own name.
    pub fn source_name(screen: &ScreenSetup, output: &OutputSetup) -> String {
        match output.kind {
            OutputKind::Syphon => output
                .source_name
                .clone()
                .unwrap_or_else(|| screen.name.clone()),
            _ => rules::normalize_source_name(
                output
                    .source_name
                    .as_deref()
                    .unwrap_or(&format!("Present {}", screen.name)),
            ),
        }
    }

    pub fn is_sending(&self, screen: &str, output: &str) -> bool {
        self.streams().contains_key(&display_key(screen, output))
    }

    fn failures(&self) -> MutexGuard<'_, HashMap<String, String>> {
        self.failures
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }

    /// Why this output could not start, the last time it was turned on.
    pub fn failure(&self, screen: &str, output: &str) -> Option<String> {
        self.failures().get(&display_key(screen, output)).cloned()
    }

    /// Start sending this output, if it is not already.
    pub fn start(
        &self,
        app: &AppHandle,
        screen: &ScreenSetup,
        output: &OutputSetup,
    ) -> Result<(), String> {
        let key = display_key(&screen.id, &output.id);
        if self.streams().contains_key(&key) {
            return Ok(());
        }
        match start_stream(app, screen, output) {
            Ok(worker) => {
                tracing::info!(screen = %screen.id, output = %output.id, kind = ?output.kind, "a screen's stream started");
                self.failures().remove(&key);
                self.streams().insert(key, worker);
                Ok(())
            }
            Err(error) => {
                self.failures().insert(key, error.clone());
                Err(error)
            }
        }
    }
}

/// A send loop for this output, into what its kind sends to.
fn start_stream(
    app: &AppHandle,
    screen: &ScreenSetup,
    output: &OutputSetup,
) -> Result<OutputWorker, String> {
    Ok(match output.kind {
        OutputKind::Display => return Err("A display output is a window, not a stream.".to_owned()),
        OutputKind::Ndi => {
            let ndi = app
                .try_state::<NdiState>()
                .ok_or_else(|| "NDI is still starting".to_owned())?;
            let resources = app.path().resource_dir().ok();
            let lib = ndi
                .runtime(resources.as_deref())
                .map_err(|error| format!("NDI isn't installed on this computer. {error}"))?;
            let rate = rules::frame_rate(None);
            let sender = Sender::new(
                lib,
                &ScreenStreamState::source_name(screen, output),
                "",
                rate,
            )?;
            spawn(app, screen, output, sender, rate)?
        }
        OutputKind::Syphon => {
            let server = SyphonSink::open(&ScreenStreamState::source_name(screen, output))?;
            spawn(app, screen, output, server, rules::frame_rate(None))?
        }
        OutputKind::Sdi => {
            let mode = sdi::video_mode_or_default(output.video_mode.as_deref());
            let card = SdiSink::open(output.device.as_deref(), mode)?;
            spawn(app, screen, output, card, mode.frames_per_second())?
        }
    })
}

impl ScreenStreamState {
    /// Stop sending this output. It leaves its receivers at once.
    pub fn stop(&self, screen: &str, output: &str) {
        let worker = self.streams().remove(&display_key(screen, output));
        if let Some(worker) = worker {
            worker.stop();
        }
    }

    /// Stop every output of a screen that is not in `keep`.
    pub fn stop_others(&self, screen: &str, keep: &[String]) {
        let prefix = format!("{screen}/");
        let stale: Vec<String> = self
            .streams()
            .keys()
            .filter(|key| {
                (key.as_str() == screen || key.starts_with(&prefix)) && !keep.contains(key)
            })
            .cloned()
            .collect();
        for key in stale {
            if let Some(worker) = self.streams().remove(&key) {
                worker.stop();
            }
        }
    }
}

fn spawn(
    app: &AppHandle,
    screen: &ScreenSetup,
    output: &OutputSetup,
    sink: impl FrameSink + 'static,
    rate: u32,
) -> Result<OutputWorker, String> {
    OutputWorker::spawn(
        ScreenFrameSource::new(app.clone(), &screen.id, &output.id),
        sink,
        Arc::new(Mutex::new(NdiStatus::default())),
        rate,
    )
    .map_err(|error| format!("The output could not start: {error}"))
}
