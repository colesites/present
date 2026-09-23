//! Importing PowerPoint files, without Python.
//!
//! Replaces `parse-pptx`: `parse_pptx.py` run under a system `python3` with
//! `python-pptx`, then `src/main/lib/pptx-payload.mjs`. The owner chose a
//! Rust parser over shipping Python (stage-7-subsystems.md §1): under Electron
//! a machine without Python could not import a PPTX at all.
//!
//! The output is required to be the Electron importer's, exactly —
//! `tests/fixtures/pptx/*.expected.json` are its recordings, and the tests here
//! compare against them. `payload.rs` is the Python, `convert.rs` the
//! JavaScript.

use std::path::Path;

use serde_json::Value;

use crate::errors::{AppError, AppResult};

pub mod convert;
mod image;
pub mod numbers;
pub mod package;
pub mod payload;

/// A presentation as the renderer receives it (`ParsedPptxPresentation`).
pub fn import(path: &Path) -> AppResult<Value> {
    let file = std::fs::File::open(path)?;
    let package = package::Package::open(std::io::BufReader::new(file))?;
    let payload = payload::parse(&package)?;
    Ok(convert::to_presentation(&payload, &path.to_string_lossy()))
}

/// `import`, with the message the Electron build gave a failed parse.
pub fn import_for_renderer(path: &Path) -> AppResult<Value> {
    import(path).map_err(|error| {
        AppError::Invalid(format!(
            "[pptx] Could not import this PowerPoint file. {error}"
        ))
    })
}

#[cfg(test)]
mod tests {
    use std::path::PathBuf;

    use super::*;

    fn fixtures() -> PathBuf {
        PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../tests/fixtures/pptx")
    }

    /// Equal as JSON is to JavaScript: numbers by value, whatever their
    /// integer or float spelling.
    fn same(left: &Value, right: &Value, path: &str) -> Result<(), String> {
        match (left, right) {
            (Value::Number(a), Value::Number(b)) => {
                let (a, b) = (
                    a.as_f64().unwrap_or(f64::NAN),
                    b.as_f64().unwrap_or(f64::NAN),
                );
                if a == b {
                    Ok(())
                } else {
                    Err(format!("{path}: {a} != {b}"))
                }
            }
            (Value::Object(a), Value::Object(b)) => {
                for key in a.keys().chain(b.keys()) {
                    same(
                        a.get(key).unwrap_or(&Value::Null),
                        b.get(key).unwrap_or(&Value::Null),
                        &format!("{path}.{key}"),
                    )?;
                    if a.contains_key(key) != b.contains_key(key) {
                        return Err(format!("{path}.{key}: present on one side only"));
                    }
                }
                Ok(())
            }
            (Value::Array(a), Value::Array(b)) => {
                if a.len() != b.len() {
                    return Err(format!("{path}: {} items != {}", a.len(), b.len()));
                }
                a.iter()
                    .zip(b)
                    .enumerate()
                    .try_for_each(|(index, (a, b))| same(a, b, &format!("{path}[{index}]")))
            }
            _ if left == right => Ok(()),
            _ => Err(format!("{path}: {left} != {right}")),
        }
    }

    #[test]
    fn every_fixture_imports_exactly_as_the_electron_importer_imported_it() {
        let mut checked = 0;
        for entry in std::fs::read_dir(fixtures()).unwrap() {
            let path = entry.unwrap().path();
            if path.extension().and_then(|ext| ext.to_str()) != Some("pptx") {
                continue;
            }
            let expected: Value = serde_json::from_str(
                &std::fs::read_to_string(path.with_extension("expected.json")).unwrap(),
            )
            .unwrap();
            let imported = import(&path).unwrap();
            if let Err(difference) = same(&imported, &expected, "") {
                panic!("{}: {difference}", path.display());
            }
            checked += 1;
        }
        assert_eq!(checked, 4, "all four fixtures were checked");
    }

    #[test]
    fn a_file_that_is_not_a_presentation_is_refused_with_a_reason() {
        let directory = std::env::temp_dir().join(format!("present-pptx-{}", std::process::id()));
        std::fs::create_dir_all(&directory).unwrap();
        let path = directory.join("not.pptx");
        std::fs::write(&path, b"plain text").unwrap();
        let error = import_for_renderer(&path).unwrap_err().to_string();
        assert!(error.contains("[pptx]"), "{error}");
        let _ = std::fs::remove_dir_all(directory);
    }
}
