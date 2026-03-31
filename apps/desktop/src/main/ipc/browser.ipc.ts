import { ipcMain } from 'electron';
import {
  browserBack,
  browserForward,
  browserReload,
  getBrowserState,
  navigateBrowserTo,
  setBrowserBounds,
  setBrowserMode,
  setBrowserProjection,
} from '../services/browser-view.service';

export const registerBrowserIPC = (): void => {
  ipcMain.handle('browser-mode:set-enabled', (_event, enabled: boolean) => {
    return setBrowserMode(Boolean(enabled));
  });

  ipcMain.handle(
    'browser-mode:set-bounds',
    (_event, bounds: { x: number; y: number; width: number; height: number }) => {
      return setBrowserBounds(bounds);
    },
  );

  ipcMain.handle('browser-mode:navigate', async (_event, input: string) => {
    return navigateBrowserTo(input);
  });

  ipcMain.handle('browser-mode:back', () => {
    return browserBack();
  });

  ipcMain.handle('browser-mode:forward', () => {
    return browserForward();
  });

  ipcMain.handle('browser-mode:reload', () => {
    return browserReload();
  });

  ipcMain.handle('browser-mode:set-projection', (_event, target: 'preview' | 'main-output') => {
    return setBrowserProjection(target);
  });

  ipcMain.handle('browser-mode:get-state', () => {
    return getBrowserState();
  });
};
