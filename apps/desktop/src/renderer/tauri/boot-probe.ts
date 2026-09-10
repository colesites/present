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

if (shouldProbe) {
  // Stage 3 (native APIs): prove the containment boundary from inside the
  // webview, which is the only place that can prove it. Two attempts that must
  // both fail, and one report of what is actually reachable.
  void (async () => {
    const { invoke } = await import("@tauri-apps/api/core");
    const runtime = await import("./electron-bridge");

    const folders = await invoke("list_media_folders");

    // A folder nobody granted. `read_folder` must refuse it by kind, not by
    // whether it happens to exist.
    let refusal = "NOT REFUSED — the scope is open";
    try {
      await invoke("read_folder", { folderPath: "/etc" });
    } catch (error) {
      const kind = (error as { kind?: string } | null)?.kind;
      refusal = kind === "denied" ? "denied" : `unexpected kind: ${String(kind)}`;
    }

    // The same question asked the way an attacker would: straight at the media
    // scheme, which is the hole this stage closed.
    let protocolStatus = "no response";
    try {
      const response = await fetch(runtime.localMediaUrl("/etc/passwd"));
      protocolStatus = String(response.status);
    } catch (error) {
      protocolStatus = `threw: ${String(error)}`;
    }

    // The other half of the gate: a file the operator *did* grant has to be
    // served, and served in ranges, or every video in the app stops playing.
    let granted = "no media folder to test";
    const first = (folders as { path: string }[])[0];
    if (first) {
      const files = await invoke<{ name: string }[]>("read_folder", {
        folderPath: first.path,
      });
      if (files.length === 0) {
        granted = `${first.path} is empty`;
      } else {
        const url = runtime.localMediaUrl(`${first.path}/${files[0].name}`);
        const response = await fetch(url, { headers: { Range: "bytes=0-15" } });
        const body = await response.arrayBuffer();
        granted =
          `${response.status} ` +
          `range=${response.headers.get("Content-Range") ?? "none"} ` +
          `bytes=${body.byteLength}`;
      }
    }

    const summary =
      `mediaFolders=${JSON.stringify(folders)} ` +
      `readFolderOutsideScope=${refusal} ` +
      `localMediaOutsideScope=${protocolStatus} ` +
      `localMediaInsideScope=${granted}`;
    console.info("[Tauri]", summary);
    await invoke("report_diagnostic", { message: summary });

    // The dialogs need a human. Exposed so the eight of them can be driven by
    // hand against real hardware, the same way the window openers are.
    (window as unknown as { __presentFiles?: unknown }).__presentFiles = {
      selectFolder: () => invoke("select_folder"),
      selectMediaFile: () => invoke("select_media_file"),
      selectAudioFiles: () => invoke("select_audio_files"),
      selectPropImage: () => invoke("select_prop_image"),
      selectPropMedia: () => invoke("select_prop_media"),
      selectPresentationFiles: () => invoke("select_presentation_files"),
      selectLibraryExportDestination: () => invoke("select_library_export_destination"),
      selectLibraryImportSource: () => invoke("select_library_import_source"),
      listMediaFolders: () => invoke("list_media_folders"),
      removeMediaFolder: (id: string) => invoke("remove_media_folder", { id }),
      readFolder: (folderPath: string) => invoke("read_folder", { folderPath }),
      microphoneStatus: () => invoke("get_microphone_access_status"),
      cameraStatus: () => invoke("get_camera_access_status"),
      requestMicrophone: () => invoke("request_microphone_access"),
      mediaUrl: runtime.localMediaUrl,
    };
  })().catch((error: unknown) => {
    console.error("[Tauri] file scope probe failed", error);
    // Mirrored, unlike the probes above: this one is the security gate, and a
    // probe that fails silently is indistinguishable from a gate that passed.
    void import("@tauri-apps/api/core").then(({ invoke }) =>
      invoke("report_diagnostic", {
        message: `file scope probe failed: ${String(error)}`,
      }),
    );
  });
}

if (shouldProbe) {
  // Stage 4 (output layer flags): the first slice of the presentation core to
  // be Rust-owned. What needs proving live is not the reducer — that has twin
  // test suites in both languages — but the delivery: a change made in one
  // window has to reach the others in the same tick, which is exactly what the
  // 400 ms localStorage poll could not do.
  void (async () => {
    const { invoke } = await import("@tauri-apps/api/core");
    const looks = await import("./looks");

    (window as unknown as { __presentLooks?: unknown }).__presentLooks = looks;

    const config = await looks.getLooksConfig();
    const live = config.looks.find((look) => look.id === config.liveLookId);
    let roundTrip = "not attempted (release build)";

    // The round trip writes to the config file, so it runs in development
    // only. A release launch reports what it reads and changes nothing.
    const { debugBuild } = await getAppInfo();
    if (debugBuild && live) {
      const before = live.targets.program.layers.slide;

      const heard = await new Promise<string>((resolve) => {
        const timeout = window.setTimeout(() => {
          void detach.then((stop) => stop());
          resolve("TIMED OUT — the event never arrived");
        }, 2000);

        const detach = looks.onLooksChanged((next) => {
          const after = next.looks.find((look) => look.id === next.liveLookId);
          if (after?.targets.program.layers.slide === !before) {
            window.clearTimeout(timeout);
            void detach.then((stop) => stop());
            resolve("delivered");
          }
        });

        void detach.then(() =>
          looks.setLookLayer(live.id, "program", "slide", !before),
        );
      });

      // Put it back, whatever happened.
      await looks.setLookLayer(live.id, "program", "slide", before);
      roundTrip = heard;
    }

    const summary =
      `looks=${config.looks.length} live=${config.liveLookId} ` +
      `target=${config.selectedTarget} ` +
      `programLayers=${JSON.stringify(live?.targets.program.layers)} ` +
      `changeEvent=${roundTrip}`;
    console.info("[Tauri]", summary);
    await invoke("report_diagnostic", { message: summary });
  })().catch((error: unknown) => {
    console.error("[Tauri] looks probe failed", error);
    void import("@tauri-apps/api/core").then(({ invoke }) =>
      invoke("report_diagnostic", { message: `looks probe failed: ${String(error)}` }),
    );
  });
}
