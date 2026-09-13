//! The rules NDI runs by, apart from the native calls.
//!
//! Ported case for case from `src/shared/lib/ndi-rules.mjs`, which is what the
//! Electron build runs and what `tests/ndi-rules.test.mjs` pins. The tests at
//! the bottom of this file are the same cases, so a disagreement between the
//! two shells is a failing test on one side rather than a livestream that
//! behaves differently depending on which build is installed.
//!
//! No Tauri types and no library calls.

use std::cmp::Ordering;
use std::time::{Duration, Instant};

use serde::Serialize;

pub const DEFAULT_SOURCE_NAME: &str = "Present Main Output";
pub const DEFAULT_GROUP_NAME: &str = "Public";

/// 30000/1000: exactly 30 fps, not the 30000/1001 of broadcast video.
pub const FRAME_RATE_N: i32 = 30_000;
pub const FRAME_RATE_D: i32 = 1_000;

/// `NDI_LIB_FOURCC('B', 'G', 'R', 'A')`.
pub const FOURCC_BGRA: u32 = u32::from_le_bytes(*b"BGRA");
/// `NDIlib_frame_format_type_progressive`.
pub const FRAME_FORMAT_PROGRESSIVE: i32 = 1;

pub const DISCOVERY_WAIT: Duration = Duration::from_millis(1200);

pub const INPUT_CAPTURE_TIMEOUT: Duration = Duration::from_millis(1000);
pub const INPUT_FRAME_INTERVAL: Duration = Duration::from_millis(125);
pub const INPUT_MAX_WIDTH: u32 = 1280;
pub const INPUT_JPEG_QUALITY: u8 = 72;
pub const INPUT_STOP_DELAY: Duration = Duration::from_millis(1200);
pub const INPUT_RETRY_DELAY: Duration = Duration::from_millis(250);
pub const INPUT_RECEIVER_NAME: &str = "Present NDI Prop Receiver";
pub const INPUT_NO_SOURCE_ERROR: &str = "Select an NDI source first.";

/// `NDIlib_recv_color_format_BGRX_BGRA`: what the prop receiver asks for.
pub const INPUT_COLOR_FORMAT_BGRX_BGRA: i32 = 0;
/// `NDIlib_recv_bandwidth_lowest`: the source's low-resolution proxy stream.
/// A prop is a picture-in-picture, and the full stream is a network's worth
/// of bytes to draw a thumbnail.
pub const INPUT_BANDWIDTH_LOWEST: i32 = 0;

pub fn normalize_source_name(value: &str) -> String {
    let normalized = value.trim();
    if normalized.is_empty() {
        DEFAULT_SOURCE_NAME.to_owned()
    } else {
        normalized.to_owned()
    }
}

/// Blank is `Public`, and so is any casing of it. Every other group keeps its
/// casing, because NDI compares group names as written.
pub fn normalize_group_name(value: &str) -> String {
    let normalized = value.trim();
    if normalized.is_empty() || normalized.to_lowercase() == "public" {
        DEFAULT_GROUP_NAME.to_owned()
    } else {
        normalized.to_owned()
    }
}

pub fn normalize_client_id(value: Option<&str>) -> Option<String> {
    value
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_owned)
}

/// The header of a progressive BGRA frame at 30 fps.
///
/// `None` for a size NDI cannot be told about. The Electron version computes
/// a header for zero-by-zero too, with an aspect ratio of `NaN`; there is no
/// frame of that size to send, so there is no header for it here.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct FrameHeader {
    pub width: i32,
    pub height: i32,
    pub frame_rate_n: i32,
    pub frame_rate_d: i32,
    pub picture_aspect_ratio: f32,
    pub line_stride_bytes: i32,
    pub frame_format: i32,
    pub fourcc: u32,
}

pub fn frame_header(width: u32, height: u32) -> Option<FrameHeader> {
    if width == 0 || height == 0 {
        return None;
    }
    let stride = width.checked_mul(4)?;
    Some(FrameHeader {
        width: i32::try_from(width).ok()?,
        height: i32::try_from(height).ok()?,
        frame_rate_n: FRAME_RATE_N,
        frame_rate_d: FRAME_RATE_D,
        picture_aspect_ratio: (f64::from(width) / f64::from(height)) as f32,
        line_stride_bytes: i32::try_from(stride).ok()?,
        frame_format: FRAME_FORMAT_PROGRESSIVE,
        fourcc: FOURCC_BGRA,
    })
}

/// A source as discovery reports it, and as `listNdiSources` hands it to the UI.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Source {
    pub name: String,
    pub url_address: Option<String>,
}

/// Which groups to look in. Empty or absent means the SDK's own default.
pub fn discovery_groups(group_name: Option<&str>) -> Option<String> {
    group_name
        .filter(|value| !value.is_empty())
        .map(normalize_group_name)
}

/// Named sources only, in the order a person reads them.
pub fn order_sources(sources: Vec<Source>) -> Vec<Source> {
    let mut named: Vec<Source> = sources
        .into_iter()
        .filter(|source| !source.name.is_empty())
        .collect();
    named.sort_by(|a, b| reading_order(&a.name, &b.name));
    named
}

/// The order `localeCompare` gives in Node, closely enough for source names.
///
/// Electron sorts with ICU's root collation, and a character-code sort would
/// not match it where it shows: every upper-case machine name would come
/// before every lower-case one. So, as ICU does for these names:
///
/// 1. compare ignoring case, with whitespace before punctuation before digits
///    before letters;
/// 2. when that ties, the first difference in case decides, lower case first.
///
/// This is not a collation implementation. Accented letters and the relative
/// order of punctuation marks can differ from ICU, and nothing in an NDI
/// machine name depends on either.
fn reading_order(a: &str, b: &str) -> Ordering {
    fn class(character: char) -> u8 {
        if character.is_whitespace() {
            0
        } else if character.is_numeric() {
            2
        } else if character.is_alphabetic() {
            3
        } else {
            1
        }
    }
    let primary = |value: &str| -> Vec<(u8, char)> {
        value
            .chars()
            .flat_map(|character| {
                character
                    .to_lowercase()
                    .map(move |lower| (class(character), lower))
            })
            .collect()
    };

    primary(a)
        .cmp(&primary(b))
        .then_with(|| {
            a.chars()
                .zip(b.chars())
                .find(|(left, right)| left != right)
                .map_or(Ordering::Equal, |(left, right)| {
                    left.is_uppercase().cmp(&right.is_uppercase())
                })
        })
        .then_with(|| a.cmp(b))
}

/// The one receiver the whole app shares, as the start and stop plans see it.
#[derive(Debug, Clone, Copy)]
pub struct InputState<'a> {
    /// Whether a receiver exists.
    pub receiving: bool,
    pub source_name: Option<&'a str>,
    /// Who is using it, in the order they joined.
    pub client_ids: &'a [String],
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum InputStartPlan {
    /// No source named. The caller's own claim is dropped, and the receiver
    /// stops at once if nobody else holds it.
    Rejected {
        stop_now: bool,
        client_ids: Vec<String>,
    },
    /// The receiver is already on this source; the caller joins it.
    Reuse {
        source_name: String,
        client_ids: Vec<String>,
    },
    /// Anything else. The receiver is torn down — every other client with it,
    /// whatever source they were showing — and a new one opened for this
    /// caller alone.
    Connect {
        source_name: String,
        client_id: Option<String>,
    },
}

pub fn plan_input_start(
    state: InputState<'_>,
    source_name: &str,
    client_id: Option<&str>,
) -> InputStartPlan {
    let normalized = source_name.trim();
    let client = normalize_client_id(client_id);
    let mut clients = state.client_ids.to_vec();

    if normalized.is_empty() {
        if let Some(client) = &client {
            clients.retain(|existing| existing != client);
        }
        return InputStartPlan::Rejected {
            stop_now: clients.is_empty(),
            client_ids: clients,
        };
    }

    if state.receiving && state.source_name == Some(normalized) {
        if let Some(client) = client {
            if !clients.contains(&client) {
                clients.push(client);
            }
        }
        return InputStartPlan::Reuse {
            source_name: normalized.to_owned(),
            client_ids: clients,
        };
    }

    InputStartPlan::Connect {
        source_name: normalized.to_owned(),
        client_id: client,
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum InputStopPlan {
    /// Somebody else still holds the receiver.
    Keep { client_ids: Vec<String> },
    /// There is no receiver; forget the source and the last frame.
    Reset,
    /// The last client left. The receiver survives `INPUT_STOP_DELAY`, so a
    /// prop that unmounts and remounts on a slide change does not tear down
    /// the connection and wait for NDI to find the source again.
    StopLater { delay: Duration },
}

/// A call without a client id releases everybody.
pub fn plan_input_stop(state: InputState<'_>, client_id: Option<&str>) -> InputStopPlan {
    if let Some(client) = normalize_client_id(client_id) {
        let remaining: Vec<String> = state
            .client_ids
            .iter()
            .filter(|existing| **existing != client)
            .cloned()
            .collect();
        if !remaining.is_empty() {
            return InputStopPlan::Keep {
                client_ids: remaining,
            };
        }
    }

    if !state.receiving {
        return InputStopPlan::Reset;
    }

    InputStopPlan::StopLater {
        delay: INPUT_STOP_DELAY,
    }
}

/// Whether a received frame is worth keeping. The receiver delivers at the
/// source's rate and the prop polls eight times a second, so everything in
/// between is dropped before it is encoded.
pub fn should_keep_input_frame(now: Instant, last_kept: Option<Instant>) -> bool {
    last_kept.is_none_or(|last| now.saturating_duration_since(last) >= INPUT_FRAME_INTERVAL)
}

pub fn is_usable_input_frame(width: i32, height: i32, has_data: bool) -> bool {
    width > 0 && height > 0 && has_data
}

/// The latest received frame, as the `ndi-frame` scheme serves it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct InputFrame<Data> {
    pub data: Option<Data>,
    pub content_type: String,
    pub updated_at_ms: u64,
    pub error: Option<String>,
}

/// What is being received right now.
#[derive(Debug, Clone)]
pub struct ActiveInput<'a, Data> {
    pub source_name: Option<&'a str>,
    pub image: Option<&'a Data>,
    pub content_type: &'a str,
    pub frame_at_ms: u64,
    pub last_error: Option<&'a str>,
}

/// Asking for a source other than the one being received gets nothing, rather
/// than a frame from the wrong camera. Asking while *nothing* is being received
/// gets the empty latest frame and whatever error is recorded.
pub fn select_input_frame<Data: Clone>(
    active: ActiveInput<'_, Data>,
    requested_source_name: Option<&str>,
) -> InputFrame<Data> {
    let requested = requested_source_name.filter(|name| !name.is_empty());
    if let (Some(requested), Some(active_name)) = (requested, active.source_name) {
        if !active_name.is_empty() && requested != active_name {
            return InputFrame {
                data: None,
                content_type: active.content_type.to_owned(),
                updated_at_ms: 0,
                error: Some(format!("NDI source \"{requested}\" is not active.")),
            };
        }
    }
    InputFrame {
        data: active.image.cloned(),
        content_type: active.content_type.to_owned(),
        updated_at_ms: active.frame_at_ms,
        error: active.last_error.map(str::to_owned),
    }
}

/// An `ndi-frame` URL whose path is not valid percent-encoding.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct MalformedSourceName;

/// The source an `ndi-frame://frame/<name>` request names, or `None` for none.
///
/// Strict about escapes, as `decodeURIComponent` is: a stray `%` or bytes that
/// are not UTF-8 are refused rather than decoded into a name that matches no
/// source. Also accepts `http://ndi-frame.localhost/<name>`, which is how
/// WebView2 spells a custom scheme.
pub fn request_source_name(uri: &str) -> Result<Option<String>, MalformedSourceName> {
    let after_scheme = uri.split_once("://").map_or("", |(_, rest)| rest);
    let path = after_scheme
        .find('/')
        .map_or("", |index| &after_scheme[index..]);
    let path = path.split(['?', '#']).next().unwrap_or("");
    let decoded = strict_percent_decode(path.trim_start_matches('/'))?;
    Ok(Some(decoded).filter(|name| !name.is_empty()))
}

fn strict_percent_decode(value: &str) -> Result<String, MalformedSourceName> {
    let bytes = value.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut index = 0;
    while index < bytes.len() {
        if bytes[index] == b'%' {
            let hex = bytes.get(index + 1..index + 3).ok_or(MalformedSourceName)?;
            let hex = std::str::from_utf8(hex).map_err(|_| MalformedSourceName)?;
            out.push(u8::from_str_radix(hex, 16).map_err(|_| MalformedSourceName)?);
            index += 3;
        } else {
            out.push(bytes[index]);
            index += 1;
        }
    }
    String::from_utf8(out).map_err(|_| MalformedSourceName)
}

/// Status and headers for an `ndi-frame` response.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FrameResponse {
    pub status: u16,
    /// Every response, frame or not: the `<img>` asks again every 125 ms and
    /// a cached answer would freeze the camera.
    pub cache_control: &'static str,
    pub content_type: Option<String>,
    pub updated_at_ms: Option<String>,
}

/// No frame — none received yet, the wrong source asked for, or a receiver
/// error — is a 204 with no body, and the error is not surfaced.
pub fn frame_response<Data>(frame: &InputFrame<Data>) -> FrameResponse {
    match frame.data {
        Some(_) => FrameResponse {
            status: 200,
            cache_control: "no-store",
            content_type: Some(frame.content_type.clone()),
            updated_at_ms: Some(frame.updated_at_ms.to_string()),
        },
        None => FrameResponse {
            status: 204,
            cache_control: "no-store",
            content_type: None,
            updated_at_ms: None,
        },
    }
}

#[cfg(test)]
mod tests {
    //! The cases in `tests/ndi-rules.test.mjs`, in the same order.

    use super::*;

    fn clients(ids: &[&str]) -> Vec<String> {
        ids.iter().map(|id| (*id).to_owned()).collect()
    }

    fn idle() -> InputState<'static> {
        InputState {
            receiving: false,
            source_name: None,
            client_ids: &[],
        }
    }

    fn receiving<'a>(source: &'a str, ids: &'a [String]) -> InputState<'a> {
        InputState {
            receiving: true,
            source_name: Some(source),
            client_ids: ids,
        }
    }

    // --- names -------------------------------------------------------------

    #[test]
    fn a_blank_source_name_becomes_the_default_and_a_real_one_is_trimmed() {
        assert_eq!(normalize_source_name(""), "Present Main Output");
        assert_eq!(normalize_source_name("   "), "Present Main Output");
        assert_eq!(normalize_source_name("  Sanctuary  "), "Sanctuary");
    }

    #[test]
    fn the_group_name_is_public_when_blank_and_any_casing_of_public_is_public() {
        assert_eq!(normalize_group_name(""), "Public");
        assert_eq!(normalize_group_name("  "), "Public");
        assert_eq!(normalize_group_name("public"), "Public");
        assert_eq!(normalize_group_name(" PUBLIC "), "Public");
        assert_eq!(normalize_group_name(" Streaming "), "Streaming");
    }

    #[test]
    fn a_client_id_is_trimmed_and_blank_or_missing_is_no_client_at_all() {
        assert_eq!(
            normalize_client_id(Some(" output-1 ")).as_deref(),
            Some("output-1")
        );
        assert_eq!(normalize_client_id(Some("")), None);
        assert_eq!(normalize_client_id(Some("   ")), None);
        assert_eq!(normalize_client_id(None), None);
    }

    // --- output ------------------------------------------------------------

    #[test]
    fn a_frame_is_declared_as_progressive_bgra_at_exactly_30_fps() {
        assert_eq!(
            frame_header(1920, 1080),
            Some(FrameHeader {
                width: 1920,
                height: 1080,
                frame_rate_n: 30_000,
                frame_rate_d: 1_000,
                picture_aspect_ratio: (1920.0_f64 / 1080.0) as f32,
                line_stride_bytes: 1920 * 4,
                frame_format: 1,
                fourcc: 1_095_911_234,
            })
        );
    }

    #[test]
    fn the_bgra_fourcc_is_the_sdks_own_macro_spelled_out() {
        let fourcc = |a: u8, b: u8, c: u8, d: u8| {
            u32::from(a) | u32::from(b) << 8 | u32::from(c) << 16 | u32::from(d) << 24
        };
        assert_eq!(FOURCC_BGRA, fourcc(b'B', b'G', b'R', b'A'));
    }

    #[test]
    fn a_frame_nobody_can_be_told_about_has_no_header() {
        assert_eq!(frame_header(0, 1080), None);
        assert_eq!(frame_header(1920, 0), None);
        assert_eq!(
            frame_header(u32::MAX / 2, 1),
            None,
            "the stride overflows an int"
        );
    }

    // --- discovery ---------------------------------------------------------

    #[test]
    fn discovery_normalises_the_group_and_treats_blank_as_none() {
        assert_eq!(discovery_groups(None), None);
        assert_eq!(discovery_groups(Some("")), None);
        assert_eq!(discovery_groups(Some("public")).as_deref(), Some("Public"));
        assert_eq!(discovery_groups(Some(" Cams ")).as_deref(), Some("Cams"));
    }

    fn source(name: &str, url: Option<&str>) -> Source {
        Source {
            name: name.to_owned(),
            url_address: url.map(str::to_owned),
        }
    }

    #[test]
    fn sources_without_a_name_are_dropped_and_the_rest_sorted_by_name() {
        let sources = order_sources(vec![
            source("ZED (Camera 2)", Some("10.0.0.3:5961")),
            source("", None),
            source("BIRDDOG (Pulpit)", Some("10.0.0.2:5961")),
        ]);
        let names: Vec<&str> = sources.iter().map(|s| s.name.as_str()).collect();
        assert_eq!(names, ["BIRDDOG (Pulpit)", "ZED (Camera 2)"]);
        assert_eq!(
            sources[0].url_address.as_deref(),
            Some("10.0.0.2:5961"),
            "the address travels with its name"
        );
    }

    #[test]
    fn sources_sort_the_way_a_person_reads_them_not_by_character_code() {
        // The exact order Node's `localeCompare` produced for these names.
        let names = [
            "b",
            "A",
            "a",
            "B",
            "ZED (Cam)",
            "birddog (x)",
            "BIRDDOG (Pulpit)",
            "_x",
            "9 cams",
        ];
        let sorted = order_sources(names.iter().map(|name| source(name, None)).collect());
        let sorted: Vec<&str> = sorted.iter().map(|s| s.name.as_str()).collect();
        assert_eq!(
            sorted,
            [
                "_x",
                "9 cams",
                "a",
                "A",
                "b",
                "B",
                "BIRDDOG (Pulpit)",
                "birddog (x)",
                "ZED (Cam)"
            ]
        );
    }

    #[test]
    fn a_source_serialises_the_way_the_ui_reads_it() {
        let json = serde_json::to_value(source("Cam", Some("10.0.0.2:5961"))).unwrap();
        assert_eq!(
            json,
            serde_json::json!({ "name": "Cam", "urlAddress": "10.0.0.2:5961" })
        );
    }

    // --- input: one shared receiver ----------------------------------------

    #[test]
    fn starting_with_no_source_is_refused_and_stops_the_receiver_if_nobody_holds_it() {
        let ids = clients(&["output-1"]);
        assert_eq!(
            plan_input_start(receiving("Cam", &ids), "  ", Some("output-1")),
            InputStartPlan::Rejected {
                stop_now: true,
                client_ids: vec![],
            }
        );
        assert_eq!(INPUT_NO_SOURCE_ERROR, "Select an NDI source first.");
    }

    #[test]
    fn starting_with_no_source_leaves_the_receiver_alone_while_another_client_holds_it() {
        let ids = clients(&["output-1", "preview-1"]);
        assert_eq!(
            plan_input_start(receiving("Cam", &ids), "", Some("output-1")),
            InputStartPlan::Rejected {
                stop_now: false,
                client_ids: clients(&["preview-1"]),
            }
        );
    }

    #[test]
    fn starting_with_no_source_and_no_client_id_drops_nobody() {
        let ids = clients(&["output-1"]);
        assert_eq!(
            plan_input_start(receiving("Cam", &ids), "", None),
            InputStartPlan::Rejected {
                stop_now: false,
                client_ids: ids.clone(),
            }
        );
        assert!(matches!(
            plan_input_start(idle(), "", None),
            InputStartPlan::Rejected { stop_now: true, .. }
        ));
    }

    #[test]
    fn a_second_surface_on_the_same_source_joins_the_receiver_rather_than_reopening_it() {
        let ids = clients(&["output-1"]);
        assert_eq!(
            plan_input_start(receiving("Cam", &ids), " Cam ", Some("preview-1")),
            InputStartPlan::Reuse {
                source_name: "Cam".to_owned(),
                client_ids: clients(&["output-1", "preview-1"]),
            }
        );
    }

    #[test]
    fn joining_twice_with_one_client_id_counts_it_once() {
        let ids = clients(&["output-1"]);
        assert_eq!(
            plan_input_start(receiving("Cam", &ids), "Cam", Some("output-1")),
            InputStartPlan::Reuse {
                source_name: "Cam".to_owned(),
                client_ids: ids.clone(),
            }
        );
    }

    #[test]
    fn a_new_source_replaces_the_receiver_and_every_client_of_the_old_one() {
        let ids = clients(&["output-1", "preview-1"]);
        assert_eq!(
            plan_input_start(receiving("Cam", &ids), "Pulpit", Some("output-2")),
            InputStartPlan::Connect {
                source_name: "Pulpit".to_owned(),
                client_id: Some("output-2".to_owned()),
            }
        );
    }

    #[test]
    fn a_matching_name_is_not_enough_without_a_live_receiver() {
        let stale = InputState {
            receiving: false,
            source_name: Some("Cam"),
            client_ids: &[],
        };
        assert!(matches!(
            plan_input_start(stale, "Cam", Some("output-1")),
            InputStartPlan::Connect { .. }
        ));
    }

    #[test]
    fn source_names_match_exactly_after_trimming_not_case_insensitively() {
        let ids = clients(&["a"]);
        assert!(matches!(
            plan_input_start(receiving("Cam", &ids), "cam", Some("b")),
            InputStartPlan::Connect { .. }
        ));
    }

    #[test]
    fn stopping_one_of_two_clients_keeps_the_receiver() {
        let ids = clients(&["output-1", "preview-1"]);
        assert_eq!(
            plan_input_stop(receiving("Cam", &ids), Some("output-1")),
            InputStopPlan::Keep {
                client_ids: clients(&["preview-1"]),
            }
        );
    }

    #[test]
    fn the_last_client_leaving_stops_the_receiver_after_a_grace_period() {
        let ids = clients(&["output-1"]);
        assert_eq!(
            plan_input_stop(receiving("Cam", &ids), Some("output-1")),
            InputStopPlan::StopLater {
                delay: Duration::from_millis(1200),
            }
        );
    }

    #[test]
    fn stopping_without_a_client_id_releases_every_client() {
        let ids = clients(&["output-1", "preview-1"]);
        assert_eq!(
            plan_input_stop(receiving("Cam", &ids), None),
            InputStopPlan::StopLater {
                delay: INPUT_STOP_DELAY,
            }
        );
    }

    #[test]
    fn stopping_a_client_that_was_never_registered_still_stops_a_receiver_nobody_holds() {
        assert!(matches!(
            plan_input_stop(receiving("Cam", &[]), Some("stranger")),
            InputStopPlan::StopLater { .. }
        ));
    }

    #[test]
    fn stopping_a_client_that_was_never_registered_keeps_a_receiver_somebody_holds() {
        let ids = clients(&["output-1"]);
        assert_eq!(
            plan_input_stop(receiving("Cam", &ids), Some("stranger")),
            InputStopPlan::Keep {
                client_ids: ids.clone()
            }
        );
    }

    #[test]
    fn stopping_with_no_receiver_resets_rather_than_scheduling_anything() {
        assert_eq!(
            plan_input_stop(idle(), Some("output-1")),
            InputStopPlan::Reset
        );
        assert_eq!(plan_input_stop(idle(), None), InputStopPlan::Reset);
    }

    // --- input: frames -----------------------------------------------------

    #[test]
    fn received_frames_are_kept_at_most_every_125_ms_and_the_first_always_is() {
        let start = Instant::now();
        assert!(should_keep_input_frame(start, None));
        assert!(!should_keep_input_frame(
            start + Duration::from_millis(124),
            Some(start)
        ));
        assert!(should_keep_input_frame(
            start + Duration::from_millis(125),
            Some(start)
        ));
    }

    #[test]
    fn a_frame_without_size_or_pixels_is_skipped() {
        assert!(!is_usable_input_frame(0, 720, true));
        assert!(!is_usable_input_frame(1280, -1, true));
        assert!(!is_usable_input_frame(1280, 720, false));
        assert!(is_usable_input_frame(1280, 720, true));
    }

    fn active<'a>(
        source: Option<&'a str>,
        image: Option<&'a &'static str>,
        at: u64,
        error: Option<&'a str>,
    ) -> ActiveInput<'a, &'static str> {
        ActiveInput {
            source_name: source,
            image,
            content_type: "image/jpeg",
            frame_at_ms: at,
            last_error: error,
        }
    }

    #[test]
    fn asking_for_the_source_being_received_returns_its_latest_frame() {
        let image = "jpeg-bytes";
        let frame = select_input_frame(active(Some("Cam"), Some(&image), 5_000, None), Some("Cam"));
        assert_eq!(
            frame,
            InputFrame {
                data: Some("jpeg-bytes"),
                content_type: "image/jpeg".to_owned(),
                updated_at_ms: 5_000,
                error: None,
            }
        );
        let unnamed = select_input_frame(active(Some("Cam"), Some(&image), 5_000, None), None);
        assert_eq!(
            unnamed.data,
            Some("jpeg-bytes"),
            "no name asks for whatever is live"
        );
    }

    #[test]
    fn asking_for_a_different_source_returns_nothing_never_another_cameras_frame() {
        let image = "jpeg-bytes";
        let frame = select_input_frame(
            active(Some("Cam"), Some(&image), 5_000, None),
            Some("Pulpit"),
        );
        assert_eq!(
            frame,
            InputFrame {
                data: None,
                content_type: "image/jpeg".to_owned(),
                updated_at_ms: 0,
                error: Some("NDI source \"Pulpit\" is not active.".to_owned()),
            }
        );
    }

    #[test]
    fn asking_while_nothing_is_received_returns_the_empty_frame_and_the_last_error() {
        let frame = select_input_frame(active(None, None, 0, Some("timed out")), Some("Pulpit"));
        assert_eq!(
            frame,
            InputFrame {
                data: None,
                content_type: "image/jpeg".to_owned(),
                updated_at_ms: 0,
                error: Some("timed out".to_owned()),
            }
        );
    }

    // --- the ndi-frame scheme ----------------------------------------------

    #[test]
    fn an_ndi_frame_url_names_its_source_in_the_path_percent_decoded() {
        assert_eq!(
            request_source_name("ndi-frame://frame/BIRDDOG%20(Pulpit)?t=123"),
            Ok(Some("BIRDDOG (Pulpit)".to_owned()))
        );
        assert_eq!(request_source_name("ndi-frame://frame/"), Ok(None));
        assert_eq!(request_source_name("ndi-frame://frame"), Ok(None));
        assert_eq!(
            request_source_name("ndi-frame://frame/%E0%A4%A"),
            Err(MalformedSourceName)
        );
    }

    #[test]
    fn the_windows_spelling_of_the_scheme_names_the_same_source() {
        assert_eq!(
            request_source_name("http://ndi-frame.localhost/BIRDDOG%20(Pulpit)?t=9"),
            Ok(Some("BIRDDOG (Pulpit)".to_owned()))
        );
    }

    #[test]
    fn an_escape_that_is_not_utf8_is_refused_rather_than_mangled() {
        assert_eq!(
            request_source_name("ndi-frame://frame/%FF"),
            Err(MalformedSourceName)
        );
        assert_eq!(
            request_source_name("ndi-frame://frame/100%"),
            Err(MalformedSourceName)
        );
    }

    #[test]
    fn no_frame_is_a_204_that_is_never_cached() {
        let empty: InputFrame<()> = InputFrame {
            data: None,
            content_type: "image/jpeg".to_owned(),
            updated_at_ms: 0,
            error: None,
        };
        assert_eq!(
            frame_response(&empty),
            FrameResponse {
                status: 204,
                cache_control: "no-store",
                content_type: None,
                updated_at_ms: None,
            }
        );
    }

    #[test]
    fn a_frame_is_served_with_its_type_and_the_time_it_arrived() {
        let frame = InputFrame {
            data: Some(()),
            content_type: "image/jpeg".to_owned(),
            updated_at_ms: 5_000,
            error: None,
        };
        assert_eq!(
            frame_response(&frame),
            FrameResponse {
                status: 200,
                cache_control: "no-store",
                content_type: Some("image/jpeg".to_owned()),
                updated_at_ms: Some("5000".to_owned()),
            }
        );
    }
}
