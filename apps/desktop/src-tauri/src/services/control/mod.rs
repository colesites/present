//! Foot pedals, MIDI and OSC: one table of actions, several ways in.
//!
//! A church booth has both worlds in it. MIDI is what the hardware speaks —
//! pedals, control surfaces, the lighting desk's MIDI out — over a cable, with
//! no network to go wrong. OSC is what software and newer consoles speak, over
//! Ethernet or Wi-Fi, with addresses a person can read.
//!
//! Neither gets its own idea of what Present can do. Both map onto the
//! `Action`s here, and so will the phone remote. What the core owns — the
//! slide position — is applied here; everything else is announced to the
//! windows, which already know how to do it, so a pedal and a click take the
//! same path.

pub mod midi;
pub mod osc;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager};

use crate::state::PresentationState;

/// Announced to every window when a control asks for something the React tree
/// owns.
pub const CONTROL_ACTION_EVENT: &str = "control:action";

/// What a pedal, a desk or a phone can ask for.
///
/// Small on purpose: every one of these is something the operator can already
/// do, so nothing here invents behaviour of its own.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize)]
#[serde(tag = "action", rename_all = "camelCase")]
pub enum Action {
    NextSlide,
    PreviousSlide,
    /// 0-based, as the core counts slides.
    GoToSlide {
        index: i64,
    },
    NextItem,
    PreviousItem,
    /// The words.
    Text {
        to: Switch,
    },
    /// A presentation's slides: a PDF's pages, a PowerPoint's.
    Slide {
        to: Switch,
    },
    /// The media under them.
    Media {
        to: Switch,
    },
    /// The background behind both; off is the operator's "hide background".
    Background {
        to: Switch,
    },
    /// Hold the audience screen on what it is showing.
    Freeze {
        to: Switch,
    },
    /// Take the media off the output.
    ClearMedia,
    /// A reference as somebody would say it: "John 3:16".
    GoToScripture {
        reference: String,
    },
}

/// On, off, or the other way from wherever it is.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum Switch {
    On,
    Off,
    Toggle,
}

impl Action {
    /// Whether the core can do this itself. The rest belong to the windows.
    fn is_core_owned(&self) -> bool {
        matches!(
            self,
            Action::NextSlide | Action::PreviousSlide | Action::GoToSlide { .. }
        )
    }
}

/// Do what a control asked for.
///
/// Errors are logged, never returned: a pedal pressed when there are no slides
/// is not a failure anybody can act on mid-service.
pub fn dispatch(app: &AppHandle, action: &Action, from: &str) {
    tracing::debug!(?action, from, "a control asked for something");
    if action.is_core_owned() {
        move_the_slides(app, action);
        return;
    }
    if let Err(error) = app.emit(CONTROL_ACTION_EVENT, action) {
        tracing::warn!(%error, ?action, "could not pass a control's action to the windows");
    }
}

/// The one thing the core owns outright: where the deck is.
fn move_the_slides(app: &AppHandle, action: &Action) {
    // `try_state`, never `state`: a control message can arrive while the app is
    // still starting, and a panic here would end it.
    let Some(presentation) = app.try_state::<PresentationState>() else {
        tracing::warn!("a control arrived before the app was ready");
        return;
    };
    let changed = presentation.update(|position| match action {
        Action::NextSlide => position.next_slide().unwrap_or(false),
        Action::PreviousSlide => position.previous_slide().unwrap_or(false),
        Action::GoToSlide { index } => position.go_to_slide(*index).unwrap_or(false),
        _ => false,
    });
    match changed {
        Ok(Some(position)) => {
            if let Err(error) = app.emit(
                crate::commands::presentation::PRESENTATION_CHANGED_EVENT,
                &position,
            ) {
                tracing::warn!(%error, "could not broadcast a control's slide change");
            }
        }
        Ok(None) => {}
        Err(error) => tracing::warn!(%error, "a control could not move the slides"),
    }
}

/// A message the operator just sent, for the settings screen to bind.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LearnedMidi {
    pub channel: Option<u8>,
    pub message: MidiMessage,
}

/// Everything the control surfaces are set up with.
#[derive(Debug, Clone, Default, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", default)]
pub struct ControlConfig {
    pub midi: MidiConfig,
    pub osc: OscConfig,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", default)]
pub struct MidiConfig {
    /// Off until somebody sets it up: an unexpected note should not move a
    /// service.
    pub enabled: bool,
    /// The port to listen on, by name. `None` is every port there is, which is
    /// what a single pedal plugged in wants.
    pub port: Option<String>,
    pub bindings: Vec<MidiBinding>,
}

/// What a message has to be to count, and what it then does.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MidiBinding {
    /// 1 to 16, or `None` for any channel — which is what most pedals need,
    /// since few say which channel they send on.
    #[serde(default)]
    pub channel: Option<u8>,
    pub message: MidiMessage,
    #[serde(flatten)]
    pub action: Action,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum MidiMessage {
    /// A key or a pad. Note off does nothing: a pedal would fire twice.
    Note { note: u8 },
    /// A knob, a switch or a pedal sending control changes. It fires on the
    /// way down (64 or more), the half of the travel a switch means by "on".
    Controller { controller: u8 },
    /// The message a desk sends to recall a preset.
    Program { program: u8 },
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", default)]
pub struct OscConfig {
    pub enabled: bool,
    /// 9000 is what TouchOSC and QLab send to unless told otherwise.
    pub port: u16,
    pub bindings: Vec<OscBinding>,
}

impl Default for OscConfig {
    fn default() -> Self {
        Self {
            enabled: false,
            port: 9000,
            bindings: default_osc_bindings(),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OscBinding {
    /// The address to answer to, as "/present/slide/next".
    pub address: String,
    #[serde(flatten)]
    pub action: Action,
}

/// The addresses Present answers to out of the box, so a desk can be pointed
/// at it without anybody writing a table first.
pub fn default_osc_bindings() -> Vec<OscBinding> {
    let binding = |address: &str, action: Action| OscBinding {
        address: address.to_owned(),
        action,
    };
    vec![
        binding("/present/slide/next", Action::NextSlide),
        binding("/present/slide/previous", Action::PreviousSlide),
        // The slide number comes as the message's first argument.
        binding("/present/slide/go", Action::GoToSlide { index: 0 }),
        binding("/present/item/next", Action::NextItem),
        binding("/present/item/previous", Action::PreviousItem),
        binding("/present/text", Action::Text { to: Switch::Toggle }),
        binding("/present/media", Action::Media { to: Switch::Toggle }),
        binding(
            "/present/background",
            Action::Background { to: Switch::Toggle },
        ),
        binding("/present/freeze", Action::Freeze { to: Switch::Toggle }),
        binding("/present/clear", Action::ClearMedia),
        // The reference comes as the message's first argument.
        binding(
            "/present/scripture",
            Action::GoToScripture {
                reference: String::new(),
            },
        ),
    ]
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_binding_reads_as_one_object() {
        let json = r#"{"address":"/present/slide/go","action":"goToSlide","index":4}"#;
        let binding: OscBinding = serde_json::from_str(json).expect("it reads");
        assert_eq!(binding.address, "/present/slide/go");
        assert_eq!(binding.action, Action::GoToSlide { index: 4 });
        assert_eq!(
            serde_json::to_string(&binding).expect("it writes"),
            json,
            "and writes back the same"
        );
    }

    #[test]
    fn a_midi_binding_reads_as_one_object() {
        let json = r#"{"channel":1,"message":{"kind":"note","note":60},"action":"nextSlide"}"#;
        let binding: MidiBinding = serde_json::from_str(json).expect("it reads");
        assert_eq!(binding.channel, Some(1));
        assert_eq!(binding.message, MidiMessage::Note { note: 60 });
        assert_eq!(binding.action, Action::NextSlide);
    }

    #[test]
    fn a_switch_is_written_as_a_field_the_window_can_read() {
        assert_eq!(
            serde_json::to_string(&Action::Text { to: Switch::Toggle }).expect("it writes"),
            r#"{"action":"text","to":"toggle"}"#
        );
        assert_eq!(
            serde_json::to_string(&Action::Slide { to: Switch::Off }).expect("it writes"),
            r#"{"action":"slide","to":"off"}"#
        );
        assert_eq!(
            serde_json::to_string(&Action::GoToSlide { index: 3 }).expect("it writes"),
            r#"{"action":"goToSlide","index":3}"#
        );
    }

    #[test]
    fn both_surfaces_are_off_until_they_are_set_up() {
        let config = ControlConfig::default();
        assert!(!config.midi.enabled);
        assert!(!config.osc.enabled);
        assert_eq!(config.osc.port, 9000);
        assert!(
            config.midi.bindings.is_empty(),
            "MIDI has no default notes: they mean different things on every device"
        );
        assert!(
            config
                .osc
                .bindings
                .iter()
                .any(|binding| binding.address == "/present/slide/next"),
            "OSC addresses are ours to name, so they have defaults"
        );
    }

    #[test]
    fn the_core_moves_the_slides_and_passes_the_rest_on() {
        assert!(Action::NextSlide.is_core_owned());
        assert!(Action::GoToSlide { index: 2 }.is_core_owned());
        assert!(!Action::ClearMedia.is_core_owned());
        assert!(!Action::Text { to: Switch::Toggle }.is_core_owned());
    }
}
