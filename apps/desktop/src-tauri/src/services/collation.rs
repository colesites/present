//! Sorting names the way the Electron build's `localeCompare` sorts them.
//!
//! Two lists the operator reads are in that order — NDI sources and bundled
//! Bibles — and a character-code sort would put every upper-case name before
//! every lower-case one.

use std::cmp::Ordering;

/// The order `localeCompare` gives in Node, closely enough for names.
///
/// Electron sorts with ICU's root collation. As ICU does for these names:
///
/// 1. compare ignoring case, with whitespace before punctuation before digits
///    before letters;
/// 2. when that ties, the first difference in case decides, lower case first.
///
/// This is not a collation implementation. Accented letters and the relative
/// order of punctuation marks can differ from ICU, and nothing in a machine
/// name or a Bible file name depends on either.
pub fn locale_order(a: &str, b: &str) -> Ordering {
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_prefix_sorts_first_and_case_only_breaks_ties() {
        let mut names = ["Amplified Classic", "AMP", "b", "A", "a", "B"];
        names.sort_by(|a, b| locale_order(a, b));
        assert_eq!(names, ["a", "A", "AMP", "Amplified Classic", "b", "B"]);
    }
}
