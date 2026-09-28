//! The video modes a sent output is made in: an NDI source's and an SDI
//! card's size and rate, named as ProPresenter names them ("1080p29.97",
//! "4Kp30"). NDI offers ProPresenter's list, SDI every mode here.
//!
//! Each is stored by Blackmagic's four-character code, which SDI hands to the
//! card as it is (`DeckLinkAPIModes.h`).

/// A size and a rate.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct VideoMode {
    pub code: &'static str,
    pub label: &'static str,
    pub width: u32,
    pub height: u32,
    /// Frames a second, as a fraction. Interlaced modes count frames, not
    /// fields: 1080i59.94 is 29.97 frames a second.
    pub rate: (u32, u32),
    pub interlaced: bool,
}

impl VideoMode {
    pub fn size(&self) -> (u32, u32) {
        (self.width, self.height)
    }

    /// The code as the `BMDDisplayMode` it spells.
    pub fn fourcc(&self) -> u32 {
        self.code
            .bytes()
            .fold(0u32, |value, byte| (value << 8) | u32::from(byte))
    }

    /// Whole frames a second, rounded up, for a send loop's pace.
    pub fn frames_per_second(&self) -> u32 {
        self.rate.0.div_ceil(self.rate.1.max(1))
    }
}

const fn progressive(
    code: &'static str,
    label: &'static str,
    width: u32,
    height: u32,
    rate: (u32, u32),
) -> VideoMode {
    VideoMode {
        code,
        label,
        width,
        height,
        rate,
        interlaced: false,
    }
}

const fn interlaced(code: &'static str, label: &'static str, rate: (u32, u32)) -> VideoMode {
    VideoMode {
        code,
        label,
        width: 1920,
        height: 1080,
        rate,
        interlaced: true,
    }
}

pub const VIDEO_MODES: &[VideoMode] = &[
    progressive("hp50", "720p50", 1280, 720, (50, 1)),
    progressive("hp59", "720p59.94", 1280, 720, (60_000, 1001)),
    progressive("hp60", "720p60", 1280, 720, (60, 1)),
    progressive("23ps", "1080p23.98", 1920, 1080, (24_000, 1001)),
    progressive("24ps", "1080p24", 1920, 1080, (24, 1)),
    progressive("Hp25", "1080p25", 1920, 1080, (25, 1)),
    progressive("Hp29", "1080p29.97", 1920, 1080, (30_000, 1001)),
    progressive("Hp30", "1080p30", 1920, 1080, (30, 1)),
    interlaced("Hi50", "1080i50", (25, 1)),
    interlaced("Hi59", "1080i59.94", (30_000, 1001)),
    interlaced("Hi60", "1080i60", (30, 1)),
    progressive("Hp50", "1080p50", 1920, 1080, (50, 1)),
    progressive("Hp59", "1080p59.94", 1920, 1080, (60_000, 1001)),
    progressive("Hp60", "1080p60", 1920, 1080, (60, 1)),
    progressive("4k25", "4Kp25", 3840, 2160, (25, 1)),
    progressive("4k29", "4Kp29.97", 3840, 2160, (30_000, 1001)),
    progressive("4k30", "4Kp30", 3840, 2160, (30, 1)),
    progressive("4k50", "4Kp50", 3840, 2160, (50, 1)),
    progressive("4k59", "4Kp59.94", 3840, 2160, (60_000, 1001)),
    progressive("4k60", "4Kp60", 3840, 2160, (60, 1)),
];

/// The modes an NDI output is offered, ProPresenter's list.
pub const NDI_MODES: &[&str] = &[
    "hp59", "Hp30", "Hi50", "Hi59", "Hp50", "Hp59", "Hp60", "4k25", "4k30", "4k50", "4k60",
];

/// An NDI output with no mode chosen: 1080p30, as NDI outputs have always
/// been sent.
pub const NDI_DEFAULT: &str = "Hp30";
/// An SDI output with no mode chosen.
pub const SDI_DEFAULT: &str = "Hp29";

pub fn video_mode(code: &str) -> Option<VideoMode> {
    VIDEO_MODES.iter().copied().find(|mode| mode.code == code)
}

/// `code`'s mode, or `default`'s when it names none.
pub fn video_mode_or(code: Option<&str>, default: &str) -> VideoMode {
    code.and_then(video_mode)
        .or_else(|| video_mode(default))
        .unwrap_or(VIDEO_MODES[0])
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_mode_code_spells_its_decklink_value() {
        // 'Hp29', '4k60' and '23ps' as DeckLinkAPIModes.h has them.
        assert_eq!(
            video_mode("Hp29").map(|mode| mode.fourcc()),
            Some(0x4870_3239)
        );
        assert_eq!(
            video_mode("4k60").map(|mode| mode.fourcc()),
            Some(0x346B_3630)
        );
        assert_eq!(
            video_mode("23ps").map(|mode| mode.fourcc()),
            Some(0x3233_7073)
        );
    }

    #[test]
    fn every_mode_is_listed_once_and_ndi_offers_known_ones() {
        for (index, mode) in VIDEO_MODES.iter().enumerate() {
            assert_eq!(mode.code.len(), 4, "{} is a four-character code", mode.code);
            assert!(
                VIDEO_MODES[index + 1..]
                    .iter()
                    .all(|other| other.code != mode.code),
                "{} is listed twice",
                mode.code
            );
        }
        for code in NDI_MODES {
            assert!(video_mode(code).is_some(), "{code} is a mode");
        }
        assert!(NDI_MODES.contains(&NDI_DEFAULT));
    }

    #[test]
    fn an_unknown_mode_falls_back_to_the_default() {
        assert_eq!(video_mode_or(None, SDI_DEFAULT).label, "1080p29.97");
        assert_eq!(video_mode_or(Some("nope"), NDI_DEFAULT).label, "1080p30");
        let interlaced = video_mode_or(Some("Hi50"), SDI_DEFAULT);
        assert!(interlaced.interlaced);
        assert_eq!(interlaced.frames_per_second(), 25);
        assert_eq!(
            video_mode_or(Some("hp59"), SDI_DEFAULT).frames_per_second(),
            60
        );
    }
}
