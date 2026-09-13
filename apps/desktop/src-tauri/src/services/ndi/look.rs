//! What the NDI stream shows: the audience scene, through the Looks window's
//! NDI column.
//!
//! Electron's stream is a capture of the audience window, so it shows the
//! program column, and the NDI column in the Looks window is saved and read by
//! nothing. The owner's call for the rewrite is that the stream follows the NDI
//! column.
//!
//! The audience scene arrives with the program column already folded in —
//! `App.tsx:535-546` turns the live look's program layers into scene fields
//! before the operator sends it. This replaces those fields with the NDI
//! column's, derived the same way:
//!
//! | NDI layer                  | scene field       | `App.tsx`                  |
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
//! clears anything when the NDI column changes, so a flag that did not gate the
//! banner would do nothing at all. Here it gates.
//!
//! **What this does not carry over:** the operator's quick toggles — show text,
//! show media, hide background, the timer — write to the program column only
//! (`App.tsx:548-600`). Clearing the words on the projector does not clear them
//! on the stream.

use crate::services::looks::{LookTargetState, LookTextPosition, TextAlign, VerticalAlign};
use crate::services::output::{OutputScene, OutputTextPosition};

pub fn scene_for_ndi(on_screen: &OutputScene, ndi: &LookTargetState) -> OutputScene {
    let layers = &ndi.layers;
    let messages = layers.messages || layers.announcements;

    OutputScene {
        show_text: layers.slide || layers.presentation,
        show_media: layers.media || layers.video_input,
        hide_background: layers.mask,
        timer_visible: layers.props,
        text_position: Some(text_position(&ndi.text_position)),
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

        let ndi = scene_for_ndi(&program, &default_ndi());
        assert!(!ndi.timer_visible, "the default NDI column hides props");
        assert!(ndi.message_overlay.is_some(), "and shows messages");
        assert!(ndi.show_text);
        assert!(ndi.show_media);
        assert!(!ndi.hide_background);
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
        let scene = program_scene();

        let none = scene_for_ndi(&scene, &target(off));
        assert!(!none.show_text && !none.show_media && !none.hide_background);
        assert!(!none.timer_visible && none.message_overlay.is_none());

        for layers in [
            LookLayers { slide: true, ..off },
            LookLayers {
                presentation: true,
                ..off
            },
        ] {
            assert!(scene_for_ndi(&scene, &target(layers)).show_text);
        }
        for layers in [
            LookLayers { media: true, ..off },
            LookLayers {
                video_input: true,
                ..off
            },
        ] {
            assert!(scene_for_ndi(&scene, &target(layers)).show_media);
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
            assert!(scene_for_ndi(&scene, &target(layers))
                .message_overlay
                .is_some());
        }
        assert!(scene_for_ndi(&scene, &target(LookLayers { mask: true, ..off })).hide_background);
        assert!(scene_for_ndi(&scene, &target(LookLayers { props: true, ..off })).timer_visible);
    }

    #[test]
    fn a_banner_the_operator_has_not_put_up_is_not_invented() {
        let scene = OutputScene {
            message_overlay: None,
            ..program_scene()
        };
        assert!(scene_for_ndi(&scene, &default_ndi())
            .message_overlay
            .is_none());
    }

    #[test]
    fn the_ndi_text_position_replaces_the_programs() {
        let mut ndi = default_ndi();
        ndi.text_position.y_percent = 80.0;
        ndi.text_position.text_align = TextAlign::Left;
        ndi.text_position.vertical_align = VerticalAlign::Bottom;

        let position = scene_for_ndi(&program_scene(), &ndi)
            .text_position
            .expect("a position");
        assert_eq!(position.y_percent, 80.0);
        assert_eq!(position.text_align, "left");
        assert_eq!(position.vertical_align, "bottom");
    }

    #[test]
    fn everything_the_looks_do_not_govern_is_left_alone() {
        let scene = program_scene();
        let ndi = scene_for_ndi(&scene, &default_ndi());
        assert_eq!(ndi.slide_text, scene.slide_text);
        assert_eq!(ndi.timer_text, scene.timer_text);
        assert_eq!(ndi.media_url, scene.media_url);
        assert_eq!(ndi.props_overlay, scene.props_overlay);
    }
}
