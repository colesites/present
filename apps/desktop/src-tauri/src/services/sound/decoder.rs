//! A file's sound, decoded by FFmpeg into what an output plays: 32-bit float
//! samples, interleaved, at the output's rate and channel count. Whatever the
//! file holds — AAC, MP3, AC-3, PCM, 44.1 or 48 kHz, mono or 5.1 —
//! swresample converts it, so the output never has to.

use std::path::Path;

use ffmpeg_next as ff;

/// Decoded sound, in the output's format.
#[derive(Debug, Clone, PartialEq)]
pub struct Chunk {
    /// Where the first frame sits in the file, in seconds.
    pub start_seconds: f64,
    /// `channels` samples per frame, interleaved.
    pub samples: Vec<f32>,
}

pub struct AudioDecoder {
    input: ff::format::context::Input,
    stream_index: usize,
    time_base: f64,
    decoder: ff::codec::decoder::Audio,
    resampler: Option<Resampler>,
    frame: ff::frame::Audio,
    rate: u32,
    channels: u16,
    duration_seconds: Option<f64>,
    /// Where the next chunk starts. Counted on from the first frame after a
    /// seek rather than read off every frame, whose timestamps are rounded to
    /// the stream's time base and would make the clock stutter.
    next_seconds: Option<f64>,
    /// After a seek: frames before this are the key frame's lead-in, dropped.
    skip_until: Option<f64>,
    /// The file has given everything it has to the decoder.
    drained: bool,
}

struct Resampler {
    context: ff::software::resampling::Context,
    /// What it was made for, so a stream that changes format mid-way gets a
    /// new one.
    from: (ff::format::Sample, u64, u32),
}

impl AudioDecoder {
    /// The sound of the file at `path`, as `channels` channels at `rate`.
    /// `Ok(None)` when it has none: a silent video is still a video.
    pub fn open(path: &Path, rate: u32, channels: u16) -> Result<Option<Self>, String> {
        crate::services::video::ffmpeg::init();
        let input =
            ff::format::input(path).map_err(|error| format!("{}: {error}", path.display()))?;
        let Some(stream) = input.streams().best(ff::media::Type::Audio) else {
            return Ok(None);
        };
        let stream_index = stream.index();
        let time_base = f64::from(stream.time_base());
        let duration_seconds = if stream.duration() > 0 {
            Some(stream.duration() as f64 * time_base)
        } else if input.duration() > 0 {
            Some(input.duration() as f64 / f64::from(ff::ffi::AV_TIME_BASE))
        } else {
            None
        };
        let context = ff::codec::context::Context::from_parameters(stream.parameters())
            .map_err(|error| format!("{}: {error}", path.display()))?;
        let decoder = context
            .decoder()
            .audio()
            .map_err(|error| format!("{}: {error}", path.display()))?;
        Ok(Some(Self {
            input,
            stream_index,
            time_base,
            decoder,
            resampler: None,
            frame: ff::frame::Audio::empty(),
            rate,
            channels: channels.max(1),
            duration_seconds,
            next_seconds: None,
            skip_until: None,
            drained: false,
        }))
    }

    /// The whole file's length, when the container says.
    pub fn duration_seconds(&self) -> Option<f64> {
        self.duration_seconds
    }

    /// The next stretch of sound, or `None` at the end.
    pub fn next_chunk(&mut self) -> Result<Option<Chunk>, String> {
        loop {
            match self.decoder.receive_frame(&mut self.frame) {
                Ok(()) => {
                    if let Some(chunk) = self.convert()? {
                        return Ok(Some(chunk));
                    }
                }
                Err(ff::Error::Other { errno }) if errno == ff::ffi::EAGAIN => {
                    if self.drained {
                        return Ok(None);
                    }
                    self.feed()?;
                }
                Err(ff::Error::Eof) => return Ok(None),
                Err(error) => return Err(error.to_string()),
            }
        }
    }

    /// Move to `seconds`. The next chunk starts there.
    pub fn seek(&mut self, seconds: f64) -> Result<(), String> {
        let seconds = if seconds.is_finite() {
            seconds.max(0.0)
        } else {
            0.0
        };
        let timestamp = (seconds * f64::from(ff::ffi::AV_TIME_BASE)) as i64;
        self.input
            .seek(timestamp, i64::MIN..timestamp.saturating_add(1))
            .map_err(|error| error.to_string())?;
        self.decoder.flush();
        // What it still held belongs to where it was.
        self.resampler = None;
        self.drained = false;
        self.next_seconds = None;
        self.skip_until = Some(seconds);
        Ok(())
    }

    /// Hand the decoder the next packet of this stream, or tell it the file
    /// has ended.
    fn feed(&mut self) -> Result<(), String> {
        loop {
            let mut packet = ff::Packet::empty();
            match packet.read(&mut self.input) {
                Ok(()) => {
                    if packet.stream() != self.stream_index {
                        continue;
                    }
                    return match self.decoder.send_packet(&packet) {
                        // A damaged packet is skipped, as players do, rather
                        // than ending the sound.
                        Ok(()) | Err(ff::Error::InvalidData) => Ok(()),
                        Err(error) => Err(error.to_string()),
                    };
                }
                Err(ff::Error::Eof) => {
                    self.drained = true;
                    return self.decoder.send_eof().map_err(|error| error.to_string());
                }
                Err(error) => return Err(error.to_string()),
            }
        }
    }

    /// The decoded frame in the output's format, less anything before a seek's
    /// target. `None` when all of it was.
    fn convert(&mut self) -> Result<Option<Chunk>, String> {
        let samples = self.frame.samples();
        if samples == 0 {
            return Ok(None);
        }
        let format = self.frame.format();
        let layout = {
            let layout = self.frame.channel_layout();
            if layout.channels() > 0 && layout.bits() != 0 {
                layout
            } else {
                ff::ChannelLayout::default(i32::from(self.frame.channels()))
            }
        };
        let from = (format, layout.bits(), self.frame.rate());
        if self
            .resampler
            .as_ref()
            .is_none_or(|resampler| resampler.from != from)
        {
            let context = ff::software::resampling::Context::get(
                format,
                layout,
                self.frame.rate(),
                ff::format::Sample::F32(ff::format::sample::Type::Packed),
                ff::ChannelLayout::default(i32::from(self.channels)),
                self.rate,
            )
            .map_err(|error| format!("cannot convert this sound: {error}"))?;
            self.resampler = Some(Resampler { context, from });
        }
        let Some(resampler) = self.resampler.as_mut() else {
            return Ok(None);
        };

        let channels = usize::from(self.channels);
        // SAFETY: the context is live and initialised; `out` holds `capacity`
        // frames of packed float; `extended_data` points at the frame's planes,
        // each holding `samples` samples.
        let mut out = unsafe {
            let context = resampler.context.as_mut_ptr();
            let capacity = ff::ffi::swr_get_out_samples(context, samples as i32).max(0);
            let mut out = vec![0f32; capacity as usize * channels];
            let out_planes = [out.as_mut_ptr().cast::<u8>()];
            let written = ff::ffi::swr_convert(
                context,
                out_planes.as_ptr(),
                capacity,
                (*self.frame.as_ptr()).extended_data as *const *const u8,
                samples as i32,
            );
            if written < 0 {
                return Err(ff::Error::from(written).to_string());
            }
            out.truncate(written as usize * channels);
            out
        };

        let start = match self.next_seconds {
            Some(seconds) => seconds,
            None => self
                .frame
                .pts()
                .or(self.frame.timestamp())
                .map_or(self.skip_until.unwrap_or(0.0), |pts| {
                    pts as f64 * self.time_base
                }),
        };
        let frames = out.len() / channels;
        self.next_seconds = Some(start + frames as f64 / f64::from(self.rate));

        let mut start = start;
        if let Some(target) = self.skip_until {
            let end = start + frames as f64 / f64::from(self.rate);
            if end <= target {
                return Ok(None);
            }
            let drop =
                (((target - start) * f64::from(self.rate)).round().max(0.0) as usize).min(frames);
            out.drain(..drop * channels);
            start += drop as f64 / f64::from(self.rate);
            self.skip_until = None;
        }
        if out.is_empty() {
            return Ok(None);
        }
        // NaN marks a seek in the ring (`output.rs`), so none may come from
        // the file.
        for sample in &mut out {
            if !sample.is_finite() {
                *sample = 0.0;
            }
        }
        Ok(Some(Chunk {
            start_seconds: start,
            samples: out,
        }))
    }
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;

    /// A WAV of `seconds` of a 440 Hz tone: 16-bit mono at 44.1 kHz, so the
    /// decoder has to convert both the rate and the channels.
    pub(in crate::services::sound) fn tone(seconds: f64) -> std::path::PathBuf {
        let rate = 44_100u32;
        let frames = (f64::from(rate) * seconds) as u32;
        let mut wav = Vec::new();
        wav.extend_from_slice(b"RIFF");
        wav.extend_from_slice(&(36 + frames * 2).to_le_bytes());
        wav.extend_from_slice(b"WAVEfmt ");
        wav.extend_from_slice(&16u32.to_le_bytes());
        wav.extend_from_slice(&1u16.to_le_bytes());
        wav.extend_from_slice(&1u16.to_le_bytes());
        wav.extend_from_slice(&rate.to_le_bytes());
        wav.extend_from_slice(&(rate * 2).to_le_bytes());
        wav.extend_from_slice(&2u16.to_le_bytes());
        wav.extend_from_slice(&16u16.to_le_bytes());
        wav.extend_from_slice(b"data");
        wav.extend_from_slice(&(frames * 2).to_le_bytes());
        for frame in 0..frames {
            let value = (f64::from(frame) / f64::from(rate) * 440.0 * std::f64::consts::TAU).sin();
            wav.extend_from_slice(&((value * 12_000.0) as i16).to_le_bytes());
        }
        let path = std::env::temp_dir().join(format!(
            "present-sound-tone-{}-{seconds}.wav",
            std::process::id()
        ));
        std::fs::write(&path, wav).unwrap();
        path
    }

    fn decode_all(decoder: &mut AudioDecoder) -> (f64, usize) {
        let mut first = None;
        let mut samples = 0;
        while let Some(chunk) = decoder.next_chunk().unwrap() {
            first.get_or_insert(chunk.start_seconds);
            samples += chunk.samples.len();
        }
        (first.unwrap_or(f64::NAN), samples)
    }

    #[test]
    fn sound_comes_out_at_the_outputs_rate_and_channels() {
        let path = tone(2.0);
        let mut decoder = AudioDecoder::open(&path, 48_000, 2)
            .unwrap()
            .expect("it has sound");
        assert!((decoder.duration_seconds().unwrap() - 2.0).abs() < 0.01);
        let (start, samples) = decode_all(&mut decoder);
        assert!(start.abs() < 0.001, "starts at {start}");
        let frames = samples / 2;
        assert!(
            (frames as i64 - 96_000).abs() < 600,
            "{frames} frames for two seconds"
        );
        let _ = std::fs::remove_file(path);
    }

    #[test]
    fn a_seek_starts_the_sound_where_it_was_asked_for() {
        let path = tone(3.0);
        let mut decoder = AudioDecoder::open(&path, 48_000, 2).unwrap().unwrap();
        decoder.next_chunk().unwrap();
        decoder.seek(1.25).unwrap();
        let (start, samples) = decode_all(&mut decoder);
        assert!((start - 1.25).abs() < 0.002, "starts at {start}");
        let seconds = samples as f64 / 2.0 / 48_000.0;
        assert!(
            (seconds - 1.75).abs() < 0.02,
            "{seconds} seconds after the seek"
        );
        let _ = std::fs::remove_file(path);
    }

    #[test]
    fn a_file_that_is_not_media_is_refused() {
        let path = std::env::temp_dir().join(format!("present-sound-{}.mp4", std::process::id()));
        std::fs::write(&path, b"not a video").unwrap();
        assert!(AudioDecoder::open(&path, 48_000, 2).is_err());
        let _ = std::fs::remove_file(path);
    }
}
