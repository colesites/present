
import type { CustomFontFace, SystemFontFace } from "./font";
import type { ParsedPptxPresentation } from "./pptx";
import type {
  AiModelToolDefinition,
} from "../ai-operator/types";

declare global {
interface Display {
  id: number;
  label: string;
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
  accessToken?: string | null;
  sessionToken: string;
}

interface DesktopStoredAuthUser {
  email: string;
  id: string;
  name: string;
}

interface DesktopStoredAuthOrganization {
  id: string;
  logo?: string;
  name: string;
  type: "organization" | "personal";
}

interface DesktopStoredAuthSession {
  orgId: string | null;
  organizations: DesktopStoredAuthOrganization[];
  savedAtMs: number;
  sessionExpiresAtMs: number | null;
  sessionToken: string;
  token: string | null;
  tokenExpiresAtMs: number | null;
  user: DesktopStoredAuthUser | null;
}

interface DesktopRefreshSessionResponse {
  accessToken?: string;
  accessTokenExpiresAt?: number;
  refreshToken?: string;
  sessionExpiresAt?: number;
  sessionToken?: string;
  token?: string;
}

type DesktopRefreshSessionOutcome =
  | { ok: true; data: DesktopRefreshSessionResponse | null }
  | { ok: false; status: number; error: string };

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

interface PresentationImportFile {
  name: string;
  path: string;
  bytes: Uint8Array;
  lastModified: number;
}

interface MiniLyricsPayload {
  libraryId: string;
  title: string;
  body: string;
  initialSlideIndex?: number | null;
}

interface MiniLyricsSavePayload {
  libraryId: string;
  body: string;
}

interface MiniLyricsSaveRequest {
  requestId: string;
  payload: MiniLyricsSavePayload;
}

interface MiniLyricsSaveResponse {
  requestId: string;
  ok: boolean;
  error?: string;
}

interface FontAPI {
  getSystemFonts: () => Promise<string[]>;
  getSystemFontFaces?: () => Promise<SystemFontFace[]>;
  pickFontFile: () => Promise<string[] | null>;
  installCustomFonts?: (filePaths: string[]) => Promise<CustomFontFace[]>;
  getCustomFonts?: () => Promise<CustomFontFace[]>;
}

interface PptxAPI {
  openFile: () => Promise<string | null>;
  parseFile: (filePath: string) => Promise<ParsedPptxPresentation>;
}

interface ElectronAPI {
  openOutputWindow: (
    displayId?: number | null,
    resolution?: string | null,
  ) => Promise<boolean>;
  closeOutputWindow: () => Promise<boolean>;
  openMediaStageWindow: (
    displayId?: number | null,
    resolution?: string | null,
  ) => Promise<boolean>;
  closeMediaStageWindow: () => Promise<boolean>;
  openWorshipStageWindow: (
    displayId?: number | null,
    resolution?: string | null,
  ) => Promise<boolean>;
  closeWorshipStageWindow: () => Promise<boolean>;
  openLooksWindow: () => Promise<boolean>;
  closeLooksWindow: () => Promise<boolean>;
  openScreenComposerWindow: () => Promise<boolean>;
  closeScreenComposerWindow: () => Promise<boolean>;
  openMiniLyricsWindow: (payload: MiniLyricsPayload) => Promise<boolean>;
  closeMiniLyricsWindow: (libraryId: string) => Promise<boolean>;
  getDisplays: () => Promise<Display[]>;
  setPreferredOutputDisplay: (displayId: number | null) => Promise<boolean>;
  getPreferredOutputDisplay: () => Promise<number | null>;
  setPreferredDisplay: (
    role: "audience" | "media" | "worship",
    displayId: number | null,
  ) => Promise<boolean>;
  getPreferredDisplay: (
    role: "audience" | "media" | "worship",
  ) => Promise<number | null>;
  setPreferredResolution: (
    role: "audience" | "media" | "worship",
    resolution: string | null,
  ) => Promise<boolean>;
  onOutputWindowClosed: (callback: () => void) => () => void;
  onMediaStageWindowClosed: (callback: () => void) => () => void;
  onWorshipStageWindowClosed: (callback: () => void) => () => void;
  selectFolder: () => Promise<{ id: string; name: string; path: string } | null>;
  selectFolders?: () => Promise<{ id: string; name: string; path: string }[]>;
  selectLibraryExportDestination: (suggestedName?: string) => Promise<string | null>;
  readFolder: (folderPath: string) => Promise<{ name: string; lastModified: number }[]>;
  exportLibraryBundle: (
    destinationPath: string,
    items: Array<{
      title: string;
      body: string;
      categoryName?: string | null;
      author?: string | null;
      artist?: string | null;
      type?: "song" | "scripture" | "slide" | "note" | null;
      content?: unknown;
      slides?: unknown[];
      createdAt?: number;
      updatedAt?: number;
    }>,
  ) => Promise<{ path: string; itemCount: number }>;
  importLibraryBundle: (folderPath: string) => Promise<{
    path: string;
    itemCount: number;
    items: Array<{
      title: string;
      body: string;
      categoryName?: string | null;
      author?: string | null;
      artist?: string | null;
      type?: "song" | "scripture" | "slide" | "note" | null;
      content?: unknown;
      slides?: unknown[];
      createdAt?: number | null;
      updatedAt?: number | null;
    }>;
  }>;
  listBundledBibles: () => Promise<BundledBibleFile[]>;
  readBundledBible: (filePath: string) => Promise<Uint8Array | null>;
  fetchHostedBibleCatalog: (catalogUrl: string) => Promise<unknown | null>;
  fetchBrowserSuggestions: (query: string) => Promise<BrowserSuggestionsResponse | null>;
  requestAssemblyAiToken: (
    sessionToken: string,
    source: "bible" | "library",
  ) => Promise<unknown | null>;
  requestMicrophoneAccess: () => Promise<MediaAccessResult>;
  requestCameraAccess: () => Promise<MediaAccessResult>;
  listAiOperatorTools: () => Promise<AiModelToolDefinition[]>;
  onAiOperatorToggleShortcut: (callback: () => void) => () => void;
  reportRendererError: (payload: {
    message: string;
    name?: string;
    source?: string;
    stack?: string;
  }) => void;

  // Output window IPC
  sendToOutput: (data: unknown) => void;
  onOutputData: (callback: (data: unknown) => void) => () => void;
  notifyOutputReady: () => void;
  onOutputReady: (callback: () => void) => () => void;
  sendToStage: (data: unknown) => void;
  onStageData: (callback: (data: unknown) => void) => () => void;
  notifyStageReady: () => void;
  onStageReady: (callback: () => void) => () => void;
  sendToWorshipStage: (data: unknown) => void;
  onWorshipStageData: (callback: (data: unknown) => void) => () => void;
  notifyWorshipStageReady: () => void;
  onWorshipStageReady: (callback: () => void) => () => void;

  // NDI Native Transport
  startNdiOutput: (
    sourceName: string,
    groupName: string,
    /** 24, 25, 30, 50 or 60; anything else means 30. */
    frameRate?: number,
  ) => Promise<{
    ok: boolean;
    error?: string;
    status: {
      running: boolean;
      sourceName: string;
      groupName: string;
      lastError: string | null;
      libraryLoaded: boolean;
      framesSent: number;
      usingFallbackFrame: boolean;
    };
  }>;
  stopNdiOutput: () => Promise<void>;
  getNdiStatus: () => Promise<{
    running: boolean;
    sourceName: string;
    groupName: string;
    lastError: string | null;
    libraryLoaded: boolean;
    framesSent: number;
    usingFallbackFrame: boolean;
  }>;
  listNdiSources: (groupName?: string) => Promise<{
    ok: boolean;
    sources: Array<{ name: string; urlAddress?: string }>;
    error?: string;
  }>;
  startNdiInput: (
    sourceName: string,
    groupName?: string,
    clientId?: string,
  ) => Promise<{ ok: boolean; error?: string; sourceName: string | null }>;
  stopNdiInput: (clientId?: string) => Promise<void>;

  // Auth & System URLs
  beginAuthFlow: () => Promise<{ ok: boolean; error?: string }>;
  consumePendingAuthToken: () => Promise<DesktopAuthPayload | null>;
  getStoredAuthSession: () => Promise<DesktopStoredAuthSession | null>;
  setStoredAuthSession: (payload: DesktopStoredAuthSession) => Promise<boolean>;
  clearStoredAuthSession: () => Promise<boolean>;
  refreshDesktopSession: (
    sessionToken: string,
  ) => Promise<DesktopRefreshSessionOutcome | DesktopRefreshSessionResponse | null>;
  openExternalBrowser: (url: string) => Promise<boolean>;
  onAuthCallback: (callback: (payload: DesktopAuthPayload) => void) => void;
  onOpenSettingsFromMenu: (callback: () => void) => void;
  onOpenImportFromMenu: (
    callback: (mode?: "presentation" | "images") => void,
  ) => () => void;

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
  onMiniLyricsData: (callback: (payload: MiniLyricsPayload) => void) => () => void;
  notifyMiniLyricsReady: () => void;
  saveMiniLyrics: (
    payload: MiniLyricsSavePayload,
  ) => Promise<{ ok: boolean; error?: string }>;
  onMiniLyricsSaveRequest: (
    callback: (request: MiniLyricsSaveRequest) => void,
  ) => () => void;
  respondMiniLyricsSave: (response: MiniLyricsSaveResponse) => void;

  // Media & Filesystem
  selectMediaFile: () => Promise<{ name: string; path: string } | null>;
  selectAudioFiles: () => Promise<Array<{ name: string; path: string }>>;
  selectPropImage: () => Promise<
    { name: string; path: string; dataUrl: string } | null
  >;
  selectPropMedia: () => Promise<
    | {
        name: string;
        path: string;
        mediaType: "image";
        dataUrl: string;
      }
    | {
        name: string;
        path: string;
        mediaType: "video";
        mediaUrl: string;
      }
    | null
  >;
  selectPresentationFiles: () => Promise<PresentationImportFile[] | null>;
  copyMediaFile: (source: string, target: string) => Promise<boolean>;
  renameMediaFile: (
    oldPath: string,
    newName: string,
  ) => Promise<{ path: string; name: string }>;
  deleteMediaFile: (filePath: string) => Promise<boolean>;
  createDirectory: (parent: string, name: string) => Promise<string>;
  renameDirectory: (oldPath: string, newPath: string) => Promise<boolean>;
}

interface Window {
  electronAPI: ElectronAPI;
  fontAPI?: FontAPI;
  pptxAPI?: PptxAPI;
}
}

export {};
