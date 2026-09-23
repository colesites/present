# Present — Electron → Tauri + Rust Migration

## Objective

Migrate the existing Present worship presentation application from Electron to Tauri while keeping React/TypeScript as the UI layer and making Rust the native application/runtime layer.

This is a **real architectural migration**, not a superficial Electron-to-Tauri conversion.

The goal is to end up with:

```text
React + TypeScript
        │
        │ Tauri commands/events
        ▼
Rust Application Core
        │
        ├── Window management
        ├── Display management
        ├── File system
        ├── Media engine
        ├── Audio management
        ├── Presentation state
        ├── Output management
        ├── NDI
        ├── Hardware/system integration
        ├── Background workers
        └── Native OS functionality
```

The React UI should remain responsible for presentation/editor UI and user interaction.

Rust should become the authoritative native/application layer.

---

# 1. Existing Application

Repository:

`colesites/present`

Current desktop application:

- Electron
- Electron Forge
- React 19
- TypeScript
- Tailwind
- Zustand
- Convex
- Dexie
- React Query
- Vosk
- FFmpeg-related/media functionality
- NDI functionality
- AI Operator
- Bible XML data
- PPTX functionality

The current Electron main process is already organized into specialized modules rather than containing all business logic in one file.

Current IPC areas include:

- Window
- File
- Bible
- Auth
- Network
- Permissions
- Browser
- Fonts
- PPTX
- NDI
- AI Operator
- Error reporting

There is also a dedicated fullscreen audience/output window.

Do NOT throw away this existing architecture without understanding and mapping it first.

---

# 2. Core Migration Principle

Do NOT perform a line-by-line TypeScript → Rust translation.

Do NOT blindly recreate Electron APIs in Rust.

Do NOT move everything into Rust just because Rust is faster.

Instead:

1. Audit the existing application.
2. Identify responsibilities.
3. Define a clean Rust core API.
4. Build the Tauri shell.
5. Move native/system responsibilities into Rust.
6. Keep React responsible for UI.
7. Move performance-sensitive and reliability-sensitive systems into Rust.
8. Rebuild the application incrementally.
9. Verify every existing feature before removing its Electron implementation.

The final application should be architecturally better than the current Electron application, not merely equivalent.

---

# 3. Target Architecture

Use a monorepo structure similar to:

```text
apps/
  desktop/
    src/
      ...
    src-tauri/
      src/
        main.rs
        lib.rs
        commands/
        services/
        state/
        media/
        audio/
        presentation/
        output/
        windows/
        display/
        filesystem/
        ndi/
        ai/
        errors/
      Cargo.toml
      tauri.conf.json

packages/
  backend/
  shared/
```

React remains in the desktop frontend.

Rust becomes the native backend.

Prefer a modular Rust architecture:

```text
src-tauri/src/

commands/
    window.rs
    file.rs
    bible.rs
    auth.rs
    network.rs
    permissions.rs
    browser.rs
    font.rs
    pptx.rs
    ndi.rs
    ai_operator.rs

services/
    filesystem.rs
    display.rs
    window.rs
    media.rs
    audio.rs
    presentation.rs

state/
    app_state.rs
    presentation_state.rs
    media_state.rs

media/
    player.rs
    decoder.rs
    audio.rs
    video.rs
    output.rs

windows/
    main.rs
    output.rs
    settings.rs

presentation/
    service.rs
    slides.rs
    transitions.rs

main.rs
lib.rs
```

Do not create unnecessary abstractions. Keep modules cohesive.

---

# 4. First Phase — Audit Before Writing Code

Before changing the application, inspect the entire repository.

Create a migration inventory containing:

### UI

- All React entry points
- Routes/views
- Major components
- State management
- Zustand stores
- React Query usage
- IndexedDB/Dexie usage
- Context providers
- IPC calls from the renderer

### Electron

Find and document:

- `BrowserWindow`
- `ipcMain`
- `ipcRenderer`
- `contextBridge`
- `app`
- `screen`
- `dialog`
- `shell`
- `protocol`
- global shortcuts
- native menus
- filesystem access
- child processes
- native modules
- preload scripts

### Media

Identify every place where:

- video is loaded
- audio is loaded
- media is played
- media is paused
- media is stopped
- media volume is changed
- media is rendered
- media is sent to preview
- media is sent to audience output
- media is added to the service
- media is removed from the service

This is extremely important.

Map the complete media lifecycle before rewriting it.

### Output

Document:

- Main window
- Preview window
- Audience/output window
- Display selection
- Fullscreen behavior
- Resolution selection
- Display hot-plug handling
- Output state synchronization
- Crash/reload behavior

### Native functionality

Identify:

- NDI
- fonts
- PPTX
- Vosk
- OS integrations
- protocol/deep links
- global shortcuts
- authentication
- file operations

---

# 5. Build a Feature Migration Matrix

Create a document like:

| Existing feature | Current implementation | Target Rust/Tauri implementation | Priority |
|---|---|---|---|
| Main window | Electron | Tauri | P0 |
| Output window | BrowserWindow | Tauri WebviewWindow | P0 |
| Display management | Electron screen | Rust/Tauri/native | P0 |
| File operations | Node/Electron | Rust | P0 |
| Media management | Existing implementation | Rust media service | P0 |
| Audio | Existing implementation | Rust/native media layer | P0 |
| Presentation state | TypeScript | Rust core | P1 |
| Bible | TypeScript/XML | Rust or shared layer | P1 |
| PPTX | Existing implementation | Rust/native or retained library | P1 |
| NDI | Native module | Rust/native integration | P1 |
| AI Operator | TypeScript | Rust commands + frontend orchestration where appropriate | P2 |
| Auth | Existing | Tauri-compatible implementation | P2 |
| Settings | Existing | Tauri + Rust persistence where appropriate | P2 |

Do not begin deleting Electron code until this matrix is complete.

---

# 6. Establish the Rust Core

Create the Tauri application and establish:

```text
React frontend
      ↓
Tauri invoke()
      ↓
Rust commands
      ↓
Rust services
```

Use Tauri commands for request/response operations.

Use Tauri events only where event-driven communication makes sense.

Do not use events for everything.

For example:

```text
Frontend:
invoke("get_displays")

Rust:
#[tauri::command]
fn get_displays(...) -> Result<Vec<Display>, AppError>
```

For continuous state updates:

```text
Rust → event → React
```

For example:

```text
media:position
media:state-changed
output:display-changed
presentation:changed
```

---

# 7. Create a Strong Rust State Model

Do not allow the React UI to become the authoritative source of presentation state.

Rust should own critical runtime state.

For example:

```rust
struct AppState {
    presentation: PresentationState,
    media: MediaState,
    output: OutputState,
}
```

The frontend should render this state and send commands to mutate it.

The architecture should resemble:

```text
                 ┌───────────────┐
                 │     React     │
                 └───────┬───────┘
                         │
                    Commands
                         │
                         ▼
                 ┌───────────────┐
                 │ Rust Core     │
                 │               │
                 │ authoritative │
                 │ state         │
                 └───────┬───────┘
                         │
               ┌─────────┼─────────┐
               ▼         ▼         ▼
             Media     Output    Display
```

This is especially important for live presentation software.

---

# 8. Media Architecture

Treat the media system as one of the most important parts of the migration.

Do NOT allow each UI component to independently create a media player.

There should be a clear media ownership model.

For example:

```text
Media Manager
      │
      ├── Asset
      │
      ├── Playback State
      │
      └── Output Targets
             ├── Preview
             └── Audience
```

The system must distinguish:

- media asset
- media playback instance
- preview rendering
- audience rendering
- audio output

Preview and audience output should not accidentally create duplicate playback/audio paths.

A critical requirement:

> One logical presentation media playback should not accidentally produce multiple audio streams.

Audit the existing application specifically for this problem.

---

# 9. Audio

Audio should have an explicit architecture.

Document:

```text
Source
 ↓
Decoder
 ↓
Audio stream
 ↓
Mixer/router
 ↓
Output device
```

Never let the UI directly decide that multiple independent HTML media elements should output the same audio unless that is explicitly intended.

If Rust is responsible for playback, establish a single authoritative audio path.

Test:

- Play video from media panel
- Play video from service
- Preview video
- Audience video
- Pause
- Resume
- Stop
- Seek
- Volume
- Mute
- Switching slides
- Switching media
- Closing output
- Opening output
- Multiple displays

---

# 10. Output Window

The existing application has a dedicated audience/output window.

Preserve that concept.

Target:

```text
Main Tauri Window
       │
       ├── Preview
       │
       └── Audience Output Window
```

The audience window must support:

- fullscreen
- selected display
- display changes
- resolution configuration
- black background
- no unnecessary UI
- stable rendering
- recovery from renderer failure where possible
- correct behavior when monitors are connected/disconnected

The audience output is a production-critical component.

A blank frame, wrong display, duplicate audio, or unexpected window movement is a serious bug.

---

# 11. Display Management

Move display management into Rust/native functionality.

The frontend should request things such as:

```text
get_displays()
get_preferred_display()
set_output_display()
get_display_bounds()
```

The Rust layer should own the actual display/window coordination.

The React UI should not contain complicated OS display logic.

---

# 12. File System

Move native filesystem responsibilities into Rust.

Frontend:

```text
invoke("open_file")
invoke("read_file")
invoke("save_project")
invoke("import_media")
```

Rust:

```text
filesystem service
```

Validate paths and avoid exposing unnecessary filesystem capabilities to the frontend.

Use Tauri capabilities/permissions appropriately.

---

# 13. IPC Migration

Map every current Electron IPC channel.

For every channel:

```text
Electron IPC
     ↓
What does it actually do?
     ↓
Tauri command/event/service
```

Do not simply rename:

```text
ipcRenderer.invoke(...)
```

to:

```text
invoke(...)
```

without redesigning the underlying API.

Create a clean API.

Bad:

```text
execute_electron_equivalent_thing()
```

Good:

```text
get_output_state()
set_output_display()
play_media()
stop_media()
get_project()
save_project()
```

The API should represent domain operations, not Electron implementation details.

---

# 14. Security

Use Tauri's capability/permission system.

The frontend should have access only to native capabilities it actually needs.

Avoid exposing:

- unrestricted filesystem
- arbitrary shell execution
- unnecessary native commands

Do not recreate Electron's broad Node access in the frontend.

---

# 15. Shared Types

Where possible, define shared domain models that can safely cross the React/Rust boundary.

Important models include:

```text
Presentation
Slide
Service
ServiceItem
MediaAsset
PlaybackState
OutputState
Display
Project
BibleVerse
```

Do not duplicate complicated domain definitions unnecessarily.

For Rust ↔ TypeScript serialization, use explicit serializable models.

---

# 16. Migration Order

Follow this order.

## Stage 0 — Audit

No feature migration.

Understand the entire application.

Deliverables:

- architecture map
- IPC map
- media map
- output map
- state map
- dependency map
- migration matrix

---

## Stage 1 — Tauri Skeleton

Create:

```text
apps/desktop/src-tauri
```

Add:

- Tauri
- Rust project
- React integration
- development workflow
- production build
- macOS build
- Windows build
- Linux build

The existing Electron application must continue working.

Do NOT remove Electron yet.

---

## Stage 2 — Window System

Implement:

- main window
- settings window if needed
- output window
- window state
- display discovery
- fullscreen
- display selection

Verify multi-monitor behavior.

---

## Stage 3 — Native APIs

Migrate:

- filesystem
- dialogs
- protocol/deep links
- global shortcuts
- menus
- OS integration
- permissions

---

## Stage 4 — Presentation Core

Move critical presentation state and operations into Rust.

Implement:

- service
- slides
- current slide
- next/previous
- presentation mode
- output state
- transitions/state changes

React becomes a controller/view.

---

## Stage 5 — Media Engine

This is a major milestone.

Build the media architecture before migrating individual media UI components.

Implement:

- media asset management
- playback state
- play
- pause
- stop
- seek
- volume
- mute
- playback position
- media lifecycle
- preview/output synchronization
- audio routing

Test heavily.

---

## Stage 6 — NDI

Replace the current Electron/native integration with an appropriate Rust/native implementation.

Preserve existing NDI functionality.

Test:

- discovery
- connection
- output
- disconnect/reconnect
- performance

---

## Stage 7 — Remaining Features

Migrate:

- Bible
- fonts
- PPTX
- authentication
- network functionality
- AI Operator
- error reporting
- settings
- other native services

Do not migrate something into Rust just for the sake of moving code.

Keep UI logic in React.

---

# 17. AI Operator

The AI Operator should not directly manipulate UI components.

Instead:

```text
AI
 ↓
Intent
 ↓
Application Command
 ↓
Rust Core
 ↓
Presentation / Media / Output
```

For example:

```text
AI:
"Show the next slide"

↓

next_slide()

↓

Rust presentation state

↓

Output updates
```

This creates a reliable foundation for future AI automation.

---

# 18. Testing Strategy

Every migrated subsystem must have tests.

Especially:

### Presentation

- next slide
- previous slide
- select slide
- service changes
- output synchronization

### Media

- play
- pause
- stop
- seek
- volume
- mute
- switching media
- cleanup
- repeated playback

### Output

- second display
- fullscreen
- display disconnect
- display reconnect
- display resolution
- output window lifecycle

### Audio

Test specifically for:

> One video should not accidentally produce two audible playback paths.

This regression must never return.

---

# 19. Performance Goals

Do not use vague claims such as "Rust is faster."

Measure the application.

Track:

- startup time
- memory usage
- CPU usage
- GPU usage
- frame stability
- media playback stability
- audio latency
- output latency
- time to switch slides
- time to start media
- time to create output window
- responsiveness while playing media

Compare the old Electron version with the new Tauri/Rust version.

The goal is measurable improvement and better reliability.

---

# 20. Migration Rules

STRICT RULES:

1. Do not delete working Electron functionality until the Tauri implementation has parity.
2. Do not rewrite the UI unnecessarily.
3. Do not redesign the visual interface as part of the migration.
4. Do not change product behavior unless required.
5. Do not blindly translate TypeScript into Rust.
6. Do not create giant Rust files.
7. Keep Rust modules focused.
8. Keep domain logic out of React where it affects runtime correctness.
9. Keep presentation-critical state authoritative in Rust.
10. Avoid duplicate media playback instances.
11. Avoid duplicate audio paths.
12. Do not sacrifice reliability for theoretical performance.
13. Test every migrated subsystem.
14. Keep the Electron version runnable until migration is sufficiently complete.
15. Commit frequently.
16. Prefer small, reviewable migration steps.

---

# 21. Definition of Done

The migration is complete when:

- Tauri builds successfully on macOS
- Tauri builds successfully on Windows
- Tauri builds successfully on Linux
- Existing core functionality works
- Main window works
- Output window works
- Multiple displays work
- Presentation controls work
- Service planning works
- Media playback works
- Audio works
- Preview works
- Audience output works
- NDI works
- Bible works
- PPTX works
- AI Operator works
- Authentication works
- Settings work
- Deep links work
- Files/projects work
- No duplicate audio playback occurs
- No critical Electron dependency remains
- Electron can be removed from the desktop package
- Production installers work
- Performance has been measured against the Electron version

---

# 22. How You Should Work

Before implementing anything substantial:

1. Inspect the repository.
2. Understand the current implementation.
3. Explain what you found.
4. Create/update the migration plan.
5. Identify dependencies and risks.
6. Implement one subsystem.
7. Test it.
8. Verify parity.
9. Only then move to the next subsystem.

Do not make a massive rewrite in one step.

When uncertain about an existing behavior, inspect the existing implementation rather than guessing.

Preserve behavior unless the migration explicitly requires changing it.

---

# MASTER AI PROMPT

You are working on the migration of the existing Present worship presentation software from Electron to Tauri + Rust.

Repository:

https://github.com/colesites/present

The repository is private and you have access to it.

The current application is a mature Electron + React + TypeScript desktop application. Do not assume it is a simple Electron project.

Your job is to migrate it to:

- Tauri
- Rust
- React
- TypeScript

The goal is to make Rust the native/application core while retaining React/TypeScript as the UI.

IMPORTANT:

Do not perform a blind Electron → Tauri conversion.

First inspect the repository thoroughly.

Understand:

- application architecture
- React architecture
- Zustand stores
- Electron main process
- preload
- IPC
- windows
- output system
- display management
- media playback
- audio
- filesystem
- NDI
- PPTX
- Bible system
- AI Operator
- authentication
- protocol/deep links
- global shortcuts
- settings
- native dependencies
- build/release system

Create an architecture map before implementing the migration.

The current Electron main process is intentionally modular. Preserve the good separation of concerns and improve it where necessary.

The application has a dedicated audience/output window. Treat this as production-critical.

The application is worship presentation software, so reliability during a live service is more important than theoretical architectural purity.

The most important subsystem to analyze carefully is MEDIA + AUDIO + OUTPUT.

Do not allow multiple UI components to accidentally create independent playback instances for the same logical presentation media.

There must be a clear ownership model:

```text
Media Manager
     ↓
Playback State
     ↓
Preview / Audience Output
```

Audio must have a clear authoritative path.

Pay particular attention to preventing duplicate audio playback/echo.

Rust should own important runtime state such as:

- presentation state
- media playback state
- output state
- display state
- native application state

React should primarily render and control the application through a clean Tauri API.

Use Tauri commands for request/response operations.

Use Tauri events for appropriate event-driven state changes.

Do not recreate Electron APIs unnecessarily.

Instead of designing APIs around Electron concepts, design domain APIs such as:

```text
play_media
pause_media
stop_media
seek_media
set_media_volume

next_slide
previous_slide
show_slide

get_displays
set_output_display

get_output_state
open_output_window
close_output_window

load_project
save_project
import_media
```

Use proper Rust error handling and serializable domain types.

Use Tauri capabilities/permissions appropriately.

Do not expose unrestricted native functionality to the frontend.

Do not rewrite the UI unnecessarily.

Do not redesign the product during migration.

Do not remove Electron until the replacement has feature parity.

Work incrementally.

Your first task is NOT to start rewriting code.

Your first task is:

1. Inspect the complete repository.
2. Produce a detailed architecture map.
3. Identify every Electron/native integration.
4. Identify every IPC channel.
5. Identify every window.
6. Identify the complete media/audio/output pipeline.
7. Identify the current state architecture.
8. Identify all native dependencies.
9. Identify the build/release process.
10. Produce a migration matrix.
11. Identify risks and blockers.
12. Propose the exact target Rust/Tauri architecture.

Then stop and present the audit.

Do not begin a massive migration until the audit is complete.

After the audit, migrate subsystem by subsystem.

For every subsystem:

```text
Inspect
→ Design
→ Implement
→ Test
→ Verify parity
→ Continue
```

Never guess about existing behavior when the repository can answer the question.

Keep the old Electron implementation working during the migration whenever practical.

The final goal is not simply "Present running in Tauri."

The goal is:

**A professional, reliable, high-performance worship presentation application with a React UI and a Rust-native core.**