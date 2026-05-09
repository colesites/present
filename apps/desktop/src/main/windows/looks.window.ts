import { BrowserWindow } from 'electron';
import { isDev } from '../utils/app.utils';
import { getDesktopAppIcon } from '../services/icon.service';

declare const MAIN_WINDOW_WEBPACK_ENTRY: string;
declare const MAIN_WINDOW_PRELOAD_WEBPACK_ENTRY: string;

let looksWindow: BrowserWindow | null = null;

export const getLooksWindow = (): BrowserWindow | null => looksWindow;

export const createLooksWindow = (): boolean => {
  if (looksWindow && !looksWindow.isDestroyed()) {
    looksWindow.focus();
    return true;
  }

  looksWindow = new BrowserWindow({
    width: 1080,
    height: 760,
    minWidth: 940,
    minHeight: 620,
    show: false,
    title: 'Looks',
    icon: getDesktopAppIcon(),
    webPreferences: {
      preload: MAIN_WINDOW_PRELOAD_WEBPACK_ENTRY,
      nodeIntegration: false,
      contextIsolation: true,
      webSecurity: true,
    },
  });

  const baseUrl = isDev() ? MAIN_WINDOW_WEBPACK_ENTRY : 'app://app/main_window';
  const url = new URL(baseUrl);
  url.searchParams.set('window', 'looks');
  looksWindow.loadURL(url.toString());

  looksWindow.once('ready-to-show', () => {
    if (!looksWindow || looksWindow.isDestroyed()) {
      return;
    }
    looksWindow.show();
    looksWindow.focus();
  });

  looksWindow.on('closed', () => {
    looksWindow = null;
  });

  return true;
};

export const closeLooksWindow = (): boolean => {
  if (looksWindow && !looksWindow.isDestroyed()) {
    looksWindow.close();
    return true;
  }
  return false;
};
