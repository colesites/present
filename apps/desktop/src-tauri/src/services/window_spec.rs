//! What each of Present's windows *is*, expressed as data.
//!
//! Electron spreads this across eight modules under `src/main/windows/`, where
//! every constant is inline in a `new BrowserWindow({...})` call and nothing can
//! be asserted without launching Electron. Here each window is a serialisable
//! struct, so the hardening that matters during a service — the black
//! background, the deferred first paint, the crash policy — is checked by unit
//! tests instead of by remembering to look.
//!
//! Nothing in this module touches Tauri. `services/window.rs` turns these specs
//! into real windows.

use serde::{Deserialize, Serialize};

use super::display::ScreenRole;

/// Present's eight windows. The serde names match the `?window=` values
/// `App.tsx:57-72` already branches on.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum WindowRole {
    /// Operator UI.
    Main,
    /// The audience/projector surface. Production-critical.
    Output,
    /// Confidence monitor.
    MediaStage,
    /// Stage display.
    WorshipStage,
    Settings,
    Looks,
    ScreenComposer,
    /// Quick lyric editor. The only role with more than one live instance.
    MiniLyrics,
}

impl WindowRole {
    /// Every single-instance role, i.e. everything `open_window` accepts.
    pub const SINGLETONS: [WindowRole; 7] = [
        WindowRole::Main,
        WindowRole::Output,
        WindowRole::MediaStage,
        WindowRole::WorshipStage,
        WindowRole::Settings,
        WindowRole::Looks,
        WindowRole::ScreenComposer,
    ];

    /// The Tauri window label. Stable, because capabilities are matched on it.
    pub fn label(self) -> &'static str {
        match self {
            WindowRole::Main => "main",
            WindowRole::Output => "output",
            WindowRole::MediaStage => "media-stage",
            WindowRole::WorshipStage => "worship-stage",
            WindowRole::Settings => "settings",
            WindowRole::Looks => "looks",
            WindowRole::ScreenComposer => "screen-composer",
            WindowRole::MiniLyrics => "mini-lyrics",
        }
    }

    /// The event Electron sends the main window when this one closes
    /// (`output.window.ts:103`, `media-stage.window.ts:85`,
    /// `worship-stage.window.ts:85`). Roles Electron stays silent about return
    /// `None`, so the Tauri build does not start emitting events no listener
    /// expects.
    pub fn closed_event(self) -> Option<&'static str> {
        match self {
            WindowRole::Output => Some("output-window-closed"),
            WindowRole::MediaStage => Some("media-stage-window-closed"),
            WindowRole::WorshipStage => Some("worship-stage-window-closed"),
            _ => None,
        }
    }
}

/// An opaque 24-bit colour. Kept as bytes rather than a string so the
/// comparison against Electron's hex literal happens once, in a test.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct Rgb(pub u8, pub u8, pub u8);

impl Rgb {
    /// The audience screen. A white flash here is visible to the whole room.
    pub const BLACK: Rgb = Rgb(0x00, 0x00, 0x00);
    /// The app background, `hsl(238 30% 10%)` — see `main.window.ts:118-124`.
    pub const APP_CHROME: Rgb = Rgb(0x12, 0x13, 0x1c);

    pub fn to_hex(self) -> String {
        format!("#{:02x}{:02x}{:02x}", self.0, self.1, self.2)
    }
}

/// Where the window goes and how big it is.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", tag = "kind")]
pub enum Placement {
    /// Cover the monitor chosen for this screen role, undecorated and
    /// fullscreen. Used by the output and the two stage displays.
    FillRoleDisplay { role: ScreenRole },
    /// An ordinary decorated window, centred on the primary display.
    Windowed {
        width: f64,
        height: f64,
        min: Option<(f64, f64)>,
        max: Option<(f64, f64)>,
    },
}

impl Placement {
    pub fn screen_role(&self) -> Option<ScreenRole> {
        match self {
            Placement::FillRoleDisplay { role } => Some(*role),
            Placement::Windowed { .. } => None,
        }
    }

    pub fn is_fullscreen(&self) -> bool {
        matches!(self, Placement::FillRoleDisplay { .. })
    }
}

/// What to do when the webview's content process dies under the window.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", tag = "kind")]
pub enum CrashPolicy {
    /// Leave the window alone.
    Ignore,
    /// Reload every time, with no ceiling. This is what the audience window
    /// does today (`output.window.ts:83-92`) — a black window on the projector
    /// is worse than a reload loop nobody in the room can see.
    ReloadAlways,
    /// Reload, but stop once the crashes are clearly repeating
    /// (`main.window.ts:196-227`).
    ReloadWithLoopGuard { max_attempts: u32, within_ms: u64 },
}

/// One window, fully described.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WindowSpec {
    pub role: WindowRole,
    /// Unique per window. Equals `role.label()` for every singleton role.
    pub label: String,
    pub title: String,
    /// Path relative to the app URL, query string included.
    pub url: String,
    pub placement: Placement,
    pub background: Rgb,
    pub crash_policy: CrashPolicy,
    /// Whether the window takes focus once it is shown.
    pub focus_on_show: bool,
    /// Show the window anyway if the first paint has not arrived by now.
    ///
    /// Electron has no equivalent: `ready-to-show` either fires or the window
    /// stays hidden forever. Because every window here is created with its
    /// final background colour already applied, showing early costs nothing
    /// visually, while never showing costs an operator their projector.
    pub show_watchdog_ms: u64,
}

/// Deferring the first paint is worth at most this long. Four seconds is well
/// past a normal load and well short of an operator deciding the app is broken.
const SHOW_WATCHDOG_MS: u64 = 4_000;

/// The spec for a single-instance role.
///
/// # Panics
///
/// On `WindowRole::MiniLyrics`, which is keyed by library and has no single
/// spec — use [`mini_lyrics_spec`].
pub fn spec_for(role: WindowRole) -> WindowSpec {
    match role {
        // main.window.ts:112-137
        WindowRole::Main => WindowSpec {
            role,
            label: role.label().to_owned(),
            title: "Present".to_owned(),
            url: "index.html".to_owned(),
            placement: Placement::Windowed {
                width: 1560.0,
                height: 980.0,
                min: Some((1180.0, 760.0)),
                max: None,
            },
            background: Rgb::APP_CHROME,
            crash_policy: CrashPolicy::ReloadWithLoopGuard {
                max_attempts: 2,
                within_ms: 10_000,
            },
            focus_on_show: false,
            show_watchdog_ms: SHOW_WATCHDOG_MS,
        },

        // output.window.ts:52-74. Every field here is load-bearing; see the
        // tests below for which symptom each one prevents.
        WindowRole::Output => WindowSpec {
            role,
            label: role.label().to_owned(),
            title: "Output".to_owned(),
            url: "output.html".to_owned(),
            placement: Placement::FillRoleDisplay {
                role: ScreenRole::Audience,
            },
            background: Rgb::BLACK,
            crash_policy: CrashPolicy::ReloadAlways,
            // The audience window must never steal focus from the operator
            // mid-service (`output.window.ts:76-81` shows without focusing).
            focus_on_show: false,
            show_watchdog_ms: SHOW_WATCHDOG_MS,
        },

        // media-stage.window.ts:45-63
        WindowRole::MediaStage => WindowSpec {
            role,
            label: role.label().to_owned(),
            title: "Media Stage".to_owned(),
            url: "index.html?window=media-stage".to_owned(),
            placement: Placement::FillRoleDisplay {
                role: ScreenRole::Media,
            },
            background: Rgb::APP_CHROME,
            crash_policy: CrashPolicy::Ignore,
            focus_on_show: true,
            show_watchdog_ms: SHOW_WATCHDOG_MS,
        },

        // worship-stage.window.ts:45-63
        WindowRole::WorshipStage => WindowSpec {
            role,
            label: role.label().to_owned(),
            title: "Worship Stage".to_owned(),
            url: "index.html?window=worship-stage".to_owned(),
            placement: Placement::FillRoleDisplay {
                role: ScreenRole::Worship,
            },
            background: Rgb::BLACK,
            crash_policy: CrashPolicy::Ignore,
            focus_on_show: true,
            show_watchdog_ms: SHOW_WATCHDOG_MS,
        },

        // settings.window.ts:25-41
        WindowRole::Settings => WindowSpec {
            role,
            label: role.label().to_owned(),
            title: "Settings".to_owned(),
            url: "index.html?window=settings".to_owned(),
            placement: Placement::Windowed {
                width: 1100.0,
                height: 760.0,
                min: Some((900.0, 620.0)),
                max: None,
            },
            background: Rgb::APP_CHROME,
            crash_policy: CrashPolicy::Ignore,
            focus_on_show: true,
            show_watchdog_ms: SHOW_WATCHDOG_MS,
        },

        // looks.window.ts:18-34
        WindowRole::Looks => WindowSpec {
            role,
            label: role.label().to_owned(),
            title: "Looks".to_owned(),
            url: "index.html?window=looks".to_owned(),
            placement: Placement::Windowed {
                width: 1080.0,
                height: 760.0,
                min: Some((940.0, 620.0)),
                max: None,
            },
            background: Rgb::APP_CHROME,
            crash_policy: CrashPolicy::Ignore,
            focus_on_show: true,
            show_watchdog_ms: SHOW_WATCHDOG_MS,
        },

        // screen-composer.window.ts:19-35
        WindowRole::ScreenComposer => WindowSpec {
            role,
            label: role.label().to_owned(),
            title: "Screen Composer".to_owned(),
            url: "index.html?window=screen-composer".to_owned(),
            placement: Placement::Windowed {
                width: 1560.0,
                height: 940.0,
                min: Some((1240.0, 760.0)),
                max: None,
            },
            background: Rgb::APP_CHROME,
            crash_policy: CrashPolicy::Ignore,
            focus_on_show: true,
            show_watchdog_ms: SHOW_WATCHDOG_MS,
        },

        WindowRole::MiniLyrics => {
            unreachable!("mini-lyrics windows are per-library; use mini_lyrics_spec")
        }
    }
}

/// Library ids come from the frontend, and they end up in both a window label
/// and a URL. Restrict them to characters that are safe in each.
fn sanitize_library_id(library_id: &str) -> String {
    library_id
        .chars()
        .filter(|c| c.is_ascii_alphanumeric() || *c == '-' || *c == '_')
        .collect()
}

/// The spec for one mini-lyrics window (`mini-lyrics.window.ts:56-96`).
///
/// Returns `None` when the library id has no usable characters, because a
/// window whose label collapsed to the empty string would collide with the next
/// one and silently reuse it.
pub fn mini_lyrics_spec(library_id: &str, song_title: &str) -> Option<WindowSpec> {
    let id = sanitize_library_id(library_id);
    if id.is_empty() {
        return None;
    }

    Some(WindowSpec {
        role: WindowRole::MiniLyrics,
        label: format!("{}-{id}", WindowRole::MiniLyrics.label()),
        title: if song_title.trim().is_empty() {
            "Mini Lyrics Editor".to_owned()
        } else {
            format!("Mini Lyrics - {song_title}")
        },
        url: format!("index.html?window=mini-lyrics&libraryId={id}"),
        placement: Placement::Windowed {
            width: 420.0,
            height: 560.0,
            min: Some((340.0, 420.0)),
            max: Some((520.0, 720.0)),
        },
        background: Rgb::APP_CHROME,
        crash_policy: CrashPolicy::Ignore,
        focus_on_show: true,
        show_watchdog_ms: SHOW_WATCHDOG_MS,
    })
}

/// The crash policy for a window label, or `None` if the label is not ours.
///
/// Mini-lyrics labels carry a library id, so they are matched by prefix. A
/// label that resolves to nothing gets no recovery at all, which for the
/// audience output would mean a permanently black projector — hence the test.
pub fn crash_policy_for_label(label: &str) -> Option<CrashPolicy> {
    if let Some(role) = WindowRole::SINGLETONS
        .into_iter()
        .find(|role| role.label() == label)
    {
        return Some(spec_for(role).crash_policy);
    }

    let mini_lyrics_prefix = format!("{}-", WindowRole::MiniLyrics.label());
    label
        .strip_prefix(&mini_lyrics_prefix)
        .and_then(|library_id| mini_lyrics_spec(library_id, ""))
        .map(|spec| spec.crash_policy)
}

/// What a crash handler should do next.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CrashAction {
    Reload,
    /// Stop reloading and leave the window as it is, for inspection.
    LeaveInPlace,
}

/// How often this window's content process has died, and when it last did.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct CrashHistory {
    /// Reloads performed, never reset — matching `crashRecoveryAttempts`.
    pub reloads: u32,
    /// `None` before the first crash.
    pub last_crash_at_ms: Option<u64>,
}

/// Decide what to do about a crash, and record it.
///
/// A direct port of `main.window.ts:196-227`, including the parts that look
/// like accidents but are the shipped behaviour: the attempt counter never
/// resets, and the guard compares against the gap since the *previous* crash
/// rather than a window from the first one. The tests below walk the exact
/// sequences.
pub fn decide_crash_recovery(
    policy: CrashPolicy,
    history: &mut CrashHistory,
    now_ms: u64,
) -> CrashAction {
    let since_last = history
        .last_crash_at_ms
        .map(|last| now_ms.saturating_sub(last));
    history.last_crash_at_ms = Some(now_ms);

    match policy {
        CrashPolicy::Ignore => CrashAction::LeaveInPlace,
        CrashPolicy::ReloadAlways => {
            history.reloads += 1;
            CrashAction::Reload
        }
        CrashPolicy::ReloadWithLoopGuard {
            max_attempts,
            within_ms,
        } => {
            let repeating = since_last.is_some_and(|gap| gap < within_ms);
            if repeating && history.reloads >= max_attempts {
                CrashAction::LeaveInPlace
            } else {
                history.reloads += 1;
                CrashAction::Reload
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    // --- Characterisation: the constants that must match Electron ---------
    //
    // Each assertion names the symptom it prevents, because a "harmless"
    // tidy-up of one of these values is exactly how the audience screen starts
    // flashing white again.

    #[test]
    fn the_audience_window_is_black() {
        // output.window.ts:64 — `backgroundColor: '#000000'`.
        let spec = spec_for(WindowRole::Output);
        assert_eq!(spec.background, Rgb::BLACK);
        assert_eq!(spec.background.to_hex(), "#000000");
    }

    #[test]
    fn the_audience_window_never_takes_focus() {
        // output.window.ts:76-81 shows without focusing; the two stage windows
        // (media-stage.window.ts:78) deliberately do focus.
        assert!(!spec_for(WindowRole::Output).focus_on_show);
        assert!(spec_for(WindowRole::MediaStage).focus_on_show);
        assert!(spec_for(WindowRole::WorshipStage).focus_on_show);
    }

    #[test]
    fn the_audience_window_reloads_on_every_crash() {
        // output.window.ts:83-92 has no loop guard, unlike the main window.
        assert_eq!(
            spec_for(WindowRole::Output).crash_policy,
            CrashPolicy::ReloadAlways
        );
    }

    #[test]
    fn the_main_window_guards_against_a_crash_loop() {
        // main.window.ts:214 — stop after 2 crashes inside 10s.
        assert_eq!(
            spec_for(WindowRole::Main).crash_policy,
            CrashPolicy::ReloadWithLoopGuard {
                max_attempts: 2,
                within_ms: 10_000,
            }
        );
    }

    #[test]
    fn the_app_chrome_colour_matches_the_ui_background() {
        // main.window.ts:124 — '#12131c', which is hsl(238 30% 10%).
        assert_eq!(Rgb::APP_CHROME.to_hex(), "#12131c");
        assert_eq!(spec_for(WindowRole::Main).background, Rgb::APP_CHROME);
    }

    #[test]
    fn the_worship_stage_is_black_but_the_media_stage_is_not() {
        // worship-stage.window.ts:55 vs media-stage.window.ts:55. The worship
        // stage faces the platform; the media stage is a confidence monitor.
        assert_eq!(spec_for(WindowRole::WorshipStage).background, Rgb::BLACK);
        assert_eq!(spec_for(WindowRole::MediaStage).background, Rgb::APP_CHROME);
    }

    #[test]
    fn full_screen_roles_map_to_the_right_display_preference() {
        assert_eq!(
            spec_for(WindowRole::Output).placement.screen_role(),
            Some(ScreenRole::Audience)
        );
        assert_eq!(
            spec_for(WindowRole::MediaStage).placement.screen_role(),
            Some(ScreenRole::Media)
        );
        assert_eq!(
            spec_for(WindowRole::WorshipStage).placement.screen_role(),
            Some(ScreenRole::Worship)
        );
        assert_eq!(spec_for(WindowRole::Main).placement.screen_role(), None);
    }

    #[test]
    fn window_sizes_match_the_electron_modules() {
        let expected = [
            (WindowRole::Main, 1560.0, 980.0, Some((1180.0, 760.0))),
            (WindowRole::Settings, 1100.0, 760.0, Some((900.0, 620.0))),
            (WindowRole::Looks, 1080.0, 760.0, Some((940.0, 620.0))),
            (
                WindowRole::ScreenComposer,
                1560.0,
                940.0,
                Some((1240.0, 760.0)),
            ),
        ];

        for (role, width, height, min) in expected {
            assert_eq!(
                spec_for(role).placement,
                Placement::Windowed {
                    width,
                    height,
                    min,
                    max: None,
                },
                "{role:?} size drifted from its Electron module"
            );
        }
    }

    #[test]
    fn every_singleton_role_has_a_spec_with_a_matching_label() {
        for role in WindowRole::SINGLETONS {
            let spec = spec_for(role);
            assert_eq!(spec.role, role);
            assert_eq!(spec.label, role.label());
            assert!(!spec.url.is_empty());
        }
    }

    #[test]
    fn singleton_labels_are_unique() {
        let mut labels: Vec<&str> = WindowRole::SINGLETONS
            .iter()
            .map(|role| role.label())
            .collect();
        let count = labels.len();
        labels.sort_unstable();
        labels.dedup();
        assert_eq!(labels.len(), count, "two windows would share a label");
    }

    #[test]
    fn the_six_shared_bundle_windows_carry_the_window_query_parameter() {
        // Only two HTML entries exist; six windows load the main one and
        // App.tsx:57-72 branches on `?window=`.
        for (role, expected) in [
            (WindowRole::MediaStage, "media-stage"),
            (WindowRole::WorshipStage, "worship-stage"),
            (WindowRole::Settings, "settings"),
            (WindowRole::Looks, "looks"),
            (WindowRole::ScreenComposer, "screen-composer"),
        ] {
            let spec = spec_for(role);
            assert_eq!(spec.url, format!("index.html?window={expected}"));
        }

        assert_eq!(spec_for(WindowRole::Main).url, "index.html");
        // The audience window is the one with its own bundle.
        assert_eq!(spec_for(WindowRole::Output).url, "output.html");
    }

    #[test]
    fn role_serialises_as_the_frontend_spells_it() {
        assert_eq!(
            serde_json::to_string(&WindowRole::MediaStage).expect("serializable"),
            "\"media-stage\""
        );
        assert_eq!(
            serde_json::to_string(&WindowRole::ScreenComposer).expect("serializable"),
            "\"screen-composer\""
        );
    }

    #[test]
    fn only_the_three_windows_electron_announces_have_a_closed_event() {
        assert_eq!(
            WindowRole::Output.closed_event(),
            Some("output-window-closed")
        );
        assert_eq!(
            WindowRole::MediaStage.closed_event(),
            Some("media-stage-window-closed")
        );
        assert_eq!(
            WindowRole::WorshipStage.closed_event(),
            Some("worship-stage-window-closed")
        );
        assert_eq!(WindowRole::Looks.closed_event(), None);
        assert_eq!(WindowRole::Main.closed_event(), None);
    }

    // --- Mini lyrics ------------------------------------------------------

    #[test]
    fn mini_lyrics_windows_are_keyed_by_library() {
        let a = mini_lyrics_spec("abc123", "Amazing Grace").expect("a spec");
        let b = mini_lyrics_spec("def456", "Amazing Grace").expect("a spec");
        assert_ne!(a.label, b.label, "two songs would share one window");
        assert_eq!(a.label, "mini-lyrics-abc123");
        assert_eq!(a.url, "index.html?window=mini-lyrics&libraryId=abc123");
        assert_eq!(a.title, "Mini Lyrics - Amazing Grace");
    }

    #[test]
    fn an_untitled_mini_lyrics_window_falls_back_to_a_generic_title() {
        // mini-lyrics.window.ts:64.
        let spec = mini_lyrics_spec("abc123", "   ").expect("a spec");
        assert_eq!(spec.title, "Mini Lyrics Editor");
    }

    #[test]
    fn library_ids_cannot_smuggle_characters_into_the_label_or_url() {
        let spec = mini_lyrics_spec("ab/../c?x=1&y", "Song").expect("a spec");
        assert_eq!(spec.label, "mini-lyrics-abcx1y");
        assert_eq!(spec.url, "index.html?window=mini-lyrics&libraryId=abcx1y");
    }

    #[test]
    fn a_library_id_with_nothing_usable_is_refused() {
        // Not merely sanitised to "": that label would be reused by the next
        // equally-unusable id, so two songs would edit one window.
        assert!(mini_lyrics_spec("///", "Song").is_none());
        assert!(mini_lyrics_spec("", "Song").is_none());
    }

    #[test]
    fn a_mini_lyrics_label_can_never_collide_with_a_singleton() {
        let spec = mini_lyrics_spec("main", "Song").expect("a spec");
        assert_eq!(spec.label, "mini-lyrics-main");
        for role in WindowRole::SINGLETONS {
            assert_ne!(spec.label, role.label());
        }
    }

    // --- Crash recovery ---------------------------------------------------

    #[test]
    fn every_window_label_resolves_to_a_crash_policy() {
        for role in WindowRole::SINGLETONS {
            assert_eq!(
                crash_policy_for_label(role.label()),
                Some(spec_for(role).crash_policy),
                "{role:?} would lose its crash policy"
            );
        }

        assert_eq!(
            crash_policy_for_label("mini-lyrics-abc123"),
            Some(CrashPolicy::Ignore)
        );
    }

    #[test]
    fn an_unknown_label_has_no_crash_policy() {
        assert_eq!(crash_policy_for_label("not-a-present-window"), None);
        // The bare role name is not a real mini-lyrics window; the real ones
        // always carry a library id.
        assert_eq!(crash_policy_for_label("mini-lyrics"), None);
    }

    #[test]
    fn an_ignoring_policy_never_reloads() {
        let mut history = CrashHistory::default();
        assert_eq!(
            decide_crash_recovery(CrashPolicy::Ignore, &mut history, 1_000),
            CrashAction::LeaveInPlace
        );
        assert_eq!(history.reloads, 0);
    }

    #[test]
    fn the_audience_window_keeps_reloading_however_often_it_crashes() {
        let mut history = CrashHistory::default();
        for tick in 0..10 {
            assert_eq!(
                decide_crash_recovery(CrashPolicy::ReloadAlways, &mut history, tick * 100),
                CrashAction::Reload,
                "a black projector is worse than a reload loop"
            );
        }
        assert_eq!(history.reloads, 10);
    }

    #[test]
    fn the_loop_guard_reproduces_the_electron_sequence() {
        // Walks main.window.ts:196-227 crash by crash.
        let policy = CrashPolicy::ReloadWithLoopGuard {
            max_attempts: 2,
            within_ms: 10_000,
        };
        let mut history = CrashHistory::default();

        // First crash ever: no previous crash to compare against.
        assert_eq!(
            decide_crash_recovery(policy, &mut history, 100_000),
            CrashAction::Reload
        );
        // 2s later — recent, but only one reload so far.
        assert_eq!(
            decide_crash_recovery(policy, &mut history, 102_000),
            CrashAction::Reload
        );
        // 2s later again — recent, and two reloads have happened. Stop.
        assert_eq!(
            decide_crash_recovery(policy, &mut history, 104_000),
            CrashAction::LeaveInPlace
        );
        assert_eq!(history.reloads, 2, "a refusal must not count as a reload");
        // Still crashing quickly: still refuses.
        assert_eq!(
            decide_crash_recovery(policy, &mut history, 106_000),
            CrashAction::LeaveInPlace
        );
    }

    #[test]
    fn a_crash_long_after_the_last_one_is_reloaded_again() {
        // The guard is about crashes *repeating*, not a lifetime budget: an app
        // that crashed twice this morning must still recover this evening.
        let policy = CrashPolicy::ReloadWithLoopGuard {
            max_attempts: 2,
            within_ms: 10_000,
        };
        let mut history = CrashHistory {
            reloads: 2,
            last_crash_at_ms: Some(100_000),
        };

        assert_eq!(
            decide_crash_recovery(policy, &mut history, 130_000),
            CrashAction::Reload
        );
        assert_eq!(history.reloads, 3);
    }

    #[test]
    fn widely_spaced_crashes_never_trip_the_guard() {
        let policy = CrashPolicy::ReloadWithLoopGuard {
            max_attempts: 2,
            within_ms: 10_000,
        };
        let mut history = CrashHistory::default();

        for minute in 0..20 {
            assert_eq!(
                decide_crash_recovery(policy, &mut history, minute * 60_000),
                CrashAction::Reload
            );
        }
    }

    #[test]
    fn a_clock_that_goes_backwards_does_not_panic() {
        // now_ms is monotonic in production, but nothing here should be the
        // thing that takes the app down if it ever is not.
        let policy = CrashPolicy::ReloadWithLoopGuard {
            max_attempts: 2,
            within_ms: 10_000,
        };
        let mut history = CrashHistory {
            reloads: 0,
            last_crash_at_ms: Some(500_000),
        };
        assert_eq!(
            decide_crash_recovery(policy, &mut history, 1_000),
            CrashAction::Reload
        );
    }

    #[test]
    fn every_window_has_a_bounded_wait_before_it_is_shown_anyway() {
        for role in WindowRole::SINGLETONS {
            assert!(
                spec_for(role).show_watchdog_ms > 0,
                "{role:?} could stay hidden forever if its first paint never arrives"
            );
        }
    }
}
