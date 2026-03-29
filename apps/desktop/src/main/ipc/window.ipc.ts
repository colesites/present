import { ipcMain, screen } from 'electron';
import { createOutputWindow, closeOutputWindow, getOutputWindow } from '../windows/output.window';
import { getMainWindow } from '../windows/main.window';

/**
 * Register window-related IPC handlers
 */
export const registerWindowIPC = (): void => {
  // Get all displays
  ipcMain.handle('get-displays', () => {
    return screen.getAllDisplays().map(d => ({
      id: d.id,
      bounds: d.bounds,
      workArea: d.workArea,
      scaleFactor: d.scaleFactor,
      isPrimary: d.id === screen.getPrimaryDisplay().id
    }));
  });

  // Open output window
  ipcMain.handle('open-output-window', () => {
    const mainWindow = getMainWindow();
    return createOutputWindow(mainWindow);
  });

  // Close output window
  ipcMain.handle('close-output-window', () => {
    return closeOutputWindow();
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
};
