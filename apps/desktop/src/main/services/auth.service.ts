import { createServer, type Server as HttpServer } from 'http';
import { shell } from 'electron';
import { getWebAppBaseUrl } from '../utils/app.utils';

let pendingAuthToken: string | null = null;
let loopbackAuthServer: HttpServer | null = null;
let loopbackAuthTimeout: NodeJS.Timeout | null = null;

const DESKTOP_AUTH_TIMEOUT_MS = 5 * 60 * 1000;

/**
 * Get pending auth token and clear it
 */
export const consumePendingAuthToken = (): string | null => {
  const token = pendingAuthToken;
  pendingAuthToken = null;
  return token;
};

/**
 * Set pending auth token (used by deep link handler)
 */
export const setPendingAuthToken = (token: string): void => {
  pendingAuthToken = token;
};

/**
 * Build the desktop auth login URL
 */
export const buildDesktopAuthLoginUrl = (returnTo: string): string => {
  const nextPath = `/auth/desktop/callback?returnTo=${encodeURIComponent(returnTo)}`;
  const webBaseUrl = getWebAppBaseUrl();
  const signInUrl = new URL('/sign-in', webBaseUrl);
  signInUrl.searchParams.set('source', 'desktop');
  signInUrl.searchParams.set('client', 'electron');
  signInUrl.searchParams.set('flow', 'external-browser');
  signInUrl.searchParams.set('next', nextPath);
  return signInUrl.toString();
};

/**
 * Clear the loopback auth flow (server and timeout)
 */
export const clearLoopbackAuthFlow = (): void => {
  if (loopbackAuthTimeout) {
    clearTimeout(loopbackAuthTimeout);
    loopbackAuthTimeout = null;
  }

  if (loopbackAuthServer) {
    loopbackAuthServer.close();
    loopbackAuthServer = null;
  }
};

/**
 * Send auth token to renderer via deep link
 */
export const sendAuthTokenToRenderer = (token: string, handleDeepLink: (url: string) => void): void => {
  const deepLink = `present://auth-callback?token=${encodeURIComponent(token)}`;
  handleDeepLink(deepLink);
};

/**
 * Begin the desktop auth flow using loopback server
 */
export const beginAuthFlow = async (handleDeepLink: (url: string) => void): Promise<{ ok: boolean; error?: string }> => {
  clearLoopbackAuthFlow();

  return await new Promise<{ ok: boolean; error?: string }>((resolve) => {
    let hasResolved = false;
    const safeResolve = (value: { ok: boolean; error?: string }) => {
      if (hasResolved) {
        return;
      }
      hasResolved = true;
      resolve(value);
    };

    const server = createServer((req, res) => {
      const requestUrl = new URL(req.url ?? '/', `http://${req.headers.host ?? '127.0.0.1'}`);

      if (requestUrl.pathname !== '/callback') {
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('Not Found');
        return;
      }

      const token = requestUrl.searchParams.get('token');
      if (!token) {
        res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('Missing token');
        return;
      }

      res.writeHead(200, {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'no-store',
      });
      res.end(
        '<!doctype html><html><body style="font-family:system-ui;padding:24px;">Sign-in complete. You can close this tab and return to Present.</body></html>',
        () => {
          sendAuthTokenToRenderer(token, handleDeepLink);
          clearLoopbackAuthFlow();
        },
      );
    });

    loopbackAuthServer = server;
    server.once('error', (error) => {
      console.error('Failed to start loopback auth server:', error);
      clearLoopbackAuthFlow();
      safeResolve({ ok: false, error: 'Unable to start local callback server.' });
    });

    server.listen(0, '127.0.0.1', async () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        clearLoopbackAuthFlow();
        safeResolve({ ok: false, error: 'Unable to allocate callback port.' });
        return;
      }

      const returnTo = `http://127.0.0.1:${address.port}/callback`;
      const authUrl = buildDesktopAuthLoginUrl(returnTo);
      loopbackAuthTimeout = setTimeout(() => {
        clearLoopbackAuthFlow();
      }, DESKTOP_AUTH_TIMEOUT_MS);

      try {
        await shell.openExternal(authUrl);
        safeResolve({ ok: true });
      } catch (error) {
        console.error('Failed to open auth URL in browser:', error);
        clearLoopbackAuthFlow();
        safeResolve({ ok: false, error: 'Unable to open the browser for sign-in.' });
      }
    });
  });
};
