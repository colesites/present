//! The Open Packaging Conventions container a .pptx is: a zip of parts, each
//! with a content type, joined by relationships.
//!
//! Only what python-pptx resolves for the importer: a part's bytes, its content
//! type (an `Override` for the part name, else the `Default` for its
//! extension, both case-insensitive), and its relationships with their targets
//! made absolute.

use std::collections::HashMap;
use std::io::{Read, Seek};

use crate::errors::{AppError, AppResult};

pub const RT_OFFICE_DOCUMENT: &str =
    "http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument";
pub const RT_SLIDE_LAYOUT: &str =
    "http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout";
pub const RT_SLIDE_MASTER: &str =
    "http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster";
pub const RT_THEME: &str =
    "http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme";

const CT_NS: &str = "http://schemas.openxmlformats.org/package/2006/content-types";
const RELS_NS: &str = "http://schemas.openxmlformats.org/package/2006/relationships";

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Relationship {
    pub id: String,
    pub rel_type: String,
    /// The absolute part name, e.g. `/ppt/slides/slide1.xml`. `None` for an
    /// external target, which is not a part.
    pub target: Option<String>,
}

pub struct Package {
    /// Zip entry names by part name, without the leading slash, lower-cased —
    /// part names are case-insensitive.
    entries: HashMap<String, String>,
    bytes: HashMap<String, Vec<u8>>,
    overrides: HashMap<String, String>,
    defaults: HashMap<String, String>,
}

fn invalid(message: impl Into<String>) -> AppError {
    AppError::Invalid(message.into())
}

impl Package {
    pub fn open(reader: impl Read + Seek) -> AppResult<Self> {
        let mut archive = zip::ZipArchive::new(reader)
            .map_err(|error| invalid(format!("This file is not a PowerPoint package: {error}")))?;

        let mut entries = HashMap::new();
        let mut bytes = HashMap::new();
        for index in 0..archive.len() {
            let mut file = archive
                .by_index(index)
                .map_err(|error| invalid(format!("Unreadable entry in the package: {error}")))?;
            if file.is_dir() {
                continue;
            }
            let name = file.name().to_owned();
            let mut contents = Vec::with_capacity(file.size() as usize);
            file.read_to_end(&mut contents)
                .map_err(|error| invalid(format!("Unreadable entry {name}: {error}")))?;
            let key = name.to_lowercase();
            entries.insert(key.clone(), name);
            bytes.insert(key, contents);
        }

        let mut package = Self {
            entries,
            bytes,
            overrides: HashMap::new(),
            defaults: HashMap::new(),
        };
        package.read_content_types()?;
        Ok(package)
    }

    fn read_content_types(&mut self) -> AppResult<()> {
        let xml = self
            .text("/[Content_Types].xml")
            .ok_or_else(|| invalid("The package has no [Content_Types].xml"))?;
        let document = roxmltree::Document::parse(&xml)
            .map_err(|error| invalid(format!("Unreadable content types: {error}")))?;
        for node in document
            .root_element()
            .children()
            .filter(|node| node.is_element())
        {
            if node.tag_name().namespace() != Some(CT_NS) {
                continue;
            }
            match node.tag_name().name() {
                "Override" => {
                    if let (Some(part), Some(content_type)) =
                        (node.attribute("PartName"), node.attribute("ContentType"))
                    {
                        self.overrides
                            .insert(part.to_lowercase(), content_type.to_owned());
                    }
                }
                "Default" => {
                    if let (Some(extension), Some(content_type)) =
                        (node.attribute("Extension"), node.attribute("ContentType"))
                    {
                        self.defaults
                            .insert(extension.to_lowercase(), content_type.to_owned());
                    }
                }
                _ => {}
            }
        }
        Ok(())
    }

    fn key(part_name: &str) -> String {
        part_name.trim_start_matches('/').to_lowercase()
    }

    pub fn has(&self, part_name: &str) -> bool {
        self.bytes.contains_key(&Self::key(part_name))
    }

    pub fn bytes(&self, part_name: &str) -> Option<&[u8]> {
        self.bytes.get(&Self::key(part_name)).map(Vec::as_slice)
    }

    pub fn text(&self, part_name: &str) -> Option<String> {
        let bytes = self.bytes(part_name)?;
        let bytes = bytes.strip_prefix(b"\xEF\xBB\xBF").unwrap_or(bytes);
        Some(String::from_utf8_lossy(bytes).into_owned())
    }

    /// The part name as it is written in the zip, for its extension.
    pub fn stored_name(&self, part_name: &str) -> Option<String> {
        self.entries
            .get(&Self::key(part_name))
            .map(|name| format!("/{name}"))
    }

    pub fn content_type(&self, part_name: &str) -> Option<String> {
        let lower = part_name.to_lowercase();
        if let Some(found) = self.overrides.get(&lower) {
            return Some(found.clone());
        }
        let extension = lower.rsplit_once('.').map(|(_, extension)| extension)?;
        self.defaults.get(extension).cloned()
    }

    /// The relationships of `part_name`, in document order. A part with no
    /// `.rels` has none.
    pub fn relationships(&self, part_name: &str) -> AppResult<Vec<Relationship>> {
        let (directory, file) = match part_name.rsplit_once('/') {
            Some((directory, file)) => (directory, file),
            None => ("", part_name),
        };
        let rels_name = format!("{directory}/_rels/{file}.rels");
        let Some(xml) = self.text(&rels_name) else {
            return Ok(Vec::new());
        };
        let document = roxmltree::Document::parse(&xml)
            .map_err(|error| invalid(format!("Unreadable relationships {rels_name}: {error}")))?;

        let base = if directory.is_empty() { "/" } else { directory };
        Ok(document
            .root_element()
            .children()
            .filter(|node| {
                node.is_element()
                    && node.tag_name().namespace() == Some(RELS_NS)
                    && node.tag_name().name() == "Relationship"
            })
            .filter_map(|node| {
                let id = node.attribute("Id")?.to_owned();
                let rel_type = node.attribute("Type")?.to_owned();
                let target = node.attribute("Target")?;
                let external = node.attribute("TargetMode") == Some("External");
                Some(Relationship {
                    id,
                    rel_type,
                    target: (!external).then(|| resolve_target(base, target)),
                })
            })
            .collect())
    }

    pub fn related_by_type(&self, part_name: &str, rel_type: &str) -> AppResult<Option<String>> {
        Ok(self
            .relationships(part_name)?
            .into_iter()
            .find(|relationship| relationship.rel_type == rel_type)
            .and_then(|relationship| relationship.target))
    }

    pub fn related_by_id(&self, part_name: &str, id: &str) -> AppResult<Option<String>> {
        Ok(self
            .relationships(part_name)?
            .into_iter()
            .find(|relationship| relationship.id == id)
            .and_then(|relationship| relationship.target))
    }
}

/// A relationship target made absolute against the source part's directory.
pub fn resolve_target(base_directory: &str, target: &str) -> String {
    let joined = if target.starts_with('/') {
        target.to_owned()
    } else {
        format!("{}/{}", base_directory.trim_end_matches('/'), target)
    };
    let mut segments: Vec<&str> = Vec::new();
    for segment in joined.split('/') {
        match segment {
            "" | "." => {}
            ".." => {
                segments.pop();
            }
            other => segments.push(other),
        }
    }
    format!("/{}", segments.join("/"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn targets_are_resolved_against_the_source_part() {
        assert_eq!(
            resolve_target("/ppt/slides", "../slideLayouts/slideLayout2.xml"),
            "/ppt/slideLayouts/slideLayout2.xml"
        );
        assert_eq!(
            resolve_target("/", "ppt/presentation.xml"),
            "/ppt/presentation.xml"
        );
        assert_eq!(
            resolve_target("/ppt/slides", "/ppt/media/image1.png"),
            "/ppt/media/image1.png"
        );
        assert_eq!(
            resolve_target("/ppt/slides", "./../media/./a.png"),
            "/ppt/media/a.png"
        );
    }
}
