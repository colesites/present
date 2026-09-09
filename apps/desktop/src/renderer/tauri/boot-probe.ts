/**
 * Startup smoke test for the React → invoke → Rust → serde round trip.
 *
 * Loaded by the Tauri HTML entries only. It proves the IPC path is wired and
 * records the Rust core's startup time, which is the baseline for the
 * Electron-vs-Tauri performance comparison the migration plan requires.
 *
 * Runs in the operator window only. Six of the eight windows load the same
 * `index.html`, so an ungated probe runs once per open window: six capability
 * reports, six display enumerations, and six copies of every handle it hangs
 * off `window`. Anything here that opened a window would recurse.
 */

import { reportWebviewCapabilities } from "./capability-probe";
import { getAppInfo, getDisplays, getPreferredDisplay, isTauri } from "./runtime";

/**
 * True only in the operator window.
 *
 * Read synchronously from `__TAURI_INTERNALS__` rather than through
 * `getCurrentWebviewWindow()`, so the gate is settled before any probe runs
 * instead of one microtask later.
 */
const isOperatorWindow = (): boolean => {
  const internals = (
    window as unknown as {
      __TAURI_INTERNALS__?: { metadata?: { currentWebview?: { label?: string } } };
    }
  ).__TAURI_INTERNALS__;
  return internals?.metadata?.currentWebview?.label === "main";
};

const shouldProbe = isTauri() && isOperatorWindow();

if (shouldProbe) {
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
} else if (!isTauri()) {
  console.warn("[Tauri] boot probe loaded outside the Tauri shell; skipping.");
}

if (shouldProbe) {
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

if (shouldProbe) {
  // Stage 2 (windows): the Rust core now owns window creation, including the
  // operator window this probe is running in. Report what it thinks is open,
  // and expose the openers so the other seven can be driven by hand against
  // real monitors — a webview console is not visible from a terminal, so the
  // answer is mirrored into the Rust log.
  void (async () => {
    const runtime = await import("./runtime");
    const { invoke } = await import("@tauri-apps/api/core");

    (
      window as unknown as { __presentWindows?: unknown }
    ).__presentWindows = {
      open: runtime.openWindow,
      close: runtime.closeWindow,
      openMiniLyrics: runtime.openMiniLyricsWindow,
      closeMiniLyrics: runtime.closeMiniLyricsWindow,
      list: runtime.listOpenWindows,
    };

    const open = await runtime.listOpenWindows();
    const summary = `windows=${JSON.stringify(open)}`;
    console.info("[Tauri]", summary);
    await invoke("report_diagnostic", { message: summary });
  })().catch((error: unknown) => {
    console.error("[Tauri] window probe failed", error);
  });
}
