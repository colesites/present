/**
 * A Tauri-backed `window.electronAPI`.
 *
 * The React tree — 208 files, ~62 000 lines — talks to the native layer through
 * `window.electronAPI`, which the Electron preload script defines. Under Tauri
 * that object does not exist, so every panel that touches a file, a display or a
 * window throws on mount.
 *
 * Rewriting those call sites is Stage 4 work and the migration rules forbid
 * doing it as a big bang. This module fills the same shape from Rust commands
 * instead, so the UI keeps calling what it already calls. It is deliberately a
 * temporary layer: when a subsystem moves to a Rust-owned state slice, its entry
 * here goes away with the call sites.
 *
 * Only the channels Rust actually implements are defined. Anything else reads as
 * `undefined`, which is what the feature checks scattered through the UI already
 * test for — and every such access is reported once, into the Rust log, because
 * a Tauri webview's console cannot be read from a terminal. That report is the
 * running list of what Stages 4 to 7 still owe.
 */

import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

import { isTauri } from "./runtime";

const noop = (): void => undefined;

/** Matches `MediaFolder` in `src-tauri/src/state/file_state.rs`. */
type MediaFolder = { id: string; name: string; path: string };

/**
 * Subscribe to a Rust event, returning the synchronous unsubscribe function the
 * Electron API's callers expect.
 *
 * `listen` resolves asynchronously, so an unsubscribe called before it settles
 * has nothing to detach yet. The flag covers that: a listener that arrives after
 * its own teardown removes itself immediately, rather than surviving the
 * component that asked for it.
 */
const subscribe = (event: string, handler: (payload: never) => void): (() => void) => {
  let detach: UnlistenFn | null = null;
  let cancelled = false;

  void listen(event, (message) => handler(message.payload as never))
    .then((unlisten) => {
      if (cancelled) {
        unlisten();
        return;
      }
      detach = unlisten;
    })
    .catch((error: unknown) => {
      console.error(`[Tauri] could not subscribe to ${event}`, error);
    });

  return () => {
    cancelled = true;
    detach?.();
    detach = null;
  };
};

/** Base64 to bytes, for the presentation files the picker returns. */
const decodeBase64 = (encoded: string): Uint8Array => {
  const binary = atob(encoded);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
};

/**
 * The URL the webview fetches a local file through.
 *
 * Mirrors `url_for` in `src-tauri/src/services/media_protocol.rs`; the two must
 * agree, because a URL built here is served by that handler. Differs from the
 * `encodeURI` the Electron code uses in one way: `#` and `?` are escaped, so a
 * file called `Set #2.mp4` plays instead of 404ing.
 */
export const localMediaUrl = (filePath: string): string => {
  const absolute = filePath.startsWith("/") ? filePath : `/${filePath}`;
  const encoded = encodeURI(absolute).replace(/#/g, "%23").replace(/\?/g, "%3F");
  return navigator.userAgent.includes("Windows")
    ? `http://local-media.localhost/media${encoded}`
    : `local-media://media${encoded}`;
};

type ScreenRole = "audience" | "media" | "worship";

const openRoleWindow = (
  role: "output" | "media-stage" | "worship-stage",
  displayId?: number | null,
  resolution?: string | null,
): Promise<boolean> =>
  invoke("open_window", {
    role,
    options: { displayId: displayId ?? null, resolution: resolution ?? null },
  });

/**
 * The Electron API surface, as far as Rust implements it today.
 *
 * Grouped by the stage that owns each block so the gaps are visible.
 */
const bridge = {
  // --- Stage 2: windows and displays -------------------------------------
  openOutputWindow: (displayId?: number | null, resolution?: string | null) =>
    openRoleWindow("output", displayId, resolution),
  closeOutputWindow: () => invoke<boolean>("close_window", { role: "output" }),
  openMediaStageWindow: (displayId?: number | null, resolution?: string | null) =>
    openRoleWindow("media-stage", displayId, resolution),
  closeMediaStageWindow: () => invoke<boolean>("close_window", { role: "media-stage" }),
  openWorshipStageWindow: (displayId?: number | null, resolution?: string | null) =>
    openRoleWindow("worship-stage", displayId, resolution),
  closeWorshipStageWindow: () => invoke<boolean>("close_window", { role: "worship-stage" }),
  openLooksWindow: () => invoke<boolean>("open_window", { role: "looks", options: null }),
  closeLooksWindow: () => invoke<boolean>("close_window", { role: "looks" }),
  openScreenComposerWindow: () =>
    invoke<boolean>("open_window", { role: "screen-composer", options: null }),
  closeScreenComposerWindow: () =>
    invoke<boolean>("close_window", { role: "screen-composer" }),
  openMiniLyricsWindow: (payload: { libraryId: string; title?: string }) =>
    invoke<boolean>("open_mini_lyrics_window", { payload }),
  closeMiniLyricsWindow: (libraryId: string) =>
    invoke<boolean>("close_mini_lyrics_window", { libraryId }),

  getDisplays: () => invoke("get_displays"),
  setPreferredDisplay: async (role: ScreenRole, displayId: number | null) => {
    await invoke("set_preferred_display", { role, displayId });
    return true;
  },
  getPreferredDisplay: async (role: ScreenRole) => {
    const resolved = await invoke<{ display: { id: number } } | null>(
      "get_preferred_display",
      { role },
    );
    return resolved?.display.id ?? null;
  },
  // The output window's display is the audience role under a older name the UI
  // still uses in places (`window.ipc.ts:43-57`).
  setPreferredOutputDisplay: async (displayId: number | null) => {
    await invoke("set_preferred_display", { role: "audience", displayId });
    return true;
  },
  getPreferredOutputDisplay: async () => {
    const resolved = await invoke<{ display: { id: number } } | null>(
      "get_preferred_display",
      { role: "audience" },
    );
    return resolved?.display.id ?? null;
  },
  setPreferredResolution: async (role: ScreenRole, resolution: string | null) => {
    if (!resolution) return false;
    await invoke("set_preferred_resolution", { role, resolution });
    return true;
  },

  onOutputWindowClosed: (callback: () => void) =>
    subscribe("output-window-closed", callback),
  onMediaStageWindowClosed: (callback: () => void) =>
    subscribe("media-stage-window-closed", callback),
  onWorshipStageWindowClosed: (callback: () => void) =>
    subscribe("worship-stage-window-closed", callback),

  // --- Stage 3: files, dialogs, menu, shortcut, deep links ---------------
  selectFolder: () => invoke<MediaFolder | null>("select_folder"),
  selectLibraryExportDestination: (suggestedName?: string) =>
    invoke<string | null>("select_library_export_destination", {
      suggestedName: suggestedName ?? null,
    }),
  readFolder: (folderPath: string) =>
    invoke<{ name: string; lastModified: number }[]>("read_folder", { folderPath }),
  selectMediaFile: () => invoke("select_media_file"),
  selectAudioFiles: () => invoke("select_audio_files"),
  selectPropImage: () => invoke("select_prop_image"),
  selectPropMedia: () => invoke("select_prop_media"),
  selectPresentationFiles: async () => {
    const picked = await invoke<
      { name: string; path: string; bytes: string; lastModified: number }[] | null
    >("select_presentation_files");
    if (!picked) return null;
    // Rust sends base64 rather than a JSON array of 30 million numbers.
    return picked.map((file) => ({ ...file, bytes: decodeBase64(file.bytes) }));
  },
  copyMediaFile: (source: string, target: string) =>
    invoke<boolean>("copy_media_file", { source, target }),
  renameMediaFile: (oldPath: string, newName: string) =>
    invoke<{ path: string; name: string }>("rename_media_file", { oldPath, newName }),
  deleteMediaFile: (filePath: string) => invoke<boolean>("delete_media_file", { filePath }),
  createDirectory: (parent: string, name: string) =>
    invoke<string>("create_directory", { parent, name }),
  renameDirectory: (oldPath: string, newPath: string) =>
    invoke<boolean>("rename_directory", { oldPath, newPath }),
  exportLibraryBundle: (destinationPath: string, items: unknown[]) =>
    invoke<{ path: string; itemCount: number }>("export_library_bundle", {
      destinationPath,
      items,
    }),
  importLibraryBundle: (folderPath: string) =>
    invoke("import_library_bundle", { folderPath }),

  requestMicrophoneAccess: () => invoke("request_microphone_access"),
  requestCameraAccess: () => invoke("request_camera_access"),

  onAiOperatorToggleShortcut: (callback: () => void) =>
    subscribe("ai-operator:toggle-shortcut", callback),
  onOpenImportFromMenu: (callback: (mode?: "presentation" | "images") => void) =>
    subscribe("open-import", callback as (payload: never) => void),
  // Under Electron the menu tells the renderer to open Settings; under Tauri
  // the menu handler opens the window itself, so there is nothing to deliver.
  // Defined rather than omitted so the subscription in `App.tsx` is a no-op
  // instead of a crash.
  onOpenSettingsFromMenu: () => noop,
  onAuthCallback: (callback: (payload: unknown) => void) => {
    const detach = subscribe("auth-callback", callback as (payload: never) => void);
    // A `present://` link can launch the app, in which case Rust handled it
    // before this listener existed. Ask for the one it held back.
    void invoke<unknown>("take_pending_deep_link")
      .then((pending) => {
        if (pending) callback(pending);
      })
      .catch((error: unknown) => {
        console.error("[Tauri] could not collect a pending deep link", error);
      });
    return detach;
  },
};

/** Property names the bridge implements. */
const implemented = new Set(Object.keys(bridge));

/** Reported once each, so one missing channel is not a console flood. */
const reported = new Set<string>();

const reportMissing = (name: string) => {
  if (reported.has(name)) return;
  reported.add(name);

  const message = `electronAPI.${name} is not bridged to Rust yet`;
  console.warn(`[Tauri] ${message}`);
  // Mirrored into the Rust log because a Tauri webview's console is invisible
  // from a terminal. This is how the remaining work gets inventoried.
  // A failed report is not worth surfacing: the console warning above already
  // said everything, and this path exists only because that console is not
  // readable from a terminal.
  void invoke("report_diagnostic", { message }).catch(noop);
};

/**
 * Install the bridge. Safe to call more than once; only the first takes effect.
 *
 * Six of the eight windows load the same HTML entry, so this runs once per open
 * window — hence the idempotence rather than an assertion.
 */
export const installElectronBridge = (): void => {
  if (!isTauri()) return;
  if ("electronAPI" in window) return;

  const proxied = new Proxy(bridge, {
    get(target, property, receiver) {
      if (typeof property === "string" && !implemented.has(property)) {
        reportMissing(property);
        return undefined;
      }
      return Reflect.get(target, property, receiver);
    },
    has(target, property) {
      // `'x' in window.electronAPI` must agree with what `get` returns, or a
      // feature check passes and the call that follows throws.
      return typeof property === "string" && implemented.has(property);
    },
  });

  Object.defineProperty(window, "electronAPI", {
    value: proxied,
    configurable: false,
    enumerable: true,
    writable: false,
  });
};
