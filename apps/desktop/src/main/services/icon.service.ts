import fs from 'fs';
import path from 'path';
import { app, nativeImage, type NativeImage } from 'electron';

const findExistingPath = (candidates: string[]): string | null => {
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  return null;
};

export const getDesktopAppIconPath = (): string | null => {
  return findExistingPath([
    path.resolve(process.cwd(), 'apps/desktop/assets/icons/present.png'),
    path.resolve(process.resourcesPath, 'icons/present.png'),
    path.resolve(app.getAppPath(), 'assets/icons/present.png'),
  ]);
};

export const getDesktopAppIcon = (): NativeImage | undefined => {
  const iconPath = getDesktopAppIconPath();
  if (!iconPath) {
    return undefined;
  }

  const icon = nativeImage.createFromPath(iconPath);
  return icon.isEmpty() ? undefined : icon;
};

export const applyDesktopDockIcon = (): void => {
  if (process.platform !== 'darwin' || !app.dock) {
    return;
  }

  const icon = getDesktopAppIcon();
  if (icon) {
    app.dock.setIcon(icon);
  }
};
