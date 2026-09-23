//! Microphone and camera authorisation.
//!
//! Ports `src/main/services/media-permissions.service.ts:56-88`. Same three
//! outcomes and the same strings, so the React side compares against the values
//! it already compares against.
//!
//! macOS is the only platform that gates capture behind a per-app grant;
//! Electron returns `granted` unconditionally elsewhere and so does this.
//!
//! The webview prompts on its own the first time `getUserMedia` runs — the
//! capability probe confirmed live capture works under WKWebView without any of
//! this. What these calls add is the ability to ask *before* showing a UI that
//! depends on the answer, and to tell "denied once, will never prompt again"
//! apart from "not asked yet", which a bare `getUserMedia` rejection cannot.

use serde::Serialize;

/// `MediaAccessResult` in `src/shared/types/electron.d.ts:24-27`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MediaAccessResult {
    pub granted: bool,
    /// One of Electron's `getMediaAccessStatus` strings: `granted`, `denied`,
    /// `restricted`, `not-determined` or `unknown`.
    pub status: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum MediaKind {
    Microphone,
    Camera,
}

#[cfg(target_os = "macos")]
mod platform {
    use super::{MediaAccessResult, MediaKind};

    use objc2_av_foundation::{AVAuthorizationStatus, AVCaptureDevice, AVMediaType};

    fn media_type(kind: MediaKind) -> Option<&'static AVMediaType> {
        // SAFETY: reading a framework string constant.
        unsafe {
            match kind {
                MediaKind::Microphone => objc2_av_foundation::AVMediaTypeAudio,
                MediaKind::Camera => objc2_av_foundation::AVMediaTypeVideo,
            }
        }
    }

    fn describe(status: AVAuthorizationStatus) -> &'static str {
        match status {
            AVAuthorizationStatus::Authorized => "granted",
            AVAuthorizationStatus::Denied => "denied",
            AVAuthorizationStatus::Restricted => "restricted",
            AVAuthorizationStatus::NotDetermined => "not-determined",
            _ => "unknown",
        }
    }

    pub fn status(kind: MediaKind) -> String {
        let Some(media_type) = media_type(kind) else {
            return "unknown".to_owned();
        };
        // SAFETY: `authorizationStatusForMediaType:` takes one of the two media
        // types this function can produce; anything else raises an Objective-C
        // exception, which is why the constant is not built from a string here.
        let status = unsafe { AVCaptureDevice::authorizationStatusForMediaType(media_type) };
        describe(status).to_owned()
    }

    /// Show the system prompt and wait for the answer.
    ///
    /// The completion block fires on an arbitrary dispatch queue, so the result
    /// comes back over a channel rather than by touching anything shared.
    pub fn request(kind: MediaKind) -> MediaAccessResult {
        let Some(media_type) = media_type(kind) else {
            return MediaAccessResult {
                granted: false,
                status: "unknown".to_owned(),
            };
        };

        let (sender, receiver) = std::sync::mpsc::channel();
        let handler = block2::RcBlock::new(move |granted: objc2::runtime::Bool| {
            let _ = sender.send(granted.as_bool());
        });

        // SAFETY: same media-type constraint as above; the block outlives the
        // call because `RcBlock` is retained by the callee.
        unsafe {
            AVCaptureDevice::requestAccessForMediaType_completionHandler(media_type, &handler);
        }

        // The prompt stays up until the operator answers it. There is no
        // timeout on purpose: guessing "denied" after N seconds and then having
        // the OS grant access leaves the app and the system disagreeing.
        let granted = receiver.recv().unwrap_or(false);

        MediaAccessResult {
            granted,
            status: status(kind),
        }
    }
}

#[cfg(not(target_os = "macos"))]
mod platform {
    use super::{MediaAccessResult, MediaKind};

    pub fn status(_kind: MediaKind) -> String {
        "granted".to_owned()
    }

    pub fn request(_kind: MediaKind) -> MediaAccessResult {
        MediaAccessResult {
            granted: true,
            status: "granted".to_owned(),
        }
    }
}

/// Ask for access, prompting only when the answer is not already settled.
///
/// Ports the early returns in `requestMicrophoneAccess`
/// (`media-permissions.service.ts:61-73`): an already-granted permission does
/// not prompt, and a denied or restricted one cannot be re-prompted — macOS
/// shows the dialog once and after that only System Settings can change it.
pub fn request(kind: MediaKind) -> MediaAccessResult {
    let current = platform::status(kind);

    if current == "granted" {
        return MediaAccessResult {
            granted: true,
            status: current,
        };
    }
    if current != "not-determined" {
        return MediaAccessResult {
            granted: false,
            status: current,
        };
    }

    platform::request(kind)
}

/// Current status without prompting.
pub fn status(kind: MediaKind) -> MediaAccessResult {
    let status = platform::status(kind);
    MediaAccessResult {
        granted: status == "granted",
        status,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_status_read_never_prompts_and_always_answers() {
        // Whatever this machine's state is, the result must be one of the
        // strings the React side knows how to read.
        for kind in [MediaKind::Microphone, MediaKind::Camera] {
            let result = status(kind);
            assert!(
                matches!(
                    result.status.as_str(),
                    "granted" | "denied" | "restricted" | "not-determined" | "unknown"
                ),
                "unexpected status {}",
                result.status
            );
            assert_eq!(result.granted, result.status == "granted");
        }
    }

    #[test]
    fn the_result_serialises_with_the_shape_the_ui_expects() {
        let json = serde_json::to_value(MediaAccessResult {
            granted: false,
            status: "not-determined".to_owned(),
        })
        .expect("serialisable");

        assert_eq!(json["granted"], false);
        assert_eq!(json["status"], "not-determined");
    }
}
