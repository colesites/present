//! Speech-to-search commands.

use crate::errors::AppResult;
use crate::services::speech::{self, StreamingToken};

/// Mint an AssemblyAI streaming token for a session of at most
/// `max_session_seconds`, which the usage session the renderer started with
/// Convex allows (`useSpeechRecognition.ts`).
#[tauri::command]
pub async fn mint_speech_token(max_session_seconds: u32) -> AppResult<StreamingToken> {
    speech::mint_token(max_session_seconds).await
}
