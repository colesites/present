import { app, BrowserWindow } from 'electron';
import path from 'path';
import { isDev } from '../utils/app.utils';
import { setPendingAuthToken } from '../services/auth.service';
import { buildDesktopContentSecurityPolicy } from '../../../csp';
import { configureMediaPermissions } from '../services/media-permissions.service';
import { getDesktopAppIcon } from '../services/icon.service';

// Webpack entry points (declared globally by Forge)
declare const MAIN_WINDOW_WEBPACK_ENTRY: string;
declare const MAIN_WINDOW_PRELOAD_WEBPACK_ENTRY: string;

let mainWindow: BrowserWindow | null = null;
let pendingDeepLink: string | null = null;

/**
 * Get the main window instance
 */
export const getMainWindow = (): BrowserWindow | null => mainWindow;

/**
 * Handle deep link navigation
 */
export const handleDeepLink = (urlStr: string): void => {
  pendingDeepLink = urlStr;
  console.info('[Desktop Auth] deep link received', { url: urlStr.split('?')[0] });

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

    if (parsedUrl.pathname.includes('auth') || parsedUrl.host === 'auth') {
      const sessionToken =
        parsedUrl.searchParams.get('sessionToken')
        ?? parsedUrl.searchParams.get('refreshToken');
      const accessToken =
        parsedUrl.searchParams.get('accessToken')
        ?? parsedUrl.searchParams.get('token');

      if (sessionToken) {
        const payload = {
          accessToken,
          sessionToken,
        };
        setPendingAuthToken(payload);
      }
      if (sessionToken && mainWindow) {
        if (mainWindow.webContents.isLoading()) {
          pendingDeepLink = urlStr;
          return;
        }
        mainWindow.webContents.send('auth-callback', {
          accessToken,
          sessionToken,
        });
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

  const appIcon = getDesktopAppIcon();

  mainWindow = new BrowserWindow({
    height: 980,
    icon: appIcon,
    width: 1560,
    minWidth: 1180,
    minHeight: 760,
    // Defer initial paint so users never see the default white Electron
    // background before our renderer mounts. The hex matches our app
    // background (hsl(238 30% 10%) ≈ #12131c) so the transition into the UI
    // is seamless and avoids the "white flash" / "looks like it's about to
    // crash" perception.
    show: false,
    backgroundColor: '#12131c',
    webPreferences: {
      preload: MAIN_WINDOW_PRELOAD_WEBPACK_ENTRY,
      nodeIntegration: false,
      contextIsolation: true,
      webSecurity: true,
      // Required for Clerk to work in Electron
      webviewTag: true,
      // Avoid throttling timers/animations when the window is in the
      // background (this is what causes momentary blanking when the window
      // is restored from minimized/hidden on macOS).
      backgroundThrottling: false,
    },
  });

  mainWindow.once('ready-to-show', () => {
    mainWindow?.show();
  });

  const url = getMainRendererUrl();
  console.log('[Main Window] Loading URL:', url);

  configureMediaPermissions(mainWindow.webContents.session);
  mainWindow.loadURL(url);

  // Allow Clerk authentication iframes to load
  mainWindow.webContents.session.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [buildDesktopContentSecurityPolicy()],
      }
    });
  });

  // Allow navigation to Clerk domains
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    // Allow Clerk authentication popups
    if (
      url.includes('clerk.accounts.dev') ||
      url.includes('clerk.com') ||
      url.includes('clerk.present.c-technology-inc.com')
    ) {
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

  // Renderer process crashes — this is the #1 source of the "white flash /
  // looks like the app is about to crash" symptom in production. Without
  // handling it, Electron leaves a blank white window and the user has no
  // signal anything is wrong. We log structured diagnostics and try to
  // recover by reloading the window once. If the crash repeats immediately,
  // we stop auto-reloading to avoid an infinite crash loop.
  let lastCrashAt = 0;
  let crashRecoveryAttempts = 0;
  mainWindow.webContents.on('render-process-gone', (_event, details) => {
    const now = Date.now();
    const sinceLast = now - lastCrashAt;
    lastCrashAt = now;
    console.error('[Main Window] Renderer process gone:', {
      reason: details.reason,
      exitCode: details.exitCode,
      sinceLastCrashMs: sinceLast,
      attempts: crashRecoveryAttempts,
    });

    // "clean-exit" happens during normal teardown — ignore it.
    if (details.reason === 'clean-exit') {
      return;
    }

    if (sinceLast < 10_000 && crashRecoveryAttempts >= 2) {
      console.error('[Main Window] Repeated renderer crashes — leaving the window in place for inspection.');
      return;
    }

    crashRecoveryAttempts += 1;
    if (mainWindow && !mainWindow.isDestroyed()) {
      try {
        mainWindow.webContents.reload();
      } catch (err) {
        console.error('[Main Window] Failed to reload after crash:', err);
      }
    }
  });

  mainWindow.webContents.on('unresponsive', () => {
    console.warn('[Main Window] Renderer became unresponsive');
  });
  mainWindow.webContents.on('responsive', () => {
    console.info('[Main Window] Renderer responsive again');
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
