//! Process-level state, created once at startup and shared by every command.

use std::time::Instant;

/// Immutable-after-construction runtime facts.
///
/// Held in Tauri's managed state, so it needs no lock: nothing mutates it.
/// Sub-states that *do* mutate (presentation, media, output) will carry their
/// own interior mutability when they arrive, rather than putting one coarse
/// lock around everything.
pub struct AppState {
    started_at: Instant,
}

impl AppState {
    pub fn new() -> Self {
        Self {
            started_at: Instant::now(),
        }
    }

    /// Milliseconds since the Rust core began initialising.
    ///
    /// This is the anchor for the startup-time comparison against the Electron
    /// build required by the migration plan's performance goals.
    pub fn uptime_ms(&self) -> u64 {
        // u128 → u64 cannot realistically overflow (it would take ~584 million
        // years), but saturate rather than wrap if it somehow does.
        u64::try_from(self.started_at.elapsed().as_millis()).unwrap_or(u64::MAX)
    }
}

impl Default for AppState {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn uptime_starts_near_zero_and_advances() {
        let state = AppState::new();
        assert!(state.uptime_ms() < 1_000);

        std::thread::sleep(std::time::Duration::from_millis(5));
        assert!(state.uptime_ms() >= 5);
    }
}
