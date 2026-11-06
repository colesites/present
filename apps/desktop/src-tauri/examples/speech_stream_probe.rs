//! The agents' speech stream as the app opens it (`services/speech_stream.rs`):
//! the default microphone to AssemblyAI, for a few seconds, printing what the
//! service says and when.
//!
//! ```text
//! ASSEMBLYAI_API_KEY=… cargo run --release --example speech_stream_probe -- [seconds]
//! ```

use std::time::{Duration, Instant};

use present_lib::services::speech_stream::{self, StreamEvent};

fn main() {
    let seconds: u64 = std::env::args()
        .nth(1)
        .and_then(|n| n.parse().ok())
        .unwrap_or(8);
    let key = std::env::var("ASSEMBLYAI_API_KEY").expect("ASSEMBLYAI_API_KEY");
    tauri::async_runtime::block_on(async move {
        let token: serde_json::Value = reqwest::Client::new()
            .get("https://streaming.assemblyai.com/v3/token?expires_in_seconds=60&max_session_duration_seconds=60")
            .header("Authorization", key)
            .send()
            .await
            .expect("the token request")
            .json()
            .await
            .expect("a token");
        let token = token["token"].as_str().expect("a token").to_owned();
        let url = format!(
            "wss://streaming.assemblyai.com/v3/ws?token={token}&format_turns=true&speech_model=universal-streaming-english"
        );
        let started = Instant::now();
        let (done, mut finished) = tokio::sync::mpsc::unbounded_channel();
        let stream = speech_stream::open(&url, None, move |event| {
            let at = started.elapsed().as_secs_f64();
            match &event {
                StreamEvent::Message(text) => {
                    let message: serde_json::Value = serde_json::from_str(text).unwrap_or_default();
                    println!(
                        "{at:6.2} s  {} {}",
                        message["type"].as_str().unwrap_or("?"),
                        message["transcript"].as_str().unwrap_or("")
                    );
                }
                StreamEvent::Closed {
                    code,
                    reason,
                    clean,
                } => {
                    println!("{at:6.2} s  closed {code} {reason:?} clean={clean}");
                    let _ = done.send(());
                }
            }
        })
        .await
        .unwrap_or_else(|error| panic!("could not open: {error:?}"));
        println!(
            "{:6.2} s  open, listening to {}",
            started.elapsed().as_secs_f64(),
            stream.label
        );
        tokio::time::sleep(Duration::from_secs(seconds)).await;
        stream.send(r#"{"type":"Terminate"}"#.to_owned());
        stream.close();
        let _ = tokio::time::timeout(Duration::from_secs(4), finished.recv()).await;
    });
}
