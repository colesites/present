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

/// The JPEG for `path`, from the cache or decoded now.
pub fn thumbnail(path: &Path, cache_dir: &Path) -> AppResult<Vec<u8>> {
    let metadata = std::fs::metadata(path)?;
    let modified = metadata
        .modified()
        .ok()
        .and_then(|time| time.duration_since(UNIX_EPOCH).ok())
        .map_or(0, |since| since.as_nanos());
    let cached = cache_file(cache_dir, path, metadata.len(), modified);
    if let Ok(bytes) = std::fs::read(&cached) {
        return Ok(bytes);
    }

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
pub fn encode_jpeg(width: u32, height: u32, bgra: &[u8]) -> AppResult<Vec<u8>> {
    let rgb: Vec<u8> = bgra
        .chunks_exact(4)
        .flat_map(|pixel| [pixel[2], pixel[1], pixel[0]])
        .collect();
    let mut jpeg = Vec::new();
    image::codecs::jpeg::JpegEncoder::new_with_quality(&mut jpeg, JPEG_QUALITY)
        .encode(&rgb, width, height, image::ExtendedColorType::Rgb8)
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
