import path from 'path';
import fs from 'fs';
import { app } from 'electron';
import {
  SUPPORTED_BIBLE_EXTENSIONS,
  bundledBibleId,
  formatBibleName,
  inferBibleCodeFromName,
  orderBundledBibles,
} from '../../shared/lib/bible-catalog.mjs';

export { SUPPORTED_BIBLE_EXTENSIONS };

const resolveBundledBibleDirectories = (): string[] => {
  const candidates = new Set<string>([
    path.join(process.resourcesPath, 'bible'),
    path.join(app.getAppPath(), 'bible'),
    path.resolve(process.cwd(), 'apps/desktop/bible'),
    path.resolve(process.cwd(), 'bible'),
  ]);
  return Array.from(candidates);
};

const getExistingBundledBibleRoots = async (): Promise<string[]> => {
  const roots: string[] = [];
  for (const directory of resolveBundledBibleDirectories()) {
    try {
      const stats = await fs.promises.stat(directory);
      if (!stats.isDirectory()) {
        continue;
      }
      roots.push(await fs.promises.realpath(directory));
    } catch {
      // ignore missing candidate roots
    }
  }
  return roots;
};

const discoverBundledBibles = async (): Promise<BundledBibleFile[]> => {
  const discovered = new Map<string, BundledBibleFile>();

  for (const directory of resolveBundledBibleDirectories()) {
    try {
      const stats = await fs.promises.stat(directory);
      if (!stats.isDirectory()) {
        continue;
      }

      const entries = await fs.promises.readdir(directory, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isFile()) {
          continue;
        }

        const ext = path.extname(entry.name).toLowerCase();
        if (!SUPPORTED_BIBLE_EXTENSIONS.has(ext)) {
          continue;
        }

        const fullPath = path.resolve(directory, entry.name);
        const fileStats = await fs.promises.stat(fullPath);
        const fileNameBase = path.basename(entry.name, ext);
        const code = inferBibleCodeFromName(fileNameBase);
        const name = formatBibleName(fileNameBase);

        discovered.set(fullPath, {
          id: bundledBibleId(code, fileStats.size, fileStats.mtimeMs),
          code,
          name,
          filePath: fullPath,
          sizeBytes: fileStats.size,
        });
      }
    } catch {
      // ignore missing directories
    }
  }

  return orderBundledBibles(Array.from(discovered.values()));
};

export { getExistingBundledBibleRoots, discoverBundledBibles };