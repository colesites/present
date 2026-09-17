//! The phone in the operator's pocket, and in the worship leader's hand.
//!
//! A small web page the app serves on the church's own network, reached by
//! scanning a code on screen. It does what the pedals do — the same
//! `control::Action`s — and shows what is on the audience screen, so whoever
//! is holding it can see what everyone else is seeing.
//!
//! **Nothing about it is open to the network by accident.** It is off until
//! the operator turns it on, and every request carries a token that only the
//! code on screen contains. Somebody else on the same Wi-Fi who guesses the
//! address gets 404s.
//!
//! The page is plain HTML and JavaScript, served from the binary: a phone on a
//! church network cannot be assumed to reach the internet, and a remote that
//! needs a download is a remote nobody uses.

pub mod page;
pub mod server;

use serde::{Deserialize, Serialize};

/// The port the remote listens on unless the operator moves it. Nothing well
/// known sits here, and it is easy to say out loud.
pub const DEFAULT_PORT: u16 = 7373;

#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", default)]
pub struct RemoteConfig {
    /// Off until somebody turns it on.
    pub enabled: bool,
    pub port: u16,
}

impl Default for RemoteConfig {
    fn default() -> Self {
        Self {
            enabled: false,
            port: DEFAULT_PORT,
        }
    }
}

/// What the settings screen shows: whether it is running, and how to join.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RemoteStatus {
    pub config: RemoteConfig,
    /// The address to scan or type, with the token in it. `None` when the
    /// remote is not running.
    pub url: Option<String>,
    /// That address as a QR code, an SVG the settings screen can show.
    pub qr_svg: Option<String>,
    /// Why it is not running, when it should be.
    pub error: Option<String>,
}

/// The address a phone on the same network should open.
///
/// The machine's own address, not localhost: the phone is not this computer.
pub fn join_url(address: std::net::IpAddr, port: u16, token: &str) -> String {
    format!("http://{address}:{port}/?t={token}")
}

/// This machine's address on the network the phone is likely to be on.
///
/// The first private IPv4 address that is not loopback. A machine with several
/// (a wired desk and Wi-Fi) offers the first, which is what the operator can
/// correct by typing the other one in — they are both on the code.
pub fn local_address() -> Option<std::net::IpAddr> {
    use std::net::IpAddr;

    let interfaces = local_ip_candidates();
    interfaces
        .iter()
        .find(|address| match address {
            IpAddr::V4(v4) => v4.is_private(),
            IpAddr::V6(_) => false,
        })
        .or_else(|| interfaces.first())
        .copied()
}

/// Every address this machine answers to, loopback aside.
///
/// Asked of the operating system through a connected UDP socket, which needs
/// no traffic and no permission: the address it would send from is the address
/// this machine is reachable at.
fn local_ip_candidates() -> Vec<std::net::IpAddr> {
    use std::net::{IpAddr, SocketAddr, UdpSocket};

    let mut found = Vec::new();
    // A routable address that is never contacted; the socket is only asked
    // which interface it would use.
    for probe in ["8.8.8.8:80", "1.1.1.1:80"] {
        let Ok(socket) = UdpSocket::bind(("0.0.0.0", 0)) else {
            continue;
        };
        let Ok(target) = probe.parse::<SocketAddr>() else {
            continue;
        };
        if socket.connect(target).is_ok() {
            if let Ok(address) = socket.local_addr() {
                let address: IpAddr = address.ip();
                if !address.is_loopback() && !found.contains(&address) {
                    found.push(address);
                }
            }
        }
    }
    found
}

/// A token for one run of the remote.
///
/// 128 bits from the operating system's own randomness: on a church network,
/// the address is easy to find and the token is what stops somebody else's
/// phone driving the service.
pub fn new_token() -> String {
    let mut bytes = [0u8; 16];
    if getrandom::getrandom(&mut bytes).is_err() {
        // Without randomness there is no token worth having, and a remote
        // without one should not run.
        return String::new();
    }
    bytes.iter().map(|byte| format!("{byte:02x}")).collect()
}

/// The join address as an SVG QR code.
pub fn qr_svg(url: &str) -> Option<String> {
    use qrcode::render::svg;
    use qrcode::QrCode;

    let code = QrCode::new(url.as_bytes()).ok()?;
    Some(
        code.render()
            .min_dimensions(200, 200)
            // The settings screen is dark or light; the page colours it.
            .dark_color(svg::Color("#000000"))
            .light_color(svg::Color("#ffffff"))
            .build(),
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::net::{IpAddr, Ipv4Addr};

    #[test]
    fn the_join_address_names_this_machine_and_carries_the_token() {
        let url = join_url(IpAddr::V4(Ipv4Addr::new(192, 168, 1, 40)), 7373, "abc123");
        assert_eq!(url, "http://192.168.1.40:7373/?t=abc123");
    }

    #[test]
    fn a_token_is_long_and_never_the_same_twice() {
        let first = new_token();
        let second = new_token();
        assert_eq!(first.len(), 32);
        assert!(first.chars().all(|character| character.is_ascii_hexdigit()));
        assert_ne!(first, second);
    }

    #[test]
    fn the_address_is_a_code_a_phone_can_read() {
        let svg = qr_svg("http://192.168.1.40:7373/?t=abc123").expect("a code");
        assert!(svg.starts_with("<?xml") || svg.starts_with("<svg"));
        assert!(svg.contains("</svg>"));
    }

    #[test]
    fn the_remote_is_off_until_it_is_turned_on() {
        let config = RemoteConfig::default();
        assert!(!config.enabled);
        assert_eq!(config.port, DEFAULT_PORT);
    }
}
