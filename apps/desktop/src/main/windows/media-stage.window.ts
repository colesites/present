import { BrowserWindow } from 'electron';
import { isDev } from '../utils/app.utils';
import { getDesktopAppIcon } from '../services/icon.service';

declare const MAIN_WINDOW_WEBPACK_ENTRY: string;
declare const MAIN_WINDOW_PRELOAD_WEBPACK_ENTRY: string;

let mediaStageWindow: BrowserWindow | null = null;

export const getMediaStageWindow = (): BrowserWindow | null => mediaStageWindow;

export const createMediaStageWindow = (): boolean => {
  if (mediaStageWindow && !mediaStageWindow.isDestroyed()) {
    mediaStageWindow.focus();
    return true;
  }

  mediaStageWindow = new BrowserWindow({
    width: 1360,
    height: 860,
    minWidth: 1080,
    minHeight: 680,
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

  const baseUrl = isDev() ? MAIN_WINDOW_WEBPACK_ENTRY : 'app://app/main_window';
  const url = new URL(baseUrl);
  url.searchParams.set('window', 'media-stage');
  mediaStageWindow.loadURL(url.toString());

  mediaStageWindow.once('ready-to-show', () => {
    if (!mediaStageWindow || mediaStageWindow.isDestroyed()) {
      return;
    }
    mediaStageWindow.show();
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
