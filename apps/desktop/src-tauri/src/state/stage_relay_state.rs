//! The last message of each type for each stage display. In memory: a stage
//! display is only ever behind by what the operator window last sent.

use std::sync::Mutex;

use serde_json::Value;

use crate::errors::AppResult;
use crate::services::stage_relay::{StageMessages, StageTarget};

#[derive(Default)]
pub struct StageRelayState {
    media_stage: Mutex<StageMessages>,
    worship_stage: Mutex<StageMessages>,
}

impl StageRelayState {
    pub fn new() -> Self {
        Self::default()
    }

    fn messages(&self, target: StageTarget) -> std::sync::MutexGuard<'_, StageMessages> {
        let slot = match target {
            StageTarget::MediaStage => &self.media_stage,
            StageTarget::WorshipStage => &self.worship_stage,
        };
        slot.lock().unwrap_or_else(|poisoned| poisoned.into_inner())
    }

    pub fn record(&self, target: StageTarget, message: Value) -> AppResult<Value> {
        self.messages(target).record(message)
    }

    pub fn replay(&self, target: StageTarget) -> Vec<Value> {
        self.messages(target).replay()
    }
}
