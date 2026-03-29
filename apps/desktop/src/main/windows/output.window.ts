import { BrowserWindow, screen } from 'electron';
import { isDev } from '../utils/app.utils';
import { getPreferredOutputDisplay, moveOutputWindowToDisplay } from '../services/display.service';

// Webpack entry points (declared globally by Forge)
declare const OUTPUT_WINDOW_WEBPACK_ENTRY: string;
declare const OUTPUT_WINDOW_PRELOAD_WEBPACK_ENTRY: string;

let outputWindow: BrowserWindow | null = null;

/**
 * Get the output window instance
 */
export const getOutputWindow = (): BrowserWindow | null => outputWindow;

/**
 * Create the output/projector window
 */
export const createOutputWindow = (mainWindow: BrowserWindow | null): boolean => {
  if (outputWindow && !outputWindow.isDestroyed()) {
    outputWindow.focus();
    reconcileOutputWindowDisplay();
    return true;
  }

  const preferredDisplay = getPreferredOutputDisplay();
  const isPrimary = preferredDisplay.id === screen.getPrimaryDisplay().id;

  outputWindow = new BrowserWindow({
    x: preferredDisplay.bounds.x,
    y: preferredDisplay.bounds.y,
    width: preferredDisplay.bounds.width || 1280,
    height: preferredDisplay.bounds.height || 720,
    fullscreen: !isPrimary,
    autoHideMenuBar: true,
    webPreferences: {
      preload: OUTPUT_WINDOW_PRELOAD_WEBPACK_ENTRY,
    },
  });

  if (isDev()) {
    outputWindow.loadURL(OUTPUT_WINDOW_WEBPACK_ENTRY);
  } else {
    outputWindow.loadURL('app://app/output_window');
  }

  outputWindow.on('closed', () => {
    outputWindow = null;
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('output-window-closed');
    }
  });

  return true;
};

/**
 * Close the output window
 */
export const closeOutputWindow = (): boolean => {
  if (outputWindow && !outputWindow.isDestroyed()) {
    outputWindow.close();
    return true;
  }
  return false;
};

/**
 * Reconcile output window display (move to preferred display)
 */
export const reconcileOutputWindowDisplay = (): void => {
  if (!outputWindow || outputWindow.isDestroyed()) {
    return;
  }
  moveOutputWindowToDisplay(outputWindow, getPreferredOutputDisplay());
};
