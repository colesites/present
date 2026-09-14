//! The local error log: redacted, one JSON line an error, rotated at 2 MiB.
//!
//! Replaces `error-reporting.service.ts`. The redaction and the entry are
//! `src/main/lib/diagnostic-redaction.mjs` and `error-log.mjs`, case for case
//! with `tests/error-log.test.mjs`. Nothing leaves the machine; this is a file
//! for whoever is asked to diagnose a service that went wrong.
//!
//! What gets recorded differs from Electron where the runtimes differ:
//!
//! | Electron | here |
//! |---|---|
//! | `report-renderer-error` | `report_renderer_error`, the same payload |
//! | `uncaughtException`, `unhandledRejection` in the main process | a Rust panic, from the panic hook — which runs before the release build aborts |
//! | `render-process-gone` | a webview content process terminating (macOS; Tauri has no hook elsewhere) |
//! | `did-fail-load`, `child-process-gone` | nothing: Tauri reports neither |
//!
//! No Tauri types.

use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::{LazyLock, Mutex};
use std::time::{SystemTime, UNIX_EPOCH};

use regex::Regex;
use serde::Serialize;
use serde_json::{Map, Value};

pub const ERROR_LOG_DIRECTORY: &str = "logs";
pub const ERROR_LOG_FILE_NAME: &str = "present-errors.ndjson";
pub const ERROR_LOG_MAX_BYTES: u64 = 2 * 1024 * 1024;
/// In UTF-16 code units, as `String.prototype.slice` counts.
pub const REDACTED_MAX_UNITS: usize = 20_000;

/// JavaScript's `\s`: Unicode's spaces, the line terminators and U+FEFF, but
/// not U+0085, which Rust's `\s` includes.
const JS_SPACE: &str = r"\t\n\x0B\x0C\r \u{A0}\u{1680}\u{2000}-\u{200A}\u{2028}\u{2029}\u{202F}\u{205F}\u{3000}\u{FEFF}";

struct Rule {
    pattern: Regex,
    replacement: &'static str,
}

/// `redactDiagnosticText`'s four replacements, in its order. The `(?-u)`
/// groups are JavaScript's non-Unicode case folding and ASCII word boundaries.
static RULES: LazyLock<Vec<Rule>> = LazyLock::new(|| {
    let rule = |pattern: String, replacement| Rule {
        pattern: Regex::new(&pattern).expect("the redaction patterns are fixed and valid"),
        replacement,
    };
    vec![
        rule(
            format!(r"(?i-u:bearer)[{JS_SPACE}]+(?i-u:[a-z0-9._~-])+"),
            "Bearer [REDACTED]",
        ),
        rule(
            r"(?i-u:[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,})".to_owned(),
            "[REDACTED_EMAIL]",
        ),
        rule(
            format!(
                r"(?-u:\b)(?i-u:(sessionToken|accessToken|refreshToken|token))=[^{JS_SPACE}&]+"
            ),
            "${1}=[REDACTED]",
        ),
        rule(
            r"(?-u:\b)[A-Za-z0-9_-]{80,}(?-u:\b)".to_owned(),
            "[REDACTED_CREDENTIAL]",
        ),
    ]
});

/// `redactDiagnosticText`.
///
/// Cut at 20 000 UTF-16 code units, but never inside a character: where
/// JavaScript would keep half of a surrogate pair, this keeps neither half.
pub fn redact(text: &str) -> String {
    let mut redacted = text.to_owned();
    for rule in RULES.iter() {
        redacted = rule
            .pattern
            .replace_all(&redacted, rule.replacement)
            .into_owned();
    }

    let mut units = 0;
    let cut = redacted
        .char_indices()
        .find(|(_, character)| {
            units += character.len_utf16();
            units > REDACTED_MAX_UNITS
        })
        .map(|(index, _)| index);
    if let Some(index) = cut {
        redacted.truncate(index);
    }
    redacted
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum Category {
    Main,
    Renderer,
    ChildProcess,
}

/// `PresentErrorEvent`.
#[derive(Debug, Clone, PartialEq)]
pub struct ErrorEvent {
    pub category: Category,
    pub message: String,
    pub name: Option<String>,
    pub stack: Option<String>,
    pub context: Map<String, Value>,
}

/// One line of the log. The field order is the file's.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Entry<'a> {
    app_version: &'a str,
    category: Category,
    context: &'a Map<String, Value>,
    message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    name: Option<String>,
    occurred_at: String,
    platform: &'a str,
    #[serde(skip_serializing_if = "Option::is_none")]
    stack: Option<String>,
}

/// `process.platform`'s name for this build's platform.
pub fn node_platform() -> &'static str {
    match std::env::consts::OS {
        "macos" => "darwin",
        "windows" => "win32",
        other => other,
    }
}

/// `Date.prototype.toISOString` for milliseconds since the epoch.
pub fn iso_timestamp(milliseconds: i64) -> String {
    let days = milliseconds.div_euclid(86_400_000);
    let of_day = milliseconds.rem_euclid(86_400_000);

    // Howard Hinnant's civil_from_days.
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let day_of_era = z.rem_euclid(146_097);
    let year_of_era =
        (day_of_era - day_of_era / 1460 + day_of_era / 36_524 - day_of_era / 146_096) / 365;
    let day_of_year = day_of_era - (365 * year_of_era + year_of_era / 4 - year_of_era / 100);
    let month_index = (5 * day_of_year + 2) / 153;
    let day = day_of_year - (153 * month_index + 2) / 5 + 1;
    let month = if month_index < 10 {
        month_index + 3
    } else {
        month_index - 9
    };
    let year = year_of_era + era * 400 + i64::from(month <= 2);

    format!(
        "{year:04}-{month:02}-{day:02}T{:02}:{:02}:{:02}.{:03}Z",
        of_day / 3_600_000,
        of_day / 60_000 % 60,
        of_day / 1000 % 60,
        of_day % 1000
    )
}

/// `errorLogLine`: the line for `event`, without its newline.
pub fn entry_line(
    event: &ErrorEvent,
    app_version: &str,
    platform: &str,
    occurred_at_ms: i64,
) -> String {
    let present =
        |value: &Option<String>| value.as_deref().filter(|text| !text.is_empty()).map(redact);
    let entry = Entry {
        app_version,
        category: event.category,
        context: &event.context,
        message: redact(&event.message),
        name: present(&event.name),
        occurred_at: iso_timestamp(occurred_at_ms),
        platform,
        stack: present(&event.stack),
    };
    serde_json::to_string(&entry).unwrap_or_default()
}

pub fn should_rotate(size_bytes: u64) -> bool {
    size_bytes >= ERROR_LOG_MAX_BYTES
}

/// `rendererErrorEvent`: what a renderer's report becomes, or `None` for a
/// report that is not an object.
pub fn renderer_event(payload: &Value) -> Option<ErrorEvent> {
    let report = payload.as_object()?;
    let text = |key: &str| report.get(key).and_then(Value::as_str).map(str::to_owned);
    let mut context = Map::new();
    context.insert(
        "source".to_owned(),
        Value::String(text("source").unwrap_or_else(|| "renderer".to_owned())),
    );
    Some(ErrorEvent {
        category: Category::Renderer,
        message: text("message").unwrap_or_else(|| "Renderer error".to_owned()),
        name: text("name"),
        stack: text("stack"),
        context,
    })
}

/// The log file, written one entry at a time.
pub struct ErrorLog {
    path: PathBuf,
    app_version: String,
    writing: Mutex<()>,
}

impl ErrorLog {
    /// The log in `data_dir/logs`, as Electron keeps it in `userData/logs`.
    pub fn new(data_dir: &Path, app_version: &str) -> Self {
        Self {
            path: data_dir.join(ERROR_LOG_DIRECTORY).join(ERROR_LOG_FILE_NAME),
            app_version: app_version.to_owned(),
            writing: Mutex::new(()),
        }
    }

    pub fn path(&self) -> &Path {
        &self.path
    }

    /// Append `event`. A failure is logged and swallowed: the error log must
    /// never become a second error.
    pub fn record(&self, event: &ErrorEvent) {
        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map_or(0, |elapsed| elapsed.as_millis() as i64);
        let line = entry_line(event, &self.app_version, node_platform(), now);
        // Poisoned only by a panic mid-write, which is the one time this is
        // most wanted.
        let _guard = self
            .writing
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        if let Err(error) = self.append(&line) {
            tracing::error!(%error, path = %self.path.display(), "could not write the error log");
        }
    }

    fn append(&self, line: &str) -> std::io::Result<()> {
        if let Some(directory) = self.path.parent() {
            std::fs::create_dir_all(directory)?;
        }
        if let Ok(metadata) = std::fs::metadata(&self.path) {
            if should_rotate(metadata.len()) {
                let mut rotated = self.path.clone().into_os_string();
                rotated.push(".1");
                std::fs::rename(&self.path, rotated)?;
            }
        }

        let mut options = std::fs::OpenOptions::new();
        options.create(true).append(true);
        #[cfg(unix)]
        std::os::unix::fs::OpenOptionsExt::mode(&mut options, 0o600);
        let mut file = options.open(&self.path)?;
        writeln!(file, "{line}")
    }
}

/// Write every panic to the error log before the default hook runs.
///
/// Electron records `uncaughtException` and `unhandledRejection` in its main
/// process. The Rust core's equivalent is a panic, and the release profile
/// aborts on one — but the hook runs first, so this is the one chance to leave
/// a trace of why the app vanished mid-service.
pub fn record_panics(log: std::sync::Arc<ErrorLog>) {
    let previous = std::panic::take_hook();
    std::panic::set_hook(Box::new(move |info| {
        let payload = info.payload();
        let message = payload
            .downcast_ref::<&str>()
            .map(|text| (*text).to_owned())
            .or_else(|| payload.downcast_ref::<String>().cloned())
            .unwrap_or_else(|| "panic".to_owned());
        let location = info.location().map(|location| {
            format!(
                "{}:{}:{}",
                location.file(),
                location.line(),
                location.column()
            )
        });
        let mut context = serde_json::Map::new();
        if let Some(thread) = std::thread::current().name() {
            context.insert(
                "thread".to_owned(),
                serde_json::Value::String(thread.to_owned()),
            );
        }
        log.record(&ErrorEvent {
            category: Category::Main,
            message,
            name: Some("panic".to_owned()),
            stack: location,
            context,
        });
        previous(info);
    }));
}

#[cfg(test)]
mod tests {
    use super::*;

    // The cases of tests/error-log.test.mjs.

    #[test]
    fn a_bearer_token_goes_whatever_case_bearer_was_in_and_whatever_precedes_it() {
        assert_eq!(
            redact("Authorization: bearer abc.DEF_~-123 rest"),
            "Authorization: Bearer [REDACTED] rest"
        );
        assert_eq!(redact("xBearer\u{a0}tok more"), "xBearer [REDACTED] more");
        assert_eq!(
            redact(&format!("Bearer {}", "x".repeat(90))),
            "Bearer [REDACTED]"
        );
    }

    #[test]
    fn an_email_address_goes_and_one_without_a_two_letter_top_level_domain_stays() {
        assert_eq!(
            redact("mail Jane.Doe+tag@Sub.Example.co.uk, next"),
            "mail [REDACTED_EMAIL], next"
        );
        assert_eq!(redact("a@b.c short tld"), "a@b.c short tld");
    }

    #[test]
    fn a_token_parameters_value_goes_up_to_whitespace_or_an_ampersand_and_its_name_keeps_its_case()
    {
        assert_eq!(
            redact("url?sessionToken=abc&accessToken=def;x TOKEN=zz refreshToken=q\u{a0}tail mytoken=keep"),
            "url?sessionToken=[REDACTED]&accessToken=[REDACTED] TOKEN=[REDACTED] refreshToken=[REDACTED]\u{a0}tail mytoken=keep"
        );
        assert_eq!(
            redact("token=a\u{85}b"),
            "token=[REDACTED]",
            "U+0085 is not a JavaScript space"
        );
    }

    #[test]
    fn a_run_of_80_or_more_credential_characters_goes_between_ascii_word_boundaries() {
        let run = |n| "a".repeat(n);
        assert_eq!(
            redact(&format!("id {} end", run(79))),
            format!("id {} end", run(79))
        );
        assert_eq!(
            redact(&format!("id {} end", run(80))),
            "id [REDACTED_CREDENTIAL] end"
        );
        assert_eq!(
            redact(&format!("id {}- end", run(100))),
            "id [REDACTED_CREDENTIAL]- end"
        );
        assert_eq!(
            redact(&format!("id -{} end", "b".repeat(90))),
            "id -[REDACTED_CREDENTIAL] end"
        );
        assert_eq!(
            redact(&format!("é{}", "c".repeat(85))),
            "é[REDACTED_CREDENTIAL]"
        );
    }

    #[test]
    fn the_result_is_cut_to_20_000_utf16_code_units() {
        assert_eq!(redact(&"😀".repeat(10_001)).encode_utf16().count(), 20_000);
        assert_eq!(
            redact(&"word ".repeat(6_000)).encode_utf16().count(),
            20_000
        );
        assert_eq!(
            redact(&format!("{}😀", "a ".repeat(9_999) + "a"))
                .encode_utf16()
                .count(),
            19_999,
            "a pair that would be cut in half is dropped whole"
        );
    }

    fn at_ms() -> i64 {
        // 2026-09-14T09:05:03.007Z
        1_789_376_703_007
    }

    #[test]
    fn an_entry_is_one_json_line_in_this_field_order_with_name_and_stack_left_out_when_absent() {
        let event =
            |message: &str, name: Option<&str>, stack: Option<&str>, context: Value| ErrorEvent {
                category: Category::Renderer,
                message: message.to_owned(),
                name: name.map(str::to_owned),
                stack: stack.map(str::to_owned),
                context: context.as_object().cloned().unwrap_or_default(),
            };
        assert_eq!(
            entry_line(
                &event("Failed for me@example.com", None, None, Value::Null),
                "0.3.8",
                "darwin",
                at_ms()
            ),
            r#"{"appVersion":"0.3.8","category":"renderer","context":{},"message":"Failed for [REDACTED_EMAIL]","occurredAt":"2026-09-14T09:05:03.007Z","platform":"darwin"}"#
        );
        let mut main = event(
            "m",
            Some("TypeError"),
            Some("at x token=abc"),
            serde_json::json!({ "source": "window.error" }),
        );
        main.category = Category::Main;
        assert_eq!(
            entry_line(&main, "0.3.8", "darwin", at_ms()),
            r#"{"appVersion":"0.3.8","category":"main","context":{"source":"window.error"},"message":"m","name":"TypeError","occurredAt":"2026-09-14T09:05:03.007Z","platform":"darwin","stack":"at x token=[REDACTED]"}"#
        );
        assert_eq!(
            entry_line(
                &event("m", Some(""), Some(""), Value::Null),
                "0.3.8",
                "darwin",
                at_ms()
            ),
            r#"{"appVersion":"0.3.8","category":"renderer","context":{},"message":"m","occurredAt":"2026-09-14T09:05:03.007Z","platform":"darwin"}"#
        );
    }

    #[test]
    fn timestamps_are_iso_8601_to_the_millisecond_in_utc() {
        assert_eq!(iso_timestamp(0), "1970-01-01T00:00:00.000Z");
        assert_eq!(iso_timestamp(951_782_400_000), "2000-02-29T00:00:00.000Z");
        assert_eq!(iso_timestamp(1_709_251_199_999), "2024-02-29T23:59:59.999Z");
        assert_eq!(iso_timestamp(-1), "1969-12-31T23:59:59.999Z");
    }

    #[test]
    fn the_log_lives_in_logs_and_rotates_once_it_reaches_2_mib() {
        assert_eq!(
            ErrorLog::new(Path::new("/data"), "1").path(),
            Path::new("/data/logs/present-errors.ndjson")
        );
        assert!(!should_rotate(2_097_151));
        assert!(should_rotate(2_097_152));
    }

    #[test]
    fn a_renderers_report_becomes_a_renderer_event_filling_in_what_it_left_out() {
        assert!(renderer_event(&Value::Null).is_none());
        assert!(renderer_event(&serde_json::json!("boom")).is_none());
        let full = renderer_event(&serde_json::json!({
            "message": "x", "name": "E", "stack": "s", "source": "unhandledrejection"
        }))
        .unwrap();
        assert_eq!(full.message, "x");
        assert_eq!(full.name.as_deref(), Some("E"));
        assert_eq!(full.context["source"], "unhandledrejection");
        let sparse = renderer_event(&serde_json::json!({ "message": 3, "name": 4 })).unwrap();
        assert_eq!(sparse.message, "Renderer error");
        assert_eq!(sparse.name, None);
        assert_eq!(sparse.context["source"], "renderer");
    }

    #[test]
    fn entries_append_and_the_full_file_rotates_to_dot_1() {
        let directory =
            std::env::temp_dir().join(format!("present-error-log-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&directory);
        let log = ErrorLog::new(&directory, "9.9.9");
        let event = renderer_event(&serde_json::json!({ "message": "first" })).unwrap();
        log.record(&event);
        log.record(&event);
        let written = std::fs::read_to_string(log.path()).unwrap();
        assert_eq!(written.lines().count(), 2);
        assert!(written
            .lines()
            .all(|line| serde_json::from_str::<Value>(line).is_ok()));

        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let mode = std::fs::metadata(log.path()).unwrap().permissions().mode();
            assert_eq!(
                mode & 0o777,
                0o600,
                "readable by the operator's account only"
            );
        }

        std::fs::write(log.path(), vec![b'x'; ERROR_LOG_MAX_BYTES as usize]).unwrap();
        log.record(&event);
        let rotated = log.path().with_extension("ndjson.1");
        assert_eq!(
            std::fs::metadata(&rotated).unwrap().len(),
            ERROR_LOG_MAX_BYTES
        );
        assert_eq!(
            std::fs::read_to_string(log.path()).unwrap().lines().count(),
            1
        );
        let _ = std::fs::remove_dir_all(directory);
    }
}
