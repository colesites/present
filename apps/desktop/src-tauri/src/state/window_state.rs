//! Crash bookkeeping for the windows the Rust core owns.
//!
//! Deliberately small. Which windows exist is Tauri's own question — asked with
//! `get_webview_window(label)` — so duplicating that here would just create two
//! answers that can disagree. What Tauri does not track is how often a window's
//! content process has died, which is the input to the loop guard ported from
//! `main.window.ts:196-227`.

use std::collections::HashMap;
use std::sync::Mutex;
use std::time::Instant;

use crate::services::window_spec::{decide_crash_recovery, CrashAction, CrashHistory, CrashPolicy};

pub struct WindowState {
    crashes: Mutex<HashMap<String, CrashHistory>>,
    /// Monotonic origin for crash timestamps. `Instant` rather than wall clock
    /// so a clock adjustment mid-service cannot make the loop guard misfire.
    started_at: Instant,
}

impl WindowState {
    pub fn new() -> Self {
        Self {
            crashes: Mutex::new(HashMap::new()),
            started_at: Instant::now(),
        }
    }

    fn now_ms(&self) -> u64 {
        u64::try_from(self.started_at.elapsed().as_millis()).unwrap_or(u64::MAX)
    }

    /// Record a crash for `label` and decide what to do about it.
    ///
    /// A poisoned lock is recovered rather than propagated: a panic somewhere
    /// else must not turn "the projector crashed" into "the projector stays
    /// black".
    pub fn on_crash(&self, label: &str, policy: CrashPolicy) -> CrashAction {
        let now = self.now_ms();
        let mut crashes = self
            .crashes
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        let history = crashes.entry(label.to_owned()).or_default();
        decide_crash_recovery(policy, history, now)
    }

    /// Forget a window's crash history. Called when the window is closed, so a
    /// deliberately reopened window starts with a clean guard.
    pub fn forget(&self, label: &str) {
        self.crashes
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .remove(label);
    }

    #[cfg(test)]
    pub fn history(&self, label: &str) -> Option<CrashHistory> {
        self.crashes
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .get(label)
            .copied()
    }
}

impl Default for WindowState {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const GUARDED: CrashPolicy = CrashPolicy::ReloadWithLoopGuard {
        max_attempts: 2,
        within_ms: 10_000,
    };

    #[test]
    fn crash_histories_are_kept_per_window() {
        let state = WindowState::new();

        // Three crashes in quick succession on `main` would trip its guard;
        // `output` must be unaffected by them.
        for _ in 0..3 {
            state.on_crash("main", GUARDED);
        }
        assert_eq!(
            state.on_crash("output", CrashPolicy::ReloadAlways),
            CrashAction::Reload
        );
        assert_eq!(state.history("output").expect("recorded").reloads, 1);
    }

    #[test]
    fn a_quick_crash_loop_stops_reloading() {
        let state = WindowState::new();
        assert_eq!(state.on_crash("main", GUARDED), CrashAction::Reload);
        assert_eq!(state.on_crash("main", GUARDED), CrashAction::Reload);
        assert_eq!(state.on_crash("main", GUARDED), CrashAction::LeaveInPlace);
    }

    #[test]
    fn closing_a_window_clears_its_guard() {
        let state = WindowState::new();
        state.on_crash("main", GUARDED);
        state.on_crash("main", GUARDED);
        state.on_crash("main", GUARDED);

        state.forget("main");

        assert!(state.history("main").is_none());
        assert_eq!(
            state.on_crash("main", GUARDED),
            CrashAction::Reload,
            "reopening a window should not inherit the old window's crashes"
        );
    }

    #[test]
    fn a_poisoned_lock_does_not_take_the_window_down() {
        use std::sync::Arc;

        let state = Arc::new(WindowState::new());
        let poisoner = Arc::clone(&state);
        let _ = std::thread::spawn(move || {
            let _guard = poisoner.crashes.lock().expect("first lock");
            panic!("poison the lock");
        })
        .join();

        assert_eq!(
            state.on_crash("output", CrashPolicy::ReloadAlways),
            CrashAction::Reload
        );
    }
}
