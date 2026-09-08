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
