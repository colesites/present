//! Video frames for the compositor.
//!
//! ADR-002: the operating system decodes, not a bundled FFmpeg. That buys
//! hardware decode, correct colour conversion and nothing extra in the
//! installer, and it costs the containers the OS will not open.
//!
//! **That cost is the reason this module has a support check at all.** A
//! volunteer drops files into a media folder days before anyone presents from
//! them. If an unsupported one fails at the moment it goes on the audience
//! screen, it fails in front of a congregation. So "can this be played" is
//! answerable without decoding anything, and the panel can say so while there
//! is still time to convert the file.

use std::path::Path;

#[cfg(target_os = "macos")]
mod macos;

/// One decoded frame, in the compositor's own terms.
///
/// BGRA because that is what `Frame::to_bgra` produces for NDI and what
/// VideoToolbox is asked for directly, so a frame crosses this boundary without
/// a conversion in either direction.
#[derive(Debug, Clone, PartialEq)]
pub struct VideoFrame {
    pub width: u32,
    pub height: u32,
    /// `width * height * 4` bytes, B, G, R, A.
    pub bgra: Vec<u8>,
    /// Where this frame sits in the video, in seconds.
    pub presentation_seconds: f64,
}

impl VideoFrame {
    /// Is this frame internally consistent?
    ///
    /// Checked at the boundary because everything downstream indexes into
    /// `bgra` using `width` and `height`, and a decoder that reported a size
    /// that did not match its buffer would turn into an out-of-bounds read in
    /// the compositor rather than a decode error here.
    pub fn is_well_formed(&self) -> bool {
        self.width > 0
            && self.height > 0
            && self.bgra.len() == self.width as usize * self.height as usize * 4
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum VideoError {
    /// The container or codec is not something this platform decodes.
    Unsupported(String),
    /// The file is gone, unreadable, or not where it said it was.
    NotFound(String),
    /// The decoder opened it and then failed.
    Decode(String),
    /// No decoder on this platform yet.
    NoBackend,
}

impl std::fmt::Display for VideoError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Unsupported(detail) => write!(formatter, "unsupported video: {detail}"),
            Self::NotFound(detail) => write!(formatter, "video not found: {detail}"),
            Self::Decode(detail) => write!(formatter, "could not decode video: {detail}"),
            Self::NoBackend => write!(formatter, "no video decoder on this platform yet"),
        }
    }
}

impl std::error::Error for VideoError {}

/// Pulling frames out of one video.
///
/// A pull interface rather than a player: `services::playback` already owns
/// play, pause and position, and a decoder with its own clock would be a second
/// opinion about where the video is (ADR-002).
pub trait VideoDecoder: Send {
    /// The next frame in presentation order, or `None` at the end.
    fn next_frame(&mut self) -> Result<Option<VideoFrame>, VideoError>;

    /// Move to `seconds`. The next `next_frame` starts from there.
    fn seek(&mut self, seconds: f64) -> Result<(), VideoError>;

    /// `None` when the container does not say — a stream, or a file still
    /// being written. Not a failure: an unknown duration is still playable.
    fn duration_seconds(&self) -> Option<f64>;

    fn dimensions(&self) -> (u32, u32);
}

/// What the platform decoder can open, by extension.
///
/// Extension rather than content, deliberately. This answers a question the
/// media panel asks about hundreds of files while drawing a list, and opening
/// each one to find out would make the panel unusable. It is a first filter,
/// not a guarantee — `open` is still where a file is really judged.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Support {
    /// The platform decoder handles this.
    Supported,
    /// The container is one the platform decoder cannot open. The operator
    /// needs to convert it, and needs to know before the service.
    UnsupportedContainer,
    /// Not a video as far as this application is concerned.
    NotVideo,
}

/// Containers AVFoundation opens. QuickTime and the MPEG-4 family.
const MACOS_CONTAINERS: [&str; 4] = ["mp4", "mov", "m4v", "m4p"];

/// Video containers the media panel accepts that the platform decoder does not.
///
/// Listed rather than inferred so the message can name them. `useMediaFolders.ts`
/// offers all of these, so every one is a file somebody can already add today.
const UNSUPPORTED_CONTAINERS: [&str; 3] = ["mkv", "avi", "webm"];

/// Can the platform decoder open this path?
pub fn support_for(path: &Path) -> Support {
    let Some(extension) = path.extension().and_then(|value| value.to_str()) else {
        return Support::NotVideo;
    };
    let extension = extension.to_ascii_lowercase();

    if MACOS_CONTAINERS.contains(&extension.as_str()) {
        return Support::Supported;
    }
    if UNSUPPORTED_CONTAINERS.contains(&extension.as_str()) {
        return Support::UnsupportedContainer;
    }
    Support::NotVideo
}

/// What to tell an operator about a file that will not play.
///
/// Phrased as something to do, not as a diagnosis. Whoever reads it is usually
/// setting up on a Sunday morning and needs the next step, not the reason.
pub fn unsupported_advice(path: &Path) -> Option<String> {
    if support_for(path) != Support::UnsupportedContainer {
        return None;
    }
    let name = path
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or("This video");

    Some(format!(
        "{name} is in a format this app cannot play. Convert it to MP4 (H.264) \
         and add it again."
    ))
}

/// Open a video for decoding.
///
/// Refuses an unsupported container before touching the file, so the error says
/// what to do about it rather than whatever the platform decoder says when it
/// fails to parse something.
pub fn open(path: &Path) -> Result<Box<dyn VideoDecoder>, VideoError> {
    open_scaled(path, None)
}

/// Open a video, asking the decoder for frames at a given size.
///
/// The scaling happens on the same hardware that decodes, which is why this
/// exists rather than the compositor resizing afterwards: a source that does not
/// match the output was measured at 117 ms a frame resampled in software,
/// against 23 ms for one that did. The scaler is already in the decode path and
/// costs nothing to use.
pub fn open_scaled(
    path: &Path,
    target: Option<(u32, u32)>,
) -> Result<Box<dyn VideoDecoder>, VideoError> {
    match support_for(path) {
        Support::UnsupportedContainer => {
            return Err(VideoError::Unsupported(
                unsupported_advice(path).unwrap_or_else(|| "unsupported container".to_owned()),
            ));
        }
        Support::NotVideo => {
            return Err(VideoError::Unsupported(format!(
                "{} is not a video file",
                path.display()
            )));
        }
        Support::Supported => {}
    }

    if !path.exists() {
        return Err(VideoError::NotFound(path.display().to_string()));
    }

    #[cfg(target_os = "macos")]
    {
        macos::MacVideoDecoder::open(path, target)
            .map(|decoder| Box::new(decoder) as Box<dyn VideoDecoder>)
    }
    // Windows and Linux inherit the trait and no backend, which is the honest
    // state of ADR-002 rather than a stub that pretends otherwise.
    #[cfg(not(target_os = "macos"))]
    {
        let _ = target;
        Err(VideoError::NoBackend)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    #[test]
    fn the_mpeg4_family_is_supported() {
        for name in ["bumper.mp4", "countdown.MOV", "clip.m4v"] {
            assert_eq!(
                support_for(&PathBuf::from(name)),
                Support::Supported,
                "{name} should be playable"
            );
        }
    }

    #[test]
    fn the_containers_the_panel_accepts_but_the_os_cannot_open_are_named() {
        // ADR-002's cost. `useMediaFolders.ts` offers all three, so each one is
        // a file somebody can already add today and expect to work.
        for name in ["service.mkv", "old-clip.avi", "loop.webm"] {
            assert_eq!(
                support_for(&PathBuf::from(name)),
                Support::UnsupportedContainer,
                "{name} should be flagged, not silently ignored"
            );
        }
    }

    #[test]
    fn an_unsupported_file_gets_advice_rather_than_a_diagnosis() {
        // Whoever reads this is setting up on a Sunday morning. They need the
        // next step, not the reason.
        let advice = unsupported_advice(&PathBuf::from("/media/Set #2.mkv")).expect("advice");

        assert!(
            advice.contains("Set #2.mkv"),
            "it should name the file: {advice}"
        );
        assert!(
            advice.contains("MP4"),
            "it should say what to convert to: {advice}"
        );
    }

    #[test]
    fn a_playable_file_gets_no_advice() {
        assert_eq!(unsupported_advice(&PathBuf::from("bumper.mp4")), None);
        assert_eq!(unsupported_advice(&PathBuf::from("notes.txt")), None);
    }

    #[test]
    fn anything_that_is_not_a_video_is_not_reported_as_a_broken_one() {
        // An image or a stray `.DS_Store` in a media folder must not tell the
        // operator to convert it to MP4.
        for name in ["background.jpg", "notes.txt", "noextension", ".DS_Store"] {
            assert_eq!(
                support_for(&PathBuf::from(name)),
                Support::NotVideo,
                "{name} should not be treated as a video"
            );
        }
    }

    #[test]
    fn case_does_not_decide_whether_a_file_plays() {
        // Exports from phones and cameras routinely arrive as `.MP4`.
        assert_eq!(support_for(&PathBuf::from("a.MP4")), Support::Supported);
        assert_eq!(
            support_for(&PathBuf::from("a.MkV")),
            Support::UnsupportedContainer
        );
    }

    #[test]
    fn opening_an_unsupported_container_says_what_to_do() {
        let Err(error) = open(&PathBuf::from("/media/loop.mkv")) else {
            panic!("an unsupported container should not open");
        };

        match error {
            VideoError::Unsupported(message) => {
                assert!(message.contains("MP4"), "{message}");
            }
            other => panic!("expected Unsupported, got {other:?}"),
        }
    }

    #[test]
    fn opening_a_missing_but_supported_file_is_not_found_rather_than_unsupported() {
        // The two need telling apart: one is "convert this", the other is
        // "the file moved".
        let Err(error) = open(&PathBuf::from("/media/definitely-not-here-12345.mp4")) else {
            panic!("a missing file should not open");
        };
        assert!(matches!(error, VideoError::NotFound(_)), "{error:?}");
    }

    #[test]
    fn a_frame_whose_buffer_does_not_match_its_size_is_not_well_formed() {
        // Everything downstream indexes into `bgra` using these two numbers, so
        // a mismatch would be an out-of-bounds read in the compositor rather
        // than a decode error here.
        let good = VideoFrame {
            width: 2,
            height: 2,
            bgra: vec![0; 16],
            presentation_seconds: 0.0,
        };
        assert!(good.is_well_formed());

        let short = VideoFrame {
            bgra: vec![0; 8],
            ..good.clone()
        };
        assert!(!short.is_well_formed());

        let empty = VideoFrame {
            width: 0,
            ..good.clone()
        };
        assert!(!empty.is_well_formed());
    }
}
