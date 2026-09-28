//! What each output of a screen shows, made from the screen's picture.
//!
//! A screen is drawn once, at its size (`services/screens.rs`). This turns
//! that picture into one output's frame: the part of it the output shows (a
//! grouped or blended screen's cell), where on the output it goes (a custom
//! target), its edges faded into its neighbours' (edge blend), its colour
//! adjusted, and its corners moved (corner pin). The native audience view and
//! NDI both send what this makes; a stage page does the same with CSS.
//!
//! Frames are BGRA, four bytes a pixel, top row first, treated as opaque:
//! every picture a screen draws is.

use super::screens::{
    layout, BlendCurve, ColorAdjust, CornerPin, OutputGeometry, OutputTarget, ScreenSetup,
};

/// Run `work` over `frame` in bands of whole rows, one per core: each output
/// pixel is worked out on its own, so the rows split with nothing shared.
fn for_each_row_band<F>(frame: &mut [u8], row_bytes: usize, work: F)
where
    F: Fn(&mut [u8], usize) + Sync,
{
    let rows = frame.len() / row_bytes.max(1);
    let cores = std::thread::available_parallelism()
        .map_or(1, |count| count.get())
        .clamp(1, 12);
    if cores <= 1 || rows < 64 {
        work(frame, 0);
        return;
    }
    let band_rows = rows.div_ceil(cores);
    std::thread::scope(|scope| {
        for (index, band) in frame.chunks_mut(band_rows * row_bytes).enumerate() {
            let work = &work;
            scope.spawn(move || work(band, index * band_rows));
        }
    });
}

/// A screen's picture laid out over the outputs it is drawn for: its size,
/// and how each shows it, by output id.
#[derive(Debug, Clone, PartialEq)]
pub struct Plan {
    pub canvas: (u32, u32),
    pub arrangements: Vec<(String, Arrangement)>,
}

/// Pictures larger than this, in pixels, are drawn smaller and scaled up: a
/// grouped wall of four 4K screens is not drawn at 8K by the processor.
const MOST_PIXELS: f64 = 3840.0 * 2160.0;

/// Lay `screen` out for the outputs it is being drawn for, each by its id
/// with its size and scale: the size in the units the frames are made in, and
/// how many of the output's own pixels make one of them, so a custom target
/// and a corner pin given in the output's pixels land where they were set.
pub fn plan(screen: &ScreenSetup, sizes: &[(String, (u32, u32), f64)]) -> Plan {
    let mut scaled = screen.clone();
    for output in &mut scaled.outputs {
        let Some((_, _, scale)) = sizes.iter().find(|(id, _, _)| *id == output.id) else {
            continue;
        };
        let scale = if scale.is_finite() && *scale > 0.0 {
            *scale
        } else {
            1.0
        };
        if let OutputTarget::Custom {
            x,
            y,
            width,
            height,
        } = output.target
        {
            output.target = OutputTarget::Custom {
                x: (f64::from(x) / scale).round() as i32,
                y: (f64::from(y) / scale).round() as i32,
                width: (f64::from(width) / scale).round() as u32,
                height: (f64::from(height) / scale).round() as u32,
            };
        }
        let point = |[x, y]: [f32; 2]| [x / scale as f32, y / scale as f32];
        let corners = output.corners;
        output.corners = CornerPin {
            top_left: point(corners.top_left),
            top_right: point(corners.top_right),
            bottom_right: point(corners.bottom_right),
            bottom_left: point(corners.bottom_left),
        };
    }
    let laid = layout(&scaled, |output| {
        sizes
            .iter()
            .find(|(id, _, _)| *id == output.id)
            .map(|(_, size, _)| *size)
            // A sent output not drawn here: its own size, an SDI mode's.
            .or_else(|| output.kind.is_stream().then(|| output.stream_size()))
    });
    let (width, height) = laid.canvas;
    let area = f64::from(width) * f64::from(height);
    let canvas = if area > MOST_PIXELS {
        let shrink = (MOST_PIXELS / area).sqrt();
        (
            ((f64::from(width) * shrink).round() as u32).max(16),
            ((f64::from(height) * shrink).round() as u32).max(16),
        )
    } else {
        laid.canvas
    };
    Plan {
        canvas,
        arrangements: laid
            .outputs
            .into_iter()
            .filter_map(|(id, geometry)| {
                let output = scaled.output(&id)?;
                Some((
                    id,
                    Arrangement {
                        geometry,
                        color: output.color,
                        corners: output.corners,
                    },
                ))
            })
            .collect(),
    }
}

/// How one output shows its screen's picture.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Arrangement {
    pub geometry: OutputGeometry,
    pub color: ColorAdjust,
    /// Corner offsets, in the output's pixels.
    pub corners: CornerPin,
}

impl Arrangement {
    /// The picture as it is, on the whole output: shown without a copy.
    pub fn is_identity(&self) -> bool {
        let geometry = &self.geometry;
        geometry.source == [0.0, 0.0, 1.0, 1.0]
            && geometry.target.is_none()
            && geometry.blend_left <= 0.0
            && geometry.blend_right <= 0.0
            && self.color.is_identity()
            && self.corners.is_identity()
    }
}

/// The affine colour change of [`ColorAdjust`], per channel 0..1:
/// `out = matrix · rgb + offset`.
#[derive(Debug, Clone, Copy)]
struct ColorMatrix {
    rows: [[f32; 3]; 3],
    offset: [f32; 3],
}

impl ColorMatrix {
    fn of(adjust: &ColorAdjust) -> Option<Self> {
        if adjust.is_identity() {
            return None;
        }
        // Luma weights, as CSS `saturate` and `hue-rotate` use.
        let (lr, lg, lb) = (0.2126_f32, 0.7152_f32, 0.0722_f32);
        let s = adjust.saturation;
        let saturation = [
            [lr + (1.0 - lr) * s, lg - lg * s, lb - lb * s],
            [lr - lr * s, lg + (1.0 - lg) * s, lb - lb * s],
            [lr - lr * s, lg - lg * s, lb + (1.0 - lb) * s],
        ];
        let (cos, sin) = {
            let angle = adjust.hue.to_radians();
            (angle.cos(), angle.sin())
        };
        let hue = [
            [
                0.213 + cos * 0.787 - sin * 0.213,
                0.715 - cos * 0.715 - sin * 0.715,
                0.072 - cos * 0.072 + sin * 0.928,
            ],
            [
                0.213 - cos * 0.213 + sin * 0.143,
                0.715 + cos * 0.285 + sin * 0.140,
                0.072 - cos * 0.072 - sin * 0.283,
            ],
            [
                0.213 - cos * 0.213 - sin * 0.787,
                0.715 - cos * 0.715 + sin * 0.715,
                0.072 + cos * 0.928 + sin * 0.072,
            ],
        ];
        let multiply = |a: [[f32; 3]; 3], b: [[f32; 3]; 3]| {
            let mut out = [[0.0; 3]; 3];
            for (row, out_row) in out.iter_mut().enumerate() {
                for (column, cell) in out_row.iter_mut().enumerate() {
                    *cell = (0..3).map(|k| a[row][k] * b[k][column]).sum();
                }
            }
            out
        };
        // Brightness, then saturation and hue, then contrast about the
        // middle, then black lifted: each affine, so they fold into one.
        let mut rows = multiply(hue, saturation);
        for row in &mut rows {
            for cell in row.iter_mut() {
                *cell *= adjust.brightness * adjust.contrast;
            }
        }
        let contrast_offset = 0.5 * (1.0 - adjust.contrast);
        let black = adjust.black_level;
        for row in &mut rows {
            for cell in row.iter_mut() {
                *cell *= 1.0 - black;
            }
        }
        let offset = [contrast_offset * (1.0 - black) + black; 3];
        Some(Self { rows, offset })
    }

    /// The same change as tables: each output channel is three looked-up
    /// products and an offset, in 16.16 fixed point, rather than nine
    /// multiplications a pixel.
    fn tables(&self) -> ColorTables {
        let mut products = [[[0i32; 256]; 3]; 3];
        for (row, by_input) in products.iter_mut().enumerate() {
            // Inputs in the canvas's order: blue, green, red.
            for (input, table) in by_input.iter_mut().enumerate() {
                let weight = self.rows[row][2 - input];
                for (value, entry) in table.iter_mut().enumerate() {
                    *entry = (weight * value as f32 * 256.0).round() as i32;
                }
            }
        }
        let offset = self
            .offset
            .map(|value| (value * 255.0 * 256.0).round() as i32);
        ColorTables { products, offset }
    }
}

/// [`ColorMatrix`] as lookup tables.
struct ColorTables {
    /// By output channel (red, green, blue), then input (blue, green, red).
    products: [[[i32; 256]; 3]; 3],
    offset: [i32; 3],
}

impl ColorTables {
    #[inline]
    fn apply(&self, [b, g, r]: [u32; 3]) -> [u32; 3] {
        let channel = |row: usize| {
            let table = &self.products[row];
            let value = table[0][b as usize]
                + table[1][g as usize]
                + table[2][r as usize]
                + self.offset[row];
            ((value + 128) >> 8).clamp(0, 255) as u32
        };
        let (red, green, blue) = (channel(0), channel(1), channel(2));
        [blue, green, red]
    }
}

/// How much of the picture shows at `u` across the output, 0 to 1, for its
/// blended edges.
#[inline]
fn blend_weight(u: f64, left: f64, right: f64, curve: BlendCurve) -> f64 {
    let mut weight = 1.0;
    if left > 0.0 && u < left {
        weight *= curve.weight(u / left);
    }
    if right > 0.0 && u > 1.0 - right {
        weight *= curve.weight((1.0 - u) / right);
    }
    weight
}

/// Opaque black, where the picture is not.
const BLACK: [u8; 4] = [0, 0, 0, 255];

fn fill_black(bytes: &mut [u8]) {
    for pixel in bytes.chunks_exact_mut(4) {
        pixel.copy_from_slice(&BLACK);
    }
}

/// A 3×3 projective matrix, row-major, and its inverse.
fn inverse(m: [f64; 9]) -> Option<[f64; 9]> {
    let [a, b, c, d, e, f, g, h, i] = m;
    let det = a * (e * i - f * h) - b * (d * i - f * g) + c * (d * h - e * g);
    if det.abs() < 1e-12 {
        return None;
    }
    let inv = 1.0 / det;
    Some([
        (e * i - f * h) * inv,
        (c * h - b * i) * inv,
        (b * f - c * e) * inv,
        (f * g - d * i) * inv,
        (a * i - c * g) * inv,
        (c * d - a * f) * inv,
        (d * h - e * g) * inv,
        (b * g - a * h) * inv,
        (a * e - b * d) * inv,
    ])
}

/// Make one output's `width` × `height` frame into `out` from `canvas`
/// (`canvas_size`), as `arrangement` says. The output is black wherever the
/// picture is not.
pub fn arrange(
    canvas: &[u8],
    canvas_size: (u32, u32),
    out: &mut Vec<u8>,
    (width, height): (u32, u32),
    arrangement: &Arrangement,
) {
    // Every pixel is written below, so the buffer is only sized, not
    // cleared: at 1080p clearing it was most of the cost of a copy.
    let length = width as usize * height as usize * 4;
    if out.len() != length {
        out.resize(length, 0);
    }
    let (canvas_width, canvas_height) = (canvas_size.0 as usize, canvas_size.1 as usize);
    if canvas.len() < canvas_width * canvas_height * 4 || canvas_width == 0 || canvas_height == 0 {
        fill_black(out);
        return;
    }

    let geometry = &arrangement.geometry;
    let [target_x, target_y, target_width, target_height] =
        geometry
            .target
            .unwrap_or([0.0, 0.0, f64::from(width), f64::from(height)]);
    let [source_x, source_y, source_width, source_height] = geometry.source;
    let color = ColorMatrix::of(&arrangement.color);
    let tables = color.as_ref().map(ColorMatrix::tables);
    // Output pixel → where in the picture's own rectangle (0..1 each way).
    let projective =
        super::screens::corner_pin_matrix(target_width, target_height, &arrangement.corners)
            .map(|m| [m[0], m[4], m[12], m[1], m[5], m[13], m[3], m[7], m[15]])
            .and_then(inverse);

    let stride = canvas_width * 4;
    let output_width = width as usize;

    // Without a corner pin each column samples the same place in every row,
    // so the sampling is worked out once per column and once per row, and
    // where the picture lands pixel for pixel — a grouped or blended cell the
    // size of its output — it is a copy.
    if projective.is_none() {
        let taps = |count: u32, origin: f64, extent: f64, start: f64, span: f64, size: usize| {
            (0..count)
                .map(|at| {
                    let local = (f64::from(at) + 0.5 - origin) / extent;
                    if !(0.0..1.0).contains(&local) {
                        return None;
                    }
                    let source =
                        ((start + local * span) * size as f64 - 0.5).clamp(0.0, (size - 1) as f64);
                    // A whole pixel within rounding is that pixel, so a cell
                    // the size of its output copies rather than blends.
                    let nearest = source.round();
                    let source = if (source - nearest).abs() < 1e-6 {
                        nearest
                    } else {
                        source
                    };
                    let low = source.floor();
                    let weight = ((source - low) * 256.0).round() as u32;
                    let low = low as usize;
                    Some((low, (low + 1).min(size - 1), weight.min(256), local))
                })
                .collect::<Vec<_>>()
        };
        let columns = taps(
            width,
            target_x,
            target_width,
            source_x,
            source_width,
            canvas_width,
        );
        let rows_taps = taps(
            height,
            target_y,
            target_height,
            source_y,
            source_height,
            canvas_height,
        );
        // The fade, out of 256, by column.
        let fades: Vec<u32> = columns
            .iter()
            .map(|tap| {
                tap.map_or(0, |(_, _, _, u)| {
                    (blend_weight(u, geometry.blend_left, geometry.blend_right, geometry.curve)
                        * 256.0)
                        .round() as u32
                })
            })
            .collect();
        // Pixel for pixel: every column a whole source pixel along from the
        // last, so a row is a copy, and only the fade is worked out.
        let aligned = color.is_none()
            && {
                let mut drawn = columns
                    .iter()
                    .enumerate()
                    .filter_map(|(at, tap)| tap.map(|tap| (at, tap)));
                match drawn.next() {
                    Some((first_at, (first_x, _, 0, _))) => {
                        drawn.all(|(at, (x, _, fx, _))| fx == 0 && x == first_x + (at - first_at))
                    }
                    _ => false,
                }
            }
            && rows_taps.iter().flatten().all(|&(_, _, fy, _)| fy == 0);
        if aligned {
            let span = columns
                .iter()
                .enumerate()
                .filter_map(|(at, tap)| tap.map(|(x, _, _, _)| (at, x)))
                .collect::<Vec<_>>();
            if let (Some(&(first, source_first)), Some(&(last, _))) = (span.first(), span.last()) {
                let fading: Vec<(usize, u32)> = fades
                    .iter()
                    .enumerate()
                    .filter(|(at, fade)| (first..=last).contains(at) && **fade < 256)
                    .map(|(at, fade)| (at, *fade))
                    .collect();
                for_each_row_band(out, output_width * 4, |rows, first_row| {
                    for (index, row) in rows.chunks_exact_mut(output_width * 4).enumerate() {
                        let Some((y, _, _, _)) = rows_taps[first_row + index] else {
                            fill_black(row);
                            continue;
                        };
                        let from = y * stride + source_first * 4;
                        let length = (last - first + 1) * 4;
                        fill_black(&mut row[..first * 4]);
                        fill_black(&mut row[first * 4 + length..]);
                        row[first * 4..first * 4 + length]
                            .copy_from_slice(&canvas[from..from + length]);
                        for &(at, fade) in &fading {
                            for channel in 0..3 {
                                let value = &mut row[at * 4 + channel];
                                *value = ((u32::from(*value) * fade + 128) >> 8) as u8;
                            }
                            row[at * 4 + 3] = 255;
                        }
                    }
                });
                return;
            }
        }

        for_each_row_band(out, output_width * 4, |rows, first_row| {
            for (index, row) in rows.chunks_exact_mut(output_width * 4).enumerate() {
                let Some((y0, y1, fy, _)) = rows_taps[first_row + index] else {
                    fill_black(row);
                    continue;
                };
                let (upper, lower) = (
                    &canvas[y0 * stride..(y0 + 1) * stride],
                    &canvas[y1 * stride..(y1 + 1) * stride],
                );
                for ((pixel, tap), fade) in row.chunks_exact_mut(4).zip(&columns).zip(&fades) {
                    pixel.copy_from_slice(&BLACK);
                    let Some((x0, x1, fx, _)) = *tap else {
                        continue;
                    };
                    let mut bgr = [0u32; 3];
                    if fx == 0 && fy == 0 {
                        for (channel, value) in bgr.iter_mut().enumerate() {
                            *value = u32::from(upper[x0 * 4 + channel]);
                        }
                    } else {
                        for (channel, value) in bgr.iter_mut().enumerate() {
                            let top = u32::from(upper[x0 * 4 + channel]) * (256 - fx)
                                + u32::from(upper[x1 * 4 + channel]) * fx;
                            let bottom = u32::from(lower[x0 * 4 + channel]) * (256 - fx)
                                + u32::from(lower[x1 * 4 + channel]) * fx;
                            *value = (top * (256 - fy) + bottom * fy + (1 << 15)) >> 16;
                        }
                    }
                    let bgr = match &tables {
                        Some(tables) => tables.apply(bgr),
                        None => bgr,
                    };
                    for (channel, value) in bgr.into_iter().enumerate() {
                        pixel[channel] = ((value * fade + 128) >> 8).min(255) as u8;
                    }
                }
            }
        });
        return;
    }

    // With a corner pin: each output pixel taken back through the inverse of
    // the pin to where it is in the picture. The three sums the homography
    // divides are linear across a row, so each is stepped rather than worked
    // out afresh, and the sample is in whole 256ths.
    let Some(m) = projective else {
        return;
    };
    let blends = geometry.blend_left > 0.0 || geometry.blend_right > 0.0;
    let (last_x, last_y) = ((canvas_width - 1) as f64, (canvas_height - 1) as f64);
    for_each_row_band(out, output_width * 4, |rows, first_row| {
        for (index, row) in rows.chunks_exact_mut(output_width * 4).enumerate() {
            let local_y = (first_row + index) as f64 + 0.5 - target_y;
            let first_x = 0.5 - target_x;
            let mut across = m[0] * first_x + m[1] * local_y + m[2];
            let mut down = m[3] * first_x + m[4] * local_y + m[5];
            let mut weight = m[6] * first_x + m[7] * local_y + m[8];
            for pixel in row.chunks_exact_mut(4) {
                pixel.copy_from_slice(&BLACK);
                let (w, a, d) = (weight, across, down);
                across += m[0];
                down += m[3];
                weight += m[6];
                if w.abs() < 1e-12 {
                    continue;
                }
                let (u, v) = (a / w / target_width, d / w / target_height);
                if !(0.0..1.0).contains(&u) || !(0.0..1.0).contains(&v) {
                    continue;
                }
                let x =
                    ((source_x + u * source_width) * canvas_width as f64 - 0.5).clamp(0.0, last_x);
                let y = ((source_y + v * source_height) * canvas_height as f64 - 0.5)
                    .clamp(0.0, last_y);
                let (x0, y0) = (x as usize, y as usize);
                let (x1, y1) = (
                    (x0 + 1).min(canvas_width - 1),
                    (y0 + 1).min(canvas_height - 1),
                );
                let fx = ((x - x0 as f64) * 256.0) as u32;
                let fy = ((y - y0 as f64) * 256.0) as u32;
                let (upper, lower) = (y0 * stride, y1 * stride);
                let mut bgr = [0u32; 3];
                for (channel, value) in bgr.iter_mut().enumerate() {
                    let top = u32::from(canvas[upper + x0 * 4 + channel]) * (256 - fx)
                        + u32::from(canvas[upper + x1 * 4 + channel]) * fx;
                    let bottom = u32::from(canvas[lower + x0 * 4 + channel]) * (256 - fx)
                        + u32::from(canvas[lower + x1 * 4 + channel]) * fx;
                    *value = (top * (256 - fy) + bottom * fy + (1 << 15)) >> 16;
                }
                if let Some(tables) = &tables {
                    bgr = tables.apply(bgr);
                }
                let fade = if blends {
                    (blend_weight(u, geometry.blend_left, geometry.blend_right, geometry.curve)
                        * 256.0) as u32
                } else {
                    256
                };
                for (channel, value) in bgr.into_iter().enumerate() {
                    pixel[channel] = ((value * fade + 128) >> 8).min(255) as u8;
                }
            }
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A canvas whose left half is red and right half blue, BGRA.
    fn halves(width: u32, height: u32) -> Vec<u8> {
        let mut bgra = Vec::new();
        for _ in 0..height {
            for x in 0..width {
                bgra.extend_from_slice(if x < width / 2 {
                    &[0, 0, 255, 255]
                } else {
                    &[255, 0, 0, 255]
                });
            }
        }
        bgra
    }

    fn pixel(frame: &[u8], width: u32, x: u32, y: u32) -> [u8; 4] {
        let at = ((y * width + x) * 4) as usize;
        [frame[at], frame[at + 1], frame[at + 2], frame[at + 3]]
    }

    fn arrangement(geometry: OutputGeometry) -> Arrangement {
        Arrangement {
            geometry,
            color: ColorAdjust::default(),
            corners: CornerPin::default(),
        }
    }

    fn whole() -> OutputGeometry {
        OutputGeometry {
            source: [0.0, 0.0, 1.0, 1.0],
            target: None,
            blend_left: 0.0,
            blend_right: 0.0,
            curve: BlendCurve::Linear,
        }
    }

    const RED: [u8; 4] = [0, 0, 255, 255];
    const BLUE: [u8; 4] = [255, 0, 0, 255];
    const BLACK: [u8; 4] = [0, 0, 0, 255];

    #[test]
    fn the_picture_as_it_is_needs_no_copy() {
        assert!(arrangement(whole()).is_identity());
        let cell = OutputGeometry {
            source: [0.5, 0.0, 0.5, 1.0],
            ..whole()
        };
        assert!(!arrangement(cell).is_identity());
    }

    #[test]
    fn a_grouped_output_shows_its_cell() {
        let canvas = halves(200, 100);
        let mut out = Vec::new();
        let right_half = arrangement(OutputGeometry {
            source: [0.5, 0.0, 0.5, 1.0],
            ..whole()
        });
        arrange(&canvas, (200, 100), &mut out, (100, 100), &right_half);
        assert_eq!(pixel(&out, 100, 5, 50), BLUE);
        assert_eq!(pixel(&out, 100, 95, 50), BLUE);
    }

    #[test]
    fn a_custom_target_leaves_the_rest_of_the_output_black() {
        let canvas = halves(100, 100);
        let mut out = Vec::new();
        let placed = arrangement(OutputGeometry {
            target: Some([50.0, 0.0, 100.0, 100.0]),
            ..whole()
        });
        arrange(&canvas, (100, 100), &mut out, (200, 100), &placed);
        assert_eq!(pixel(&out, 200, 10, 50), BLACK, "left of the target");
        assert_eq!(pixel(&out, 200, 60, 50), RED);
        assert_eq!(pixel(&out, 200, 140, 50), BLUE);
        assert_eq!(pixel(&out, 200, 190, 50), BLACK, "right of it");
    }

    #[test]
    fn a_cell_the_size_of_its_output_is_copied_exactly() {
        // Three columns of distinct colours, 300 wide, cut to its middle 100.
        let mut canvas = Vec::new();
        for _ in 0..10 {
            for x in 0..300u32 {
                canvas.extend_from_slice(&[(x % 256) as u8, 7, 9, 255]);
            }
        }
        let mut out = Vec::new();
        let middle = arrangement(OutputGeometry {
            source: [100.0 / 300.0, 0.0, 100.0 / 300.0, 1.0],
            ..whole()
        });
        arrange(&canvas, (300, 10), &mut out, (100, 10), &middle);
        for x in [0, 37, 99] {
            assert_eq!(
                pixel(&out, 100, x, 5),
                [(100 + x) as u8, 7, 9, 255],
                "column {x}"
            );
        }
    }

    #[test]
    fn a_blended_edge_fades_to_black_at_the_outside() {
        let canvas = vec![255u8; 100 * 10 * 4];
        let mut out = Vec::new();
        let blended = arrangement(OutputGeometry {
            blend_right: 0.2,
            ..whole()
        });
        arrange(&canvas, (100, 10), &mut out, (100, 10), &blended);
        assert_eq!(pixel(&out, 100, 50, 5)[0], 255, "untouched in the middle");
        let near_edge = pixel(&out, 100, 99, 5)[0];
        let into_overlap = pixel(&out, 100, 85, 5)[0];
        assert!(near_edge < 10, "almost black at the edge: {near_edge}");
        assert!(
            into_overlap > 80 && into_overlap < 200,
            "part way across: {into_overlap}"
        );
    }

    #[test]
    fn colour_changes_fold_into_one_and_the_default_changes_nothing() {
        assert!(ColorMatrix::of(&ColorAdjust::default()).is_none());
        let grey = ColorMatrix::of(&ColorAdjust {
            saturation: 0.0,
            ..ColorAdjust::default()
        })
        .unwrap();
        let [b, g, r] = grey.tables().apply([0, 0, 255]);
        assert!(
            b == g && g == r,
            "red with no saturation is grey: {r} {g} {b}"
        );
        let lifted = ColorMatrix::of(&ColorAdjust {
            black_level: 0.1,
            ..ColorAdjust::default()
        })
        .unwrap();
        assert_eq!(
            lifted.tables().apply([0, 0, 0]),
            [26, 26, 26],
            "black lifted a tenth"
        );
        assert_eq!(
            lifted.tables().apply([255, 255, 255]),
            [255, 255, 255],
            "white stays white"
        );
        let dim = ColorMatrix::of(&ColorAdjust {
            brightness: 0.5,
            ..ColorAdjust::default()
        })
        .unwrap();
        assert_eq!(dim.tables().apply([255, 255, 255]), [128, 128, 128]);
    }

    #[test]
    fn a_corner_pin_draws_the_picture_inside_its_new_corners() {
        let canvas = vec![255u8; 100 * 100 * 4];
        let mut out = Vec::new();
        let pinned = Arrangement {
            corners: CornerPin {
                top_left: [20.0, 20.0],
                top_right: [-20.0, 20.0],
                bottom_right: [0.0, 0.0],
                bottom_left: [0.0, 0.0],
            },
            ..arrangement(whole())
        };
        arrange(&canvas, (100, 100), &mut out, (100, 100), &pinned);
        assert_eq!(pixel(&out, 100, 5, 5), BLACK, "the top corner pulled in");
        assert_eq!(
            pixel(&out, 100, 50, 50),
            [255, 255, 255, 255],
            "the middle still drawn"
        );
        assert_eq!(
            pixel(&out, 100, 2, 97),
            [255, 255, 255, 255],
            "the bottom corner where it was"
        );
    }
}
