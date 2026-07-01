import { BrowserWindow } from "electron";
import { isDev } from "../utils/app.utils";
import { getDesktopAppIcon } from "../services/icon.service";

declare const MAIN_WINDOW_WEBPACK_ENTRY: string;
declare const MAIN_WINDOW_PRELOAD_WEBPACK_ENTRY: string;

export type MiniLyricsWindowPayload = {
  libraryId: string;
  title: string;
  body: string;
};

type MiniLyricsWindowState = {
  window: BrowserWindow;
  payload: MiniLyricsWindowPayload;
};

const miniLyricsWindows = new Map<string, MiniLyricsWindowState>();

const sendPayload = (state: MiniLyricsWindowState) => {
  if (state.window.isDestroyed()) {
    return;
  }
  state.window.webContents.send("mini-lyrics:data", state.payload);
};

export const getMiniLyricsWindow = (libraryId: string): BrowserWindow | null => {
  const state = miniLyricsWindows.get(libraryId);
  return state && !state.window.isDestroyed() ? state.window : null;
};

export const sendMiniLyricsPayloadForWindow = (
  window: BrowserWindow,
): boolean => {
  for (const state of miniLyricsWindows.values()) {
    if (state.window === window && !state.window.isDestroyed()) {
      sendPayload(state);
      return true;
    }
  }
  return false;
};

export const createMiniLyricsWindow = (
  payload: MiniLyricsWindowPayload,
): boolean => {
  const existing = miniLyricsWindows.get(payload.libraryId);
  if (existing && !existing.window.isDestroyed()) {
    existing.payload = payload;
    existing.window.focus();
    sendPayload(existing);
    return true;
  }

  const miniLyricsWindow = new BrowserWindow({
    width: 420,
    height: 560,
    minWidth: 340,
    minHeight: 420,
    maxWidth: 520,
    maxHeight: 720,
    show: false,
    title: payload.title ? `Mini Lyrics - ${payload.title}` : "Mini Lyrics Editor",
    icon: getDesktopAppIcon(),
    backgroundColor: "#12131c",
    alwaysOnTop: false,
    fullscreenable: false,
    webPreferences: {
      preload: MAIN_WINDOW_PRELOAD_WEBPACK_ENTRY,
      nodeIntegration: false,
      contextIsolation: true,
      webSecurity: true,
      backgroundThrottling: false,
    },
  });
  const state: MiniLyricsWindowState = { window: miniLyricsWindow, payload };
  miniLyricsWindows.set(payload.libraryId, state);

  const baseUrl = isDev() ? MAIN_WINDOW_WEBPACK_ENTRY : "app://app/main_window/";
  const url = new URL(baseUrl);
  url.searchParams.set("window", "mini-lyrics");
  url.searchParams.set("libraryId", payload.libraryId);
  miniLyricsWindow.loadURL(url.toString());

  miniLyricsWindow.once("ready-to-show", () => {
    if (miniLyricsWindow.isDestroyed()) {
      return;
    }
    miniLyricsWindow.show();
    miniLyricsWindow.focus();
  });

  miniLyricsWindow.on("closed", () => {
    miniLyricsWindows.delete(payload.libraryId);
  });

  return true;
};

export const closeMiniLyricsWindow = (libraryId: string): boolean => {
  const state = miniLyricsWindows.get(libraryId);
  if (state && !state.window.isDestroyed()) {
    state.window.close();
    return true;
  }
  return false;
};
