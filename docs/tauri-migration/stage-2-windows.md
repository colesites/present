# Stage 2 (part 2) — Windows

**Status:** complete · **Date:** 2026-09-09, hot-plug 2026-09-10

All eight windows are created by the Rust core, and they follow the monitors.
The display half of Stage 2 is [stage-2-displays.md](stage-2-displays.md);
hot-plug is [stage-2-hotplug.md](stage-2-hotplug.md).

## What moved

Eight modules under `src/main/windows/` (915 lines) became three Rust files,
covered by 38 of the crate's 85 tests:

| File | What it holds |
|---|---|
| `services/window_spec.rs` | Every window as a serialisable struct. No Tauri. |
| `services/window.rs` | Building, showing, placing and closing them. |
| `commands/window.rs` | The command surface the frontend calls. |

Plus `state/window_state.rs` for crash bookkeeping and `services/monitors.rs`,
which is the monitor-reading code lifted out of `commands/display.rs` so both
the display commands and window placement can use it.

## Windows as data

The reason for splitting the spec out from the builder is that the Electron
originals cannot be tested. Every constant that keeps a service running —
`backgroundColor: '#000000'`, `show: false`, `backgroundThrottling: false` — is
an inline literal in a `new BrowserWindow({...})` call, so the only way to check
one is to launch Electron and look at a projector.

Here each window is a `WindowSpec`, and the assertions name the symptom rather
than the value:

```
the_audience_window_is_black
the_audience_window_never_takes_focus
the_audience_window_reloads_on_every_crash
the_main_window_guards_against_a_crash_loop
the_worship_stage_is_black_but_the_media_stage_is_not
window_sizes_match_the_electron_modules
```

Each carries the `file:line` it was copied from, so a future "tidy-up" of one of
these values fails a test that explains what it is about to break.

This is also what ADR-001 asks for. Window state is now describable as
serialisable Rust structs rather than as React component state, which is the
precondition for the Stage 5 compositor consuming a scene description.

## The output window's hardening

All four properties are preserved, and one is added.

**Black background, hidden until first paint.** Every window is built
`visible(false)` with its final `background_color` already applied, and shown
from the `on_page_load` hook on `PageLoadEvent::Finished`. That is the closest
analogue to Electron's `ready-to-show`.

**No background throttling.** `BackgroundThrottlingPolicy::Disabled` on every
window. This is what stops the audience output blanking when the operator
window takes focus.

**Reload on webview crash.** Ported, with the loop guard. See below.

**Never steals focus.** The audience window shows without focusing; the two
stage windows deliberately do focus. That distinction existed in the Electron
code and is now a field with a test.

**New: a bounded watchdog.** Electron's `ready-to-show` either fires or the
window stays hidden forever, and a hidden audience window looks exactly like a
broken projector. Every window here shows anyway after four seconds if its first
paint has not arrived. This is safe precisely because the window already carries
its final background colour — showing early is visually free, and the failure it
replaces is not.

## Crash recovery

`decide_crash_recovery` is a pure function over `(policy, history, now)`, so the
Electron sequence can be walked crash by crash in a test. It reproduces
`main.window.ts:196-227` including the parts that look accidental but are the
shipped behaviour: the attempt counter never resets, and the guard compares
against the gap since the *previous* crash rather than a window measured from
the first one.

The two policies differ on purpose. The main window stops after two crashes
inside ten seconds. The audience window reloads every time, with no ceiling,
because that is what `output.window.ts:83-92` does and because a black projector
is worse than a reload loop nobody in the room can see.

**This does not work on Windows or Linux.** Tauri 2.11 exposes exactly one hook
for a dead webview content process, `Builder::on_web_content_process_terminate`,
and it is `#[cfg(any(target_os = "macos", target_os = "ios"))]`. Recorded as
known-issues §10 rather than papered over: the policy is platform-independent
and tested, but on those two platforms nothing currently pulls the trigger.

## Placement, and the units trap

Electron works in device-independent pixels throughout. Tauri does not:
`Monitor::position()` and `size()` are **physical** pixels, while
`WebviewWindowBuilder::position()` and `inner_size()` are **logical**. On this
machine's 2× display that is the difference between x=0 and x=3840 — an entire
screen's width — so a naive port would put the audience output on the wrong
monitor on any Retina or scaled setup, and be perfectly correct on a 1× test rig.

The builder is given logical units divided by the monitor's own scale factor,
and then `set_position`/`set_size` re-assert the physical values once the window
exists. The second call is the authoritative one: physical coordinates are the
exact numbers the monitor reported, so no rounding can land the window
elsewhere.

## Lifecycle

Two behaviours came with the window modules rather than with the windows.

**Closing the last window does not quit on macOS.** Tauri's default is to exit
when the last window is destroyed, on every platform. The Electron build does
not do that (`index.ts:100-111`): the app stays in the dock with no windows and
the icon brings the operator window back. `RunEvent::ExitRequested` is prevented
on macOS, and `RunEvent::Reopen` recreates the main window.

Only the `code: None` variant is prevented, which the runtime emits solely when
the last window is destroyed. A programmatic exit carries a code and is
honoured, and macOS Quit maps to `NSApplication terminate:`, which never reaches
the event loop — so Cmd+Q still quits.

**Settings closes with the operator window** (`main.window.ts:245-249`).

## Command surface

```
open_window(role, options?)              -> bool
close_window(role)                       -> bool
open_mini_lyrics_window(payload)         -> bool
close_mini_lyrics_window(libraryId)      -> bool
list_open_windows()                      -> OpenWindow[]
```

Twelve Electron handlers became two commands plus the mini-lyrics pair. This
deviates from the audit's §11 sketch, which lists `open_output_window` and
`close_output_window` by name. The twelve differed only by which constant they
closed over; the differences that matter now live in `window_spec.rs` as data,
under test.

`src/renderer/tauri/runtime.ts` exposes them as one typed `openWindow(role)` /
`closeWindow(role)` pair. The role strings are the same ones the UI already uses
in `?window=`, so a call site reads `openWindow("looks")` — no new vocabulary.

Three details worth recording:

**Every open command is `async`.** Building a window from a synchronous Tauri
command deadlocks on Windows under WebView2. It does not reproduce on macOS, so
nothing local would have caught it.

**Omitted and `null` are different.** Electron's
`if (options?.displayId !== undefined)` means an absent field leaves the stored
preference alone while an explicit `null` clears it and returns the role to
automatic selection, and `ProjectButton.tsx:62` passes `null`. A plain `Option`
would collapse "the operator cleared their screen choice" into "the caller said
nothing", so `OpenOptions` uses `Option<Option<T>>`.

**`list_open_windows` is new.** Electron has no equivalent; the React side
tracks which windows are open itself and goes stale whenever one is closed from
the OS rather than from the app. Rust owning the windows means Rust can answer
the question.

## The main window is built in Rust too

`app.windows` in `tauri.conf.json` is now `[]`. A window declared in JSON cannot
carry the deferred first paint or the crash policy, so keeping the main window
there would have left two descriptions of one window, diverging the first time
either changed.

Capabilities are unchanged in effect but split in two: `main.json` still covers
the operator window, and a new `secondary.json` covers the other seven,
including `mini-lyrics-*` by glob. Both currently grant only `core:default`.
The split exists so the audience surface can stay render-only when the file and
dialog commands arrive, which is what the audit's proposed `output.json` and
`stage.json` were for.

## Verified on real hardware

Driven through a temporary harness in the boot probe against the running app,
not only through unit tests. Every one of the eight windows opened, showed,
reopened without a duplicate-label failure, and closed:

```
opened media-stage   -> [main visible, media-stage visible+fullscreen, ...]
opened worship-stage -> [main visible, worship-stage visible+fullscreen, ...]
opened output        -> [main visible, output visible+fullscreen, ...]
mini-lyrics          -> [main, mini-lyrics-song1, mini-lyrics-song2]
closed output=true   -> [main visible]
```

The main window is created by `setup` and appears in `list_open_windows` from
the first frame.

Repeated against the packaged `.app`, where the URL is
`tauri://localhost/index.html?window=…` rather than a dev-server URL. The asset
protocol drops the query before resolving the file, so one `index.html` serves
every role and `window.location.search` still carries the parameter `App.tsx`
reads. Confirmed in the source and then by running it.

The lifecycle was driven too: the harness closed the last window and the process
stayed alive, then `open -a Present.app` produced a second `window created
label=main` in the same process. Both halves of the macOS behaviour work.

**Not verified.** No window has been opened on a second monitor — this machine
has one. Placement arithmetic is therefore exercised only at the origin, which
is the case where a physical/logical mix-up is invisible. Nothing has been run on
Windows or Linux, so the crash hook is untested even where it exists, and absent
where it does not.

## Small things not carried over

Each is named rather than quietly dropped.

- **`fullscreenable: false` on mini lyrics** (`mini-lyrics.window.ts:68`). Tauri
  2.11's builder has no equivalent. The window has a max size, so fullscreen
  would be odd rather than harmful.
- **Auto-opening devtools in dev** (`main.window.ts:182-184`). Tauri debug
  builds make devtools available but do not open them. A developer convenience,
  and Stage 6 owns menus and devtools.
- **`did-fail-load` / `unresponsive` / `responsive` logging**
  (`main.window.ts:186-234`). Tauri surfaces none of these. They logged only;
  nothing branched on them.
- **Per-window icons** (`getDesktopAppIcon()` on every Electron window). Tauri
  applies the bundle icon, which is the same image.

Everything else in the Electron window modules that is *not* window creation —
deep links, the Clerk popup handler, media permissions, the CSP header — belongs
to auth and file work in Stages 3 and 6 and is untouched here.

## One defect this exposed

Running the harness in every window revealed that `boot-probe.ts` was not gated:
six of the eight windows load the same `index.html`, so the capability probe and
display enumeration ran once per open window, and the temporary harness — which
opened windows — recursed. The probe is now gated on the current webview's label
being `main`. Harmless before this stage, because there was only ever one window.

Separately, the audit's claim that `screen` hot-plug events reconcile the output
window's display turns out not to hold: the reconcile path is guarded on the
window *not* being fullscreen, and the output window always is. See
known-issues §9. The guard is preserved verbatim here rather than half-fixed.

## Next

Nothing in Stage 2. Hot-plug reconcile, the last item, is
[stage-2-hotplug.md](stage-2-hotplug.md). Stage 3 is native APIs: scoped
filesystem, dialogs, deep links, global shortcut, menus and permissions.
