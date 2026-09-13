import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { app, nativeImage } from 'electron';
import {
  NDI_DISCOVERY_WAIT_MS,
  NDI_FALLBACK_HEIGHT,
  NDI_FALLBACK_WIDTH,
  NDI_FRAME_RATE_D,
  NDI_FRAME_RATE_N,
  NDI_INPUT_CAPTURE_TIMEOUT_MS,
  NDI_INPUT_JPEG_QUALITY,
  NDI_INPUT_MAX_WIDTH,
  NDI_INPUT_RECEIVER_NAME,
  NDI_INPUT_RETRY_DELAY_MS,
  NDI_OUTPUT_INTERVAL_MS,
  describeNdiVideoFrame,
  isUsableNdiInputFrame,
  ndiDiscoveryOptions,
  ndiSenderOptions,
  normalizeNdiGroupName,
  normalizeNdiSourceName,
  orderNdiSources,
  planNdiInputStart,
  planNdiInputStop,
  selectNdiInputFrame,
  shouldKeepNdiInputFrame,
} from '../../shared/lib/ndi-rules.mjs';
import { getOutputWindow } from '../windows/output.window';

type NdiLibraryKind = 'grandi' | 'grandiose';

type LoadedNdiLibrary = {
  kind: NdiLibraryKind;
  lib: Record<string, unknown>;
};

interface GrandioseSender {
  video: (frame: VideoFrame) => Promise<void>;
  destroy?: () => void;
  quit?: () => void;
}

type NdiSource = {
  name: string;
  urlAddress?: string;
};

interface GrandiFinder {
  sources: () => NdiSource[];
  wait: (timeoutMs?: number) => boolean;
  destroy: () => boolean;
}

interface GrandiReceiver {
  video: (timeoutMs?: number) => Promise<VideoFrame & { type?: string }>;
  destroy: () => boolean;
}

interface VideoFrame {
  xres: number;
  yres: number;
  data: Buffer;
  frameRateN: number;
  frameRateD: number;
  pictureAspectRatio?: number;
  lineStrideBytes?: number;
  frameFormatType?: number;
  fourCC?: number;
  colorFormat?: number;
}

type NdiStatus = {
  running: boolean;
  sourceName: string;
  groupName: string;
  lastError: string | null;
  libraryLoaded: boolean;
  framesSent: number;
  usingFallbackFrame: boolean;
};

let loadedNdiLibrary: LoadedNdiLibrary | null = null;
let ndiLibraryLoadPromise: Promise<LoadedNdiLibrary | null> | null = null;
let lastNdiLibraryLoadError: string | null = null;
let hasLoggedNdiLibraryLoadFailure = false;

let ndiSender: GrandioseSender | null = null;
let captureInterval: NodeJS.Timeout | null = null;
let isBroadcasting = false;
let sourceName = 'Present Main Output';
let groupName = 'Public';
let lastError: string | null = null;
let framesSent = 0;
let isFrameInFlight = false;
let usingFallbackFrame = false;
let ndiInitialized = false;

let ndiInputReceiver: GrandiReceiver | null = null;
let ndiInputSourceName: string | null = null;
let ndiInputLoopActive = false;
let ndiInputLastError: string | null = null;
let ndiInputLatestImage: Buffer | null = null;
let ndiInputLatestContentType = 'image/jpeg';
let ndiInputLatestFrameAtMs = 0;
let ndiInputStopTimer: NodeJS.Timeout | null = null;
const ndiInputClientIds = new Set<string>();

// The rules below the native calls — names, timings, frame headers, the
// shared-receiver bookkeeping — live in shared/lib/ndi-rules.mjs, where
// tests/ndi-rules.test.mjs pins them for the Rust port.
const fallbackFrameBuffer = Buffer.alloc(NDI_FALLBACK_WIDTH * NDI_FALLBACK_HEIGHT * 4);

// grandi ships ESM-only (main: dist/index.mjs) and bundles a native .node
// addon, so it can't live inside app.asar. In production it's staged into
// `Resources/node_modules` (see forge.config.ts prePackage hook) and imported
// by absolute file:// URL. In dev we resolve it from node_modules normally.
//
// webpackIgnore keeps the dynamic import out of the webpack graph so the
// literal survives into the bundle and hits Node's real ESM loader at runtime.
const resolvePackagedNdiEntry = (pkg: string): string | null => {
  try {
    const base = path.join(process.resourcesPath, 'node_modules', pkg);
    const manifestPath = path.join(base, 'package.json');
    if (!existsSync(manifestPath)) {
      return null;
    }
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as {
      main?: string;
      module?: string;
    };
    const entry = manifest.module ?? manifest.main ?? 'index.js';
    return path.join(base, entry);
  } catch {
    return null;
  }
};

const importNdiPackage = async (
  pkg: 'grandi' | 'grandiose',
): Promise<Record<string, unknown>> => {
  if (app.isPackaged) {
    const entry = resolvePackagedNdiEntry(pkg);
    if (!entry || !existsSync(entry)) {
      throw new Error(
        `${pkg} was not found in the packaged app resources. ` +
          `Expected it under Resources/node_modules/${pkg}.`,
      );
    }
    const specifier = pathToFileURL(entry).href;
    return (await import(/* webpackIgnore: true */ specifier)) as Record<
      string,
      unknown
    >;
  }
  // Development: resolve from the workspace node_modules.
  return (await import(/* webpackIgnore: true */ pkg)) as Record<string, unknown>;
};

const importGrandi = (): Promise<Record<string, unknown>> =>
  importNdiPackage('grandi');

const importGrandiose = (): Promise<Record<string, unknown>> =>
  importNdiPackage('grandiose');

const normalizeNamespace = (mod: Record<string, unknown>): Record<string, unknown> => {
  const defaultExport = mod['default'];
  if (defaultExport && typeof defaultExport === 'object') {
    return { ...(defaultExport as Record<string, unknown>), ...mod };
  }
  return mod;
};

const ensureNdiInitialized = (library: LoadedNdiLibrary): void => {
  if (ndiInitialized) {
    return;
  }
  const initialize = library.lib['initialize'];
  if (typeof initialize === 'function') {
    const ok = initialize();
    if (ok === false) {
      throw new Error('NDI initialization failed.');
    }
  }
  ndiInitialized = true;
};

const loadNdiLibrary = async (): Promise<LoadedNdiLibrary | null> => {
  if (loadedNdiLibrary) {
    return loadedNdiLibrary;
  }
  if (ndiLibraryLoadPromise) {
    return ndiLibraryLoadPromise;
  }

  ndiLibraryLoadPromise = (async () => {
    const errors: string[] = [];

    try {
      const mod = normalizeNamespace(await importGrandi());
      if (typeof mod['send'] !== 'function') {
        throw new Error('grandi loaded but no `send` export');
      }
      loadedNdiLibrary = { kind: 'grandi', lib: mod };
      ensureNdiInitialized(loadedNdiLibrary);
      lastNdiLibraryLoadError = null;
      console.log('[NDI] Loaded grandi backend.');
      return loadedNdiLibrary;
    } catch (err) {
      errors.push(`grandi: ${err instanceof Error ? err.message : String(err)}`);
    }

    try {
      const mod = normalizeNamespace(await importGrandiose());
      loadedNdiLibrary = { kind: 'grandiose', lib: mod };
      ensureNdiInitialized(loadedNdiLibrary);
      lastNdiLibraryLoadError = null;
      console.log('[NDI] Loaded grandiose backend.');
      return loadedNdiLibrary;
    } catch (err) {
      errors.push(`grandiose: ${err instanceof Error ? err.message : String(err)}`);
    }

    lastNdiLibraryLoadError = errors.join(' | ');
    if (!hasLoggedNdiLibraryLoadFailure) {
      hasLoggedNdiLibraryLoadFailure = true;
      console.error('[NDI] Failed to load any NDI native module:', lastNdiLibraryLoadError);
    }
    return null;
  })().finally(() => {
    ndiLibraryLoadPromise = null;
  });

  return ndiLibraryLoadPromise;
};

const clearScheduledNdiInputStop = (): void => {
  if (ndiInputStopTimer) {
    clearTimeout(ndiInputStopTimer);
    ndiInputStopTimer = null;
  }
};

/** Replace the shared receiver's client list with what a plan decided. */
const setNdiInputClients = (clientIds: string[]): void => {
  ndiInputClientIds.clear();
  for (const clientId of clientIds) {
    ndiInputClientIds.add(clientId);
  }
};

const createVideoFrame = (
  width: number,
  height: number,
  data: Buffer,
  library: LoadedNdiLibrary,
): VideoFrame => {
  if (library.kind === 'grandi') {
    const fourCCEnum = library.lib['FourCC'] as { BGRA?: number } | undefined;
    const frameTypeEnum = library.lib['FrameType'] as { Progressive?: number } | undefined;
    return {
      ...describeNdiVideoFrame(width, height, {
        bgra: fourCCEnum?.BGRA,
        progressive: frameTypeEnum?.Progressive,
      }),
      data,
    };
  }
  return {
    xres: width,
    yres: height,
    data,
    frameRateN: NDI_FRAME_RATE_N,
    frameRateD: NDI_FRAME_RATE_D,
    pictureAspectRatio: width / height,
    colorFormat: 1,
  };
};

const sendFallbackFrame = async (library: LoadedNdiLibrary): Promise<void> => {
  if (!ndiSender) {
    return;
  }
  await ndiSender.video(
    createVideoFrame(NDI_FALLBACK_WIDTH, NDI_FALLBACK_HEIGHT, fallbackFrameBuffer, library),
  );
  framesSent += 1;
  usingFallbackFrame = true;
};

export const startNdiOutput = async (
  nextSourceName: string,
  nextGroupName: string,
): Promise<{ ok: boolean; error?: string; status: NdiStatus }> => {
  sourceName = normalizeNdiSourceName(nextSourceName);
  groupName = normalizeNdiGroupName(nextGroupName);

  if (isBroadcasting) {
    await stopNdiOutput();
  }

  const library = await loadNdiLibrary();
  if (!library) {
    lastError = `Failed to load NDI backend. ${lastNdiLibraryLoadError ?? 'Install grandi or grandiose and restart the app.'}`;
    return { ok: false, error: lastError, status: await getNdiStatusAsync() };
  }

  try {
    const senderFn = (
      library.kind === 'grandi' ? library.lib['send'] : library.lib['sender']
    ) as ((opts: Record<string, unknown>) => Promise<GrandioseSender>) | undefined;
    if (typeof senderFn !== 'function') {
      lastError = `NDI backend (${library.kind}) does not expose a sender function.`;
      return { ok: false, error: lastError, status: await getNdiStatusAsync() };
    }

    ndiSender = await senderFn(ndiSenderOptions(sourceName, groupName));

    isBroadcasting = true;
    lastError = null;
    framesSent = 0;
    usingFallbackFrame = false;
    console.log(`[NDI] Sender started: "${sourceName}" (group: "${groupName}")`);

    captureInterval = setInterval(() => {
      void (async () => {
        if (!isBroadcasting || !ndiSender || isFrameInFlight) return;
        isFrameInFlight = true;
        try {
          const outputWindow = getOutputWindow();
          if (!outputWindow || outputWindow.isDestroyed()) {
            await sendFallbackFrame(library);
            return;
          }
          const image = await outputWindow.webContents.capturePage();
          const size = image.getSize();
          if (size.width === 0 || size.height === 0) {
            await sendFallbackFrame(library);
            return;
          }
          const bitmap = image.toBitmap();
          await ndiSender.video(createVideoFrame(size.width, size.height, bitmap, library));
          framesSent += 1;
          usingFallbackFrame = false;
          lastError = null;
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          lastError = message;
          console.error('[NDI] Frame capture error:', err);
          try {
            await sendFallbackFrame(library);
          } catch (fallbackError) {
            lastError = fallbackError instanceof Error ? fallbackError.message : String(fallbackError);
            console.error('[NDI] Fallback frame send error:', fallbackError);
          }
        } finally {
          isFrameInFlight = false;
        }
      })();
    }, NDI_OUTPUT_INTERVAL_MS);

    return { ok: true, status: await getNdiStatusAsync() };
  } catch (error) {
    console.error('[NDI] Failed to create sender:', error);
    isBroadcasting = false;
    ndiSender = null;
    lastError = error instanceof Error ? error.message : String(error);
    return { ok: false, error: lastError, status: await getNdiStatusAsync() };
  }
};

export const stopNdiOutput = async (): Promise<void> => {
  isBroadcasting = false;
  isFrameInFlight = false;
  usingFallbackFrame = false;
  if (captureInterval) {
    clearInterval(captureInterval);
    captureInterval = null;
  }
  if (ndiSender) {
    try {
      if (typeof ndiSender.destroy === 'function') ndiSender.destroy();
      else if (typeof ndiSender.quit === 'function') ndiSender.quit();
    } catch {
      void 0;
    }
    ndiSender = null;
    console.log('[NDI] Sender stopped.');
  }
};

const getFindFunction = (
  library: LoadedNdiLibrary,
): ((opts?: Record<string, unknown>) => Promise<GrandiFinder>) | null => {
  const findFn = library.lib['find'];
  return typeof findFn === 'function'
    ? (findFn as (opts?: Record<string, unknown>) => Promise<GrandiFinder>)
    : null;
};

export const listNdiSources = async (
  options: { groupName?: string } = {},
): Promise<{ ok: boolean; sources: NdiSource[]; error?: string }> => {
  const library = await loadNdiLibrary();
  if (!library) {
    return {
      ok: false,
      sources: [],
      error: lastNdiLibraryLoadError ?? 'NDI native module is unavailable.',
    };
  }

  const findFn = getFindFunction(library);
  if (!findFn) {
    return {
      ok: false,
      sources: [],
      error: `NDI backend (${library.kind}) does not expose source discovery.`,
    };
  }

  let finder: GrandiFinder | null = null;
  try {
    finder = await findFn(ndiDiscoveryOptions(options.groupName));
    finder.wait(NDI_DISCOVERY_WAIT_MS);
    const sources = orderNdiSources(finder.sources());
    return { ok: true, sources };
  } catch (error) {
    return {
      ok: false,
      sources: [],
      error: error instanceof Error ? error.message : String(error),
    };
  } finally {
    try {
      finder?.destroy();
    } catch {
      void 0;
    }
  }
};

const copyFrameRows = (frame: VideoFrame): Buffer => {
  const width = frame.xres;
  const height = frame.yres;
  const targetStride = width * 4;
  const sourceStride = frame.lineStrideBytes ?? targetStride;
  if (sourceStride === targetStride && frame.data.byteLength >= targetStride * height) {
    return Buffer.from(frame.data.subarray(0, targetStride * height));
  }

  const output = Buffer.alloc(targetStride * height);
  for (let row = 0; row < height; row += 1) {
    frame.data.copy(
      output,
      row * targetStride,
      row * sourceStride,
      row * sourceStride + targetStride,
    );
  }
  return output;
};

const captureNdiInputLoop = async (
  receiver: GrandiReceiver,
  expectedSourceName: string,
): Promise<void> => {
  while (ndiInputLoopActive && ndiInputReceiver === receiver) {
    try {
      const frame = await receiver.video(NDI_INPUT_CAPTURE_TIMEOUT_MS);
      if (!ndiInputLoopActive || ndiInputReceiver !== receiver) {
        break;
      }
      if (!isUsableNdiInputFrame(frame)) {
        continue;
      }
      const nowMs = Date.now();
      if (!shouldKeepNdiInputFrame(nowMs, ndiInputLatestFrameAtMs)) {
        continue;
      }

      const bitmap = copyFrameRows(frame);
      const sourceImage = nativeImage.createFromBitmap(bitmap, {
        width: frame.xres,
        height: frame.yres,
        scaleFactor: 1,
      });
      const outputImage =
        frame.xres > NDI_INPUT_MAX_WIDTH
          ? sourceImage.resize({ width: NDI_INPUT_MAX_WIDTH })
          : sourceImage;
      ndiInputLatestImage = outputImage.toJPEG(NDI_INPUT_JPEG_QUALITY);
      ndiInputLatestContentType = 'image/jpeg';
      ndiInputLatestFrameAtMs = nowMs;
      ndiInputLastError = null;
    } catch (error) {
      ndiInputLastError = error instanceof Error ? error.message : String(error);
      if (!ndiInputLoopActive || ndiInputSourceName !== expectedSourceName) {
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, NDI_INPUT_RETRY_DELAY_MS));
    }
  }
};

export const startNdiInput = async (
  nextSourceName: string,
  options: { groupName?: string; clientId?: string } = {},
): Promise<{ ok: boolean; error?: string; sourceName: string | null }> => {
  clearScheduledNdiInputStop();
  const plan = planNdiInputStart(
    {
      receiving: ndiInputReceiver !== null,
      sourceName: ndiInputSourceName,
      clientIds: [...ndiInputClientIds],
    },
    nextSourceName,
    options.clientId,
  );
  if (plan.kind === 'rejected') {
    setNdiInputClients(plan.clientIds);
    if (plan.stopNow) {
      await stopNdiInputNow();
    }
    return { ok: false, error: plan.error, sourceName: null };
  }

  if (plan.kind === 'reuse') {
    setNdiInputClients(plan.clientIds);
    return { ok: true, sourceName: plan.sourceName };
  }

  const normalizedSourceName = plan.sourceName;
  const clientId = plan.clientId;
  await stopNdiInputNow();

  const library = await loadNdiLibrary();
  if (!library) {
    return {
      ok: false,
      error: lastNdiLibraryLoadError ?? 'NDI native module is unavailable.',
      sourceName: null,
    };
  }

  const receiveFn = library.lib['receive'];
  if (typeof receiveFn !== 'function') {
    return {
      ok: false,
      error: `NDI backend (${library.kind}) does not expose a receiver.`,
      sourceName: null,
    };
  }

  const discovered = await listNdiSources(options);
  const source = discovered.sources.find((item) => item.name === normalizedSourceName);
  if (!source) {
    return {
      ok: false,
      error: `NDI source "${normalizedSourceName}" was not found.`,
      sourceName: null,
    };
  }

  try {
    const colorFormatEnum = library.lib['ColorFormat'] as
      | { BGRX_BGRA?: number; UYVY_BGRA?: number; Fastest?: number }
      | undefined;
    const bandwidthEnum = library.lib['Bandwidth'] as
      | { Lowest?: number; Highest?: number }
      | undefined;
    ndiInputReceiver = await (receiveFn as (opts: Record<string, unknown>) => Promise<GrandiReceiver>)({
      source,
      colorFormat: colorFormatEnum?.BGRX_BGRA ?? colorFormatEnum?.UYVY_BGRA ?? colorFormatEnum?.Fastest,
      bandwidth: bandwidthEnum?.Lowest ?? bandwidthEnum?.Highest,
      name: NDI_INPUT_RECEIVER_NAME,
    });
    ndiInputSourceName = normalizedSourceName;
    ndiInputLatestImage = null;
    ndiInputLatestFrameAtMs = 0;
    ndiInputLastError = null;
    ndiInputLoopActive = true;
    if (clientId) {
      ndiInputClientIds.add(clientId);
    }
    void captureNdiInputLoop(ndiInputReceiver, normalizedSourceName);
    return { ok: true, sourceName: normalizedSourceName };
  } catch (error) {
    ndiInputLastError = error instanceof Error ? error.message : String(error);
    await stopNdiInputNow();
    return { ok: false, error: ndiInputLastError, sourceName: null };
  }
};

export const stopNdiInput = async (
  options: { clientId?: string } = {},
): Promise<void> => {
  clearScheduledNdiInputStop();
  const plan = planNdiInputStop(
    {
      receiving: ndiInputReceiver !== null,
      sourceName: ndiInputSourceName,
      clientIds: [...ndiInputClientIds],
    },
    options.clientId,
  );
  setNdiInputClients(plan.clientIds);
  if (plan.kind === 'keep') {
    return;
  }

  if (plan.kind === 'reset') {
    ndiInputLoopActive = false;
    ndiInputSourceName = null;
    ndiInputLatestImage = null;
    ndiInputLatestFrameAtMs = 0;
    return;
  }

  ndiInputStopTimer = setTimeout(() => {
    void stopNdiInputNow();
  }, plan.delayMs);
};

const stopNdiInputNow = async (): Promise<void> => {
  clearScheduledNdiInputStop();
  ndiInputClientIds.clear();
  ndiInputLoopActive = false;
  const receiver = ndiInputReceiver;
  ndiInputReceiver = null;
  ndiInputSourceName = null;
  ndiInputLatestImage = null;
  ndiInputLatestFrameAtMs = 0;
  if (receiver) {
    try {
      receiver.destroy();
    } catch {
      void 0;
    }
  }
};

export const getLatestNdiInputFrame = (
  sourceName?: string | null,
): {
  data: Buffer | null;
  contentType: string;
  updatedAtMs: number;
  error: string | null;
} =>
  selectNdiInputFrame(
    {
      sourceName: ndiInputSourceName,
      image: ndiInputLatestImage,
      contentType: ndiInputLatestContentType,
      frameAtMs: ndiInputLatestFrameAtMs,
      lastError: ndiInputLastError,
    },
    sourceName,
  );

const getNdiStatusAsync = async (): Promise<NdiStatus> => ({
  running: isBroadcasting,
  sourceName,
  groupName,
  lastError,
  libraryLoaded: (await loadNdiLibrary()) !== null,
  framesSent,
  usingFallbackFrame,
});

export const getNdiStatus = async (): Promise<NdiStatus> => getNdiStatusAsync();
