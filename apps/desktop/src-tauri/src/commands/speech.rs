//! Speech-to-search commands.

use std::collections::HashMap;
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::Mutex;

use serde::Serialize;
use tauri::ipc::Channel;
use tauri::{AppHandle, Manager, State};

use crate::errors::{AppError, AppResult};
use crate::services::speech::{self, StreamingToken};
use crate::services::speech_stream::{self, OpenError, SpeechStream, StreamEvent};

/// Mint an AssemblyAI streaming token for a session of at most
/// `max_session_seconds`, which the usage session the renderer started with
/// Convex allows (`useSpeechRecognition.ts`).
#[tauri::command]
pub async fn mint_speech_token(max_session_seconds: u32) -> AppResult<StreamingToken> {
    speech::mint_token(max_session_seconds).await
}

/// The agents' speech streams, by session: the Bible and song agents may each
/// have one.
#[derive(Default)]
pub struct SpeechStreams(Mutex<HashMap<u32, SpeechStream>>);

impl SpeechStreams {
    fn take(&self, session: u32) -> Option<SpeechStream> {
        self.0
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .remove(&session)
    }
}

static NEXT_STREAM: AtomicU32 = AtomicU32::new(1);

/// What the page is told: the service's messages, then the close.
#[derive(Clone, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum SpeechStreamEvent {
    Message {
        data: String,
    },
    Closed {
        code: u16,
        reason: String,
        clean: bool,
    },
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SpeechStreamStarted {
    pub session: u32,
    /// The microphone, as the system names it.
    pub label: String,
}

/// Stream the microphone `device_id` (or the default) to the speech service
/// at `url` — AssemblyAI's, with its token — from here, and tell `on_event`
/// everything it says back (`services/speech_stream.rs`).
#[tauri::command]
pub async fn start_speech_stream(
    app: AppHandle,
    streams: State<'_, SpeechStreams>,
    url: String,
    device_id: Option<String>,
    on_event: Channel<SpeechStreamEvent>,
) -> AppResult<SpeechStreamStarted> {
    let device_id = device_id.filter(|id| !id.trim().is_empty());
    tauri::async_runtime::spawn_blocking(super::sound::microphone_allowed)
        .await
        .map_err(|error| AppError::Invalid(error.to_string()))??;
    let session = NEXT_STREAM.fetch_add(1, Ordering::Relaxed);
    let stream = speech_stream::open(&url, device_id, move |event| {
        let event = match event {
            StreamEvent::Message(data) => SpeechStreamEvent::Message { data },
            StreamEvent::Closed {
                code,
                reason,
                clean,
            } => {
                // Over by itself: nothing left to close.
                drop(app.state::<SpeechStreams>().take(session));
                SpeechStreamEvent::Closed {
                    code,
                    reason,
                    clean,
                }
            }
        };
        let _ = on_event.send(event);
    })
    .await
    .map_err(|error| match error {
        OpenError::NotTheService => AppError::Invalid("not the speech service".to_owned()),
        OpenError::Microphone(error) => super::sound::microphone_failed(error),
        OpenError::Unreachable(why) => {
            tracing::warn!(%why, "the speech service could not be reached");
            AppError::User(
                "Voice search couldn't connect. Check the internet connection and try again."
                    .to_owned(),
            )
        }
    })?;
    let label = stream.label.clone();
    streams
        .0
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
        .insert(session, stream);
    Ok(SpeechStreamStarted { session, label })
}

/// Send the service a control message (`{"type":"Terminate"}`).
#[tauri::command]
pub async fn send_speech_stream(
    streams: State<'_, SpeechStreams>,
    session: u32,
    text: String,
) -> AppResult<()> {
    if let Some(stream) = streams
        .0
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
        .get(&session)
    {
        stream.send(text);
    }
    Ok(())
}

/// Stop the microphone and close the stream; its last messages, then its
/// close, still reach the page.
#[tauri::command]
pub async fn close_speech_stream(streams: State<'_, SpeechStreams>, session: u32) -> AppResult<()> {
    if let Some(stream) = streams.take(session) {
        stream.close();
    }
    Ok(())
}
