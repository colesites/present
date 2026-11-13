//! Where the operator is: which service, which item, which slide.
//!
//! The last slice of Stage 4, and the smallest of the three by volume — which
//! is the point. `PresentContainer.tsx` is 2 244 lines and holds sixteen
//! `useState` hooks, but only a handful of them describe *the presentation*.
//! The rest are view state: whether the grid is showing, what the edit panel
//! has scrolled to, which import dialog is open. Those stay in React, because
//! moving them would be moving UI into the core for no gain.
//!
//! What moves is the position:
//!
//! * the service the operator is in, the item they are on, and the group they
//!   have expanded — persisted today under `present-service-state`
//!   (`useServices.ts:494-506`);
//! * which library deck is live and which slide of it is on screen — the
//!   `selected` state at `PresentContainer.tsx:483`.
//!
//! Slide navigation is bounded within the current deck and does not roll on to
//! the next service item. That is what `go_to_slide` does today
//! (`usePresentAiToolProvider.ts:372-380`) and it is deliberate: an operator
//! pressing "next" past the end of a song should not put the following item on
//! the audience screen without meaning to.
//!
//! No Tauri types, so the rules are testable directly.

use serde::{Deserialize, Serialize};

/// Where in the running order the operator is.
///
/// Persisted, because it is what "reopen the app and carry on" means. A crash
/// ten minutes into a service should not lose the operator's place.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ServicePosition {
    pub selected_service_id: Option<String>,
    pub is_inside_service: bool,
    pub service_item_index: Option<usize>,
    pub selected_service_group_id: Option<String>,
}

/// Which deck is live and how long it is.
///
/// The count comes from the frontend because it is the frontend that knows how
/// a library item expands into slides — a song's sections, a scripture range,
/// an imported deck's pages. Rust does not need to know how, only how many, and
/// that is enough to bound navigation.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Deck {
    pub library_id: Option<String>,
    pub slide_count: usize,
    /// Slides "next" and "previous" pass over: a deck's hidden slides, as
    /// PowerPoint skips them in a slide show. They can still be clicked.
    #[serde(default)]
    pub skipped: Vec<usize>,
}

/// The whole position.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PresentationPosition {
    pub service: ServicePosition,
    pub deck: Deck,
    /// The slide on screen. `None` means nothing is selected — not slide zero.
    pub slide_index: Option<usize>,
    /// How far through its builds the slide on screen is: 0 is what comes
    /// with the slide, each click one more (`compositor::build`). Past the
    /// last, as when stepping back onto a slide, is everything built.
    #[serde(default)]
    pub build_step: usize,
    /// How many clicks the slide on screen's builds take; the operator sets it
    /// as each slide goes up.
    #[serde(default)]
    pub click_steps: usize,
}

/// Everything built: a slide stepped back onto shows whole, as in PowerPoint.
pub const ALL_BUILT: usize = 1_000_000;

/// Why a navigation request did nothing.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum NavigationRefusal {
    /// The live deck has no slides to move through.
    NoSlides,
}

impl PresentationPosition {
    /// Move to a slide, clamped into the deck.
    ///
    /// Clamping rather than refusing is `go_to_slide`'s behaviour today, and it
    /// is the right one for a live surface: "next" at the last slide should
    /// hold there, not error and leave the operator wondering what happened.
    ///
    /// Returns whether anything changed.
    pub fn go_to_slide(&mut self, index: i64) -> Result<bool, NavigationRefusal> {
        if self.deck.slide_count == 0 {
            return Err(NavigationRefusal::NoSlides);
        }

        let last = self.deck.slide_count - 1;
        let bounded = index.clamp(0, last as i64) as usize;

        if self.slide_index == Some(bounded) {
            return Ok(false);
        }
        self.slide_index = Some(bounded);
        self.build_step = 0;
        Ok(true)
    }

    /// The deck, its hidden slides, the slide up and that slide's build
    /// count, as one change: nothing between them is ever announced.
    /// `slide_index` is the slide up, or `None` to leave the selection as it
    /// is. Returns whether anything changed.
    pub fn set_deck_at(
        &mut self,
        library_id: Option<String>,
        slide_count: usize,
        skipped: Vec<usize>,
        click_steps: usize,
        slide_index: Option<i64>,
    ) -> bool {
        let deck = self.set_deck(library_id, slide_count);
        let skips = self.set_skipped(skipped);
        // The slide before its build count, so the count is the new slide's.
        let moved = match slide_index {
            Some(index) => self.go_to_slide(index).unwrap_or(false),
            None => false,
        };
        let builds = self.set_click_steps(click_steps);
        deck || skips || moved || builds
    }

    /// How many clicks the slide on screen's builds take. A step past them
    /// (everything built) stays everything built.
    pub fn set_click_steps(&mut self, steps: usize) -> bool {
        if self.click_steps == steps {
            return false;
        }
        self.click_steps = steps;
        if self.build_step != ALL_BUILT && self.build_step > steps {
            self.build_step = steps;
        }
        true
    }

    /// The slide after the current one. Holds at the end of the deck.
    ///
    /// With nothing selected this lands on the first slide, which is what
    /// `(selected?.index ?? 0) + 2` resolves to through the 1-based tool
    /// argument — pressing "next" with nothing up starts the deck.
    pub fn next_slide(&mut self) -> Result<bool, NavigationRefusal> {
        // A build still to come on this slide is what "next" shows.
        if self.slide_index.is_some() && self.build_step < self.click_steps {
            self.build_step += 1;
            return Ok(true);
        }
        let count = self.deck.slide_count as i64;
        let mut target = match self.slide_index {
            Some(current) => current as i64 + 1,
            None => 0,
        };
        while target < count && self.is_skipped(target) {
            target += 1;
        }
        if target >= count {
            // Only skipped slides after this one: hold where it is.
            if let Some(current) = self.slide_index {
                return self.go_to_slide(current as i64);
            }
        }
        self.go_to_slide(target)
    }

    /// The slide before the current one. Holds at the start of the deck.
    pub fn previous_slide(&mut self) -> Result<bool, NavigationRefusal> {
        // Back a build before back a slide.
        if self.slide_index.is_some() && self.build_step > 0 && self.build_step <= self.click_steps
        {
            self.build_step -= 1;
            return Ok(true);
        }
        let mut target = match self.slide_index {
            Some(current) => current as i64 - 1,
            None => 0,
        };
        while target >= 0 && self.is_skipped(target) {
            target -= 1;
        }
        if target < 0 {
            if let Some(current) = self.slide_index {
                return self.go_to_slide(current as i64);
            }
        }
        let moved = self.go_to_slide(target);
        if moved == Ok(true) {
            // The slide before shows with its builds done.
            self.build_step = ALL_BUILT;
        }
        moved
    }

    fn is_skipped(&self, index: i64) -> bool {
        usize::try_from(index).is_ok_and(|index| self.deck.skipped.contains(&index))
    }

    /// Which slides of the live deck "next" and "previous" pass over.
    pub fn set_skipped(&mut self, skipped: Vec<usize>) -> bool {
        if self.deck.skipped == skipped {
            return false;
        }
        self.deck.skipped = skipped;
        true
    }

    /// Point at a different deck.
    ///
    /// The slide selection is cleared unless it is the same deck: an index into
    /// the previous song is meaningless in the next one, and keeping it would
    /// put an arbitrary slide on screen.
    pub fn set_deck(&mut self, library_id: Option<String>, slide_count: usize) -> bool {
        let same_deck = self.deck.library_id == library_id;
        let unchanged = same_deck && self.deck.slide_count == slide_count;
        if unchanged {
            return false;
        }

        self.deck = Deck {
            library_id,
            slide_count,
            skipped: if same_deck {
                std::mem::take(&mut self.deck.skipped)
            } else {
                Vec::new()
            },
        };

        if !same_deck {
            self.slide_index = None;
            return true;
        }

        // Same deck, fewer slides than before — a verse range narrowed, a song
        // section deleted. Pull the selection back inside rather than leaving
        // it pointing past the end.
        if let Some(index) = self.slide_index {
            if slide_count == 0 {
                self.slide_index = None;
            } else if index >= slide_count {
                self.slide_index = Some(slide_count - 1);
            }
        }
        true
    }

    /// Move to a service item. `None` leaves the running order without picking
    /// an item, which is what closing a deck does.
    pub fn set_service_item(&mut self, index: Option<usize>) -> bool {
        if self.service.service_item_index == index {
            return false;
        }
        self.service.service_item_index = index;
        true
    }

    /// Enter or leave a service.
    ///
    /// Leaving clears the item, the group and the deck: none of them mean
    /// anything outside the service they belong to, and leaving them set is how
    /// a stale index survives into the next service.
    pub fn set_service(&mut self, service_id: Option<String>, is_inside: bool) -> bool {
        let changed = self.service.selected_service_id != service_id
            || self.service.is_inside_service != is_inside;
        if !changed {
            return false;
        }

        let switching_service = self.service.selected_service_id != service_id;
        self.service.selected_service_id = service_id;
        self.service.is_inside_service = is_inside;

        if switching_service || !is_inside {
            self.service.service_item_index = None;
            self.service.selected_service_group_id = None;
            self.deck = Deck::default();
            self.slide_index = None;
        }
        true
    }

    pub fn set_service_group(&mut self, group_id: Option<String>) -> bool {
        if self.service.selected_service_group_id == group_id {
            return false;
        }
        self.service.selected_service_group_id = group_id;
        true
    }

    /// Forget a service that no longer exists.
    ///
    /// `useServices.ts:530-541` does this on load: a service restored from
    /// storage may have been deleted on another machine since.
    pub fn forget_missing_service(&mut self, known_service_ids: &[String]) -> bool {
        let Some(selected) = self.service.selected_service_id.as_deref() else {
            return false;
        };
        if known_service_ids.iter().any(|id| id == selected) {
            return false;
        }
        self.set_service(None, false)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn with_deck(count: usize) -> PresentationPosition {
        let mut position = PresentationPosition::default();
        position.set_deck(Some("song-1".to_owned()), count);
        position
    }

    #[test]
    fn navigation_with_no_deck_is_refused_rather_than_guessed() {
        let mut position = PresentationPosition::default();

        assert_eq!(position.next_slide(), Err(NavigationRefusal::NoSlides));
        assert_eq!(position.previous_slide(), Err(NavigationRefusal::NoSlides));
        assert_eq!(position.go_to_slide(3), Err(NavigationRefusal::NoSlides));
    }

    #[test]
    /// The owner's report: projecting, the screens flipped between two slides
    /// by themselves. Slide 1 took a click for its builds, slide 2 none.
    /// Choosing slide 2 must land on it, with its own build count, at once.
    #[test]
    fn choosing_a_slide_with_another_build_count_lands_on_it_in_one_change() {
        let mut position = PresentationPosition::default();
        position.set_deck_at(Some("song".to_owned()), 3, Vec::new(), 1, Some(1));
        assert_eq!((position.slide_index, position.click_steps), (Some(1), 1));

        assert!(position.set_deck_at(Some("song".to_owned()), 3, Vec::new(), 0, Some(2)));
        assert_eq!(
            (
                position.slide_index,
                position.click_steps,
                position.build_step
            ),
            (Some(2), 0, 0),
            "the new slide with its own count, never the old slide with the new count"
        );
        assert!(
            !position.set_deck_at(Some("song".to_owned()), 3, Vec::new(), 0, Some(2)),
            "sent again, nothing changes and nothing is announced"
        );
    }

    #[test]
    fn next_shows_a_slides_builds_before_the_next_slide() {
        let mut position = with_deck(3);
        position.go_to_slide(0).unwrap();
        position.set_click_steps(2);

        assert_eq!(position.next_slide(), Ok(true));
        assert_eq!((position.slide_index, position.build_step), (Some(0), 1));
        assert_eq!(position.next_slide(), Ok(true));
        assert_eq!((position.slide_index, position.build_step), (Some(0), 2));
        assert_eq!(position.previous_slide(), Ok(true), "back a build first");
        assert_eq!(position.build_step, 1);
        position.next_slide().unwrap();
        assert_eq!(
            position.next_slide(),
            Ok(true),
            "builds done: the next slide"
        );
        assert_eq!((position.slide_index, position.build_step), (Some(1), 0));

        // Back onto the slide: all of it built, and back again leaves it.
        position.set_click_steps(0);
        assert_eq!(position.previous_slide(), Ok(true));
        assert_eq!(
            (position.slide_index, position.build_step),
            (Some(0), ALL_BUILT)
        );
        position.set_click_steps(2);
        assert_eq!(position.build_step, ALL_BUILT, "stays all built");
        assert_eq!(position.next_slide(), Ok(true));
        assert_eq!(position.slide_index, Some(1));
    }

    #[test]
    fn hidden_slides_are_passed_over_but_can_be_clicked() {
        let mut position = with_deck(6);
        position.set_skipped(vec![0, 2, 3, 5]);

        assert_eq!(position.next_slide(), Ok(true));
        assert_eq!(position.slide_index, Some(1), "the first shown slide");
        assert_eq!(position.next_slide(), Ok(true));
        assert_eq!(position.slide_index, Some(4), "over two hidden ones");
        assert_eq!(
            position.next_slide(),
            Ok(false),
            "only a hidden one after: hold"
        );
        assert_eq!(position.slide_index, Some(4));
        assert_eq!(position.previous_slide(), Ok(true));
        assert_eq!(position.slide_index, Some(1));
        assert_eq!(
            position.previous_slide(),
            Ok(false),
            "only a hidden one before: hold"
        );

        assert_eq!(
            position.go_to_slide(3),
            Ok(true),
            "a hidden slide clicked shows"
        );
        assert_eq!(position.slide_index, Some(3));
    }

    #[test]
    fn next_with_nothing_selected_starts_the_deck() {
        let mut position = with_deck(4);

        assert_eq!(position.next_slide(), Ok(true));
        assert_eq!(position.slide_index, Some(0));
    }

    #[test]
    fn next_advances_one_slide() {
        let mut position = with_deck(4);
        position.go_to_slide(1).expect("in range");

        assert_eq!(position.next_slide(), Ok(true));
        assert_eq!(position.slide_index, Some(2));
    }

    #[test]
    fn next_holds_at_the_end_of_the_deck() {
        // Rolling on to the following service item would put something on the
        // audience screen the operator did not ask for.
        let mut position = with_deck(3);
        position.go_to_slide(2).expect("in range");

        assert_eq!(position.next_slide(), Ok(false), "nothing changed");
        assert_eq!(position.slide_index, Some(2));
    }

    #[test]
    fn previous_holds_at_the_start_of_the_deck() {
        let mut position = with_deck(3);
        position.go_to_slide(0).expect("in range");

        assert_eq!(position.previous_slide(), Ok(false));
        assert_eq!(position.slide_index, Some(0));
    }

    #[test]
    fn going_past_the_end_lands_on_the_last_slide() {
        let mut position = with_deck(3);

        assert_eq!(position.go_to_slide(99), Ok(true));
        assert_eq!(position.slide_index, Some(2));
    }

    #[test]
    fn going_before_the_start_lands_on_the_first_slide() {
        let mut position = with_deck(3);

        assert_eq!(position.go_to_slide(-5), Ok(true));
        assert_eq!(position.slide_index, Some(0));
    }

    #[test]
    fn selecting_the_slide_that_is_already_up_changes_nothing() {
        let mut position = with_deck(3);
        position.go_to_slide(1).expect("in range");

        assert_eq!(position.go_to_slide(1), Ok(false));
    }

    #[test]
    fn changing_deck_clears_the_slide() {
        // An index into the previous song means nothing in the next one.
        let mut position = with_deck(4);
        position.go_to_slide(3).expect("in range");

        position.set_deck(Some("song-2".to_owned()), 6);
        assert_eq!(position.slide_index, None);
    }

    #[test]
    fn the_same_deck_keeps_its_slide() {
        let mut position = with_deck(4);
        position.go_to_slide(3).expect("in range");

        assert!(
            !position.set_deck(Some("song-1".to_owned()), 4),
            "no change"
        );
        assert_eq!(position.slide_index, Some(3));
    }

    #[test]
    fn a_deck_that_shrank_pulls_the_selection_back_inside() {
        // A scripture range narrowed, or a song section was deleted.
        let mut position = with_deck(8);
        position.go_to_slide(7).expect("in range");

        position.set_deck(Some("song-1".to_owned()), 3);
        assert_eq!(position.slide_index, Some(2));
    }

    #[test]
    fn a_deck_that_became_empty_clears_the_selection() {
        let mut position = with_deck(4);
        position.go_to_slide(2).expect("in range");

        position.set_deck(Some("song-1".to_owned()), 0);
        assert_eq!(position.slide_index, None);
    }

    #[test]
    fn entering_a_service_records_it() {
        let mut position = PresentationPosition::default();

        assert!(position.set_service(Some("service-1".to_owned()), true));
        assert_eq!(
            position.service.selected_service_id.as_deref(),
            Some("service-1")
        );
        assert!(position.service.is_inside_service);
    }

    #[test]
    fn switching_service_clears_the_item_the_group_and_the_deck() {
        let mut position = PresentationPosition::default();
        position.set_service(Some("service-1".to_owned()), true);
        position.set_service_item(Some(2));
        position.set_service_group(Some("group-1".to_owned()));
        position.set_deck(Some("song-1".to_owned()), 4);
        position.go_to_slide(1).expect("in range");

        position.set_service(Some("service-2".to_owned()), true);

        assert_eq!(position.service.service_item_index, None);
        assert_eq!(position.service.selected_service_group_id, None);
        assert_eq!(position.deck.library_id, None);
        assert_eq!(position.slide_index, None);
    }

    #[test]
    fn leaving_a_service_clears_the_same_things() {
        let mut position = PresentationPosition::default();
        position.set_service(Some("service-1".to_owned()), true);
        position.set_service_item(Some(2));
        position.set_deck(Some("song-1".to_owned()), 4);

        position.set_service(Some("service-1".to_owned()), false);

        assert_eq!(position.service.service_item_index, None);
        assert_eq!(position.deck.library_id, None);
        assert_eq!(
            position.service.selected_service_id.as_deref(),
            Some("service-1"),
            "the service is still the one selected, it is just not entered"
        );
    }

    #[test]
    fn re_entering_the_same_service_keeps_the_place() {
        let mut position = PresentationPosition::default();
        position.set_service(Some("service-1".to_owned()), true);
        position.set_service_item(Some(2));

        assert!(!position.set_service(Some("service-1".to_owned()), true));
        assert_eq!(position.service.service_item_index, Some(2));
    }

    #[test]
    fn a_service_that_no_longer_exists_is_forgotten() {
        let mut position = PresentationPosition::default();
        position.set_service(Some("deleted".to_owned()), true);
        position.set_service_item(Some(1));

        assert!(position.forget_missing_service(&["other".to_owned()]));
        assert_eq!(position.service.selected_service_id, None);
        assert!(!position.service.is_inside_service);
        assert_eq!(position.service.service_item_index, None);
    }

    #[test]
    fn a_service_that_still_exists_is_kept() {
        let mut position = PresentationPosition::default();
        position.set_service(Some("service-1".to_owned()), true);

        assert!(!position.forget_missing_service(&["service-1".to_owned()]));
        assert_eq!(
            position.service.selected_service_id.as_deref(),
            Some("service-1")
        );
    }

    #[test]
    fn the_service_position_serialises_the_way_the_react_side_stores_it() {
        // Same field names as `present-service-state`, so a config written by
        // either side is read by both.
        let mut position = PresentationPosition::default();
        position.set_service(Some("service-1".to_owned()), true);
        position.set_service_item(Some(3));
        position.set_service_group(Some("group-1".to_owned()));

        let json = serde_json::to_value(&position.service).expect("serialisable");
        assert_eq!(json["selectedServiceId"], "service-1");
        assert_eq!(json["isInsideService"], true);
        assert_eq!(json["serviceItemIndex"], 3);
        assert_eq!(json["selectedServiceGroupId"], "group-1");
    }
}
