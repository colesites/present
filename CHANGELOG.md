# Changelog

All notable desktop changes are documented here. Present follows Semantic Versioning.

## [Unreleased]

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
