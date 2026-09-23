//! Listing the fonts the operating system has.
//!
//! macOS asks `NSFontManager`, exactly as font-list's two helpers do
//! (`fontlist.m`, `fontlist2.m`) — the same families, and for each the
//! PostScript name of its first member, which is what the guesses in
//! `fonts::describe_family` read. It is AppKit, so it must run on the main
//! thread; the caller hops there.
//!
//! Elsewhere font-list shells out to PowerShell or `fc-list`. Here fontdb reads
//! the system font folders instead, and the same guesses are applied. That has
//! not been compared with Electron on either platform.

use crate::services::fonts::{describe_family, FamilyEntry};

/// Every family, sorted as `NSString compare:` sorts, each with its first
/// member's PostScript name — the family's own name if it lists none.
#[cfg(target_os = "macos")]
pub fn list_families(marker: objc2::MainThreadMarker) -> Vec<FamilyEntry> {
    use objc2_app_kit::NSFontManager;
    use objc2_foundation::NSString;

    let manager = NSFontManager::sharedFontManager(marker);
    let mut families: Vec<String> = manager
        .availableFontFamilies()
        .iter()
        .map(|family| family.to_string())
        .collect();
    families.sort_by(|a, b| a.encode_utf16().cmp(b.encode_utf16()));

    families
        .iter()
        .map(|family| {
            let first_member = manager
                .availableMembersOfFontFamily(&NSString::from_str(family))
                .and_then(|members| members.firstObject())
                .and_then(|member| member.firstObject())
                .and_then(|name| name.downcast::<NSString>().ok())
                .map(|name| name.to_string());
            describe_family(family, first_member.as_deref().unwrap_or(family))
        })
        .collect()
}

#[cfg(not(target_os = "macos"))]
pub fn list_families() -> Vec<FamilyEntry> {
    let mut database = cosmic_text::fontdb::Database::new();
    database.load_system_fonts();

    let mut first_member: std::collections::BTreeMap<String, String> = Default::default();
    for face in database.faces() {
        let Some((family, _)) = face.families.first() else {
            continue;
        };
        first_member
            .entry(family.clone())
            .or_insert_with(|| face.post_script_name.clone());
    }
    first_member
        .iter()
        .map(|(family, post_script)| describe_family(family, post_script))
        .collect()
}
