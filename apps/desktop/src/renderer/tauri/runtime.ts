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
