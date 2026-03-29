import { ipcMain, shell } from 'electron';
import { beginAuthFlow, consumePendingAuthToken } from '../services/auth.service';
import { handleDeepLink } from '../windows/main.window';

/**
 * Register auth-related IPC handlers
 */
export const registerAuthIPC = (): void => {
  // Begin desktop auth flow
  ipcMain.handle('begin-auth-flow', async () => {
    return await beginAuthFlow(handleDeepLink);
  });

  // Consume pending auth token
  ipcMain.handle('consume-pending-auth-token', async () => {
    return consumePendingAuthToken();
  });

  // Open external browser
  ipcMain.handle('open-external-browser', async (_, urlToOpen: string) => {
    await shell.openExternal(urlToOpen);
    return true;
  });
};
