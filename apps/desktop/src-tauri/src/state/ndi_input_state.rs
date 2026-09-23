//! The one NDI receiver the app shares, and who is using it.
//!
//! `ndi:start-input` and `ndi:stop-input` (`ndi.service.ts:512-639`). The
//! bookkeeping — who joins, who leaves, when the receiver stops — is decided by
//! `services::ndi::rules::plan_input_start` and `plan_input_stop`, the same
//! cases `tests/ndi-rules.test.mjs` pins against Electron. This carries the
//! plans out.
//!
//! In memory: a prop's receiver exists while a prop is on screen.

use std::sync::{Arc, Mutex, MutexGuard};

use serde::Serialize;
use tauri::http;

use crate::services::ndi::finder::Finder;
use crate::services::ndi::input::{InputWorker, LatestFrame, CONTENT_TYPE};
use crate::services::ndi::receiver::Receiver;
use crate::services::ndi::rules::{
    self, InputFrame, InputStartPlan, InputState, InputStopPlan, Source,
};
use crate::services::ndi::NdiLib;

#[derive(Default)]
struct Slot {
    worker: Option<InputWorker>,
    source_name: Option<String>,
    client_ids: Vec<String>,
    /// Bumped whenever a scheduled stop must not happen: a start, another
    /// stop, or the stop itself. A delayed stop only acts if the value it was
    /// scheduled under is still current.
    generation: u64,
}

#[derive(Default)]
pub struct NdiInputState {
    slot: Mutex<Slot>,
    latest: Arc<Mutex<LatestFrame>>,
}

/// What `startNdiInput` answers.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InputStartResult {
    pub ok: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    pub source_name: Option<String>,
}

/// What `listNdiSources` answers.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SourceList {
    pub ok: bool,
    pub sources: Vec<Source>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

fn lock<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
    mutex
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}

fn rejected(error: impl Into<String>) -> InputStartResult {
    InputStartResult {
        ok: false,
        error: Some(error.into()),
        source_name: None,
    }
}

/// Discovery, as `listNdiSources` does it: this machine's sources included,
/// wait up to 1.2 s, named sources in reading order.
pub fn list_sources(lib: Arc<NdiLib>, group_name: Option<&str>) -> SourceList {
    let groups = rules::discovery_groups(group_name);
    match Finder::new(lib, groups.as_deref()) {
        Ok(mut finder) => {
            finder.wait(rules::DISCOVERY_WAIT);
            SourceList {
                ok: true,
                sources: rules::order_sources(finder.sources()),
                error: None,
            }
        }
        Err(error) => SourceList {
            ok: false,
            sources: Vec::new(),
            error: Some(error),
        },
    }
}

impl NdiInputState {
    pub fn new() -> Self {
        Self::default()
    }

    /// Start receiving `source_name` for `client_id`, or join the receiver if
    /// it is already on that source.
    ///
    /// `lib` is asked for only when a new receiver is needed, and discovery
    /// waits up to 1.2 s — call this off the async runtime.
    pub fn start(
        &self,
        lib: impl FnOnce() -> Result<Arc<NdiLib>, String>,
        source_name: &str,
        group_name: Option<&str>,
        client_id: Option<&str>,
    ) -> InputStartResult {
        let plan = {
            let mut slot = lock(&self.slot);
            slot.generation += 1;
            rules::plan_input_start(
                InputState {
                    receiving: slot.worker.is_some(),
                    source_name: slot.source_name.as_deref(),
                    client_ids: &slot.client_ids,
                },
                source_name,
                client_id,
            )
        };

        match plan {
            InputStartPlan::Rejected {
                stop_now,
                client_ids,
            } => {
                lock(&self.slot).client_ids = client_ids;
                if stop_now {
                    self.stop_now();
                }
                rejected(rules::INPUT_NO_SOURCE_ERROR)
            }
            InputStartPlan::Reuse {
                source_name,
                client_ids,
            } => {
                lock(&self.slot).client_ids = client_ids;
                InputStartResult {
                    ok: true,
                    error: None,
                    source_name: Some(source_name),
                }
            }
            InputStartPlan::Connect {
                source_name,
                client_id,
            } => {
                self.stop_now();
                let lib = match lib() {
                    Ok(lib) => lib,
                    Err(error) => return rejected(error),
                };
                let listed = list_sources(lib.clone(), group_name);
                let Some(source) = listed
                    .sources
                    .into_iter()
                    .find(|source| source.name == source_name)
                else {
                    return rejected(format!("NDI source \"{source_name}\" was not found."));
                };

                let receiver = match Receiver::connect(
                    lib,
                    &source,
                    rules::INPUT_COLOR_FORMAT_BGRX_BGRA,
                    rules::INPUT_BANDWIDTH_LOWEST,
                    rules::INPUT_RECEIVER_NAME,
                ) {
                    Ok(receiver) => receiver,
                    Err(error) => {
                        lock(&self.latest).last_error = Some(error.clone());
                        return rejected(error);
                    }
                };

                {
                    let mut latest = lock(&self.latest);
                    latest.jpeg = None;
                    latest.frame_at_ms = 0;
                    latest.last_error = None;
                }
                let worker = match InputWorker::spawn(receiver, self.latest.clone()) {
                    Ok(worker) => worker,
                    Err(error) => {
                        return rejected(format!("The NDI input thread could not start: {error}"))
                    }
                };

                let mut slot = lock(&self.slot);
                slot.worker = Some(worker);
                slot.source_name = Some(source_name.clone());
                slot.client_ids = client_id.into_iter().collect();
                tracing::info!(source = %source_name, "NDI input started");
                InputStartResult {
                    ok: true,
                    error: None,
                    source_name: Some(source_name),
                }
            }
        }
    }

    /// Release `client_id`, or everybody. When nobody is left the receiver
    /// stops after `INPUT_STOP_DELAY`, unless somebody joins first.
    pub fn stop(self: &Arc<Self>, client_id: Option<&str>) {
        let mut slot = lock(&self.slot);
        slot.generation += 1;
        let plan = rules::plan_input_stop(
            InputState {
                receiving: slot.worker.is_some(),
                source_name: slot.source_name.as_deref(),
                client_ids: &slot.client_ids,
            },
            client_id,
        );

        match plan {
            InputStopPlan::Keep { client_ids } => slot.client_ids = client_ids,
            InputStopPlan::Reset => {
                slot.client_ids.clear();
                slot.source_name = None;
                drop(slot);
                let mut latest = lock(&self.latest);
                latest.jpeg = None;
                latest.frame_at_ms = 0;
            }
            InputStopPlan::StopLater { delay } => {
                slot.client_ids.clear();
                let scheduled = slot.generation;
                drop(slot);
                let state = Arc::clone(self);
                let spawned = std::thread::Builder::new()
                    .name("ndi-input-stop".to_owned())
                    .spawn(move || {
                        std::thread::sleep(delay);
                        if lock(&state.slot).generation == scheduled {
                            state.stop_now();
                        }
                    });
                if spawned.is_err() {
                    self.stop_now();
                }
            }
        }
    }

    /// Stop the receiver now and forget everything about it.
    pub fn stop_now(&self) {
        let worker = {
            let mut slot = lock(&self.slot);
            slot.generation += 1;
            slot.client_ids.clear();
            slot.source_name = None;
            slot.worker.take()
        };
        if let Some(worker) = worker {
            // Outside the lock: the loop can take a capture's worth of time to
            // notice, and nobody else should wait on that.
            worker.stop();
            tracing::info!("NDI input stopped");
        }
        let mut latest = lock(&self.latest);
        latest.jpeg = None;
        latest.frame_at_ms = 0;
    }

    /// The latest frame for an `ndi-frame` request naming `source_name`.
    pub fn latest_frame(&self, source_name: Option<&str>) -> InputFrame<Arc<Vec<u8>>> {
        let active = lock(&self.slot).source_name.clone();
        let latest = lock(&self.latest).clone();
        rules::select_input_frame(
            rules::ActiveInput {
                source_name: active.as_deref(),
                image: latest.jpeg.as_ref(),
                content_type: CONTENT_TYPE,
                frame_at_ms: latest.frame_at_ms,
                last_error: latest.last_error.as_deref(),
            },
            source_name,
        )
    }

    #[cfg(test)]
    fn clients(&self) -> Vec<String> {
        lock(&self.slot).client_ids.clone()
    }
}

/// The `ndi-frame://frame/<source>` response.
pub fn respond(state: &NdiInputState, uri: &str) -> http::Response<Vec<u8>> {
    let builder = http::Response::builder().header("Cache-Control", "no-store");
    let Ok(requested) = rules::request_source_name(uri) else {
        return builder
            .status(400)
            .body(Vec::new())
            .unwrap_or_else(|_| http::Response::new(Vec::new()));
    };
    let frame = state.latest_frame(requested.as_deref());
    let planned = rules::frame_response(&frame);
    let mut builder = builder.status(planned.status);
    if let Some(content_type) = planned.content_type.as_deref() {
        builder = builder.header("Content-Type", content_type);
    }
    if let Some(updated) = planned.updated_at_ms.as_deref() {
        builder = builder.header("X-NDI-Frame-Updated-At", updated);
    }
    let body = frame
        .data
        .map(|jpeg| jpeg.as_ref().clone())
        .unwrap_or_default();
    builder
        .body(body)
        .unwrap_or_else(|_| http::Response::new(Vec::new()))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn no_library() -> Result<Arc<NdiLib>, String> {
        Err("The NDI runtime is not installed.".to_owned())
    }

    #[test]
    fn starting_with_no_source_is_refused_with_electrons_message() {
        let state = NdiInputState::new();
        let result = state.start(no_library, "  ", None, Some("output-1"));
        assert_eq!(result, rejected("Select an NDI source first."));
    }

    #[test]
    fn a_missing_runtime_is_reported_rather_than_panicking() {
        let state = NdiInputState::new();
        let result = state.start(no_library, "Cam", None, Some("output-1"));
        assert!(!result.ok);
        assert_eq!(
            result.error.as_deref(),
            Some("The NDI runtime is not installed.")
        );
        assert!(state.clients().is_empty());
    }

    #[test]
    fn stopping_with_no_receiver_resets_and_serves_nothing() {
        let state = Arc::new(NdiInputState::new());
        state.stop(Some("output-1"));
        let response = respond(&state, "ndi-frame://frame/Cam?t=1");
        assert_eq!(response.status(), 204);
        assert_eq!(response.headers()["Cache-Control"], "no-store");
        assert!(response.body().is_empty());
    }

    #[test]
    fn a_held_frame_is_served_for_its_source_and_not_for_another() {
        let state = NdiInputState::new();
        lock(&state.slot).source_name = Some("BIRDDOG (Pulpit)".to_owned());
        {
            let mut latest = lock(&state.latest);
            latest.jpeg = Some(Arc::new(vec![0xFF, 0xD8, 0xFF]));
            latest.frame_at_ms = 5_000;
        }

        let served = respond(&state, "ndi-frame://frame/BIRDDOG%20(Pulpit)?t=1");
        assert_eq!(served.status(), 200);
        assert_eq!(served.headers()["Content-Type"], "image/jpeg");
        assert_eq!(served.headers()["X-NDI-Frame-Updated-At"], "5000");
        assert_eq!(served.body(), &vec![0xFF, 0xD8, 0xFF]);

        let other = respond(&state, "ndi-frame://frame/ZED%20(Cam)?t=1");
        assert_eq!(other.status(), 204, "never another camera's frame");
    }

    #[test]
    fn a_malformed_source_name_is_a_bad_request() {
        let state = NdiInputState::new();
        assert_eq!(respond(&state, "ndi-frame://frame/%E0%A4%A").status(), 400);
    }

    /// A receiver that receives nothing, for the bookkeeping around it.
    struct Idle;

    impl crate::services::ndi::input::FrameReceiver for Idle {
        fn receive(
            &mut self,
            timeout: std::time::Duration,
        ) -> crate::services::ndi::input::Received {
            std::thread::sleep(timeout.min(std::time::Duration::from_millis(20)));
            crate::services::ndi::input::Received::Nothing
        }
    }

    fn receiving(state: &NdiInputState, source: &str, clients: &[&str]) {
        let worker = InputWorker::spawn(Idle, state.latest.clone()).expect("spawn");
        let mut slot = lock(&state.slot);
        slot.worker = Some(worker);
        slot.source_name = Some(source.to_owned());
        slot.client_ids = clients.iter().map(|id| (*id).to_owned()).collect();
    }

    fn has_receiver(state: &NdiInputState) -> bool {
        lock(&state.slot).worker.is_some()
    }

    #[test]
    fn the_last_client_leaving_stops_the_receiver_after_the_grace_period() {
        let state = Arc::new(NdiInputState::new());
        receiving(&state, "Cam", &["output-1"]);

        state.stop(Some("output-1"));
        assert!(has_receiver(&state), "not at once");
        std::thread::sleep(rules::INPUT_STOP_DELAY + std::time::Duration::from_millis(400));
        assert!(!has_receiver(&state), "but after the delay");
    }

    #[test]
    fn a_surface_joining_during_the_grace_period_keeps_the_receiver() {
        // A prop re-rendering on a slide change unmounts and mounts again.
        let state = Arc::new(NdiInputState::new());
        receiving(&state, "Cam", &["output-1"]);

        state.stop(Some("output-1"));
        let joined = state.start(no_library, "Cam", None, Some("output-2"));
        assert!(joined.ok, "{joined:?}");
        std::thread::sleep(rules::INPUT_STOP_DELAY + std::time::Duration::from_millis(400));
        assert!(has_receiver(&state), "the join cancelled the stop");
        assert_eq!(state.clients(), ["output-2"]);
        state.stop_now();
    }

    #[test]
    fn one_of_two_clients_leaving_keeps_the_receiver_without_waiting() {
        let state = Arc::new(NdiInputState::new());
        receiving(&state, "Cam", &["output-1", "preview-1"]);
        state.stop(Some("output-1"));
        assert_eq!(state.clients(), ["preview-1"]);
        assert!(has_receiver(&state));
        state.stop_now();
        assert!(!has_receiver(&state));
    }
}
