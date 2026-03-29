# Electron Main Process Architecture

## Visual Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                          RENDERER PROCESS                           │
│                     (React App - User Interface)                    │
└─────────────────────────────────────────────────────────────────────┘
                                  │
                                  │ IPC Messages
                                  ▼
┌─────────────────────────────────────────────────────────────────────┐
│                           MAIN PROCESS                              │
│                                                                     │
│  ┌───────────────────────────────────────────────────────────────┐ │
│  │                         index.ts                              │ │
│  │                    (Entry Point - 80 lines)                   │ │
│  │                                                               │ │
│  │  • App lifecycle (ready, quit, activate)                     │ │
│  │  • Protocol registration                                     │ │
│  │  • Window initialization                                     │ │
│  │  • IPC registration                                          │ │
│  │  • Display event listeners                                   │ │
│  └───────────────────────────────────────────────────────────────┘ │
│                                  │                                  │
│         ┌────────────────────────┼────────────────────────┐         │
│         ▼                        ▼                        ▼         │
│  ┌─────────────┐         ┌─────────────┐         ┌─────────────┐  │
│  │  services/  │         │  windows/   │         │    ipc/     │  │
│  │             │         │             │         │             │  │
│  │ ┌─────────┐ │         │ ┌─────────┐ │         │ ┌─────────┐ │  │
│  │ │  auth   │ │◄────────┤ │  main   │ │◄────────┤ │ window  │ │  │
│  │ └─────────┘ │         │ └─────────┘ │         │ └─────────┘ │  │
│  │             │         │             │         │             │  │
│  │ ┌─────────┐ │         │ ┌─────────┐ │         │ ┌─────────┐ │  │
│  │ │ display │ │◄────────┤ │ output  │ │◄────────┤ │  file   │ │  │
│  │ └─────────┘ │         │ └─────────┘ │         │ └─────────┘ │  │
│  │             │         │             │         │             │  │
│  │ ┌─────────┐ │         │ ┌─────────┐ │         │ ┌─────────┐ │  │
│  │ │protocol │ │         │ │settings │ │         │ │  bible  │ │  │
│  │ └─────────┘ │         │ └─────────┘ │         │ └─────────┘ │  │
│  │             │         │             │         │             │  │
│  └─────────────┘         └─────────────┘         │ ┌─────────┐ │  │
│         │                        │               │ │  auth   │ │  │
│         │                        │               │ └─────────┘ │  │
│         │                        │               │             │  │
│         │                        │               │ ┌─────────┐ │  │
│         │                        │               │ │ network │ │  │
│         │                        │               │ └─────────┘ │  │
│         │                        │               │             │  │
│         │                        │               │ ┌─────────┐ │  │
│         │                        │               │ │  index  │ │  │
│         │                        │               │ └─────────┘ │  │
│         │                        │               └─────────────┘  │
│         │                        │                        │        │
│         └────────────────────────┼────────────────────────┘        │
│                                  ▼                                 │
│                          ┌─────────────┐                           │
│                          │   utils/    │                           │
│                          │             │                           │
│                          │ ┌─────────┐ │                           │
│                          │ │app.utils│ │                           │
│                          │ └─────────┘ │                           │
│                          └─────────────┘                           │
│                                                                     │
│  ┌───────────────────────────────────────────────────────────────┐ │
│  │                         menu/                                 │ │
│  │                                                               │ │
│  │                    ┌─────────────┐                           │ │
│  │                    │  app.menu   │                           │ │
│  │                    └─────────────┘                           │ │
│  └───────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────────┘
```

## Data Flow

### 1. App Initialization Flow

```
User starts app
      │
      ▼
index.ts: app.on('ready')
      │
      ├─► registerProtocolSchemes()  ──► protocol.service.ts
      │
      ├─► registerProtocolHandlers() ──► protocol.service.ts
      │
      ├─► registerAllIPC()           ──► ipc/index.ts
      │                                      │
      │                                      ├─► window.ipc.ts
      │                                      ├─► file.ipc.ts
      │                                      ├─► bible.ipc.ts
      │                                      ├─► auth.ipc.ts
      │                                      └─► network.ipc.ts
      │
      ├─► createMainWindow()         ──► main.window.ts
      │
      └─► setupMenu()                ──► app.menu.ts
```

### 2. IPC Request Flow

```
Renderer sends IPC message
      │
      ▼
ipc/window.ipc.ts receives 'open-output-window'
      │
      ▼
Calls createOutputWindow() from windows/output.window.ts
      │
      ▼
output.window.ts uses getPreferredOutputDisplay() from services/display.service.ts
      │
      ▼
Creates BrowserWindow and positions it
      │
      ▼
Returns success to renderer
```

### 3. Auth Flow

```
Renderer requests auth
      │
      ▼
ipc/auth.ipc.ts receives 'begin-auth-flow'
      │
      ▼
Calls beginAuthFlow() from services/auth.service.ts
      │
      ├─► Creates loopback server
      ├─► Opens browser with auth URL
      └─► Waits for callback
            │
            ▼
      Browser redirects to localhost
            │
            ▼
      Server receives token
            │
            ▼
      Calls sendAuthTokenToRenderer()
            │
            ▼
      Calls handleDeepLink() from windows/main.window.ts
            │
            ▼
      Sends token to renderer via IPC
```

### 4. Deep Link Flow

```
OS sends deep link (present://...)
      │
      ▼
index.ts: app.on('open-url') (macOS)
  OR
index.ts: app.on('second-instance') (Windows/Linux)
      │
      ▼
Calls handleDeepLink() from windows/main.window.ts
      │
      ├─► Parses URL
      ├─► Focuses main window
      └─► Sends message to renderer
```

## Module Responsibilities

### 📄 index.ts (Orchestrator)
**Role:** Wire everything together
**Responsibilities:**
- Listen to app lifecycle events
- Call initialization functions
- Setup event listeners
**Does NOT:**
- Implement business logic
- Create windows directly
- Handle IPC messages

### 🔌 ipc/ (IPC Layer)
**Role:** Bridge between renderer and main
**Responsibilities:**
- Register IPC handlers
- Validate IPC messages
- Call appropriate services/windows
**Does NOT:**
- Implement business logic
- Manage state
- Create windows

### 🛠️ services/ (Business Logic)
**Role:** Core functionality
**Responsibilities:**
- Authentication logic
- Display management
- Protocol handling
- Network requests
**Does NOT:**
- Handle IPC directly
- Create windows
- Manage app lifecycle

### 🪟 windows/ (Window Management)
**Role:** Window lifecycle
**Responsibilities:**
- Create windows
- Manage window state
- Handle window events
- Deep link handling
**Does NOT:**
- Handle IPC (except sending)
- Implement business logic
- Manage protocols

### 🍔 menu/ (Application Menu)
**Role:** Menu management
**Responsibilities:**
- Build application menu
- Handle menu actions
**Does NOT:**
- Create windows directly
- Handle IPC
- Implement business logic

### 🧰 utils/ (Utilities)
**Role:** Shared helpers
**Responsibilities:**
- Path validation
- Environment detection
- URL building
**Does NOT:**
- Depend on other modules
- Manage state
- Handle IPC

## Dependency Graph

```
┌─────────────────────────────────────────────────────────┐
│                      index.ts                           │
│                    (No dependencies)                    │
└─────────────────────────────────────────────────────────┘
                           │
        ┌──────────────────┼──────────────────┐
        ▼                  ▼                  ▼
┌──────────────┐  ┌──────────────┐  ┌──────────────┐
│   services/  │  │   windows/   │  │     ipc/     │
│              │  │              │  │              │
│  Depends on: │  │  Depends on: │  │  Depends on: │
│  • utils     │  │  • services  │  │  • windows   │
│              │  │  • utils     │  │  • services  │
└──────────────┘  └──────────────┘  └──────────────┘
        │                  │                  │
        └──────────────────┼──────────────────┘
                           ▼
                   ┌──────────────┐
                   │    utils/    │
                   │              │
                   │ (No deps)    │
                   └──────────────┘
```

## File Size Comparison

```
Before Refactoring:
┌────────────────────────────────────────────────────────────┐
│ index.ts                                                   │
│ ████████████████████████████████████████████████ 800 lines│
└────────────────────────────────────────────────────────────┘

After Refactoring:
┌────────────────────────────────────────────────────────────┐
│ index.ts                                                   │
│ ████ 80 lines                                              │
├────────────────────────────────────────────────────────────┤
│ ipc/index.ts                                               │
│ █ 20 lines                                                 │
├────────────────────────────────────────────────────────────┤
│ ipc/window.ipc.ts                                          │
│ ████ 50 lines                                              │
├────────────────────────────────────────────────────────────┤
│ ipc/file.ipc.ts                                            │
│ ███ 40 lines                                               │
├────────────────────────────────────────────────────────────┤
│ ipc/bible.ipc.ts                                           │
│ ████ 50 lines                                              │
├────────────────────────────────────────────────────────────┤
│ ipc/auth.ipc.ts                                            │
│ ██ 25 lines                                                │
├────────────────────────────────────────────────────────────┤
│ ipc/network.ipc.ts                                         │
│ ███ 35 lines                                               │
├────────────────────────────────────────────────────────────┤
│ services/auth.service.ts                                   │
│ ████████ 130 lines                                         │
├────────────────────────────────────────────────────────────┤
│ services/display.service.ts                                │
│ ███ 45 lines                                               │
├────────────────────────────────────────────────────────────┤
│ services/protocol.service.ts                               │
│ ████████ 140 lines                                         │
├────────────────────────────────────────────────────────────┤
│ windows/main.window.ts                                     │
│ ████████ 120 lines                                         │
├────────────────────────────────────────────────────────────┤
│ windows/output.window.ts                                   │
│ ████ 60 lines                                              │
├────────────────────────────────────────────────────────────┤
│ windows/settings.window.ts                                 │
│ █ 20 lines                                                 │
├────────────────────────────────────────────────────────────┤
│ menu/app.menu.ts                                           │
│ ████████ 100 lines                                         │
├────────────────────────────────────────────────────────────┤
│ utils/app.utils.ts                                         │
│ ██ 25 lines                                                │
└────────────────────────────────────────────────────────────┘
Total: ~940 lines (distributed across 15 files)
```

## Benefits Visualization

### Maintainability

```
Before:
┌─────────────────────────────────────────┐
│ Need to add auth feature?               │
│ → Scroll through 800 lines              │
│ → Find the right place                  │
│ → Hope you don't break something        │
└─────────────────────────────────────────┘

After:
┌─────────────────────────────────────────┐
│ Need to add auth feature?               │
│ → Open services/auth.service.ts         │
│ → Add function                          │
│ → Done!                                 │
└─────────────────────────────────────────┘
```

### Testability

```
Before:
┌─────────────────────────────────────────┐
│ Want to test auth logic?                │
│ → Can't import from index.ts            │
│ → Need to mock entire Electron app      │
│ → Tests are complex and brittle         │
└─────────────────────────────────────────┘

After:
┌─────────────────────────────────────────┐
│ Want to test auth logic?                │
│ → Import from auth.service.ts           │
│ → Test pure functions                   │
│ → Simple, fast, reliable tests          │
└─────────────────────────────────────────┘
```

### Collaboration

```
Before:
┌─────────────────────────────────────────┐
│ Multiple developers working?            │
│ → Everyone edits index.ts               │
│ → Constant merge conflicts              │
│ → Hard to review changes                │
└─────────────────────────────────────────┘

After:
┌─────────────────────────────────────────┐
│ Multiple developers working?            │
│ → Dev A: windows/main.window.ts         │
│ → Dev B: services/auth.service.ts       │
│ → No conflicts, easy reviews            │
└─────────────────────────────────────────┘
```

## Summary

This architecture provides:

✅ **Clear separation of concerns** - Each file has one job
✅ **Easy navigation** - Find code by feature, not by scrolling
✅ **Testable modules** - Test business logic independently
✅ **Maintainable codebase** - Add features without touching index.ts
✅ **Scalable structure** - Grow the app without growing complexity
✅ **Team-friendly** - Multiple developers can work without conflicts

The refactoring transforms a monolithic 800-line file into a professional, production-ready architecture that's easy to understand, test, and maintain.
