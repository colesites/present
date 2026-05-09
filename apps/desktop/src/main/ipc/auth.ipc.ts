import { ipcMain, net, shell } from 'electron';
import { beginAuthFlow, consumePendingAuthToken } from '../services/auth.service';
import { getWebAppBaseUrlCandidates } from '../utils/app.utils';
import {
  clearStoredDesktopSession,
  loadStoredDesktopSession,
  saveStoredDesktopSession,
  type DesktopStoredSession,
} from '../services/session-storage.service';

async function refreshDesktopSessionViaWeb(
  sessionToken: string,
  maxRedirects = 5,
): Promise<unknown> {
  const baseUrls = getWebAppBaseUrlCandidates();
  let lastError: unknown = null;

  for (const baseUrl of baseUrls) {
    let currentUrl = new URL('/api/auth/desktop/refresh-session', baseUrl).toString();

    try {
      for (let i = 0; i <= maxRedirects; i += 1) {
        const response = await net.fetch(currentUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ sessionToken }),
        });

        if (response.status >= 300 && response.status < 400) {
          const location = response.headers.get('location');
          if (!location) {
            throw new Error(`Redirect without location header (${response.status})`);
          }
          currentUrl = new URL(location, currentUrl).toString();
          continue;
        }

        if (!response.ok) {
          const message = await response.text().catch(() => '');
          throw new Error(message || `Desktop refresh failed (${response.status})`);
        }

        return await response.json();
      }
    } catch (error) {
      lastError = error;
      continue;
    }
  }

  if (lastError instanceof Error) {
    throw lastError;
  }
  throw new Error('Too many redirects while refreshing desktop session');
}

/**
 * Register auth-related IPC handlers
 */
export const registerAuthIPC = (): void => {
  // Begin desktop auth flow
  ipcMain.handle('begin-auth-flow', async () => {
    return await beginAuthFlow();
  });

  // Consume pending auth token
  ipcMain.handle('consume-pending-auth-token', async () => {
    return consumePendingAuthToken();
  });

  ipcMain.handle('get-stored-auth-session', async () => {
    return await loadStoredDesktopSession();
  });

  ipcMain.handle('set-stored-auth-session', async (_, payload: DesktopStoredSession) => {
    return await saveStoredDesktopSession(payload);
  });

  ipcMain.handle('clear-stored-auth-session', async () => {
    return await clearStoredDesktopSession();
  });

  ipcMain.handle('refresh-desktop-session', async (_, sessionToken: string) => {
    try {
      if (typeof sessionToken !== 'string' || sessionToken.trim().length === 0) {
        throw new Error('Missing session token');
      }
      return await refreshDesktopSessionViaWeb(sessionToken);
    } catch (error) {
      console.error('[Desktop Auth] failed to refresh session via IPC', error);
      return null;
    }
  });

  // Open external browser
  ipcMain.handle('open-external-browser', async (_, urlToOpen: string) => {
    await shell.openExternal(urlToOpen);
    return true;
  });
};
