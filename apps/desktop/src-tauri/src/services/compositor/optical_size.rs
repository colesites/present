//! Setting a variable font at the optical size it is drawn at.
//!
//! Inter — the default for scripture and lyrics — is a variable font with an
//! optical-size (`opsz`) axis: a text cut for small sizes and a tighter display
//! cut for large ones. Chromium on macOS sets it automatically at the size being
//! drawn, in both HTML and Canvas, clamped to the axis. Measured in Chrome at
//! 96 px, "For God so loved the world" is 1115.9 px wide; with the axis held
//! at 14 it is 1221.8 px.
//!
//! cosmic-text applies only the weight axis, so it set every size in the text
//! cut: nine percent wider than the audience window at slide sizes, which is
//! enough to break a verse's lines in different places on the stream. So here a
//! face with an `opsz` axis is instanced — `allsorts` produces a static font at
//! the chosen weight and optical size, 13 ms each — and registered under a name
//! of its own that the text code asks for instead. The instance of Inter at 96 px
//! measures 1115.4 px against Chromium's 1115.9.
//!
//! Instances are keyed on the whole pixel size, and every size at or past the
//! axis maximum shares one, so slide text overwhelmingly uses a single instance
//! per weight.
//!
//! What the instance leaves out: `allsorts` copies `GPOS` without applying its
//! variations, so kerning stays at the font's default optical size. Advance
//! widths — what decides where a line breaks — are instanced.

use std::collections::{HashMap, HashSet};
use std::sync::Arc;

use allsorts::binary::read::ReadScope;
use allsorts::font_data::FontData;
use allsorts::tables::variable_fonts::fvar::FvarTable;
use allsorts::tables::{Fixed, FontTableProvider};
use allsorts::tag;
use cosmic_text::fontdb::{self, FaceInfo, Language, Query, Source};
use cosmic_text::{FontSystem, Weight};

/// Which faces have been looked at, and the instances made from them.
#[derive(Default)]
pub struct OpticalSizes {
    /// Faces with no optical-size axis, or that could not be instanced, so they
    /// are not read again.
    plain: HashSet<fontdb::ID>,
    /// (face, weight, optical size) → the family name the instance answers to.
    instances: HashMap<(fontdb::ID, u16, u16), String>,
}

/// An axis the instance has to pin, in `fvar` order.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Axis {
    pub tag: u32,
    pub min: f32,
    pub default: f32,
    pub max: f32,
}

/// The optical size to set `font_size` at on an axis running `min..=max`.
pub fn optical_size_for(font_size: f32, min: f32, max: f32) -> u16 {
    let size = if font_size.is_finite() {
        font_size.round()
    } else {
        min
    };
    size.clamp(min.max(1.0), max.max(min.max(1.0))) as u16
}

/// The coordinates to instance at: the optical size, the weight clamped to its
/// axis, and every other axis at its default.
pub fn coordinates(axes: &[Axis], weight: u16, optical_size: u16) -> Vec<f32> {
    axes.iter()
        .map(|axis| match axis.tag {
            tag::OPSZ => f32::from(optical_size).clamp(axis.min, axis.max),
            tag::WGHT => f32::from(weight).clamp(axis.min, axis.max),
            _ => axis.default,
        })
        .collect()
}

fn axes_of(provider: &impl FontTableProvider) -> Option<Vec<Axis>> {
    let data = provider.table_data(tag::FVAR).ok()??;
    let fvar = ReadScope::new(&data).read::<FvarTable<'_>>().ok()?;
    Some(
        fvar.axes()
            .map(|axis| Axis {
                tag: axis.axis_tag,
                min: f32::from(axis.min_value),
                default: f32::from(axis.default_value),
                max: f32::from(axis.max_value),
            })
            .collect(),
    )
}

impl OpticalSizes {
    /// The family to ask cosmic-text for so `family` is set at the optical size
    /// of `font_size`, or `None` to use `family` as it is.
    pub fn family_for(
        &mut self,
        system: &mut FontSystem,
        family: &str,
        weight: Weight,
        italic: bool,
        font_size: f32,
    ) -> Option<String> {
        let id = system.db().query(&Query {
            families: &[fontdb::Family::Name(family)],
            weight: fontdb::Weight(weight.0),
            stretch: fontdb::Stretch::Normal,
            style: if italic {
                fontdb::Style::Italic
            } else {
                fontdb::Style::Normal
            },
        })?;
        if self.plain.contains(&id) {
            return None;
        }

        // The axes first, cheaply, so a static font is known to be one before
        // anything is instanced — and never read again.
        let axes = system
            .db()
            .with_face_data(id, |data, index| {
                let scope = ReadScope::new(data);
                let font = scope.read::<FontData<'_>>().ok()?;
                let provider = font.table_provider(index as usize).ok()?;
                axes_of(&provider)
            })
            .flatten();
        let Some(opsz) = axes
            .as_ref()
            .and_then(|axes| axes.iter().find(|axis| axis.tag == tag::OPSZ))
            .copied()
        else {
            self.plain.insert(id);
            return None;
        };
        let axes = axes.unwrap_or_default();

        let optical_size = optical_size_for(font_size, opsz.min, opsz.max);
        let key = (id, weight.0, optical_size);
        if let Some(alias) = self.instances.get(&key) {
            return Some(alias.clone());
        }

        let coordinates: Vec<Fixed> = coordinates(&axes, weight.0, optical_size)
            .into_iter()
            .map(Fixed::from)
            .collect();
        let instanced = system
            .db()
            .with_face_data(id, |data, index| {
                let scope = ReadScope::new(data);
                let font = scope.read::<FontData<'_>>().ok()?;
                let provider = font.table_provider(index as usize).ok()?;
                allsorts::variations::instance(&provider, &coordinates).ok()
            })
            .flatten();
        let Some((bytes, _)) = instanced else {
            tracing::warn!(
                family,
                "could not instance a variable font at its optical size"
            );
            self.plain.insert(id);
            return None;
        };

        let (post_script_name, style, stretch) = match system.db().face(id) {
            Some(face) => (face.post_script_name.clone(), face.style, face.stretch),
            None => return None,
        };
        let alias = format!("{family}\u{1f}opsz{optical_size}\u{1f}wght{}", weight.0);
        system.db_mut().push_face_info(FaceInfo {
            id: fontdb::ID::dummy(),
            source: Source::Binary(Arc::new(bytes)),
            index: 0,
            families: vec![(alias.clone(), Language::English_UnitedStates)],
            post_script_name,
            style,
            weight: fontdb::Weight(weight.0),
            stretch,
            monospaced: false,
        });
        self.instances.insert(key, alias.clone());
        Some(alias)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn slide_sizes_share_the_axis_maximum_and_small_text_follows_its_size() {
        // Inter's axis runs 14..=32.
        assert_eq!(optical_size_for(96.0, 14.0, 32.0), 32);
        assert_eq!(optical_size_for(40.0, 14.0, 32.0), 32);
        assert_eq!(optical_size_for(24.4, 14.0, 32.0), 24);
        assert_eq!(optical_size_for(8.0, 14.0, 32.0), 14);
        assert_eq!(optical_size_for(f32::NAN, 14.0, 32.0), 14);
    }

    #[test]
    fn only_the_optical_size_and_weight_move_every_other_axis_stays_at_its_default() {
        let axes = [
            Axis {
                tag: tag::OPSZ,
                min: 14.0,
                default: 14.0,
                max: 32.0,
            },
            Axis {
                tag: tag::WGHT,
                min: 100.0,
                default: 400.0,
                max: 900.0,
            },
            Axis {
                tag: u32::from_be_bytes(*b"slnt"),
                min: -10.0,
                default: 0.0,
                max: 0.0,
            },
        ];
        assert_eq!(coordinates(&axes, 700, 32), [32.0, 700.0, 0.0]);
        assert_eq!(
            coordinates(&axes, 1000, 20),
            [20.0, 900.0, 0.0],
            "weight clamped to the axis"
        );
    }

    #[test]
    fn a_family_that_is_not_installed_is_left_alone() {
        let mut system =
            FontSystem::new_with_locale_and_db("en-US".to_owned(), fontdb::Database::new());
        let mut sizes = OpticalSizes::default();
        assert_eq!(
            sizes.family_for(&mut system, "No Such Family", Weight::NORMAL, false, 96.0),
            None
        );
    }

    /// Against the real font, where this machine has it. Skipped silently
    /// elsewhere: CI runners do not have Inter installed.
    #[test]
    fn inter_at_slide_size_measures_what_chromium_measures() {
        let path = std::env::var("HOME")
            .map(|home| {
                std::path::PathBuf::from(home)
                    .join("Library/Fonts/Inter-VariableFont_opsz,wght.ttf")
            })
            .ok()
            .filter(|path| path.exists());
        let Some(path) = path else {
            return;
        };

        let mut db = fontdb::Database::new();
        db.load_font_file(&path).expect("load Inter");
        let mut system = FontSystem::new_with_locale_and_db("en-US".to_owned(), db);
        let mut sizes = OpticalSizes::default();
        let alias = sizes
            .family_for(&mut system, "Inter", Weight::NORMAL, false, 96.0)
            .expect("Inter has an optical-size axis");
        assert_eq!(
            sizes
                .family_for(&mut system, "Inter", Weight::NORMAL, false, 120.0)
                .as_deref(),
            Some(alias.as_str()),
            "one instance for every size past the axis maximum"
        );

        let width = |system: &mut FontSystem, family: &str| {
            let mut buffer =
                cosmic_text::Buffer::new(system, cosmic_text::Metrics::new(96.0, 115.0));
            buffer.set_wrap(cosmic_text::Wrap::None);
            buffer.set_text(
                "For God so loved the world",
                &cosmic_text::Attrs::new().family(cosmic_text::Family::Name(family)),
                cosmic_text::Shaping::Advanced,
                None,
            );
            buffer.shape_until_scroll(system, false);
            buffer
                .layout_runs()
                .map(|run| run.line_w)
                .fold(0.0, f32::max)
        };
        let instanced = width(&mut system, &alias);
        // Chromium 1115.9 px; the default optical size 1221.8 px.
        assert!((instanced - 1115.9).abs() < 2.0, "{instanced}");
    }
}
