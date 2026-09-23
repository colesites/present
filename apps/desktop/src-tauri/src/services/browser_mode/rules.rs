//! `src/main/lib/browser-mode.mjs` in Rust: what the address bar's input
//! loads, which page a view restores, how the viewport is measured, how the
//! preview is cropped, and where suggestions come from.
//!
//! `tests/browser-mode.test.mjs` pins the JavaScript; the tests here are its
//! cases. `new URL` is the WHATWG parser, and so is the `url` crate.

use serde::{Deserialize, Serialize};
use tauri::Url;

pub const HOME_URL: &str = "https://www.google.com";
pub const SEARCH_ENGINE_BASE_URL: &str = "https://www.google.com/search?q=";
pub const SCROLL_SYNC_INTERVAL: std::time::Duration = std::time::Duration::from_millis(180);
pub const PREVIEW_MAX_WIDTH: u32 = 360;
pub const BLANK: &str = "about:blank";

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum ProjectionTarget {
    Preview,
    MainOutput,
}

/// `BrowserModeState` in `electron.d.ts`.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BrowserState {
    pub url: String,
    pub title: String,
    pub can_go_back: bool,
    pub can_go_forward: bool,
    pub is_loading: bool,
    pub projection_target: ProjectionTarget,
    pub scroll_x: f64,
    pub scroll_y: f64,
    pub preview_data_url: Option<String>,
}

impl Default for BrowserState {
    /// `initialBrowserState`.
    fn default() -> Self {
        Self {
            url: BLANK.to_owned(),
            title: String::new(),
            can_go_back: false,
            can_go_forward: false,
            is_loading: false,
            projection_target: ProjectionTarget::Preview,
            scroll_x: 0.0,
            scroll_y: 0.0,
            preview_data_url: None,
        }
    }
}

/// What `String.prototype.trim` removes: `\s` in JavaScript, which counts a
/// BOM and not NEL, unlike Rust's `char::is_whitespace`.
fn is_js_space(character: char) -> bool {
    (character.is_whitespace() && character != '\u{85}') || character == '\u{feff}'
}

fn js_trim(value: &str) -> &str {
    value.trim_matches(is_js_space)
}

/// `Math.round`: the nearest integer, a half going up.
pub fn js_round(value: f64) -> f64 {
    let floor = value.floor();
    if value - floor >= 0.5 {
        floor + 1.0
    } else {
        floor
    }
}

/// `encodeURIComponent`, which leaves `A–Z a–z 0–9 - _ . ! ~ * ' ( )` alone.
pub fn encode_uri_component(value: &str) -> String {
    let mut encoded = String::with_capacity(value.len());
    for byte in value.bytes() {
        if byte.is_ascii_alphanumeric()
            || matches!(
                byte,
                b'-' | b'_' | b'.' | b'!' | b'~' | b'*' | b'\'' | b'(' | b')'
            )
        {
            encoded.push(byte as char);
        } else {
            encoded.push_str(&format!("%{byte:02X}"));
        }
    }
    encoded
}

pub fn is_valid_http_url(value: &str) -> bool {
    Url::parse(value).is_ok_and(|url| matches!(url.scheme(), "http" | "https"))
}

pub fn is_likely_url(value: &str) -> bool {
    let normalized = js_trim(value).to_lowercase();
    if normalized.is_empty() || normalized.contains(' ') {
        return false;
    }
    normalized.contains('.')
        || normalized.starts_with("localhost:")
        || normalized.starts_with("127.0.0.1:")
        || normalized.starts_with("http://")
        || normalized.starts_with("https://")
}

/// `normalizeNavigationInput`.
pub fn normalize_navigation_input(input: &str) -> String {
    let trimmed = js_trim(input);
    if trimmed.is_empty() {
        return HOME_URL.to_owned();
    }
    if is_valid_http_url(trimmed) {
        return trimmed.to_owned();
    }
    if is_likely_url(trimmed) {
        let with_protocol = if trimmed.starts_with("http://") || trimmed.starts_with("https://") {
            trimmed.to_owned()
        } else {
            format!("https://{trimmed}")
        };
        if is_valid_http_url(&with_protocol) {
            return with_protocol;
        }
    }
    format!("{SEARCH_ENGINE_BASE_URL}{}", encode_uri_component(trimmed))
}

/// `restoreUrl`.
pub fn restore_url(current_url: Option<&str>, remembered_url: Option<&str>) -> String {
    [current_url, remembered_url]
        .into_iter()
        .flatten()
        .find(|url| !url.is_empty() && *url != BLANK)
        .unwrap_or(HOME_URL)
        .to_owned()
}

/// A rectangle as the renderer measures it, in CSS pixels.
#[derive(Debug, Clone, Copy, Default, PartialEq, Deserialize)]
pub struct RawBounds {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct Bounds {
    pub x: u32,
    pub y: u32,
    pub width: u32,
    pub height: u32,
}

impl Bounds {
    pub fn is_empty(&self) -> bool {
        self.width == 0 || self.height == 0
    }
}

/// `clampBrowserBounds`.
pub fn clamp_browser_bounds(bounds: RawBounds) -> Bounds {
    // `as` saturates, so a value past u32 stays in range rather than wrapping.
    let clamp = |value: f64| js_round(value).max(0.0) as u32;
    Bounds {
        x: clamp(bounds.x),
        y: clamp(bounds.y),
        width: clamp(bounds.width),
        height: clamp(bounds.height),
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Crop {
    pub x: u32,
    pub y: u32,
    pub width: u32,
    pub height: u32,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct PreviewPlan {
    pub crop: Option<Crop>,
    pub preview_width: u32,
}

/// `previewCrop`: `source` is the capture's size, `viewport` the operator's.
pub fn preview_crop(source: (u32, u32), viewport: (u32, u32)) -> PreviewPlan {
    let (source_width, source_height) = (f64::from(source.0), f64::from(source.1));
    let expected_aspect = if viewport.0 > 0 && viewport.1 > 0 {
        f64::from(viewport.0) / f64::from(viewport.1)
    } else {
        source_width / source_height
    };
    let source_aspect = source_width / source_height;
    let crop_by_width = source_aspect > expected_aspect;
    let crop_width = if crop_by_width {
        js_round(source_height * expected_aspect)
    } else {
        source_width
    };
    let crop_height = if crop_by_width {
        source_height
    } else {
        js_round(source_width / expected_aspect)
    };
    let crop_x = js_round((source_width - crop_width) / 2.0).max(0.0);
    let crop_y = js_round((source_height - crop_height) / 2.0).max(0.0);
    let crop = (crop_width > 0.0 && crop_height > 0.0).then_some(Crop {
        x: crop_x as u32,
        y: crop_y as u32,
        width: crop_width as u32,
        height: crop_height as u32,
    });
    let cropped_width = crop.map_or(source.0, |crop| crop.width);
    PreviewPlan {
        crop,
        preview_width: PREVIEW_MAX_WIDTH.min(cropped_width),
    }
}

/// `browserSuggestionsUrl`: `Ok(None)` for a query asking for nothing, `Err`
/// for a base URL `new URL` would throw on.
pub fn browser_suggestions_url(base_url: &str, query: &str) -> Result<Option<String>, String> {
    let query = js_trim(query);
    if query.is_empty() {
        return Ok(None);
    }
    let url = Url::parse(base_url)
        .and_then(|base| base.join("/api/browser/suggestions"))
        .map_err(|error| error.to_string())?;
    Ok(Some(format!("{url}?q={}", encode_uri_component(query))))
}

#[cfg(test)]
mod tests {
    use super::*;

    // The cases of tests/browser-mode.test.mjs.

    fn search(encoded: &str) -> String {
        format!("https://www.google.com/search?q={encoded}")
    }

    #[test]
    fn an_empty_address_goes_home() {
        assert_eq!(normalize_navigation_input(""), HOME_URL);
        assert_eq!(normalize_navigation_input("   "), HOME_URL);
        assert_eq!(normalize_navigation_input("\u{a0}\u{feff}"), HOME_URL);
    }

    #[test]
    fn a_web_address_loads_as_typed_without_being_normalised() {
        for typed in [
            "https://example.com",
            "HTTPS://EXAMPLE.COM",
            "HTTP://Example.com",
            "https:example.com",
            "http://localhost:3000",
            "http://[::1]:8080/",
        ] {
            assert_eq!(normalize_navigation_input(typed), typed);
        }
    }

    #[test]
    fn a_likely_address_gets_https_in_front() {
        assert_eq!(
            normalize_navigation_input("example.com"),
            "https://example.com"
        );
        assert_eq!(
            normalize_navigation_input("  example.com/path?q=1  "),
            "https://example.com/path?q=1"
        );
        assert_eq!(
            normalize_navigation_input("localhost:3000"),
            "https://localhost:3000"
        );
        assert_eq!(
            normalize_navigation_input("LOCALHOST:3000"),
            "https://LOCALHOST:3000"
        );
        assert_eq!(
            normalize_navigation_input("127.0.0.1:8080"),
            "https://127.0.0.1:8080"
        );
        assert_eq!(
            normalize_navigation_input("m\u{fc}nchen.de"),
            "https://m\u{fc}nchen.de"
        );
        assert_eq!(normalize_navigation_input("x."), "https://x.");
    }

    #[test]
    fn anything_with_a_dot_is_a_likely_address_however_odd_the_result() {
        assert_eq!(
            normalize_navigation_input("ftp://files.example.com"),
            "https://ftp://files.example.com"
        );
        assert_eq!(
            normalize_navigation_input("mailto:a@b.co"),
            "https://mailto:a@b.co"
        );
        assert_eq!(
            normalize_navigation_input("HTTP://[bad"),
            "https://HTTP://[bad"
        );
        assert_eq!(normalize_navigation_input("a\tb.com"), "https://a\tb.com");
    }

    #[test]
    fn everything_else_is_a_search_encoded_as_encode_uri_component_does() {
        let cases = [
            ("localhost", "localhost"),
            ("grace", "grace"),
            ("what is grace", "what%20is%20grace"),
            ("a b.com", "a%20b.com"),
            ("https://exa mple.com", "https%3A%2F%2Fexa%20mple.com"),
            ("http://", "http%3A%2F%2F"),
            ("file:///etc/passwd", "file%3A%2F%2F%2Fetc%2Fpasswd"),
            ("javascript:alert(1)", "javascript%3Aalert(1)"),
            ("about:blank", "about%3Ablank"),
            ("data:text/html,hi", "data%3Atext%2Fhtml%2Chi"),
            ("C#", "C%23"),
            ("100% & more/?", "100%25%20%26%20more%2F%3F"),
            ("emoji \u{1F64F} worship", "emoji%20%F0%9F%99%8F%20worship"),
            ("\u{65e5}\u{672c}\u{8a9e}", "%E6%97%A5%E6%9C%AC%E8%AA%9E"),
            ("\u{2003}John 3:16\u{2003}", "John%203%3A16"),
            ("\u{85}example.com", "%C2%85example.com"),
        ];
        for (typed, encoded) in cases {
            assert_eq!(
                normalize_navigation_input(typed),
                search(encoded),
                "{typed:?}"
            );
        }
    }

    #[test]
    fn only_http_and_https_are_web_addresses() {
        assert!(is_valid_http_url("https://example.com"));
        assert!(is_valid_http_url("http://localhost:3000"));
        assert!(!is_valid_http_url("ftp://example.com"));
        assert!(!is_valid_http_url("file:///tmp/a.html"));
        assert!(!is_valid_http_url("about:blank"));
        assert!(!is_valid_http_url("example.com"));
        assert!(!is_valid_http_url("http://"));
        assert!(is_likely_url(" 127.0.0.1:5 "));
        assert!(!is_likely_url("localhost"));
    }

    #[test]
    fn a_view_restores_the_page_it_is_on_then_the_last_one_then_home() {
        assert_eq!(
            restore_url(Some("https://a.test/"), Some("https://b.test/")),
            "https://a.test/"
        );
        assert_eq!(
            restore_url(Some(BLANK), Some("https://b.test/")),
            "https://b.test/"
        );
        assert_eq!(
            restore_url(Some(""), Some("https://b.test/")),
            "https://b.test/"
        );
        assert_eq!(restore_url(None, Some(BLANK)), HOME_URL);
        assert_eq!(restore_url(None, Some("")), HOME_URL);
    }

    #[test]
    fn the_viewport_is_rounded_half_up_and_never_negative() {
        let raw = |x, y, width, height| RawBounds {
            x,
            y,
            width,
            height,
        };
        let bounds = |x, y, width, height| Bounds {
            x,
            y,
            width,
            height,
        };
        assert_eq!(
            clamp_browser_bounds(raw(-3.5, 2.5, 100.49, -0.5)),
            bounds(0, 3, 100, 0)
        );
        assert_eq!(
            clamp_browser_bounds(raw(-0.4, 0.5, 1.5, 1e9 + 0.5)),
            bounds(0, 1, 2, 1_000_000_001)
        );
        assert_eq!(
            js_round(0.499_999_999_999_999_94),
            0.0,
            "Math.round, not x + 0.5 floored"
        );
    }

    #[test]
    fn the_preview_is_the_captures_centred_crop_in_the_viewports_shape() {
        let plan = |crop: Option<(u32, u32, u32, u32)>, preview_width| PreviewPlan {
            crop: crop.map(|(x, y, width, height)| Crop {
                x,
                y,
                width,
                height,
            }),
            preview_width,
        };
        assert_eq!(
            preview_crop((2400, 1600), (1200, 600)),
            plan(Some((0, 200, 2400, 1200)), 360)
        );
        assert_eq!(
            preview_crop((1000, 1000), (640, 960)),
            plan(Some((167, 0, 667, 1000)), 360)
        );
        assert_eq!(
            preview_crop((301, 100), (300, 100)),
            plan(Some((1, 0, 300, 100)), 300)
        );
        assert_eq!(
            preview_crop((1001, 333), (3, 1)),
            plan(Some((1, 0, 999, 333)), 360)
        );
        assert_eq!(
            preview_crop((200, 150), (0, 0)),
            plan(Some((0, 0, 200, 150)), 200)
        );
        assert_eq!(
            preview_crop((200, 150), (100, 0)),
            plan(Some((0, 0, 200, 150)), 200)
        );
        assert_eq!(preview_crop((3, 1000), (1000, 1)), plan(None, 3));
        assert_eq!(preview_crop((5, 2), (1, 1000)), plan(None, 5));
    }

    #[test]
    fn suggestions_come_from_the_web_app_for_a_query_with_something_in_it() {
        assert_eq!(
            browser_suggestions_url("https://present.multivrs.space", "  amazing grace  "),
            Ok(Some(
                "https://present.multivrs.space/api/browser/suggestions?q=amazing%20grace"
                    .to_owned()
            ))
        );
        assert_eq!(
            browser_suggestions_url("http://localhost:3001/app/", "a&b=c/?#\u{e9}"),
            Ok(Some(
                "http://localhost:3001/api/browser/suggestions?q=a%26b%3Dc%2F%3F%23%C3%A9"
                    .to_owned()
            ))
        );
        assert_eq!(browser_suggestions_url("https://x.test", "   "), Ok(None));
        assert!(browser_suggestions_url("not a url", "q").is_err());
    }

    #[test]
    fn a_new_browser_starts_blank_projecting_to_the_preview_polling_every_180_ms() {
        assert_eq!(SCROLL_SYNC_INTERVAL.as_millis(), 180);
        assert_eq!(
            serde_json::to_value(BrowserState::default()).unwrap(),
            serde_json::json!({
                "url": "about:blank",
                "title": "",
                "canGoBack": false,
                "canGoForward": false,
                "isLoading": false,
                "projectionTarget": "preview",
                "scrollX": 0.0,
                "scrollY": 0.0,
                "previewDataUrl": null,
            })
        );
    }
}
