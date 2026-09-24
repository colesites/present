//! The operator's media adjustments: `mediaFilterCSS`.
//!
//! The audience window applies them as a CSS `filter` on the background
//! `<video>` or `<img>` (`OutputWindow.tsx`). They are what an operator uses to
//! dim a busy background behind lyrics, so a stream that ignores them shows
//! lyrics the projector made readable over a video the stream did not dim.
//!
//! The string comes from `filtersToCSS` (`useMediaFolders.ts:158-171`), which
//! only ever writes these seven functions, in this order, and `none`:
//!
//! ```text
//! brightness(%) contrast(%) saturate(%) blur(px) grayscale(%) sepia(%) hue-rotate(deg)
//! ```
//!
//! The colour functions are the matrices in the Filter Effects specification,
//! applied in order in sRGB with each result clamped, which is what Chromium's
//! Skia colour filters do. Anything unrecognised is skipped rather than guessed:
//! an unknown filter left out shows the media as it is, and a wrong one could
//! black it out.

use tiny_skia::{ColorU8, PremultipliedColorU8};

use super::parallel;

#[derive(Debug, Clone, Copy, PartialEq)]
pub enum Filter {
    /// A 3x3 matrix and an offset per row, over straight-alpha RGB in 0..=1.
    Color([[f32; 4]; 3]),
    /// Gaussian standard deviation, in CSS pixels.
    Blur(f32),
}

/// Parse a CSS filter list. `none`, empty, or nothing recognised is empty.
pub fn parse(css: &str) -> Vec<Filter> {
    let mut filters = Vec::new();
    let mut rest = css.trim();
    while let Some(open) = rest.find('(') {
        let name = rest[..open].trim();
        let Some(close) = rest[open..].find(')') else {
            break;
        };
        let argument = rest[open + 1..open + close].trim();
        rest = &rest[open + close + 1..];

        if let Some(filter) = function(name, argument) {
            filters.push(filter);
        }
    }
    filters
}

fn function(name: &str, argument: &str) -> Option<Filter> {
    match name {
        "brightness" => {
            let amount = amount(argument)?;
            Some(linear(amount, 0.0))
        }
        "contrast" => {
            let amount = amount(argument)?;
            Some(linear(amount, 0.5 - 0.5 * amount))
        }
        "saturate" => Some(saturate(amount(argument)?)),
        "grayscale" => Some(grayscale(amount(argument)?.clamp(0.0, 1.0))),
        "sepia" => Some(sepia(amount(argument)?.clamp(0.0, 1.0))),
        "hue-rotate" => Some(hue_rotate(degrees(argument)?)),
        "blur" => {
            let radius = argument.strip_suffix("px").unwrap_or(argument).trim();
            let radius: f32 = radius.parse().ok()?;
            (radius.is_finite() && radius > 0.0).then_some(Filter::Blur(radius))
        }
        _ => None,
    }
}

/// `50%` or `0.5`, as a multiplier.
fn amount(argument: &str) -> Option<f32> {
    let value = match argument.strip_suffix('%') {
        Some(percent) => percent.trim().parse::<f32>().ok()? / 100.0,
        None => argument.parse::<f32>().ok()?,
    };
    (value.is_finite() && value >= 0.0).then_some(value)
}

fn degrees(argument: &str) -> Option<f32> {
    let value: f32 = argument
        .strip_suffix("deg")
        .unwrap_or(argument)
        .trim()
        .parse()
        .ok()?;
    value.is_finite().then_some(value)
}

fn linear(slope: f32, intercept: f32) -> Filter {
    Filter::Color([
        [slope, 0.0, 0.0, intercept],
        [0.0, slope, 0.0, intercept],
        [0.0, 0.0, slope, intercept],
    ])
}

fn saturate(s: f32) -> Filter {
    Filter::Color([
        [0.213 + 0.787 * s, 0.715 - 0.715 * s, 0.072 - 0.072 * s, 0.0],
        [0.213 - 0.213 * s, 0.715 + 0.285 * s, 0.072 - 0.072 * s, 0.0],
        [0.213 - 0.213 * s, 0.715 - 0.715 * s, 0.072 + 0.928 * s, 0.0],
    ])
}

fn grayscale(amount: f32) -> Filter {
    let s = 1.0 - amount;
    Filter::Color([
        [
            0.2126 + 0.7874 * s,
            0.7152 - 0.7152 * s,
            0.0722 - 0.0722 * s,
            0.0,
        ],
        [
            0.2126 - 0.2126 * s,
            0.7152 + 0.2848 * s,
            0.0722 - 0.0722 * s,
            0.0,
        ],
        [
            0.2126 - 0.2126 * s,
            0.7152 - 0.7152 * s,
            0.0722 + 0.9278 * s,
            0.0,
        ],
    ])
}

fn sepia(amount: f32) -> Filter {
    let s = 1.0 - amount;
    Filter::Color([
        [0.393 + 0.607 * s, 0.769 - 0.769 * s, 0.189 - 0.189 * s, 0.0],
        [0.349 - 0.349 * s, 0.686 + 0.314 * s, 0.168 - 0.168 * s, 0.0],
        [0.272 - 0.272 * s, 0.534 - 0.534 * s, 0.131 + 0.869 * s, 0.0],
    ])
}

fn hue_rotate(degrees: f32) -> Filter {
    let (sin, cos) = degrees.to_radians().sin_cos();
    Filter::Color([
        [
            0.213 + cos * 0.787 - sin * 0.213,
            0.715 - cos * 0.715 - sin * 0.715,
            0.072 - cos * 0.072 + sin * 0.928,
            0.0,
        ],
        [
            0.213 - cos * 0.213 + sin * 0.143,
            0.715 + cos * 0.285 + sin * 0.140,
            0.072 - cos * 0.072 - sin * 0.283,
            0.0,
        ],
        [
            0.213 - cos * 0.213 - sin * 0.787,
            0.715 - cos * 0.715 + sin * 0.715,
            0.072 + cos * 0.928 + sin * 0.072,
            0.0,
        ],
    ])
}

/// Apply every colour filter in `filters` to premultiplied pixels, in order.
///
/// Blur is not a per-pixel operation and is applied separately, by
/// [`blur`]; this skips it.
pub fn apply_color(pixels: &mut [PremultipliedColorU8], filters: &[Filter]) {
    let matrices: Vec<[[f32; 4]; 3]> = filters
        .iter()
        .filter_map(|filter| match filter {
            Filter::Color(matrix) => Some(*matrix),
            Filter::Blur(_) => None,
        })
        .collect();
    if matrices.is_empty() {
        return;
    }

    parallel::for_each_band(pixels, |band, _| {
        for pixel in band.iter_mut() {
            let straight = pixel.demultiply();
            let alpha = straight.alpha();
            if alpha == 0 {
                continue;
            }
            let mut rgb = [
                f32::from(straight.red()) / 255.0,
                f32::from(straight.green()) / 255.0,
                f32::from(straight.blue()) / 255.0,
            ];
            for matrix in &matrices {
                rgb = [0, 1, 2].map(|row| {
                    let [r, g, b, offset] = matrix[row];
                    (r * rgb[0] + g * rgb[1] + b * rgb[2] + offset).clamp(0.0, 1.0)
                });
            }
            let [r, g, b] = rgb.map(|channel| (channel * 255.0).round() as u8);
            *pixel = ColorU8::from_rgba(r, g, b, alpha).premultiply();
        }
    });
}

/// The total blur in `filters`, as one standard deviation. Two blurs compose
/// into one whose variance is the sum.
pub fn blur_sigma(filters: &[Filter]) -> Option<f32> {
    let variance: f32 = filters
        .iter()
        .filter_map(|filter| match filter {
            Filter::Blur(sigma) => Some(sigma * sigma),
            Filter::Color(_) => None,
        })
        .sum();
    (variance > 0.0).then(|| variance.sqrt())
}

/// Blur premultiplied pixels in place: three box blurs each way, which is
/// within a few percent of a Gaussian of the same deviation.
///
/// Outside the pixels counts as transparent, as it does for a CSS blur, so the
/// edges of what is blurred soften into nothing rather than smearing their own
/// colour outwards.
///
/// Each pass is a running sum, so its cost does not grow with the radius — a
/// `blur(20px)` background costs what a `blur(2px)` one does.
///
/// `scale` is frame pixels per CSS pixel, since the operator's `blur(8px)` is
/// eight pixels of the audience window, not of the frame.
pub fn blur(
    pixels: &mut [PremultipliedColorU8],
    width: usize,
    height: usize,
    sigma: f32,
    scale: f32,
) {
    if width == 0 || height == 0 || pixels.len() != width * height {
        return;
    }
    let sigma = sigma * scale;
    if !sigma.is_finite() || sigma < 0.5 {
        return;
    }

    // Box radius for three passes approximating `sigma`, from
    // w = sqrt(12 * sigma^2 / n + 1).
    let ideal = (12.0 * sigma * sigma / 3.0 + 1.0).sqrt();
    // Capped where `Divider` stops being exact. A box four thousand pixels
    // wide is already the whole picture's average.
    let radius = ((ideal - 1.0) / 2.0).round().clamp(1.0, 2047.0) as usize;

    let mut channels: Vec<[u32; 4]> = pixels
        .iter()
        .map(|pixel| {
            [
                u32::from(pixel.red()),
                u32::from(pixel.green()),
                u32::from(pixel.blue()),
                u32::from(pixel.alpha()),
            ]
        })
        .collect();
    let mut scratch = vec![[0u32; 4]; channels.len()];

    for _ in 0..3 {
        box_rows(&channels, &mut scratch, width, radius);
        box_columns(&scratch, &mut channels, width, height, radius);
    }

    for (pixel, value) in pixels.iter_mut().zip(channels.iter()) {
        let alpha = value[3].min(255) as u8;
        let channel = |index: usize| value[index].min(u32::from(alpha)) as u8;
        *pixel = PremultipliedColorU8::from_rgba(channel(0), channel(1), channel(2), alpha)
            .unwrap_or(PremultipliedColorU8::TRANSPARENT);
    }
}

/// Run `work` over whole rows of `destination`, in parallel bands, with the
/// index of each band's first row.
fn row_bands<F>(destination: &mut [[u32; 4]], width: usize, work: F)
where
    F: Fn(&mut [[u32; 4]], usize) + Sync,
{
    let rows = destination.len() / width;
    let bands = parallel::bands().min(rows.max(1));
    if bands <= 1 || destination.len() < 64 * 1024 {
        work(destination, 0);
        return;
    }
    let rows_per_band = rows.div_ceil(bands);
    std::thread::scope(|scope| {
        for (index, band) in destination.chunks_mut(rows_per_band * width).enumerate() {
            let work = &work;
            scope.spawn(move || work(band, index * rows_per_band));
        }
    });
}

/// Division by a box's width, rounded, as a multiply.
///
/// Four divisions a pixel a pass, six passes, was most of a blur's cost —
/// a division is some twenty-five times a multiply. `m = ceil(2^32 / window)`
/// makes `(x * m) >> 32` exactly `x / window` for every `x` below
/// `2^32 / window`, which a sum of 8-bit samples over a window of fewer than
/// four thousand pixels always is: the answers are the ones the division
/// gave, not approximations of them.
#[derive(Clone, Copy)]
struct Divider {
    half: u32,
    reciprocal: u64,
}

impl Divider {
    fn new(window: u32) -> Self {
        Self {
            half: window / 2,
            reciprocal: (1u64 << 32).div_ceil(u64::from(window)),
        }
    }

    #[inline(always)]
    fn divide(self, sum: u32) -> u32 {
        ((u64::from(sum + self.half) * self.reciprocal) >> 32) as u32
    }

    /// Every channel of a sum. Written out rather than with `map`, which
    /// compiled to a call for every pixel.
    #[inline(always)]
    fn each(self, sums: [u32; 4]) -> [u32; 4] {
        [
            self.divide(sums[0]),
            self.divide(sums[1]),
            self.divide(sums[2]),
            self.divide(sums[3]),
        ]
    }
}

fn box_rows(source: &[[u32; 4]], destination: &mut [[u32; 4]], width: usize, radius: usize) {
    let divider = Divider::new((2 * radius + 1) as u32);
    row_bands(destination, width, |band, first_row| {
        for (offset, out_row) in band.chunks_exact_mut(width).enumerate() {
            let row_start = (first_row + offset) * width;
            let row = &source[row_start..row_start + width];
            let mut sums = [0u32; 4];
            for sample in row.iter().take(radius.min(width - 1) + 1) {
                for channel in 0..4 {
                    sums[channel] += sample[channel];
                }
            }
            for (x, out) in out_row.iter_mut().enumerate() {
                *out = divider.each(sums);
                if let Some(entering) = row.get(x + radius + 1) {
                    for channel in 0..4 {
                        sums[channel] += entering[channel];
                    }
                }
                if x >= radius {
                    let leaving = row[x - radius];
                    for channel in 0..4 {
                        sums[channel] -= leaving[channel];
                    }
                }
            }
        }
    });
}

fn box_columns(
    source: &[[u32; 4]],
    destination: &mut [[u32; 4]],
    width: usize,
    height: usize,
    radius: usize,
) {
    let divider = Divider::new((2 * radius + 1) as u32);
    row_bands(destination, width, |band, first_row| {
        // A running sum per column, started afresh for this band's first row so
        // bands are independent.
        let mut sums = vec![[0u32; 4]; width];
        let lowest = first_row.saturating_sub(radius);
        let highest = (first_row + radius).min(height - 1);
        for y in lowest..=highest {
            let row = &source[y * width..(y + 1) * width];
            for (sum, sample) in sums.iter_mut().zip(row) {
                for channel in 0..4 {
                    sum[channel] += sample[channel];
                }
            }
        }

        for (offset, out_row) in band.chunks_exact_mut(width).enumerate() {
            let y = first_row + offset;
            for (out, sum) in out_row.iter_mut().zip(sums.iter()) {
                *out = divider.each(*sum);
            }
            if y + radius + 1 < height {
                let row = &source[(y + radius + 1) * width..(y + radius + 2) * width];
                for (sum, sample) in sums.iter_mut().zip(row) {
                    for channel in 0..4 {
                        sum[channel] += sample[channel];
                    }
                }
            }
            if y >= radius {
                let row = &source[(y - radius) * width..(y - radius + 1) * width];
                for (sum, sample) in sums.iter_mut().zip(row) {
                    for channel in 0..4 {
                        sum[channel] -= sample[channel];
                    }
                }
            }
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_divider_gives_exactly_what_dividing_did() {
        // Every window a blur can use, and every sum a window of 8-bit
        // samples can reach.
        for window in (1..=301u32).step_by(2).chain([1023, 4095]) {
            let divider = Divider::new(window);
            for sum in (0..=255 * window).step_by(if window > 301 { 97 } else { 1 }) {
                assert_eq!(
                    divider.divide(sum),
                    (sum + window / 2) / window,
                    "{sum} / {window}"
                );
            }
        }
    }

    fn pixel(r: u8, g: u8, b: u8) -> PremultipliedColorU8 {
        ColorU8::from_rgba(r, g, b, 255).premultiply()
    }

    fn filtered(css: &str, input: PremultipliedColorU8) -> (u8, u8, u8) {
        let mut pixels = [input];
        apply_color(&mut pixels, &parse(css));
        (pixels[0].red(), pixels[0].green(), pixels[0].blue())
    }

    #[test]
    fn none_and_nonsense_are_no_filter_at_all() {
        assert!(parse("none").is_empty());
        assert!(parse("").is_empty());
        assert!(parse("drop-shadow(2px 2px red)").is_empty());
        assert!(parse("brightness(banana)").is_empty());
    }

    #[test]
    fn every_function_the_ui_writes_is_understood_in_its_order() {
        let css = "brightness(80%) contrast(120%) saturate(50%) blur(4px) grayscale(10%) sepia(20%) hue-rotate(90deg)";
        let filters = parse(css);
        assert_eq!(filters.len(), 7);
        assert_eq!(filters[3], Filter::Blur(4.0));
    }

    #[test]
    fn brightness_scales_and_dims_a_background() {
        assert_eq!(
            filtered("brightness(50%)", pixel(200, 100, 40)),
            (100, 50, 20)
        );
        assert_eq!(
            filtered("brightness(200%)", pixel(200, 100, 40)),
            (255, 200, 80),
            "clamped"
        );
    }

    #[test]
    fn contrast_pivots_on_mid_grey() {
        assert_eq!(
            filtered("contrast(0%)", pixel(10, 240, 128)),
            (128, 128, 128)
        );
        // 64/255 is a hair above a quarter and 128/255 a hair above half, so
        // doubling the distance from mid-grey lands half a level up on each.
        let (r, g, b) = filtered("contrast(200%)", pixel(64, 128, 192));
        assert!(
            r <= 1 && (128..=129).contains(&g) && b == 255,
            "{:?}",
            (r, g, b)
        );
    }

    #[test]
    fn a_full_grayscale_is_equal_channels_and_zero_saturation_matches_it_closely() {
        let (r, g, b) = filtered("grayscale(100%)", pixel(255, 0, 0));
        assert_eq!((r, g, b), (54, 54, 54), "0.2126 of red");
        let (r, g, b) = filtered("saturate(0%)", pixel(255, 0, 0));
        assert!(r == g && g == b && r.abs_diff(54) <= 1);
    }

    #[test]
    fn a_full_turn_of_hue_changes_nothing_that_matters() {
        let (r, g, b) = filtered("hue-rotate(360deg)", pixel(200, 100, 40));
        assert!(r.abs_diff(200) <= 1 && g.abs_diff(100) <= 1 && b.abs_diff(40) <= 1);
    }

    #[test]
    fn filters_apply_in_order_with_each_result_clamped() {
        // Brighten past white first, then dim: the clamp in between is what
        // makes this grey rather than the original colour.
        assert_eq!(
            filtered("brightness(300%) brightness(50%)", pixel(100, 100, 100)),
            (128, 128, 128)
        );
    }

    #[test]
    fn transparent_pixels_stay_transparent() {
        let mut pixels = [PremultipliedColorU8::TRANSPARENT];
        apply_color(&mut pixels, &parse("brightness(200%) contrast(0%)"));
        assert_eq!(pixels[0].alpha(), 0);
        assert_eq!(pixels[0].red(), 0);
    }

    #[test]
    fn two_blurs_compose_into_one() {
        let sigma = blur_sigma(&parse("blur(3px) blur(4px)")).expect("a blur");
        assert!((sigma - 5.0).abs() < 1e-4);
        assert_eq!(blur_sigma(&parse("brightness(50%)")), None);
    }

    #[test]
    fn a_blur_spreads_an_edge_and_keeps_a_flat_colour_flat() {
        let (width, height) = (48, 32);
        let mut pixels: Vec<PremultipliedColorU8> = (0..width * height)
            .map(|index| {
                if index % width < width / 2 {
                    pixel(0, 0, 0)
                } else {
                    pixel(255, 255, 255)
                }
            })
            .collect();
        blur(&mut pixels, width, height, 2.0, 1.0);

        let row = &pixels[width * 16..width * 17];
        assert_eq!(row[12].red(), 0, "far from the edge, still black");
        assert_eq!(
            (row[36].red(), row[36].alpha()),
            (255, 255),
            "far from the edge, still white"
        );
        let edge = row[width / 2].red();
        assert!(edge > 40 && edge < 215, "the edge is softened: {edge}");
    }

    #[test]
    fn beyond_the_pixels_is_transparent_as_it_is_for_a_css_blur() {
        let (width, height) = (32, 32);
        let mut pixels = vec![pixel(255, 255, 255); width * height];
        blur(&mut pixels, width, height, 2.0, 1.0);

        let corner = pixels[0];
        assert!(
            corner.alpha() < 128,
            "the corner fades out: {}",
            corner.alpha()
        );
        assert_eq!(pixels[16 * width + 16].alpha(), 255, "the middle does not");
    }

    #[test]
    fn a_blur_is_measured_in_audience_window_pixels() {
        let (width, height) = (32, 4);
        let make = || -> Vec<PremultipliedColorU8> {
            (0..width * height)
                .map(|index| {
                    if index % width < width / 2 {
                        pixel(0, 0, 0)
                    } else {
                        pixel(255, 255, 255)
                    }
                })
                .collect()
        };
        let mut small = make();
        let mut scaled = make();
        blur(&mut small, width, height, 1.0, 1.0);
        blur(&mut scaled, width, height, 1.0, 3.0);

        let spread = |pixels: &[PremultipliedColorU8]| {
            pixels[..width]
                .iter()
                .filter(|p| p.red() > 10 && p.red() < 245)
                .count()
        };
        assert!(
            spread(&scaled) > spread(&small),
            "a larger frame blurs further"
        );
    }
}
