//! The recording channel strip.
//!
//! Record level, automatic level control, and the noise gate are printed into
//! the take. Track volume and pan ([`TrackMix`]) are not: they are the mix. The compressor, equalizer, and sends are heard on input
//! monitoring and on playback and export; they are not baked into the take, so
//! moving a knob after the recording changes what you hear.

use serde::{Deserialize, Serialize};

/// What the smart controls are set to. Knobs are 0 to 100.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChannelStrip {
    pub record_level: f32,
    pub auto_level: bool,
    pub noise_gate: bool,
    pub noise_gate_amount: f32,
    pub monitor: bool,
    pub feedback_protection: bool,
    pub compressor: bool,
    pub compressor_amount: f32,
    pub eq: bool,
    pub eq_low: f32,
    pub eq_mid: f32,
    pub eq_high: f32,
    pub eq_low_cut: f32,
    pub eq_mid_freq: f32,
    pub ambience: f32,
    pub reverb: f32,
}

impl Default for ChannelStrip {
    fn default() -> Self {
        Self {
            record_level: 75.0,
            auto_level: false,
            noise_gate: false,
            noise_gate_amount: 35.0,
            monitor: false,
            feedback_protection: false,
            compressor: true,
            compressor_amount: 35.0,
            eq: true,
            eq_low: 50.0,
            eq_mid: 48.0,
            eq_high: 55.0,
            eq_low_cut: 20.0,
            eq_mid_freq: 60.0,
            ambience: 25.0,
            reverb: 40.0,
        }
    }
}

impl ChannelStrip {
    pub fn sanitized(self) -> Self {
        Self {
            record_level: unit(self.record_level),
            noise_gate_amount: unit(self.noise_gate_amount),
            compressor_amount: unit(self.compressor_amount),
            eq_low: unit(self.eq_low),
            eq_mid: unit(self.eq_mid),
            eq_high: unit(self.eq_high),
            eq_low_cut: unit(self.eq_low_cut),
            eq_mid_freq: unit(self.eq_mid_freq),
            ambience: unit(self.ambience),
            reverb: unit(self.reverb),
            ..self
        }
    }

    /// Playback and export color the take when any of these is in use.
    pub fn colors_playback(self) -> bool {
        self.compressor || self.eq || self.ambience > 0.5 || self.reverb > 0.5
    }
}

fn unit(value: f32) -> f32 {
    if value.is_finite() {
        value.clamp(0.0, 100.0)
    } else {
        0.0
    }
}

/// A track's place in the mix, as its header sets it. This is not the record
/// level: that is how loud the take is printed; this is how loud the track is
/// played back, monitored and exported, and moving it never rewrites the take.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TrackMix {
    /// Fader, in dB. [`SILENT_DB`] and below is off.
    pub volume_db: f32,
    /// -1 is hard left, 0 the middle, 1 hard right.
    pub pan: f32,
    pub mute: bool,
    pub solo: bool,
}

/// The fader's bottom: anything at or below this is silence.
pub const SILENT_DB: f32 = -96.0;
/// The fader's top, as GarageBand's.
pub const MAX_DB: f32 = 6.0;

impl Default for TrackMix {
    fn default() -> Self {
        Self {
            volume_db: 0.0,
            pan: 0.0,
            mute: false,
            solo: false,
        }
    }
}

impl TrackMix {
    pub fn sanitized(self) -> Self {
        Self {
            volume_db: if self.volume_db.is_finite() {
                self.volume_db.clamp(SILENT_DB, MAX_DB)
            } else {
                SILENT_DB
            },
            pan: if self.pan.is_finite() {
                self.pan.clamp(-1.0, 1.0)
            } else {
                0.0
            },
            ..self
        }
    }

    /// The fader as a multiplier.
    pub fn gain(self) -> f32 {
        if self.volume_db <= SILENT_DB {
            0.0
        } else {
            10.0_f32.powf(self.volume_db / 20.0)
        }
    }

    /// Heard at all, given whether any track is soloed.
    pub fn audible(self, any_solo: bool) -> bool {
        !self.mute && (!any_solo || self.solo)
    }
}

/// Left and right gains for `pan`, the same law the window's playback uses
/// (Web Audio's `StereoPannerNode`) so what plays is what exports.
///
/// A mono take is lifted by √2, so in the middle it is as loud on each side as
/// it was recorded. A stereo take is balanced: the middle leaves it alone.
pub fn pan_frame(frame: &[f32], pan: f32, gain: f32) -> (f32, f32) {
    let pan = pan.clamp(-1.0, 1.0);
    match frame {
        [] => (0.0, 0.0),
        [mono] => {
            let x = (pan + 1.0) / 2.0 * std::f32::consts::FRAC_PI_2;
            let lift = std::f32::consts::SQRT_2 * gain;
            (mono * x.cos() * lift, mono * x.sin() * lift)
        }
        [left, right, ..] => {
            if pan <= 0.0 {
                let x = (pan + 1.0) * std::f32::consts::FRAC_PI_2;
                ((left + right * x.cos()) * gain, right * x.sin() * gain)
            } else {
                let x = pan * std::f32::consts::FRAC_PI_2;
                (left * x.cos() * gain, (right + left * x.sin()) * gain)
            }
        }
    }
}

/// Level control and noise-gate memory for one capture.
#[derive(Clone, Copy)]
pub struct InputRider {
    /// Automatic level control's cut, 0 to 1. It only ever lowers the level,
    /// so it never brings up the room's noise.
    alc: f32,
    /// The gate's detector: a fast-attack, slow-release follower, so it
    /// tracks the voice and not each swing of the waveform.
    envelope: f32,
    /// The gate's own gain, ramped so it never clicks.
    gate: f32,
    /// Samples left before a gate that has gone quiet starts to close.
    hold: u32,
    rate: f32,
}

impl InputRider {
    pub fn new(rate: u32) -> Self {
        Self {
            alc: 1.0,
            envelope: 0.0,
            gate: 1.0,
            hold: 0,
            rate: rate.max(8_000) as f32,
        }
    }

    /// A one-pole coefficient for a time constant in seconds.
    fn coefficient(&self, seconds: f32) -> f32 {
        1.0 - (-1.0 / (seconds * self.rate)).exp()
    }
}

/// The record level as a multiplier: 50 is as the microphone gives it, 100 is
/// +6 dB, 0 is off.
pub fn record_gain(strip: &ChannelStrip) -> f32 {
    (strip.record_level / 50.0).clamp(0.0, 2.0)
}

/// The gate's threshold for its slider: -80 dB at 0, -20 dB at 100.
pub fn gate_threshold(amount: f32) -> f32 {
    let db = -80.0 + amount.clamp(0.0, 100.0) * 0.6;
    10.0_f32.powf(db / 20.0)
}

/// One frame of input after record level, automatic level control, and the
/// gate, in place. This is what gets stored.
pub fn ride(frame: &mut [f32], rider: &mut InputRider, strip: &ChannelStrip) {
    let gain = record_gain(strip);
    let mut level = 0.0f32;
    for sample in frame.iter_mut() {
        *sample = finite(*sample) * gain;
        level = level.max(sample.abs());
    }

    if strip.auto_level {
        // Keep peaks under -3 dBFS: cut fast, give it back over a few seconds.
        let ceiling = 0.708;
        let wanted = if level * rider.alc > ceiling {
            ceiling / level
        } else {
            1.0
        };
        let speed = if wanted < rider.alc {
            rider.coefficient(0.002)
        } else {
            rider.coefficient(2.5)
        };
        rider.alc += (wanted - rider.alc) * speed;
        rider.alc = rider.alc.clamp(0.05, 1.0);
        level *= rider.alc;
        for sample in frame.iter_mut() {
            *sample *= rider.alc;
        }
    } else {
        rider.alc = 1.0;
    }

    if strip.noise_gate {
        let follow = if level > rider.envelope {
            rider.coefficient(0.001)
        } else {
            rider.coefficient(0.060)
        };
        rider.envelope += (level - rider.envelope) * follow;
        let open_at = gate_threshold(strip.noise_gate_amount);
        // 6 dB of hysteresis, so a voice hovering at the line does not chatter.
        let close_at = open_at * 0.5;
        let target = if rider.envelope >= open_at {
            rider.hold = (rider.rate * 0.12) as u32;
            1.0
        } else if rider.envelope >= close_at || rider.hold > 0 {
            rider.hold = rider.hold.saturating_sub(1);
            if rider.gate > 0.5 {
                1.0
            } else {
                0.0
            }
        } else {
            0.0
        };
        let speed = if target > rider.gate {
            rider.coefficient(0.002)
        } else {
            rider.coefficient(0.100)
        };
        rider.gate += (target - rider.gate) * speed;
        for sample in frame.iter_mut() {
            *sample *= rider.gate;
        }
    } else {
        rider.gate = 1.0;
        rider.envelope = level;
    }

    for sample in frame.iter_mut() {
        *sample = sample.clamp(-1.0, 1.0);
    }
}

/// Listens to what is being monitored for howl: a loud, steady, near-pure
/// tone, which is what speakers feeding back into the microphone sound like.
/// A voice is too uneven, even a loud one.
pub struct FeedbackWatch {
    window: usize,
    count: usize,
    sum_squares: f32,
    peak: f32,
    /// Windows in a row that sounded like howl.
    streak: u32,
}

impl FeedbackWatch {
    pub fn new(rate: u32) -> Self {
        Self {
            window: (rate.max(8_000) / 20) as usize,
            count: 0,
            sum_squares: 0.0,
            peak: 0.0,
            streak: 0,
        }
    }

    /// One monitored sample. True once feedback has been heard.
    pub fn hear(&mut self, sample: f32) -> bool {
        self.sum_squares += sample * sample;
        self.peak = self.peak.max(sample.abs());
        self.count += 1;
        if self.count < self.window {
            return false;
        }
        let rms = (self.sum_squares / self.count as f32).sqrt();
        let crest = if rms > 0.0 { self.peak / rms } else { f32::MAX };
        // -14 dBFS and a crest under 2 (a sine is 1.41; speech is 4 or more),
        // or sitting at full scale.
        let howl = (rms > 0.2 && crest < 2.0) || rms > 0.7;
        self.streak = if howl { self.streak + 1 } else { 0 };
        self.count = 0;
        self.sum_squares = 0.0;
        self.peak = 0.0;
        // Six windows: 300 ms.
        self.streak >= 6
    }

    pub fn reset(&mut self) {
        self.streak = 0;
    }
}

/// Compressor, equalizer, ambience, and reverb over a whole take.
pub fn shape(samples: &[f32], channels: u16, rate: u32, strip: &ChannelStrip) -> Vec<f32> {
    let width = usize::from(channels.max(1));
    if samples.is_empty() || width == 0 {
        return Vec::new();
    }
    if !strip.colors_playback() {
        return samples.to_vec();
    }
    let mut voice = Voice::new(width, rate.max(1));
    let mut out = Vec::with_capacity(samples.len());
    for frame in samples.chunks(width) {
        for (channel, sample) in frame.iter().enumerate() {
            out.push(voice.process(channel, *sample, strip));
        }
    }
    out
}

pub struct Voice {
    rate: u32,
    channels: Vec<ChannelVoice>,
    tuned: Option<ChannelStrip>,
}

struct ChannelVoice {
    low_cut: Biquad,
    low: Biquad,
    mid: Biquad,
    high: Biquad,
    comp_env: f32,
    ambience: Delay,
    combs: [Delay; 4],
    allpass: Delay,
}

impl Voice {
    pub fn new(channels: usize, rate: u32) -> Self {
        let rate = rate.max(8_000);
        let channels = channels.max(1);
        Self {
            rate,
            channels: (0..channels)
                .map(|index| ChannelVoice::new(rate, index))
                .collect(),
            tuned: None,
        }
    }

    pub fn process(&mut self, channel: usize, sample: f32, strip: &ChannelStrip) -> f32 {
        if self.tuned != Some(*strip) {
            self.design(strip);
            self.tuned = Some(*strip);
        }
        let index = channel % self.channels.len();
        let voice = &mut self.channels[index];
        let mut dry = finite(sample);
        if strip.compressor {
            dry = compress(dry, &mut voice.comp_env, strip.compressor_amount);
        }
        if strip.eq {
            dry = voice.low_cut.process(dry);
            dry = voice.low.process(dry);
            dry = voice.mid.process(dry);
            dry = voice.high.process(dry);
        }
        let mut wet = 0.0;
        if strip.ambience > 0.5 {
            let echo = voice.ambience.comb(dry, 0.32);
            wet += echo * (strip.ambience / 100.0) * 0.55;
        }
        if strip.reverb > 0.5 {
            let mut tank = 0.0;
            for comb in &mut voice.combs {
                tank += comb.comb(dry, 0.7);
            }
            tank *= 0.25;
            tank = voice.allpass.allpass(tank, 0.5);
            wet += tank * (strip.reverb / 100.0) * 0.65;
        }
        (dry + wet).clamp(-1.0, 1.0)
    }

    fn design(&mut self, strip: &ChannelStrip) {
        let rate = self.rate as f32;
        let low_cut_hz = 28.0 + (strip.eq_low_cut / 100.0).powi(2) * 520.0;
        let mid_hz = 180.0 * (12_000.0_f32 / 180.0).powf(strip.eq_mid_freq / 100.0);
        let low_db = (strip.eq_low - 50.0) / 50.0 * 12.0;
        let mid_db = (strip.eq_mid - 50.0) / 50.0 * 12.0;
        let high_db = (strip.eq_high - 50.0) / 50.0 * 12.0;
        for voice in &mut self.channels {
            voice.low_cut = Biquad::highpass(rate, low_cut_hz, 0.707);
            voice.low = Biquad::lowshelf(rate, 180.0, low_db);
            voice.mid = Biquad::peak(rate, mid_hz, mid_db, 1.0);
            voice.high = Biquad::highshelf(rate, 6_500.0, high_db);
        }
    }
}

impl ChannelVoice {
    fn new(rate: u32, index: usize) -> Self {
        let ms = |millis: f32| ((rate as f32) * millis / 1000.0).max(2.0) as usize;
        let spread = index as f32 * 1.7;
        Self {
            low_cut: Biquad::passthrough(),
            low: Biquad::passthrough(),
            mid: Biquad::passthrough(),
            high: Biquad::passthrough(),
            comp_env: 0.0,
            ambience: Delay::new(ms(38.0 + spread)),
            combs: [
                Delay::new(ms(29.0 + spread)),
                Delay::new(ms(37.0 + spread)),
                Delay::new(ms(41.0 + spread)),
                Delay::new(ms(47.0 + spread)),
            ],
            allpass: Delay::new(ms(5.5 + spread)),
        }
    }
}

fn compress(sample: f32, envelope: &mut f32, amount: f32) -> f32 {
    let level = sample.abs();
    let follow = if level > *envelope { 0.04 } else { 0.002 };
    *envelope += (level - *envelope) * follow;
    let threshold = 0.22;
    let ratio = 1.0 + (amount / 100.0) * 7.0;
    let over = (*envelope / threshold).max(1.0);
    let reduction = over.powf(1.0 / ratio - 1.0);
    let makeup = 1.0 + (amount / 100.0) * 0.75;
    (sample * reduction * makeup).clamp(-1.0, 1.0)
}

fn finite(sample: f32) -> f32 {
    if sample.is_finite() {
        sample
    } else {
        0.0
    }
}

#[derive(Clone, Copy)]
struct Biquad {
    b0: f32,
    b1: f32,
    b2: f32,
    a1: f32,
    a2: f32,
    x1: f32,
    x2: f32,
    y1: f32,
    y2: f32,
}

impl Biquad {
    fn passthrough() -> Self {
        Self::from_coeffs(1.0, 0.0, 0.0, 1.0, 0.0, 0.0)
    }

    fn from_coeffs(b0: f32, b1: f32, b2: f32, a0: f32, a1: f32, a2: f32) -> Self {
        let a0 = if a0.abs() < 1.0e-8 { 1.0 } else { a0 };
        Self {
            b0: b0 / a0,
            b1: b1 / a0,
            b2: b2 / a0,
            a1: a1 / a0,
            a2: a2 / a0,
            x1: 0.0,
            x2: 0.0,
            y1: 0.0,
            y2: 0.0,
        }
    }

    fn process(&mut self, x: f32) -> f32 {
        let y = self.b0 * x + self.b1 * self.x1 + self.b2 * self.x2
            - self.a1 * self.y1
            - self.a2 * self.y2;
        self.x2 = self.x1;
        self.x1 = x;
        self.y2 = self.y1;
        self.y1 = y;
        if y.is_finite() {
            y
        } else {
            0.0
        }
    }

    fn highpass(rate: f32, freq: f32, q: f32) -> Self {
        let (_sin, cos, alpha) = omega(rate, freq, q);
        let b0 = (1.0 + cos) / 2.0;
        let b1 = -(1.0 + cos);
        let b2 = (1.0 + cos) / 2.0;
        Self::from_coeffs(b0, b1, b2, 1.0 + alpha, -2.0 * cos, 1.0 - alpha)
    }

    fn lowshelf(rate: f32, freq: f32, gain_db: f32) -> Self {
        if gain_db.abs() < 0.15 {
            return Self::passthrough();
        }
        let a = 10.0_f32.powf(gain_db / 40.0);
        let (sin, cos, _) = omega(rate, freq, 0.707);
        let alpha = sin / 2.0 * ((a + 1.0 / a) * (1.0 / 0.707 - 1.0) + 2.0).sqrt();
        let two = 2.0 * a.sqrt() * alpha;
        let b0 = a * ((a + 1.0) - (a - 1.0) * cos + two);
        let b1 = 2.0 * a * ((a - 1.0) - (a + 1.0) * cos);
        let b2 = a * ((a + 1.0) - (a - 1.0) * cos - two);
        let a0 = (a + 1.0) + (a - 1.0) * cos + two;
        let a1 = -2.0 * ((a - 1.0) + (a + 1.0) * cos);
        let a2 = (a + 1.0) + (a - 1.0) * cos - two;
        Self::from_coeffs(b0, b1, b2, a0, a1, a2)
    }

    fn highshelf(rate: f32, freq: f32, gain_db: f32) -> Self {
        if gain_db.abs() < 0.15 {
            return Self::passthrough();
        }
        let a = 10.0_f32.powf(gain_db / 40.0);
        let (sin, cos, _) = omega(rate, freq, 0.707);
        let alpha = sin / 2.0 * ((a + 1.0 / a) * (1.0 / 0.707 - 1.0) + 2.0).sqrt();
        let two = 2.0 * a.sqrt() * alpha;
        let b0 = a * ((a + 1.0) + (a - 1.0) * cos + two);
        let b1 = -2.0 * a * ((a - 1.0) + (a + 1.0) * cos);
        let b2 = a * ((a + 1.0) + (a - 1.0) * cos - two);
        let a0 = (a + 1.0) - (a - 1.0) * cos + two;
        let a1 = 2.0 * ((a - 1.0) - (a + 1.0) * cos);
        let a2 = (a + 1.0) - (a - 1.0) * cos - two;
        Self::from_coeffs(b0, b1, b2, a0, a1, a2)
    }

    fn peak(rate: f32, freq: f32, gain_db: f32, q: f32) -> Self {
        if gain_db.abs() < 0.15 {
            return Self::passthrough();
        }
        let a = 10.0_f32.powf(gain_db / 40.0);
        let (_sin, cos, alpha) = omega(rate, freq, q);
        Self::from_coeffs(
            1.0 + alpha * a,
            -2.0 * cos,
            1.0 - alpha * a,
            1.0 + alpha / a,
            -2.0 * cos,
            1.0 - alpha / a,
        )
    }
}

fn omega(rate: f32, freq: f32, q: f32) -> (f32, f32, f32) {
    let freq = freq.clamp(20.0, rate * 0.45);
    let w0 = 2.0 * std::f32::consts::PI * freq / rate;
    let sin = w0.sin();
    let cos = w0.cos();
    let alpha = sin / (2.0 * q.max(0.1));
    (sin, cos, alpha)
}

struct Delay {
    buf: Vec<f32>,
    at: usize,
}

impl Delay {
    fn new(samples: usize) -> Self {
        Self {
            buf: vec![0.0; samples.max(2)],
            at: 0,
        }
    }

    fn comb(&mut self, input: f32, feedback: f32) -> f32 {
        let out = self.buf[self.at];
        self.buf[self.at] = input + out * feedback;
        self.at = (self.at + 1) % self.buf.len();
        out
    }

    fn allpass(&mut self, input: f32, feedback: f32) -> f32 {
        let delayed = self.buf[self.at];
        let out = -input + delayed;
        self.buf[self.at] = input + delayed * feedback;
        self.at = (self.at + 1) % self.buf.len();
        out
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn dry() -> ChannelStrip {
        ChannelStrip {
            compressor: false,
            eq: false,
            ambience: 0.0,
            reverb: 0.0,
            ..ChannelStrip::default()
        }
    }

    fn ride_one(sample: f32, rider: &mut InputRider, strip: &ChannelStrip) -> f32 {
        let mut frame = [sample];
        ride(&mut frame, rider, strip);
        frame[0]
    }

    #[test]
    fn record_level_scales_what_is_printed() {
        let mut rider = InputRider::new(48_000);
        let mut strip = dry();
        strip.record_level = 0.0;
        assert_eq!(ride_one(0.5, &mut rider, &strip), 0.0);
        strip.record_level = 50.0;
        let unity = ride_one(0.4, &mut rider, &strip);
        assert!((unity - 0.4).abs() < 0.001, "{unity}");
        strip.record_level = 100.0;
        let hot = ride_one(0.4, &mut rider, &strip);
        assert!((hot - 0.8).abs() < 0.001, "{hot}");
    }

    #[test]
    fn automatic_level_control_keeps_a_loud_signal_from_clipping_and_leaves_a_quiet_one() {
        let mut rider = InputRider::new(48_000);
        let mut strip = dry();
        strip.auto_level = true;
        strip.record_level = 100.0;
        let mut last = 0.0;
        for index in 0..48_000 {
            let sample = if index % 2 == 0 { 0.9 } else { -0.9 };
            last = ride_one(sample, &mut rider, &strip).abs();
        }
        assert!(last < 0.75, "rode to {last}");
        let mut rider = InputRider::new(48_000);
        let quiet = ride_one(0.01, &mut rider, &strip);
        assert!(
            (quiet - 0.02).abs() < 0.001,
            "a quiet input is not lifted: {quiet}"
        );
    }

    fn tone(
        rider: &mut InputRider,
        strip: &ChannelStrip,
        amplitude: f32,
        samples: usize,
    ) -> Vec<f32> {
        (0..samples)
            .map(|index| {
                let x = (index as f32 * 2.0 * std::f32::consts::PI * 220.0 / 48_000.0).sin();
                ride_one(x * amplitude, rider, strip)
            })
            .collect()
    }

    #[test]
    fn the_noise_gate_closes_on_hiss_and_stays_open_through_a_voice() {
        let mut rider = InputRider::new(48_000);
        let mut strip = dry();
        strip.record_level = 50.0;
        strip.noise_gate = true;
        strip.noise_gate_amount = 35.0; // -59 dB
                                        // A note, well over the line: every cycle passes through zero, and
                                        // the gate must not shut on those.
        let note = tone(&mut rider, &strip, 0.3, 48_000);
        let late = &note[24_000..];
        let peak = late.iter().fold(0.0f32, |a, b| a.max(b.abs()));
        assert!(peak > 0.29, "the note was cut to {peak}");
        let gaps = late
            .windows(240)
            .filter(|w| w.iter().all(|s| s.abs() < 1e-4))
            .count();
        assert_eq!(gaps, 0, "the gate chattered");
        // Hiss under the line fades to nothing.
        // Hiss at -74 dB, well under the line, is gone within a second.
        let hiss = tone(&mut rider, &strip, 0.0002, 72_000);
        let tail = hiss[48_000..].iter().fold(0.0f32, |a, b| a.max(b.abs()));
        assert!(tail < 1e-5, "hiss left at {tail}");
    }

    #[test]
    fn the_noise_gate_does_not_click_when_it_closes() {
        let mut rider = InputRider::new(48_000);
        let mut strip = dry();
        strip.noise_gate = true;
        strip.noise_gate_amount = 50.0;
        let mut out = tone(&mut rider, &strip, 0.3, 24_000);
        out.extend(tone(&mut rider, &strip, 0.0, 24_000));
        let jump = out
            .windows(2)
            .map(|w| (w[1] - w[0]).abs())
            .fold(0.0f32, f32::max);
        // A 220 Hz tone at 0.3 moves at most ~0.009 a sample.
        assert!(jump < 0.02, "a step of {jump}");
    }

    #[test]
    fn a_howl_is_heard_as_feedback_and_a_voice_is_not() {
        let mut watch = FeedbackWatch::new(48_000);
        let howl = (0..48_000).any(|index| watch.hear((index as f32 * 0.06).sin() * 0.6));
        assert!(howl);
        let mut watch = FeedbackWatch::new(48_000);
        // A loud, uneven signal: bursts with gaps, like speech.
        let voice = (0..96_000).any(|index| {
            let burst = if (index / 2_400) % 3 == 0 { 0.0 } else { 1.0 };
            let x = (index as f32 * 0.05).sin() * (index as f32 * 0.0007).sin().abs();
            watch.hear(x * 0.8 * burst)
        });
        assert!(!voice);
    }

    #[test]
    fn the_middle_keeps_a_mono_take_as_loud_and_the_sides_take_it_all() {
        let (left, right) = pan_frame(&[0.5], 0.0, 1.0);
        assert!(
            (left - 0.5).abs() < 1e-4 && (right - 0.5).abs() < 1e-4,
            "{left} {right}"
        );
        let (left, right) = pan_frame(&[0.5], -1.0, 1.0);
        assert!(left > 0.7 && right.abs() < 1e-4, "{left} {right}");
        let (left, right) = pan_frame(&[0.5, 0.25], 0.0, 0.5);
        assert!((left - 0.25).abs() < 1e-4 && (right - 0.125).abs() < 1e-4);
    }

    #[test]
    fn the_fader_is_in_decibels_and_its_bottom_is_off() {
        let mix = |volume_db| TrackMix {
            volume_db,
            ..TrackMix::default()
        };
        assert!((mix(0.0).gain() - 1.0).abs() < 1e-6);
        assert!((mix(-6.0).gain() - 0.501).abs() < 1e-3);
        assert_eq!(mix(SILENT_DB).gain(), 0.0);
        assert_eq!(mix(40.0).sanitized().volume_db, MAX_DB);
    }

    #[test]
    fn an_idle_strip_does_not_rewrite_the_take() {
        let tone = [0.2, -0.2, 0.2, -0.2];
        let out = shape(&tone, 1, 48_000, &dry());
        assert_eq!(out, tone);
    }

    #[test]
    fn the_compressor_pulls_a_hot_tone_down() {
        let mut strip = dry();
        strip.compressor = true;
        strip.compressor_amount = 100.0;
        let hot = vec![0.95; 4_000];
        let out = shape(&hot, 1, 48_000, &strip);
        let last = out[out.len() - 1];
        assert!(last < 0.75 && last > 0.05, "{last}");
    }

    #[test]
    fn reverb_keeps_ringing_after_a_click() {
        let mut strip = dry();
        strip.reverb = 100.0;
        let mut click = vec![0.0; 8_000];
        click[0] = 1.0;
        let out = shape(&click, 1, 48_000, &strip);
        let tail: f32 = out[2_000..].iter().map(|sample| sample.abs()).sum();
        assert!(tail > 0.5, "{tail}");
    }
}
