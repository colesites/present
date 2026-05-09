import { shell } from 'electron';
import { getWebAppBaseUrl } from '../utils/app.utils';

export type DesktopAuthPayload = {
  accessToken?: string | null;
  sessionToken: string;
};

let pendingAuthPayload: DesktopAuthPayload | null = null;

/**
 * Get pending auth token and clear it
 */
export const consumePendingAuthToken = (): DesktopAuthPayload | null => {
  const payload = pendingAuthPayload;
  pendingAuthPayload = null;
  return payload;
};

/**
 * Set pending auth token (used by deep link handler)
 */
export const setPendingAuthToken = (payload: DesktopAuthPayload): void => {
  pendingAuthPayload = payload;
  console.info('[Desktop Auth] token received in main process', {
    hasAccessToken: Boolean(payload.accessToken),
    sessionTokenLength: payload.sessionToken.length,
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
export const sendAuthTokenToRenderer = (
  payload: DesktopAuthPayload,
  handleDeepLink: (url: string) => void,
): void => {
  const deepLink = `present://auth?sessionToken=${encodeURIComponent(payload.sessionToken)}${
    payload.accessToken ? `&accessToken=${encodeURIComponent(payload.accessToken)}` : ''
  }`;
  handleDeepLink(deepLink);
};

/**
 * Begin the desktop auth flow using loopback server
 */
export const beginAuthFlow = async (): Promise<{ ok: boolean; error?: string }> => {
  try {
    const authUrl = buildDesktopAuthLoginUrl();
    await shell.openExternal(authUrl);
    return { ok: true };
  } catch (error) {
    console.error('Failed to open auth URL in browser:', error);
    return { ok: false, error: 'Unable to open the browser for sign-in.' };
  }
};
