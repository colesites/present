
interface Display {
  id: number;
  bounds: { x: number; y: number; width: number; height: number };
  workArea: { x: number; y: number; width: number; height: number };
  scaleFactor: number;
  isPrimary: boolean;
}

interface BundledBibleFile {
  id: string;
  code: string;
  name: string;
  filePath: string;
  sizeBytes: number;
}

interface MediaAccessResult {
  granted: boolean;
  status: string;
}

interface DesktopAuthPayload {
  token: string;
  refreshToken: string | null;
}

interface BrowserSuggestionsResponse {
  suggestions: string[];
}

interface BrowserModeState {
  url: string;
  title: string;
  canGoBack: boolean;
  canGoForward: boolean;
  isLoading: boolean;
  projectionTarget: "preview" | "main-output";
  scrollX: number;
  scrollY: number;
  previewDataUrl: string | null;
}

interface ElectronAPI {
  openOutputWindow: () => Promise<boolean>;
  closeOutputWindow: () => Promise<boolean>;
  getDisplays: () => Promise<Display[]>;
  onOutputWindowClosed: (callback: () => void) => void;
  selectFolder: () => Promise<{ id: string; name: string; path: string } | null>;
  readFolder: (folderPath: string) => Promise<{ name: string; lastModified: number }[]>;
  listBundledBibles: () => Promise<BundledBibleFile[]>;
  readBundledBible: (filePath: string) => Promise<Uint8Array | null>;
  fetchHostedBibleCatalog: (catalogUrl: string) => Promise<unknown | null>;
  fetchBrowserSuggestions: (query: string) => Promise<BrowserSuggestionsResponse | null>;
  requestAssemblyAiToken: (authToken: string) => Promise<unknown | null>;
  requestMicrophoneAccess: () => Promise<MediaAccessResult>;

  // Output window IPC
  sendToOutput: (data: unknown) => void;
  onOutputData: (callback: (data: unknown) => void) => void;
  notifyOutputReady: () => void;
  onOutputReady: (callback: () => void) => void;

  // Auth & System URLs
  beginAuthFlow: () => Promise<{ ok: boolean; error?: string }>;
  consumePendingAuthToken: () => Promise<DesktopAuthPayload | null>;
  openExternalBrowser: (url: string) => Promise<boolean>;
  onAuthCallback: (callback: (payload: DesktopAuthPayload) => void) => void;
  onOpenSettingsFromMenu: (callback: () => void) => void;

  setBrowserModeEnabled: (enabled: boolean) => Promise<BrowserModeState>;
  setBrowserModeBounds: (bounds: {
    x: number;
    y: number;
    width: number;
    height: number;
  }) => Promise<BrowserModeState>;
  browserNavigate: (input: string) => Promise<BrowserModeState>;
  browserBack: () => Promise<BrowserModeState>;
  browserForward: () => Promise<BrowserModeState>;
  browserReload: () => Promise<BrowserModeState>;
  setBrowserProjectionTarget: (
    target: "preview" | "main-output",
  ) => Promise<BrowserModeState>;
  getBrowserModeState: () => Promise<BrowserModeState>;
  onBrowserModeStateChanged: (callback: (state: BrowserModeState) => void) => () => void;
  onBrowserFocusAddress: (callback: () => void) => () => void;
}

interface Window {
  electronAPI: ElectronAPI;
}
