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

let mediaStageWindow: BrowserWindow | null = null;

export const getMediaStageWindow = (): BrowserWindow | null => mediaStageWindow;

export const createMediaStageWindow = (options?: {
  displayId?: number | null;
  resolution?: string | null;
}): boolean => {
  if (options?.displayId !== undefined) {
    setPreferredDisplayId('media', options.displayId);
  }
  if (options?.resolution !== undefined) {
    setPreferredResolution('media', parseResolution(options.resolution));
  }

  if (mediaStageWindow && !mediaStageWindow.isDestroyed()) {
    mediaStageWindow.focus();
    moveWindowToDisplay(
      mediaStageWindow,
      getPreferredDisplay('media'),
      getPreferredResolution('media'),
    );
    return true;
  }

  const preferredDisplay = getPreferredDisplay('media');
  const preferredBounds = getFullDisplayBounds(preferredDisplay);
  mediaStageWindow = new BrowserWindow({
    x: preferredBounds.x,
    y: preferredBounds.y,
    width: preferredBounds.width || 1360,
    height: preferredBounds.height || 860,
    fullscreen: true,
    frame: false,
    show: false,
    title: 'Media Stage',
    icon: getDesktopAppIcon(),
    backgroundColor: '#12131c',
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
  url.searchParams.set('window', 'media-stage');
  mediaStageWindow.loadURL(url.toString());

  mediaStageWindow.once('ready-to-show', () => {
    if (!mediaStageWindow || mediaStageWindow.isDestroyed()) {
      return;
    }
    mediaStageWindow.show();
    if (!mediaStageWindow.isFullScreen()) {
      mediaStageWindow.setFullScreen(true);
    }
    mediaStageWindow.focus();
  });

  mediaStageWindow.on('closed', () => {
    mediaStageWindow = null;
  });

  return true;
};

export const closeMediaStageWindow = (): boolean => {
  if (mediaStageWindow && !mediaStageWindow.isDestroyed()) {
    mediaStageWindow.close();
    return true;
  }
  return false;
};
