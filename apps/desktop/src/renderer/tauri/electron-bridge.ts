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
        safelyUnlisten(unlisten);
        return;
      }
      detach = unlisten;
    })
    .catch((error: unknown) => {
      console.error(`[Tauri] could not subscribe to ${event}`, error);
    });

  return () => {
    cancelled = true;
    const stop = detach;
    detach = null;
    safelyUnlisten(stop);
  };
};

type StageTarget = "media-stage" | "worship-stage";

const relayToStage = (target: StageTarget, payload: unknown): void => {
  void invoke("send_to_stage", { target, payload }).catch((error: unknown) => {
    console.error(`[Stage] ${target} message rejected by the Rust core`, error);
  });
};

/**
 * Deliver a stage display what it missed, then everything after.
 *
 * The listener goes on first so nothing sent while the replay is on its way
 * is lost; what arrives in that gap is held and applied after the replay, so
 * an older kept message can never overwrite a newer live one.
 */
const subscribeToStage = (
  target: StageTarget,
  event: string,
  callback: (payload: unknown) => void,
): (() => void) => {
  let replayed = false;
  let cancelled = false;
  const held: unknown[] = [];

  const stop = subscribe(event, (payload: never) => {
    if (cancelled) return;
    if (replayed) callback(payload);
    else held.push(payload);
  });

  void invoke<unknown[]>("get_stage_messages", { target })
    .catch((error: unknown) => {
      console.error(`[Stage] could not read what ${target} missed`, error);
      return [] as unknown[];
    })
    .then((missed) => {
      if (cancelled) return;
      for (const message of missed) callback(message);
      replayed = true;
      for (const message of held.splice(0)) callback(message);
    });

  return () => {
    cancelled = true;
    stop();
  };
};

/**
 * Detach a listener without ever throwing.
 *
 * Tauri's unlisten looks the listener up by id and throws
 * ("undefined is not an object (evaluating 'listeners[eventId].handlerId')")
 * when it is already gone. That happens on a Vite hot reload, which resets the
 * injected registry while the closure still holds the old id, and it surfaces
 * as an unhandled rejection rather than anything actionable.
 *
 * Failing to detach a listener that no longer exists is the outcome we wanted
 * anyway, so it is swallowed rather than reported.
 *
 * **Both** failure modes have to be caught, which is what this originally got
 * wrong. `UnlistenFn` is typed as returning `void`, but Tauri's implementation
 * calls an async `unregisterListener` and returns its promise, so the lookup
 * failure arrives as a *rejection* rather than a synchronous throw — straight
 * past a bare `try`/`catch` and out as `window.unhandledrejection`. Fifteen of
 * them reached the Rust error log on one clean launch, each one indistinguishable
 * from a real renderer failure at a glance.
 */
export const safelyUnlisten = (unlisten: (() => void) | null | undefined): void => {
  try {
    // Typed `void`, actually a promise. Not `await`ed: callers are synchronous
    // teardown functions, and there is nothing to do with the outcome anyway.
    const settled = unlisten?.() as unknown as Promise<void> | undefined;
    if (settled && typeof settled.catch === "function") {
      settled.catch((): void => undefined);
    }
  } catch {
    // Already detached.
  }
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

/**
 * Where the web app lives, resolved exactly as `desktopSession.ts:97-104` does.
 *
 * Rust does not resolve this itself: it is a build-time constant of the
 * renderer, and working it out in two places would give two answers the first
 * time someone overrode it.
 */
const webAppBaseUrl = (): string =>
  process.env.WEB_APP_URL ||
  (process.env.NODE_ENV === "development"
    ? "http://localhost:3001"
    : "https://present.multivrs.space");

/**
 * The base URLs a session refresh will try, in order.
 *
 * Ports `getWebAppBaseUrlCandidates` (`app.utils.ts:26-46`): a developer's web
 * app may be on either of two ports, and production is always worth a try.
 */
const webAppBaseUrlCandidates = (): string[] => {
  const candidates = new Set<string>();
  const configured = process.env.WEB_APP_URL?.trim();

  if (configured) {
    candidates.add(configured);
    if (configured === "http://localhost:3000") candidates.add("http://localhost:3001");
    if (configured === "http://localhost:3001") candidates.add("http://localhost:3000");
  }
  if (process.env.NODE_ENV === "development") {
    candidates.add("http://localhost:3001");
    candidates.add("http://localhost:3000");
  }
  candidates.add("https://present.multivrs.space");

  return [...candidates];
};

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
  // The payload now carries the body too: the editor asks the core what it is
  // editing rather than waiting to be sent it, so the core has to know.
  openMiniLyricsWindow: (payload: unknown) =>
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

  // --- Stage 4: the auth session ----------------------------------------
  // Pulled ahead of Stage 7 because nothing else in the app can be seen
  // working until the operator window gets past sign-in.
  getStoredAuthSession: () => invoke("get_stored_auth_session"),
  setStoredAuthSession: (payload: unknown) =>
    invoke<boolean>("set_stored_auth_session", { payload }),
  clearStoredAuthSession: () => invoke<boolean>("clear_stored_auth_session"),
  consumePendingAuthToken: () => invoke("consume_pending_auth_token"),
  beginAuthFlow: () => invoke("begin_auth_flow", { webAppBaseUrl: webAppBaseUrl() }),
  refreshDesktopSession: (sessionToken: string) =>
    invoke("refresh_desktop_session", {
      webAppBaseUrls: webAppBaseUrlCandidates(),
      sessionToken,
    }),
  openExternalBrowser: (url: string) => invoke<boolean>("open_external_browser", { url }),

  // --- Stage 4: the audience scene --------------------------------------
  sendToOutput: (payload: unknown) => {
    void invoke("send_to_output", { payload }).catch((error: unknown) => {
      console.error("[Output] update rejected by the Rust core", error);
    });
  },

  // --- Stage 7: the two stage displays ----------------------------------
  // Their own feed, not the audience scene: the confidence monitor shows the
  // next slide, which no scene carries. Rust keeps the last message of each
  // type, so a stage display that opens mid-service is sent what it missed
  // instead of waiting for the `*-ready` handshake below.
  sendToStage: (payload: unknown) => relayToStage("media-stage", payload),
  sendToWorshipStage: (payload: unknown) => relayToStage("worship-stage", payload),
  onStageData: (callback: (payload: unknown) => void) =>
    subscribeToStage("media-stage", "stage-data", callback),
  onWorshipStageData: (callback: (payload: unknown) => void) =>
    subscribeToStage("worship-stage", "worship-stage-data", callback),

  // The late-join handshake is gone. A window that opens mid-service asks for
  // the scene rather than asking the operator window to repeat itself, so
  // there is nothing to notify and nothing to wait for.
  notifyOutputReady: noop,
  notifyStageReady: noop,
  notifyWorshipStageReady: noop,
  onOutputReady: () => noop,
  onStageReady: () => noop,
  onWorshipStageReady: () => noop,

  // The mini lyrics editor. The `mini-lyrics:ready` handshake is gone — the
  // window asks for its payload the way a late-joining output window asks for
  // the scene.
  onMiniLyricsData: (callback: (payload: unknown) => void) => {
    const libraryId = new URLSearchParams(window.location.search).get("libraryId");
    if (!libraryId) return noop;

    let cancelled = false;
    void invoke<unknown>("get_mini_lyrics_payload", { libraryId })
      .then((payload) => {
        if (payload && !cancelled) callback(payload);
      })
      .catch((error: unknown) => {
        console.error("[MiniLyrics] could not read the payload", error);
      });

    return () => {
      cancelled = true;
    };
  },
  notifyMiniLyricsReady: noop,
  saveMiniLyrics: (payload: unknown) => invoke("save_mini_lyrics", { payload }),
  onMiniLyricsSaveRequest: (callback: (request: never) => void) =>
    subscribe("mini-lyrics:save-request", callback),
  respondMiniLyricsSave: (response: unknown) => {
    void invoke("respond_mini_lyrics_save", { response }).catch(noop);
  },

  // --- Stage 6: NDI output ----------------------------------------------
  // Same payloads as `ndi:start` / `ndi:stop` / `ndi:status`, so Settings did
  // not change. The frames come from the Rust compositor rather than a
  // capture of the audience window.
  startNdiOutput: (sourceName: string, groupName: string) =>
    invoke("start_ndi_output", { sourceName, groupName }),
  stopNdiOutput: () => invoke<void>("stop_ndi_output"),
  getNdiStatus: () => invoke("get_ndi_status"),
  // NDI props: discovery for the Layers panel, and the receiver the prop
  // layers share. Frames arrive through `ndi-frame://`, as under Electron.
  listNdiSources: (groupName?: string) =>
    invoke("list_ndi_sources", { groupName: groupName ?? null }),
  startNdiInput: (sourceName: string, groupName?: string, clientId?: string) =>
    invoke("start_ndi_input", {
      sourceName,
      groupName: groupName ?? null,
      clientId: clientId ?? null,
    }),
  stopNdiInput: (clientId?: string) =>
    invoke<void>("stop_ndi_input", { clientId: clientId ?? null }),
  // --- Stage 7: the AI Operator's tool definitions ----------------------
  listAiOperatorTools: () => invoke("list_ai_operator_tools"),

  // --- Stage 7: Bibles -------------------------------------------------
  // The payloads of `list-bundled-bibles`, `read-bundled-bible` and
  // `fetch-hosted-bible-catalog`. A Bible's bytes come back as binary, not as
  // a JSON array of five million numbers; like Electron, a refusal is `null`.
  listBundledBibles: () => invoke("list_bundled_bibles"),
  readBundledBible: async (filePath: string) => {
    try {
      const bytes = await invoke<ArrayBuffer>("read_bundled_bible", { filePath });
      return new Uint8Array(bytes);
    } catch (error) {
      console.error("[Tauri] could not read a bundled Bible", error);
      return null;
    }
  },
  fetchHostedBibleCatalog: (catalogUrl: string) =>
    invoke("fetch_hosted_bible_catalog", { catalogUrl }),

  // The opt-in natively drawn audience screen. Tauri only: Settings shows the
  // switch when these exist, so the Electron build never offers it.
  getNativeOutputSurface: () => invoke("get_output_surface"),
  setNativeOutputSurface: (enabled: boolean) =>
    invoke("set_output_surface_native", { enabled }),

  // Errors the renderer catches. Optional-chained at the call site, so
  // leaving this out meant every render failure vanished without trace.
  reportRendererError: (error: unknown) => {
    void invoke("report_renderer_error", { error }).catch(noop);
  },

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
/**
 * `window.fontAPI`, the preload's second global (`preload.ts:250-257`). The
 * font pickers read it directly, so under Tauri they had only their
 * seven-family fallback list until this existed.
 */
const fontApi = {
  getSystemFonts: () => invoke<string[]>("get_system_fonts"),
  getSystemFontFaces: () => invoke("get_system_font_faces"),
  pickFontFile: () => invoke<string[] | null>("pick_font_file"),
  installCustomFonts: (filePaths: string[]) =>
    invoke("install_custom_fonts", { filePaths: filePaths ?? [] }),
  getCustomFonts: () => invoke("get_custom_fonts"),
};

export const installElectronBridge = (): void => {
  if (!isTauri()) return;
  if (!("fontAPI" in window)) {
    Object.defineProperty(window, "fontAPI", {
      value: Object.freeze(fontApi),
      configurable: false,
      enumerable: true,
      writable: false,
    });
  }
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
