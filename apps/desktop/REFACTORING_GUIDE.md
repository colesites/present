# Electron Main Process Refactoring Guide

## Overview

The main process has been refactored from a single 800+ line `index.ts` file into a clean, modular architecture following responsibility-based organization.

## New Structure

```
src/main/
├── index.ts                    # 🎯 Entry point (~80 lines)
├── preload.ts                  # Preload script (unchanged)
├── ipc/                        # 🔌 IPC Handlers
│   ├── index.ts               # Central IPC registration
│   ├── window.ipc.ts          # Window management IPC
│   ├── file.ipc.ts            # File operations IPC
│   ├── bible.ipc.ts           # Bible-related IPC
│   ├── auth.ipc.ts            # Authentication IPC
│   └── network.ipc.ts         # Network requests IPC
├── services/                   # 🛠️ Business Logic
│   ├── auth.service.ts        # Authentication logic
│   ├── display.service.ts     # Display management
│   └── protocol.service.ts    # Custom protocols
├── windows/                    # 🪟 Window Management
│   ├── main.window.ts         # Main window creation
│   ├── output.window.ts       # Output/projector window
│   └── settings.window.ts     # Settings window
├── menu/                       # 🍔 Application Menu
│   └── app.menu.ts            # Menu builder
└── utils/                      # 🧰 Utilities
    └── app.utils.ts           # Helper functions
```

## What's in Each File

### 📄 `main/index.ts` (Entry Point)

**ONLY contains:**
- App lifecycle events (`ready`, `window-all-closed`, `activate`, `before-quit`)
- Protocol scheme registration (before ready)
- Window initialization calls
- IPC registration calls
- Display event listeners
- Deep link handling setup

**Does NOT contain:**
- Window creation logic
- IPC handler implementations
- Business logic
- Helper functions

### 🔌 `ipc/` (IPC Handlers)

Each file handles a specific domain:

**`window.ipc.ts`**
- `get-displays` - Get all displays
- `open-output-window` - Open projector window
- `close-output-window` - Close projector window
- `send-to-output` - Relay data to output window
- `output-ready` - Output window ready signal

**`file.ipc.ts`**
- `select-folder` - Open folder picker dialog
- `read-folder` - Read folder contents

**`bible.ipc.ts`**
- `list-bundled-bibles` - List bundled Bible files
- `read-bundled-bible` - Read Bible file contents

**`auth.ipc.ts`**
- `begin-auth-flow` - Start desktop auth flow
- `consume-pending-auth-token` - Get pending auth token
- `open-external-browser` - Open URL in browser

**`network.ipc.ts`**
- `fetch-hosted-bible-catalog` - Fetch remote Bible catalog

**`index.ts`**
- Imports and registers all IPC handlers
- Single `registerAllIPC()` function

### 🛠️ `services/` (Business Logic)

**`auth.service.ts`**
- Loopback auth server management
- Auth token handling
- Desktop auth URL building
- Auth flow cleanup

**`display.service.ts`**
- Display detection and selection
- Output window positioning
- Display reconciliation

**`protocol.service.ts`**
- Custom protocol registration (`app://`, `local-media://`)
- Protocol handlers for serving assets
- Video/image streaming

### 🪟 `windows/` (Window Management)

**`main.window.ts`**
- Main window creation
- Deep link handling
- Single instance lock
- Protocol client setup
- Window state management

**`output.window.ts`**
- Output/projector window creation
- Display positioning
- Window lifecycle

**`settings.window.ts`**
- Settings window creation (placeholder)
- Settings menu handler

### 🍔 `menu/` (Application Menu)

**`app.menu.ts`**
- Application menu builder
- Platform-specific menu items
- Settings menu integration

### 🧰 `utils/` (Utilities)

**`app.utils.ts`**
- `isPathWithinRoot()` - Security path validation
- `getWebAppBaseUrl()` - Get web app URL
- `isDev()` - Check if in development mode

## Import Patterns

### From `index.ts`

```typescript
// Services
import { registerProtocolSchemes, registerProtocolHandlers } from './services/protocol.service';
import { clearLoopbackAuthFlow } from './services/auth.service';

// Windows
import { createMainWindow, handleDeepLink } from './windows/main.window';
import { getOutputWindow, reconcileOutputWindowDisplay } from './windows/output.window';
import { openSettingsFromMenu } from './windows/settings.window';

// Menu
import { setupMenu } from './menu/app.menu';

// IPC
import { registerAllIPC } from './ipc';
```

### From IPC handlers

```typescript
// In window.ipc.ts
import { createOutputWindow, getOutputWindow } from '../windows/output.window';
import { getMainWindow } from '../windows/main.window';

// In auth.ipc.ts
import { beginAuthFlow, consumePendingAuthToken } from '../services/auth.service';
import { handleDeepLink } from '../windows/main.window';
```

### From services

```typescript
// In auth.service.ts
import { getWebAppBaseUrl } from '../utils/app.utils';

// In protocol.service.ts
import { isDev } from '../utils/app.utils';
```

## Key Principles

### 1. Single Responsibility
Each file has ONE clear purpose:
- `window.ipc.ts` - ONLY window IPC handlers
- `auth.service.ts` - ONLY auth business logic
- `main.window.ts` - ONLY main window management

### 2. Dependency Direction
```
index.ts
  ↓
services/ ← windows/ ← ipc/
  ↓
utils/
```

- `index.ts` imports from all modules
- IPC handlers import from windows and services
- Services import from utils
- Utils have no dependencies

### 3. State Management
- Window instances stored in their respective files
- Exported getter functions for access
- No global state in `index.ts`

### 4. Initialization Order
1. Protocol schemes (before `ready`)
2. Single instance lock
3. Protocol client
4. App `ready` event:
   - Protocol handlers
   - IPC registration
   - Window creation
   - Menu setup
   - Display listeners

## Migration Checklist

✅ **Completed:**
- [x] Extract utilities to `utils/app.utils.ts`
- [x] Extract auth logic to `services/auth.service.ts`
- [x] Extract display logic to `services/display.service.ts`
- [x] Extract protocol logic to `services/protocol.service.ts`
- [x] Extract menu logic to `menu/app.menu.ts`
- [x] Extract main window to `windows/main.window.ts`
- [x] Extract output window to `windows/output.window.ts`
- [x] Extract settings window to `windows/settings.window.ts`
- [x] Extract window IPC to `ipc/window.ipc.ts`
- [x] Extract file IPC to `ipc/file.ipc.ts`
- [x] Extract Bible IPC to `ipc/bible.ipc.ts`
- [x] Extract auth IPC to `ipc/auth.ipc.ts`
- [x] Extract network IPC to `ipc/network.ipc.ts`
- [x] Create IPC index to `ipc/index.ts`
- [x] Refactor `main/index.ts` to minimal entry point

## Benefits

### Before (800+ lines)
- ❌ Hard to navigate
- ❌ Difficult to test
- ❌ Unclear dependencies
- ❌ Mixed concerns
- ❌ Hard to maintain

### After (~80 lines in index.ts)
- ✅ Easy to navigate
- ✅ Testable modules
- ✅ Clear dependencies
- ✅ Separated concerns
- ✅ Easy to maintain

## Testing Strategy

Each module can now be tested independently:

```typescript
// Example: Testing auth.service.ts
import { buildDesktopAuthLoginUrl } from './services/auth.service';

test('builds correct auth URL', () => {
  const url = buildDesktopAuthLoginUrl('http://localhost:3000/callback');
  expect(url).toContain('/auth/login');
  expect(url).toContain('returnTo=');
});
```

## Future Improvements

1. **Add TypeScript interfaces** for IPC message types
2. **Extract constants** to `constants.ts` file
3. **Add error handling** middleware for IPC
4. **Implement settings window** fully
5. **Add logging service** for better debugging
6. **Add tests** for each module

## Common Patterns

### Adding a new IPC handler

1. Create handler in appropriate `ipc/*.ipc.ts` file
2. Register in that file's registration function
3. Import and call registration in `ipc/index.ts`

### Adding a new window

1. Create `windows/new-window.ts`
2. Export `createNewWindow()` and `getNewWindow()`
3. Import in `index.ts` and call in `ready` event

### Adding a new service

1. Create `services/new-service.ts`
2. Export functions (no classes needed)
3. Import where needed (IPC handlers, windows, etc.)

## Troubleshooting

### "Cannot find module" errors
- Check import paths use correct relative paths
- Ensure all files are saved
- Restart TypeScript server

### "X is not defined" errors
- Check if variable is exported from source file
- Verify import statement includes the variable
- Check for circular dependencies

### IPC handlers not working
- Verify handler is registered in `ipc/index.ts`
- Check `registerAllIPC()` is called in `index.ts`
- Ensure handler is called AFTER `app.ready`

## Summary

This refactoring transforms a monolithic 800-line file into a clean, modular architecture where:
- Each file has a single, clear purpose
- Dependencies flow in one direction
- Code is easy to find, test, and maintain
- New features can be added without touching `index.ts`

The `index.ts` file is now just an orchestrator that wires everything together, making the codebase professional and maintainable.
