import { ipcMain, dialog, BrowserWindow } from 'electron';
import fs from 'fs';
import path from 'path';
import { getMainWindow } from '../windows/main.window';

type LibraryBundleExportItem = {
  title: string;
  body: string;
  categoryName?: string | null;
  author?: string | null;
  artist?: string | null;
  type?: "song" | "scripture" | "slide" | "note" | null;
  content?: unknown;
  slides?: unknown[];
  createdAt?: number;
  updatedAt?: number;
};

type LibraryBundleManifest = {
  version: 1;
  exportedAt: string;
  itemCount: number;
  categories: string[];
  itemsDirectory: string;
};

const sanitizePathSegment = (value: string) => {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

  return normalized || 'item';
};

const ensureUniqueDirectory = async (parentPath: string, baseName: string) => {
  let attempt = 0;
  while (true) {
    const suffix = attempt === 0 ? '' : `-${attempt + 1}`;
    const candidate = path.join(parentPath, `${baseName}${suffix}`);
    try {
      await fs.promises.mkdir(candidate, { recursive: false });
      return candidate;
    } catch (error) {
      const nodeError = error as NodeJS.ErrnoException;
      if (nodeError.code === 'EEXIST') {
        attempt += 1;
        continue;
      }
      throw error;
    }
  }
};

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

  ipcMain.handle('select-library-export-destination', async (event, suggestedName?: string) => {
    const parentWindow = BrowserWindow.fromWebContents(event.sender) ?? getMainWindow() ?? undefined;
    const result = await dialog.showSaveDialog(parentWindow, {
      title: 'Export Libraries',
      buttonLabel: 'Create Export Folder',
      defaultPath: sanitizePathSegment(
        suggestedName || `present-library-export-${new Date().toISOString().slice(0, 10)}`,
      ),
      showsTagField: false,
      properties: ['createDirectory', 'showOverwriteConfirmation'],
    });

    if (result.canceled || !result.filePath) {
      return null;
    }

    return result.filePath;
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

  ipcMain.handle(
    'export-library-bundle',
    async (
      _,
      destinationPath: string,
      items: LibraryBundleExportItem[],
    ) => {
      try {
        if (!destinationPath || !Array.isArray(items) || items.length === 0) {
          throw new Error('Nothing to export');
        }

        const rootParentDirectory = path.dirname(destinationPath);
        await fs.promises.mkdir(rootParentDirectory, { recursive: true });
        const rootDirectory = await ensureUniqueDirectory(
          rootParentDirectory,
          path.basename(destinationPath),
        );
        const itemsDirectory = path.join(rootDirectory, 'items');
        await fs.promises.mkdir(itemsDirectory, { recursive: true });

        const categories = Array.from(
          new Set(
            items
              .map((item) => item.categoryName?.trim())
              .filter((value): value is string => Boolean(value)),
          ),
        ).sort((left, right) => left.localeCompare(right));

        const manifest: LibraryBundleManifest = {
          version: 1,
          exportedAt: new Date().toISOString(),
          itemCount: items.length,
          categories,
          itemsDirectory: 'items',
        };

        await Promise.all(
          items.map(async (item, index) => {
            const itemDirectory = await ensureUniqueDirectory(
              itemsDirectory,
              `${String(index + 1).padStart(3, '0')}-${sanitizePathSegment(item.title || 'untitled')}`,
            );

            const itemMetadata = {
              version: 1,
              title: item.title,
              categoryName: item.categoryName ?? null,
              author: item.author ?? null,
              artist: item.artist ?? null,
              type: item.type ?? 'song',
              content: item.content ?? null,
              slides: item.slides ?? [],
              createdAt: item.createdAt ?? null,
              updatedAt: item.updatedAt ?? null,
              bodyFile: 'body.txt',
            };

            await Promise.all([
              fs.promises.writeFile(
                path.join(itemDirectory, 'item.json'),
                `${JSON.stringify(itemMetadata, null, 2)}\n`,
                'utf8',
              ),
              fs.promises.writeFile(
                path.join(itemDirectory, 'body.txt'),
                item.body ?? '',
                'utf8',
              ),
            ]);
          }),
        );

        await fs.promises.writeFile(
          path.join(rootDirectory, 'manifest.json'),
          `${JSON.stringify(manifest, null, 2)}\n`,
          'utf8',
        );

        return {
          path: rootDirectory,
          itemCount: items.length,
        };
      } catch (error) {
        console.error('Failed to export library bundle', error);
        throw error;
      }
    },
  );

  ipcMain.handle('import-library-bundle', async (_, folderPath: string) => {
    try {
      if (!folderPath) {
        throw new Error('Missing import folder');
      }

      const manifestPath = path.join(folderPath, 'manifest.json');
      const itemsRoot = path.join(folderPath, 'items');
      const hasManifest = fs.existsSync(manifestPath);
      const bundleRoot = hasManifest ? itemsRoot : folderPath;

      if (!fs.existsSync(bundleRoot)) {
        throw new Error('This folder does not contain an exported library bundle.');
      }

      const directoryEntries = await fs.promises.readdir(bundleRoot, { withFileTypes: true });
      const itemDirectories = directoryEntries
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name)
        .sort((left, right) => left.localeCompare(right));

      const items = await Promise.all(
        itemDirectories.map(async (directoryName) => {
          const itemDirectory = path.join(bundleRoot, directoryName);
          const metadataPath = path.join(itemDirectory, 'item.json');
          if (!fs.existsSync(metadataPath)) {
            return null;
          }

          const metadataRaw = await fs.promises.readFile(metadataPath, 'utf8');
          const metadata = JSON.parse(metadataRaw) as {
            title?: string;
            categoryName?: string | null;
            author?: string | null;
            artist?: string | null;
            type?: "song" | "scripture" | "slide" | "note" | null;
            content?: unknown;
            slides?: unknown[];
            createdAt?: number | null;
            updatedAt?: number | null;
            bodyFile?: string | null;
          };
          const bodyFileName = metadata.bodyFile?.trim() || 'body.txt';
          const bodyPath = path.join(itemDirectory, bodyFileName);
          const body = fs.existsSync(bodyPath)
            ? await fs.promises.readFile(bodyPath, 'utf8')
            : '';

          return {
            title: metadata.title ?? '',
            body,
            categoryName: metadata.categoryName ?? null,
            author: metadata.author ?? null,
            artist: metadata.artist ?? null,
            type: metadata.type ?? 'song',
            content: metadata.content ?? null,
            slides: Array.isArray(metadata.slides) ? metadata.slides : [],
            createdAt: typeof metadata.createdAt === 'number' ? metadata.createdAt : null,
            updatedAt: typeof metadata.updatedAt === 'number' ? metadata.updatedAt : null,
          };
        }),
      );

      return {
        path: folderPath,
        itemCount: items.filter(Boolean).length,
        items: items.filter((item): item is NonNullable<typeof item> => Boolean(item)),
      };
    } catch (error) {
      console.error('Failed to import library bundle', error);
      throw error;
    }
  });
};
