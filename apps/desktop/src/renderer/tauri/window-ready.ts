/**
 * Tell Rust this window has drawn, so it can be shown (`window_ready`).
 *
 * Windows are created hidden. Showing one when its document loads shows white
 * until React paints. This fires from an effect after React's first commit —
 * not from an animation frame, which WebKit never runs in a hidden window.
 */

import { useEffect } from "react";
import { markStartup } from "../shared/lib/startup-timeline";

const isTauriShell = (): boolean =>
  typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

const reportReady = (): void => {
  markStartup("first-paint");
  void import("@tauri-apps/api/core")
    .then(({ invoke }) => invoke("window_ready"))
    .catch((error: unknown) => {
      console.error("[Tauri] could not report the window ready", error);
    });
};

/** Render once near the root. Showing twice is harmless; Rust shows once. */
export function WindowReadySignal(): null {
  useEffect(() => {
    if (!isTauriShell()) return;
    const timer = window.setTimeout(reportReady, 0);
    return () => window.clearTimeout(timer);
  }, []);
  return null;
}

/** What the splash window says while the operator window starts. */
export const setSplashStatus = (status: string): void => {
  if (!isTauriShell()) return;
  void import("@tauri-apps/api/core")
    .then(({ invoke }) => invoke("set_splash_status", { status }))
    .catch((): undefined => undefined);
};
