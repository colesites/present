import { getOutputWindow } from '../windows/output.window';

type NdiLibraryKind = 'grandi' | 'grandiose';

type LoadedNdiLibrary = {
  kind: NdiLibraryKind;
  lib: Record<string, unknown>;
};

let loadedNdiLibrary: LoadedNdiLibrary | null = null;
let hasLoggedNdiLibraryLoadFailure = false;
let lastNdiLibraryLoadError: string | null = null;

const loadNdiLibrary = (): LoadedNdiLibrary | null => {
  if (loadedNdiLibrary) {
    return loadedNdiLibrary;
  }
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const grandi = require('grandi') as Record<string, unknown>;
    loadedNdiLibrary = {
      kind: 'grandi',
      lib: grandi,
    };
    lastNdiLibraryLoadError = null;
    return loadedNdiLibrary;
  } catch (err) {
    lastNdiLibraryLoadError = err instanceof Error ? err.message : String(err);
  }

  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const grandiose = require('grandiose') as Record<string, unknown>;
    loadedNdiLibrary = {
      kind: 'grandiose',
      lib: grandiose,
    };
    lastNdiLibraryLoadError = null;
    return loadedNdiLibrary;
  } catch (err) {
    const grandioseError = err instanceof Error ? err.message : String(err);
    lastNdiLibraryLoadError =
      lastNdiLibraryLoadError
        ? `grandi: ${lastNdiLibraryLoadError}; grandiose: ${grandioseError}`
        : `grandiose: ${grandioseError}`;
    if (!hasLoggedNdiLibraryLoadFailure) {
      hasLoggedNdiLibraryLoadFailure = true;
      console.error('[NDI] Failed to load an NDI native module:', err);
    }
    return null;
  }
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

let ndiSender: GrandioseSender | null = null;
let captureInterval: NodeJS.Timeout | null = null;
let isBroadcasting = false;
let sourceName = 'Present Main Output';
let groupName = 'Public';
let lastError: string | null = null;
let framesSent = 0;
let isFrameInFlight = false;
let usingFallbackFrame = false;

// Target 30 FPS
const INTERVAL_MS = Math.floor(1000 / 30);

type NdiStatus = {
  running: boolean;
  sourceName: string;
  groupName: string;
  lastError: string | null;
  libraryLoaded: boolean;
  framesSent: number;
  usingFallbackFrame: boolean;
};

const FALLBACK_WIDTH = 1280;
const FALLBACK_HEIGHT = 720;
const fallbackFrameBuffer = Buffer.alloc(FALLBACK_WIDTH * FALLBACK_HEIGHT * 4);

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
    const fourCC =
      (library.lib['FourCC'] as { BGRA?: number } | undefined)?.BGRA
      ?? ((library.lib['default'] as { FOURCC_BGRA?: number } | undefined)?.FOURCC_BGRA);
    const frameFormatType =
      (library.lib['FrameType'] as { Progressive?: number } | undefined)?.Progressive
      ?? ((library.lib['default'] as { FORMAT_TYPE_PROGRESSIVE?: number } | undefined)
        ?.FORMAT_TYPE_PROGRESSIVE);
    return {
      xres: width,
      yres: height,
      data,
      frameRateN: 30000,
      frameRateD: 1000,
      pictureAspectRatio: width / height,
      lineStrideBytes: width * 4,
      frameFormatType: Number.isFinite(frameFormatType) ? frameFormatType : 1,
      fourCC: Number.isFinite(fourCC) ? fourCC : 1,
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

  const library = loadNdiLibrary();
  if (!library) {
    lastError = `Failed to load NDI backend. ${lastNdiLibraryLoadError ?? 'Install dependencies and restart the app.'}`;
    return {
      ok: false,
      error: lastError,
      status: getNdiStatus(),
    };
  }

  try {
    const senderFn = (
      library.kind === 'grandi' ? library.lib['send'] : library.lib['sender']
    ) as ((opts: Record<string, unknown>) => Promise<GrandioseSender>) | undefined;
    if (typeof senderFn !== 'function') {
      lastError = `Loaded NDI backend (${library.kind}) does not expose a sender function.`;
      return {
        ok: false,
        error: lastError,
        status: getNdiStatus(),
      };
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
            const fallbackMessage =
              fallbackError instanceof Error
                ? fallbackError.message
                : String(fallbackError);
            lastError = fallbackMessage;
            console.error('[NDI] Fallback frame send error:', fallbackError);
          }
        } finally {
          isFrameInFlight = false;
        }
      })();
    }, INTERVAL_MS);

    return { ok: true, status: getNdiStatus() };
  } catch (error) {
    console.error('[NDI] Failed to create sender:', error);
    isBroadcasting = false;
    ndiSender = null;
    lastError = error instanceof Error ? error.message : String(error);
    return {
      ok: false,
      error: lastError,
      status: getNdiStatus(),
    };
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
      if (typeof ndiSender.destroy === 'function') {
        ndiSender.destroy();
      } else if (typeof ndiSender.quit === 'function') {
        ndiSender.quit();
      }
    } catch {
      void 0;
    }
    ndiSender = null;
    console.log('[NDI] Sender stopped.');
  }
};

export const getNdiStatus = (): NdiStatus => ({
  running: isBroadcasting,
  sourceName,
  groupName,
  lastError,
  libraryLoaded: loadNdiLibrary() !== null,
  framesSent,
  usingFallbackFrame,
});
