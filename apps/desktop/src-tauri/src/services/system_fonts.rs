//! Listing the fonts the operating system has.
//!
//! macOS asks `NSFontManager` for the families font-list's helpers list
//! (`fontlist.m`, `fontlist2.m`), and then, unlike them, for every member of
//! each: its PostScript name, weight and traits. Listing only the first member
//! is why every font used to offer a single weight. It is AppKit, so it must
//! run on the main thread; the caller hops there.
//!
//! Elsewhere fontdb reads the system font folders, face by face, with the
//! weight and style each font file declares.

use crate::services::fonts::{describe_member, FamilyEntry};

/// Every face of every family, families sorted as `NSString compare:` sorts,
/// each with its PostScript name, its weight and whether it is italic, as
/// `NSFontManager` gives them. A family that lists no members is described
/// from its own name.
#[cfg(target_os = "macos")]
pub fn list_families(marker: objc2::MainThreadMarker) -> Vec<FamilyEntry> {
    use crate::services::fonts::{css_weight_from_apple, describe_family};
    use objc2_app_kit::NSFontManager;
    use objc2_foundation::{NSNumber, NSString};

    /// NSFontItalicTrait.
    const ITALIC: usize = 0x0000_0001;

    let manager = NSFontManager::sharedFontManager(marker);
    let mut families: Vec<String> = manager
        .availableFontFamilies()
        .iter()
        .map(|family| family.to_string())
        .collect();
    families.sort_by(|a, b| a.encode_utf16().cmp(b.encode_utf16()));

    families
        .iter()
        .flat_map(|family| {
            // Each member is [PostScript name, style name, weight, traits].
            let members: Vec<FamilyEntry> = manager
                .availableMembersOfFontFamily(&NSString::from_str(family))
                .map(|members| {
                    members
                        .iter()
                        .filter_map(|member| {
                            let name = member
                                .firstObject()?
                                .downcast::<NSString>()
                                .ok()?
                                .to_string();
                            let number = |index: usize| {
                                (member.count() > index)
                                    .then(|| {
                                        member.objectAtIndex(index).downcast::<NSNumber>().ok()
                                    })
                                    .flatten()
                            };
                            let weight = number(2).map(|n| css_weight_from_apple(n.integerValue()));
                            let italic = number(3).map(|n| n.unsignedIntegerValue() & ITALIC != 0);
                            Some(describe_member(family, &name, weight, italic))
                        })
                        .collect()
                })
                .unwrap_or_default();
            if members.is_empty() {
                vec![describe_family(family, family)]
            } else {
                members
            }
        })
        .collect()
}

#[cfg(not(target_os = "macos"))]
pub fn list_families() -> Vec<FamilyEntry> {
    let mut database = cosmic_text::fontdb::Database::new();
    database.load_system_fonts();

    let mut entries: Vec<FamilyEntry> = database
        .faces()
        .filter_map(|face| {
            let (family, _) = face.families.first()?;
            let name = if face.post_script_name.is_empty() {
                family.clone()
            } else {
                face.post_script_name.clone()
            };
            Some(describe_member(
                family,
                &name,
                Some(face.weight.0),
                Some(face.style != cosmic_text::fontdb::Style::Normal),
            ))
        })
        .collect();
    entries.sort_by(|a, b| a.family_name.cmp(&b.family_name));
    entries
}
