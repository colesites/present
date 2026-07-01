import { BrowserWindow } from "electron";
import { isDev } from "../utils/app.utils";
import { getDesktopAppIcon } from "../services/icon.service";

declare const MAIN_WINDOW_WEBPACK_ENTRY: string;
declare const MAIN_WINDOW_PRELOAD_WEBPACK_ENTRY: string;

let screenComposerWindow: BrowserWindow | null = null;

export const getScreenComposerWindow = (): BrowserWindow | null =>
  screenComposerWindow;

export const createScreenComposerWindow = (): boolean => {
  if (screenComposerWindow && !screenComposerWindow.isDestroyed()) {
    screenComposerWindow.focus();
    return true;
  }

  screenComposerWindow = new BrowserWindow({
    width: 1560,
    height: 940,
    minWidth: 1240,
    minHeight: 760,
    show: false,
    title: "Screen Composer",
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

  const baseUrl = isDev() ? MAIN_WINDOW_WEBPACK_ENTRY : "app://app/main_window/";
  const url = new URL(baseUrl);
  url.searchParams.set("window", "screen-composer");
  screenComposerWindow.loadURL(url.toString());

  screenComposerWindow.once("ready-to-show", () => {
    if (!screenComposerWindow || screenComposerWindow.isDestroyed()) {
      return;
    }
    screenComposerWindow.show();
    screenComposerWindow.focus();
  });

  screenComposerWindow.on("closed", () => {
    screenComposerWindow = null;
  });

  return true;
};

export const closeScreenComposerWindow = (): boolean => {
  if (screenComposerWindow && !screenComposerWindow.isDestroyed()) {
    screenComposerWindow.close();
    return true;
  }
  return false;
};
