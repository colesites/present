//! What PowerPoint does to a picture before it draws it: recolouring it in
//! two tones of the theme, greying it, brightening it, making one colour of it
//! clear. These are baked into the picture at import, so every renderer shows
//! the picture PowerPoint shows — a theme's background photo recoloured into
//! its dark tones would otherwise be drawn in its own light ones, and the white
//! words over it lost.

use roxmltree::Node;

use super::color::{self, Palette, Rgba};
use super::xml::{self, A};

#[derive(Debug, Clone, PartialEq)]
pub enum Effect {
    /// Black becomes the first colour, white the second, greys between.
    Duotone(Rgba, Rgba),
    Grayscale,
    /// Brightness and contrast, each from -1 to 1.
    Luminance {
        bright: f64,
        contrast: f64,
    },
    /// Above the threshold white, below it black.
    BiLevel(f64),
    /// One colour replaced by another, usually made clear.
    ColorChange {
        from: Rgba,
        to: Rgba,
    },
}

/// The effects a `blip` carries, in order.
pub fn effects(blip: Node, palette: &Palette) -> Vec<Effect> {
    let mut effects = Vec::new();
    for node in xml::elements(blip) {
        match node.tag_name().name() {
            "duotone" => {
                let colors: Vec<Rgba> = xml::elements(node)
                    .filter_map(|color| color::resolve(color, palette))
                    .collect();
                if let [first, second] = colors.as_slice() {
                    effects.push(Effect::Duotone(*first, *second));
                }
            }
            "grayscl" => effects.push(Effect::Grayscale),
            "lum" => effects.push(Effect::Luminance {
                bright: xml::percent(node, "bright").unwrap_or(0.0),
                contrast: xml::percent(node, "contrast").unwrap_or(0.0),
            }),
            "biLevel" => effects.push(Effect::BiLevel(xml::percent(node, "thresh").unwrap_or(0.5))),
            "clrChange" => {
                let pick = |tag: &str| {
                    xml::child(node, A, tag)
                        .and_then(color::color_child)
                        .and_then(|color| color::resolve(color, palette))
                };
                if let (Some(from), Some(to)) = (pick("clrFrom"), pick("clrTo")) {
                    effects.push(Effect::ColorChange { from, to });
                }
            }
            _ => {}
        }
    }
    effects
}

/// A short, stable name for a list of effects, to store each recolouring once.
pub fn key(effects: &[Effect]) -> String {
    let mut hasher = blake3::Hasher::new();
    hasher.update(format!("{effects:?}").as_bytes());
    hasher.finalize().to_hex()[..16].to_owned()
}

/// The picture with its effects applied, as a PNG. `None` for a picture this
/// cannot decode, which is then drawn as it is.
pub fn apply(bytes: &[u8], effects: &[Effect]) -> Option<Vec<u8>> {
    let mut image = image::load_from_memory(bytes).ok()?.to_rgba8();
    for pixel in image.pixels_mut() {
        let [r, g, b, a] = pixel.0;
        let mut rgb = [
            f64::from(r) / 255.0,
            f64::from(g) / 255.0,
            f64::from(b) / 255.0,
        ];
        let mut alpha = f64::from(a) / 255.0;
        for effect in effects {
            let gray = 0.299 * rgb[0] + 0.587 * rgb[1] + 0.114 * rgb[2];
            match effect {
                Effect::Duotone(dark, light) => {
                    rgb = [
                        dark.r + (light.r - dark.r) * gray,
                        dark.g + (light.g - dark.g) * gray,
                        dark.b + (light.b - dark.b) * gray,
                    ];
                }
                Effect::Grayscale => rgb = [gray, gray, gray],
                Effect::Luminance { bright, contrast } => {
                    let gain = if *contrast >= 0.0 {
                        1.0 / (1.0 - contrast.min(0.99))
                    } else {
                        1.0 + contrast
                    };
                    rgb = rgb.map(|c| ((c - 0.5) * gain + 0.5 + bright).clamp(0.0, 1.0));
                }
                Effect::BiLevel(threshold) => {
                    let value = if gray >= *threshold { 1.0 } else { 0.0 };
                    rgb = [value, value, value];
                }
                Effect::ColorChange { from, to } => {
                    let close = (rgb[0] - from.r).abs() < 0.02
                        && (rgb[1] - from.g).abs() < 0.02
                        && (rgb[2] - from.b).abs() < 0.02;
                    if close {
                        rgb = [to.r, to.g, to.b];
                        alpha *= to.a;
                    }
                }
            }
        }
        let byte = |value: f64| (value.clamp(0.0, 1.0) * 255.0).round() as u8;
        pixel.0 = [byte(rgb[0]), byte(rgb[1]), byte(rgb[2]), byte(alpha)];
    }
    let mut out = std::io::Cursor::new(Vec::new());
    image::DynamicImage::ImageRgba8(image)
        .write_to(&mut out, image::ImageFormat::Png)
        .ok()?;
    Some(out.into_inner())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn png(rgba: [u8; 4]) -> Vec<u8> {
        let mut image = image::RgbaImage::new(2, 2);
        for pixel in image.pixels_mut() {
            pixel.0 = rgba;
        }
        let mut out = std::io::Cursor::new(Vec::new());
        image::DynamicImage::ImageRgba8(image)
            .write_to(&mut out, image::ImageFormat::Png)
            .unwrap();
        out.into_inner()
    }

    fn first_pixel(bytes: &[u8]) -> [u8; 4] {
        image::load_from_memory(bytes)
            .unwrap()
            .to_rgba8()
            .get_pixel(0, 0)
            .0
    }

    #[test]
    fn a_duotone_turns_white_into_its_light_colour_and_black_into_its_dark() {
        let dark = Rgba::opaque(0.1, 0.1, 0.2);
        let light = Rgba::opaque(0.3, 0.3, 0.5);
        let near = |pixel: [u8; 4], expected: [u8; 4]| {
            pixel.iter().zip(expected).all(|(a, b)| a.abs_diff(b) <= 1)
        };
        let white = apply(&png([255, 255, 255, 255]), &[Effect::Duotone(dark, light)]).unwrap();
        assert!(
            near(first_pixel(&white), [77, 77, 128, 255]),
            "{:?}",
            first_pixel(&white)
        );
        let black = apply(&png([0, 0, 0, 255]), &[Effect::Duotone(dark, light)]).unwrap();
        assert!(
            near(first_pixel(&black), [26, 26, 51, 255]),
            "{:?}",
            first_pixel(&black)
        );
    }

    #[test]
    fn a_colour_change_can_make_a_colour_clear() {
        let white = Rgba::WHITE;
        let clear = Rgba::WHITE.with_alpha(0.0);
        let changed = apply(
            &png([255, 255, 255, 255]),
            &[Effect::ColorChange {
                from: white,
                to: clear,
            }],
        )
        .unwrap();
        assert_eq!(first_pixel(&changed)[3], 0);
    }
}
