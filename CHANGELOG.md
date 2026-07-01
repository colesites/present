# Changelog

All notable desktop changes are documented here. Present follows Semantic Versioning.

## [Unreleased]

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
