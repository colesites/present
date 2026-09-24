# Changelog

All notable desktop changes are documented here. Present follows Semantic Versioning.

## [Unreleased]

## [0.4.0] - 2026-09-24

Present's core is now Rust. The Electron main process is gone (tagged
`electron-final`) and the audience screen is drawn rather than rendered.

### Added

- Transitions: a layer-aware engine with 108 presets built from primitives, a
  picker, and still thumbnails that animate on hover — drawn by the engine that
  will run the transition in front of the congregation, not imitated in CSS.
- A listening scripture agent. What the preacher says goes to a model, and a
  reference it resolves to an installed book is projected. There are no
  suggestions to confirm: nobody running a service has a hand free.
- Archive services instead of deleting them, and act on several at once.
  Archiving keeps everything in the service and only takes it out of the list.
- Messages can scroll across the screen, at a speed the operator sets.
- Several media folders can be added in one pass.
- Looks can be deleted. The last one cannot: every destination reads its layers
  from one.

### Changed

- Video is FFmpeg 9.0.1, built from source under LGPL, with VideoToolbox
  hardware decode. Every bundle carries FFmpeg's source, as the licence asks.
- Slides, media, messages, props and the timer are composited into one frame,
  which the audience surface, NDI and every preview all show. The preview is
  now the picture the congregation sees rather than an approximation of it.
- The offline store is SQLite, written through from the renderer, with a queue
  for changes made with no network.
- Timer sizes are taken against a 1080-tall screen and scaled to the frame, so
  the same settings look the same on a preview, a projector and a 4K wall.
- A signed build declares what it actually uses — camera and capture devices,
  the local network for NDI, and the folders media lives in — and carries the
  entitlements the hardened runtime needs for the microphone, capture devices
  and the bundled NDI runtime.

### Fixed

- A packaged build could not draw its own preview frames: the content policy
  named the media and NDI schemes but not the two the previews use, so the
  audience preview was empty and every transition tile was blank.
- Clicking a video quit the app. The media protocol answered WebKit from a
  background thread, and a request cancelled in between — which a video does
  constantly — raised an exception across a frame that cannot unwind.
- A YouTube prop rendered nothing, on every screen: it used a tag that exists
  only in Electron.
- The timer name, and the size chosen for it, appeared only when its banner was
  also on.
- A message was drawn at roughly twice its intended size, and the colour behind
  it was measured from the unscaled text, so it did not cover it.
- Signing in during development reached whichever Present was installed rather
  than the one being worked on.
- A development build shares neither its data nor its session with an installed
  one. It had been reading the installed app's services and sending them to a
  deployment that has never seen them, which failed every org-scoped query and
  left the window black.
- A failed query no longer blanks the window: the app has an error boundary.
  The audience screen was never affected — it is drawn by the core.

## [0.3.8] - 2026-09-05

### Fixed

- Reordering groups and standalone items did nothing in a service created from a template. The sidebar numbered its rows from the service's stored layout while the move resolved that number against a rebuilt one, so a drop landed on the wrong row or was rejected outright.
- Dropping an item onto the row directly below it left the order unchanged; only dropping past that row moved anything.
- Select menus, dropdowns, context menus, and tooltips opened behind a modal dialog instead of above it, which made the category picker in the Edit library item and Create flow dialogs unusable.
- Idle CPU stayed high with the timer panel open: the tick rewrote timer state once a second even with no timer running, re-rendering every consumer and re-persisting to local storage each time.

## [0.3.7] - 2026-09-05

### Added

- Drag a group to a new position inside a service. The rearrangement applies to that service alone and never changes the template it was created from.

### Fixed

- Dropping a service item on a row boundary placed it one slot too far when dragged downwards.

## [0.3.0] - 2026-06-22

### Added

- Persisted exact-phrase and broad-ranked modes for Bible text search.
- A fast in-memory Bible verse index with ranked word, phrase, and partial-token matching.
- A stacked speech-search cue deck with up to five ranked accept/decline cards.
- Live-output state on Bible search results and accepted speech cards.

### Changed

- Consolidated speech reference detection and verse-text matching into one deduplicated candidate queue.

## [0.2.4] - 2026-06-22

### Fixed

- Prevent transient token refresh and Convex reconnect failures from signing desktop users out.
- Honor forced access-token refreshes and preserve the rotated desktop session expiry.
- Preserve the editor slide-list scroll position across draft updates and remounts.

### Added

- Automated auth refresh policy tests and CI quality gates.
- Redacted local crash and error diagnostics with bounded log rotation.
- Tag/package/changelog validation for desktop releases.

## [0.2.3] - 2026-06-02

### Added

- Existing desktop feature baseline before the `0.2.4` reliability patch.
