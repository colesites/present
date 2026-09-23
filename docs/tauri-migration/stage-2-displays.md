# Stage 2 (part 1) — Displays

**Status:** complete · **Date:** 2026-09-09

Covers monitor enumeration, role→display selection and persistence. Window
creation is the second half of Stage 2 and is
[stage-2-windows.md](stage-2-windows.md).

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
displays=[{"id":2103039239563972,"label":"Built-in Retina Display",
  "bounds":{"x":0,"y":0,"width":3840,"height":2400},
  "workArea":{"x":0,"y":50,"width":3840,"height":2350},
  "isPrimary":true}]
audience={"display":{...},"isExplicit":false}
```

Enumeration, primary detection, work-area inset (`y:50` — the menu bar) and the
automatic fallback all behave. The id was byte-identical across four separate
app launches, and stayed identical again after the label changed from
`Monitor #41024` to `Built-in Retina Display` — which is the check that proves
the label really is cosmetic.

47 Rust unit tests cover the rest, including the 12 display-selection
characterisation cases mirrored from `tests/display-selection.test.mjs`.

## Two things this exposed

### 1. macOS reports a synthetic monitor name — RESOLVED

The name came back as `Monitor #41024`. Reading tao's source settled what that
actually is (`platform_impl/macos/monitor.rs:205-209`):

```rust
let screen_num = CGDisplay::new(display_id).model_number();
Some(format!("Monitor #{}", screen_num))
```

It is the panel's **model number**, not a display id — which changes the
stability picture for the better. A model number is a hardware property, so it
survives reboots, GPU switches and replugs. My earlier worry that this was a
`CGDirectDisplayID` (which can change across reboots) was wrong.

It also confirms the ordinal was necessary rather than defensive: two identical
monitors report the *same* model number, so the name alone could never have
told them apart.

### 2. The label is a UX regression — FIXED

`services/display_names.rs` asks AppKit for `NSScreen.localizedName` and uses it
as the display label. Verified on real hardware: the picker now reads
**"Built-in Retina Display"** instead of "Monitor #41024", and the id is
unchanged at `2103039239563972`.

Three things worth recording about how it is wired:

**The label is not the identity.** `DisplayKey` still keys on the model-number
name. `localizedName` is *localised* — switching the system language would
rename every monitor and orphan every saved preference. Model numbers are
locale-independent. So the readable name is cosmetic by construction, and the id
staying identical across this change is the proof.

**Matching is exact, not geometric.** `NSScreen.deviceDescription` yields
`NSScreenNumber` (the `CGDirectDisplayID`), which feeds `CGDisplayBounds`, and
the origin is scaled by `backingScaleFactor` — the same computation tao performs
in `position()`. Joining on that rather than converting Cocoa's bottom-left
coordinates by hand avoids a whole class of off-by-one rounding bugs.

**AppKit is main-thread-only and Tauri commands are not.** The lookup hops via
`run_on_main_thread` with a 500 ms bound, and short-circuits when already on the
main thread (calling `run_on_main_thread` from the main thread would deadlock).
Every failure path — wrong thread, timeout, missing key — degrades to "no
localized name", never to a failed enumeration. A label is cosmetic; display
enumeration is not.

tao's placeholder is also explicitly filtered, so `Monitor #41024` can never
reach the UI even if AppKit declines to answer. Names that merely resemble it
(`Monitor #A1`, `Studio Monitor #2`) are kept — there are tests for both.

## Next

Nothing. Stage 2 is complete.

1. ~~Window creation~~ — done, see [stage-2-windows.md](stage-2-windows.md).
   The monitor-reading code in this document moved from `commands/display.rs`
   to `services/monitors.rs` there, so window placement and the display
   commands resolve a role the same way.
2. ~~Monitor hot-plug → reconcile~~ — done, see
   [stage-2-hotplug.md](stage-2-hotplug.md). Those Electron events never moved
   the output window at all; known-issues §9 covers why.
