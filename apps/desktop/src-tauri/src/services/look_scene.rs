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
//! | slide (Text), for words    | `show_text`       | `showTextInOutput`         |
//! | presentation (Slide), for  | `show_text`       | `showSlideInOutput`        |
//! | a presentation's slides    |                   |                            |
//! | media or video input       | `show_media`      | `showMediaInOutput`        |
//! | mask                       | `hide_background` | `hideBackgroundInOutput`   |
//! | timer                      | `timer_visible`   | `isTimerLayerEnabled`      |
//! | props                      | `props_overlay`   | —                          |
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
//!
//! **Text and Slide share the one slide on screen.** A presentation's slide —
//! a PDF's page, a PowerPoint's — is on the Slide layer and anything else on
//! the Text layer, as `presentation_slide` says; `show_text` is whether that
//! slide shows, and a column passes it only where its switch for that layer
//! is on.
//!
//! **Then the column's layout** (`LookLayout`): where on its screen each layer
//! goes. The words, a presentation's slide, the media and props are boxes the
//! screen's renderer draws into (`screen_layout`); the timer and the banner
//! are moved and sized through their own fields, so they are drawn at the
//! size they are shown.

use crate::services::looks::{
    LookBox, LookLayout, LookTargetState, LookTextPosition, MessageEdge, TextAlign, VerticalAlign,
};
use crate::services::output::{LayerBox, OutputScene, OutputTextPosition, ScreenLayout};

/// The Screen every setup has, through the program column. The operator
/// window folds that column's layers into the scene before sending it — all
/// but props, which it leaves to this — so only they and the layout are
/// applied here. The banner is not gated, as the module's notes say.
///
/// The timer is gated here as well. The operator window folds its own copy of
/// the column, which starts as the shipped look — timer on — until the
/// app's arrives, so the first scenes it sent after a launch showed the timer
/// for a moment with the operator's timer off. This copy is the app's own,
/// read before any window opened.
pub fn scene_for_program(on_screen: &OutputScene, column: &LookTargetState) -> OutputScene {
    let scene = OutputScene {
        props_overlay: if column.layers.props {
            on_screen.props_overlay.clone()
        } else {
            Vec::new()
        },
        timer_visible: column.layers.timer && on_screen.timer_visible,
        ..on_screen.clone()
    };
    laid_out(scene, &column.layout)
}

pub fn scene_for_look(on_screen: &OutputScene, column: &LookTargetState) -> OutputScene {
    let layers = &column.layers;
    let messages = layers.messages || layers.announcements;

    // A presentation's slide is the Slide layer's, any other the Text layer's.
    let slide_layer = if on_screen.presentation_slide {
        layers.presentation
    } else {
        layers.slide
    };

    let scene = OutputScene {
        // The column allows it, the operator is showing it.
        show_text: slide_layer && on_screen.show_text,
        show_media: (layers.media || layers.video_input) && on_screen.show_media,
        // Either hiding the background hides it.
        hide_background: layers.mask || on_screen.hide_background,
        timer_visible: layers.timer && on_screen.timer_visible,
        // The props the operator put up, where the column has them.
        props_overlay: if layers.props {
            on_screen.props_overlay.clone()
        } else {
            Vec::new()
        },
        text_position: Some(text_position(&column.text_position)),
        message_overlay: on_screen.message_overlay.clone().filter(|_| messages),
        ..on_screen.clone()
    };
    laid_out(scene, &column.layout)
}

/// The scene with a column's layout applied. A column no one laid out leaves
/// it exactly as it was.
fn laid_out(mut scene: OutputScene, layout: &LookLayout) -> OutputScene {
    if layout.is_default() {
        return scene;
    }
    if let Some(words) = layout.words.as_ref() {
        scene.text_position = Some(text_position(&LookTextPosition {
            x_percent: words.area.x_percent,
            y_percent: words.area.y_percent,
            width_percent: words.area.width_percent,
            height_percent: words.area.height_percent,
            text_align: words.text_align,
            vertical_align: words.vertical_align,
        }));
    }
    scene.screen_layout = Some(ScreenLayout {
        words_box: layout.words.as_ref().map(|words| layer_box(words.area)),
        words_text_only: layout.words.as_ref().is_some_and(|words| words.text_only),
        words_scale: layout
            .words
            .as_ref()
            .map_or(1.0, |words| words.scale_percent / 100.0),
        words_backdrop: layout
            .words
            .as_ref()
            .and_then(|words| words.backdrop.clone()),
        slide_box: layout.slide.map_or(LayerBox::FULL, layer_box),
        media_box: layout
            .media
            .map_or(LayerBox::FULL, |media| layer_box(media.area)),
        media_fill: layout.media.is_some_and(|media| media.fill),
        props_box: layout.props.map_or(LayerBox::FULL, layer_box),
    });
    if let (Some(placed), Some(timer)) = (layout.timer, scene.timer_layout.as_mut()) {
        let scale = placed.scale_percent / 100.0;
        timer.x_percent = placed.x_percent;
        timer.y_percent = placed.y_percent;
        timer.clock_font_px *= scale;
        timer.name_font_px *= scale;
        timer.name_banner_height_px *= scale;
    }
    if let (Some(placed), Some(message)) = (layout.messages, scene.message_overlay.as_mut()) {
        match placed.edge {
            MessageEdge::AsSent => {}
            MessageEdge::Top => message.position = "top".to_owned(),
            MessageEdge::Bottom => message.position = "bottom".to_owned(),
        }
        message.font_scale *= placed.scale_percent / 100.0;
    }
    scene
}

fn layer_box(area: LookBox) -> LayerBox {
    LayerBox {
        x_percent: area.x_percent,
        y_percent: area.y_percent,
        width_percent: area.width_percent,
        height_percent: area.height_percent,
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
    use crate::services::output::{MessageOverlay, PropsOverlayItem};

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
            timer_visible: program.layers.timer,
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

    fn timer_layout() -> crate::services::output::TimerLayout {
        crate::services::output::TimerLayout {
            x_percent: 50.0,
            y_percent: 90.0,
            clock_font_px: 100.0,
            name_font_px: 40.0,
            name_banner_height_px: 48.0,
            clock_color: "#ffffff".to_owned(),
            name_color: "#ffffff".to_owned(),
            name_banner_enabled: false,
            name_banner_color: "#000000".to_owned(),
            title_position: "bottom".to_owned(),
            box_color: None,
        }
    }

    #[test]
    fn a_column_no_one_laid_out_leaves_the_scene_as_it_was() {
        let program = program_scene();
        let ndi = scene_for_look(&program, &default_ndi());
        assert_eq!(ndi.screen_layout, None);
        let screen = scene_for_program(&program, &LookPreset::default_preset().targets.program);
        assert_eq!(screen, program, "the Screen shows what the operator sent");
    }

    #[test]
    fn a_lower_third_column_puts_the_words_in_their_band() {
        let mut column = default_ndi();
        column.layout = crate::services::looks::normalize_layout(Some(&serde_json::json!({
            "words": {
                "area": { "xPercent": 50, "yPercent": 84, "widthPercent": 90, "heightPercent": 24 },
                "textAlign": "left",
                "verticalAlign": "bottom",
                "scalePercent": 70,
                "textOnly": true,
                "backdrop": "#000000b3",
            },
            "media": { "area": { "xPercent": 25, "yPercent": 50, "widthPercent": 50, "heightPercent": 100 }, "fill": true },
        })));
        let scene = scene_for_look(&program_scene(), &column);
        let layout = scene.screen_layout.expect("a layout");
        assert_eq!(
            layout.words_box,
            Some(LayerBox {
                x_percent: 50.0,
                y_percent: 84.0,
                width_percent: 90.0,
                height_percent: 24.0
            })
        );
        assert!(layout.words_text_only);
        assert!((layout.words_scale - 0.7).abs() < 1e-9);
        assert_eq!(layout.words_backdrop.as_deref(), Some("#000000b3"));
        assert_eq!(layout.media_box.x_percent, 25.0);
        assert!(layout.media_fill);
        assert_eq!(layout.props_box, LayerBox::FULL);
        assert_eq!(
            layout.slide_box,
            LayerBox::FULL,
            "a presentation is not squeezed into the words' band"
        );

        let position = scene.text_position.expect("the words' box");
        assert_eq!((position.y_percent, position.height_percent), (84.0, 24.0));
        assert_eq!(
            (
                position.text_align.as_str(),
                position.vertical_align.as_str()
            ),
            ("left", "bottom")
        );
    }

    /// The owner's report: the timer flashed on the preview as the app
    /// opened, with the timer layer off — the operator window's first scenes
    /// came from the shipped look, which has it on.
    #[test]
    fn the_screen_never_shows_a_timer_its_look_has_off() {
        let mut column = LookPreset::default_preset().targets.program;
        column.layers.timer = false;
        let scene = OutputScene {
            timer_visible: true,
            timer_text: Some("00:05:00".to_owned()),
            ..OutputScene::default()
        };
        assert!(!scene_for_program(&scene, &column).timer_visible);
        column.layers.timer = true;
        assert!(scene_for_program(&scene, &column).timer_visible);
    }

    #[test]
    fn the_timer_and_banner_are_moved_and_sized_for_their_screen() {
        let mut column = default_ndi();
        column.layers.timer = true;
        column.layout = crate::services::looks::normalize_layout(Some(&serde_json::json!({
            "timer": { "xPercent": 88, "yPercent": 10, "scalePercent": 50 },
            "messages": { "edge": "top", "scalePercent": 150 },
        })));
        let program = OutputScene {
            timer_layout: Some(timer_layout()),
            ..program_scene()
        };
        let scene = scene_for_look(&program, &column);

        let timer = scene.timer_layout.expect("timer");
        assert_eq!((timer.x_percent, timer.y_percent), (88.0, 10.0));
        assert_eq!((timer.clock_font_px, timer.name_font_px), (50.0, 20.0));
        let banner = scene.message_overlay.expect("banner");
        assert_eq!(banner.position, "top");
        assert!((banner.font_scale - 1.5).abs() < 1e-9);

        // The operator's own screen keeps them where they were sent.
        assert_eq!(program.timer_layout.expect("timer").x_percent, 50.0);
    }

    #[test]
    fn the_screens_column_takes_its_props_and_layout_but_not_its_message_gate() {
        let mut column = LookPreset::default_preset().targets.program;
        column.layers.props = false;
        assert!(
            !column.layers.messages,
            "the program's messages flag is off by default"
        );
        column.layout = crate::services::looks::normalize_layout(Some(&serde_json::json!({
            "props": { "xPercent": 80, "yPercent": 20, "widthPercent": 30, "heightPercent": 30 },
        })));
        let program = OutputScene {
            props_overlay: vec![prop()],
            ..program_scene()
        };
        let scene = scene_for_program(&program, &column);
        assert!(scene.props_overlay.is_empty(), "props off on the Screen");
        assert!(
            scene.message_overlay.is_some(),
            "the banner is not gated here"
        );
        assert_eq!(
            scene.screen_layout.expect("layout").props_box.width_percent,
            30.0
        );
    }

    #[test]
    fn with_the_default_look_the_stream_gains_the_banner_and_loses_the_timer() {
        // The visible difference the owner accepted when choosing the NDI column.
        let program = program_scene();
        assert!(program.timer_visible, "the projector shows the timer");

        let ndi = scene_for_look(&program, &default_ndi());
        assert!(!ndi.timer_visible, "the default NDI column hides the timer");
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
        ndi.layers.timer = true;
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
            timer: false,
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

        // The words are the Text layer's, a presentation's slide the Slide
        // layer's, and neither switch shows the other.
        let words = LookLayers { slide: true, ..off };
        let decks = LookLayers {
            presentation: true,
            ..off
        };
        assert!(scene_for_look(&scene, &target(words)).show_text);
        assert!(!scene_for_look(&scene, &target(decks)).show_text);
        let deck = OutputScene {
            presentation_slide: true,
            ..scene.clone()
        };
        assert!(scene_for_look(&deck, &target(decks)).show_text);
        assert!(!scene_for_look(&deck, &target(words)).show_text);
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
        assert!(scene_for_look(&scene, &target(LookLayers { timer: true, ..off })).timer_visible);
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
        assert_eq!(
            ndi.props_overlay, scene.props_overlay,
            "the NDI column shows props"
        );
    }

    fn prop() -> PropsOverlayItem {
        PropsOverlayItem {
            id: "logo".to_owned(),
            kind: "image".to_owned(),
            media_id: None,
            image_url: Some("local-media://media/logo.png".to_owned()),
            media_url: None,
            youtube_url: None,
            ndi_source_name: None,
            capture_device_id: None,
            capture_device_label: None,
            shown_at_ms: None,
            text: None,
            position: "top-right".to_owned(),
            opacity: 1.0,
            size_percent: 20.0,
            color: None,
            font_size: None,
        }
    }

    #[test]
    fn props_show_where_the_column_has_them() {
        let scene = OutputScene {
            props_overlay: vec![prop()],
            ..program_scene()
        };
        let mut column = default_ndi();
        assert_eq!(scene_for_look(&scene, &column).props_overlay.len(), 1);
        column.layers.props = false;
        assert!(scene_for_look(&scene, &column).props_overlay.is_empty());
        assert!(
            scene_for_look(&scene, &column).timer_visible
                == (column.layers.timer && scene.timer_visible),
            "and the timer is its own layer's"
        );
    }
}
