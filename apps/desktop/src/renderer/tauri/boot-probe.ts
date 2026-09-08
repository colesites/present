/**
 * Startup smoke test for the React → invoke → Rust → serde round trip.
 *
 * Loaded by the Tauri HTML entries only. It proves the IPC path is wired and
 * records the Rust core's startup time, which is the baseline for the
 * Electron-vs-Tauri performance comparison the migration plan requires.
 */

import { reportWebviewCapabilities } from "./capability-probe";
import { getAppInfo, getDisplays, getPreferredDisplay, isTauri } from "./runtime";

if (isTauri()) {
  // Feature detection only — no permission prompt. Call
  // `reportWebviewCapabilities(true)` from the console to also test live
  // microphone capture.
  void reportWebviewCapabilities(false).catch((error: unknown) => {
    console.error("[Tauri] capability probe failed", error);
  });
  (
    window as unknown as { __presentProbeCapabilities?: unknown }
  ).__presentProbeCapabilities = reportWebviewCapabilities;

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

if (isTauri()) {
  // Stage 2 check: report what the Rust core sees, so display enumeration can
  // be verified against real hardware rather than only against unit tests.
  void Promise.all([getDisplays(), getPreferredDisplay("audience")])
    .then(async ([displays, audience]) => {
      const summary =
        `displays=${JSON.stringify(displays)} ` +
        `audience=${JSON.stringify(audience)}`;
      console.info("[Tauri]", summary);
      // A Tauri webview's console is not visible from a terminal, so mirror it
      // into the Rust log where it can actually be read during development.
      const { invoke } = await import("@tauri-apps/api/core");
      await invoke("report_diagnostic", { message: summary });
    })
    .catch((error: unknown) => {
      console.error("[Tauri] display enumeration failed", error);
    });
}
