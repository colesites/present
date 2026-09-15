import { BrowserView, shell, nativeImage, type Rectangle } from 'electron';
import { createOutputWindow, getOutputWindow } from '../windows/output.window';
import { getMainWindow } from '../windows/main.window';
import {
  SCROLL_SYNC_INTERVAL_MS,
  clampBrowserBounds,
  initialBrowserState,
  isValidHttpUrl,
  normalizeNavigationInput,
  previewCrop,
  restoreUrl,
  type BrowserState,
} from '../lib/browser-mode.mjs';

type BrowserProjectionTarget = 'preview' | 'main-output';
type ManagedBrowserViewRole = 'main' | 'output';

let mainBrowserView: BrowserView | null = null;
let outputBrowserView: BrowserView | null = null;
let isBrowserModeEnabled = false;
let mainBrowserBounds: Rectangle = { x: 0, y: 0, width: 0, height: 0 };
let projectionTarget: BrowserProjectionTarget = 'preview';
let browserState: BrowserState = initialBrowserState();

const ignorePromiseError = (): null => null;
let scrollSyncTimer: NodeJS.Timeout | null = null;
let isCapturingPreview = false;
const browserSessionPartition = 'persist:present-browser-mode';

const emitBrowserState = (): void => {
  const mainWindow = getMainWindow();
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('browser-state-changed', browserState);
  }
};

const updateStateFromMainView = (): void => {
  if (!mainBrowserView || mainBrowserView.webContents.isDestroyed()) {
    return;
  }

  const { webContents } = mainBrowserView;
  browserState = {
    ...browserState,
    url: webContents.getURL() || browserState.url,
    title: webContents.getTitle() || '',
    canGoBack: webContents.navigationHistory.canGoBack(),
    canGoForward: webContents.navigationHistory.canGoForward(),
    isLoading: webContents.isLoading(),
    projectionTarget,
  };
  emitBrowserState();
};

const syncOutputScrollPosition = (): void => {
  if (!outputBrowserView || outputBrowserView.webContents.isDestroyed()) {
    return;
  }

  outputBrowserView.webContents
    .executeJavaScript(
      `window.scrollTo(${Math.round(browserState.scrollX)}, ${Math.round(browserState.scrollY)});`,
      true,
    )
    .catch(ignorePromiseError);
};

const syncOutputViewToMain = (force = false): void => {
  if (
    !mainBrowserView ||
    mainBrowserView.webContents.isDestroyed() ||
    !outputBrowserView ||
    outputBrowserView.webContents.isDestroyed()
  ) {
    return;
  }

  const url = mainBrowserView.webContents.getURL();
  if (!url || url === 'about:blank') {
    return;
  }

  if (!force && url === outputBrowserView.webContents.getURL()) {
    syncOutputScrollPosition();
    return;
  }

  outputBrowserView.webContents.loadURL(url).catch(ignorePromiseError);
};

const capturePreviewFromMainView = (): void => {
  if (
    isCapturingPreview ||
    !mainBrowserView ||
    mainBrowserView.webContents.isDestroyed() ||
    mainBrowserBounds.width <= 0 ||
    mainBrowserBounds.height <= 0
  ) {
    return;
  }

  isCapturingPreview = true;
  void mainBrowserView.webContents
    .capturePage()
    .then((image) => {
      if (image.isEmpty()) {
        return;
      }

      const sourceSize = image.getSize();
      if (sourceSize.width <= 0 || sourceSize.height <= 0) {
        return;
      }

      // The crop lies inside the capture, so the cropped image is as wide as
      // `crop` says and `previewWidth` is what `cropped.getSize()` gave.
      const { crop, previewWidth } = previewCrop(sourceSize, mainBrowserBounds);
      const cropped = crop ? image.crop(crop) : image;
      const previewImage =
        previewWidth > 0 ? cropped.resize({ width: previewWidth }) : nativeImage.createEmpty();
      if (previewImage.isEmpty()) {
        return;
      }

      browserState = {
        ...browserState,
        previewDataUrl: previewImage.toDataURL(),
      };
      emitBrowserState();
    })
    .catch(ignorePromiseError)
    .finally(() => {
      isCapturingPreview = false;
    });
};

const stopScrollSync = (): void => {
  if (!scrollSyncTimer) {
    return;
  }
  clearInterval(scrollSyncTimer);
  scrollSyncTimer = null;
};

const startScrollSync = (): void => {
  if (scrollSyncTimer) {
    return;
  }

  scrollSyncTimer = setInterval(() => {
    if (!mainBrowserView || mainBrowserView.webContents.isDestroyed()) {
      stopScrollSync();
      return;
    }

    void mainBrowserView.webContents
      .executeJavaScript('({ x: window.scrollX || 0, y: window.scrollY || 0 })', true)
      .then((position) => {
        const nextX = typeof position?.x === 'number' ? position.x : 0;
        const nextY = typeof position?.y === 'number' ? position.y : 0;
        const changed = nextX !== browserState.scrollX || nextY !== browserState.scrollY;

        if (changed) {
          browserState = {
            ...browserState,
            scrollX: nextX,
            scrollY: nextY,
          };
          emitBrowserState();
        }

        syncOutputScrollPosition();
      })
      .catch(ignorePromiseError);

    capturePreviewFromMainView();
  }, SCROLL_SYNC_INTERVAL_MS);
};

const attachMainView = (): void => {
  const mainWindow = getMainWindow();
  if (!mainWindow || mainWindow.isDestroyed() || !mainBrowserView) {
    return;
  }
  mainWindow.setBrowserView(mainBrowserView);
  mainBrowserView.setBounds(mainBrowserBounds);
};

const fitOutputView = (): void => {
  const outputWindow = getOutputWindow();
  if (!outputWindow || outputWindow.isDestroyed() || !outputBrowserView) {
    return;
  }
  const bounds = outputWindow.getContentBounds();
  outputBrowserView.setBounds({ x: 0, y: 0, width: bounds.width, height: bounds.height });
};

const detachAndDestroyOutputView = (): void => {
  const outputWindow = getOutputWindow();
  if (outputWindow && !outputWindow.isDestroyed()) {
    outputWindow.setBrowserView(null);
  }
  if (outputBrowserView && !outputBrowserView.webContents.isDestroyed()) {
    outputBrowserView.webContents.removeAllListeners();
    outputBrowserView.webContents.close();
  }
  outputBrowserView = null;
};

const detachMainView = (): void => {
  const mainWindow = getMainWindow();
  if (!mainWindow || mainWindow.isDestroyed()) {
    return;
  }
  mainWindow.setBrowserView(null);
};

const createManagedBrowserView = (role: ManagedBrowserViewRole): BrowserView => {
  const view = new BrowserView({
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
      spellcheck: false,
      partition: browserSessionPartition,
    },
  });

  view.webContents.setWindowOpenHandler(({ url }) => {
    if (isValidHttpUrl(url)) {
      view.webContents.loadURL(url).catch(ignorePromiseError);
      return { action: 'deny' };
    }
    shell.openExternal(url).catch(ignorePromiseError);
    return { action: 'deny' };
  });

  view.webContents.on('will-navigate', (event, url) => {
    if (!isValidHttpUrl(url)) {
      event.preventDefault();
    }
  });

  if (role === 'main') {
    view.webContents.on('before-input-event', (event, input) => {
      if ((input.meta || input.control) && input.key.toLowerCase() === 'l') {
        event.preventDefault();
        const mainWindow = getMainWindow();
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('browser-focus-address');
        }
      }
    });

    view.webContents.on('did-start-loading', () => {
      updateStateFromMainView();
    });
    view.webContents.on('did-stop-loading', () => {
      updateStateFromMainView();
      syncOutputViewToMain();
      capturePreviewFromMainView();
    });
    view.webContents.on('did-navigate', () => {
      updateStateFromMainView();
      syncOutputViewToMain();
      capturePreviewFromMainView();
    });
    view.webContents.on('did-navigate-in-page', () => {
      updateStateFromMainView();
      syncOutputViewToMain();
      capturePreviewFromMainView();
    });
    view.webContents.on('page-title-updated', () => {
      updateStateFromMainView();
    });
  } else {
    view.webContents.on('did-stop-loading', () => {
      syncOutputScrollPosition();
    });
    view.webContents.on('did-navigate-in-page', () => {
      syncOutputScrollPosition();
    });
  }

  return view;
};

const ensureMainBrowserView = (): BrowserView | null => {
  if (mainBrowserView && !mainBrowserView.webContents.isDestroyed()) {
    return mainBrowserView;
  }
  mainBrowserView = createManagedBrowserView('main');
  return mainBrowserView;
};

const ensureOutputBrowserView = (): BrowserView | null => {
  const outputWindow = getOutputWindow();
  if (!outputWindow || outputWindow.isDestroyed()) {
    return null;
  }

  if (outputBrowserView && !outputBrowserView.webContents.isDestroyed()) {
    outputWindow.setBrowserView(outputBrowserView);
    fitOutputView();
    return outputBrowserView;
  }

  outputBrowserView = createManagedBrowserView('output');
  outputWindow.setBrowserView(outputBrowserView);
  fitOutputView();

  outputWindow.removeListener('resize', fitOutputView);
  outputWindow.on('resize', fitOutputView);
  outputWindow.on('closed', () => {
    detachAndDestroyOutputView();
  });

  return outputBrowserView;
};

export const setBrowserMode = (enabled: boolean): BrowserState => {
  isBrowserModeEnabled = enabled;
  if (!enabled) {
    detachMainView();
    stopScrollSync();
    return browserState;
  }

  const view = ensureMainBrowserView();
  if (!view) {
    return browserState;
  }

  attachMainView();

  const currentUrl = view.webContents.getURL();
  const hasRestorableCurrentUrl = Boolean(currentUrl && currentUrl !== 'about:blank');
  if (!hasRestorableCurrentUrl) {
    view.webContents.loadURL(restoreUrl(null, browserState.url)).catch(ignorePromiseError);
  } else {
    updateStateFromMainView();
    syncOutputViewToMain();
    capturePreviewFromMainView();
  }

  startScrollSync();
  return browserState;
};

export const setBrowserBounds = (bounds: Rectangle): BrowserState => {
  mainBrowserBounds = clampBrowserBounds(bounds);
  if (!isBrowserModeEnabled || !mainBrowserView) {
    return browserState;
  }

  attachMainView();
  capturePreviewFromMainView();
  return browserState;
};

export const navigateBrowserTo = async (input: string): Promise<BrowserState> => {
  const view = ensureMainBrowserView();
  if (!view) {
    return browserState;
  }

  const targetUrl = normalizeNavigationInput(input);
  await view.webContents.loadURL(targetUrl);
  updateStateFromMainView();
  syncOutputViewToMain();
  capturePreviewFromMainView();
  return browserState;
};

export const browserBack = (): BrowserState => {
  if (!mainBrowserView) {
    return browserState;
  }

  const { webContents } = mainBrowserView;
  if (webContents.navigationHistory.canGoBack()) {
    webContents.navigationHistory.goBack();
  }
  updateStateFromMainView();
  return browserState;
};

export const browserForward = (): BrowserState => {
  if (!mainBrowserView) {
    return browserState;
  }

  const { webContents } = mainBrowserView;
  if (webContents.navigationHistory.canGoForward()) {
    webContents.navigationHistory.goForward();
  }
  updateStateFromMainView();
  return browserState;
};

export const browserReload = (): BrowserState => {
  if (!mainBrowserView) {
    return browserState;
  }

  mainBrowserView.webContents.reload();
  updateStateFromMainView();
  return browserState;
};

export const setBrowserProjection = (target: BrowserProjectionTarget): BrowserState => {
  projectionTarget = target;
  browserState = { ...browserState, projectionTarget };
  emitBrowserState();

  if (target === 'preview') {
    detachAndDestroyOutputView();
    return browserState;
  }

  const mainWindow = getMainWindow();
  createOutputWindow(mainWindow);
  const outputView = ensureOutputBrowserView();
  if (!outputView || !mainBrowserView) {
    return browserState;
  }

  const targetUrl = restoreUrl(mainBrowserView.webContents.getURL(), browserState.url);

  if (outputView.webContents.getURL() !== targetUrl) {
    outputView.webContents.loadURL(targetUrl).catch(ignorePromiseError);
  } else {
    syncOutputScrollPosition();
  }

  startScrollSync();
  return browserState;
};

export const getBrowserState = (): BrowserState => browserState;
