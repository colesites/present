//! A transition while it is running.
//!
//! It holds the picture that was on screen when it began, because that is the
//! one thing that cannot be recovered afterwards — the slide it came from has
//! already gone. Everything else is worked out per frame from the clock.
//!
//! **The video is not in here.** The compositor draws the background beneath
//! the slide layers, so a transition between two slide layers leaves a playing
//! video exactly where it is, without anything having to arrange that. A
//! looping background carries on through a change of words because the words
//! and the background were never the same picture.

use std::time::Instant;

use tiny_skia::{Pixmap, PixmapMut};

use super::change_detection::Changes;
use super::config::{Mode, Transition};
use super::registry::{self, Primitive};

/// One transition, from the moment it starts until it is over.
pub struct Running {
    /// The slide layers as they were. In changed-elements mode this is only
    /// the part that is changing; the rest is drawn normally underneath.
    from: Pixmap,
    transition: Transition,
    primitive: Primitive,
    changes: Changes,
    started: Instant,
}

impl Running {
    /// Begin one, or `None` if there is nothing to animate.
    ///
    /// Nothing to animate covers a cut, a zero duration, a preset this build
    /// cannot draw that falls back to nothing, and — the one worth saying out
    /// loud — a slide where nothing visible changed.
    pub fn begin(
        from: Pixmap,
        transition: &Transition,
        changes: Changes,
        now: Instant,
    ) -> Option<Self> {
        if !transition.animates() || changes.is_nothing() {
            return None;
        }
        let primitive = registry::drawn_primitive(transition);
        if matches!(primitive, Primitive::Cut) {
            return None;
        }
        Some(Self {
            from,
            transition: transition.clone(),
            primitive,
            changes,
            started: now,
        })
    }

    /// How far through, eased, in 0..=1.
    pub fn progress(&self, now: Instant) -> f64 {
        self.transition.progress(now.saturating_duration_since(self.started))
    }

    pub fn is_over(&self, now: Instant) -> bool {
        self.transition
            .is_over(now.saturating_duration_since(self.started))
    }

    pub fn mode(&self) -> Mode {
        self.transition.mode
    }

    /// Which layers are taking part, for the caller that has to draw the rest.
    pub fn changes(&self) -> &Changes {
        &self.changes
    }

    /// Draw this moment of it onto `out`, from what was there to `to`.
    pub fn draw(&self, out: &mut PixmapMut<'_>, to: &Pixmap, now: Instant) {
        super::draw::draw(
            out,
            &self.from,
            to,
            self.primitive,
            self.transition.direction,
            self.progress(now),
        );
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::Duration;

    fn layer() -> Pixmap {
        Pixmap::new(8, 8).expect("a pixmap")
    }

    fn changed() -> Changes {
        Changes {
            changed: vec!["words".to_owned()],
            ..Changes::default()
        }
    }

    fn fade(duration_ms: u32) -> Transition {
        Transition {
            kind: "fade".to_owned(),
            duration_ms,
            ..Transition::none()
        }
    }

    #[test]
    fn a_slide_where_nothing_changed_does_not_transition() {
        assert!(
            Running::begin(layer(), &fade(400), Changes::default(), Instant::now()).is_none(),
            "the same slide again is not a change to animate"
        );
    }

    #[test]
    fn a_cut_and_a_zero_duration_do_not_transition() {
        let now = Instant::now();
        assert!(Running::begin(layer(), &Transition::none(), changed(), now).is_none());
        assert!(Running::begin(layer(), &fade(0), changed(), now).is_none());
    }

    #[test]
    fn a_transition_runs_from_nothing_to_everything_and_then_stops() {
        let now = Instant::now();
        let running =
            Running::begin(layer(), &fade(400), changed(), now).expect("it begins");

        assert_eq!(running.progress(now), 0.0);
        assert!(running.progress(now + Duration::from_millis(200)) > 0.0);
        assert_eq!(running.progress(now + Duration::from_millis(400)), 1.0);
        assert!(!running.is_over(now + Duration::from_millis(399)));
        assert!(running.is_over(now + Duration::from_millis(400)));
        assert_eq!(
            running.progress(now + Duration::from_secs(30)),
            1.0,
            "a frame that arrives late finishes it rather than overshooting"
        );
    }

    #[test]
    fn a_preset_this_build_cannot_draw_still_transitions() {
        // Particle Dissolve wants a GPU. It should read as *something*
        // happening rather than as a cut, which is what the fallback is for.
        let running = Running::begin(
            layer(),
            &Transition {
                kind: "particle-dissolve".to_owned(),
                duration_ms: 400,
                ..Transition::none()
            },
            changed(),
            Instant::now(),
        )
        .expect("it begins");
        assert_eq!(running.primitive, Primitive::Fade);
    }

    #[test]
    fn what_it_is_animating_is_kept_for_whoever_draws_the_rest() {
        let running =
            Running::begin(layer(), &fade(400), changed(), Instant::now()).expect("it begins");
        assert!(running.changes().touches("words"));
        assert_eq!(running.mode(), Mode::ChangedElements);
    }
}
