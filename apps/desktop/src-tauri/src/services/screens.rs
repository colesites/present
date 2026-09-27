//! The screens Present draws to, as Screen Configuration lists them.
//!
//! Two groups, as ProPresenter has them: **Audience**, what the room sees,
//! and **Stage**, the confidence monitors. Each starts with the screens the
//! app always had — the audience output, the media stage and the worship
//! stage — and the operator can add more to either: a second projector
//! showing the audience picture, a monitor at the back of the room with the
//! worship stage on it.
//!
//! A screen is drawn at its own size, which is the picture's resolution, and
//! that picture is put on its output either filling it or fitted inside it.
//! Its colour is what shows behind everything else on it.
//!
//! The three screens the app always had keep their windows and everything
//! that already knows them by name (`output`, `media-stage`,
//! `worship-stage`); an added one has a window of its own, `audience-<id>` or
//! `stage-<id>`. The output chosen for each is kept with the display
//! preferences, by the screen's id, which for the first three is the name
//! their role was always stored under.
//!
//! No Tauri types.

use serde::{Deserialize, Serialize};

use super::display::ScreenRole;
use crate::state::display_state::Resolution;

/// The audience output's id: `ScreenRole::Audience`'s stored name.
pub const AUDIENCE: &str = "audience";
/// The media stage's id.
pub const MEDIA: &str = "media";
/// The worship stage's id.
pub const WORSHIP: &str = "worship";

/// Label prefixes for the windows of added screens.
pub const AUDIENCE_WINDOW_PREFIX: &str = "audience-";
pub const STAGE_WINDOW_PREFIX: &str = "stage-";

/// A name is shown in a list and across a screen by Identify; this is plenty.
const MAX_NAME: usize = 40;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum ScreenGroup {
    Audience,
    Stage,
}

/// What a stage screen shows.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum StageLayout {
    /// What is on screen and what is next, with the clock: the media desk's.
    Media,
    /// The words, large, for the band.
    Worship,
}

impl StageLayout {
    /// The page's `?window=` value.
    pub fn page(self) -> &'static str {
        match self {
            StageLayout::Media => "media-stage",
            StageLayout::Worship => "worship-stage",
        }
    }
}

/// How the picture goes on its output.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum OutputTarget {
    /// Stretched to the whole output.
    #[default]
    Full,
    /// Its own shape, inside the output, with black at the edges.
    Fit,
}

/// One screen.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScreenSetup {
    pub id: String,
    pub group: ScreenGroup,
    pub name: String,
    /// A stage screen's layout. The two built in are fixed.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub layout: Option<StageLayout>,
    /// The size the picture is drawn at. `None`: its output's own.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub size: Option<Resolution>,
    /// Behind everything on it. `None`: black.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub color: Option<String>,
    #[serde(default)]
    pub target: OutputTarget,
}

impl ScreenSetup {
    /// The three every setup has, as they start.
    pub fn built_ins() -> [ScreenSetup; 3] {
        let screen = |id: &str, group, name: &str, layout| ScreenSetup {
            id: id.to_owned(),
            group,
            name: name.to_owned(),
            layout,
            size: None,
            color: None,
            target: OutputTarget::Full,
        };
        [
            screen(AUDIENCE, ScreenGroup::Audience, "Screen", None),
            screen(
                MEDIA,
                ScreenGroup::Stage,
                "Media stage",
                Some(StageLayout::Media),
            ),
            screen(
                WORSHIP,
                ScreenGroup::Stage,
                "Worship stage",
                Some(StageLayout::Worship),
            ),
        ]
    }

    pub fn is_built_in(&self) -> bool {
        is_built_in(&self.id)
    }

    /// The role one of the three built in plays; `None` for an added screen.
    pub fn role(&self) -> Option<ScreenRole> {
        match self.id.as_str() {
            AUDIENCE => Some(ScreenRole::Audience),
            MEDIA => Some(ScreenRole::Media),
            WORSHIP => Some(ScreenRole::Worship),
            _ => None,
        }
    }

    /// What a stage screen shows. The worship stage's, for one that never
    /// chose.
    pub fn stage_layout(&self) -> StageLayout {
        match self.id.as_str() {
            MEDIA => StageLayout::Media,
            WORSHIP => StageLayout::Worship,
            _ => self.layout.unwrap_or(StageLayout::Worship),
        }
    }

    /// The label of this screen's window.
    pub fn window_label(&self) -> String {
        match self.id.as_str() {
            AUDIENCE => "output".to_owned(),
            MEDIA => "media-stage".to_owned(),
            WORSHIP => "worship-stage".to_owned(),
            id => match self.group {
                ScreenGroup::Audience => format!("{AUDIENCE_WINDOW_PREFIX}{id}"),
                ScreenGroup::Stage => format!("{STAGE_WINDOW_PREFIX}{id}"),
            },
        }
    }

    /// Only what an operator may change, and within bounds.
    fn sanitized(mut self) -> Self {
        let name: String = self.name.trim().chars().take(MAX_NAME).collect();
        self.name = if name.is_empty() {
            match self.group {
                ScreenGroup::Audience => "Screen".to_owned(),
                ScreenGroup::Stage => "Stage".to_owned(),
            }
        } else {
            name
        };
        self.size = self.size.map(Resolution::sanitized);
        self.color = self
            .color
            .map(|color| color.trim().chars().take(32).collect::<String>())
            .filter(|color| !color.is_empty());
        if self.group == ScreenGroup::Audience {
            self.layout = None;
        }
        self
    }
}

pub fn is_built_in(id: &str) -> bool {
    matches!(id, AUDIENCE | MEDIA | WORSHIP)
}

/// Which screen a window belongs to, by its label.
pub fn screen_id_for_label(label: &str) -> Option<&str> {
    match label {
        "output" => Some(AUDIENCE),
        "media-stage" => Some(MEDIA),
        "worship-stage" => Some(WORSHIP),
        _ => label
            .strip_prefix(AUDIENCE_WINDOW_PREFIX)
            .or_else(|| label.strip_prefix(STAGE_WINDOW_PREFIX))
            .filter(|id| is_usable_id(id)),
    }
}

/// An id that is safe in a window label and a URL, and is not a built-in's.
pub fn is_usable_id(id: &str) -> bool {
    !id.is_empty()
        && id.len() <= 32
        && !is_built_in(id)
        && id
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
}

/// Every screen, the three built in first in their groups and the added ones
/// after them in the order they were added: what was stored, with anything
/// missing or unusable put right.
pub fn arranged(stored: &[ScreenSetup]) -> Vec<ScreenSetup> {
    let built_in = ScreenSetup::built_ins().map(|default| {
        let Some(saved) = stored.iter().find(|screen| screen.id == default.id) else {
            return default;
        };
        // What is chosen is kept; what the screen is, is not the operator's
        // to change.
        ScreenSetup {
            id: default.id.clone(),
            group: default.group,
            layout: default.layout,
            ..saved.clone()
        }
        .sanitized()
    });
    let [audience, media, worship] = built_in;
    let added = |group: ScreenGroup| {
        let mut seen = std::collections::HashSet::new();
        stored
            .iter()
            .filter(move |screen| screen.group == group && is_usable_id(&screen.id))
            .filter(move |screen| seen.insert(screen.id.clone()))
            .cloned()
            .map(ScreenSetup::sanitized)
            .collect::<Vec<_>>()
    };

    let mut screens = vec![audience];
    screens.extend(added(ScreenGroup::Audience));
    screens.push(media);
    screens.push(worship);
    screens.extend(added(ScreenGroup::Stage));
    screens
}

/// A name for a screen being added: the group's word and the next number.
pub fn next_name(screens: &[ScreenSetup], group: ScreenGroup) -> String {
    let word = match group {
        ScreenGroup::Audience => "Screen",
        ScreenGroup::Stage => "Stage",
    };
    let count = screens
        .iter()
        .filter(|screen| screen.group == group)
        .count();
    let taken = |name: &str| screens.iter().any(|screen| screen.name == name);
    (count + 1..)
        .map(|number| format!("{word} {number}"))
        .find(|name| !taken(name))
        .unwrap_or_else(|| word.to_owned())
}

/// A new screen, sanitized.
pub fn new_screen(id: String, group: ScreenGroup, name: String) -> ScreenSetup {
    ScreenSetup {
        id,
        group,
        name,
        layout: (group == ScreenGroup::Stage).then_some(StageLayout::Worship),
        size: None,
        color: None,
        target: OutputTarget::Full,
    }
    .sanitized()
}

/// A change to one screen, as Screen Configuration sends it. A field left out
/// is left as it is; `size` and `color` can be set to `null` to go back to
/// the output's own size and to black.
#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScreenPatch {
    #[serde(default)]
    pub name: Option<String>,
    #[serde(default, deserialize_with = "present")]
    pub size: Option<Option<Resolution>>,
    #[serde(default, deserialize_with = "present")]
    pub color: Option<Option<String>>,
    #[serde(default)]
    pub target: Option<OutputTarget>,
    #[serde(default)]
    pub layout: Option<StageLayout>,
}

fn present<'de, D, T>(deserializer: D) -> Result<Option<Option<T>>, D::Error>
where
    D: serde::Deserializer<'de>,
    T: Deserialize<'de>,
{
    Option::deserialize(deserializer).map(Some)
}

impl ScreenPatch {
    /// `screen` with this change made.
    pub fn apply(self, screen: &ScreenSetup) -> ScreenSetup {
        let mut next = screen.clone();
        if let Some(name) = self.name {
            next.name = name;
        }
        if let Some(size) = self.size {
            next.size = size;
        }
        if let Some(color) = self.color {
            next.color = color;
        }
        if let Some(target) = self.target {
            next.target = target;
        }
        if let (Some(layout), false) = (self.layout, screen.is_built_in()) {
            next.layout = Some(layout);
        }
        next.sanitized()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_new_setup_has_the_three_screens_the_app_always_had() {
        let screens = arranged(&[]);
        let ids: Vec<&str> = screens.iter().map(|screen| screen.id.as_str()).collect();
        assert_eq!(ids, [AUDIENCE, MEDIA, WORSHIP]);
        let labels: Vec<String> = screens.iter().map(ScreenSetup::window_label).collect();
        assert_eq!(labels, ["output", "media-stage", "worship-stage"]);
        assert_eq!(screens[0].name, "Screen");
        assert_eq!(screens[1].stage_layout(), StageLayout::Media);
        assert_eq!(screens[2].stage_layout(), StageLayout::Worship);
    }

    #[test]
    fn added_screens_sit_in_their_group_after_the_built_in_ones() {
        let stored = vec![
            new_screen("back".into(), ScreenGroup::Stage, "Back wall".into()),
            new_screen("lobby".into(), ScreenGroup::Audience, "Lobby".into()),
        ];
        let ids: Vec<String> = arranged(&stored)
            .into_iter()
            .map(|screen| screen.id)
            .collect();
        assert_eq!(ids, [AUDIENCE, "lobby", MEDIA, WORSHIP, "back"]);
        let lobby = &arranged(&stored)[1];
        assert_eq!(lobby.window_label(), "audience-lobby");
        assert_eq!(screen_id_for_label("audience-lobby"), Some("lobby"));
        assert_eq!(screen_id_for_label("stage-back"), Some("back"));
        assert_eq!(screen_id_for_label("output"), Some(AUDIENCE));
        assert_eq!(screen_id_for_label("settings"), None);
    }

    #[test]
    fn a_built_in_screen_keeps_what_it_is_whatever_was_stored() {
        let stored = vec![ScreenSetup {
            id: MEDIA.into(),
            group: ScreenGroup::Audience,
            name: "  Desk  ".into(),
            layout: Some(StageLayout::Worship),
            size: Some(Resolution {
                width: 1280,
                height: 720,
            }),
            color: None,
            target: OutputTarget::Fit,
        }];
        let media = arranged(&stored)
            .into_iter()
            .find(|screen| screen.id == MEDIA)
            .unwrap();
        assert_eq!(media.group, ScreenGroup::Stage);
        assert_eq!(media.stage_layout(), StageLayout::Media);
        assert_eq!(media.name, "Desk", "renamed, and trimmed");
        assert_eq!(media.target, OutputTarget::Fit);
        assert_eq!(media.size.map(|size| size.width), Some(1280));
    }

    #[test]
    fn nothing_unsafe_or_doubled_becomes_a_window() {
        let stored = vec![
            new_screen("../x".into(), ScreenGroup::Audience, "Bad".into()),
            new_screen("output".into(), ScreenGroup::Audience, "Clash".into()),
            new_screen("twice".into(), ScreenGroup::Stage, "One".into()),
            new_screen("twice".into(), ScreenGroup::Stage, "Two".into()),
        ];
        let ids: Vec<String> = arranged(&stored)
            .into_iter()
            .map(|screen| screen.id)
            .collect();
        assert_eq!(ids, [AUDIENCE, "output", MEDIA, WORSHIP, "twice"]);
        // "output" is an unusual id, but only built-in ids are refused: the
        // window is `audience-output`, which clashes with nothing.
        assert_eq!(
            arranged(&stored)[1].window_label(),
            "audience-output".to_owned()
        );
    }

    #[test]
    fn a_new_screen_is_numbered_after_what_its_group_has() {
        let screens = arranged(&[]);
        assert_eq!(next_name(&screens, ScreenGroup::Audience), "Screen 2");
        assert_eq!(next_name(&screens, ScreenGroup::Stage), "Stage 3");
    }

    #[test]
    fn a_change_leaves_out_what_it_does_not_mention() {
        let screen = new_screen("lobby".into(), ScreenGroup::Audience, "Lobby".into());
        let patch: ScreenPatch = serde_json::from_value(serde_json::json!({
            "size": { "width": 1280, "height": 720 },
            "color": "#102030"
        }))
        .unwrap();
        let changed = patch.apply(&screen);
        assert_eq!(changed.name, "Lobby");
        assert_eq!(changed.color.as_deref(), Some("#102030"));
        assert_eq!(changed.size.map(|size| size.height), Some(720));

        let back: ScreenPatch =
            serde_json::from_value(serde_json::json!({ "size": null, "color": null })).unwrap();
        let reset = back.apply(&changed);
        assert_eq!(
            (reset.size, reset.color),
            (None, None),
            "null is back to the defaults"
        );

        let blank: ScreenPatch =
            serde_json::from_value(serde_json::json!({ "name": "   " })).unwrap();
        assert_eq!(blank.apply(&screen).name, "Screen", "never nameless");
    }
}
