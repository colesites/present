//! Every transition Present offers, as data.
//!
//! One table, so the React picker has no list of its own to fall out of step
//! with and adding a transition is a row rather than a change in two places.
//!
//! **The hundred and eight are not a hundred and eight implementations.** They
//! are around twenty [`Primitive`]s with parameters: `Slide Left`, `Slide
//! Right`, `Slide Up` and `Slide Down` are one slide with a direction, and
//! `Push`, `Cover` and `Reveal` differ only in which of the two slides moves.
//! A preset is a name, a primitive, and the parameters that make it that name.
//!
//! Each row says what it needs, so the engine can refuse gracefully rather
//! than fail: a preset wanting shaders on a machine without them falls back to
//! the plainest thing that reads as the same gesture, which is a fade.

use serde::Serialize;

use super::config::{Direction, Transition};
use super::easing::Easing;

/// The drawing each preset is made of.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum Primitive {
    /// No drawing at all: the next slide is simply there.
    Cut,
    /// Holds the outgoing slide for the duration, then cuts.
    Hold,
    Fade,
    /// Out through a colour and in again.
    DipToColor,
    /// Both slides move together.
    Slide,
    /// The new one pushes the old one out.
    Push,
    /// The new one moves in over a still old one.
    Cover,
    /// The old one moves away, uncovering a still new one.
    Reveal,
    /// A hard edge travels across.
    Wipe,
    /// A hard edge sweeps around a centre.
    RadialWipe,
    Zoom,
    ZoomBlur,
    /// A shape opens or closes: circle, diamond, square, star, heart.
    Shape,
    /// The picture parts in two or four.
    Split,
    Blinds,
    Cube,
    Flip,
    PageCurl,
    Rotate,
    Blur,
    Flash,
    Sweep,
    Glitch,
    Pixelate,
    Distort,
    Particle,
}

impl Primitive {
    /// Whether this one is drawn today.
    ///
    /// The rest are in the table because the picker shows the whole library
    /// and because their metadata is what the engine needs to fall back
    /// sensibly — not because they secretly work.
    pub const fn is_drawn(self) -> bool {
        matches!(
            self,
            Self::Cut
                | Self::Hold
                | Self::Fade
                | Self::DipToColor
                | Self::Slide
                | Self::Push
                | Self::Cover
                | Self::Reveal
                | Self::Wipe
                | Self::Zoom
                | Self::Shape
                | Self::Blur
        )
    }

    /// Whether it needs the GPU to be worth having.
    ///
    /// Not "cannot be done on a CPU": a shattering 4K frame can be drawn a
    /// pixel at a time, and it would take a second a frame.
    pub const fn needs_shader(self) -> bool {
        matches!(
            self,
            Self::Cube
                | Self::Flip
                | Self::PageCurl
                | Self::Distort
                | Self::Particle
                | Self::Glitch
                | Self::ZoomBlur
        )
    }

    /// Whether it has to draw the slides into a texture of their own first.
    pub const fn needs_intermediate_texture(self) -> bool {
        !matches!(self, Self::Cut | Self::Hold)
    }

    pub const fn supports_direction(self) -> bool {
        matches!(
            self,
            Self::Slide
                | Self::Push
                | Self::Cover
                | Self::Reveal
                | Self::Wipe
                | Self::RadialWipe
                | Self::Zoom
                | Self::ZoomBlur
                | Self::Shape
                | Self::Split
                | Self::Blinds
                | Self::Cube
                | Self::Flip
                | Self::PageCurl
                | Self::Rotate
                | Self::Sweep
                // In, out, or a direction to smear along.
                | Self::Blur
        )
    }

    /// What this gesture looks like when it cannot be drawn.
    ///
    /// A fade, always: it reads as "something changed" without pretending to
    /// be the thing that was asked for, and it works on every layer.
    pub const fn fallback(self) -> Self {
        if self.is_drawn() {
            self
        } else {
            Self::Fade
        }
    }
}

/// The headings the picker groups by.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum Category {
    Basic,
    Slide,
    Wipe,
    Zoom,
    Shape,
    Split,
    ThreeD,
    Light,
    Digital,
    Creative,
}

impl Category {
    pub fn title(self) -> &'static str {
        match self {
            Self::Basic => "Basic",
            Self::Slide => "Slide & Push",
            Self::Wipe => "Wipe",
            Self::Zoom => "Zoom & Scale",
            Self::Shape => "Shape",
            Self::Split => "Split & Panel",
            Self::ThreeD => "3D & Motion",
            Self::Light => "Blur & Light",
            Self::Digital => "Glitch & Digital",
            Self::Creative => "Stylised",
        }
    }

    pub const ALL: [Self; 10] = [
        Self::Basic,
        Self::Slide,
        Self::Wipe,
        Self::Zoom,
        Self::Shape,
        Self::Split,
        Self::ThreeD,
        Self::Light,
        Self::Digital,
        Self::Creative,
    ];
}

/// One entry in the library.
#[derive(Debug, Clone, Copy, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Preset {
    pub id: &'static str,
    pub name: &'static str,
    pub category: Category,
    pub primitive: Primitive,
    /// The direction this preset fixes, when its name carries one.
    pub direction: Option<Direction>,
    pub default_duration_ms: u32,
    pub supports_direction: bool,
    pub needs_shader: bool,
    pub needs_intermediate_texture: bool,
    /// Whether it is drawn today, or is in the library waiting for the GPU.
    pub available: bool,
}

/// The default length of a transition nobody has set one for.
///
/// Fast enough to feel like a cut with manners, slow enough to read as
/// deliberate. ProPresenter's own default is in the same place.
const DEFAULT_DURATION_MS: u32 = 400;

const fn preset(
    id: &'static str,
    name: &'static str,
    category: Category,
    primitive: Primitive,
    direction: Option<Direction>,
) -> Preset {
    Preset {
        id,
        name,
        category,
        primitive,
        direction,
        default_duration_ms: match primitive {
            Primitive::Cut => 0,
            _ => DEFAULT_DURATION_MS,
        },
        supports_direction: primitive.supports_direction(),
        needs_shader: primitive.needs_shader(),
        needs_intermediate_texture: !matches!(primitive, Primitive::Cut | Primitive::Hold),
        available: primitive.is_drawn(),
    }
}

/// Every transition, in the order the picker shows them.
pub const PRESETS: &[Preset] = &[
    preset("cut", "Cut", Category::Basic, Primitive::Cut, None),
    preset("fade", "Fade", Category::Basic, Primitive::Fade, None),
    preset("crossfade", "Crossfade", Category::Basic, Primitive::Fade, None),
    preset("dip-to-black", "Dip to Black", Category::Basic, Primitive::DipToColor, None),
    preset("dip-to-white", "Dip to White", Category::Basic, Primitive::DipToColor, None),
    preset("fade-through-color", "Fade Through Colour", Category::Basic, Primitive::DipToColor, None),
    preset("smooth-fade", "Smooth Fade", Category::Basic, Primitive::Fade, None),
    preset("instant", "Instant", Category::Basic, Primitive::Cut, None),
    preset("none", "None", Category::Basic, Primitive::Cut, None),
    preset("hold", "Hold", Category::Basic, Primitive::Hold, None),
    preset("slide-left", "Slide Left", Category::Slide, Primitive::Slide, Some(Direction::Left)),
    preset("slide-right", "Slide Right", Category::Slide, Primitive::Slide, Some(Direction::Right)),
    preset("slide-up", "Slide Up", Category::Slide, Primitive::Slide, Some(Direction::Up)),
    preset("slide-down", "Slide Down", Category::Slide, Primitive::Slide, Some(Direction::Down)),
    preset("push-left", "Push Left", Category::Slide, Primitive::Push, Some(Direction::Left)),
    preset("push-right", "Push Right", Category::Slide, Primitive::Push, Some(Direction::Right)),
    preset("push-up", "Push Up", Category::Slide, Primitive::Push, Some(Direction::Up)),
    preset("push-down", "Push Down", Category::Slide, Primitive::Push, Some(Direction::Down)),
    preset("cover-left", "Cover Left", Category::Slide, Primitive::Cover, Some(Direction::Left)),
    preset("cover-right", "Cover Right", Category::Slide, Primitive::Cover, Some(Direction::Right)),
    preset("cover-up", "Cover Up", Category::Slide, Primitive::Cover, Some(Direction::Up)),
    preset("cover-down", "Cover Down", Category::Slide, Primitive::Cover, Some(Direction::Down)),
    preset("reveal-left", "Reveal Left", Category::Slide, Primitive::Reveal, Some(Direction::Left)),
    preset("reveal-right", "Reveal Right", Category::Slide, Primitive::Reveal, Some(Direction::Right)),
    preset("reveal-up", "Reveal Up", Category::Slide, Primitive::Reveal, Some(Direction::Up)),
    preset("reveal-down", "Reveal Down", Category::Slide, Primitive::Reveal, Some(Direction::Down)),
    preset("wipe-left", "Wipe Left", Category::Wipe, Primitive::Wipe, Some(Direction::Left)),
    preset("wipe-right", "Wipe Right", Category::Wipe, Primitive::Wipe, Some(Direction::Right)),
    preset("wipe-up", "Wipe Up", Category::Wipe, Primitive::Wipe, Some(Direction::Up)),
    preset("wipe-down", "Wipe Down", Category::Wipe, Primitive::Wipe, Some(Direction::Down)),
    preset("wipe-diagonal", "Wipe Diagonal", Category::Wipe, Primitive::Wipe, Some(Direction::Diagonal)),
    preset("clockwise-wipe", "Clockwise Wipe", Category::Wipe, Primitive::RadialWipe, Some(Direction::Clockwise)),
    preset("counterclockwise-wipe", "Counterclockwise Wipe", Category::Wipe, Primitive::RadialWipe, Some(Direction::CounterClockwise)),
    preset("radial-wipe", "Radial Wipe", Category::Wipe, Primitive::RadialWipe, Some(Direction::Clockwise)),
    preset("center-wipe", "Centre Wipe", Category::Wipe, Primitive::Wipe, Some(Direction::Out)),
    preset("edge-wipe", "Edge Wipe", Category::Wipe, Primitive::Wipe, Some(Direction::In)),
    preset("zoom-in", "Zoom In", Category::Zoom, Primitive::Zoom, Some(Direction::In)),
    preset("zoom-out", "Zoom Out", Category::Zoom, Primitive::Zoom, Some(Direction::Out)),
    preset("zoom-through", "Zoom Through", Category::Zoom, Primitive::Zoom, Some(Direction::In)),
    preset("scale-up", "Scale Up", Category::Zoom, Primitive::Zoom, Some(Direction::In)),
    preset("scale-down", "Scale Down", Category::Zoom, Primitive::Zoom, Some(Direction::Out)),
    preset("center-zoom", "Centre Zoom", Category::Zoom, Primitive::Zoom, Some(Direction::In)),
    preset("dynamic-zoom", "Dynamic Zoom", Category::Zoom, Primitive::Zoom, Some(Direction::In)),
    preset("zoom-blur", "Zoom Blur", Category::Zoom, Primitive::ZoomBlur, Some(Direction::In)),
    preset("push-zoom", "Push Zoom", Category::Zoom, Primitive::Zoom, Some(Direction::In)),
    preset("circle-reveal", "Circle Reveal", Category::Shape, Primitive::Shape, Some(Direction::Out)),
    preset("circle-close", "Circle Close", Category::Shape, Primitive::Shape, Some(Direction::In)),
    preset("diamond-reveal", "Diamond Reveal", Category::Shape, Primitive::Shape, Some(Direction::Out)),
    preset("diamond-close", "Diamond Close", Category::Shape, Primitive::Shape, Some(Direction::In)),
    preset("square-reveal", "Square Reveal", Category::Shape, Primitive::Shape, Some(Direction::Out)),
    preset("square-close", "Square Close", Category::Shape, Primitive::Shape, Some(Direction::In)),
    preset("star-reveal", "Star Reveal", Category::Shape, Primitive::Shape, Some(Direction::Out)),
    preset("heart-reveal", "Heart Reveal", Category::Shape, Primitive::Shape, Some(Direction::Out)),
    preset("iris-in", "Iris In", Category::Shape, Primitive::Shape, Some(Direction::In)),
    preset("iris-out", "Iris Out", Category::Shape, Primitive::Shape, Some(Direction::Out)),
    preset("split-horizontal", "Split Horizontal", Category::Split, Primitive::Split, Some(Direction::Left)),
    preset("split-vertical", "Split Vertical", Category::Split, Primitive::Split, Some(Direction::Up)),
    preset("split-four", "Split Four", Category::Split, Primitive::Split, Some(Direction::Out)),
    preset("open-from-center", "Open From Centre", Category::Split, Primitive::Split, Some(Direction::Out)),
    preset("close-to-center", "Close To Centre", Category::Split, Primitive::Split, Some(Direction::In)),
    preset("doors-open", "Doors Open", Category::Split, Primitive::Split, Some(Direction::Out)),
    preset("doors-close", "Doors Close", Category::Split, Primitive::Split, Some(Direction::In)),
    preset("curtains-open", "Curtains Open", Category::Split, Primitive::Split, Some(Direction::Out)),
    preset("curtains-close", "Curtains Close", Category::Split, Primitive::Split, Some(Direction::In)),
    preset("blinds-horizontal", "Blinds Horizontal", Category::Split, Primitive::Blinds, Some(Direction::Left)),
    preset("blinds-vertical", "Blinds Vertical", Category::Split, Primitive::Blinds, Some(Direction::Up)),
    preset("cube-left", "Cube Left", Category::ThreeD, Primitive::Cube, Some(Direction::Left)),
    preset("cube-right", "Cube Right", Category::ThreeD, Primitive::Cube, Some(Direction::Right)),
    preset("cube-up", "Cube Up", Category::ThreeD, Primitive::Cube, Some(Direction::Up)),
    preset("cube-down", "Cube Down", Category::ThreeD, Primitive::Cube, Some(Direction::Down)),
    preset("flip-horizontal", "Flip Horizontal", Category::ThreeD, Primitive::Flip, Some(Direction::Left)),
    preset("flip-vertical", "Flip Vertical", Category::ThreeD, Primitive::Flip, Some(Direction::Up)),
    preset("page-turn", "Page Turn", Category::ThreeD, Primitive::PageCurl, Some(Direction::Left)),
    preset("page-curl", "Page Curl", Category::ThreeD, Primitive::PageCurl, Some(Direction::Left)),
    preset("card-flip", "Card Flip", Category::ThreeD, Primitive::Flip, Some(Direction::Left)),
    preset("rotate", "Rotate", Category::ThreeD, Primitive::Rotate, Some(Direction::Clockwise)),
    preset("spin", "Spin", Category::ThreeD, Primitive::Rotate, Some(Direction::Clockwise)),
    preset("3d-rotation", "3D Rotation", Category::ThreeD, Primitive::Cube, Some(Direction::Left)),
    preset("blur", "Blur", Category::Light, Primitive::Blur, None),
    preset("blur-in", "Blur In", Category::Light, Primitive::Blur, Some(Direction::In)),
    preset("blur-out", "Blur Out", Category::Light, Primitive::Blur, Some(Direction::Out)),
    preset("motion-blur", "Motion Blur", Category::Light, Primitive::Blur, Some(Direction::Left)),
    preset("gaussian-blur", "Gaussian Blur", Category::Light, Primitive::Blur, None),
    preset("light-flash", "Light Flash", Category::Light, Primitive::Flash, None),
    preset("white-flash", "White Flash", Category::Light, Primitive::Flash, None),
    preset("lens-flash", "Lens Flash", Category::Light, Primitive::Flash, None),
    preset("light-sweep", "Light Sweep", Category::Light, Primitive::Sweep, Some(Direction::Left)),
    preset("glow-dissolve", "Glow Dissolve", Category::Light, Primitive::Flash, None),
    preset("glitch", "Glitch", Category::Digital, Primitive::Glitch, None),
    preset("rgb-split", "RGB Split", Category::Digital, Primitive::Glitch, None),
    preset("digital-noise", "Digital Noise", Category::Digital, Primitive::Glitch, None),
    preset("pixelate", "Pixelate", Category::Digital, Primitive::Pixelate, None),
    preset("pixel-dissolve", "Pixel Dissolve", Category::Digital, Primitive::Pixelate, None),
    preset("scanlines", "Scanlines", Category::Digital, Primitive::Glitch, None),
    preset("digital-wipe", "Digital Wipe", Category::Digital, Primitive::Glitch, None),
    preset("data-stream", "Data Stream", Category::Digital, Primitive::Glitch, None),
    preset("signal-distortion", "Signal Distortion", Category::Digital, Primitive::Glitch, None),
    preset("ripple", "Ripple", Category::Creative, Primitive::Distort, None),
    preset("wave", "Wave", Category::Creative, Primitive::Distort, None),
    preset("liquid", "Liquid", Category::Creative, Primitive::Distort, None),
    preset("shatter", "Shatter", Category::Creative, Primitive::Particle, None),
    preset("mosaic", "Mosaic", Category::Creative, Primitive::Pixelate, None),
    preset("film-burn", "Film Burn", Category::Creative, Primitive::Flash, None),
    preset("ink-reveal", "Ink Reveal", Category::Creative, Primitive::Particle, None),
    preset("smoke-reveal", "Smoke Reveal", Category::Creative, Primitive::Particle, None),
    preset("paint-reveal", "Paint Reveal", Category::Creative, Primitive::Particle, None),
    preset("light-leak", "Light Leak", Category::Creative, Primitive::Flash, None),
    preset("particle-dissolve", "Particle Dissolve", Category::Creative, Primitive::Particle, None),
];

/// The preset with this id, if there is one.
pub fn find(id: &str) -> Option<&'static Preset> {
    PRESETS.iter().find(|preset| preset.id == id)
}

/// The transition a slide gets when it asks for this preset by name.
pub fn transition_for(id: &str) -> Transition {
    find(id).map_or_else(Transition::none, |preset| Transition {
        kind: preset.id.to_owned(),
        duration_ms: preset.default_duration_ms,
        easing: Easing::default(),
        direction: preset.direction.unwrap_or_default(),
        mode: super::config::Mode::default(),
    })
}

/// What will actually be drawn for `transition`, after any fallback.
pub fn drawn_primitive(transition: &Transition) -> Primitive {
    find(&transition.kind).map_or(Primitive::Fade, |preset| preset.primitive.fallback())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::BTreeSet;

    #[test]
    fn the_library_is_the_hundred_and_eight() {
        assert_eq!(PRESETS.len(), 108);
    }

    #[test]
    fn no_two_transitions_share_a_name() {
        let ids: BTreeSet<&str> = PRESETS.iter().map(|preset| preset.id).collect();
        assert_eq!(ids.len(), PRESETS.len(), "an id is used twice");
        let names: BTreeSet<&str> = PRESETS.iter().map(|preset| preset.name).collect();
        assert_eq!(names.len(), PRESETS.len(), "a display name is used twice");
    }

    #[test]
    fn every_category_has_something_in_it() {
        for category in Category::ALL {
            assert!(
                PRESETS.iter().any(|preset| preset.category == category),
                "{} is empty",
                category.title()
            );
        }
    }

    #[test]
    fn the_directions_in_the_names_match_the_directions_in_the_table() {
        for preset in PRESETS {
            // Only where the name really is a direction: `Scale Up` grows, it
            // does not go upwards, and `Iris In` opens rather than travelling.
            let travels = matches!(
                preset.primitive,
                Primitive::Slide
                    | Primitive::Push
                    | Primitive::Cover
                    | Primitive::Reveal
                    | Primitive::Wipe
                    | Primitive::Cube
                    | Primitive::Blinds
            );
            if travels {
                for (suffix, direction) in [
                    ("-left", Direction::Left),
                    ("-right", Direction::Right),
                    ("-up", Direction::Up),
                    ("-down", Direction::Down),
                ] {
                    if preset.id.ends_with(suffix) {
                        assert_eq!(preset.direction, Some(direction), "{}", preset.id);
                    }
                }
            }
            if preset.direction.is_some() {
                assert!(
                    preset.supports_direction,
                    "{} fixes a direction its primitive does not take",
                    preset.id
                );
            }
        }
    }

    #[test]
    fn what_cannot_be_drawn_falls_back_to_something_that_can() {
        for preset in PRESETS {
            let drawn = preset.primitive.fallback();
            assert!(
                drawn.is_drawn(),
                "{} falls back to something that is not drawn either",
                preset.id
            );
            assert_eq!(preset.available, preset.primitive.is_drawn());
        }
        // Every one of them resolves to something, including a name from a
        // presentation made in a later version.
        assert_eq!(drawn_primitive(&Transition::none()), Primitive::Cut);
        let unknown = Transition {
            kind: "invented-later".to_owned(),
            ..Transition::none()
        };
        assert_eq!(drawn_primitive(&unknown), Primitive::Fade);
    }

    #[test]
    fn asking_for_one_by_name_gives_it_its_own_defaults() {
        let slide = transition_for("slide-left");
        assert_eq!(slide.kind, "slide-left");
        assert_eq!(slide.direction, Direction::Left);
        assert_eq!(slide.duration_ms, DEFAULT_DURATION_MS);
        assert!(slide.animates());

        let cut = transition_for("cut");
        assert_eq!(cut.duration_ms, 0);
        assert!(!cut.animates(), "a cut is instant whatever else is set");

        assert_eq!(
            transition_for("not-a-transition"),
            Transition::none(),
            "a name from somewhere else is a cut, not a crash"
        );
    }

    #[test]
    fn a_good_number_of_them_are_drawn_today() {
        let drawn = PRESETS.iter().filter(|preset| preset.available).count();
        assert!(drawn >= 50, "only {drawn} of {} are drawn", PRESETS.len());
    }
}
