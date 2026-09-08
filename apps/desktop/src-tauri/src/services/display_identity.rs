//! Giving monitors a stable identity.
//!
//! Electron hands out a numeric `display.id` that survives restarts, and the
//! whole app keys off it — the frontend's display pickers, and the role→display
//! preference. Tauri's `Monitor` has no id at all: just an optional name, a
//! size, a position and a scale factor. So the identity has to be synthesised,
//! and it has to be *stable*, or the audience output lands on the wrong screen
//! after a restart.
//!
//! Identity here is (name, ordinal), where the ordinal disambiguates monitors
//! that report the same name — two identical panels of the same model are the
//! realistic case. Ordinals are assigned in a deterministic order (position,
//! then size) so they do not shuffle between runs.
//!
//! Known limitation: rearranging identically-named monitors in the OS display
//! settings can swap their ordinals. Distinctly-named monitors are unaffected.
//! Persisting the key rather than the derived id keeps that blast radius small.

use serde::{Deserialize, Serialize};

use super::display::{Display, Rect};

/// What gets persisted to remember a chosen monitor.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DisplayKey {
    /// `None` when the OS reports no name — rare, but it happens on Linux.
    pub name: Option<String>,
    /// Index among monitors reporting this same name, in deterministic order.
    pub ordinal: u32,
}

/// The raw facts a monitor gives us, independent of Tauri types so the mapping
/// can be tested without a running app.
#[derive(Debug, Clone, PartialEq)]
pub struct MonitorSnapshot {
    /// What the OS reports. On macOS this is tao's `"Monitor #<model>"`
    /// placeholder. **This is what identity keys on** — it is hardware-derived
    /// and locale-independent, unlike the display label.
    pub name: Option<String>,
    /// The name a person recognises, when the platform can supply one. Label
    /// only: deliberately excluded from `DisplayKey`, because it is localised
    /// and would change with the system language.
    pub localized_name: Option<String>,
    pub position: (i32, i32),
    pub size: (u32, u32),
    pub work_area: Rect,
    pub scale_factor: f64,
    pub is_primary: bool,
}

/// JavaScript numbers are exact only to 2^53 - 1. A full 64-bit hash would be
/// silently rounded on the way to the frontend, so two monitors could collapse
/// onto one id. Mask to 53 bits.
const JS_SAFE_INTEGER_MASK: u64 = (1 << 53) - 1;

/// FNV-1a. `DefaultHasher` is explicitly not stable across Rust releases, and
/// this value is persisted — it has to mean the same thing next year.
fn fnv1a(bytes: &[u8]) -> u64 {
    const OFFSET_BASIS: u64 = 0xcbf2_9ce4_8422_2325;
    const PRIME: u64 = 0x0000_0100_0000_01b3;

    bytes.iter().fold(OFFSET_BASIS, |hash, byte| {
        (hash ^ u64::from(*byte)).wrapping_mul(PRIME)
    })
}

/// Derive the numeric id the frontend sees. Deterministic across runs.
pub fn derive_display_id(key: &DisplayKey) -> i64 {
    let name = key.name.as_deref().unwrap_or("<unnamed>");
    // The separator keeps ("ab", 1) distinct from ("a", 11) once concatenated.
    let material = format!("{name}\u{1f}{}", key.ordinal);
    let hashed = fnv1a(material.as_bytes()) & JS_SAFE_INTEGER_MASK;

    // Zero is a legitimate hash output but reads as "unset" in JS. Shift it.
    let hashed = if hashed == 0 { 1 } else { hashed };

    // Always positive, and inside 2^53, so the cast cannot lose information.
    i64::try_from(hashed).unwrap_or(i64::MAX)
}

/// Assign keys and ids to a set of monitors.
///
/// Sorting is by position then size so ordinals are reproducible; the returned
/// order matches the sorted order, which also gives the selection rule's
/// "first listed" tie-break something stable to bite on.
pub fn identify(monitors: &[MonitorSnapshot]) -> Vec<(DisplayKey, Display)> {
    let mut ordered: Vec<&MonitorSnapshot> = monitors.iter().collect();
    ordered.sort_by(|a, b| {
        a.position
            .cmp(&b.position)
            .then(a.size.cmp(&b.size))
            .then(a.name.cmp(&b.name))
    });

    let mut seen_names: Vec<(Option<String>, u32)> = Vec::new();

    ordered
        .into_iter()
        .map(|monitor| {
            let ordinal = match seen_names
                .iter_mut()
                .find(|(name, _)| name == &monitor.name)
            {
                Some((_, count)) => {
                    *count += 1;
                    *count
                }
                None => {
                    seen_names.push((monitor.name.clone(), 0));
                    0
                }
            };

            let key = DisplayKey {
                name: monitor.name.clone(),
                ordinal,
            };
            let id = derive_display_id(&key);

            let display = Display {
                id,
                label: crate::services::display_names::resolve_label(
                    monitor.localized_name.as_deref(),
                    monitor.name.as_deref(),
                    monitor.is_primary,
                    id,
                ),
                bounds: Rect {
                    x: monitor.position.0,
                    y: monitor.position.1,
                    width: monitor.size.0,
                    height: monitor.size.1,
                },
                work_area: monitor.work_area,
                is_primary: monitor.is_primary,
            };

            (key, display)
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn rect(x: i32, y: i32, width: u32, height: u32) -> Rect {
        Rect {
            x,
            y,
            width,
            height,
        }
    }

    fn monitor(
        name: Option<&str>,
        position: (i32, i32),
        size: (u32, u32),
        is_primary: bool,
    ) -> MonitorSnapshot {
        MonitorSnapshot {
            name: name.map(str::to_owned),
            localized_name: None,
            position,
            size,
            work_area: rect(position.0, position.1, size.0, size.1),
            scale_factor: 2.0,
            is_primary,
        }
    }

    #[test]
    fn ids_are_stable_across_runs() {
        let key = DisplayKey {
            name: Some("Built-in Retina Display".to_owned()),
            ordinal: 0,
        };

        // Pinned literal on purpose: this value is persisted, so a change to the
        // hash is a breaking change and should fail loudly here.
        assert_eq!(derive_display_id(&key), derive_display_id(&key));
        assert_eq!(derive_display_id(&key), 8_334_038_579_969_633);
    }

    #[test]
    fn ids_fit_inside_javascript_safe_integers() {
        for ordinal in 0..64 {
            for name in ["", "A", "Built-in Retina Display", "LG UltraFine"] {
                let id = derive_display_id(&DisplayKey {
                    name: Some(name.to_owned()),
                    ordinal,
                });
                assert!(id > 0, "ids must be positive so 0 can mean 'unset'");
                assert!(
                    id <= 9_007_199_254_740_991,
                    "id {id} exceeds Number.MAX_SAFE_INTEGER and would be rounded in JS"
                );
            }
        }
    }

    #[test]
    fn different_ordinals_of_the_same_name_get_different_ids() {
        let first = derive_display_id(&DisplayKey {
            name: Some("LG UltraFine".to_owned()),
            ordinal: 0,
        });
        let second = derive_display_id(&DisplayKey {
            name: Some("LG UltraFine".to_owned()),
            ordinal: 1,
        });

        assert_ne!(first, second, "two identical panels must not share an id");
    }

    #[test]
    fn the_separator_prevents_name_ordinal_collisions() {
        let ab_one = derive_display_id(&DisplayKey {
            name: Some("ab".to_owned()),
            ordinal: 1,
        });
        let a_eleven = derive_display_id(&DisplayKey {
            name: Some("a".to_owned()),
            ordinal: 11,
        });

        assert_ne!(ab_one, a_eleven);
    }

    #[test]
    fn identical_panels_get_distinct_stable_ordinals() {
        let monitors = vec![
            monitor(Some("LG UltraFine"), (1512, 0), (3840, 2160), false),
            monitor(Some("Built-in Retina Display"), (0, 0), (1512, 982), true),
            monitor(Some("LG UltraFine"), (5352, 0), (3840, 2160), false),
        ];

        let identified = identify(&monitors);
        let ordinals: Vec<u32> = identified.iter().map(|(key, _)| key.ordinal).collect();

        // Sorted by position: built-in (0,0), then the two LGs left to right.
        assert_eq!(ordinals, vec![0, 0, 1]);

        let ids: Vec<i64> = identified.iter().map(|(_, display)| display.id).collect();
        assert_eq!(
            ids.iter().collect::<std::collections::HashSet<_>>().len(),
            3,
            "every monitor needs a distinct id"
        );
    }

    #[test]
    fn ordinals_do_not_depend_on_the_order_the_os_reports_monitors() {
        let a = monitor(Some("LG UltraFine"), (1512, 0), (3840, 2160), false);
        let b = monitor(Some("Built-in Retina Display"), (0, 0), (1512, 982), true);
        let c = monitor(Some("LG UltraFine"), (5352, 0), (3840, 2160), false);

        let forward = identify(&[a.clone(), b.clone(), c.clone()]);
        let shuffled = identify(&[c, a, b]);

        let ids_of = |set: &[(DisplayKey, Display)]| -> Vec<i64> {
            set.iter().map(|(_, display)| display.id).collect()
        };

        assert_eq!(
            ids_of(&forward),
            ids_of(&shuffled),
            "the OS enumeration order must not change which monitor gets which id"
        );
    }

    #[test]
    fn unnamed_monitors_still_get_distinct_ids() {
        let monitors = vec![
            monitor(None, (0, 0), (1920, 1080), true),
            monitor(None, (1920, 0), (1920, 1080), false),
        ];

        let identified = identify(&monitors);
        assert_ne!(identified[0].1.id, identified[1].1.id);
    }

    #[test]
    fn labels_fall_back_the_way_the_electron_handler_does() {
        let identified = identify(&[
            monitor(Some("  "), (0, 0), (1920, 1080), true),
            monitor(None, (1920, 0), (1920, 1080), false),
            monitor(Some("LG UltraFine"), (3840, 0), (3840, 2160), false),
        ]);

        assert_eq!(identified[0].1.label, "Primary Display");
        assert!(identified[1].1.label.starts_with("Screen "));
        assert_eq!(identified[2].1.label, "LG UltraFine");
    }
}
