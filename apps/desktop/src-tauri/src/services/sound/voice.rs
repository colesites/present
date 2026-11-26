//! The singers' voices, picked out of the band before the song agent's
//! speech service hears them.
//!
//! A microphone in the room hears the drums, the keys and the backing track
//! as loudly as the singers, and the service, hearing all of it, sent words
//! the singers never sang ("for disgust" for "for this gospel"). This runs
//! DeepFilterNet3 on this computer, in Rust (tract, no native libraries), the
//! same on every platform: a small network that keeps a voice and turns the
//! rest down, 10 ms at a time, about 40 ms behind the microphone.
//!
//! Measured against phone recordings of a worship song sung over its band
//! track, streamed to the service as the agent streams them: the agent's
//! speech model heard 34 of the song's words where it heard 29 unfiltered,
//! and 6 words that weren't the song's where it heard 7. Each 10 ms took
//! about 2.4 ms on a 2018 laptop's Intel i7.
//!
//! The band is turned down by at most `ATTENUATION_DB`, not taken away:
//! taken away entirely, it took some of the singing with it, and the service
//! heard fewer words (28) than with none taken (29).

use df::tract::{DfParams, DfTract, ReduceMask, RuntimeParams};
use ndarray::{Array2, ArrayView1};

/// The rate the filter works at.
pub const RATE: u32 = 48_000;

/// How far the band is turned down at most. Of 10, 18, 24, 30 and 100 dB,
/// 18 let the service hear the most words of the song, and fewest not in it.
const ATTENUATION_DB: f32 = 18.0;

/// The filter, and what it has been given that doesn't yet fill a frame.
pub struct VoiceFilter {
    model: DfTract,
    hop: usize,
    pending: Vec<f32>,
    noisy: Array2<f32>,
    clean: Array2<f32>,
    failed: bool,
}

impl VoiceFilter {
    /// The model, ready: about a quarter of a second to load.
    pub fn new() -> Result<Self, String> {
        // The thresholds are DeepFilterNet's own defaults for its command,
        // which the measurements above used.
        let params = RuntimeParams::new(1, 0.0, ATTENUATION_DB, -15.0, 35.0, 35.0, ReduceMask::NONE);
        let model = DfTract::new(DfParams::default(), &params)
            .map_err(|error| format!("the voice filter cannot start: {error}"))?;
        let hop = model.hop_size;
        Ok(Self {
            model,
            hop,
            pending: Vec::new(),
            noisy: Array2::zeros((1, hop)),
            clean: Array2::zeros((1, hop)),
            failed: false,
        })
    }

    /// `samples` at [`RATE`], -1 to 1, filtered: whole 10 ms frames out, what
    /// is left over kept for the next call. Should the model fail on a frame,
    /// the frame goes on as it was: the singing is never lost to the filter.
    pub fn filter(&mut self, samples: &[f32]) -> Vec<f32> {
        self.pending.extend_from_slice(samples);
        let frames = self.pending.len() / self.hop;
        let mut out = Vec::with_capacity(frames * self.hop);
        for frame in 0..frames {
            let heard = &self.pending[frame * self.hop..(frame + 1) * self.hop];
            self.noisy.row_mut(0).assign(&ArrayView1::from(heard));
            match self.model.process(self.noisy.view(), self.clean.view_mut()) {
                Ok(_) => out.extend(self.clean.iter().copied()),
                Err(error) => {
                    if !self.failed {
                        tracing::warn!(%error, "the voice filter failed on a frame; it is heard as it was");
                        self.failed = true;
                    }
                    out.extend_from_slice(heard);
                }
            }
        }
        self.pending.drain(..frames * self.hop);
        out
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn what_goes_in_comes_out_a_frame_at_a_time() {
        let mut filter = VoiceFilter::new().expect("the model loads");
        let tone: Vec<f32> = (0..RATE as usize)
            .map(|index| (index as f32 / RATE as f32 * 220.0 * std::f32::consts::TAU).sin() * 0.3)
            .collect();
        let mut out = 0;
        // As the microphone hands it over: uneven pieces.
        for piece in tone.chunks(1_234) {
            out += filter.filter(piece).len();
        }
        assert_eq!(out % 480, 0, "whole 10 ms frames");
        assert!(RATE as usize - out < 480, "all but what doesn't fill a frame: {out}");
    }
}
