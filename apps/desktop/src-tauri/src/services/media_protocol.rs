//! The `local-media://` scheme, with a containment check in front of it.
//!
//! Electron registers this scheme and hands the URL pathname straight to
//! `fs.stat` and `fs.createReadStream` (`protocol.service.ts:135-198`). There is
//! no check of any kind, so the renderer can read every file the operator can.
//! That is known-issues §3, and closing it is the Stage 3 gate.
//!
//! The URL shape is unchanged — `local-media://media/absolute/path` — so the
//! React code that builds these URLs keeps working untouched. What changes is
//! that a path outside the operator's media folders now returns 403 instead of
//! the file.
//!
//! **Memory.** Electron streams the file; a Tauri custom-scheme response is a
//! `Vec<u8>`, so a whole 4 GB service video cannot be handed over in one piece.
//! Every response is therefore capped: a range request is truncated to
//! `MAX_CHUNK`, and a request with no `Range` header for a file larger than
//! `MAX_INLINE` is answered with 206 and the first chunk. Both webviews follow
//! up with ranges, which is how video playback works in practice anyway.

use std::path::{Path, PathBuf};

// Tauri re-exports the `http` crate it builds responses from; taking it from
// there keeps the version pinned to whatever the runtime expects.
use tauri::http;

use crate::state::file_state::FileState;

/// Largest body served in one response.
const MAX_CHUNK: u64 = 8 * 1024 * 1024;
/// Largest file served whole when the caller sent no `Range` header.
const MAX_INLINE: u64 = 16 * 1024 * 1024;

/// What the handler decided to do with a request, before any I/O.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Served {
    /// Bytes `start..=end` inclusive, as a 206 with a `Content-Range`.
    Range { start: u64, end: u64, total: u64 },
    /// The whole file, as a 200.
    Whole { total: u64 },
}

/// Turn a `local-media` request URI into the absolute path it names.
///
/// Two URL shapes reach us. `local-media://media/<path>` is what the app builds
/// on macOS and Linux, unchanged from Electron, where the host is the dummy
/// `media` that a `standard: true` scheme requires and the pathname is the real
/// path. On Windows the webview rewrites custom schemes to
/// `http://local-media.localhost/media/<path>`, which arrives with the dummy
/// host folded into the path.
pub fn path_from_uri(uri: &str) -> Option<PathBuf> {
    let (host, raw_path) = split_uri(uri)?;
    let decoded = percent_decode(raw_path);

    let path = if host == "media" {
        decoded
    } else {
        // `http://local-media.localhost/media/C:/…`
        decoded
            .strip_prefix("/media/")
            .map(|rest| format!("/{rest}"))
            .unwrap_or(decoded)
    };

    // `/C:/Users/…` on Windows. Electron strips the same leading slash
    // (`protocol.service.ts:143-145`).
    let path = match path.strip_prefix('/') {
        Some(rest) if is_windows_drive_path(rest) => rest.to_owned(),
        _ => path,
    };

    // `local-media://media/` names the filesystem root, which is never a media
    // file. The scope would refuse it anyway; refusing here keeps a 400 out of
    // the "denied" log, where it would look like an attempt to escape.
    if path.is_empty() || path == "/" {
        return None;
    }
    Some(PathBuf::from(path))
}

/// Build the URL the webview should fetch for a local file.
///
/// macOS and Linux keep the Electron form exactly — `createLocalMediaUrl` in
/// `file.ipc.ts:43-44` and `createMediaUrl` in `useMediaFolders.ts:154-155`
/// produce the same string — so a URL made in Rust and one made in React are
/// interchangeable. WebView2 does not resolve custom schemes, so Windows gets
/// the `http://<scheme>.localhost/` form Tauri rewrites them to.
pub fn url_for(path: &Path) -> String {
    let encoded = encode_uri(&path.to_string_lossy());
    let encoded = if encoded.starts_with('/') {
        encoded
    } else {
        // A Windows path has no leading slash of its own.
        format!("/{encoded}")
    };

    if cfg!(target_os = "windows") {
        format!("http://local-media.localhost/media{encoded}")
    } else {
        format!("local-media://media{encoded}")
    }
}

/// `encodeURI` with two characters added to the escape set.
///
/// `encodeURI` leaves `#` and `?` alone because in a normal URL they start the
/// fragment and the query. In a filename they are just characters, so leaving
/// them raw truncates the path — a file called `Set #2.mp4` is unplayable in the
/// Electron build for exactly that reason. Escaping them is the only difference
/// from what the React helper produces today, and `src/renderer/tauri/` uses
/// this same rule so both sides agree.
fn encode_uri(value: &str) -> String {
    const UNRESERVED: &[u8] = b"-_.!~*'()";
    const RESERVED: &[u8] = b";,/:@&=+$";

    let mut out = String::with_capacity(value.len());
    for byte in value.as_bytes() {
        if byte.is_ascii_alphanumeric() || UNRESERVED.contains(byte) || RESERVED.contains(byte) {
            out.push(*byte as char);
        } else {
            out.push_str(&format!("%{byte:02X}"));
        }
    }
    out
}

/// Decide which bytes to send. `range` is the raw `Range` header, if any.
pub fn plan(total: u64, range: Option<&str>) -> Option<Served> {
    match range {
        Some(header) => {
            let (start, end) = parse_range(header, total)?;
            let end = end.min(start.saturating_add(MAX_CHUNK - 1));
            Some(Served::Range { start, end, total })
        }
        // No `Range` header. Small files — every image, and short clips — go
        // whole, which is what an `<img>` needs. A large one gets its opening
        // chunk and the webview asks for the rest by range.
        None if total <= MAX_INLINE => Some(Served::Whole { total }),
        None if total == 0 => Some(Served::Whole { total }),
        None => Some(Served::Range {
            start: 0,
            end: MAX_CHUNK - 1,
            total,
        }),
    }
}

/// `bytes=start-end`, `bytes=start-` and `bytes=-suffix`.
///
/// Electron's parser handles only the first two — `parseInt("")` on the suffix
/// form yields `NaN` and produces a nonsense `Content-Range`
/// (`protocol.service.ts:180-183`). Handling all three costs nothing.
fn parse_range(header: &str, total: u64) -> Option<(u64, u64)> {
    if total == 0 {
        return None;
    }
    let spec = header.trim().strip_prefix("bytes=")?.trim();
    // A multi-range request asks for several spans in one go. Neither webview
    // sends one for media; answering the first span alone would be wrong, so
    // decline and let the caller retry.
    if spec.contains(',') {
        return None;
    }
    let (start, end) = spec.split_once('-')?;
    let (start, end) = (start.trim(), end.trim());

    let (start, end) = if start.is_empty() {
        // `bytes=-500`: the last 500 bytes.
        let suffix: u64 = end.parse().ok()?;
        if suffix == 0 {
            return None;
        }
        (total.saturating_sub(suffix), total - 1)
    } else {
        let start: u64 = start.parse().ok()?;
        let end = if end.is_empty() {
            total - 1
        } else {
            end.parse::<u64>().ok()?.min(total - 1)
        };
        (start, end)
    };

    if start > end || start >= total {
        return None;
    }
    Some((start, end))
}

/// Content type by extension, matching `protocol.service.ts:148-163` exactly.
///
/// The default stays `video/mp4` as it is there: an unknown extension in a media
/// folder is far more likely to be a container the webview can play than
/// anything else, and `application/octet-stream` would stop it trying.
pub fn content_type(path: &Path) -> &'static str {
    let extension = path
        .extension()
        .map(|value| value.to_string_lossy().to_lowercase())
        .unwrap_or_default();

    match extension.as_str() {
        "webm" => "video/webm",
        "mov" => "video/quicktime",
        "mkv" => "video/x-matroska",
        "mp3" => "audio/mpeg",
        "wav" => "audio/wav",
        "m4a" => "audio/mp4",
        "aac" => "audio/aac",
        "ogg" => "audio/ogg",
        "flac" => "audio/flac",
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "webp" => "image/webp",
        _ => "video/mp4",
    }
}

/// Read the planned span. Seeking rather than reading the whole file keeps a
/// range request on a large video to the cost of the chunk itself.
fn read_span(path: &Path, served: &Served) -> std::io::Result<Vec<u8>> {
    use std::io::{Read, Seek, SeekFrom};

    match *served {
        Served::Whole { total } => {
            let mut file = std::fs::File::open(path)?;
            let mut buffer = Vec::with_capacity(total as usize);
            file.read_to_end(&mut buffer)?;
            Ok(buffer)
        }
        Served::Range { start, end, .. } => {
            let mut file = std::fs::File::open(path)?;
            file.seek(SeekFrom::Start(start))?;
            let length = (end - start + 1) as usize;
            let mut buffer = vec![0u8; length];
            let read = read_fully(&mut file, &mut buffer)?;
            buffer.truncate(read);
            Ok(buffer)
        }
    }
}

/// `read_exact` fails on a short read; a file that shrank between the stat and
/// the read should serve what is there rather than 500.
fn read_fully(file: &mut std::fs::File, buffer: &mut [u8]) -> std::io::Result<usize> {
    use std::io::Read;

    let mut filled = 0;
    while filled < buffer.len() {
        match file.read(&mut buffer[filled..]) {
            Ok(0) => break,
            Ok(count) => filled += count,
            Err(error) if error.kind() == std::io::ErrorKind::Interrupted => continue,
            Err(error) => return Err(error),
        }
    }
    Ok(filled)
}

/// Serve one request. The scope check happens here and nowhere else.
pub fn respond(state: &FileState, uri: &str, range: Option<&str>) -> http::Response<Vec<u8>> {
    let Some(requested) = path_from_uri(uri) else {
        return simple(400, "Bad Request");
    };

    // The one line that closes known-issues §3. `resolve_existing` canonicalises
    // and then refuses anything outside the operator's folders.
    let path = match state.resolve_existing(&requested.to_string_lossy()) {
        Ok(path) => path,
        Err(crate::errors::AppError::NotFound(_)) => return simple(404, "Not Found"),
        Err(error) => {
            tracing::warn!(
                uri = %uri,
                %error,
                "refused a local-media request outside the allowed folders"
            );
            return simple(403, "Forbidden");
        }
    };

    let metadata = match std::fs::metadata(&path) {
        Ok(metadata) if metadata.is_file() => metadata,
        Ok(_) => return simple(404, "Not Found"),
        Err(error) => {
            tracing::warn!(path = %path.display(), %error, "local-media stat failed");
            return simple(404, "Not Found");
        }
    };

    let total = metadata.len();
    let Some(served) = plan(total, range) else {
        // An unsatisfiable range must say so, or the media element retries the
        // same request forever.
        return http::Response::builder()
            .status(416)
            .header("Content-Range", format!("bytes */{total}"))
            .header("Accept-Ranges", "bytes")
            .body(Vec::new())
            .expect("static response");
    };

    let body = match read_span(&path, &served) {
        Ok(body) => body,
        Err(error) => {
            tracing::warn!(path = %path.display(), %error, "local-media read failed");
            return simple(404, "Not Found");
        }
    };

    let mime = content_type(&path);
    match served {
        Served::Whole { .. } => http::Response::builder()
            .status(200)
            .header("Content-Type", mime)
            .header("Content-Length", body.len().to_string())
            .header("Accept-Ranges", "bytes")
            .body(body)
            .expect("response"),
        Served::Range { start, end, total } => http::Response::builder()
            .status(206)
            .header("Content-Type", mime)
            .header("Content-Length", body.len().to_string())
            .header("Content-Range", format!("bytes {start}-{end}/{total}"))
            .header("Accept-Ranges", "bytes")
            .body(body)
            .expect("response"),
    }
}

fn simple(status: u16, message: &str) -> http::Response<Vec<u8>> {
    http::Response::builder()
        .status(status)
        .header("Content-Type", "text/plain")
        .body(message.as_bytes().to_vec())
        .expect("static response")
}

/// Split `scheme://host/path?query` into host and path.
///
/// Hand-rolled rather than pulled from a URL crate: `local-media` is not a
/// scheme `url` recognises as hierarchical without special-casing, and the two
/// shapes we accept are both trivially separable.
fn split_uri(uri: &str) -> Option<(&str, &str)> {
    let after_scheme = uri.split_once("://")?.1;
    let (authority, path) = match after_scheme.find('/') {
        Some(index) => after_scheme.split_at(index),
        None => (after_scheme, "/"),
    };
    let path = path.split(['?', '#']).next().unwrap_or("/");
    Some((authority, path))
}

fn percent_decode(value: &str) -> String {
    let bytes = value.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut index = 0;

    while index < bytes.len() {
        if bytes[index] == b'%' && index + 2 < bytes.len() {
            let hex = std::str::from_utf8(&bytes[index + 1..index + 3]).ok();
            if let Some(byte) = hex.and_then(|hex| u8::from_str_radix(hex, 16).ok()) {
                out.push(byte);
                index += 3;
                continue;
            }
        }
        out.push(bytes[index]);
        index += 1;
    }

    String::from_utf8_lossy(&out).into_owned()
}

fn is_windows_drive_path(value: &str) -> bool {
    let mut chars = value.chars();
    matches!(
        (chars.next(), chars.next()),
        (Some(letter), Some(':')) if letter.is_ascii_alphabetic()
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_electron_url_shape_still_resolves() {
        assert_eq!(
            path_from_uri("local-media://media/Users/cole/Media/clip.mp4"),
            Some(PathBuf::from("/Users/cole/Media/clip.mp4"))
        );
    }

    #[test]
    fn percent_escapes_are_decoded() {
        assert_eq!(
            path_from_uri("local-media://media/Users/cole/My%20Media/opening%20clip.mp4"),
            Some(PathBuf::from("/Users/cole/My Media/opening clip.mp4"))
        );
    }

    #[test]
    fn non_ascii_names_survive_the_round_trip() {
        // `encodeURI` produces UTF-8 percent escapes; decoding must reassemble
        // the bytes before treating them as text.
        assert_eq!(
            path_from_uri("local-media://media/Media/Lobges%C3%A4nge.mp4"),
            Some(PathBuf::from("/Media/Lobgesänge.mp4"))
        );
    }

    #[test]
    fn a_query_string_is_not_part_of_the_path() {
        assert_eq!(
            path_from_uri("local-media://media/Media/clip.mp4?t=12"),
            Some(PathBuf::from("/Media/clip.mp4"))
        );
    }

    #[test]
    fn a_linux_media_mount_is_not_mistaken_for_the_dummy_host() {
        // `/media/usb/clip.mp4` is a real path on Linux. The dummy host lives in
        // the authority, so the pathname is untouched.
        assert_eq!(
            path_from_uri("local-media://media/media/usb/clip.mp4"),
            Some(PathBuf::from("/media/usb/clip.mp4"))
        );
    }

    #[test]
    fn the_windows_rewrite_is_understood() {
        assert_eq!(
            path_from_uri("http://local-media.localhost/media/C:/Media/clip.mp4"),
            Some(PathBuf::from("C:/Media/clip.mp4"))
        );
    }

    #[test]
    fn a_uri_with_no_path_is_rejected() {
        assert_eq!(path_from_uri("local-media://media"), None);
        assert_eq!(path_from_uri("local-media://media/"), None);
        assert_eq!(path_from_uri("not a uri"), None);
    }

    #[test]
    fn a_small_file_with_no_range_is_served_whole() {
        assert_eq!(plan(1024, None), Some(Served::Whole { total: 1024 }));
    }

    #[test]
    fn a_large_file_with_no_range_gets_its_opening_chunk() {
        let total = 512 * 1024 * 1024;
        assert_eq!(
            plan(total, None),
            Some(Served::Range {
                start: 0,
                end: MAX_CHUNK - 1,
                total
            })
        );
    }

    #[test]
    fn an_open_ended_range_is_capped() {
        // What a media element sends first: `bytes=0-`. Answering it with the
        // whole 4 GB file is what the cap exists to prevent.
        let total = 4 * 1024 * 1024 * 1024;
        assert_eq!(
            plan(total, Some("bytes=0-")),
            Some(Served::Range {
                start: 0,
                end: MAX_CHUNK - 1,
                total
            })
        );
    }

    #[test]
    fn a_closed_range_is_honoured() {
        assert_eq!(
            plan(1000, Some("bytes=100-199")),
            Some(Served::Range {
                start: 100,
                end: 199,
                total: 1000
            })
        );
    }

    #[test]
    fn a_range_past_the_end_is_clamped_to_it() {
        assert_eq!(
            plan(1000, Some("bytes=900-5000")),
            Some(Served::Range {
                start: 900,
                end: 999,
                total: 1000
            })
        );
    }

    #[test]
    fn a_suffix_range_asks_for_the_tail() {
        // The Electron parser turns this into `NaN`. Seeking backwards from the
        // end is how a player reads an MP4 whose moov atom is at the end.
        assert_eq!(
            plan(1000, Some("bytes=-500")),
            Some(Served::Range {
                start: 500,
                end: 999,
                total: 1000
            })
        );
    }

    #[test]
    fn a_suffix_longer_than_the_file_starts_at_zero() {
        assert_eq!(
            plan(100, Some("bytes=-500")),
            Some(Served::Range {
                start: 0,
                end: 99,
                total: 100
            })
        );
    }

    #[test]
    fn an_unsatisfiable_range_is_declined() {
        assert_eq!(plan(1000, Some("bytes=2000-3000")), None);
        assert_eq!(plan(1000, Some("bytes=500-100")), None);
        assert_eq!(plan(1000, Some("bytes=abc")), None);
        assert_eq!(plan(1000, Some("nonsense")), None);
        assert_eq!(plan(0, Some("bytes=0-100")), None);
    }

    #[test]
    fn a_multi_range_request_is_declined_rather_than_half_answered() {
        assert_eq!(plan(1000, Some("bytes=0-99,200-299")), None);
    }

    #[test]
    fn an_empty_file_is_served_whole() {
        assert_eq!(plan(0, None), Some(Served::Whole { total: 0 }));
    }

    #[test]
    fn a_url_built_in_rust_round_trips_back_to_the_path() {
        let path = Path::new("/Users/cole/My Media/Lobgesänge.mp4");
        let url = url_for(path);
        assert_eq!(path_from_uri(&url).as_deref(), Some(path));
    }

    #[test]
    fn the_url_matches_what_the_react_side_builds() {
        // `local-media://media${encodeURI(filePath)}` — useMediaFolders.ts:155.
        assert_eq!(
            url_for(Path::new("/Users/cole/Media/opening clip.mp4")),
            "local-media://media/Users/cole/Media/opening%20clip.mp4"
        );
    }

    #[test]
    fn encode_uri_leaves_separators_alone_and_escapes_the_rest() {
        assert_eq!(encode_uri("/a/b c"), "/a/b%20c");
        assert_eq!(encode_uri("/a/b+c=d"), "/a/b+c=d");
        assert_eq!(encode_uri("/ä"), "/%C3%A4");
        assert_eq!(encode_uri("/a#b"), "/a%23b");
        assert_eq!(encode_uri("/Set #2?.mp4"), "/Set%20%232%3F.mp4");
    }

    #[test]
    fn content_types_match_the_electron_table() {
        let cases = [
            ("clip.mp4", "video/mp4"),
            ("clip.webm", "video/webm"),
            ("clip.MOV", "video/quicktime"),
            ("clip.mkv", "video/x-matroska"),
            ("track.mp3", "audio/mpeg"),
            ("track.wav", "audio/wav"),
            ("track.m4a", "audio/mp4"),
            ("track.aac", "audio/aac"),
            ("track.ogg", "audio/ogg"),
            ("track.flac", "audio/flac"),
            ("still.png", "image/png"),
            ("still.jpg", "image/jpeg"),
            ("still.jpeg", "image/jpeg"),
            ("still.gif", "image/gif"),
            ("still.webp", "image/webp"),
            ("mystery.xyz", "video/mp4"),
            ("no-extension", "video/mp4"),
        ];

        for (name, expected) in cases {
            assert_eq!(content_type(Path::new(name)), expected, "{name}");
        }
    }
}
