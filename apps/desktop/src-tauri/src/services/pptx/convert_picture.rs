//! Pictures a deck carries that no renderer here can draw, turned into PNG
//! as the deck is imported.
//!
//! The webview cannot draw a Windows metafile (EMF, WMF) — the usual preview
//! of an embedded object, an equation or an old clip-art picture — and the
//! compositor that draws the screens decodes only PNG, JPEG, GIF and WebP.
//! So a BMP or TIFF is decoded and saved again as PNG, and a metafile is
//! played into SVG (`emf-core`, which reads WMF too) and drawn (`resvg`).
//!
//! **A metafile is played in a process of its own.** A release build stops
//! on any panic (`panic = "abort"`), and a metafile is a list of drawing
//! commands from someone else's computer: one the player cannot handle must
//! cost that picture, not the whole app. The app's own executable is run
//! with [`HELPER_ARG`] (`main.rs` answers it before anything else starts),
//! given the file on its standard input, and returns the PNG on its output.

use std::io::{Read, Write};
use std::process::{Command, Stdio};
use std::sync::{Arc, OnceLock};
use std::time::{Duration, Instant};

/// The argument that makes the executable a picture converter and nothing else.
pub const HELPER_ARG: &str = "--present-convert-picture";

/// The longest side a drawn metafile or SVG is given, in pixels.
const LONGEST_SIDE: f32 = 1600.0;
/// How long a metafile may take to draw before it is given up on.
const HELPER_TIMEOUT: Duration = Duration::from_secs(15);

/// Whether a picture of this kind needs turning into PNG to be drawn.
pub fn needs_conversion(extension: &str) -> bool {
    matches!(extension, "bmp" | "tiff" | "emf" | "wmf" | "svg")
}

/// The picture as PNG, or None if it cannot be drawn.
pub fn to_png(bytes: &[u8], extension: &str) -> Option<Vec<u8>> {
    match extension {
        "bmp" | "tiff" => raster_to_png(bytes),
        "svg" => svg_to_png(bytes),
        "emf" | "wmf" => metafile_in_helper(bytes),
        _ => None,
    }
}

/// `main`: when the executable was started as a converter, convert standard
/// input to standard output and say so; the caller then exits.
pub fn run_helper_if_asked() -> bool {
    if std::env::args().nth(1).as_deref() != Some(HELPER_ARG) {
        return false;
    }
    let mut input = Vec::new();
    let converted = std::io::stdin()
        .read_to_end(&mut input)
        .ok()
        .and_then(|_| metafile_to_png(&input));
    match converted {
        Some(png) => {
            let _ = std::io::stdout().write_all(&png);
            std::process::exit(0);
        }
        None => std::process::exit(1),
    }
}

/// A BMP or TIFF, decoded and saved again as PNG.
fn raster_to_png(bytes: &[u8]) -> Option<Vec<u8>> {
    let image = image::load_from_memory(bytes).ok()?;
    let mut png = Vec::new();
    image
        .write_to(&mut std::io::Cursor::new(&mut png), image::ImageFormat::Png)
        .ok()?;
    Some(png)
}

/// A metafile played into SVG and drawn. In this process: only the helper
/// and the tests call it.
pub fn metafile_to_png(bytes: &[u8]) -> Option<Vec<u8>> {
    let svg = emf_core::converter::convert_to_svg(bytes).ok()?;
    svg_to_png(&inline_bitmaps_as_png(&svg, &emf_bitmaps(bytes)))
}

fn u32_at(bytes: &[u8], at: usize) -> Option<u32> {
    bytes
        .get(at..at + 4)
        .map(|b| u32::from_le_bytes([b[0], b[1], b[2], b[3]]))
}

/// A bitmap an EMF draws: its pixels as PNG (None when the converter's own
/// reading is as good), and where it lands, in the same units as the SVG.
#[derive(Debug, Clone, Default, PartialEq)]
struct EmfBitmap {
    png: Option<Vec<u8>>,
    rect: Option<(f64, f64, f64, f64)>,
}

fn i32_at(bytes: &[u8], at: usize) -> Option<i32> {
    bytes
        .get(at..at + 4)
        .map(|b| i32::from_le_bytes([b[0], b[1], b[2], b[3]]))
}

/// Each bitmap an EMF draws, in the order it draws them.
///
/// The converter writes some bitmaps as black squares — a 32-bit one with
/// colour masks, which is how an embedded object's icon (an `ALPHABLEND`
/// with its own transparency) is usually kept — and sizes a stretched one
/// by its pixels rather than by where it is drawn. Both are read here: the
/// pixels, and the box through the file's window-to-viewport mapping.
fn emf_bitmaps(emf: &[u8]) -> Vec<EmfBitmap> {
    const SETWINDOWEXTEX: u32 = 9;
    const SETWINDOWORGEX: u32 = 10;
    const SETVIEWPORTEXTEX: u32 = 11;
    const SETVIEWPORTORGEX: u32 = 12;
    const SETMAPMODE: u32 = 17;
    const BITBLT: u32 = 76;
    const STRETCHBLT: u32 = 77;
    const SETDIBITSTODEVICE: u32 = 80;
    const STRETCHDIBITS: u32 = 81;
    const ALPHABLEND: u32 = 114;
    const TRANSPARENTBLT: u32 = 116;
    // The mapping from logical units to the device units the SVG is in.
    let (mut window_org, mut window_ext) = ((0.0, 0.0), (1.0, 1.0));
    let (mut viewport_org, mut viewport_ext) = ((0.0, 0.0), (1.0, 1.0));
    let mut scaled = false;
    let pair = |record: &[u8], at: usize| {
        Some((
            f64::from(i32_at(record, at)?),
            f64::from(i32_at(record, at + 4)?),
        ))
    };

    let mut found = Vec::new();
    let mut at = 0usize;
    while let (Some(kind), Some(size)) = (u32_at(emf, at), u32_at(emf, at + 4)) {
        let size = size as usize;
        if size < 8 || at + size > emf.len() {
            break;
        }
        let record = &emf[at..at + size];
        match kind {
            // Anisotropic and isotropic map by the extents; the rest are fixed
            // scales the converter treats as one to one, as is done here.
            SETMAPMODE => scaled = matches!(u32_at(record, 8), Some(7 | 8)),
            SETWINDOWORGEX => window_org = pair(record, 8).unwrap_or(window_org),
            SETWINDOWEXTEX => window_ext = pair(record, 8).unwrap_or(window_ext),
            SETVIEWPORTORGEX => viewport_org = pair(record, 8).unwrap_or(viewport_org),
            SETVIEWPORTEXTEX => viewport_ext = pair(record, 8).unwrap_or(viewport_ext),
            _ => {}
        }
        let to_device = |x: f64, y: f64| {
            if scaled && window_ext.0 != 0.0 && window_ext.1 != 0.0 {
                (
                    (x - window_org.0) * viewport_ext.0 / window_ext.0 + viewport_org.0,
                    (y - window_org.1) * viewport_ext.1 / window_ext.1 + viewport_org.1,
                )
            } else {
                (x, y)
            }
        };
        // Where the bitmap's header and pixels are said to be, and its box.
        let layout = match kind {
            BITBLT | STRETCHBLT | ALPHABLEND | TRANSPARENTBLT => Some((84, 24, Some(32))),
            STRETCHDIBITS => Some((48, 24, Some(72))),
            SETDIBITSTODEVICE => Some((48, 24, Some(40))),
            _ => None,
        };
        if let Some((fields, origin, extent)) = layout {
            let header = u32_at(record, fields).zip(u32_at(record, fields + 4));
            let pixels = u32_at(record, fields + 8).zip(u32_at(record, fields + 12));
            // A blit with no bitmap of its own only paints: nothing to read.
            if header.is_some_and(|(_, length)| length > 0) {
                let premultiplied = kind == ALPHABLEND && record.get(43) == Some(&1);
                let png = header.zip(pixels).and_then(|((ho, hl), (po, pl))| {
                    let header = record.get(ho as usize..(ho + hl) as usize)?;
                    let pixels = record.get(po as usize..(po + pl) as usize)?;
                    dib_to_png(header, pixels, premultiplied)
                });
                let rect = pair(record, origin)
                    .zip(extent.and_then(|e| pair(record, e)))
                    .map(|((x, y), (w, h))| {
                        let (x0, y0) = to_device(x, y);
                        let (x1, y1) = to_device(x + w, y + h);
                        (x0.min(x1), y0.min(y1), (x1 - x0).abs(), (y1 - y0).abs())
                    });
                found.push(EmfBitmap { png, rect });
            }
        }
        at += size;
    }
    found
}

/// A 24- or 32-bit device-independent bitmap as PNG, its transparency kept.
fn dib_to_png(header: &[u8], pixels: &[u8], premultiplied: bool) -> Option<Vec<u8>> {
    let width = i32::from_le_bytes(header.get(4..8)?.try_into().ok()?);
    let height = i32::from_le_bytes(header.get(8..12)?.try_into().ok()?);
    let bits = u16::from_le_bytes(header.get(14..16)?.try_into().ok()?);
    let compression = u32_at(header, 16)?;
    // Plain pixels, or "bit fields" in the usual order: blue, green, red.
    if !(compression == 0 || compression == 3) || !(bits == 24 || bits == 32) {
        return None;
    }
    let (w, h) = (
        width.unsigned_abs() as usize,
        height.unsigned_abs() as usize,
    );
    if w == 0 || h == 0 || w > 8192 || h > 8192 {
        return None;
    }
    let step = usize::from(bits / 8);
    let stride = (w * step + 3) & !3;
    if pixels.len() < stride * h {
        return None;
    }
    let mut image = image::RgbaImage::new(w as u32, h as u32);
    let has_alpha = bits == 32 && pixels.chunks(4).any(|p| p.len() == 4 && p[3] != 0);
    for row in 0..h {
        // A positive height is stored bottom row first.
        let y = if height > 0 { h - 1 - row } else { row };
        for x in 0..w {
            let p = &pixels[row * stride + x * step..row * stride + x * step + step];
            let alpha = if has_alpha { p[3] } else { 255 };
            let undo = |c: u8| {
                if premultiplied && alpha > 0 && alpha < 255 {
                    ((u32::from(c) * 255 + u32::from(alpha) / 2) / u32::from(alpha)).min(255) as u8
                } else {
                    c
                }
            };
            image.put_pixel(
                x as u32,
                y as u32,
                image::Rgba([undo(p[2]), undo(p[1]), undo(p[0]), alpha]),
            );
        }
    }
    let mut png = Vec::new();
    image
        .write_to(&mut std::io::Cursor::new(&mut png), image::ImageFormat::Png)
        .ok()?;
    Some(png)
}

/// An `<image …` tag (without its `>`) moved into a box and stretched to it.
fn place_image(tag: &str, x: f64, y: f64, w: f64, h: f64) -> String {
    let mut kept = String::new();
    // Every attribute but the box, kept as written.
    let attributes = regex::Regex::new(r#"\s([\w:-]+)="([^"]*)""#).expect("pattern");
    for found in attributes.captures_iter(tag) {
        let name = &found[1];
        if !matches!(name, "x" | "y" | "width" | "height" | "preserveAspectRatio") {
            kept.push_str(&format!(" {name}=\"{}\"", &found[2]));
        }
    }
    format!(r#"<image x="{x}" y="{y}" width="{w}" height="{h}" preserveAspectRatio="none"{kept}"#)
}

/// A metafile's bitmap as the converter writes it can say "bit fields"
/// (compression 3) with no colour masks after its header, for plain 24- or
/// 32-bit pixels; no decoder reads that. Said plainly (no compression), it is
/// the picture it holds.
fn repair_bmp(mut bmp: Vec<u8>) -> Vec<u8> {
    let read_u32 = |bytes: &[u8], at: usize| {
        bytes
            .get(at..at + 4)
            .map(|b| u32::from_le_bytes([b[0], b[1], b[2], b[3]]))
    };
    let offset = read_u32(&bmp, 10);
    let header = read_u32(&bmp, 14);
    let bits = bmp.get(28..30).map(|b| u16::from_le_bytes([b[0], b[1]]));
    let compression = read_u32(&bmp, 30);
    let masks_missing = matches!((offset, header), (Some(o), Some(h)) if o == 14 + h);
    if bmp.starts_with(b"BM")
        && compression == Some(3)
        && matches!(bits, Some(24 | 32))
        && masks_missing
    {
        bmp[30..34].copy_from_slice(&0u32.to_le_bytes());
    }
    bmp
}

/// The SVG with each BMP it embeds (a metafile's bitmap records, such as an
/// embedded object's icon) turned into PNG, which the drawing reads.
fn inline_bitmaps_as_png(svg: &[u8], read_here: &[EmfBitmap]) -> Vec<u8> {
    use base64::Engine;
    const BMP: &str = "data:image/bmp;base64,";
    let text = String::from_utf8_lossy(svg);
    if !text.contains(BMP) {
        return svg.to_vec();
    }
    let mut out = String::with_capacity(text.len());
    let mut rest: &str = &text;
    let mut index = 0;
    while let Some(at) = rest.find(BMP) {
        out.push_str(&rest[..at]);
        let data_start = at + BMP.len();
        let data_end = rest[data_start..]
            .find(|c: char| !(c.is_ascii_alphanumeric() || matches!(c, '+' | '/' | '=')))
            .map_or(rest.len(), |end| data_start + end);
        // The bitmap as read here when it could be, else the converter's.
        let own = read_here.get(index);
        let png = own.and_then(|bitmap| bitmap.png.clone()).or_else(|| {
            base64::engine::general_purpose::STANDARD
                .decode(&rest[data_start..data_end])
                .ok()
                .and_then(|bmp| raster_to_png(&repair_bmp(bmp)))
        });
        index += 1;
        match png {
            Some(png) => {
                out.push_str("data:image/png;base64,");
                out.push_str(&base64::engine::general_purpose::STANDARD.encode(png));
            }
            None => out.push_str(&rest[at..data_end]),
        }
        rest = &rest[data_end..];
        // The box it is drawn in, as the file says, over the converter's.
        if let Some((x, y, w, h)) = own.and_then(|bitmap| bitmap.rect) {
            if let Some(tag_end) = rest.find('>') {
                let tag_start = out.rfind("<image").unwrap_or(out.len());
                let tag = format!("{}{}", &out[tag_start..], &rest[..tag_end]);
                let boxed = place_image(&tag, x, y, w, h);
                out.truncate(tag_start);
                out.push_str(&boxed);
                rest = &rest[tag_end..];
            }
        }
    }
    out.push_str(rest);
    out.into_bytes()
}

/// The fonts an SVG's words are drawn in: this computer's, read once.
fn fonts() -> Arc<resvg::usvg::fontdb::Database> {
    static FONTS: OnceLock<Arc<resvg::usvg::fontdb::Database>> = OnceLock::new();
    FONTS
        .get_or_init(|| {
            let mut database = resvg::usvg::fontdb::Database::new();
            database.load_system_fonts();
            Arc::new(database)
        })
        .clone()
}

/// An SVG drawn with its longest side [`LONGEST_SIDE`] pixels.
fn svg_to_png(svg: &[u8]) -> Option<Vec<u8>> {
    let options = resvg::usvg::Options {
        fontdb: fonts(),
        ..Default::default()
    };
    let tree = resvg::usvg::Tree::from_data(svg, &options).ok()?;
    let size = tree.size();
    let longest = size.width().max(size.height());
    if !(longest.is_finite() && longest > 0.0) {
        return None;
    }
    let scale = (LONGEST_SIDE / longest).clamp(0.05, 200.0);
    let width = (size.width() * scale).ceil().max(1.0) as u32;
    let height = (size.height() * scale).ceil().max(1.0) as u32;
    let mut pixmap = resvg::tiny_skia::Pixmap::new(width, height)?;
    resvg::render(
        &tree,
        resvg::tiny_skia::Transform::from_scale(scale, scale),
        &mut pixmap.as_mut(),
    );
    pixmap.encode_png().ok()
}

/// A metafile converted by a copy of this executable, so a crash in the
/// player ends that copy only.
fn metafile_in_helper(bytes: &[u8]) -> Option<Vec<u8>> {
    let executable = std::env::current_exe().ok()?;
    let mut child = Command::new(executable)
        .arg(HELPER_ARG)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .ok()?;
    let mut stdin = child.stdin.take()?;
    let input = bytes.to_vec();
    let writer = std::thread::spawn(move || {
        let _ = stdin.write_all(&input);
    });
    let mut stdout = child.stdout.take()?;
    let reader = std::thread::spawn(move || {
        let mut output = Vec::new();
        let _ = stdout.read_to_end(&mut output);
        output
    });

    let started = Instant::now();
    let status = loop {
        match child.try_wait() {
            Ok(Some(status)) => break Some(status),
            Ok(None) if started.elapsed() < HELPER_TIMEOUT => {
                std::thread::sleep(Duration::from_millis(20));
            }
            _ => {
                let _ = child.kill();
                let _ = child.wait();
                break None;
            }
        }
    };
    let _ = writer.join();
    let output = reader.join().ok()?;
    match status {
        Some(status) if status.success() && output.starts_with(b"\x89PNG") => Some(output),
        _ => {
            tracing::info!("[pptx] a metafile picture could not be drawn; it is left out");
            None
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A one-pixel BMP: 24-bit, bottom-up, red.
    fn tiny_bmp() -> Vec<u8> {
        let mut bmp = Vec::new();
        bmp.extend_from_slice(b"BM");
        bmp.extend_from_slice(&58u32.to_le_bytes()); // file size
        bmp.extend_from_slice(&0u32.to_le_bytes());
        bmp.extend_from_slice(&54u32.to_le_bytes()); // pixel data offset
        bmp.extend_from_slice(&40u32.to_le_bytes()); // header size
        bmp.extend_from_slice(&1i32.to_le_bytes()); // width
        bmp.extend_from_slice(&1i32.to_le_bytes()); // height
        bmp.extend_from_slice(&1u16.to_le_bytes()); // planes
        bmp.extend_from_slice(&24u16.to_le_bytes()); // bits per pixel
        bmp.extend_from_slice(&[0; 24]); // compression .. important colours
        bmp.extend_from_slice(&[0, 0, 255, 0]); // one BGR pixel, padded to 4
        bmp
    }

    #[test]
    fn a_bmp_becomes_a_png() {
        let png = to_png(&tiny_bmp(), "bmp").expect("converted");
        assert!(png.starts_with(b"\x89PNG"));
        let image = image::load_from_memory(&png).expect("readable").to_rgba8();
        assert_eq!(image.get_pixel(0, 0).0, [255, 0, 0, 255]);
    }

    #[test]
    fn an_svg_is_drawn_at_a_useful_size() {
        let svg = br##"<svg xmlns="http://www.w3.org/2000/svg" width="40" height="20"><rect width="40" height="20" fill="#00ff00"/></svg>"##;
        let png = to_png(svg, "svg").expect("drawn");
        let image = image::load_from_memory(&png).expect("readable").to_rgba8();
        assert_eq!((image.width(), image.height()), (1600, 800));
        assert_eq!(image.get_pixel(800, 400).0, [0, 255, 0, 255]);
    }

    #[test]
    fn a_bitmap_inside_a_metafile_is_drawn() {
        use base64::Engine;
        let bmp = base64::engine::general_purpose::STANDARD.encode(tiny_bmp());
        let svg = format!(
            r#"<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><image width="10" height="10" href="data:image/bmp;base64,{bmp}"/></svg>"#
        );
        let inlined = inline_bitmaps_as_png(svg.as_bytes(), &[]);
        assert!(String::from_utf8_lossy(&inlined).contains("data:image/png;base64,"));
        let png = svg_to_png(&inlined).expect("drawn");
        let image = image::load_from_memory(&png).expect("readable").to_rgba8();
        assert_eq!(
            image.get_pixel(800, 800).0[3],
            255,
            "the bitmap is drawn, not left blank"
        );
    }

    #[test]
    fn a_bitmap_marked_bit_fields_without_masks_still_reads() {
        let mut bmp = tiny_bmp();
        bmp[30..34].copy_from_slice(&3u32.to_le_bytes());
        assert!(raster_to_png(&bmp).is_none(), "as written, unreadable");
        assert!(raster_to_png(&repair_bmp(bmp)).is_some());
    }

    #[test]
    fn a_32_bit_bitmap_keeps_its_colours_and_transparency() {
        // Two pixels, bottom row first: opaque red, then see-through.
        let mut header = vec![0u8; 40];
        header[0..4].copy_from_slice(&40u32.to_le_bytes());
        header[4..8].copy_from_slice(&2i32.to_le_bytes());
        header[8..12].copy_from_slice(&1i32.to_le_bytes());
        header[14..16].copy_from_slice(&32u16.to_le_bytes());
        header[16..20].copy_from_slice(&3u32.to_le_bytes());
        let pixels = [0, 0, 255, 255, 0, 0, 0, 0];
        let png = dib_to_png(&header, &pixels, true).expect("read");
        let image = image::load_from_memory(&png).unwrap().to_rgba8();
        assert_eq!(image.get_pixel(0, 0).0, [255, 0, 0, 255]);
        assert_eq!(image.get_pixel(1, 0).0[3], 0);
    }

    #[test]
    fn a_metafile_that_is_not_one_is_left_out() {
        assert!(metafile_to_png(b"\x01\x00\x00\x00 not really an EMF").is_none());
    }

    #[test]
    fn only_what_cannot_be_drawn_is_converted() {
        assert!(needs_conversion("emf") && needs_conversion("tiff"));
        assert!(!needs_conversion("png") && !needs_conversion("jpeg"));
    }
}
