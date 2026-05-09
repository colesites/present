import { ipcMain, net } from 'electron';
import { getWebAppBaseUrl, getWebAppBaseUrlCandidates } from '../utils/app.utils';

/**
 * Fetch JSON following redirects
 */
async function fetchJsonFollowingRedirects(url: string, maxRedirects = 5): Promise<unknown> {
  let currentUrl = url;
  for (let i = 0; i <= maxRedirects; i += 1) {
    const response = await net.fetch(currentUrl, { cache: 'no-store' });
    
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('location');
      if (!location) {
        throw new Error(`Redirect without location header (${response.status})`);
      }
      currentUrl = new URL(location, currentUrl).toString();
      continue;
    }
    
    if (!response.ok) {
      throw new Error(`Request failed (${response.status})`);
    }
    
    return await response.json();
  }
  throw new Error('Too many redirects');
}

async function fetchAssemblyAiToken(sessionToken: string, maxRedirects = 5): Promise<unknown> {
  const baseUrls = getWebAppBaseUrlCandidates();
  let lastError: unknown = null;

  for (const baseUrl of baseUrls) {
    let currentUrl = new URL('/api/assemblyai/token', baseUrl).toString();

    try {
      for (let i = 0; i <= maxRedirects; i += 1) {
        const response = await net.fetch(currentUrl, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${sessionToken}`,
          },
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
          throw new Error(message || `Request failed (${response.status})`);
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
  throw new Error('Too many redirects');
}

async function fetchBrowserSuggestions(query: string, maxRedirects = 5): Promise<unknown> {
  let currentUrl = new URL('/api/browser/suggestions', getWebAppBaseUrl()).toString();
  currentUrl = `${currentUrl}?q=${encodeURIComponent(query)}`;

  for (let i = 0; i <= maxRedirects; i += 1) {
    const response = await net.fetch(currentUrl, {
      cache: 'no-store',
      headers: {
        Accept: 'application/json',
      },
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
      throw new Error(message || `Request failed (${response.status})`);
    }

    return await response.json();
  }

  throw new Error('Too many redirects');
}

/**
 * Register network-related IPC handlers
 */
export const registerNetworkIPC = (): void => {
  // Fetch hosted Bible catalog
  ipcMain.handle('fetch-hosted-bible-catalog', async (_, catalogUrl: string) => {
    try {
      if (typeof catalogUrl !== 'string' || catalogUrl.trim().length === 0) {
        throw new Error('Missing catalog URL');
      }
      return await fetchJsonFollowingRedirects(catalogUrl);
    } catch (error) {
      console.error('Failed to fetch hosted bible catalog', error);
      return null;
    }
  });

  ipcMain.handle('request-assemblyai-token', async (_, sessionToken: string) => {
    try {
      if (typeof sessionToken !== 'string' || sessionToken.trim().length === 0) {
        throw new Error('Missing session token');
      }

      return await fetchAssemblyAiToken(sessionToken);
    } catch (error) {
      console.error('Failed to request AssemblyAI token', error);
      return {
        error:
          error instanceof Error
            ? error.message
            : 'Failed to request AssemblyAI token',
      };
    }
  });

  ipcMain.handle('fetch-browser-suggestions', async (_, query: string) => {
    try {
      if (typeof query !== 'string' || query.trim().length === 0) {
        return { suggestions: [] };
      }

      return await fetchBrowserSuggestions(query.trim());
    } catch (error) {
      console.error('Failed to fetch browser suggestions', error);
      return { suggestions: [] };
    }
  });
};
