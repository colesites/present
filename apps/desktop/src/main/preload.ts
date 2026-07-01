import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';

contextBridge.exposeInMainWorld('electronAPI', {
  openOutputWindow: (displayId?: number | null) =>
    ipcRenderer.invoke('open-output-window', displayId ?? null),
  closeOutputWindow: () => ipcRenderer.invoke('close-output-window'),
  openMediaStageWindow: () => ipcRenderer.invoke('open-media-stage-window'),
  closeMediaStageWindow: () => ipcRenderer.invoke('close-media-stage-window'),
  openLooksWindow: () => ipcRenderer.invoke('open-looks-window'),
  closeLooksWindow: () => ipcRenderer.invoke('close-looks-window'),
  openScreenComposerWindow: () => ipcRenderer.invoke("open-screen-composer-window"),
  closeScreenComposerWindow: () => ipcRenderer.invoke("close-screen-composer-window"),
  openMiniLyricsWindow: (payload: MiniLyricsPayload) =>
    ipcRenderer.invoke("open-mini-lyrics-window", payload),
  closeMiniLyricsWindow: (libraryId: string) =>
    ipcRenderer.invoke("close-mini-lyrics-window", libraryId),
  getDisplays: () => ipcRenderer.invoke('get-displays'),
  setPreferredOutputDisplay: (displayId: number | null) =>
    ipcRenderer.invoke('set-preferred-output-display', displayId),
  getPreferredOutputDisplay: () => ipcRenderer.invoke('get-preferred-output-display'),
  onOutputWindowClosed: (callback: () => void) => {
    ipcRenderer.on('output-window-closed', () => callback());
  },
  selectFolder: () => ipcRenderer.invoke('select-folder'),
  selectLibraryExportDestination: (suggestedName?: string) =>
    ipcRenderer.invoke('select-library-export-destination', suggestedName),
  readFolder: (folderPath: string) => ipcRenderer.invoke('read-folder', folderPath),
  exportLibraryBundle: (
    destinationPath: string,
    items: unknown[],
  ) => ipcRenderer.invoke('export-library-bundle', destinationPath, items),
  importLibraryBundle: (folderPath: string) =>
    ipcRenderer.invoke('import-library-bundle', folderPath),
  selectMediaFile: () => ipcRenderer.invoke('select-media-file'),
  selectAudioFiles: () => ipcRenderer.invoke('select-audio-files'),
  selectPropImage: () => ipcRenderer.invoke('select-prop-image'),
  selectPresentationFiles: () => ipcRenderer.invoke('select-presentation-files'),
  copyMediaFile: (source: string, target: string) => ipcRenderer.invoke('copy-media-file', source, target),
  renameMediaFile: (oldPath: string, newName: string) => ipcRenderer.invoke('rename-media-file', oldPath, newName),
  deleteMediaFile: (filePath: string) => ipcRenderer.invoke('delete-media-file', filePath),
  createDirectory: (parent: string, name: string) => ipcRenderer.invoke('create-directory', parent, name),
  renameDirectory: (oldPath: string, newPath: string) => ipcRenderer.invoke('rename-directory', oldPath, newPath),
  listBundledBibles: () => ipcRenderer.invoke('list-bundled-bibles'),
  readBundledBible: (filePath: string) => ipcRenderer.invoke('read-bundled-bible', filePath),
  fetchHostedBibleCatalog: (catalogUrl: string) =>
    ipcRenderer.invoke('fetch-hosted-bible-catalog', catalogUrl),
  fetchBrowserSuggestions: (query: string) =>
    ipcRenderer.invoke('fetch-browser-suggestions', query),
  requestAssemblyAiToken: (
    sessionToken: string,
    source: "bible" | "library",
  ) => ipcRenderer.invoke('request-assemblyai-token', sessionToken, source),
  requestMicrophoneAccess: () => ipcRenderer.invoke('request-microphone-access'),
  listAiOperatorTools: () => ipcRenderer.invoke('ai-operator:list-tools'),
  onAiOperatorToggleShortcut: (callback: () => void) => {
    const listener = () => callback();
    ipcRenderer.on('ai-operator:toggle-shortcut', listener);
    return () => {
      ipcRenderer.removeListener('ai-operator:toggle-shortcut', listener);
    };
  },
  reportRendererError: (payload: {
    message: string;
    name?: string;
    source?: string;
    stack?: string;
  }) => ipcRenderer.send('report-renderer-error', payload),

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
  sendToStage: (data: unknown) => ipcRenderer.send('send-to-stage', data),
  onStageData: (callback: (data: unknown) => void) => {
    ipcRenderer.on('stage-data', (_event, data) => callback(data));
  },
  notifyStageReady: () => ipcRenderer.send('stage-ready'),
  onStageReady: (callback: () => void) => {
    const listener = () => callback();
    ipcRenderer.on('stage-ready', listener);
    return () => {
      ipcRenderer.removeListener('stage-ready', listener);
    };
  },

  // NDI Native Transport
  startNdiOutput: (sourceName: string, groupName: string) =>
    ipcRenderer.invoke('ndi:start', { sourceName, groupName }),
  stopNdiOutput: () => ipcRenderer.invoke('ndi:stop'),
  getNdiStatus: () => ipcRenderer.invoke('ndi:status'),

  // Auth & System URLs
  beginAuthFlow: () => ipcRenderer.invoke('begin-auth-flow'),
  consumePendingAuthToken: () => ipcRenderer.invoke('consume-pending-auth-token'),
  getStoredAuthSession: () => ipcRenderer.invoke('get-stored-auth-session'),
  setStoredAuthSession: (payload: DesktopStoredAuthSession) =>
    ipcRenderer.invoke('set-stored-auth-session', payload),
  clearStoredAuthSession: () => ipcRenderer.invoke('clear-stored-auth-session'),
  refreshDesktopSession: (sessionToken: string) =>
    ipcRenderer.invoke('refresh-desktop-session', sessionToken),
  openExternalBrowser: (url: string) => ipcRenderer.invoke('open-external-browser', url),
  onAuthCallback: (callback: (payload: DesktopAuthPayload) => void) => {
    ipcRenderer.on('auth-callback', (_event, payload) => callback(payload));
  },
  onOpenSettingsFromMenu: (callback: () => void) => {
    ipcRenderer.on('open-settings', () => callback());
  },
  onOpenImportFromMenu: (
    callback: (mode?: "presentation" | "images") => void,
  ) => {
    const listener = (
      _event: IpcRendererEvent,
      mode?: "presentation" | "images",
    ) => callback(mode);
    ipcRenderer.on('open-import', listener);
    return () => {
      ipcRenderer.removeListener('open-import', listener);
    };
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
  onMiniLyricsData: (callback: (payload: MiniLyricsPayload) => void) => {
    const listener = (_event: IpcRendererEvent, payload: MiniLyricsPayload) =>
      callback(payload);
    ipcRenderer.on("mini-lyrics:data", listener);
    return () => {
      ipcRenderer.removeListener("mini-lyrics:data", listener);
    };
  },
  notifyMiniLyricsReady: () => ipcRenderer.send("mini-lyrics:ready"),
  saveMiniLyrics: (payload: MiniLyricsSavePayload) =>
    ipcRenderer.invoke("mini-lyrics:save", payload),
  onMiniLyricsSaveRequest: (
    callback: (request: MiniLyricsSaveRequest) => void,
  ) => {
    const listener = (
      _event: IpcRendererEvent,
      request: MiniLyricsSaveRequest,
    ) => callback(request);
    ipcRenderer.on("mini-lyrics:save-request", listener);
    return () => {
      ipcRenderer.removeListener("mini-lyrics:save-request", listener);
    };
  },
  respondMiniLyricsSave: (response: MiniLyricsSaveResponse) =>
    ipcRenderer.send("mini-lyrics:save-response", response),
});

contextBridge.exposeInMainWorld('fontAPI', {
  getSystemFonts: () => ipcRenderer.invoke('get-system-fonts'),
  getSystemFontFaces: () => ipcRenderer.invoke('get-system-font-faces'),
  pickFontFile: () => ipcRenderer.invoke('pick-font-file'),
  installCustomFonts: (filePaths: string[]) =>
    ipcRenderer.invoke('install-custom-fonts', filePaths),
  getCustomFonts: () => ipcRenderer.invoke('get-custom-fonts'),
});

contextBridge.exposeInMainWorld('pptxAPI', {
  openFile: () => ipcRenderer.invoke('open-pptx'),
  parseFile: (filePath: string) => ipcRenderer.invoke('parse-pptx', filePath),
});
