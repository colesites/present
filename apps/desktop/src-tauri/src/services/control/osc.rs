//! OSC in: lighting desks, QLab, TouchOSC, anything on the network.
//!
//! A socket and a thread. What a message means is `action_for`, which is plain
//! data: a packet in, an action out, testable without a desk.
//!
//! Buttons on most surfaces send a value with the press — 1 going down, 0
//! coming up — so a message carrying zero is a release and does nothing. The
//! two addresses that take an argument, a slide number and a scripture
//! reference, read it from the message rather than the binding.

use std::net::UdpSocket;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Duration;

use rosc::{OscBundle, OscMessage, OscPacket, OscType};
use tauri::AppHandle;

use super::{dispatch, Action, OscBinding, OscConfig};

/// How long the socket waits before looking at whether it should stop.
const TICK: Duration = Duration::from_millis(250);

/// The biggest packet worth reading; OSC messages are small.
const MAX_PACKET: usize = 8 * 1024;

/// What the app should do about an OSC message, if anything.
pub fn action_for(message: &OscMessage, bindings: &[OscBinding]) -> Option<Action> {
    let binding = bindings
        .iter()
        .find(|binding| binding.address == message.addr)?;
    if released(message) {
        return None;
    }
    Some(match &binding.action {
        // The argument carries what to do, so a binding's own value is a
        // placeholder.
        Action::GoToSlide { index } => Action::GoToSlide {
            index: first_number(message).unwrap_or(*index),
        },
        Action::GoToScripture { reference } => {
            let reference = first_string(message).unwrap_or_else(|| reference.clone());
            if reference.trim().is_empty() {
                return None;
            }
            Action::GoToScripture { reference }
        }
        other => other.clone(),
    })
}

/// Whether this message is a button coming back up.
fn released(message: &OscMessage) -> bool {
    match message.args.first() {
        Some(OscType::Int(0)) | Some(OscType::Long(0)) => true,
        Some(OscType::Float(value)) => *value == 0.0,
        Some(OscType::Double(value)) => *value == 0.0,
        Some(OscType::Bool(value)) => !*value,
        _ => false,
    }
}

fn first_number(message: &OscMessage) -> Option<i64> {
    message.args.iter().find_map(|argument| match argument {
        OscType::Int(value) => Some(i64::from(*value)),
        OscType::Long(value) => Some(*value),
        OscType::Float(value) => Some(*value as i64),
        OscType::Double(value) => Some(*value as i64),
        _ => None,
    })
}

fn first_string(message: &OscMessage) -> Option<String> {
    message.args.iter().find_map(|argument| match argument {
        OscType::String(value) => Some(value.clone()),
        _ => None,
    })
}

/// Every message in a packet, bundles unwrapped.
fn messages(packet: OscPacket, into: &mut Vec<OscMessage>) {
    match packet {
        OscPacket::Message(message) => into.push(message),
        OscPacket::Bundle(OscBundle { content, .. }) => {
            for packet in content {
                messages(packet, into);
            }
        }
    }
}

/// A socket listening for OSC. Dropping it closes the socket and stops the
/// thread within a tick.
pub struct OscListener {
    stop: Arc<AtomicBool>,
    port: Option<u16>,
}

impl Default for OscListener {
    fn default() -> Self {
        Self {
            stop: Arc::new(AtomicBool::new(true)),
            port: None,
        }
    }
}

impl OscListener {
    /// Listen as `config` says. Nothing is opened when it is off, and a port
    /// already in use is reported rather than retried.
    pub fn start(app: &AppHandle, config: &OscConfig) -> Self {
        if !config.enabled {
            return Self::default();
        }
        // Every address on the machine: a desk on the same network sends to
        // this computer's address, not to localhost.
        let socket = match UdpSocket::bind(("0.0.0.0", config.port)) {
            Ok(socket) => socket,
            Err(error) => {
                tracing::warn!(%error, port = config.port, "could not listen for OSC");
                return Self::default();
            }
        };
        if let Err(error) = socket.set_read_timeout(Some(TICK)) {
            tracing::warn!(%error, "could not set the OSC socket's timeout");
            return Self::default();
        }

        let stop = Arc::new(AtomicBool::new(false));
        let (app, bindings, stopping) = (app.clone(), config.bindings.clone(), Arc::clone(&stop));
        let started = std::thread::Builder::new()
            .name("osc-control".to_owned())
            .spawn(move || listen(&app, &socket, &bindings, &stopping));
        match started {
            Ok(_) => {
                tracing::info!(port = config.port, "listening for OSC");
                Self {
                    stop,
                    port: Some(config.port),
                }
            }
            Err(error) => {
                tracing::warn!(%error, "could not start the OSC thread");
                Self::default()
            }
        }
    }

    /// The port being listened on, if any.
    pub fn port(&self) -> Option<u16> {
        self.port
    }
}

impl Drop for OscListener {
    fn drop(&mut self) {
        self.stop.store(true, Ordering::SeqCst);
    }
}

fn listen(app: &AppHandle, socket: &UdpSocket, bindings: &[OscBinding], stop: &AtomicBool) {
    let mut buffer = vec![0u8; MAX_PACKET];
    while !stop.load(Ordering::SeqCst) {
        let read = match socket.recv_from(&mut buffer) {
            Ok((read, _from)) => read,
            // The timeout, which is how the thread gets to look at `stop`.
            Err(error)
                if matches!(
                    error.kind(),
                    std::io::ErrorKind::WouldBlock | std::io::ErrorKind::TimedOut
                ) =>
            {
                continue
            }
            Err(error) => {
                tracing::warn!(%error, "the OSC socket stopped");
                return;
            }
        };
        let packet = match rosc::decoder::decode_udp(&buffer[..read]) {
            Ok((_, packet)) => packet,
            Err(error) => {
                tracing::debug!(%error, "an OSC packet could not be read");
                continue;
            }
        };
        let mut found = Vec::new();
        messages(packet, &mut found);
        for message in found {
            if let Some(action) = action_for(&message, bindings) {
                dispatch(app, &action, "osc");
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::services::control::{default_osc_bindings, Switch};

    fn message(address: &str, args: Vec<OscType>) -> OscMessage {
        OscMessage {
            addr: address.to_owned(),
            args,
        }
    }

    #[test]
    fn the_default_addresses_do_what_they_say() {
        let bindings = default_osc_bindings();
        assert_eq!(
            action_for(&message("/present/slide/next", vec![]), &bindings),
            Some(Action::NextSlide)
        );
        assert_eq!(
            action_for(&message("/present/text", vec![]), &bindings),
            Some(Action::Text { to: Switch::Toggle })
        );
        assert_eq!(
            action_for(&message("/present/nothing", vec![]), &bindings),
            None
        );
    }

    #[test]
    fn a_button_coming_back_up_does_nothing() {
        let bindings = default_osc_bindings();
        for released in [
            OscType::Int(0),
            OscType::Float(0.0),
            OscType::Bool(false),
            OscType::Long(0),
        ] {
            assert_eq!(
                action_for(
                    &message("/present/slide/next", vec![released.clone()]),
                    &bindings
                ),
                None,
                "{released:?}"
            );
        }
        assert_eq!(
            action_for(
                &message("/present/slide/next", vec![OscType::Float(1.0)]),
                &bindings
            ),
            Some(Action::NextSlide),
            "and the press itself fires"
        );
    }

    #[test]
    fn the_slide_number_comes_from_the_message() {
        let bindings = default_osc_bindings();
        assert_eq!(
            action_for(
                &message("/present/slide/go", vec![OscType::Int(7)]),
                &bindings
            ),
            Some(Action::GoToSlide { index: 7 })
        );
        assert_eq!(
            action_for(
                &message("/present/slide/go", vec![OscType::Float(3.0)]),
                &bindings
            ),
            Some(Action::GoToSlide { index: 3 }),
            "surfaces that only send floats still work"
        );
    }

    #[test]
    fn a_scripture_reference_comes_from_the_message_and_an_empty_one_does_nothing() {
        let bindings = default_osc_bindings();
        assert_eq!(
            action_for(
                &message(
                    "/present/scripture",
                    vec![OscType::String("John 3:16".to_owned())]
                ),
                &bindings
            ),
            Some(Action::GoToScripture {
                reference: "John 3:16".to_owned()
            })
        );
        assert_eq!(
            action_for(&message("/present/scripture", vec![]), &bindings),
            None,
            "nothing to look up"
        );
    }

    /// The whole way in: a packet on the wire, decoded as the listener decodes
    /// it, read as an action.
    #[test]
    fn a_packet_off_the_wire_becomes_an_action() {
        let listening = UdpSocket::bind(("127.0.0.1", 0)).expect("a socket");
        let address = listening.local_addr().expect("its address");
        let packet = rosc::encoder::encode(&OscPacket::Message(message(
            "/present/slide/go",
            vec![OscType::Int(11)],
        )))
        .expect("it encodes");

        let sending = UdpSocket::bind(("127.0.0.1", 0)).expect("a sending socket");
        sending.send_to(&packet, address).expect("it sends");

        let mut buffer = vec![0u8; MAX_PACKET];
        listening
            .set_read_timeout(Some(Duration::from_secs(2)))
            .expect("a timeout");
        let (read, _) = listening.recv_from(&mut buffer).expect("it arrives");
        let (_, decoded) = rosc::decoder::decode_udp(&buffer[..read]).expect("it decodes");

        let mut found = Vec::new();
        messages(decoded, &mut found);
        let actions: Vec<_> = found
            .iter()
            .filter_map(|message| action_for(message, &default_osc_bindings()))
            .collect();
        assert_eq!(actions, vec![Action::GoToSlide { index: 11 }]);
    }

    #[test]
    fn a_bundle_is_read_as_the_messages_inside_it() {
        let bundle = OscPacket::Bundle(OscBundle {
            timetag: rosc::OscTime {
                seconds: 0,
                fractional: 0,
            },
            content: vec![
                OscPacket::Message(message("/present/slide/next", vec![])),
                OscPacket::Bundle(OscBundle {
                    timetag: rosc::OscTime {
                        seconds: 0,
                        fractional: 0,
                    },
                    content: vec![OscPacket::Message(message("/present/clear", vec![]))],
                }),
            ],
        });
        let mut found = Vec::new();
        messages(bundle, &mut found);
        let bindings = default_osc_bindings();
        let actions: Vec<_> = found
            .iter()
            .filter_map(|message| action_for(message, &bindings))
            .collect();
        assert_eq!(actions, vec![Action::NextSlide, Action::ClearMedia]);
    }
}
