//! What actually changed between one slide and the next.
//!
//! The reason the whole engine exists. A presentation is not a video editor:
//! going from "Amazing Grace" to "How sweet the sound" changes the words and
//! nothing else, and the background video behind them must not restart, fade,
//! move or flicker. So a transition is told which layers changed, and the rest
//! are drawn exactly as they were.
//!
//! **What counts as a change is visual state, not identity.** An element the
//! React tree rebuilt but did not alter has not changed. A video still playing
//! has not changed, however far through it is — the position moves thirty
//! times a second, and treating that as a change would restart the background
//! on every frame, which is the one thing this must never do.

use std::collections::BTreeMap;

use crate::services::output::{MediaKind, OutputScene};

/// What moved between two scenes.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct Changes {
    /// Elements that are new, or whose visual state is different.
    pub changed: Vec<String>,
    /// Elements that were there and are not any more.
    pub removed: Vec<String>,
    /// The background media itself is a different thing — a different file, or
    /// switched off. **Not** the same video playing on.
    pub media_changed: bool,
}

impl Changes {
    /// Nothing to transition.
    pub fn is_nothing(&self) -> bool {
        self.changed.is_empty() && self.removed.is_empty() && !self.media_changed
    }

    /// Every element taking part, by key: the ones that changed and the ones
    /// that went.
    pub fn moving(&self) -> Vec<String> {
        let mut moving = self.changed.clone();
        moving.extend(self.removed.iter().cloned());
        moving
    }

    /// Whether this element takes part in a changed-elements transition.
    pub fn touches(&self, id: &str) -> bool {
        self.changed.iter().any(|changed| changed == id)
            || self.removed.iter().any(|removed| removed == id)
    }
}

/// The ends of the ids a theme gives the box behind the words and the
/// background it paints (`features/themes/theme-look.mjs`). Themes applied
/// before those ids were the same on every slide put the slide's own id in
/// front, so these match by the end alone.
const THEME_SHAPES: [&str; 2] = ["__theme-band", "__theme-bg"];

/// The key an element is matched by across two slides, from its id and its
/// place in the list.
///
/// Its id when it has one. An element without an id is matched by where it sits
/// in the list, which is what the React tree falls back to as well — imperfect,
/// and better than treating every element on the slide as new. A theme's box
/// and background are the same element on every slide, whatever their ids.
pub fn element_key(index: usize, id: &str) -> String {
    let id = id.trim();
    if id.is_empty() {
        return format!("#{index}");
    }
    THEME_SHAPES
        .iter()
        .find(|end| id.ends_with(*end))
        .map_or_else(|| id.to_owned(), |end| (*end).to_owned())
}

fn key_of(index: usize, element: &serde_json::Value) -> String {
    element_key(
        index,
        element
            .get("id")
            .and_then(serde_json::Value::as_str)
            .unwrap_or(""),
    )
}

/// Whether two elements matched by key look the same: everything but their
/// ids, which the key has already matched.
fn looks_the_same(before: &serde_json::Value, after: &serde_json::Value) -> bool {
    match (before.as_object(), after.as_object()) {
        (Some(was), Some(is)) => {
            let fields = |object: &serde_json::Map<String, serde_json::Value>| {
                object
                    .iter()
                    .filter(|(name, _)| name.as_str() != "id")
                    .map(|(name, value)| (name.clone(), value.clone()))
                    .collect::<BTreeMap<_, _>>()
            };
            fields(was) == fields(is)
        }
        _ => before == after,
    }
}

fn elements_of(scene: &OutputScene) -> BTreeMap<String, &serde_json::Value> {
    scene
        .slide_elements
        .as_ref()
        .and_then(serde_json::Value::as_array)
        .map(|elements| {
            elements
                .iter()
                .enumerate()
                .map(|(index, element)| (key_of(index, element), element))
                .collect()
        })
        .unwrap_or_default()
}

/// Whether the background is a different thing, rather than the same one
/// carrying on.
///
/// Deliberately blind to `video_current_time` and `is_video_playing`: a video
/// that is simply further through, or that the operator paused, is the same
/// video and must not be transitioned.
pub fn media_changed(before: &OutputScene, after: &OutputScene) -> bool {
    let shown = |scene: &OutputScene| -> Option<(String, Option<MediaKind>)> {
        if !scene.show_media || scene.hide_background {
            return None;
        }
        scene
            .media_url
            .as_ref()
            .filter(|url| !url.is_empty())
            .map(|url| (url.clone(), scene.media_type))
    };
    shown(before) != shown(after)
}

/// Compare two slides.
pub fn compare(before: &OutputScene, after: &OutputScene) -> Changes {
    let (was, is) = (elements_of(before), elements_of(after));

    let changed = is
        .iter()
        .filter(|(key, element)| {
            was.get(*key)
                .is_none_or(|before| !looks_the_same(before, element))
        })
        .map(|(key, _)| key.clone())
        .collect();
    let removed = was
        .keys()
        .filter(|key| !is.contains_key(*key))
        .cloned()
        .collect();

    Changes {
        changed,
        removed,
        media_changed: media_changed(before, after),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn scene(elements: serde_json::Value, media: Option<&str>) -> OutputScene {
        OutputScene {
            slide_elements: Some(elements),
            media_url: media.map(str::to_owned),
            media_type: media.map(|_| MediaKind::Video),
            show_media: media.is_some(),
            ..OutputScene::default()
        }
    }

    fn text(id: &str, content: &str) -> serde_json::Value {
        json!({ "id": id, "type": "text", "content": content, "x": 100.0, "y": 200.0 })
    }

    #[test]
    fn a_themes_box_and_background_stay_still_while_the_words_change() {
        let band = |id: &str| json!({ "id": id, "type": "shape", "x": 0.0, "y": 680.0, "style": { "backgroundColor": "#000000" } });
        let background = |id: &str| json!({ "id": id, "type": "shape", "style": { "fill": { "kind": "mix", "base": "#15161f", "spots": [] } } });
        // Ids as themes now give them, the same on every slide.
        let now = compare(
            &scene(
                json!([
                    background("__theme-bg"),
                    band("__theme-band"),
                    text("a_text_0", "Amazing grace")
                ]),
                None,
            ),
            &scene(
                json!([
                    background("__theme-bg"),
                    band("__theme-band"),
                    text("b_text_0", "How sweet")
                ]),
                None,
            ),
        );
        assert!(
            !now.touches("__theme-band") && !now.touches("__theme-bg"),
            "{now:?}"
        );
        assert!(
            now.touches("b_text_0") && now.touches("a_text_0"),
            "the words go and come"
        );
        // And as they were before, with each slide's id in front.
        let before = compare(
            &scene(
                json!([
                    background("a__theme-bg"),
                    band("a__theme-band"),
                    text("a_text_0", "Amazing grace")
                ]),
                None,
            ),
            &scene(
                json!([
                    background("b__theme-bg"),
                    band("b__theme-band"),
                    text("b_text_0", "How sweet")
                ]),
                None,
            ),
        );
        assert!(
            !before.touches("__theme-band") && !before.touches("__theme-bg"),
            "{before:?}"
        );
        assert_eq!(element_key(0, "b__theme-band"), "__theme-band");
        assert_eq!(element_key(3, ""), "#3");
    }

    #[test]
    fn only_the_words_that_changed_are_in_the_transition() {
        // The example from the brief: same background, same image, new words.
        let before = scene(
            json!([
                { "id": "bg", "type": "shape", "style": { "backgroundColor": "#0000ff" } },
                { "id": "cross", "type": "image", "content": "cross.png" },
                text("words", "Amazing Grace"),
            ]),
            None,
        );
        let after = scene(
            json!([
                { "id": "bg", "type": "shape", "style": { "backgroundColor": "#0000ff" } },
                { "id": "cross", "type": "image", "content": "cross.png" },
                text("words", "How sweet the sound"),
            ]),
            None,
        );

        let changes = compare(&before, &after);
        assert_eq!(changes.changed, vec!["words".to_owned()]);
        assert!(changes.removed.is_empty());
        assert!(!changes.media_changed);
        assert!(changes.touches("words"));
        assert!(!changes.touches("bg"), "the background is not touched");
        assert!(!changes.touches("cross"), "the image is not touched");
    }

    #[test]
    fn a_video_still_playing_is_not_a_change() {
        let mut before = scene(json!([text("words", "Amazing Grace")]), Some("loop.mp4"));
        before.video_current_time = 4.0;
        before.is_video_playing = true;
        let mut after = scene(
            json!([text("words", "How sweet the sound")]),
            Some("loop.mp4"),
        );
        // Four seconds later, and the operator paused it.
        after.video_current_time = 8.0;
        after.is_video_playing = false;

        let changes = compare(&before, &after);
        assert!(
            !changes.media_changed,
            "the same video, further through, is the same video"
        );
        assert_eq!(changes.changed, vec!["words".to_owned()]);
    }

    #[test]
    fn a_different_file_is_a_change_and_so_is_switching_the_media_off() {
        let one = scene(json!([]), Some("one.mp4"));
        let other = scene(json!([]), Some("two.mp4"));
        assert!(media_changed(&one, &other));

        let mut hidden = one.clone();
        hidden.show_media = false;
        assert!(media_changed(&one, &hidden), "nothing is showing now");

        let mut masked = one.clone();
        masked.hide_background = true;
        assert!(media_changed(&one, &masked));
    }

    #[test]
    fn an_element_that_arrives_or_goes_is_in_the_transition() {
        let before = scene(json!([text("words", "Amazing Grace")]), None);
        let after = scene(
            json!([
                text("words", "Amazing Grace"),
                { "id": "logo", "type": "image", "content": "logo.png" },
            ]),
            None,
        );

        let arrived = compare(&before, &after);
        assert_eq!(arrived.changed, vec!["logo".to_owned()]);
        assert!(arrived.removed.is_empty());

        let gone = compare(&after, &before);
        assert!(gone.changed.is_empty());
        assert_eq!(gone.removed, vec!["logo".to_owned()]);
    }

    #[test]
    fn moving_or_restyling_an_element_counts_even_when_its_words_do_not_change() {
        let before = scene(json!([text("words", "Amazing Grace")]), None);
        let mut moved = text("words", "Amazing Grace");
        moved["y"] = json!(400.0);
        let after = scene(json!([moved]), None);
        assert_eq!(compare(&before, &after).changed, vec!["words".to_owned()]);
    }

    #[test]
    fn the_same_slide_twice_transitions_nothing() {
        let slide = scene(json!([text("words", "Amazing Grace")]), Some("loop.mp4"));
        assert!(compare(&slide, &slide).is_nothing());
    }

    #[test]
    fn elements_with_no_id_are_matched_by_where_they_sit() {
        let before = scene(json!([{ "type": "text", "content": "one" }]), None);
        let after = scene(json!([{ "type": "text", "content": "two" }]), None);
        assert_eq!(compare(&before, &after).changed, vec!["#0".to_owned()]);
    }
}
