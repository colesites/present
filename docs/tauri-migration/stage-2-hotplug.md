# Stage 2 (part 3) — Monitor hot-plug

**Status:** complete · **Date:** 2026-09-10

The last item in Stage 2. Windows now follow the monitors, which under Electron
they never did.

## What Electron does, and why it does nothing

`main/index.ts:74-82` subscribes to `display-added`, `display-removed` and
`display-metrics-changed`, and each one calls `reconcileOutputWindowDisplay()`.
That reaches `moveOutputWindowToDisplay`, whose entire body is guarded on the
window **not** being fullscreen (`display.service.ts:135-152`). The audience
window is created fullscreen and re-asserts it on first paint, so the guard is
always true and the reconcile always returns immediately.

Those three subscriptions have therefore never moved the audience output. That
was known-issues §9, and it is now fixed.

## The trigger

Tauri emits no monitor-change event. Neither tao nor Tauri surfaces one on any
platform, so the equivalent of Electron's three subscriptions has to be built.

`services/display_watch.rs` polls, once a second, on one background thread.

The alternative was a platform notification per platform:
`NSApplicationDidChangeScreenParametersNotification` on macOS,
`WM_DISPLAYCHANGE` on Windows, and something else again on X11 and Wayland.
Three observers is three times the surface for a mechanism that must not fail
during a service, and only the macOS one could be tested here. A poll is one
code path everywhere, its failure mode is a second of latency rather than a
missed event, and the comparison it rests on is a pure function with tests.

The cost is one enumeration per second. On macOS that is
`CGDisplay::active_displays()`, which touches no AppKit — so the poll path
deliberately skips the human-readable monitor names, whose lookup has to hop to
the main thread. Labels are read only when a display list is actually handed to
the frontend.

## What counts as a change

`diff()` compares two identified monitor sets keyed on `DisplayKey`, and reports
added, removed and changed separately so the log says what the hardware did.
Every one of them drives the same reconcile.

Two fields are deliberately excluded from the comparison, and one of them was a
bug found by running it.

**The work area is excluded.** It was included at first. macOS hides the menu
bar for a fullscreen window, which changes that monitor's work area — on this
machine from `y:50 height:2350` to the full `height:2400`. So putting the
audience output into fullscreen changed the work area, which read as a display
change, which reconciled the window, which put it into fullscreen. Observed
firing about once a second against a single static monitor, with the projector
being repositioned each time.

Excluding it is also right on the merits: the work area is the menu bar and the
Dock, neither of which has anything to do with where a full-screen window
belongs. `bounds` is what a window is placed against.

**The label is excluded**, because the poll takes label-free snapshots and a
label appearing later must not read as the hardware moving.

## Replacing the guard rather than deleting it

Deleting Electron's fullscreen guard would be worse than leaving it. Every
unrelated display event would drop the projector out of fullscreen and back
again, mid-service, and on macOS that is an animated transition the room can
see.

So the question changed from "is it fullscreen" to "is it already where it
belongs". `plan_reposition` is a pure function over the window's physical
position, its size, whether it is fullscreen, and the target monitor's bounds.
It returns `Leave` only when all of those already agree; anything else is a
`Move`, carrying whether fullscreen has to be exited first.

Fullscreen is part of "correct", not just geometry. macOS leaves a window at the
right size but windowed after the monitor it was fullscreen on disappears, and
on the audience screen that shows the menu bar and Dock over the output.

The execution is the part with a platform quirk: a window still animating out of
fullscreen ignores `set_position`, so the move waits 700 ms between leaving
fullscreen and repositioning. That runs on the watcher thread, so it blocks
nothing.

## All three roles, not just the output

Electron only ever reconciled the audience output. The media stage and worship
stage windows are placed by exactly the same rule and have exactly the same
problem, so `reconcile_all` covers all three. Each is resolved and moved
independently: a failure on one must not leave the others on a monitor that no
longer exists.

## What the frontend gets

```
display:list-changed     -> Display[]        // event, on any real change
reconcile_displays()     -> ()               // manual trigger
```

The event is the one named in the audit's §11 list. `App.tsx:46` re-reads the
display list every 15 seconds because Electron gave the renderer no way to hear
about a hot-plug; `onDisplayListChanged` in `src/renderer/tauri/runtime.ts` is
what lets that polling go away. Wiring React to it is Stage 4 work.

`reconcile_displays` exists so an operator who changes a screen preference can
apply it without closing and reopening the audience output.

## Verified on real hardware

Driven through a temporary harness against the running app.

```
output opened:            0,0 3840x2400 fullscreen=false
after no-op reconcile:    0,0 3840x2400 fullscreen=true
displaced to:             0,0 900x600
moving window onto its preferred display  leave_fullscreen=true
after real reconcile:     0,0 3840x2400 fullscreen=true
```

The no-op path leaves the window untouched, which is the case that matters most
— it is what stops an unrelated display event disturbing a live service. The
move path exits fullscreen, repositions, and re-enters.

After excluding the work area, a steady single-monitor run produced **no**
change events at all. Before it, one per second.

**Not verified.** This machine has one monitor, so no window has been moved from
one monitor to another. What is untested is specifically the cross-monitor case:
whether `set_fullscreen(false)` → reposition → `set_fullscreen(true)` lands on
the *other* display, and whether 700 ms is enough for the transition there. The
decision that drives it is a pure function with tests; the execution sequence
has been run, just not across a boundary. Stage 2's gate in the audit is a
multi-monitor manual matrix, and that remains outstanding.

## Next

Stage 3: native APIs — scoped filesystem, dialogs, deep links, global shortcut,
menus, permissions. The gate is closing the `local-media://` scope
(known-issues §3).
