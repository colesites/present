import { ipcMain } from 'electron';
import fs from 'fs';
import path from 'path';
import {
  discoverBundledBibles,
  getExistingBundledBibleRoots,
  SUPPORTED_BIBLE_EXTENSIONS,
} from '../../features/bible/bible.service';
import { isPathWithinRoot } from '../utils/app.utils';

/**
 * Register Bible-related IPC handlers
 */
export const registerBibleIPC = (): void => {
  // List bundled Bibles
  ipcMain.handle('list-bundled-bibles', async () => {
    try {
      return await discoverBundledBibles();
    } catch (error) {
      console.error('Failed to list bundled bibles', error);
      return [];
    }
  });

  // Read bundled Bible file
  ipcMain.handle('read-bundled-bible', async (_, filePath: string) => {
    try {
      if (typeof filePath !== 'string' || filePath.trim().length === 0) {
        throw new Error('Missing file path');
      }

      const requestedPath = path.resolve(filePath);
      const extension = path.extname(requestedPath).toLowerCase();
      
      if (!SUPPORTED_BIBLE_EXTENSIONS.has(extension)) {
        throw new Error('Unsupported bible file type');
      }

      const roots = await getExistingBundledBibleRoots();
      if (roots.length === 0) {
        throw new Error('No bundled bible directory found');
      }

      const realRequestedPath = await fs.promises.realpath(requestedPath);
      const isAllowed = roots.some((root) => isPathWithinRoot(realRequestedPath, root));
      
      if (!isAllowed) {
        throw new Error('File path is outside bundled bible directories');
      }

      const fileBuffer = await fs.promises.readFile(realRequestedPath);
      return new Uint8Array(fileBuffer);
    } catch (error) {
      console.error('Failed to read bundled bible', error);
      return null;
    }
  });
};
