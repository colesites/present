import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { app } from 'electron';
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

const INTERVAL_MS = Math.floor(1000 / 30);
const FALLBACK_WIDTH = 1280;
const FALLBACK_HEIGHT = 720;
const fallbackFrameBuffer = Buffer.alloc(FALLBACK_WIDTH * FALLBACK_HEIGHT * 4);

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
      lastNdiLibraryLoadError = null;
      console.log('[NDI] Loaded grandi backend.');
      return loadedNdiLibrary;
    } catch (err) {
      errors.push(`grandi: ${err instanceof Error ? err.message : String(err)}`);
    }

    try {
      const mod = normalizeNamespace(await importGrandiose());
      loadedNdiLibrary = { kind: 'grandiose', lib: mod };
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

const normalizeSourceName = (value: string): string => {
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : 'Present Main Output';
};

const normalizeGroupName = (value: string): string => {
  const normalized = value.trim();
  if (normalized.length === 0) {
    return 'Public';
  }
  return normalized.toLowerCase() === 'public' ? 'Public' : normalized;
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
      xres: width,
      yres: height,
      data,
      frameRateN: 30000,
      frameRateD: 1000,
      pictureAspectRatio: width / height,
      lineStrideBytes: width * 4,
      frameFormatType: frameTypeEnum?.Progressive ?? 1,
      fourCC: fourCCEnum?.BGRA ?? 1095911234,
    };
  }
  return {
    xres: width,
    yres: height,
    data,
    frameRateN: 30000,
    frameRateD: 1000,
    pictureAspectRatio: width / height,
    colorFormat: 1,
  };
};

const sendFallbackFrame = async (library: LoadedNdiLibrary): Promise<void> => {
  if (!ndiSender) {
    return;
  }
  await ndiSender.video(
    createVideoFrame(FALLBACK_WIDTH, FALLBACK_HEIGHT, fallbackFrameBuffer, library),
  );
  framesSent += 1;
  usingFallbackFrame = true;
};

export const startNdiOutput = async (
  nextSourceName: string,
  nextGroupName: string,
): Promise<{ ok: boolean; error?: string; status: NdiStatus }> => {
  sourceName = normalizeSourceName(nextSourceName);
  groupName = normalizeGroupName(nextGroupName);

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

    ndiSender = await senderFn({
      name: sourceName,
      groups: groupName,
      group: groupName,
      clockVideo: true,
      clockAudio: false,
    });

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
    }, INTERVAL_MS);

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
