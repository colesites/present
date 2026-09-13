/**
 * The rules NDI runs by, apart from the native calls.
 *
 * Extracted verbatim from `src/main/services/ndi.service.ts` and the
 * `ndi-frame` handler in `src/main/services/protocol.service.ts`, so they can be
 * tested without an Electron runtime or an NDI library, and so the Rust port in
 * `src-tauri/src/services/ndi/` can be checked against the same cases. Both
 * Electron files import from here. Behaviour is unchanged — see
 * `tests/ndi-rules.test.mjs` for the characterisation suite that pins it.
 */

export const NDI_DEFAULT_SOURCE_NAME = "Present Main Output";
export const NDI_DEFAULT_GROUP_NAME = "Public";

/** `Math.floor(1000 / 30)`: the capture interval, not the declared rate. */
export const NDI_OUTPUT_INTERVAL_MS = 33;
/** 30000/1000 — exactly 30 fps, not the 30000/1001 of broadcast video. */
export const NDI_FRAME_RATE_N = 30000;
export const NDI_FRAME_RATE_D = 1000;
/** `NDI_LIB_FOURCC('B', 'G', 'R', 'A')`, which is also grandi's `FourCC.BGRA`. */
export const NDI_FOURCC_BGRA = 1095911234;
/** `NDIlib_frame_format_type_progressive`, which is also grandi's `FrameType.Progressive`. */
export const NDI_FRAME_FORMAT_PROGRESSIVE = 1;

/** Sent while there is no audience window to capture. Every byte zero. */
export const NDI_FALLBACK_WIDTH = 1280;
export const NDI_FALLBACK_HEIGHT = 720;

export const NDI_DISCOVERY_WAIT_MS = 1200;

export const NDI_INPUT_CAPTURE_TIMEOUT_MS = 1000;
export const NDI_INPUT_FRAME_INTERVAL_MS = 125;
export const NDI_INPUT_MAX_WIDTH = 1280;
export const NDI_INPUT_JPEG_QUALITY = 72;
export const NDI_INPUT_STOP_DELAY_MS = 1200;
export const NDI_INPUT_RETRY_DELAY_MS = 250;
export const NDI_INPUT_RECEIVER_NAME = "Present NDI Prop Receiver";
export const NDI_INPUT_NO_SOURCE_ERROR = "Select an NDI source first.";

/** @param {string} value */
export const normalizeNdiSourceName = (value) => {
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : NDI_DEFAULT_SOURCE_NAME;
};

/** @param {string} value */
export const normalizeNdiGroupName = (value) => {
  const normalized = value.trim();
  if (normalized.length === 0) {
    return NDI_DEFAULT_GROUP_NAME;
  }
  return normalized.toLowerCase() === "public" ? NDI_DEFAULT_GROUP_NAME : normalized;
};

/** @param {string | null | undefined} value */
export const normalizeNdiInputClientId = (value) => {
  const normalized = value?.trim() ?? "";
  return normalized.length > 0 ? normalized : null;
};

/**
 * What the sender is created with. Video clocks the send, audio does not: the
 * stream carries no audio at all.
 *
 * @param {string} sourceName already normalised
 * @param {string} groupName already normalised
 */
export const ndiSenderOptions = (sourceName, groupName) => ({
  name: sourceName,
  groups: groupName,
  group: groupName,
  clockVideo: true,
  clockAudio: false,
});

/**
 * The frame header grandi is handed, without the pixels.
 *
 * `enums` carries the library's own values when it exports them; the numbers
 * after `??` are what they are when it does not, and are the NDI SDK's.
 *
 * @param {number} width
 * @param {number} height
 * @param {{ bgra?: number, progressive?: number }} [enums]
 */
export const describeNdiVideoFrame = (width, height, enums = {}) => ({
  xres: width,
  yres: height,
  frameRateN: NDI_FRAME_RATE_N,
  frameRateD: NDI_FRAME_RATE_D,
  pictureAspectRatio: width / height,
  lineStrideBytes: width * 4,
  frameFormatType: enums.progressive ?? NDI_FRAME_FORMAT_PROGRESSIVE,
  fourCC: enums.bgra ?? NDI_FOURCC_BGRA,
});

/**
 * @param {string | undefined} groupName
 */
export const ndiDiscoveryOptions = (groupName) => ({
  showLocalSources: true,
  groups: groupName ? normalizeNdiGroupName(groupName) : undefined,
});

/**
 * Named sources only, alphabetically.
 *
 * @template {{ name?: unknown }} T
 * @param {T[]} sources
 * @returns {T[]}
 */
export const orderNdiSources = (sources) =>
  sources
    .filter((source) => typeof source.name === "string" && source.name.length > 0)
    .sort((a, b) => /** @type {string} */ (a.name).localeCompare(/** @type {string} */ (b.name)));

/**
 * @typedef {{
 *   receiving: boolean,
 *   sourceName: string | null,
 *   clientIds: string[],
 * }} NdiInputState
 *
 * One receiver for the whole app, shared by every surface showing an NDI prop.
 * `receiving` is whether a receiver exists; `clientIds` is who is using it.
 */

/**
 * What `startNdiInput` does before it touches the library.
 *
 * - `rejected`: no source named. The caller's own claim is dropped, and the
 *   receiver stops at once if nobody else holds it.
 * - `reuse`: the receiver is already on this source; the caller joins it.
 * - `connect`: anything else. The receiver is torn down — **every** other
 *   client with it, whatever source they were showing — and a new one opened
 *   for this caller alone. Two props on two different sources therefore take
 *   the one receiver from each other.
 *
 * @param {NdiInputState} state
 * @param {string} sourceName
 * @param {string | null | undefined} clientId
 */
export const planNdiInputStart = (state, sourceName, clientId) => {
  const normalizedSourceName = sourceName.trim();
  const client = normalizeNdiInputClientId(clientId);
  const clientIds = new Set(state.clientIds);

  if (!normalizedSourceName) {
    if (client) {
      clientIds.delete(client);
    }
    const stopNow = clientIds.size === 0;
    return /** @type {const} */ ({
      kind: "rejected",
      error: NDI_INPUT_NO_SOURCE_ERROR,
      stopNow,
      clientIds: [...clientIds],
    });
  }

  if (state.receiving && state.sourceName === normalizedSourceName) {
    if (client) {
      clientIds.add(client);
    }
    return /** @type {const} */ ({
      kind: "reuse",
      sourceName: normalizedSourceName,
      clientIds: [...clientIds],
    });
  }

  return /** @type {const} */ ({
    kind: "connect",
    sourceName: normalizedSourceName,
    clientId: client,
  });
};

/**
 * What `stopNdiInput` does.
 *
 * - `keep`: somebody else still holds the receiver.
 * - `reset`: there is no receiver; forget the source and the last frame.
 * - `stop-later`: the last client left. The receiver survives
 *   `NDI_INPUT_STOP_DELAY_MS` so a prop that unmounts and remounts — a slide
 *   change re-rendering the layer — does not tear down the connection and
 *   wait for NDI to find the source again.
 *
 * A call without a client id releases everybody.
 *
 * @param {NdiInputState} state
 * @param {string | null | undefined} clientId
 */
export const planNdiInputStop = (state, clientId) => {
  const client = normalizeNdiInputClientId(clientId);
  const clientIds = new Set(state.clientIds);

  if (client) {
    clientIds.delete(client);
    if (clientIds.size > 0) {
      return /** @type {const} */ ({ kind: "keep", clientIds: [...clientIds] });
    }
  } else {
    clientIds.clear();
  }

  if (!state.receiving) {
    return /** @type {const} */ ({ kind: "reset", clientIds: [] });
  }

  return /** @type {const} */ ({
    kind: "stop-later",
    delayMs: NDI_INPUT_STOP_DELAY_MS,
    clientIds: [],
  });
};

/**
 * Whether a received frame is worth keeping. The receiver delivers at the
 * source's rate; the prop polls at eight a second, so everything between is
 * dropped before it is encoded.
 *
 * @param {number} nowMs
 * @param {number} lastFrameAtMs 0 before the first frame
 */
export const shouldKeepNdiInputFrame = (nowMs, lastFrameAtMs) =>
  nowMs - lastFrameAtMs >= NDI_INPUT_FRAME_INTERVAL_MS;

/**
 * @param {{ xres: number, yres: number, data?: unknown } | null | undefined} frame
 */
export const isUsableNdiInputFrame = (frame) =>
  Boolean(frame && frame.xres > 0 && frame.yres > 0 && frame.data);

/**
 * @template Data
 * @typedef {{
 *   data: Data | null,
 *   contentType: string,
 *   updatedAtMs: number,
 *   error: string | null,
 * }} NdiInputFrame
 */

/**
 * The latest frame, as asked for by source name.
 *
 * Asking for a source other than the one being received gets nothing, rather
 * than a frame from the wrong camera. Asking for a source while *nothing* is
 * being received gets the (empty) latest frame and whatever error is recorded.
 *
 * @template Data
 * @param {{
 *   sourceName: string | null,
 *   image: Data | null,
 *   contentType: string,
 *   frameAtMs: number,
 *   lastError: string | null,
 * }} active
 * @param {string | null | undefined} requestedSourceName
 * @returns {NdiInputFrame<Data>}
 */
export const selectNdiInputFrame = (active, requestedSourceName) => {
  if (requestedSourceName && active.sourceName && requestedSourceName !== active.sourceName) {
    return {
      data: null,
      contentType: active.contentType,
      updatedAtMs: 0,
      error: `NDI source "${requestedSourceName}" is not active.`,
    };
  }
  return {
    data: active.image,
    contentType: active.contentType,
    updatedAtMs: active.frameAtMs,
    error: active.lastError,
  };
};

/**
 * The source an `ndi-frame://frame/<name>` request names, or null for none.
 * A malformed escape throws, as `decodeURIComponent` does.
 *
 * @param {string} url
 */
export const ndiFrameRequestSourceName = (url) =>
  decodeURIComponent(new URL(url).pathname.replace(/^\/+/, "")) || null;

/**
 * Status and headers for an `ndi-frame` response. No frame — none received
 * yet, the wrong source asked for, or a receiver error — is a 204 with no
 * body, and the error is not surfaced.
 *
 * @param {{ data: unknown, contentType: string, updatedAtMs: number }} frame
 */
export const ndiFrameResponse = (frame) =>
  frame.data
    ? {
        status: 200,
        headers: {
          "Cache-Control": "no-store",
          "Content-Type": frame.contentType,
          "X-NDI-Frame-Updated-At": String(frame.updatedAtMs),
        },
      }
    : { status: 204, headers: { "Cache-Control": "no-store" } };
