# Present Product Quality and Feature Roadmap

Last reviewed: 2026-06-22  
Repository version reviewed: desktop `0.2.3`, web `0.1.0`  
Scope of this document: repository analysis, confirmed/likely defects, requested features, release/versioning rules, and a recommended implementation order. This document does not claim that runtime-only bugs are proven until the listed reproduction tests pass.

## 1. Repository assessment

Present is a bun monorepo with three main products:

| Area | Location | Responsibility |
| --- | --- | --- |
| Electron desktop app | `apps/desktop` | Presenter/editor UI, local Bible database, output/stage windows, media, NDI, auth bridge, offline data |
| Next.js web app | `apps/web` | Clerk sign-in, desktop deep-link callback, billing, account/dashboard, desktop downloads |
| Convex backend | `packages/backend/convex` | Users, organizations, libraries, services, playback, billing, messages, props, themes |
| Shared package | `packages/shared` | Shared workspace/auth/billing state and types |

### Existing capabilities found

- Clerk authentication bridged from the browser to Electron through `present://auth`.
- A custom encrypted desktop session file using Electron `safeStorage`.
- Convex-backed organization/personal workspaces and offline-first local storage with Dexie.
- Library/song editing, slide and object editing, themes, media, Bible import/search, speech recognition, service agendas, stage display, timers, messages, props, Looks, screen composition, NDI, browser capture, PDF/PPTX import, and an AI operator.
- Bible speech search already has two partial interfaces: a single `SpeechScriptureSuggestion` accept/reject card and a separate list of speech text matches. These need to be consolidated into the requested stack interaction.
- Library search already has persisted `exact` and `broad` modes. Bible search does not expose the same mode.

### Engineering gaps affecting delivery confidence

- No automated test script or test suite is defined in the workspace packages. Auth, Bible ranking, scrolling, output rendering, and service mutations currently lack regression protection.
- No desktop auto-update provider is configured. Builds can be made with Electron Forge, but installed clients cannot yet discover and install new releases automatically.
- Package versions are inconsistent (`desktop 0.2.3`, `web 0.1.0`, shared/backend `1.0.0`) and there is no changelog or release checklist.
- The worktree contained existing uncommitted changes during this review. Those changes must be preserved and separated from future bug-fix commits.

## 2. Priority roadmap

| Priority | Item | Status | Recommended release |
| --- | --- | --- | --- |
| P0 | Auth: intermittent sign-out during active use | Implemented in `0.2.4`; packaged-app refresh/soak verification pending | `0.2.4` |
| P0 | Bible speech search: fast ranked stack of accept/decline cards + active state | Implemented in `0.3.0`; packaged microphone/performance verification pending | `0.3.0` |
| P1 | Editor slide list jumps to the top while scrolling | Implemented in `0.2.4`; packaged-app UI verification pending | `0.2.4` |
| P1 | Bible exact/broad search toggle | Implemented in `0.3.0` | `0.3.0` |
| P1 | Groups/sections inside a service agenda | Missing data model and UI | `0.4.0` |
| P2 | Text/object animations | Missing for slide text; marquee exists only for messages | `0.5.0` |
| P2 | ProPresenter feature-gap tranche | Research complete at capability level; scope each item separately | Later minor releases |
| P1 | Automated tests, crash/error telemetry, release automation | Implemented in `0.2.4` | `0.2.4` |

## 3. Bugs and fixes

### BUG-001 — Intermittent desktop sign-out during active use (P0)

Implementation status (2026-06-22): the desktop now honors Convex forced-refresh requests, proactively refreshes before local token expiry, retries transient refresh failures, retains cached identity while reconnecting, avoids converting restoration timeouts/null profile responses into sign-outs, and persists the rotated desktop session token's new expiry. TypeScript and targeted lint verification pass; real signed-in packaged-app refresh/soak testing remains required.

#### Reported behavior

- If the app is left alone for several days, the stored identity can still appear signed in.
- While actively using the app, it may show the signed-out state after roughly one or two hours.
- It is not yet known whether a temporary network failure triggers it.

#### Static diagnosis

This is most likely a token-refresh/state-classification defect, not ordinary long-term session expiry:

1. The custom desktop session token is issued for 180 days in `apps/web/src/lib/server/desktop-auth.ts`.
2. The Convex access token is short-lived and is refreshed through the desktop IPC bridge and `POST /api/auth/desktop/refresh-session`.
3. Active use and Convex reconnects exercise that refresh path; an idle app may continue displaying its cached user without exercising it immediately. This matches the reported one-to-two-hour pattern.
4. A valid refresh still depends on the underlying Clerk session remaining `active`. A `401/403` clears the stored desktop session. Transient failures are intended to keep it, but restore/query paths can still set `authStatus` to `unauthenticated`, including the 15-second restore timeout when no cached user is available.
5. The UI treats `unauthenticated` as signed out even when a session token may remain on disk. That can produce an apparent logout without proving that credentials were actually revoked.

This is a hypothesis until status codes, Clerk session state, token expiry timestamps, network state, and state transitions are captured during reproduction.

#### Test plan for the first implementation task

1. Add structured, redacted auth diagnostics. Log event name, timestamp, online/offline state, HTTP status, access-token expiry, desktop-session expiry, Clerk session status returned by the server, and the state transition. Never log token values.
2. Add a development-only way to shorten the access-token refresh interval or force a refresh; do not wait one hour for every test.
3. Test these cases:
   - continuous online use across at least three forced refresh cycles;
   - network offline before expiry, then reconnect after expiry;
   - DNS failure, timeout, `408`, `429`, and `5xx` during refresh;
   - valid `401/403` caused by revoked/expired Clerk session;
   - app sleep/wake and network interface change;
   - app restart with valid cached identity, expired access token, and valid desktop session token;
   - app restart with stored credentials but no cached user;
   - simultaneous Convex refresh requests to verify single-flight behavior.
4. Add unit tests around refresh outcome classification and a renderer integration test around auth-state transitions.

#### Fix requirements

- Only confirmed credential invalidation may clear persistent credentials.
- Network, timeout, rate-limit, and server failures must retain the cached signed-in identity and show an offline/reconnecting state.
- Do not render the sign-in screen solely because profile restoration exceeded an arbitrary timeout.
- Retry refresh with bounded exponential backoff and jitter.
- Rotate and persist the refreshed desktop session token atomically.
- Distinguish `authenticated-online`, `authenticated-offline/reconnecting`, `restoring`, and `unauthenticated` in behavior, even if the public store retains a smaller type.
- Confirm Clerk session lifetime settings match the intended 180-day desktop promise. A custom 180-day wrapper cannot keep a revoked/expired Clerk session active.

#### Acceptance criteria

- A two-minute simulated network outage during use never signs the user out.
- Sleep/wake and reconnection restore Convex access without opening the sign-in screen.
- A deliberately revoked Clerk session signs out once and clears stored credentials.
- Three consecutive forced token refreshes complete without identity/UI flicker.
- Restarting the app offline retains the cached user and local content.

### BUG-002 — Editor slide-layout list jumps back to the first slide (P1)

#### Static findings

The slide list is an `overflow-auto` container in `SlideList.tsx`. It has no explicit scroll restoration and uses `key={slide.id ?? index}`. The direct cause is not proven by static inspection. The likely causes are:

- `SlideList` or its `ResizablePanel` is being remounted because a parent identity/key changes during draft updates;
- slide IDs are missing/unstable, causing list items to be recreated;
- selected slide/draft synchronization replaces the draft during editing;
- a focus/selection side effect scrolls an element into view or resets a scroll ancestor.

#### Test and fix plan

- Reproduce with 5, 10, and 50 slides while idle and while editing text.
- Record mount/unmount counts and the scroll container's `scrollTop` before/after draft updates.
- Give every persisted and draft slide a stable non-null ID; never fall back to the array index for identity.
- Keep the scroll container mounted across draft updates.
- Store scroll position in a ref only if remounting cannot be removed; restoration is a fallback, not the primary fix.
- Add a UI regression test: scroll to slide 8, edit slide 8, wait for autosave/state synchronization, and assert slide 8 remains visible and `scrollTop` does not reset.

#### Acceptance criteria

- Users can scroll through at least 50 slides without the list moving to the top.
- Selecting, editing, saving, adding, deleting, and reordering slides do not unexpectedly reset the list.
- Opening a different presentation may intentionally start at the selected slide or top, but this behavior must be deterministic.

### BUG-003 — Bible search lacks exact/broad mode (P1)

Reuse the library search concept, but use a domain-neutral store/type rather than importing a `LibrarySearchMode` into Bible code.

- **Exact:** normalized verse text contains the complete normalized phrase in the typed order.
- **Broad:** ranked token search, tolerant of stop words and partial spoken phrases.
- Persist the user's choice independently for Bible search unless product design explicitly wants one global preference.
- Display the active mode next to both typed and speech search when relevant.

Acceptance: exact mode never returns a verse that does not contain the normalized phrase; broad mode preserves ranked results and remains responsive.

### BUG-004 — No active state for a live Bible verse (P1, part of Feature 001)

The Bible text and speech result rows currently have hover actions but no comparison with the active output slide/reference.

- Derive a canonical verse identity: version + book ID + chapter + verse.
- Carry that identity into the generated output slide metadata/ID.
- Highlight the matching Bible result/card with `aria-current="true"`, a visible live indicator, and a non-color-only cue.
- If a range is live, mark every verse in the range active or mark the range card active consistently.

## 4. Requested features

### FEATURE-001 — Enhanced Bible speech search (P0)

#### Required interaction

- Spoken scripture references and spoken verse text produce suggestion cards containing reference, version, and scripture text.
- Cards stack with the newest/highest-confidence candidate on top.
- Hover or keyboard focus fans the stack apart; the expanded stack must remain scrollable and keyboard accessible.
- **Accept** immediately sends that scripture to the selected output using the current Bible layout.
- **Decline** removes only that card and exposes the next candidate.
- Accepted/declined candidates are deduplicated for the current speech session so partial transcripts do not immediately recreate them.
- The live verse receives an active state.

#### Recommended architecture

- Replace the single `suggestion: string | null` with a queue of typed candidates: stable ID, canonical reference, verse(s), confidence, transcript, status, and creation time.
- Consolidate `SpeechScriptureSuggestion` and the current speech-result list into one card-stack component.
- Separate speech transport, reference parsing, verse-text ranking, candidate deduplication, and UI queue state so each can be tested independently.
- Keep recognition streaming; debounce ranking by transcript stability rather than a fixed delay alone.
- Prewarm the selected translation's search index when the Bible panel opens or the version changes.

#### Search performance and accuracy

The current implementation caches every normalized verse for a translation, then scans the whole pool and performs repeated substring checks. Yielding every 400 verses protects rendering, but the algorithm remains approximately O(number of verses × number of query tokens) per transcript update.

Replace the repeated full scan with an in-memory inverted index per version:

- normalized exact-phrase field;
- token -> compact verse-ID postings list;
- optional token-prefix map for incomplete speech tokens;
- candidate intersection/union before scoring;
- scoring signals: exact phrase, ordered token proximity, token coverage, rare-token weight, book/reference parse confidence, and transcript stability;
- Web Worker for index construction and scoring so the renderer stays responsive;
- cancellation/request IDs so stale transcript results never replace newer results.

Performance targets on a normal laptop after prewarm:

- reference lookup p95 under 20 ms;
- text candidate ranking p95 under 50 ms;
- speech partial transcript to visible cards p95 under 150 ms, excluding the speech provider's network latency;
- no main-thread task longer than 50 ms;
- deterministic top-5 ranking for a checked corpus of common verses and paraphrased spoken inputs.

#### Acceptance criteria

- At least three candidates can stack, fan out on hover/focus, and collapse without layout jumps.
- Accept sends the correct version/reference/text to output in one action.
- Decline removes one candidate and it does not immediately reappear from the same transcript.
- Mouse, keyboard, and screen-reader operation are supported; reduced-motion users receive a non-animated layout.
- The current live verse is visibly active in cards and regular Bible results.

### FEATURE-002 — Text and object animations (P2)

Present currently has output marquee animation for message overlays, but no general per-text-element build-in/build-out animation model.

Research note: ProPresenter's official feature set emphasizes slide transitions, slide actions, layers, and scrolling text. Its scrolling-text controls include direction, starting position, speed, feathering, repeat, and distance. The requested feature should therefore be scoped precisely instead of treating all motion as one setting.

Recommended phases:

1. **Element builds:** fade, dissolve, slide, scale, blur; in/out direction; duration; delay; easing.
2. **Text sequencing:** animate as whole block, by line, by word, or by character; stagger interval.
3. **Continuous text:** marquee/ticker controls equivalent to direction, start position, speed, repeat, and spacing.
4. **Cue control:** automatic on slide activation or manual next-build cue; preview/restart animation in editor.

Store animation data on each `SlideElement`, not only in React component state. The output window, preview, editor, saved library documents, offline schema, Convex payloads, import/export, and reduced-motion behavior must all support it. Use CSS/Web Animations for deterministic playback; avoid adding a large animation dependency to the desktop renderer unless the native approach cannot meet sequencing needs.

### FEATURE-003 — Groups inside a service agenda (P1)

Example groups: Welcome, Worship/Songs, Bible Reading, Sermon, Offering, Announcements.

Do not encode a group as a fake service item. Add an explicit nested model so ownership and reorder operations remain valid:

```ts
type ServiceGroup = {
  id: string;
  title: string;
  color?: string;
  collapsed?: boolean; // local UI preference may be better than synced data
  items: ServiceItem[];
};
```

Migration requirements:

- Existing flat `items` become one default ungrouped section without data loss.
- Support create, rename, delete-with-confirmation, reorder groups, reorder inside a group, and move items across groups.
- Decide whether deleting a group deletes its items or moves them to Ungrouped; recommended default is move to Ungrouped.
- Apply the same schema to organization and personal services.
- Use stable group/item IDs. Current mutations address items by array index, which becomes fragile when concurrent reordering is introduced.

Acceptance: existing services load unchanged, groups sync across devices, offline edits reconcile, and concurrent reorder operations do not delete or duplicate items.

## 5. ProPresenter capability-gap research

The comparison below is based on repository inspection and Renewed Vision's current official feature pages. “Partial” means relevant code exists but does not establish feature parity.

| Capability | Present status | Recommendation |
| --- | --- | --- |
| Multiple audience/stage layouts and screen-specific layers | Partial: output, stage, Looks, screen composer exist | Stabilize current implementation before expanding to multiple unique simultaneous outputs |
| Stage current/next, clocks, timers, messages, notes, live previews | Partial | Audit each linked-data type and add reusable stage-layout presets |
| Eight-layer output model (mask, message, prop, announcement, slide, media, video input, screen color) | Partial: messages, props, slide/media and Looks exist | Define a formal render-layer contract and add mask/announcement/video-input parity as separate projects |
| Macros and slide actions | Partial: “masters” and AI actions exist; no full multi-action macro engine | Build an action graph with ordered actions, delays, undo, validation, and safe rehearsal mode |
| MIDI, DMX, and timecode control | Not found | Add only after the action engine; integrations should trigger the same validated actions |
| Planning Center service-plan sync | Not found | High-value worship integration after service groups and stable item IDs |
| SongSelect/CCLI workflow and reporting | Not found as a complete integration | Research licensing/API requirements before implementation |
| Song arrangements (verse/chorus groups and reusable orders) | Not found | High-value lyric feature; share group primitives with service grouping but keep data models separate |
| Remote control/API | No complete supported remote-control surface found | Add authenticated local-network API and companion remote after playback commands are stable |
| Network linking/redundancy | Not found | Later reliability feature; requires deterministic state replication and health/failover design |
| Broadcast key/fill, SDI/Syphon, capture/recording | NDI and some related output code exist; parity not established | Treat per platform/hardware as independent features with hardware test matrices |
| Quick Edit/Reflow | Partial: editor and Fix/Break Lyrics exist | Add safe live quick-edit and a dedicated reflow workflow with undo/history |
| Bible breadth and multiple translations on one slide | Partial: local translations/import exist | Add side-by-side/stacked secondary translations and licensing-aware catalog metadata |
| Media playback markers/timeline | Not found | Add after deterministic media clock and action engine |
| Announcements as an independent simultaneous presentation | Partial terminology/code only | Define independent cue stack/output destination rather than reusing the main active slide |

Official references:

- [ProPresenter overview and core capabilities](https://renewedvision.com/propresenter)
- [All ProPresenter features](https://www.renewedvision.com/propresenter/all-features)
- [Stage Display capabilities](https://renewedvision.com/propresenter/stage-display)
- [ProPresenter output layers](https://support.renewedvision.com/hc/en-us/articles/13634000690323-ProPresenter-Output-Layers)
- [Using scrolling text](https://support.renewedvision.com/hc/en-us/articles/4403013895059-Using-Scrolling-Text-in-ProPresenter)
- [Using Bibles in ProPresenter](https://support.renewedvision.com/hc/en-us/articles/360041347594-Using-Bibles-in-ProPresenter)
- [Current ProPresenter download/release notes](https://www.renewedvision.com/propresenter/download)

## 6. Versioning and releases

Use Semantic Versioning: `MAJOR.MINOR.PATCH`.

- **PATCH** (`0.2.3` -> `0.2.4`): compatible bug fix, performance improvement, or internal reliability change.
- **MINOR** (`0.2.4` -> `0.3.0`): compatible user-facing feature, such as the Bible speech card stack or exact search.
- **MAJOR** (`2.3.0` -> `3.0.0`): incompatible data/API/workflow change requiring migration or explicit user action.
- While the desktop app remains below `1.0.0`, minor versions can still contain meaningful internal changes, but releases should remain migration-safe. Reach `1.0.0` when core show operation, output, persistence, updates, rollback, and recovery have production-level tests.

Examples:

- Fix auth and editor scrolling only: `0.2.3` -> `0.2.4`.
- Add enhanced Bible speech cards/exact search: `0.2.4` -> `0.3.0`.
- From a future `2.3.0`, a compatible fix becomes `2.3.1`, a compatible feature becomes `2.4.0`, and a breaking release becomes `3.0.0`.

### Single source of truth

The desktop distributable version is currently `apps/desktop/package.json`. Keep web/shared/backend package versions independent unless they are distributed together. Display the desktop version with `app.getVersion()` rather than hard-coding it in UI.

### Version update command

From the repository root, use one of:

```bash
cd apps/desktop && bun pm version patch --no-git-tag-version
cd apps/desktop && bun pm version minor --no-git-tag-version
cd apps/desktop && bun pm version 2.3.0 --no-git-tag-version
```

Review both `apps/desktop/package.json` and `bun.lock` after the command. Do not tag or publish until verification passes.

### Required release workflow

1. Start from a clean release branch and choose the version from the actual change type.
2. Add `CHANGELOG.md` entries under Added, Changed, Fixed, Security, and Known Issues.
3. Apply any Convex schema/data migration in backward-compatible phases: expand, deploy compatible readers/writers, migrate, then remove old fields in a later release.
4. Run lint, typecheck, automated tests, packaging, and platform smoke tests.
5. Build/sign/notarize packages for Apple Silicon macOS, Intel macOS, Windows x64, Linux deb, and Linux rpm as supported.
6. Test upgrade from the previous stable version without deleting user data; test rollback where schema compatibility permits it.
7. Publish immutable artifacts and checksums, update the web download environment URLs, create git tag `desktop-vX.Y.Z`, and publish release notes.
8. Roll out in stages (internal -> beta churches -> stable) and retain the prior installer for rollback.

### Auto-update work required

Electron Forge makers are configured, but no auto-update client/publisher was found. Before promising automatic upgrades:

- choose a signed update feed/provider (for example GitHub Releases or an owned update service);
- configure platform-specific update metadata and code signing/notarization;
- check on startup and periodically without interrupting a live service;
- download in the background, then require explicit operator approval to restart;
- never install/restart while output is live;
- verify artifact signatures and support staged rollout/rollback.

## 7. Recommended implementation sequence

### Release `0.2.4` — reliability patch

1. Add auth refresh telemetry and deterministic forced-refresh testing.
2. Reproduce and fix BUG-001 without clearing sessions on transient failures.
3. Reproduce and fix BUG-002 with stable slide identity and a scroll regression test.
4. Add the first automated test harness and release checklist.

### Release `0.3.0` — Bible workflow

1. ✅ Introduce an indexed Bible search engine and ranking corpus tests.
2. ✅ Add exact/broad Bible search.
3. ✅ Replace the single speech suggestion and duplicate result list with the candidate queue/card stack.
4. ✅ Add accept/decline/deduplication and active-live-verse state.
5. Pending packaged microphone, offline, and performance verification on target hardware.

### Release `0.4.0` — service planning

1. Add stable service item IDs and backward-compatible schema migration.
2. Add service groups and cross-group drag/reorder.
3. Validate offline sync and concurrent updates.

### Release `0.5.0` — motion

1. Add persisted element animation schema and editor controls.
2. Implement deterministic preview/output playback.
3. Add text sequencing, manual build cues, continuous scrolling, and reduced-motion handling.

## 8. Definition of done for future tasks

A task is not complete when only the visible UI works. Each fix/feature must include:

- typed persisted data and backward-compatible migration where applicable;
- unit tests for pure logic and an integration/UI regression test for the reported behavior;
- offline/reconnect behavior where the feature touches synced data;
- editor, preview, live output, and stage behavior checked where relevant;
- keyboard/accessibility and reduced-motion checks for interactive/animated UI;
- error and empty states;
- changelog entry, version decision, and packaged-app smoke test.
