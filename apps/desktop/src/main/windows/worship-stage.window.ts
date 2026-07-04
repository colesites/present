import { BrowserWindow } from 'electron';
import { isDev } from '../utils/app.utils';
import { getDesktopAppIcon } from '../services/icon.service';
import {
  getFullDisplayBounds,
  getPreferredDisplay,
  getPreferredResolution,
  moveWindowToDisplay,
  parseResolution,
  setPreferredResolution,
  setPreferredDisplayId,
} from '../services/display.service';

declare const MAIN_WINDOW_WEBPACK_ENTRY: string;
declare const MAIN_WINDOW_PRELOAD_WEBPACK_ENTRY: string;

let worshipStageWindow: BrowserWindow | null = null;

export const getWorshipStageWindow = (): BrowserWindow | null => worshipStageWindow;

export const createWorshipStageWindow = (options?: {
  displayId?: number | null;
  resolution?: string | null;
}): boolean => {
  if (options?.displayId !== undefined) {
    setPreferredDisplayId('worship', options.displayId);
  }
  if (options?.resolution !== undefined) {
    setPreferredResolution('worship', parseResolution(options.resolution));
  }

  if (worshipStageWindow && !worshipStageWindow.isDestroyed()) {
    worshipStageWindow.focus();
    moveWindowToDisplay(
      worshipStageWindow,
      getPreferredDisplay('worship'),
      getPreferredResolution('worship'),
    );
    return true;
  }

  const preferredDisplay = getPreferredDisplay('worship');
  const preferredBounds = getFullDisplayBounds(preferredDisplay);
  worshipStageWindow = new BrowserWindow({
    x: preferredBounds.x,
    y: preferredBounds.y,
    width: preferredBounds.width || 1360,
    height: preferredBounds.height || 860,
    fullscreen: true,
    frame: false,
    show: false,
    title: 'Worship Stage',
    icon: getDesktopAppIcon(),
    backgroundColor: '#000000',
    webPreferences: {
      preload: MAIN_WINDOW_PRELOAD_WEBPACK_ENTRY,
      nodeIntegration: false,
      contextIsolation: true,
      webSecurity: true,
      backgroundThrottling: false,
    },
  });

  const baseUrl = isDev() ? MAIN_WINDOW_WEBPACK_ENTRY : 'app://app/main_window/';
  const url = new URL(baseUrl);
  url.searchParams.set('window', 'worship-stage');
  worshipStageWindow.loadURL(url.toString());

  worshipStageWindow.once('ready-to-show', () => {
    if (!worshipStageWindow || worshipStageWindow.isDestroyed()) {
      return;
    }
    worshipStageWindow.show();
    if (!worshipStageWindow.isFullScreen()) {
      worshipStageWindow.setFullScreen(true);
    }
    worshipStageWindow.focus();
  });

  worshipStageWindow.on('closed', () => {
    worshipStageWindow = null;
  });

  return true;
};

export const closeWorshipStageWindow = (): boolean => {
  if (worshipStageWindow && !worshipStageWindow.isDestroyed()) {
    worshipStageWindow.close();
    return true;
  }
  return false;
};
