//! MIDI in: pedals, pads and desks.
//!
//! `midir` opens the ports; what a message means is `action_for`, which is
//! plain data and therefore testable without a pedal plugged in.
//!
//! Every port is opened at once unless one is named, because a volunteer who
//! plugs a pedal in expects it to work, not to be chosen from a list first.

use std::sync::{Arc, Mutex};

use midir::{Ignore, MidiInput, MidiInputConnection};
use tauri::AppHandle;

use super::{dispatch, Action, MidiBinding, MidiConfig, MidiMessage};

/// A control change at or above this counts as pressed. Switches and pedals
/// send 127 down and 0 up; knobs pass through it halfway.
const PRESSED: u8 = 64;

/// What the app should do about a MIDI message, if anything.
pub fn action_for(message: &[u8], bindings: &[MidiBinding]) -> Option<Action> {
    let (status, data) = message.split_first()?;
    // The high nibble is the kind of message, the low one the channel.
    let kind = status & 0xF0;
    let channel = (status & 0x0F) + 1;

    let matched = |binding: &MidiBinding| binding.channel.is_none_or(|wanted| wanted == channel);
    let fired = match kind {
        // Note on with no velocity is how many devices say note off.
        0x90 => match (data.first(), data.get(1)) {
            (Some(&note), Some(&velocity)) if velocity > 0 => Some(MidiMessage::Note { note }),
            _ => None,
        },
        0xB0 => match (data.first(), data.get(1)) {
            (Some(&controller), Some(&value)) if value >= PRESSED => {
                Some(MidiMessage::Controller { controller })
            }
            _ => None,
        },
        0xC0 => data
            .first()
            .map(|&program| MidiMessage::Program { program }),
        _ => None,
    }?;

    bindings
        .iter()
        .find(|binding| binding.message == fired && matched(binding))
        .map(|binding| binding.action.clone())
}

/// The MIDI ports this machine can listen to, by name.
pub fn ports() -> Vec<String> {
    let Ok(input) = MidiInput::new("Present") else {
        return Vec::new();
    };
    input
        .ports()
        .iter()
        .filter_map(|port| input.port_name(port).ok())
        .collect()
}

/// Wait for the next message worth binding to, on any port.
///
/// How a binding is made: the operator presses the pedal rather than being
/// asked which note it sends. `None` when nothing arrives in time.
pub fn learn(timeout: std::time::Duration) -> Option<(Option<u8>, MidiMessage)> {
    let (sender, receiver) = std::sync::mpsc::channel();
    let Ok(input) = MidiInput::new("Present") else {
        return None;
    };
    // Held so the ports stay open until the answer arrives.
    let mut connections = Vec::new();
    for port in input.ports() {
        let Ok(mut connecting) = MidiInput::new("Present") else {
            continue;
        };
        connecting.ignore(Ignore::All);
        let sender = sender.clone();
        if let Ok(connection) = connecting.connect(
            &port,
            "present-learn",
            move |_time, message, ()| {
                if let Some(learned) = bindable(message) {
                    // The first one wins; the rest have nowhere to go.
                    let _ = sender.send(learned);
                }
            },
            (),
        ) {
            connections.push(connection);
        }
    }
    if connections.is_empty() {
        return None;
    }
    receiver.recv_timeout(timeout).ok()
}

/// The channel and message a binding would be made of, for messages that can
/// carry one.
fn bindable(message: &[u8]) -> Option<(Option<u8>, MidiMessage)> {
    let (status, data) = message.split_first()?;
    let channel = Some((status & 0x0F) + 1);
    let message = match status & 0xF0 {
        0x90 => match (data.first(), data.get(1)) {
            (Some(&note), Some(&velocity)) if velocity > 0 => MidiMessage::Note { note },
            _ => return None,
        },
        0xB0 => match (data.first(), data.get(1)) {
            (Some(&controller), Some(&value)) if value >= PRESSED => {
                MidiMessage::Controller { controller }
            }
            _ => return None,
        },
        0xC0 => MidiMessage::Program {
            program: *data.first()?,
        },
        _ => return None,
    };
    Some((channel, message))
}

/// Open ports, and hold them open. Dropping this closes them.
#[derive(Default)]
pub struct MidiListener {
    connections: Vec<MidiInputConnection<()>>,
}

impl MidiListener {
    /// Listen as `config` says. Nothing is opened when it is off, and the
    /// ports it names are gone rather than half-open on a failure.
    pub fn start(app: &AppHandle, config: &MidiConfig) -> Self {
        if !config.enabled || config.bindings.is_empty() {
            return Self::default();
        }
        // Shared with each port's callback, which runs on a thread of the
        // platform's making.
        let bindings = Arc::new(Mutex::new(config.bindings.clone()));

        let mut connections = Vec::new();
        let Ok(input) = MidiInput::new("Present") else {
            tracing::warn!("MIDI is not available on this machine");
            return Self::default();
        };
        for port in input.ports() {
            let Ok(name) = input.port_name(&port) else {
                continue;
            };
            if config.port.as_ref().is_some_and(|wanted| *wanted != name) {
                continue;
            }
            // A fresh `MidiInput` per port: opening one consumes it.
            let Ok(mut connecting) = MidiInput::new("Present") else {
                continue;
            };
            // Clock and active sensing arrive constantly and mean nothing here.
            connecting.ignore(Ignore::All);
            let (app, bindings, for_log) = (app.clone(), Arc::clone(&bindings), name.clone());
            let opened = connecting.connect(
                &port,
                "present-control",
                move |_time, message, ()| {
                    let action = {
                        let bindings = bindings.lock().unwrap_or_else(|error| error.into_inner());
                        action_for(message, &bindings)
                    };
                    if let Some(action) = action {
                        dispatch(&app, &action, "midi");
                    }
                },
                (),
            );
            match opened {
                Ok(connection) => {
                    tracing::info!(port = %name, "listening for MIDI");
                    connections.push(connection);
                }
                Err(error) => tracing::warn!(%error, port = %for_log, "could not open a MIDI port"),
            }
        }
        if connections.is_empty() {
            tracing::info!("MIDI is on, but no port matched");
        }
        Self { connections }
    }

    /// Whether any port is open.
    pub fn is_listening(&self) -> bool {
        !self.connections.is_empty()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::services::control::Switch;

    fn bindings() -> Vec<MidiBinding> {
        vec![
            MidiBinding {
                channel: None,
                message: MidiMessage::Note { note: 60 },
                action: Action::NextSlide,
            },
            MidiBinding {
                channel: Some(2),
                message: MidiMessage::Note { note: 60 },
                action: Action::PreviousSlide,
            },
            MidiBinding {
                channel: None,
                message: MidiMessage::Controller { controller: 64 },
                action: Action::Text { to: Switch::Toggle },
            },
            MidiBinding {
                channel: None,
                message: MidiMessage::Program { program: 3 },
                action: Action::ClearMedia,
            },
        ]
    }

    #[test]
    fn a_note_on_any_channel_fires_a_binding_that_names_none() {
        // Note on, channel 1, note 60, velocity 100.
        assert_eq!(
            action_for(&[0x90, 60, 100], &bindings()),
            Some(Action::NextSlide)
        );
        // The same note on channel 5, where only the any-channel binding fits.
        assert_eq!(
            action_for(&[0x94, 60, 100], &bindings()),
            Some(Action::NextSlide)
        );
    }

    #[test]
    fn a_channel_of_its_own_wins_nothing_it_does_not_match() {
        let only_channel_two = vec![MidiBinding {
            channel: Some(2),
            message: MidiMessage::Note { note: 60 },
            action: Action::PreviousSlide,
        }];
        assert_eq!(
            action_for(&[0x91, 60, 100], &only_channel_two),
            Some(Action::PreviousSlide),
            "0x91 is channel 2"
        );
        assert_eq!(action_for(&[0x90, 60, 100], &only_channel_two), None);
    }

    #[test]
    fn letting_a_key_go_does_nothing() {
        // Note off, and the note on with no velocity that means the same.
        assert_eq!(action_for(&[0x80, 60, 0], &bindings()), None);
        assert_eq!(action_for(&[0x90, 60, 0], &bindings()), None);
    }

    #[test]
    fn a_pedal_fires_on_the_way_down_only() {
        assert_eq!(
            action_for(&[0xB0, 64, 127], &bindings()),
            Some(Action::Text { to: Switch::Toggle })
        );
        assert_eq!(
            action_for(&[0xB0, 64, 64], &bindings()),
            Some(Action::Text { to: Switch::Toggle }),
            "halfway counts as pressed"
        );
        assert_eq!(action_for(&[0xB0, 64, 0], &bindings()), None, "let go");
        assert_eq!(
            action_for(&[0xB0, 7, 127], &bindings()),
            None,
            "another knob"
        );
    }

    #[test]
    fn a_desk_recalling_a_preset_fires() {
        assert_eq!(
            action_for(&[0xC0, 3], &bindings()),
            Some(Action::ClearMedia)
        );
        assert_eq!(action_for(&[0xC0, 4], &bindings()), None);
    }

    #[test]
    fn learning_reads_the_message_a_binding_is_made_of() {
        assert_eq!(
            bindable(&[0x92, 60, 100]),
            Some((Some(3), MidiMessage::Note { note: 60 })),
            "0x92 is channel 3"
        );
        assert_eq!(
            bindable(&[0xB0, 64, 127]),
            Some((Some(1), MidiMessage::Controller { controller: 64 }))
        );
        assert_eq!(
            bindable(&[0xC5, 2]),
            Some((Some(6), MidiMessage::Program { program: 2 }))
        );
        // Nothing a binding could be made of.
        assert_eq!(bindable(&[0x90, 60, 0]), None, "a key let go");
        assert_eq!(bindable(&[0xB0, 64, 0]), None, "a pedal let go");
        assert_eq!(bindable(&[0xF8]), None, "clock");
    }

    #[test]
    fn nothing_else_on_the_wire_fires_anything() {
        for message in [
            &[0xF8][..],        // clock
            &[0xFE][..],        // active sensing
            &[0xE0, 0, 64][..], // pitch bend
            &[][..],
        ] {
            assert_eq!(action_for(message, &bindings()), None, "{message:?}");
        }
    }
}
