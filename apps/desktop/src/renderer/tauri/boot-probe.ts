/**
 * Startup smoke test for the React → invoke → Rust → serde round trip.
 *
 * Loaded by the Tauri HTML entries only. It proves the IPC path is wired and
 * records the Rust core's startup time, which is the baseline for the
 * Electron-vs-Tauri performance comparison the migration plan requires.
 */

import { getAppInfo, isTauri } from "./runtime";

if (isTauri()) {
  void getAppInfo()
    .then((info) => {
      console.info(
        `[Tauri] Rust core v${info.version} (${info.platform}/${info.arch}, ` +
          `${info.debugBuild ? "debug" : "release"}) ready in ${info.uptimeMs}ms`,
      );
      // Exposed so the dev workflow and future perf tooling can read it without
      // scraping the console.
      (window as unknown as { __presentRustCore?: unknown }).__presentRustCore = info;
    })
    .catch((error: unknown) => {
      console.error("[Tauri] Rust core unreachable — IPC path is broken", error);
    });
} else {
  console.warn("[Tauri] boot probe loaded outside the Tauri shell; skipping.");
}
