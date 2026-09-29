//! What a surface drawn through a look column shows: the audience scene,
//! through that column. The NDI output in Connections goes through the NDI
//! column, and each audience screen added in Screen Configuration through its
//! own; the Screen every setup has is the program column, which the operator
//! window folds into the scene itself.
//!
//! Electron's stream is a capture of the audience window, so it shows the
//! program column, and the NDI column in the Looks window is saved and read by
//! nothing. The owner's call for the rewrite is that the stream follows the NDI
//! column — and a screen added beside the Screen follows its own.
//!
//! The audience scene arrives with the program column already folded in —
//! `App.tsx:535-546` turns the live look's program layers into scene fields
//! before the operator sends it. This replaces those fields with the column's,
//! derived the same way:
//!
//! | layer                      | scene field       | `App.tsx`                  |
//! |----------------------------|-------------------|----------------------------|
//! | slide or presentation      | `show_text`       | `showTextInOutput`         |
//! | media or video input       | `show_media`      | `showMediaInOutput`        |
//! | mask                       | `hide_background` | `hideBackgroundInOutput`   |
//! | props                      | `timer_visible`   | `isTimerLayerEnabled`      |
//! | text position              | `text_position`   | `outputTextPosition`       |
//! | messages or announcements  | `message_overlay` | `isMessageLayerEnabled`    |
//!
//! **Messages are the one row that is not a straight copy.** The program side
//! deliberately does not gate the banner on its flag
//! (`PresentContainer.tsx:1787-1792`: the gate raced the overlay and dropped
//! banners); switching the program layer off clears the overlay instead. Nothing
//! clears anything when another column changes, so a flag that did not gate the
//! banner would do nothing at all. Here it gates.
//!
//! **The operator's quick toggles reach every column too** (owner, 2026-09-17).
//! A column says which layers its surface may carry; the toggles say what is
//! showing this minute, and the scene arrives carrying them. A layer shows
//! when both agree, and the background is hidden if either asks — so clearing
//! the words on the projector clears them everywhere, while a column with the
//! words switched off never shows them whatever the operator does.

use crate::services::looks::{LookTargetState, LookTextPosition, TextAlign, VerticalAlign};
use crate::services::output::{OutputScene, OutputTextPosition};

pub fn scene_for_look(on_screen: &OutputScene, column: &LookTargetState) -> OutputScene {
    let layers = &column.layers;
    let messages = layers.messages || layers.announcements;

    OutputScene {
        // The column allows it, the operator is showing it.
        show_text: (layers.slide || layers.presentation) && on_screen.show_text,
        show_media: (layers.media || layers.video_input) && on_screen.show_media,
        // Either hiding the background hides it.
        hide_background: layers.mask || on_screen.hide_background,
        timer_visible: layers.props && on_screen.timer_visible,
        text_position: Some(text_position(&column.text_position)),
        message_overlay: on_screen.message_overlay.clone().filter(|_| messages),
        ..on_screen.clone()
    }
}

fn text_position(position: &LookTextPosition) -> OutputTextPosition {
    OutputTextPosition {
        x_percent: position.x_percent,
        y_percent: position.y_percent,
        width_percent: position.width_percent,
        height_percent: position.height_percent,
        text_align: match position.text_align {
            TextAlign::Left => "left",
            TextAlign::Center => "center",
            TextAlign::Right => "right",
        }
        .to_owned(),
        vertical_align: match position.vertical_align {
            VerticalAlign::Top => "top",
            VerticalAlign::Middle => "middle",
            VerticalAlign::Bottom => "bottom",
        }
        .to_owned(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::services::looks::{LookLayers, LookPreset};
    use crate::services::output::MessageOverlay;

    fn default_ndi() -> LookTargetState {
        LookPreset::default_preset().targets.ndi
    }

    /// The scene as the operator sends it with the default look: the program
    /// column folded in.
    fn program_scene() -> OutputScene {
        let program = LookPreset::default_preset().targets.program;
        OutputScene {
            show_text: program.layers.slide || program.layers.presentation,
            show_media: program.layers.media || program.layers.video_input,
            hide_background: program.layers.mask,
            timer_visible: program.layers.props,
            message_overlay: Some(banner()),
            slide_text: Some("Amazing grace".to_owned()),
            timer_text: Some("00:05:00".to_owned()),
            ..OutputScene::default()
        }
    }

    fn banner() -> MessageOverlay {
        MessageOverlay {
            id: "m1".to_owned(),
            text: "Welcome".to_owned(),
            position: "bottom".to_owned(),
            theme_key: "default".to_owned(),
            shown_at_ms: 0.0,
            dismiss_mode: "manual".to_owned(),
            animation: "none".to_owned(),
            speed_seconds: 0.0,
            font_scale: 1.0,
        }
    }

    #[test]
    fn with_the_default_look_the_stream_gains_the_banner_and_loses_the_timer() {
        // The visible difference the owner accepted when choosing the NDI column.
        let program = program_scene();
        assert!(program.timer_visible, "the projector shows the timer");

        let ndi = scene_for_look(&program, &default_ndi());
        assert!(!ndi.timer_visible, "the default NDI column hides props");
        assert!(ndi.message_overlay.is_some(), "and shows messages");
        assert!(ndi.show_text);
        assert!(ndi.show_media);
        assert!(!ndi.hide_background);
    }

    #[test]
    fn clearing_the_words_on_the_projector_clears_them_on_the_stream() {
        let showing = OutputScene {
            show_text: true,
            show_media: true,
            timer_visible: true,
            hide_background: false,
            ..program_scene()
        };
        let mut ndi = default_ndi();
        ndi.layers.props = true;
        assert!(scene_for_look(&showing, &ndi).show_text);
        assert!(scene_for_look(&showing, &ndi).timer_visible);

        // The operator clears each one.
        let cleared = OutputScene {
            show_text: false,
            show_media: false,
            timer_visible: false,
            hide_background: true,
            ..showing
        };
        let stream = scene_for_look(&cleared, &ndi);
        assert!(!stream.show_text, "the words are gone from the stream");
        assert!(!stream.show_media);
        assert!(!stream.timer_visible);
        assert!(stream.hide_background, "and the background with them");
    }

    #[test]
    fn a_column_with_a_layer_switched_off_never_shows_it() {
        let showing = OutputScene {
            show_text: true,
            show_media: true,
            ..program_scene()
        };
        let mut ndi = default_ndi();
        ndi.layers.slide = false;
        ndi.layers.presentation = false;
        assert!(
            !scene_for_look(&showing, &ndi).show_text,
            "the stream is set up without words"
        );
    }

    #[test]
    fn each_layer_pair_reaches_its_field_either_way_round() {
        let off = LookLayers {
            mask: false,
            messages: false,
            props: false,
            announcements: false,
            presentation: false,
            slide: false,
            media: false,
            video_input: false,
        };
        let target = |layers: LookLayers| LookTargetState {
            layers,
            ..default_ndi()
        };
        // The operator is showing everything, so the column decides.
        let scene = OutputScene {
            show_text: true,
            show_media: true,
            timer_visible: true,
            hide_background: false,
            ..program_scene()
        };

        let none = scene_for_look(&scene, &target(off));
        assert!(!none.show_text && !none.show_media && !none.hide_background);
        assert!(!none.timer_visible && none.message_overlay.is_none());

        for layers in [
            LookLayers { slide: true, ..off },
            LookLayers {
                presentation: true,
                ..off
            },
        ] {
            assert!(scene_for_look(&scene, &target(layers)).show_text);
        }
        for layers in [
            LookLayers { media: true, ..off },
            LookLayers {
                video_input: true,
                ..off
            },
        ] {
            assert!(scene_for_look(&scene, &target(layers)).show_media);
        }
        for layers in [
            LookLayers {
                messages: true,
                ..off
            },
            LookLayers {
                announcements: true,
                ..off
            },
        ] {
            assert!(scene_for_look(&scene, &target(layers))
                .message_overlay
                .is_some());
        }
        assert!(scene_for_look(&scene, &target(LookLayers { mask: true, ..off })).hide_background);
        assert!(scene_for_look(&scene, &target(LookLayers { props: true, ..off })).timer_visible);
    }

    #[test]
    fn a_banner_the_operator_has_not_put_up_is_not_invented() {
        let scene = OutputScene {
            message_overlay: None,
            ..program_scene()
        };
        assert!(scene_for_look(&scene, &default_ndi())
            .message_overlay
            .is_none());
    }

    #[test]
    fn the_ndi_text_position_replaces_the_programs() {
        let mut ndi = default_ndi();
        ndi.text_position.y_percent = 80.0;
        ndi.text_position.text_align = TextAlign::Left;
        ndi.text_position.vertical_align = VerticalAlign::Bottom;

        let position = scene_for_look(&program_scene(), &ndi)
            .text_position
            .expect("a position");
        assert_eq!(position.y_percent, 80.0);
        assert_eq!(position.text_align, "left");
        assert_eq!(position.vertical_align, "bottom");
    }

    #[test]
    fn everything_the_looks_do_not_govern_is_left_alone() {
        let scene = program_scene();
        let ndi = scene_for_look(&scene, &default_ndi());
        assert_eq!(ndi.slide_text, scene.slide_text);
        assert_eq!(ndi.timer_text, scene.timer_text);
        assert_eq!(ndi.media_url, scene.media_url);
        assert_eq!(ndi.props_overlay, scene.props_overlay);
    }
}
