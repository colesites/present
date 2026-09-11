//! Telling the operator which media will not play.
//!
//! ADR-002 chose the platform decoder, and named the cost: AVFoundation does
//! not open `.mkv` or `.avi`, and `.webm` only sometimes. The ADR also says
//! what has to happen about it — "a volunteer dropping an unsupported file into
//! a media folder needs to be told before the service, not shown a black
//! rectangle during it. That is a UI requirement this decision creates, not an
//! implementation detail."
//!
//! This is that requirement. The media panel asks once per folder load and gets
//! back **only the files that will not play**, so the normal answer is an empty
//! list and the normal cost is nothing.
//!
//! Extension, not content. The panel draws hundreds of items and opening each
//! one to find out would make it unusable; `services::video::open` is still
//! where a file is really judged.

use serde::Serialize;

use crate::errors::AppResult;
use crate::services::video;

/// A file the media panel is showing that the decoder cannot open.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UnplayableMedia {
    pub path: String,
    /// What to do about it, phrased for somebody setting up on a Sunday
    /// morning: the next step, not the diagnosis.
    pub advice: String,
}

/// Which of these will not play?
///
/// Returns only the problems. A library of MP4s answers with an empty list,
/// which is the case worth being cheap.
#[tauri::command]
pub async fn check_video_support(paths: Vec<String>) -> AppResult<Vec<UnplayableMedia>> {
    let mut unplayable = Vec::new();

    for path in paths {
        let as_path = std::path::Path::new(&path);
        if video::support_for(as_path) != video::Support::UnsupportedContainer {
            continue;
        }
        if let Some(advice) = video::unsupported_advice(as_path) {
            unplayable.push(UnplayableMedia { path, advice });
        }
    }

    Ok(unplayable)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn a_library_of_playable_files_answers_with_nothing() {
        // The normal case, and the one worth being cheap: sixty-seven MP4s in
        // the owner's own library, none of them a problem.
        let paths = vec![
            "/media/bumper.mp4".to_owned(),
            "/media/Welcome.MOV".to_owned(),
            "/media/clip.m4v".to_owned(),
        ];

        assert_eq!(check_video_support(paths).await.unwrap(), Vec::new());
    }

    #[tokio::test]
    async fn only_the_unplayable_files_come_back() {
        let paths = vec![
            "/media/bumper.mp4".to_owned(),
            "/media/wedding.avi".to_owned(),
            "/media/background.jpg".to_owned(),
            "/media/service.mkv".to_owned(),
        ];

        let unplayable = check_video_support(paths).await.unwrap();
        let reported: Vec<&str> = unplayable.iter().map(|item| item.path.as_str()).collect();

        assert_eq!(reported, vec!["/media/wedding.avi", "/media/service.mkv"]);
    }

    #[tokio::test]
    async fn an_image_is_never_reported_as_a_broken_video() {
        // A media folder is full of stills and the odd `.DS_Store`. Telling
        // somebody to convert a JPEG to MP4 would destroy trust in the warning.
        let paths = vec![
            "/media/background.jpg".to_owned(),
            "/media/logo.png".to_owned(),
            "/media/.DS_Store".to_owned(),
            "/media/notes.txt".to_owned(),
        ];

        assert_eq!(check_video_support(paths).await.unwrap(), Vec::new());
    }

    #[tokio::test]
    async fn the_advice_names_the_file_and_the_next_step() {
        let unplayable = check_video_support(vec!["/media/Set #2.avi".to_owned()])
            .await
            .unwrap();

        let advice = &unplayable[0].advice;
        assert!(advice.contains("Set #2.avi"), "{advice}");
        assert!(advice.contains("MP4"), "{advice}");
    }

    #[tokio::test]
    async fn an_empty_library_is_not_an_error() {
        assert_eq!(check_video_support(Vec::new()).await.unwrap(), Vec::new());
    }
}
