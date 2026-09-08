# Stage 2 (part 1) — Displays

**Status:** display layer complete; windows still to do · **Date:** 2026-09-08

Covers monitor enumeration, role→display selection and persistence. Window
creation is the second half of Stage 2 and is not done yet.

## The problem Tauri creates

Electron's `screen.getAllDisplays()` returns a stable numeric `display.id`, and
the whole app keys off it — the frontend's display pickers and the role→display
preference both carry it.

Tauri's `Monitor` has **no id**. It offers an optional name, a position, a size,
a work area and a scale factor. So identity has to be synthesised, and it has to
survive a restart or the audience output lands on the wrong screen.

## Identity

`services/display_identity.rs` defines identity as **(name, ordinal)**:

- `name` — what the OS reports, `Option<String>`.
- `ordinal` — index among monitors reporting the *same* name. Two identical
  panels of the same model is the realistic case in a church rig.

Monitors are sorted by position, then size, then name before ordinals are
assigned, so the ordinal does not depend on the order the OS happens to
enumerate them in. There is a test for exactly that.

The numeric id the frontend sees is `FNV-1a(name ␟ ordinal)`, masked to 53 bits.
Two deliberate choices:

- **FNV-1a, not `DefaultHasher`.** The standard hasher is explicitly not stable
  across Rust releases, and this value is persisted — it has to mean the same
  thing next year. A test pins the literal so a change fails loudly.
- **53 bits.** JavaScript numbers are exact only to 2^53 − 1. A full 64-bit hash
  would be silently rounded crossing the IPC boundary, and two monitors could
  collapse onto one id. A test walks 256 name/ordinal combinations asserting
  every id stays inside `Number.MAX_SAFE_INTEGER`.

**Preferences persist the key, not the id.** If the hash ever changes, saved
preferences still resolve.

## Persistence

`state/display_state.rs` writes `display-preferences.json` into the app config
directory. This is the fix for the preference being lost on every restart —
`display.service.ts:10-20` keeps it in module globals today, so the operator
re-picks the audience screen before every service.

- **Atomic writes.** Serialise, write to `.json.tmp`, rename. A crash mid-write
  cannot leave a truncated file that loses every saved screen choice.
- **Corrupt files do not block startup.** An operator opening the app ten
  minutes before a service needs a working app far more than a saved screen
  choice. Unreadable preferences log a warning and fall back to defaults.
- **Versioned on disk**, so a later change can migrate rather than discard.
- **Poisoned locks are recovered, not propagated.** These are preferences, not
  invariant-bearing state; taking the app down over them would be wrong.

## Commands

Payload shapes match the existing IPC handlers (`window.ipc.ts:43-83`) so the
React display pickers need no changes.

```
get_displays()                        -> Display[]
get_preferred_display(role)           -> { display, isExplicit } | null
set_preferred_display(role, id|null)  -> ()      // null returns the role to auto
set_preferred_resolution(role, "1920x1080")
get_preferred_resolution(role)        -> { width, height }
```

`isExplicit` is new and worth having: the UI can now show "Auto" instead of
implying the operator chose a screen they never picked.

## Verified on real hardware

The Rust core was run against the actual machine, not only unit tests:

```
displays=[{"id":2103039239563972,"label":"Monitor #41024",
  "bounds":{"x":0,"y":0,"width":3840,"height":2400},
  "workArea":{"x":0,"y":50,"width":3840,"height":2350},
  "isPrimary":true}]
audience={"display":{...},"isExplicit":false}
```

Enumeration, primary detection, work-area inset (`y:50` — the menu bar) and the
automatic fallback all behave. Across four separate app launches the id and
label were byte-identical.

40 Rust unit tests cover the rest, including the 12 display-selection
characterisation cases mirrored from `tests/display-selection.test.mjs`.

## Two things this exposed

### 1. macOS reports a synthetic monitor name

The name comes back as `Monitor #41024`, not `Built-in Retina Display`.
`#41024` looks like a `CGDirectDisplayID`.

**Stability: verified across app restarts, not across an OS reboot or a
replug.** On macOS a `CGDirectDisplayID` is generally stable for a given display
and GPU port but is not guaranteed across reboots or a GPU switch.

The failure mode if it does change is the mild one, by design: the persisted key
no longer matches any connected monitor, so `get_preferred_display` falls
through to the automatic largest-external rule rather than erroring or picking
the wrong screen. That path is covered by
`unplugged_explicit_choice_falls_back_to_largest_external`.

Still worth confirming across a reboot before Stage 2 is called done.

### 2. The label is a UX regression

A display picker showing `Monitor #41024` is worse than Electron's
`Built-in Retina Display`. The label needs a real name from a platform API
(`NSScreen.localizedName` on macOS) rather than tao's synthetic string. Tracked
as Stage 2 follow-up; it does not affect correctness, only what the operator
reads.

## Next

1. Get real monitor names for the picker label.
2. Confirm id stability across a reboot.
3. Window creation: all eight windows, preserving the output window's hardening
   — `#000000` background, no background throttling, show only after first
   paint, single reload on renderer crash (audit §3).
4. Monitor hot-plug → reconcile, matching the three `screen` events in
   `src/main/index.ts:69-79`.
