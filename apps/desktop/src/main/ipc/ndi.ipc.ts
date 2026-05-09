import { ipcMain } from 'electron';
import { startNdiOutput, stopNdiOutput, getNdiStatus } from '../services/ndi.service';

/**
 * Register NDI-related IPC handlers
 */
export const registerNdiIPC = (): void => {
  ipcMain.handle('ndi:start', async (_event, payload: { sourceName: string; groupName: string }) => {
    return startNdiOutput(payload.sourceName, payload.groupName);
  });

  ipcMain.handle('ndi:stop', async () => {
    await stopNdiOutput();
  });

  ipcMain.handle('ndi:status', () => {
    return getNdiStatus();
  });
};
