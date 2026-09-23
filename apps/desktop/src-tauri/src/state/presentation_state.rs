//! The live presentation position.
//!
//! The service half is persisted — reopening the app mid-service should not
//! lose the operator's place, which is what `present-service-state` is for
//! today. The slide half is not: which slide of a deck was up is only
//! meaningful while that deck is loaded, and restoring it against a deck that
//! changed on another machine would put an arbitrary slide on screen.

use std::path::{Path, PathBuf};
use std::sync::RwLock;

use crate::errors::AppResult;
use crate::services::presentation::{PresentationPosition, ServicePosition};

use super::persist;

const POSITION_FILE: &str = "service-position.json";

pub struct PresentationState {
    position: RwLock<PresentationPosition>,
    path: PathBuf,
}

impl PresentationState {
    pub fn load(config_dir: &Path) -> Self {
        let path = config_dir.join(POSITION_FILE);
        let service: ServicePosition = persist::load_or_default(&path, "service position");

        Self {
            position: RwLock::new(PresentationPosition {
                service,
                ..PresentationPosition::default()
            }),
            path,
        }
    }

    pub fn snapshot(&self) -> PresentationPosition {
        self.read().clone()
    }

    /// Apply a change. `mutate` reports whether anything actually moved, so a
    /// re-selection of the slide already on screen neither writes nor wakes
    /// every window.
    ///
    /// Only the service half is written to disk; see the module note.
    pub fn update<F>(&self, mutate: F) -> AppResult<Option<PresentationPosition>>
    where
        F: FnOnce(&mut PresentationPosition) -> bool,
    {
        let (snapshot, service_changed) = {
            let mut position = self
                .position
                .write()
                .unwrap_or_else(|poisoned| poisoned.into_inner());
            let service_before = position.service.clone();
            if !mutate(&mut position) {
                return Ok(None);
            }
            (position.clone(), position.service != service_before)
        };

        if service_changed {
            persist::save_atomic(&self.path, &snapshot.service)?;
        }
        Ok(Some(snapshot))
    }

    fn read(&self) -> std::sync::RwLockReadGuard<'_, PresentationPosition> {
        self.position
            .read()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_dir(label: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "present-presentation-state-{label}-{}-{:?}",
            std::process::id(),
            std::thread::current().id()
        ));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).expect("temp dir");
        dir
    }

    #[test]
    fn the_place_in_a_service_survives_a_restart() {
        let dir = temp_dir("restart");
        let state = PresentationState::load(&dir);

        state
            .update(|position| position.set_service(Some("service-1".to_owned()), true))
            .expect("saved");
        state
            .update(|position| position.set_service_item(Some(3)))
            .expect("saved");

        let reloaded = PresentationState::load(&dir).snapshot();
        assert_eq!(
            reloaded.service.selected_service_id.as_deref(),
            Some("service-1")
        );
        assert_eq!(reloaded.service.service_item_index, Some(3));
    }

    #[test]
    fn the_live_slide_does_not_survive_a_restart() {
        // The deck it indexes into may have changed on another machine.
        let dir = temp_dir("slide");
        let state = PresentationState::load(&dir);

        state
            .update(|position| position.set_deck(Some("song-1".to_owned()), 5))
            .expect("saved");
        state
            .update(|position| position.go_to_slide(2).unwrap_or(false))
            .expect("saved");

        let reloaded = PresentationState::load(&dir).snapshot();
        assert_eq!(reloaded.slide_index, None);
        assert_eq!(reloaded.deck.library_id, None);
    }

    #[test]
    fn a_slide_move_does_not_rewrite_the_service_file() {
        let dir = temp_dir("no-write");
        let state = PresentationState::load(&dir);
        state
            .update(|position| position.set_deck(Some("song-1".to_owned()), 5))
            .expect("handled");

        assert!(
            !dir.join(POSITION_FILE).exists(),
            "slide movement is not persisted state"
        );
    }

    #[test]
    fn a_change_that_changes_nothing_is_reported_as_such() {
        let dir = temp_dir("noop");
        let state = PresentationState::load(&dir);

        assert!(state
            .update(|position| position.set_service_item(None))
            .expect("handled")
            .is_none());
    }

    #[test]
    fn a_corrupt_file_starts_the_operator_outside_a_service() {
        let dir = temp_dir("corrupt");
        std::fs::write(dir.join(POSITION_FILE), "{ not json").expect("written");

        let position = PresentationState::load(&dir).snapshot();
        assert_eq!(position.service.selected_service_id, None);
        assert!(!position.service.is_inside_service);
    }
}
