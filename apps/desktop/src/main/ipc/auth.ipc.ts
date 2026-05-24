import { ipcMain, net, shell } from 'electron';
import { beginAuthFlow, consumePendingAuthToken } from '../services/auth.service';
import { getWebAppBaseUrlCandidates } from '../utils/app.utils';
import {
  clearStoredDesktopSession,
  loadStoredDesktopSession,
  saveStoredDesktopSession,
  type DesktopStoredSession,
} from '../services/session-storage.service';

type DesktopRefreshOutcome =
  | { ok: true; data: unknown }
  | { ok: false; status: number; error: string };

class DesktopRefreshHttpError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

async function refreshDesktopSessionViaWeb(
  sessionToken: string,
  maxRedirects = 5,
): Promise<DesktopRefreshOutcome> {
  const baseUrls = getWebAppBaseUrlCandidates();
  let lastError: unknown = null;
  let lastHttpStatus = 0;

  for (const baseUrl of baseUrls) {
    let currentUrl = new URL('/api/auth/desktop/refresh-session', baseUrl).toString();

    try {
      for (let i = 0; i <= maxRedirects; i += 1) {
        const response = await net.fetch(currentUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sessionToken }),
        });

        if (response.status >= 300 && response.status < 400) {
          const location = response.headers.get('location');
          if (!location) {
            throw new DesktopRefreshHttpError(
              `Redirect without location header (${response.status})`,
              response.status,
            );
          }
          currentUrl = new URL(location, currentUrl).toString();
          continue;
        }

        if (!response.ok) {
          const message = await response.text().catch(() => '');
          // 4xx is a definitive server response — don't retry other base URLs.
          if (response.status >= 400 && response.status < 500) {
            return {
              ok: false,
              status: response.status,
              error: message || `Desktop refresh failed (${response.status})`,
            };
          }
          throw new DesktopRefreshHttpError(
            message || `Desktop refresh failed (${response.status})`,
            response.status,
          );
        }

        return { ok: true, data: await response.json() };
      }
    } catch (error) {
      lastError = error;
      if (error instanceof DesktopRefreshHttpError) {
        lastHttpStatus = error.status;
      }
      continue;
    }
  }

  const message =
    lastError instanceof Error ? lastError.message : 'Network error refreshing desktop session';
  return { ok: false, status: lastHttpStatus || 0, error: message };
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
    if (typeof sessionToken !== 'string' || sessionToken.trim().length === 0) {
      return { ok: false, status: 400, error: 'Missing session token' };
    }
    try {
      return await refreshDesktopSessionViaWeb(sessionToken);
    } catch (error) {
      console.error('[Desktop Auth] failed to refresh session via IPC', error);
      const message = error instanceof Error ? error.message : 'Network error';
      return { ok: false, status: 0, error: message };
    }
  });

  // Open external browser
  ipcMain.handle('open-external-browser', async (_, urlToOpen: string) => {
    await shell.openExternal(urlToOpen);
    return true;
  });
};
