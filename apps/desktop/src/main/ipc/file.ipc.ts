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

  // Select media file dialog
  ipcMain.handle('select-media-file', async (event) => {
    const parentWindow = BrowserWindow.fromWebContents(event.sender) ?? getMainWindow() ?? undefined;
    const result = await dialog.showOpenDialog(parentWindow, {
      properties: ['openFile'],
      filters: [
        { name: 'Media Files', extensions: ['jpg', 'jpeg', 'png', 'gif', 'webp', 'mp4', 'webm', 'mov', 'avi', 'mkv', 'm4v'] },
        { name: 'Images', extensions: ['jpg', 'jpeg', 'png', 'gif', 'webp'] },
        { name: 'Videos', extensions: ['mp4', 'webm', 'mov', 'avi', 'mkv', 'm4v'] }
      ]
    });
    
    if (result.canceled || result.filePaths.length === 0) {
      return null;
    }
    
    const filePath = result.filePaths[0];
    return {
      name: path.basename(filePath),
      path: filePath
    };
  });

  ipcMain.handle('select-presentation-files', async (event) => {
    const parentWindow = BrowserWindow.fromWebContents(event.sender) ?? getMainWindow() ?? undefined;
    const result = await dialog.showOpenDialog(parentWindow, {
      properties: ['openFile', 'multiSelections'],
      filters: [
        { name: 'Presentation Files', extensions: ['pdf', 'pptx'] },
        { name: 'PDF Files', extensions: ['pdf'] },
        { name: 'PowerPoint Files', extensions: ['pptx'] },
      ],
    });

    if (result.canceled || result.filePaths.length === 0) {
      return null;
    }

    return Promise.all(
      result.filePaths.map(async (filePath) => {
        const [fileBuffer, stats] = await Promise.all([
          fs.promises.readFile(filePath),
          fs.promises.stat(filePath),
        ]);

        return {
          name: path.basename(filePath),
          path: filePath,
          bytes: new Uint8Array(fileBuffer),
          lastModified: stats.mtimeMs,
        };
      }),
    );
  });

  // Copy media file
  ipcMain.handle('copy-media-file', async (_, sourcePath: string, targetPath: string) => {
    try {
      // Ensure target directory exists (the folderId part)
      const targetDir = path.dirname(targetPath);
      if (!fs.existsSync(targetDir)) {
        await fs.promises.mkdir(targetDir, { recursive: true });
      }
      
      await fs.promises.copyFile(sourcePath, targetPath);
      return true;
    } catch (error) {
      console.error('Failed to copy media file', error);
      return false;
    }
  });

  // Create directory
  ipcMain.handle('create-directory', async (_, parentPath: string, name: string) => {
    try {
      const fullPath = path.join(parentPath, name);
      if (fs.existsSync(fullPath)) {
        // Find a unique name
        let counter = 1;
        let uniquePath = fullPath;
        while (fs.existsSync(uniquePath)) {
          uniquePath = `${fullPath} ${counter++}`;
        }
        await fs.promises.mkdir(uniquePath);
        return uniquePath;
      }
      await fs.promises.mkdir(fullPath);
      return fullPath;
    } catch (error) {
      console.error('Failed to create directory', error);
      throw error;
    }
  });

  // Rename directory/file
  ipcMain.handle('rename-directory', async (_, oldPath: string, newPath: string) => {
    try {
      if (fs.existsSync(newPath)) {
        throw new Error('Name already exists');
      }
      await fs.promises.rename(oldPath, newPath);
      return true;
    } catch (error) {
      console.error('Failed to rename directory', error);
      throw error;
    }
  });
};
