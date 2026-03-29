import { shell } from 'electron';
import { getWebAppBaseUrl } from '../utils/app.utils';

let pendingAuthToken: string | null = null;

/**
 * Get pending auth token and clear it
 */
export const consumePendingAuthToken = (): string | null => {
  const token = pendingAuthToken;
  pendingAuthToken = null;
  console.info('[Desktop Auth] token consumed in main process', {
    hasToken: Boolean(token),
    tokenLength: token?.length ?? 0,
  });
  return token;
};

/**
 * Set pending auth token (used by deep link handler)
 */
export const setPendingAuthToken = (token: string): void => {
  pendingAuthToken = token;
  console.info('[Desktop Auth] token received in main process', {
    tokenLength: token.length,
  });
};

/**
 * Build the desktop auth login URL
 */
export const buildDesktopAuthLoginUrl = (): string => {
  const nextPath = '/auth/desktop/callback';
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
  return;
};

/**
 * Send auth token to renderer via deep link
 */
export const sendAuthTokenToRenderer = (token: string, handleDeepLink: (url: string) => void): void => {
  const deepLink = `present://auth?token=${encodeURIComponent(token)}`;
  handleDeepLink(deepLink);
};

/**
 * Begin the desktop auth flow using loopback server
 */
export const beginAuthFlow = async (_handleDeepLink: (url: string) => void): Promise<{ ok: boolean; error?: string }> => {
  try {
    const authUrl = buildDesktopAuthLoginUrl();
    await shell.openExternal(authUrl);
    return { ok: true };
  } catch (error) {
    console.error('Failed to open auth URL in browser:', error);
    return { ok: false, error: 'Unable to open the browser for sign-in.' };
  }
};
