//! The Bible and song agents' speech, streamed to AssemblyAI from here.
//!
//! The page used to do it: the microphone's samples came to it ten times a
//! second (`sound::input`), each over its own IPC fetch, and the page sent
//! them on from its own thread — the thread that also draws the Bible tab on
//! every word heard. Whenever that thread was busy the sound waited behind it,
//! and the transcript fell behind the preacher, more the longer they spoke.
//! Measured against the service with a sermon sent at true real time, its own
//! delay stays at about 0.3 s for minutes on end; the sound's path through the
//! page was the part that could grow.
//!
//! Here the microphone and the connection are one: each 100 ms of sound goes
//! out the moment it is captured, on a task of its own. The page is sent only
//! what the service says back — small JSON messages it reads as before — and
//! can take its time over them without holding anything up.

use std::time::Duration;

use futures_util::{SinkExt, StreamExt};
use tokio::sync::mpsc;
use tokio_tungstenite::tungstenite::Message;

use crate::services::sound::input::Microphone;

/// The only service this connects to: anything else the page names is
/// refused, so the page cannot use this to reach anywhere else.
const SERVICE: &str = "wss://streaming.assemblyai.com/";

/// How long the connection may take to open.
const CONNECT_WITHIN: Duration = Duration::from_secs(10);

/// What the page hears about a stream.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum StreamEvent {
    /// A message from the service, as it sent it.
    Message(String),
    /// The connection is over: the service's close code and reason, and
    /// whether it closed cleanly.
    Closed {
        code: u16,
        reason: String,
        clean: bool,
    },
}

/// Why a stream could not start.
#[derive(Debug)]
pub enum OpenError {
    /// The page named somewhere other than the service.
    NotTheService,
    /// The service could not be reached, or refused the connection.
    Unreachable(String),
    /// The microphone would not open.
    Microphone(String),
}

/// What the page asks of a stream.
enum Control {
    /// A control message for the service: `{"type":"Terminate"}`.
    Send(String),
    Close,
}

/// A stream of speech to the service. Dropping it closes it.
pub struct SpeechStream {
    control: mpsc::UnboundedSender<Control>,
    /// The device, as the system names it.
    pub label: String,
}

impl SpeechStream {
    /// Send the service a control message.
    pub fn send(&self, text: String) {
        let _ = self.control.send(Control::Send(text));
    }

    /// Stop the sound and close the connection. What the service says as it
    /// finishes still reaches the page, then the close.
    pub fn close(&self) {
        let _ = self.control.send(Control::Close);
    }
}

impl Drop for SpeechStream {
    fn drop(&mut self) {
        self.close();
    }
}

/// Whether `url` is the service's.
pub fn is_service(url: &str) -> bool {
    url.starts_with(SERVICE)
}

/// `url` with the sound's format added: the microphone's, which only this
/// side knows.
pub fn with_format(url: &str) -> String {
    let joiner = if url.contains('?') { '&' } else { '?' };
    format!(
        "{url}{joiner}sample_rate={}&encoding=pcm_s16le",
        crate::services::sound::input::RATE
    )
}

/// Connect to the service at `url` and open the microphone `device_id` (or
/// the default), both at once, then stream its sound until closed. `events`
/// is told everything the service says, and when it is over.
pub async fn open(
    url: &str,
    device_id: Option<String>,
    events: impl Fn(StreamEvent) + Send + Sync + 'static,
) -> Result<SpeechStream, OpenError> {
    if !is_service(url) {
        return Err(OpenError::NotTheService);
    }
    let url = with_format(url);

    // The microphone delivers on its own thread; the task sends. What it
    // hears while the connection opens waits here and goes first.
    let (sound, captured) = mpsc::unbounded_channel::<Vec<u8>>();
    let connecting = tokio::time::timeout(CONNECT_WITHIN, tokio_tungstenite::connect_async(url));
    let opening = tauri::async_runtime::spawn_blocking(move || {
        Microphone::open(device_id.as_deref(), move |chunk| {
            let _ = sound.send(chunk);
        })
    });
    let (connected, microphone) = tokio::join!(connecting, opening);
    let microphone = microphone
        .map_err(|error| OpenError::Microphone(error.to_string()))?
        .map_err(OpenError::Microphone)?;
    let (socket, _) = connected
        .map_err(|_| OpenError::Unreachable("no answer in time".to_owned()))?
        .map_err(|error| OpenError::Unreachable(refused(&error)))?;
    let label = microphone.label.clone();

    let (control, asked) = mpsc::unbounded_channel();
    tauri::async_runtime::spawn(run(socket, microphone, captured, asked, events));
    Ok(SpeechStream { control, label })
}

type Socket =
    tokio_tungstenite::WebSocketStream<tokio_tungstenite::MaybeTlsStream<tokio::net::TcpStream>>;

/// The stream, until it ends: sound out as it comes, the service's messages
/// in.
async fn run(
    socket: Socket,
    microphone: Microphone,
    mut captured: mpsc::UnboundedReceiver<Vec<u8>>,
    mut asked: mpsc::UnboundedReceiver<Control>,
    told: impl Fn(StreamEvent),
) {
    let lost = || StreamEvent::Closed {
        code: 1006,
        reason: String::new(),
        clean: false,
    };
    let (mut outgoing, mut incoming) = socket.split();
    // Held until the stream ends, and stopped with it.
    let mut microphone = Some(microphone);
    let closed = loop {
        tokio::select! {
            chunk = captured.recv(), if microphone.is_some() => match chunk {
                Some(chunk) => {
                    if outgoing.send(Message::Binary(chunk.into())).await.is_err() {
                        break lost();
                    }
                }
                None => microphone = None,
            },
            request = asked.recv() => match request {
                Some(Control::Send(text)) => {
                    if outgoing.send(Message::Text(text.into())).await.is_err() {
                        break lost();
                    }
                }
                Some(Control::Close) | None => {
                    // No more sound. The service is told; what it says as it
                    // finishes is still passed on, for a moment, until it
                    // closes.
                    microphone = None;
                    let _ = outgoing.send(Message::Close(None)).await;
                    let finishing = tokio::time::timeout(Duration::from_secs(2), async {
                        while let Some(message) = incoming.next().await {
                            match message {
                                Ok(Message::Text(text)) => told(StreamEvent::Message(text.to_string())),
                                Ok(Message::Close(frame)) => return Some(close_event(frame)),
                                Ok(_) => {}
                                Err(_) => break,
                            }
                        }
                        None
                    })
                    .await;
                    break finishing.ok().flatten().unwrap_or(StreamEvent::Closed {
                        code: 1000,
                        reason: String::new(),
                        clean: true,
                    });
                }
            },
            message = incoming.next() => match message {
                Some(Ok(Message::Text(text))) => told(StreamEvent::Message(text.to_string())),
                Some(Ok(Message::Close(frame))) => break close_event(frame),
                Some(Ok(_)) => {}
                Some(Err(error)) => {
                    tracing::warn!(%error, "the speech stream failed");
                    break lost();
                }
                None => break lost(),
            },
        }
    };
    drop(microphone);
    told(closed);
}

fn close_event(frame: Option<tokio_tungstenite::tungstenite::protocol::CloseFrame>) -> StreamEvent {
    let (code, reason) = frame.map_or((1005, String::new()), |frame| {
        (u16::from(frame.code), frame.reason.to_string())
    });
    StreamEvent::Closed {
        code,
        reason,
        clean: true,
    }
}

/// What the service said when it refused the connection: its status, and its
/// body when it gave one (the token's expiry, the plan's limit).
fn refused(error: &tokio_tungstenite::tungstenite::Error) -> String {
    match error {
        tokio_tungstenite::tungstenite::Error::Http(response) => {
            let body = response
                .body()
                .as_deref()
                .map(String::from_utf8_lossy)
                .unwrap_or_default();
            format!("{} {body}", response.status())
        }
        other => other.to_string(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_the_speech_service_is_connected_to() {
        assert!(is_service("wss://streaming.assemblyai.com/v3/ws?token=x"));
        for elsewhere in [
            "wss://example.com/v3/ws",
            "ws://streaming.assemblyai.com/v3/ws",
            "wss://streaming.assemblyai.com.example.com/",
            "https://streaming.assemblyai.com/v3/ws",
        ] {
            assert!(!is_service(elsewhere), "{elsewhere}");
        }
    }

    #[test]
    fn the_sound_is_described_as_the_microphone_sends_it() {
        assert_eq!(
            with_format("wss://streaming.assemblyai.com/v3/ws?token=x"),
            "wss://streaming.assemblyai.com/v3/ws?token=x&sample_rate=16000&encoding=pcm_s16le"
        );
        assert_eq!(
            with_format("wss://streaming.assemblyai.com/v3/ws"),
            "wss://streaming.assemblyai.com/v3/ws?sample_rate=16000&encoding=pcm_s16le"
        );
    }
}
