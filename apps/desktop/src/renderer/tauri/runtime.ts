/**
 * Runtime detection and typed access to the Rust core.
 *
 * Everything under `src/renderer/tauri/` is loaded only by the Tauri HTML
 * entries (`index.html`, `output.html`) at the package root. The Electron
 * entries in `src/renderer/{main,output}/` never import it, so this directory
 * can grow the Rust-backed API without touching the running Electron build.
 */

import { invoke } from "@tauri-apps/api/core";

export type AppInfo = {
  version: string;
  platform: string;
  arch: string;
  uptimeMs: number;
  debugBuild: boolean;
};

/** Mirrors `AppError` in `src-tauri/src/errors.rs`. */
export type AppError = {
  kind: "io" | "tauri" | "not-found" | "invalid";
  message: string;
};

/**
 * True when running inside the Tauri shell rather than Electron or a bare
 * browser. Tauri v2 injects `__TAURI_INTERNALS__` before any app code runs.
 */
export const isTauri = (): boolean =>
  typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

export const getAppInfo = (): Promise<AppInfo> => invoke<AppInfo>("get_app_info");

/** Matches `SpeechUsageSource` in `src-tauri/src/services/speech.rs`. */
export type SpeechUsageSource = "bible" | "library";

/**
 * Mint an AssemblyAI streaming token through the Rust core.
 *
 * The web app remains the broker — the desktop must never carry an AssemblyAI
 * key. What changes is the transport: a request from Rust is not a browser
 * request, so there is no CORS preflight and no origin allowlist to keep in step
 * with the app's origin. See `services/speech.rs` for the full reasoning.
 */
export const requestSpeechToken = (args: {
  webAppBaseUrl: string;
  sessionToken: string;
  source: SpeechUsageSource;
}): Promise<unknown> => invoke("request_speech_token", args);

/**
 * Report a finished streaming session for billing.
 *
 * Speech search is metered by the second, so this must not be dropped. Under
 * Electron it was a fire-and-forget `fetch` from the renderer, which the Tauri
 * origin's CORS preflight would have failed silently.
 */
export const reportSpeechUsage = (args: {
  webAppBaseUrl: string;
  authBearer: string;
  sessionId: string;
  endedAtMs: number;
}): Promise<unknown> => invoke("report_speech_usage", args);

/** Mirrors `Display` in `src-tauri/src/services/display.rs`. */
export type DisplayRect = { x: number; y: number; width: number; height: number };
export type Display = {
  id: number;
  label: string;
  bounds: DisplayRect;
  workArea: DisplayRect;
  isPrimary: boolean;
};

export type ScreenRole = "audience" | "media" | "worship";

export const getDisplays = (): Promise<Display[]> => invoke<Display[]>("get_displays");

export const getPreferredDisplay = (
  role: ScreenRole,
): Promise<{ display: Display; isExplicit: boolean } | null> =>
  invoke("get_preferred_display", { role });

export const setPreferredDisplay = (
  role: ScreenRole,
  displayId: number | null,
): Promise<void> => invoke("set_preferred_display", { role, displayId });

export const setPreferredResolution = (
  role: ScreenRole,
  resolution: string,
): Promise<void> => invoke("set_preferred_resolution", { role, resolution });

export const getPreferredResolution = (
  role: ScreenRole,
): Promise<{ width: number; height: number }> =>
  invoke("get_preferred_resolution", { role });

/**
 * The windows Rust owns. Mirrors `WindowRole` in
 * `src-tauri/src/services/window_spec.rs`, and the values match the `?window=`
 * parameter `App.tsx` already branches on.
 */
export type WindowRole =
  | "main"
  | "output"
  | "media-stage"
  | "worship-stage"
  | "settings"
  | "looks"
  | "screen-composer";

export type OpenWindowOptions = {
  /** Also remembers the choice for this window's screen role. */
  displayId?: number | null;
  /** `"1920x1080"`, as the existing pickers already produce. */
  resolution?: string | null;
};

/** Open a window, or focus and reposition the one already open. */
export const openWindow = (
  role: WindowRole,
  options?: OpenWindowOptions,
): Promise<boolean> => invoke("open_window", { role, options: options ?? null });

/** Close a window. `false` when it was not open. */
export const closeWindow = (role: WindowRole): Promise<boolean> =>
  invoke("close_window", { role });

export const openMiniLyricsWindow = (payload: {
  libraryId: string;
  title?: string;
}): Promise<boolean> => invoke("open_mini_lyrics_window", { payload });

export const closeMiniLyricsWindow = (libraryId: string): Promise<boolean> =>
  invoke("close_mini_lyrics_window", { libraryId });

export type OpenWindowInfo = {
  label: string;
  visible: boolean;
  fullscreen: boolean;
};

/**
 * Which windows are open right now.
 *
 * Electron has no equivalent — the React side tracks this itself and goes stale
 * whenever a window is closed from the OS rather than from the app.
 */
export const listOpenWindows = (): Promise<OpenWindowInfo[]> =>
  invoke<OpenWindowInfo[]>("list_open_windows");
