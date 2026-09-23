//! python-pptx's `Image.ext`: the extension Pillow's format detection gives an
//! image part, or nothing when Pillow cannot name one of the six formats
//! python-pptx maps — in which case parse_pptx.py exports the picture as an
//! empty PNG.
//!
//! Pillow opens by content, not by file name, so this looks at the bytes the
//! way the matching Pillow plugins' `_accept` functions do. A JPEG carrying a
//! multi-picture index is `MPO` to Pillow, which python-pptx does not map.

/// `bmp`, `gif`, `jpg`, `png`, `tiff` or `wmf`, or `None` for anything else.
pub fn python_pptx_ext(bytes: &[u8]) -> Option<&'static str> {
    if bytes.starts_with(b"\x89PNG\r\n\x1a\n") {
        return Some("png");
    }
    if bytes.starts_with(b"\xFF\xD8\xFF") {
        return (!is_multi_picture_jpeg(bytes)).then_some("jpg");
    }
    if bytes.starts_with(b"GIF87a") || bytes.starts_with(b"GIF89a") {
        return Some("gif");
    }
    if bytes.starts_with(b"BM") {
        return Some("bmp");
    }
    if [
        &b"MM\x00\x2A"[..],
        b"II\x2A\x00",
        b"MM\x2A\x00",
        b"II\x00\x2A",
        b"MM\x00\x2B",
        b"II\x2B\x00",
    ]
    .iter()
    .any(|prefix| bytes.starts_with(prefix))
    {
        return Some("tiff");
    }
    // Pillow's WMF plugin also accepts EMF, and names both WMF.
    if bytes.starts_with(b"\xD7\xCD\xC6\x9A\x00\x00") || bytes.starts_with(b"\x01\x00\x00\x00") {
        return Some("wmf");
    }
    None
}

/// A JPEG with an `APP2` "MPF" segment indexing more than one picture, which
/// Pillow opens as `MPO`.
fn is_multi_picture_jpeg(bytes: &[u8]) -> bool {
    let mut position = 2;
    while position + 4 <= bytes.len() {
        if bytes[position] != 0xFF {
            return false;
        }
        let marker = bytes[position + 1];
        // Start of scan: no more metadata segments.
        if marker == 0xDA || marker == 0xD9 {
            return false;
        }
        let length = u16::from_be_bytes([bytes[position + 2], bytes[position + 3]]) as usize;
        let segment_start = position + 4;
        let segment_end = (position + 2 + length).min(bytes.len());
        if marker == 0xE2 && bytes[segment_start..segment_end].starts_with(b"MPF\x00") {
            return mpf_image_count(&bytes[segment_start + 4..segment_end])
                .is_some_and(|count| count > 1);
        }
        if length < 2 {
            return false;
        }
        position += 2 + length;
    }
    false
}

/// The `NumberOfImages` (0xB001) entry of an MP index IFD.
fn mpf_image_count(tiff: &[u8]) -> Option<u32> {
    let big_endian = match tiff.get(..2)? {
        b"MM" => true,
        b"II" => false,
        _ => return None,
    };
    let u16_at = |offset: usize| -> Option<u16> {
        let pair = tiff.get(offset..offset + 2)?;
        Some(if big_endian {
            u16::from_be_bytes([pair[0], pair[1]])
        } else {
            u16::from_le_bytes([pair[0], pair[1]])
        })
    };
    let u32_at = |offset: usize| -> Option<u32> {
        let quad = tiff.get(offset..offset + 4)?;
        let array = [quad[0], quad[1], quad[2], quad[3]];
        Some(if big_endian {
            u32::from_be_bytes(array)
        } else {
            u32::from_le_bytes(array)
        })
    };
    let ifd = u32_at(4)? as usize;
    let count = u16_at(ifd)? as usize;
    (0..count).find_map(|index| {
        let entry = ifd + 2 + index * 12;
        (u16_at(entry)? == 0xB001)
            .then(|| u32_at(entry + 8))
            .flatten()
    })
}

/// `detect_image_format_from_content_type`, for background pictures, which
/// parse_pptx.py names from the part's content type rather than through Pillow.
pub fn format_from_content_type(content_type: Option<&str>, part_name: Option<&str>) -> String {
    if let Some(content_type) = content_type.filter(|value| value.contains('/')) {
        let format = content_type
            .split_once('/')
            .map(|(_, subtype)| subtype.trim().to_lowercase())
            .unwrap_or_default();
        return if format == "jpeg" || format == "jpg" {
            "jpg".to_owned()
        } else {
            format
        };
    }
    if let Some(name) = part_name {
        // os.path.splitext on the part name.
        let file = name.rsplit('/').next().unwrap_or(name);
        let extension = match file.rfind('.') {
            Some(dot) if file[..dot].chars().any(|c| c != '.') => file[dot + 1..].to_lowercase(),
            _ => String::new(),
        };
        if extension == "jpeg" {
            return "jpg".to_owned();
        }
        if !extension.is_empty() {
            return extension;
        }
    }
    "png".to_owned()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn formats_are_named_from_their_bytes_like_pillow() {
        assert_eq!(python_pptx_ext(b"\x89PNG\r\n\x1a\nrest"), Some("png"));
        assert_eq!(
            python_pptx_ext(b"\xFF\xD8\xFF\xE0\x00\x10JFIF"),
            Some("jpg")
        );
        assert_eq!(python_pptx_ext(b"GIF89a..."), Some("gif"));
        assert_eq!(python_pptx_ext(b"BM...."), Some("bmp"));
        assert_eq!(python_pptx_ext(b"II\x2A\x00...."), Some("tiff"));
        assert_eq!(python_pptx_ext(b"\x01\x00\x00\x00 EMF"), Some("wmf"));
        assert_eq!(
            python_pptx_ext(b"RIFF....WEBPVP8 "),
            None,
            "Pillow knows WebP; python-pptx does not"
        );
        assert_eq!(python_pptx_ext(b"<svg xmlns"), None);
    }

    #[test]
    fn a_jpeg_indexing_several_pictures_is_mpo() {
        // APP2 "MPF" with a big-endian IFD holding NumberOfImages = 2.
        let mut ifd = Vec::new();
        ifd.extend_from_slice(b"MM\x00\x2A\x00\x00\x00\x08");
        ifd.extend_from_slice(&1u16.to_be_bytes());
        ifd.extend_from_slice(&0xB001u16.to_be_bytes());
        ifd.extend_from_slice(&4u16.to_be_bytes());
        ifd.extend_from_slice(&1u32.to_be_bytes());
        ifd.extend_from_slice(&2u32.to_be_bytes());
        let mut segment = b"MPF\x00".to_vec();
        segment.extend_from_slice(&ifd);
        let mut jpeg = b"\xFF\xD8\xFF\xE2".to_vec();
        jpeg.extend_from_slice(&((segment.len() + 2) as u16).to_be_bytes());
        jpeg.extend_from_slice(&segment);
        jpeg.extend_from_slice(b"\xFF\xDA\x00\x02");
        assert_eq!(python_pptx_ext(&jpeg), None);

        let single = jpeg.clone();
        let count_at = single.len() - 4 - 4;
        let mut single = single;
        single[count_at..count_at + 4].copy_from_slice(&1u32.to_be_bytes());
        assert_eq!(python_pptx_ext(&single), Some("jpg"));
    }

    #[test]
    fn background_formats_come_from_the_content_type_then_the_name() {
        assert_eq!(format_from_content_type(Some("image/jpeg"), None), "jpg");
        assert_eq!(format_from_content_type(Some("image/x-emf"), None), "x-emf");
        assert_eq!(
            format_from_content_type(None, Some("/ppt/media/image3.JPEG")),
            "jpg"
        );
        assert_eq!(
            format_from_content_type(None, Some("/ppt/media/image3")),
            "png"
        );
    }
}
