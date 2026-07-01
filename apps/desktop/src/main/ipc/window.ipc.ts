import { BrowserWindow, ipcMain, screen } from 'electron';
import { createOutputWindow, closeOutputWindow, getOutputWindow } from '../windows/output.window';
import { getMainWindow } from '../windows/main.window';
import {
  closeMediaStageWindow,
  createMediaStageWindow,
  getMediaStageWindow,
} from '../windows/media-stage.window';
import { closeLooksWindow, createLooksWindow } from '../windows/looks.window';
import {
  closeMiniLyricsWindow,
  createMiniLyricsWindow,
  sendMiniLyricsPayloadForWindow,
} from '../windows/mini-lyrics.window';
import {
  closeScreenComposerWindow,
  createScreenComposerWindow,
} from "../windows/screen-composer.window";
import {
  getPreferredOutputDisplayId,
  setPreferredOutputDisplayId,
} from '../services/display.service';

/**
 * Register window-related IPC handlers
 */
export const registerWindowIPC = (): void => {
  const pendingMiniLyricsSaves = new Map<
    string,
    (value: { ok: boolean; error?: string }) => void
  >();

  // Get all displays
  ipcMain.handle('get-displays', () => {
    return screen.getAllDisplays().map(d => ({
      id: d.id,
      label: d.label,
      bounds: d.bounds,
      workArea: d.workArea,
      scaleFactor: d.scaleFactor,
      isPrimary: d.id === screen.getPrimaryDisplay().id
    }));
  });

  ipcMain.handle('set-preferred-output-display', (_event, displayId: number | null) => {
    setPreferredOutputDisplayId(displayId);
    return true;
  });

  ipcMain.handle('get-preferred-output-display', () => {
    return getPreferredOutputDisplayId();
  });

  // Open output window
  ipcMain.handle('open-output-window', (_event, displayId?: number | null) => {
    const mainWindow = getMainWindow();
    return createOutputWindow(mainWindow, { displayId });
  });

  // Close output window
  ipcMain.handle('close-output-window', () => {
    return closeOutputWindow();
  });

  ipcMain.handle('open-media-stage-window', () => {
    return createMediaStageWindow();
  });

  ipcMain.handle('close-media-stage-window', () => {
    return closeMediaStageWindow();
  });

  ipcMain.handle('open-looks-window', () => {
    return createLooksWindow();
  });

  ipcMain.handle('close-looks-window', () => {
    return closeLooksWindow();
  });

  ipcMain.handle("open-screen-composer-window", () => {
    return createScreenComposerWindow();
  });

  ipcMain.handle("close-screen-composer-window", () => {
    return closeScreenComposerWindow();
  });

  ipcMain.handle("open-mini-lyrics-window", (_event, payload) => {
    return createMiniLyricsWindow(payload);
  });

  ipcMain.handle("close-mini-lyrics-window", (_event, libraryId?: string) => {
    if (typeof libraryId !== "string" || !libraryId) {
      return false;
    }
    return closeMiniLyricsWindow(libraryId);
  });

  ipcMain.on("mini-lyrics:ready", (event) => {
    const senderWindow = BrowserWindow.fromWebContents(event.sender);
    if (senderWindow && !senderWindow.isDestroyed()) {
      sendMiniLyricsPayloadForWindow(senderWindow);
    }
  });

  ipcMain.handle("mini-lyrics:save", async (_event, payload) => {
    const mainWindow = getMainWindow();
    if (!mainWindow || mainWindow.isDestroyed()) {
      return { ok: false, error: "Main window is unavailable." };
    }

    const requestId = `mini_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    const result = await new Promise<{ ok: boolean; error?: string }>((resolve) => {
      const timeoutId = setTimeout(() => {
        pendingMiniLyricsSaves.delete(requestId);
        resolve({ ok: false, error: "Save timed out." });
      }, 10_000);

      pendingMiniLyricsSaves.set(requestId, (value) => {
        clearTimeout(timeoutId);
        resolve(value);
      });

      mainWindow.webContents.send("mini-lyrics:save-request", {
        requestId,
        payload,
      });
    });

    return result;
  });

  ipcMain.on("mini-lyrics:save-response", (_event, response) => {
    const requestId = response?.requestId;
    if (typeof requestId !== "string") {
      return;
    }
    const resolve = pendingMiniLyricsSaves.get(requestId);
    if (!resolve) {
      return;
    }
    pendingMiniLyricsSaves.delete(requestId);
    resolve({
      ok: Boolean(response.ok),
      error: typeof response.error === "string" ? response.error : undefined,
    });
  });

  // Relay: main window sends data to output window
  ipcMain.on('send-to-output', (_event, data) => {
    const outputWindow = getOutputWindow();
    if (outputWindow && !outputWindow.isDestroyed()) {
      outputWindow.webContents.send('output-data', data);
    }
  });

  // Relay: output window tells main window it's ready
  ipcMain.on('output-ready', () => {
    const mainWindow = getMainWindow();
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('output-ready');
    }
  });

  // Relay: main window sends data to media stage window
  ipcMain.on('send-to-stage', (_event, data) => {
    const stageWindow = getMediaStageWindow();
    if (stageWindow && !stageWindow.isDestroyed()) {
      stageWindow.webContents.send('stage-data', data);
    }
  });

  // Relay: stage window tells main window it's ready
  ipcMain.on('stage-ready', () => {
    const mainWindow = getMainWindow();
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('stage-ready');
    }
  });
};
