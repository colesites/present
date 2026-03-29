/**
 * Main Electron Process Entry Point
 * 
 * This file should remain minimal and only handle:
 * - App lifecycle events
 * - Protocol registration
 * - Window initialization
 * - IPC registration
 * 
 * All business logic is delegated to specialized modules.
 */

import { app, BrowserWindow, screen } from 'electron';
import { registerProtocolSchemes, registerProtocolHandlers } from './services/protocol.service';
import { clearLoopbackAuthFlow } from './services/auth.service';
import { reconcileOutputWindowDisplay } from './windows/output.window';
import { 
  createMainWindow, 
  setupSingleInstance, 
  setupProtocolClient,
  handleDeepLink
} from './windows/main.window';
import { openSettingsFromMenu } from './windows/settings.window';
import { setupMenu } from './menu/app.menu';
import { registerAllIPC } from './ipc';

// Handle Squirrel startup events on Windows
if (require('electron-squirrel-startup')) {
  app.quit();
}

// Register protocol schemes BEFORE app is ready
registerProtocolSchemes();

// Setup single instance lock and protocol client
setupSingleInstance();
setupProtocolClient();

// macOS handler for deep linking
app.on('open-url', (event, url) => {
  event.preventDefault();
  handleDeepLink(url);
});

// App ready - initialize everything
app.on('ready', () => {
  // Register protocol handlers
  registerProtocolHandlers();

  // Register all IPC handlers
  registerAllIPC();

  // Create main window
  createMainWindow();

  // Setup application menu
  setupMenu(openSettingsFromMenu);

  // Keep output window on the best available display as displays change
  screen.on('display-added', () => {
    reconcileOutputWindowDisplay();
  });
  
  screen.on('display-removed', () => {
    reconcileOutputWindowDisplay();
  });
  
  screen.on('display-metrics-changed', () => {
    reconcileOutputWindowDisplay();
  });

  // Handle initial deep link from command line (Windows/Linux)
  const initialDeepLink = process.argv.find((arg) => arg.startsWith('present://'));
  if (initialDeepLink) {
    handleDeepLink(initialDeepLink);
  }
});

// Cleanup before quit
app.on('before-quit', () => {
  clearLoopbackAuthFlow();
});

// Quit when all windows are closed (except on macOS)
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// Re-create window on macOS when dock icon is clicked
app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createMainWindow();
  }
});
