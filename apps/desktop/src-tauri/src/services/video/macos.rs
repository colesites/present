//! Decoding video with AVFoundation.
//!
//! ADR-002's macOS backend. `AVAssetReader` is a pull interface — ask for the
//! next sample, get one — which is what a frame pipeline wants and why it was
//! chosen over `AVPlayer`: `services::playback` already owns play, pause and
//! position, and a player would bring a second clock to disagree with.
//!
//! **The pixel format is the load-bearing choice here.** The reader is asked
//! for `kCVPixelFormatType_32BGRA`, so VideoToolbox performs the YUV to RGB
//! conversion itself, in hardware, with the colour matrix and range the file
//! actually declares. Doing that by hand is where washed-out blacks and
//! crushed shadows come from, and it is the half of "decode quality" that is
//! easy to get wrong (ADR-002). It also lands the frame in exactly the layout
//! the compositor and NDI already use, so nothing converts it again.

use std::path::Path;
use std::ptr::NonNull;

use objc2::rc::Retained;
use objc2::runtime::AnyObject;
use objc2_av_foundation::{
    AVAssetReader, AVAssetReaderTrackOutput, AVAssetTrack, AVMediaTypeVideo, AVURLAsset,
};
use objc2_core_media::{CMTime, CMTimeFlags, CMTimeRange};
use objc2_core_video::{
    CVPixelBufferGetBaseAddress, CVPixelBufferGetBytesPerRow, CVPixelBufferGetHeight,
    CVPixelBufferGetWidth, CVPixelBufferLockBaseAddress, CVPixelBufferLockFlags,
    CVPixelBufferUnlockBaseAddress,
};
use objc2_foundation::{NSDictionary, NSNumber, NSString, NSURL};

use super::{VideoDecoder, VideoError, VideoFrame};

/// `kCVPixelFormatType_32BGRA`. The constant is `'BGRA'` as a FourCC.
const PIXEL_FORMAT_32BGRA: u32 = 0x4247_5241;

/// `kCVPixelBufferPixelFormatTypeKey`, spelled out rather than linked, because
/// the CoreVideo string constants are not exposed by the binding crate.
const PIXEL_FORMAT_KEY: &str = "PixelFormatType";

/// `kCVPixelBufferWidthKey` / `kCVPixelBufferHeightKey`.
///
/// Setting these makes VideoToolbox scale during decode, on the same hardware
/// that did the decoding. It is the difference between a 2048x1152 source
/// costing 117 ms a frame to resample in software and costing what a 1080p one
/// costs — the scaler is already there and already free.
const WIDTH_KEY: &str = "Width";
const HEIGHT_KEY: &str = "Height";

/// Ticks per second for the times handed to AVFoundation. 600 is the
/// conventional choice: it divides evenly by 24, 25, 30 and 60, so a seek to a
/// round second lands on a frame boundary for every frame rate in use.
const TIMESCALE: i32 = 600;

pub struct MacVideoDecoder {
    asset: Retained<AVURLAsset>,
    track: Retained<AVAssetTrack>,
    reader: Retained<AVAssetReader>,
    output: Retained<AVAssetReaderTrackOutput>,
    /// The size frames are requested at, if the caller asked for one.
    target: Option<(u32, u32)>,
    width: u32,
    height: u32,
    duration_seconds: Option<f64>,
    /// Set when the reader has run out, so `next_frame` stops asking a finished
    /// reader for samples.
    finished: bool,
}

// The AVFoundation objects are only ever touched behind `&mut self`, and the
// decoder is owned by one caller at a time.
unsafe impl Send for MacVideoDecoder {}

impl MacVideoDecoder {
    /// Open, choosing the size frames are requested at from the video's own.
    pub fn open_sized(
        path: &Path,
        size: impl FnOnce((u32, u32)) -> Option<(u32, u32)>,
    ) -> Result<Self, VideoError> {
        let asset = unsafe {
            let url = NSURL::fileURLWithPath(&NSString::from_str(&path.to_string_lossy()));
            AVURLAsset::URLAssetWithURL_options(&url, None)
        };

        let track = unsafe {
            // The media-type constants are statics that can in principle be
            // absent; without it there is no way to ask for video tracks.
            let Some(video) = AVMediaTypeVideo else {
                return Err(VideoError::Decode(
                    "AVMediaTypeVideo is unavailable".to_owned(),
                ));
            };
            // The synchronous form, deliberately. Apple deprecated it in
            // favour of `loadTracksWithMediaType:completionHandler:` because it
            // can block on a *remote* asset. Every asset here is a local file
            // inside a granted media folder, and the async form would mean a
            // completion block plus a semaphore wait to get back to the same
            // answer — more machinery, same blocking, for a case the
            // deprecation is not about.
            #[allow(deprecated)]
            asset.tracksWithMediaType(video).firstObject()
        }
        .ok_or_else(|| {
            // A container the OS opened but that has no video in it: an audio
            // file with a video extension, or a damaged export.
            VideoError::Unsupported(format!("{} has no video track", path.display()))
        })?;

        let (width, height) = unsafe {
            let size = track.naturalSize();
            (size.width.abs() as u32, size.height.abs() as u32)
        };
        if width == 0 || height == 0 {
            return Err(VideoError::Decode(format!(
                "{} reports a zero-sized video track",
                path.display()
            )));
        }

        let duration_seconds = unsafe {
            let duration = asset.duration();
            if duration.timescale > 0 {
                let seconds = duration.value as f64 / f64::from(duration.timescale);
                seconds.is_finite().then_some(seconds)
            } else {
                None
            }
        };

        let target = size((width, height));
        let (reader, output) = Self::build_reader(&asset, &track, 0.0, target)?;

        // What the compositor will actually receive, which is the scaled size
        // when one was asked for.
        let (width, height) = target.unwrap_or((width, height));

        Ok(Self {
            asset,
            track,
            reader,
            output,
            target,
            width,
            height,
            duration_seconds,
            finished: false,
        })
    }

    /// A reader and its output, started and ready to be pulled from.
    ///
    /// Separate from `open` because seeking rebuilds both: `AVAssetReader` has
    /// no seek, its time range is fixed when it starts (ADR-002 accepts that —
    /// worship video is linear playback of loops, not scrubbing).
    fn build_reader(
        asset: &AVURLAsset,
        track: &AVAssetTrack,
        start_seconds: f64,
        target: Option<(u32, u32)>,
    ) -> Result<(Retained<AVAssetReader>, Retained<AVAssetReaderTrackOutput>), VideoError> {
        unsafe {
            let reader = AVAssetReader::assetReaderWithAsset_error(asset).map_err(|error| {
                VideoError::Decode(format!("could not create a reader: {error:?}"))
            })?;

            // BGRA, so VideoToolbox converts colour in hardware. See the module
            // comment — this is the line that keeps blacks black.
            let mut keys = vec![NSString::from_str(PIXEL_FORMAT_KEY)];
            let mut values: Vec<Retained<AnyObject>> =
                vec![Retained::into(NSNumber::new_u32(PIXEL_FORMAT_32BGRA))];

            if let Some((width, height)) = target {
                keys.push(NSString::from_str(WIDTH_KEY));
                values.push(Retained::into(NSNumber::new_u32(width)));
                keys.push(NSString::from_str(HEIGHT_KEY));
                values.push(Retained::into(NSNumber::new_u32(height)));
            }

            let key_refs: Vec<&NSString> = keys.iter().map(|key| &**key).collect();
            let settings: Retained<NSDictionary<NSString, AnyObject>> =
                NSDictionary::from_retained_objects(&key_refs, &values);

            let output = AVAssetReaderTrackOutput::assetReaderTrackOutputWithTrack_outputSettings(
                track,
                Some(&settings),
            );
            // Frames are consumed one at a time and dropped, so there is no
            // reason for the reader to hold them alive after we have copied.
            output.setAlwaysCopiesSampleData(false);

            if !reader.canAddOutput(&output) {
                return Err(VideoError::Unsupported(
                    "this video's format cannot be read as BGRA".to_owned(),
                ));
            }
            reader.addOutput(&output);

            // **Before `startReading`, always.** `AVAssetReader` treats its
            // time range as immutable once reading has begun and raises an
            // Objective-C exception if it is set afterwards — which Rust cannot
            // catch, so the process aborts rather than returning an error.
            // Found by running it, not by reading about it.
            if start_seconds > 0.0 {
                let start = CMTime {
                    value: (start_seconds * f64::from(TIMESCALE)).round() as i64,
                    timescale: TIMESCALE,
                    flags: CMTimeFlags::Valid,
                    epoch: 0,
                };
                reader.setTimeRange(CMTimeRange {
                    start,
                    duration: CMTime {
                        value: i64::MAX,
                        timescale: TIMESCALE,
                        flags: CMTimeFlags::Valid,
                        epoch: 0,
                    },
                });
            }

            if !reader.startReading() {
                return Err(VideoError::Decode(format!(
                    "the reader refused to start: {:?}",
                    reader.error()
                )));
            }

            Ok((reader, output))
        }
    }

    /// Copy a locked `CVPixelBuffer` into a tightly packed BGRA vector.
    ///
    /// The copy is not avoidable and not regretted: the pixel buffer belongs to
    /// the decoder and is recycled as soon as the sample is released, so
    /// borrowing it would hand the compositor a pointer that stops being valid
    /// the moment it asks for the next frame.
    ///
    /// The row-by-row loop is the part that matters. A pixel buffer's rows are
    /// padded to an alignment, so `bytesPerRow` is usually wider than
    /// `width * 4`. Copying the whole block in one go would fold that padding
    /// into the image and shear every frame diagonally.
    unsafe fn copy_pixels(
        base: NonNull<std::ffi::c_void>,
        bytes_per_row: usize,
        width: u32,
        height: u32,
    ) -> Vec<u8> {
        let row_bytes = width as usize * 4;
        let mut out = Vec::with_capacity(row_bytes * height as usize);

        for row in 0..height as usize {
            let start = base.as_ptr().cast::<u8>().add(row * bytes_per_row);
            out.extend_from_slice(std::slice::from_raw_parts(start, row_bytes));
        }
        out
    }
}

impl VideoDecoder for MacVideoDecoder {
    fn next_frame(&mut self) -> Result<Option<VideoFrame>, VideoError> {
        if self.finished {
            return Ok(None);
        }

        unsafe {
            let Some(sample) = self.output.copyNextSampleBuffer() else {
                // Either the end of the track or a failure; the reader knows.
                self.finished = true;
                if let Some(error) = self.reader.error() {
                    return Err(VideoError::Decode(format!("{error:?}")));
                }
                return Ok(None);
            };

            let Some(image) = sample.image_buffer() else {
                // A sample with no image buffer is not fatal — skip it and let
                // the next call try the following one.
                return Ok(None);
            };

            let timestamp = sample.presentation_time_stamp();
            let presentation_seconds = if timestamp.timescale > 0 {
                timestamp.value as f64 / f64::from(timestamp.timescale)
            } else {
                0.0
            };

            if CVPixelBufferLockBaseAddress(&image, CVPixelBufferLockFlags::ReadOnly) != 0 {
                return Err(VideoError::Decode("could not lock the frame".to_owned()));
            }

            let width = CVPixelBufferGetWidth(&image) as u32;
            let height = CVPixelBufferGetHeight(&image) as u32;
            let bytes_per_row = CVPixelBufferGetBytesPerRow(&image);
            let base = CVPixelBufferGetBaseAddress(&image);

            let bgra = match NonNull::new(base) {
                Some(base) if width > 0 && height > 0 => {
                    Self::copy_pixels(base, bytes_per_row, width, height)
                }
                _ => {
                    CVPixelBufferUnlockBaseAddress(&image, CVPixelBufferLockFlags::ReadOnly);
                    return Err(VideoError::Decode("the frame had no pixels".to_owned()));
                }
            };

            CVPixelBufferUnlockBaseAddress(&image, CVPixelBufferLockFlags::ReadOnly);

            Ok(Some(VideoFrame {
                width,
                height,
                bgra,
                presentation_seconds,
            }))
        }
    }

    fn seek(&mut self, seconds: f64) -> Result<(), VideoError> {
        if !seconds.is_finite() || seconds < 0.0 {
            return Err(VideoError::Decode(format!("cannot seek to {seconds}")));
        }

        // `AVAssetReader` has no seek: its time range is fixed before it starts,
        // so seeking means a new reader over a new range. ADR-002 accepts the
        // cost — worship video is linear playback of loops, not scrubbing.
        unsafe {
            self.reader.cancelReading();
        }

        let (reader, output) = Self::build_reader(&self.asset, &self.track, seconds, self.target)?;
        self.reader = reader;
        self.output = output;
        self.finished = false;
        Ok(())
    }

    fn duration_seconds(&self) -> Option<f64> {
        self.duration_seconds
    }

    fn dimensions(&self) -> (u32, u32) {
        (self.width, self.height)
    }
}
