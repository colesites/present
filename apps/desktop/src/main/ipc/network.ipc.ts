import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { app, ipcMain, net, session } from 'electron';
import * as dotenv from 'dotenv';
import { getWebAppBaseUrl, getWebAppBaseUrlCandidates } from '../utils/app.utils';
import { browserSuggestionsUrl } from '../lib/browser-mode.mjs';

interface AssemblyAiTokenPayload {
  token: string;
  expiresInSeconds?: number;
  sessionId?: string | null;
  allowedDurationSeconds?: number;
}

interface HttpStatusError extends Error {
  status?: number;
}

// Helper to get a realistic User-Agent for requests
const getRealisticUserAgent = () => {
  try {
    return session.defaultSession.getUserAgent();
  } catch {
    return 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
  }
};

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

async function fetchAssemblyAiToken(
  sessionToken: string,
  source: "bible" | "library",
  maxRedirects = 5,
): Promise<unknown> {
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
            'Content-Type': 'application/json',
            'Origin': baseUrl,
            'User-Agent': getRealisticUserAgent(),
          },
          body: JSON.stringify({ source }),
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
          console.error(`[AssemblyAI Fetch] Request to ${currentUrl} failed: ${response.status} ${message}`);
          const err: HttpStatusError = new Error(message || `Request failed (${response.status})`);
          err.status = response.status;
          throw err;
        }

        return await response.json();
      }
    } catch (error) {
      console.error(`[AssemblyAI Fetch] Error fetching from ${baseUrl}:`, error);
      lastError = error;
      
      // If the server actually responded (e.g. 401, 500), do NOT fall back to the next URL!
      if (error && typeof error === 'object' && 'status' in error) {
        throw error;
      }
      
      continue;
    }
  }

  if (lastError instanceof Error) {
    throw lastError;
  }
  throw new Error('Too many redirects');
}

const getDevelopmentAssemblyAiApiKey = (): string | null => {
  if (app.isPackaged) {
    return null;
  }

  const configured = process.env.ASSEMBLYAI_API_KEY?.trim();
  if (configured) {
    return configured;
  }

  const candidates = [
    path.resolve(process.cwd(), 'apps/web/.env.local'),
    path.resolve(process.cwd(), '../web/.env.local'),
    path.resolve(process.cwd(), 'apps/web/.env.production'),
    path.resolve(process.cwd(), '../web/.env.production'),
  ];

  for (const filePath of candidates) {
    if (!existsSync(filePath)) {
      continue;
    }

    try {
      const parsed = dotenv.parse(readFileSync(filePath));
      const apiKey = parsed.ASSEMBLYAI_API_KEY?.trim();
      if (apiKey) {
        console.info('[AssemblyAI Fetch] Using development AssemblyAI key fallback', {
          envFile: filePath,
        });
        return apiKey;
      }
    } catch (error) {
      console.warn('[AssemblyAI Fetch] Failed to read development env fallback', {
        filePath,
        error,
      });
    }
  }

  return null;
};

const fetchDirectAssemblyAiToken = async (): Promise<AssemblyAiTokenPayload | null> => {
  const apiKey = getDevelopmentAssemblyAiApiKey();
  if (!apiKey) {
    console.warn(
      '[AssemblyAI Fetch] Development direct token fallback unavailable: ASSEMBLYAI_API_KEY was not found in desktop env or apps/web env files.',
    );
    return null;
  }

  const maxSessionDurationSeconds = 15 * 60;
  const tokenUrl = new URL('https://streaming.assemblyai.com/v3/token');
  tokenUrl.searchParams.set('expires_in_seconds', '300');
  tokenUrl.searchParams.set(
    'max_session_duration_seconds',
    String(maxSessionDurationSeconds),
  );

  const response = await net.fetch(tokenUrl.toString(), {
    method: 'GET',
    headers: {
      Authorization: apiKey,
    },
    cache: 'no-store',
  });

  const payload = (await response.json().catch((): null => null)) as
    | { token?: string; expires_in_seconds?: number; error?: string; message?: string }
    | null;

  if (!response.ok || !payload?.token) {
    throw new Error(
      payload?.error ??
        payload?.message ??
        `Direct AssemblyAI token request failed (${response.status})`,
    );
  }

  return {
    token: payload.token,
    expiresInSeconds: payload.expires_in_seconds ?? 300,
    sessionId: null,
    allowedDurationSeconds: maxSessionDurationSeconds,
  };
};

async function fetchBrowserSuggestions(url: string, maxRedirects = 5): Promise<unknown> {
  let currentUrl = url;

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

  ipcMain.handle(
    'request-assemblyai-token',
    async (_, sessionToken: string, source: "bible" | "library" = "bible") => {
    try {
      if (typeof sessionToken !== 'string' || sessionToken.trim().length === 0) {
        throw new Error('Missing session token');
      }

      return await fetchAssemblyAiToken(sessionToken, source);
    } catch (error) {
      console.error('Failed to request AssemblyAI token', error);
      try {
        const directToken = await fetchDirectAssemblyAiToken();
        if (directToken) {
          return directToken;
        }
      } catch (fallbackError) {
        console.error('Failed to request direct AssemblyAI token fallback', fallbackError);
      }
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
      const url = browserSuggestionsUrl(getWebAppBaseUrl(), query);
      if (!url) {
        return { suggestions: [] };
      }

      return await fetchBrowserSuggestions(url);
    } catch (error) {
      console.error('Failed to fetch browser suggestions', error);
      return { suggestions: [] };
    }
  });
};
