import { ipcMain } from 'electron';
import {
  getNdiStatus,
  listNdiSources,
  startNdiInput,
  startNdiOutput,
  stopNdiInput,
  stopNdiOutput,
} from '../services/ndi.service';

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

  ipcMain.handle('ndi:status', async () => {
    return getNdiStatus();
  });

  ipcMain.handle('ndi:list-sources', async (_event, payload?: { groupName?: string }) => {
    return listNdiSources({ groupName: payload?.groupName });
  });

  ipcMain.handle('ndi:start-input', async (_event, payload: { sourceName: string; groupName?: string }) => {
    return startNdiInput(payload.sourceName, { groupName: payload.groupName });
  });

  ipcMain.handle('ndi:stop-input', async () => {
    await stopNdiInput();
  });
};
