import { app, BrowserWindow } from 'electron';
import path from 'path';
import { isDev } from '../utils/app.utils';
import { setPendingAuthToken } from '../services/auth.service';

// Webpack entry points (declared globally by Forge)
declare const MAIN_WINDOW_WEBPACK_ENTRY: string;
declare const MAIN_WINDOW_PRELOAD_WEBPACK_ENTRY: string;

let mainWindow: BrowserWindow | null = null;
let pendingDeepLink: string | null = null;
let pendingAuthToken: string | null = null;

/**
 * Get the main window instance
 */
export const getMainWindow = (): BrowserWindow | null => mainWindow;

/**
 * Handle deep link navigation
 */
export const handleDeepLink = (urlStr: string): void => {
  pendingDeepLink = urlStr;

  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    if (!mainWindow.isVisible()) mainWindow.show();
    mainWindow.focus();
  }

  try {
    const parsedUrl = new URL(urlStr);
    const route = parsedUrl.host || parsedUrl.pathname.replace(/^\/+/, '');

    if (route === 'open' || route === '') {
      pendingDeepLink = null;
      return;
    }

    // Auth callback: the URL contains the session token
    if (parsedUrl.pathname.includes('auth-callback') || parsedUrl.host === 'auth-callback') { 
      const token = parsedUrl.searchParams.get('token');
      if (token) {
        pendingAuthToken = token;
        setPendingAuthToken(token);
      }
      if (token && mainWindow) {
        if (mainWindow.webContents.isLoading()) {
          pendingDeepLink = urlStr;
          return;
        }
        mainWindow.webContents.send('auth-callback', token);
        pendingDeepLink = null;
      }
    }
  } catch (e) {
    console.error('Failed to parse deep link:', e);
  }
};

/**
 * Get the main renderer URL (dev or prod)
 */
const getMainRendererUrl = (windowType?: 'settings'): string => {
  let baseUrl: string;
  
  if (isDev()) {
    // In development, use the webpack dev server URL
    baseUrl = MAIN_WINDOW_WEBPACK_ENTRY;
    console.log('[Main Window] Dev mode - webpack entry:', baseUrl);
  } else {
    // In production, use the app:// protocol
    baseUrl = 'app://app/main_window';
    console.log('[Main Window] Production mode - using app:// protocol');
  }
  
  if (!windowType) {
    return baseUrl;
  }

  const url = new URL(baseUrl);
  url.searchParams.set('window', windowType);
  return url.toString();
};

/**
 * Create the main application window
 */
export const createMainWindow = (settingsWindow?: BrowserWindow | null): void => {
  // Don't create multiple main windows
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.focus();
    return;
  }

  mainWindow = new BrowserWindow({
    height: 980,
    width: 1560,
    minWidth: 1180,
    minHeight: 760,
    webPreferences: {
      preload: MAIN_WINDOW_PRELOAD_WEBPACK_ENTRY,
      nodeIntegration: false,
      contextIsolation: true,
      webSecurity: true,
      // Required for Clerk to work in Electron
      webviewTag: true,
    },
  });

  const url = getMainRendererUrl();
  console.log('[Main Window] Loading URL:', url);
  
  mainWindow.loadURL(url);

  // Allow Clerk authentication iframes to load
  mainWindow.webContents.session.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [
          "default-src 'self' 'unsafe-inline' data: local-media: app:; " +
          "script-src 'self' 'unsafe-eval' 'unsafe-inline' https://*.clerk.accounts.dev https://certain-goat-83.clerk.accounts.dev; " +
          "worker-src 'self' blob:; " +
          "connect-src 'self' http://localhost:* http://127.0.0.1:* ws://localhost:* ws://127.0.0.1:* wss://localhost:* wss://127.0.0.1:* https://present-gha.vercel.app https://present.app https://wary-badger-863.convex.site https://wary-badger-863.convex.cloud wss://wary-badger-863.convex.cloud https://*.clerk.accounts.dev https://certain-goat-83.clerk.accounts.dev https://clerk.certain-goat-83.accounts.dev https://clerk-telemetry.com; " +
          "img-src 'self' data: local-media: https://*.gravatar.com https://*.wp.com https://lh3.googleusercontent.com https://*.googleusercontent.com https://img.clerk.com; " +
          "media-src 'self' local-media:; " +
          "font-src 'self' data: https:; " +
          "frame-src https://*.clerk.accounts.dev https://certain-goat-83.clerk.accounts.dev https://clerk.certain-goat-83.accounts.dev;"
        ]
      }
    });
  });

  // Allow navigation to Clerk domains
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    // Allow Clerk authentication popups
    if (url.includes('clerk.accounts.dev') || url.includes('clerk.com')) {
      return {
        action: 'allow',
        overrideBrowserWindowOptions: {
          webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
          }
        }
      };
    }
    // Block other popups
    return { action: 'deny' };
  });

  // Open DevTools in development
  if (isDev()) {
    mainWindow.webContents.openDevTools();
  }

  mainWindow.webContents.on('did-fail-load', (event, errorCode, errorDescription) => {
    console.error('[Main Window] Failed to load:', errorCode, errorDescription);
  });

  mainWindow.webContents.on('did-finish-load', () => {
    console.log('[Main Window] Finished loading');
    if (pendingDeepLink) {
      const nextDeepLink = pendingDeepLink;
      pendingDeepLink = null;
      handleDeepLink(nextDeepLink);
    }
  });

  mainWindow.on('close', () => {
    if (settingsWindow && !settingsWindow.isDestroyed()) {
      settingsWindow.close();
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
};

/**
 * Setup single instance lock and deep linking
 */
export const setupSingleInstance = (): void => {
  const gotTheLock = app.requestSingleInstanceLock();

  if (!gotTheLock) {
    app.quit();
    return;
  }

  app.on('second-instance', (_event, commandLine) => {
    // Windows/Linux handler for deep linking
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
    const url = commandLine.pop();
    if (url && url.startsWith('present://')) {
      handleDeepLink(url);
    }
  });
};

/**
 * Setup protocol client for deep linking
 */
export const setupProtocolClient = (): void => {
  if (process.defaultApp) {
    if (process.argv.length >= 2) {
      app.setAsDefaultProtocolClient('present', process.execPath, [path.resolve(process.argv[1])]);
    }
  } else {
    app.setAsDefaultProtocolClient('present');
  }
};
