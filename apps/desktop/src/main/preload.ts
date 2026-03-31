import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';

contextBridge.exposeInMainWorld('electronAPI', {
  openOutputWindow: () => ipcRenderer.invoke('open-output-window'),
  closeOutputWindow: () => ipcRenderer.invoke('close-output-window'),
  getDisplays: () => ipcRenderer.invoke('get-displays'),
  onOutputWindowClosed: (callback: () => void) => {
    ipcRenderer.on('output-window-closed', () => callback());
  },
  selectFolder: () => ipcRenderer.invoke('select-folder'),
  readFolder: (folderPath: string) => ipcRenderer.invoke('read-folder', folderPath),
  listBundledBibles: () => ipcRenderer.invoke('list-bundled-bibles'),
  readBundledBible: (filePath: string) => ipcRenderer.invoke('read-bundled-bible', filePath),
  fetchHostedBibleCatalog: (catalogUrl: string) =>
    ipcRenderer.invoke('fetch-hosted-bible-catalog', catalogUrl),
  requestAssemblyAiToken: (authToken: string) =>
    ipcRenderer.invoke('request-assemblyai-token', authToken),
  requestMicrophoneAccess: () => ipcRenderer.invoke('request-microphone-access'),

  // Output window IPC - send state from main window to output window
  sendToOutput: (data: unknown) => ipcRenderer.send('send-to-output', data),
  onOutputData: (callback: (data: unknown) => void) => {
    ipcRenderer.on('output-data', (_event, data) => callback(data));
  },
  // Output window tells main it's ready
  notifyOutputReady: () => ipcRenderer.send('output-ready'),
  onOutputReady: (callback: () => void) => {
    ipcRenderer.on('output-ready', () => callback());
  },

  // Auth & System URLs
  beginAuthFlow: () => ipcRenderer.invoke('begin-auth-flow'),
  consumePendingAuthToken: () => ipcRenderer.invoke('consume-pending-auth-token'),
  openExternalBrowser: (url: string) => ipcRenderer.invoke('open-external-browser', url),
  onAuthCallback: (callback: (token: string) => void) => {
    ipcRenderer.on('auth-callback', (_event, token) => callback(token));
  },
  onOpenSettingsFromMenu: (callback: () => void) => {
    ipcRenderer.on('open-settings', () => callback());
  },
  setBrowserModeEnabled: (enabled: boolean) =>
    ipcRenderer.invoke('browser-mode:set-enabled', enabled),
  setBrowserModeBounds: (bounds: { x: number; y: number; width: number; height: number }) =>
    ipcRenderer.invoke('browser-mode:set-bounds', bounds),
  browserNavigate: (input: string) => ipcRenderer.invoke('browser-mode:navigate', input),
  browserBack: () => ipcRenderer.invoke('browser-mode:back'),
  browserForward: () => ipcRenderer.invoke('browser-mode:forward'),
  browserReload: () => ipcRenderer.invoke('browser-mode:reload'),
  setBrowserProjectionTarget: (target: 'preview' | 'main-output') =>
    ipcRenderer.invoke('browser-mode:set-projection', target),
  getBrowserModeState: () => ipcRenderer.invoke('browser-mode:get-state'),
  onBrowserModeStateChanged: (
    callback: (state: {
      url: string;
      title: string;
      canGoBack: boolean;
      canGoForward: boolean;
      isLoading: boolean;
      projectionTarget: 'preview' | 'main-output';
      scrollX: number;
      scrollY: number;
      previewDataUrl: string | null;
    }) => void,
  ) => {
    const listener = (_event: IpcRendererEvent, state: Parameters<typeof callback>[0]) =>
      callback(state);
    ipcRenderer.on('browser-state-changed', listener);
    return () => {
      ipcRenderer.removeListener('browser-state-changed', listener);
    };
  },
  onBrowserFocusAddress: (callback: () => void) => {
    const listener = () => callback();
    ipcRenderer.on('browser-focus-address', listener);
    return () => {
      ipcRenderer.removeListener('browser-focus-address', listener);
    };
  },
});
