import { ipcMain, dialog, BrowserWindow } from 'electron';
import fs from 'fs';
import path from 'path';
import { getMainWindow } from '../windows/main.window';

/**
 * Register file-related IPC handlers
 */
export const registerFileIPC = (): void => {
  // Select folder dialog
  ipcMain.handle('select-folder', async (event) => {
    const parentWindow = BrowserWindow.fromWebContents(event.sender) ?? getMainWindow() ?? undefined;
    const result = await dialog.showOpenDialog(parentWindow, {
      properties: ['openDirectory'],
    });
    
    if (result.canceled || result.filePaths.length === 0) {
      return null;
    }
    
    const folderPath = result.filePaths[0];
    return {
      id: `folder-${Date.now()}`,
      name: path.basename(folderPath),
      path: folderPath,
    };
  });

  // Read folder contents
  ipcMain.handle('read-folder', async (_, folderPath: string) => {
    try {
      const files = await fs.promises.readdir(folderPath, { withFileTypes: true });
      const filesWithStats = await Promise.all(
        files
          .filter(f => f.isFile())
          .map(async f => {
            const stats = await fs.promises.stat(path.join(folderPath, f.name));
            return { 
              name: f.name,
              lastModified: stats.mtimeMs
            };
          })
      );
      return filesWithStats;
    } catch (error) {
      console.error('Failed to read folder', error);
      return [];
    }
  });
};
