//! Still pictures of the videos in the media panel.
//!
//! The panel drew every video as a paused video element. With forty-two
//! 4K files that is forty-two decoders for pictures that never move, and in the
//! running app every one of them redrew after the window was minimised and
//! restored while the playing video fell to 4–8 frames a second (known-issues
//! §18). Here each video is decoded once, for one frame, and kept as a small
//! JPEG in the app's cache; the panel shows an `<img>`.

use std::path::{Path, PathBuf};
use std::time::UNIX_EPOCH;

use crate::errors::{AppError, AppResult};
use crate::services::video;

/// Large enough for the panel's widest card on a Retina screen.
pub const THUMBNAIL_BOUNDS: (u32, u32) = (480, 270);
const JPEG_QUALITY: u8 = 80;
/// The cache folder, under the app's cache directory.
pub const CACHE_FOLDER: &str = "thumbnails";

/// Where the picture comes from: a tenth of the way in, at most three seconds.
/// The first frame of a background loop is often a fade from black.
pub fn frame_time(duration_seconds: Option<f64>) -> f64 {
    match duration_seconds {
        Some(duration) if duration.is_finite() && duration > 0.0 => (duration * 0.1).min(3.0),
        _ => 0.0,
    }
}

/// The cache file for a video as it is now: its path, size and modification
/// time, hashed. A file replaced or edited gets a new picture.
pub fn cache_file(cache_dir: &Path, path: &Path, size: u64, modified_nanos: u128) -> PathBuf {
    let mut hasher = blake3::Hasher::new();
    hasher.update(path.as_os_str().as_encoded_bytes());
    hasher.update(&size.to_le_bytes());
    hasher.update(&modified_nanos.to_le_bytes());
    let hash = hasher.finalize().to_hex();
    cache_dir.join(format!("{}.jpg", &hash[..32]))
}

/// The picture this video already has, if it has one.
///
/// Separate from `thumbnail` because the two cost nothing alike: this is a
/// file read of a few kilobytes, and decoding is a video decoder opened on a
/// 4K file. The caller queues one and not the other — a panel of forty-two
/// videos that have all been seen before should draw at once, not two at a
/// time behind a queue that exists to protect the decoder.
pub fn cached(path: &Path, cache_dir: &Path) -> Option<Vec<u8>> {
    let metadata = std::fs::metadata(path).ok()?;
    let modified = metadata
        .modified()
        .ok()
        .and_then(|time| time.duration_since(UNIX_EPOCH).ok())
        .map_or(0, |since| since.as_nanos());
    std::fs::read(cache_file(cache_dir, path, metadata.len(), modified)).ok()
}

/// The JPEG for `path`, from the cache or decoded now.
pub fn thumbnail(path: &Path, cache_dir: &Path) -> AppResult<Vec<u8>> {
    if let Some(bytes) = cached(path, cache_dir) {
        return Ok(bytes);
    }
    let metadata = std::fs::metadata(path)?;
    let modified = metadata
        .modified()
        .ok()
        .and_then(|time| time.duration_since(UNIX_EPOCH).ok())
        .map_or(0, |since| since.as_nanos());
    let cached = cache_file(cache_dir, path, metadata.len(), modified);

    let jpeg = decode(path)?;
    std::fs::create_dir_all(cache_dir)?;
    // Written beside its name and renamed, so a half-written file is never read.
    let partial = cached.with_extension("jpg.partial");
    std::fs::write(&partial, &jpeg)?;
    std::fs::rename(&partial, &cached)?;
    Ok(jpeg)
}

fn decode(path: &Path) -> AppResult<Vec<u8>> {
    let fail = |error: video::VideoError| AppError::Invalid(error.to_string());
    let mut decoder = video::open_contained(path, THUMBNAIL_BOUNDS).map_err(fail)?;
    let at = frame_time(decoder.duration_seconds());
    if at > 0.0 && decoder.seek(at).is_err() {
        decoder.seek(0.0).map_err(fail)?;
    }
    let frame = match decoder.next_frame().map_err(fail)? {
        Some(frame) => frame,
        None => {
            decoder.seek(0.0).map_err(fail)?;
            decoder
                .next_frame()
                .map_err(fail)?
                .ok_or_else(|| AppError::Invalid("the video has no frames".to_owned()))?
        }
    };
    if !frame.is_well_formed() {
        return Err(AppError::Invalid(
            "the decoder returned a malformed frame".to_owned(),
        ));
    }
    encode_jpeg(frame.width, frame.height, &frame.bgra)
}

/// BGRA to a JPEG. The alpha of a video frame is always opaque.
///
/// Also what every panel that shows a video gets each frame as
/// (`media_frames_state`, `preview_state`), so it is encoded straight from
/// the BGRA, without a copy into RGB first.
pub fn encode_jpeg(width: u32, height: u32, bgra: &[u8]) -> AppResult<Vec<u8>> {
    let (Ok(narrow_width), Ok(narrow_height)) = (u16::try_from(width), u16::try_from(height))
    else {
        return Err(AppError::Invalid(format!(
            "a {width}x{height} picture is too large for a JPEG"
        )));
    };
    if bgra.len() != width as usize * height as usize * 4 {
        return Err(AppError::Invalid(
            "the picture's size does not match its pixels".to_owned(),
        ));
    }
    let mut jpeg = Vec::with_capacity(bgra.len() / 10);
    jpeg_encoder::Encoder::new(&mut jpeg, JPEG_QUALITY)
        .encode(
            bgra,
            narrow_width,
            narrow_height,
            jpeg_encoder::ColorType::Bgra,
        )
        .map_err(|error| AppError::Invalid(format!("could not encode the thumbnail: {error}")))?;
    Ok(jpeg)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_picture_is_a_tenth_of_the_way_in_and_at_most_three_seconds() {
        assert_eq!(frame_time(Some(10.0)), 1.0);
        assert_eq!(frame_time(Some(600.0)), 3.0);
        assert_eq!(frame_time(Some(0.5)), 0.05);
        assert_eq!(frame_time(None), 0.0);
        assert_eq!(frame_time(Some(f64::NAN)), 0.0);
        assert_eq!(frame_time(Some(0.0)), 0.0);
    }

    /// A picture already made is a file read, not a decode.
    ///
    /// The panel asks for every visible video at once. Whether those requests
    /// queue decides whether a folder of videos seen before draws at once or
    /// two at a time, so which path a cache hit takes is worth pinning.
    #[test]
    fn a_picture_already_made_comes_back_without_a_decoder() {
        let dir = std::env::temp_dir().join(format!(
            "present-thumbnails-{}-{:?}",
            std::process::id(),
            std::thread::current().id()
        ));
        let _ = std::fs::remove_dir_all(&dir);
        let cache = dir.join("thumbnails");
        std::fs::create_dir_all(&cache).expect("the cache folder");

        // Not a video at all: if this were decoded it could not succeed.
        let video = dir.join("looks-like-a-video.mp4");
        std::fs::write(&video, b"not a video").expect("the file");
        assert!(
            cached(&video, &cache).is_none(),
            "nothing has been made for it yet"
        );
        assert!(
            thumbnail(&video, &cache).is_err(),
            "and it cannot be decoded"
        );

        // Once there is a picture for it, both paths hand it back.
        let metadata = std::fs::metadata(&video).expect("metadata");
        let modified = metadata
            .modified()
            .ok()
            .and_then(|time| time.duration_since(UNIX_EPOCH).ok())
            .map_or(0, |since| since.as_nanos());
        let file = cache_file(&cache, &video, metadata.len(), modified);
        std::fs::write(&file, b"a jpeg").expect("the cached picture");

        assert_eq!(cached(&video, &cache).as_deref(), Some(&b"a jpeg"[..]));
        assert_eq!(
            thumbnail(&video, &cache).expect("the cached picture"),
            b"a jpeg",
            "and it is not decoded again"
        );
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_changed_file_gets_a_new_cache_entry() {
        let dir = Path::new("/cache");
        let path = Path::new("/media/loop.mp4");
        let original = cache_file(dir, path, 1_000, 5);
        assert_eq!(original, cache_file(dir, path, 1_000, 5), "stable");
        assert_ne!(original, cache_file(dir, path, 1_001, 5), "resized");
        assert_ne!(original, cache_file(dir, path, 1_000, 6), "touched");
        assert_ne!(
            original,
            cache_file(dir, Path::new("/media/other.mp4"), 1_000, 5)
        );
        assert_eq!(original.extension().and_then(|e| e.to_str()), Some("jpg"));
        assert_eq!(original.parent(), Some(dir));
    }

    #[test]
    fn a_frame_encodes_as_a_jpeg_of_its_size() {
        let (width, height) = (32, 18);
        let bgra: Vec<u8> = (0..width * height)
            .flat_map(|_| [30, 60, 200, 255])
            .collect();
        let jpeg = encode_jpeg(width, height, &bgra).unwrap();
        let decoded = image::load_from_memory(&jpeg).unwrap().to_rgb8();
        assert_eq!(decoded.dimensions(), (width, height));
        let pixel = decoded.get_pixel(16, 9);
        assert!(
            (i32::from(pixel[0]) - 200).abs() < 8 && (i32::from(pixel[2]) - 30).abs() < 8,
            "{pixel:?}: red and blue not swapped"
        );
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn a_real_video_becomes_a_cached_thumbnail() {
        let Some(video) = std::env::var_os("PRESENT_SAMPLE_VIDEO") else {
            eprintln!("PRESENT_SAMPLE_VIDEO not set; skipped");
            return;
        };
        let cache = std::env::temp_dir().join(format!("present-thumbs-{}", std::process::id()));
        let started = std::time::Instant::now();
        let first = thumbnail(Path::new(&video), &cache).unwrap();
        let decoded_in = started.elapsed();
        let started = std::time::Instant::now();
        let second = thumbnail(Path::new(&video), &cache).unwrap();
        eprintln!(
            "decoded in {decoded_in:?}, cached in {:?}, {} bytes",
            started.elapsed(),
            first.len()
        );
        assert_eq!(first, second);
        let image = image::load_from_memory(&first).unwrap();
        assert!(image.width() <= THUMBNAIL_BOUNDS.0 && image.height() <= THUMBNAIL_BOUNDS.1);
        let _ = std::fs::remove_dir_all(cache);
    }
}
