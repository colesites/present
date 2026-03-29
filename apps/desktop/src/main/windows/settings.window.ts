import { BrowserWindow } from 'electron';
import { isDev } from '../utils/app.utils';

declare const MAIN_WINDOW_WEBPACK_ENTRY: string;
declare const MAIN_WINDOW_PRELOAD_WEBPACK_ENTRY: string;

// eslint-disable-next-line prefer-const
let settingsWindow: BrowserWindow | null = null;

/**
 * Get the settings window instance
 */
export const getSettingsWindow = (): BrowserWindow | null => settingsWindow;

/**
 * Create or focus the settings window
 */
export const createSettingsWindow = (): void => {
  if (settingsWindow && !settingsWindow.isDestroyed()) {
    settingsWindow.focus();
    return;
  }

  settingsWindow = new BrowserWindow({
    width: 1100,
    height: 760,
    minWidth: 900,
    minHeight: 620,
    show: false,
    title: 'Present Settings',
    webPreferences: {
      preload: MAIN_WINDOW_PRELOAD_WEBPACK_ENTRY,
      nodeIntegration: false,
      contextIsolation: true,
      webSecurity: true,
    },
  });

  const baseUrl = isDev() ? MAIN_WINDOW_WEBPACK_ENTRY : 'app://app/main_window';
  const url = new URL(baseUrl);
  url.searchParams.set('window', 'settings');
  settingsWindow.loadURL(url.toString());

  settingsWindow.once('ready-to-show', () => {
    if (!settingsWindow || settingsWindow.isDestroyed()) {
      return;
    }
    settingsWindow.show();
    settingsWindow.focus();
  });

  settingsWindow.on('closed', () => {
    settingsWindow = null;
  });
};

/**
 * Open settings from menu
 */
export const openSettingsFromMenu = (): void => {
  createSettingsWindow();
};
