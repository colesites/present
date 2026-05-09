import { ipcMain, screen } from 'electron';
import { createOutputWindow, closeOutputWindow, getOutputWindow } from '../windows/output.window';
import { getMainWindow } from '../windows/main.window';
import {
  closeMediaStageWindow,
  createMediaStageWindow,
  getMediaStageWindow,
} from '../windows/media-stage.window';
import { closeLooksWindow, createLooksWindow } from '../windows/looks.window';
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
