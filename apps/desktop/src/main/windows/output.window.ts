import { BrowserWindow } from 'electron';
import { isDev } from '../utils/app.utils';
import {
  getCenteredWindowBounds,
  getPreferredOutputDisplay,
  getPreferredResolution,
  moveOutputWindowToDisplay,
  parseResolution,
  setPreferredResolution,
  setPreferredOutputDisplayId,
} from '../services/display.service';
import { getDesktopAppIcon } from '../services/icon.service';

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
export const createOutputWindow = (
  mainWindow: BrowserWindow | null,
  options?: {
    displayId?: number | null;
    resolution?: string | null;
  },
): boolean => {
  if (options?.displayId !== undefined) {
    setPreferredOutputDisplayId(options.displayId);
  }
  if (options?.resolution !== undefined) {
    setPreferredResolution('audience', parseResolution(options.resolution));
  }

  if (outputWindow && !outputWindow.isDestroyed()) {
    outputWindow.focus();
    reconcileOutputWindowDisplay();
    return true;
  }

  const preferredDisplay = getPreferredOutputDisplay();
  const preferredBounds = getCenteredWindowBounds(
    preferredDisplay,
    getPreferredResolution('audience'),
  );
  const appIcon = getDesktopAppIcon();

  outputWindow = new BrowserWindow({
    x: preferredBounds.x,
    y: preferredBounds.y,
    width: preferredBounds.width || 1280,
    height: preferredBounds.height || 720,
    fullscreen: false,
    icon: appIcon,
    autoHideMenuBar: true,
    // The output window goes to the audience screen — a white flash here is
    // catastrophic. Force a black background and only show after the first
    // paint is ready.
    backgroundColor: '#000000',
    show: false,
    webPreferences: {
      preload: OUTPUT_WINDOW_PRELOAD_WEBPACK_ENTRY,
      // Keep frame timing stable; without this the output can throttle when
      // the main window steals focus, which manifests as a brief blank/white
      // frame on the projector.
      backgroundThrottling: false,
      webviewTag: true,
    },
  });

  outputWindow.once('ready-to-show', () => {
    outputWindow?.show();
  });

  outputWindow.webContents.on('render-process-gone', (_event, details) => {
    console.error('[Output Window] Renderer gone:', details);
    if (details.reason !== 'clean-exit' && outputWindow && !outputWindow.isDestroyed()) {
      try {
        outputWindow.webContents.reload();
      } catch (err) {
        console.error('[Output Window] reload after crash failed:', err);
      }
    }
  });

  if (isDev()) {
    outputWindow.loadURL(OUTPUT_WINDOW_WEBPACK_ENTRY);
  } else {
    outputWindow.loadURL('app://app/output_window/');
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
