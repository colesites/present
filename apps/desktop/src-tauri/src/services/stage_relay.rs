//! What the operator window sends the two stage displays.
//!
//! Electron relays `send-to-stage` and `send-to-worship-stage` straight to the
//! window (`window.ipc.ts:209-221`) and keeps nothing, so a stage display that
//! opens mid-service sends `stage-ready` and waits for the operator window to
//! send everything again. Here the last message of each type is kept, and a
//! window that opens asks for them — the way the audience window asks for the
//! scene.
//!
//! The messages stay opaque. What they mean is decided by the two React
//! windows' reducers, which did not change; this only has to deliver them in an
//! order those reducers accept.
//!
//! No Tauri types.

use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::errors::{AppError, AppResult};

/// The two stage displays, as the bridge names them.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum StageTarget {
    /// The confidence monitor: `StageDisplayWindow`.
    MediaStage,
    /// `WorshipStageDisplayWindow`.
    WorshipStage,
}

impl StageTarget {
    /// Electron's channel names, which the bridge listens on.
    pub fn event(self) -> &'static str {
        match self {
            StageTarget::MediaStage => "stage-data",
            StageTarget::WorshipStage => "worship-stage-data",
        }
    }
}

/// The order a window that has just opened is sent what it missed.
///
/// `WorshipStageDisplayWindow` reads `showText` from the last `media-update`
/// when it applies an `active-slide`, so media goes first. Types not listed
/// follow in the order they first arrived.
const REPLAY_ORDER: [&str; 4] = [
    "media-update",
    "active-slide",
    "stage-content",
    "timer-update",
];

/// Resets a window, and with it everything kept for that window.
const CLEAR: &str = "clear";

/// The last message of each type for one stage display.
#[derive(Debug, Default, Clone)]
pub struct StageMessages {
    latest: Vec<(String, Value)>,
}

impl StageMessages {
    /// Keep `message`, replacing the last of its type. Returns it to forward.
    pub fn record(&mut self, message: Value) -> AppResult<Value> {
        let kind = message
            .get("type")
            .and_then(Value::as_str)
            .ok_or_else(|| AppError::Invalid("A stage message needs a string type".to_owned()))?
            .to_owned();

        if kind == CLEAR {
            self.latest.clear();
            return Ok(message);
        }
        match self
            .latest
            .iter_mut()
            .find(|(existing, _)| *existing == kind)
        {
            Some((_, kept)) => *kept = message.clone(),
            None => self.latest.push((kind, message.clone())),
        }
        Ok(message)
    }

    /// Everything kept, in the order a new window should apply it.
    pub fn replay(&self) -> Vec<Value> {
        let rank = |kind: &str| {
            REPLAY_ORDER
                .iter()
                .position(|known| *known == kind)
                .unwrap_or(REPLAY_ORDER.len())
        };
        let mut ordered: Vec<&(String, Value)> = self.latest.iter().collect();
        // Stable, so unlisted types keep their arrival order.
        ordered.sort_by_key(|(kind, _)| rank(kind));
        ordered
            .into_iter()
            .map(|(_, message)| message.clone())
            .collect()
    }
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;

    fn types(messages: &[Value]) -> Vec<&str> {
        messages
            .iter()
            .map(|message| message["type"].as_str().unwrap())
            .collect()
    }

    #[test]
    fn the_latest_of_each_type_is_kept_and_replayed_media_first() {
        let mut messages = StageMessages::default();
        messages
            .record(json!({ "type": "stage-content", "currentLabel": "Verse 1" }))
            .unwrap();
        messages
            .record(json!({ "type": "active-slide", "slideText": "Amazing grace" }))
            .unwrap();
        messages
            .record(json!({ "type": "media-update", "showText": true }))
            .unwrap();
        messages
            .record(json!({ "type": "stage-content", "currentLabel": "Chorus" }))
            .unwrap();

        let replay = messages.replay();
        assert_eq!(
            types(&replay),
            ["media-update", "active-slide", "stage-content"]
        );
        assert_eq!(
            replay[2]["currentLabel"], "Chorus",
            "only the latest of a type"
        );
    }

    #[test]
    fn a_type_the_windows_do_not_know_is_kept_after_the_known_ones() {
        let mut messages = StageMessages::default();
        messages
            .record(json!({ "type": "future-thing", "n": 1 }))
            .unwrap();
        messages
            .record(json!({ "type": "timer-update", "timerText": "00:05:00" }))
            .unwrap();
        messages
            .record(json!({ "type": "another", "n": 2 }))
            .unwrap();
        assert_eq!(
            types(&messages.replay()),
            ["timer-update", "future-thing", "another"]
        );
    }

    #[test]
    fn clear_forgets_everything_kept_and_is_still_forwarded() {
        let mut messages = StageMessages::default();
        messages.record(json!({ "type": "stage-content" })).unwrap();
        let forwarded = messages.record(json!({ "type": "clear" })).unwrap();
        assert_eq!(forwarded["type"], "clear");
        assert!(messages.replay().is_empty());
    }

    #[test]
    fn a_message_without_a_type_is_refused_and_changes_nothing() {
        let mut messages = StageMessages::default();
        messages.record(json!({ "type": "stage-content" })).unwrap();
        assert!(messages.record(json!({ "currentLabel": "x" })).is_err());
        assert!(messages.record(json!({ "type": 3 })).is_err());
        assert!(messages.record(json!("stage-content")).is_err());
        assert_eq!(messages.replay().len(), 1);
    }

    #[test]
    fn the_targets_use_electrons_channel_names() {
        assert_eq!(StageTarget::MediaStage.event(), "stage-data");
        assert_eq!(StageTarget::WorshipStage.event(), "worship-stage-data");
        let target: StageTarget = serde_json::from_str("\"worship-stage\"").unwrap();
        assert_eq!(target, StageTarget::WorshipStage);
    }
}
