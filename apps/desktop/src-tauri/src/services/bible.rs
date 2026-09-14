//! The Bibles that ship inside the app, and the hosted catalog.
//!
//! Replaces `bible.ipc.ts`, `features/bible/bible.service.ts` and the catalog
//! half of `network.ipc.ts`. The naming, id and ordering rules are
//! `src/shared/lib/bible-catalog.mjs`, case for case with
//! `tests/bible-catalog.test.mjs` — quirks included, because the id is built
//! from the code.
//!
//! No Tauri types. Where the Bibles are is the caller's to say.

use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::time::{Duration, UNIX_EPOCH};

use serde::Serialize;

use crate::errors::{AppError, AppResult};
use crate::services::collation;

/// Order matters: the first code an upper-cased file name contains wins.
///
/// `NIrV` is in mixed case, so it can never match; `RV` comes before `ERV`, and
/// `KJV` before `AKJV`. That is Electron's list, and these ids are Electron's.
pub const KNOWN_BIBLE_CODES: [&str; 56] = [
    "NRSVCE", "NRSVA", "NRSV", "NKJV", "TNIV", "AMPC", "HCSB", "NIrV", "NABRE", "RSVCE", "KJV",
    "NIV", "ESV", "NASB", "NLT", "RSV", "AMP", "MSG", "CSB", "NCV", "GNT", "CEV", "TPT", "VOICE",
    "TLB", "PHILLIPS", "MOUNCE", "NET", "ISV", "LEB", "WEB", "ASV", "YLT", "DARBY", "AKJV", "RV",
    "ERV", "BBE", "DRA", "JB", "NJB", "GW", "JUB", "MEV", "NOG", "TLV", "CEB", "CJB", "EHV", "GNV",
    "ICB", "NLV", "BSB", "BRG", "EASY", "EXB",
];

/// Compared against the extension lower-cased.
pub const SUPPORTED_EXTENSIONS: [&str; 3] = ["xml", "json", "zip"];

/// Electron's cap on following redirects for the catalog.
pub const CATALOG_MAX_REDIRECTS: usize = 5;
pub const CATALOG_TIMEOUT: Duration = Duration::from_secs(20);
const ERROR_BODY_CHARS: usize = 300;

/// One entry of `list-bundled-bibles`, as the scripture panel reads it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BundledBible {
    pub id: String,
    pub code: String,
    pub name: String,
    pub file_path: String,
    pub size_bytes: u64,
}

/// `inferBibleCodeFromName`.
pub fn infer_code(file_name_base: &str) -> String {
    let upper = file_name_base.to_uppercase();
    if let Some(code) = KNOWN_BIBLE_CODES.iter().find(|code| upper.contains(*code)) {
        return (*code).to_owned();
    }

    let compact: String = file_name_base
        .chars()
        .filter(char::is_ascii_alphanumeric)
        .collect::<String>()
        .to_ascii_uppercase();
    if (2..=8).contains(&compact.len()) {
        return compact;
    }

    "BIBLE".to_owned()
}

/// `formatBibleName`: runs of `_` and `-` become one space, runs of whitespace
/// become one space, and the ends are trimmed.
pub fn format_name(file_name_base: &str) -> String {
    let mut spaced = String::with_capacity(file_name_base.len());
    let mut in_gap = false;
    for character in file_name_base.chars() {
        if character == '_' || character == '-' || character.is_whitespace() {
            if !in_gap {
                spaced.push(' ');
                in_gap = true;
            }
        } else {
            spaced.push(character);
            in_gap = false;
        }
    }
    let trimmed = spaced.trim();
    if trimmed.is_empty() {
        "Bible".to_owned()
    } else {
        trimmed.to_owned()
    }
}

/// `bundledBibleId`. The modified time is nanoseconds since the epoch, rounded
/// to the millisecond the way `Math.round` rounds Node's `mtimeMs` — half up —
/// but in integers, so no float can land a file on the other millisecond.
pub fn bundled_id(code: &str, size_bytes: u64, modified_ns: i128) -> String {
    let milliseconds = (modified_ns + 500_000).div_euclid(1_000_000);
    format!("{}-{size_bytes}-{milliseconds}", code.to_lowercase())
}

fn supported_extension(path: &Path) -> bool {
    path.extension()
        .and_then(|extension| extension.to_str())
        .is_some_and(|extension| SUPPORTED_EXTENSIONS.contains(&extension.to_lowercase().as_str()))
}

fn modified_ns(metadata: &std::fs::Metadata) -> i128 {
    let Ok(modified) = metadata.modified() else {
        return 0;
    };
    match modified.duration_since(UNIX_EPOCH) {
        Ok(after) => after.as_nanos() as i128,
        Err(before) => -(before.duration().as_nanos() as i128),
    }
}

/// `discoverBundledBibles`: every supported file directly inside each
/// directory, named, in reading order. A directory that is missing or
/// unreadable is skipped, as Electron skips it.
pub fn discover(directories: &[PathBuf]) -> Vec<BundledBible> {
    let mut seen = HashSet::new();
    let mut found = Vec::new();

    for directory in directories {
        let Ok(entries) = std::fs::read_dir(directory) else {
            continue;
        };
        for entry in entries.flatten() {
            // `Dirent.isFile()`: a symlink is not a file here.
            if !entry.file_type().is_ok_and(|kind| kind.is_file()) {
                continue;
            }
            let path = entry.path();
            if !supported_extension(&path) {
                continue;
            }
            let Some(base) = path.file_stem().and_then(|stem| stem.to_str()) else {
                continue;
            };
            let Ok(metadata) = std::fs::metadata(&path) else {
                continue;
            };
            let file_path = path.to_string_lossy().into_owned();
            if !seen.insert(file_path.clone()) {
                continue;
            }
            let code = infer_code(base);
            found.push(BundledBible {
                id: bundled_id(&code, metadata.len(), modified_ns(&metadata)),
                name: format_name(base),
                code,
                file_path,
                size_bytes: metadata.len(),
            });
        }
    }

    found.sort_by(|a, b| collation::locale_order(&a.name, &b.name));
    found
}

/// `read-bundled-bible`: the bytes of a Bible, only from inside one of the
/// directories.
///
/// Refuses the same way whether the file is outside them or does not exist,
/// so the answer cannot be used to ask whether a path exists.
pub fn read(directories: &[PathBuf], requested: &str) -> AppResult<Vec<u8>> {
    let requested = requested.trim();
    if requested.is_empty() {
        return Err(AppError::Invalid("Missing file path".to_owned()));
    }
    let requested = std::path::absolute(requested)?;
    if !supported_extension(&requested) {
        return Err(AppError::Invalid("Unsupported bible file type".to_owned()));
    }

    let roots: Vec<PathBuf> = directories
        .iter()
        .filter_map(|directory| std::fs::canonicalize(directory).ok())
        .filter(|root| root.is_dir())
        .collect();
    if roots.is_empty() {
        return Err(AppError::NotFound("A bundled bible directory".to_owned()));
    }

    let outside = || AppError::Denied("File path is outside bundled bible directories".to_owned());
    let resolved = std::fs::canonicalize(&requested).map_err(|_| outside())?;
    if !roots.iter().any(|root| resolved.starts_with(root)) {
        return Err(outside());
    }
    Ok(std::fs::read(resolved)?)
}

/// `fetch-hosted-bible-catalog`: the catalog's JSON, following at most
/// [`CATALOG_MAX_REDIRECTS`] redirects.
pub async fn fetch_catalog(url: &str) -> AppResult<serde_json::Value> {
    let url = url.trim();
    if url.is_empty() {
        return Err(AppError::Invalid("Missing catalog URL".to_owned()));
    }
    let parsed = reqwest::Url::parse(url)
        .map_err(|error| AppError::Invalid(format!("Invalid catalog URL: {error}")))?;
    // Electron's `net.fetch` would also open `file:` and its own schemes. The
    // catalog is a web address; nothing else should be reachable this way.
    if !matches!(parsed.scheme(), "http" | "https") {
        return Err(AppError::Invalid(
            "The catalog URL must be http or https".to_owned(),
        ));
    }

    let client = reqwest::Client::builder()
        .timeout(CATALOG_TIMEOUT)
        .redirect(reqwest::redirect::Policy::limited(CATALOG_MAX_REDIRECTS))
        .build()
        .map_err(|error| AppError::Invalid(format!("Could not build HTTP client: {error}")))?;
    let response = client
        .get(parsed)
        .header(reqwest::header::CACHE_CONTROL, "no-store")
        .send()
        .await
        .map_err(|error| AppError::Invalid(format!("Catalog request failed: {error}")))?;

    let status = response.status();
    if !status.is_success() {
        // Electron throws the body as the message. It only ever reaches a log,
        // and a web server's 404 page is a lot of log.
        let body = response.text().await.unwrap_or_default();
        let message: String = body.chars().take(ERROR_BODY_CHARS).collect();
        return Err(AppError::Invalid(if message.trim().is_empty() {
            format!("Request failed ({})", status.as_u16())
        } else {
            message
        }));
    }
    response
        .json()
        .await
        .map_err(|error| AppError::Invalid(format!("The catalog is not JSON: {error}")))
}

#[cfg(test)]
mod tests {
    use super::*;

    // The cases of tests/bible-catalog.test.mjs.

    #[test]
    fn every_bible_shipped_in_apps_desktop_bible_gets_the_code_and_name_it_has_today() {
        let directory = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../bible");
        let found: Vec<(String, String, String)> = discover(&[directory])
            .into_iter()
            .map(|bible| {
                let file = Path::new(&bible.file_path)
                    .file_name()
                    .unwrap()
                    .to_string_lossy()
                    .into_owned();
                (file, bible.code, bible.name)
            })
            .collect();
        let mut found = found;
        found.sort();
        let expected = [
            ("AMP.xml", "AMP", "AMP"),
            ("AMPC.xml", "AMPC", "AMPC"),
            ("ESV.xml", "ESV", "ESV"),
            ("EnglishERVBible.xml", "RV", "EnglishERVBible"),
            ("GNT.xml", "GNT", "GNT"),
            ("KJV.xml", "KJV", "KJV"),
            ("MSG.xml", "MSG", "MSG"),
            ("NIV.xml", "NIV", "NIV"),
            ("NKJV.xml", "NKJV", "NKJV"),
            ("NLT.xml", "NLT", "NLT"),
            ("NRSV.xml", "NRSV", "NRSV"),
            ("RSV.xml", "RSV", "RSV"),
            ("TPT.xml", "TPT", "TPT"),
        ]
        .map(|(file, code, name)| (file.to_owned(), code.to_owned(), name.to_owned()));
        assert_eq!(found, expected);
    }

    #[test]
    fn the_first_code_in_the_list_that_the_upper_cased_name_contains_wins() {
        assert_eq!(infer_code("NRSVCE"), "NRSVCE");
        assert_eq!(infer_code("nrsv-ce"), "NRSV");
        assert_eq!(infer_code("kjv-1611"), "KJV");
        assert_eq!(infer_code("AKJV"), "KJV");
        assert_eq!(infer_code("ERV"), "RV");
        assert_eq!(infer_code("NIrV"), "RV");
        assert_eq!(infer_code("Webster"), "WEB");
    }

    #[test]
    fn a_name_with_no_known_code_is_compacted_or_called_bible() {
        assert_eq!(infer_code("my-bible_2"), "MYBIBLE2");
        assert_eq!(infer_code("my-bible_23"), "BIBLE");
        assert_eq!(infer_code("q-z"), "QZ");
        assert_eq!(infer_code("x"), "BIBLE");
        assert_eq!(infer_code("Very Long Name Here"), "BIBLE");
        assert_eq!(infer_code(""), "BIBLE");
    }

    #[test]
    fn the_display_name_turns_underscores_and_hyphens_into_single_spaces() {
        assert_eq!(
            format_name("New_King-James  Version"),
            "New King James Version"
        );
        assert_eq!(format_name("a--b__c"), "a b c");
        assert_eq!(format_name(" ESV "), "ESV");
        assert_eq!(format_name("__"), "Bible");
    }

    #[test]
    fn an_id_is_the_lower_cased_code_the_size_and_the_time_rounded_to_a_millisecond() {
        // 1742922000123.6 ms, as Node's mtimeMs would report it.
        assert_eq!(
            bundled_id("NKJV", 4_504_794, 1_742_922_000_123_600_000),
            "nkjv-4504794-1742922000124"
        );
        assert_eq!(bundled_id("RV", 1, 400_000), "rv-1-0");
        assert_eq!(
            bundled_id("RV", 1, 500_000),
            "rv-1-1",
            "half rounds up, as Math.round does"
        );
    }

    #[test]
    fn only_xml_json_and_zip_files_are_bibles_whatever_the_case_of_the_extension() {
        assert!(supported_extension(Path::new("/b/KJV.XML")));
        assert!(supported_extension(Path::new("/b/KJV.zip")));
        assert!(!supported_extension(Path::new("/b/KJV.txt")));
        assert!(
            !supported_extension(Path::new("/b/.xml")),
            "a hidden file has no extension"
        );
    }

    #[test]
    fn the_list_is_in_locale_compare_order() {
        let directory = temp_dir("order");
        for name in ["b", "A-x", "a_x", "AMP", "Amplified Classic", "9 thing"] {
            std::fs::write(directory.join(format!("{name}.xml")), b"<x/>").unwrap();
        }
        let names: Vec<String> = discover(std::slice::from_ref(&directory))
            .into_iter()
            .map(|bible| bible.name)
            .collect();
        assert_eq!(
            names,
            ["9 thing", "a x", "A x", "AMP", "Amplified Classic", "b"]
        );
        let _ = std::fs::remove_dir_all(directory);
    }

    #[test]
    fn a_folder_or_an_unsupported_file_is_not_listed_and_a_missing_directory_is_skipped() {
        let directory = temp_dir("skip");
        std::fs::create_dir_all(directory.join("NIV.xml")).unwrap();
        std::fs::write(directory.join("notes.txt"), b"x").unwrap();
        std::fs::write(directory.join("ESV.json"), b"{}").unwrap();
        let listed = discover(&[
            directory.join("missing"),
            directory.clone(),
            directory.clone(),
        ]);
        assert_eq!(
            listed.len(),
            1,
            "the same directory twice lists each Bible once"
        );
        assert_eq!(listed[0].code, "ESV");
        assert_eq!(listed[0].size_bytes, 2);
        let _ = std::fs::remove_dir_all(directory);
    }

    #[test]
    fn a_bible_is_read_only_from_inside_the_bundled_directories() {
        let directory = temp_dir("read");
        let bibles = directory.join("bible");
        std::fs::create_dir_all(&bibles).unwrap();
        std::fs::write(bibles.join("KJV.xml"), b"<bible/>").unwrap();
        std::fs::write(directory.join("secret.xml"), b"no").unwrap();
        let roots = [bibles.clone()];

        let inside = bibles.join("KJV.xml");
        assert_eq!(read(&roots, inside.to_str().unwrap()).unwrap(), b"<bible/>");

        let escape = bibles.join("../secret.xml");
        assert!(matches!(
            read(&roots, escape.to_str().unwrap()),
            Err(AppError::Denied(_))
        ));
        let missing = bibles.join("NIV.xml");
        assert!(
            matches!(
                read(&roots, missing.to_str().unwrap()),
                Err(AppError::Denied(_))
            ),
            "a missing file is refused like an outside one"
        );
        assert!(matches!(
            read(&roots, "/etc/passwd"),
            Err(AppError::Invalid(_))
        ));
        assert!(matches!(read(&roots, "  "), Err(AppError::Invalid(_))));
        assert!(matches!(
            read(&[directory.join("none")], inside.to_str().unwrap()),
            Err(AppError::NotFound(_))
        ));
        let _ = std::fs::remove_dir_all(directory);
    }

    #[cfg(unix)]
    #[test]
    fn a_symlink_out_of_the_directory_is_refused() {
        let directory = temp_dir("link");
        let bibles = directory.join("bible");
        std::fs::create_dir_all(&bibles).unwrap();
        std::fs::write(directory.join("outside.xml"), b"no").unwrap();
        std::os::unix::fs::symlink(directory.join("outside.xml"), bibles.join("NIV.xml")).unwrap();
        let link = bibles.join("NIV.xml");
        assert!(matches!(
            read(std::slice::from_ref(&bibles), link.to_str().unwrap()),
            Err(AppError::Denied(_))
        ));
        assert!(discover(&[bibles]).is_empty(), "and it is not listed");
        let _ = std::fs::remove_dir_all(directory);
    }

    #[test]
    fn the_code_list_is_the_one_bible_constants_had() {
        assert_eq!(&KNOWN_BIBLE_CODES[..4], ["NRSVCE", "NRSVA", "NRSV", "NKJV"]);
        assert_eq!(&KNOWN_BIBLE_CODES[53..], ["BRG", "EASY", "EXB"]);
    }

    #[tokio::test]
    async fn the_catalog_url_must_be_a_web_address() {
        assert!(matches!(
            fetch_catalog(" ").await,
            Err(AppError::Invalid(_))
        ));
        assert!(matches!(
            fetch_catalog("file:///etc/passwd").await,
            Err(AppError::Invalid(_))
        ));
        assert!(matches!(
            fetch_catalog("not a url").await,
            Err(AppError::Invalid(_))
        ));
    }

    /// A server on localhost answering each connection with the next response.
    fn serve(responses: Vec<String>) -> String {
        use std::io::{Read, Write};
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let address = listener.local_addr().unwrap();
        std::thread::spawn(move || {
            for response in responses {
                let Ok((mut stream, _)) = listener.accept() else {
                    return;
                };
                let mut request = [0u8; 4096];
                let _ = stream.read(&mut request);
                let _ = stream.write_all(response.as_bytes());
            }
        });
        format!("http://{address}")
    }

    fn redirect(to: &str) -> String {
        format!("HTTP/1.1 302 Found\r\nLocation: {to}\r\nContent-Length: 0\r\nConnection: close\r\n\r\n")
    }

    fn reply(status: &str, body: &str) -> String {
        format!(
            "HTTP/1.1 {status}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
            body.len()
        )
    }

    #[tokio::test]
    async fn the_catalog_follows_a_relative_redirect_to_its_json() {
        let base = serve(vec![
            redirect("/bibles/catalog.json"),
            reply("200 OK", r#"{"versions":[{"code":"KJV"}]}"#),
        ]);
        let catalog = fetch_catalog(&format!("{base}/catalog")).await.unwrap();
        assert_eq!(catalog["versions"][0]["code"], "KJV");
    }

    #[tokio::test]
    async fn more_than_five_redirects_is_an_error() {
        let base = serve((0..7).map(|_| redirect("/again")).collect());
        assert!(matches!(
            fetch_catalog(&base).await,
            Err(AppError::Invalid(_))
        ));
    }

    #[tokio::test]
    async fn a_failed_request_is_reported_with_its_body_or_its_status() {
        let base = serve(vec![reply("404 Not Found", &"x".repeat(5000))]);
        let Err(AppError::Invalid(message)) = fetch_catalog(&base).await else {
            panic!("expected an error");
        };
        assert_eq!(message.len(), ERROR_BODY_CHARS, "the body, cut short");

        let base = serve(vec![reply("500 Internal Server Error", "")]);
        let Err(AppError::Invalid(message)) = fetch_catalog(&base).await else {
            panic!("expected an error");
        };
        assert_eq!(message, "Request failed (500)");
    }

    fn temp_dir(name: &str) -> PathBuf {
        let directory =
            std::env::temp_dir().join(format!("present-bible-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&directory);
        std::fs::create_dir_all(&directory).unwrap();
        directory
    }
}
