/**
 * Types for `ndi-rules.mjs`.
 *
 * The implementation is JavaScript so `node --test` can characterise it before
 * the Rust port; this file is what keeps `ndi.service.ts` precisely typed.
 */

export declare const NDI_DEFAULT_SOURCE_NAME: "Present Main Output";
export declare const NDI_DEFAULT_GROUP_NAME: "Public";
export declare const NDI_OUTPUT_INTERVAL_MS: number;
export declare const NDI_FRAME_RATE_N: number;
export declare const NDI_FRAME_RATE_D: number;
export declare const NDI_FOURCC_BGRA: number;
export declare const NDI_FRAME_FORMAT_PROGRESSIVE: number;
export declare const NDI_FALLBACK_WIDTH: number;
export declare const NDI_FALLBACK_HEIGHT: number;
export declare const NDI_DISCOVERY_WAIT_MS: number;
export declare const NDI_INPUT_CAPTURE_TIMEOUT_MS: number;
export declare const NDI_INPUT_FRAME_INTERVAL_MS: number;
export declare const NDI_INPUT_MAX_WIDTH: number;
export declare const NDI_INPUT_JPEG_QUALITY: number;
export declare const NDI_INPUT_STOP_DELAY_MS: number;
export declare const NDI_INPUT_RETRY_DELAY_MS: number;
export declare const NDI_INPUT_RECEIVER_NAME: string;
export declare const NDI_INPUT_NO_SOURCE_ERROR: string;

export declare function normalizeNdiSourceName(value: string): string;
export declare function normalizeNdiGroupName(value: string): string;
export declare function normalizeNdiInputClientId(value: string | null | undefined): string | null;

export declare function ndiSenderOptions(
  sourceName: string,
  groupName: string,
): {
  name: string;
  groups: string;
  group: string;
  clockVideo: true;
  clockAudio: false;
};

export type NdiVideoFrameHeader = {
  xres: number;
  yres: number;
  frameRateN: number;
  frameRateD: number;
  pictureAspectRatio: number;
  lineStrideBytes: number;
  frameFormatType: number;
  fourCC: number;
};

export declare function describeNdiVideoFrame(
  width: number,
  height: number,
  enums?: { bgra?: number; progressive?: number },
): NdiVideoFrameHeader;

export declare function ndiDiscoveryOptions(groupName: string | undefined): {
  showLocalSources: true;
  groups: string | undefined;
};

export declare function orderNdiSources<T extends { name?: unknown }>(sources: T[]): T[];

export type NdiInputState = {
  receiving: boolean;
  sourceName: string | null;
  clientIds: string[];
};

export type NdiInputStartPlan =
  | { kind: "rejected"; error: string; stopNow: boolean; clientIds: string[] }
  | { kind: "reuse"; sourceName: string; clientIds: string[] }
  | { kind: "connect"; sourceName: string; clientId: string | null };

export type NdiInputStopPlan =
  | { kind: "keep"; clientIds: string[] }
  | { kind: "reset"; clientIds: string[] }
  | { kind: "stop-later"; delayMs: number; clientIds: string[] };

export declare function planNdiInputStart(
  state: NdiInputState,
  sourceName: string,
  clientId: string | null | undefined,
): NdiInputStartPlan;

export declare function planNdiInputStop(
  state: NdiInputState,
  clientId: string | null | undefined,
): NdiInputStopPlan;

export declare function shouldKeepNdiInputFrame(nowMs: number, lastFrameAtMs: number): boolean;

export declare function isUsableNdiInputFrame(
  frame: { xres: number; yres: number; data?: unknown } | null | undefined,
): boolean;

export type NdiInputFrame<Data> = {
  data: Data | null;
  contentType: string;
  updatedAtMs: number;
  error: string | null;
};

export declare function selectNdiInputFrame<Data>(
  active: {
    sourceName: string | null;
    image: Data | null;
    contentType: string;
    frameAtMs: number;
    lastError: string | null;
  },
  requestedSourceName: string | null | undefined,
): NdiInputFrame<Data>;

export declare function ndiFrameRequestSourceName(url: string): string | null;

export declare function ndiFrameResponse(frame: {
  data: unknown;
  contentType: string;
  updatedAtMs: number;
}):
  | {
      status: 200;
      headers: {
        "Cache-Control": "no-store";
        "Content-Type": string;
        "X-NDI-Frame-Updated-At": string;
      };
    }
  | { status: 204; headers: { "Cache-Control": "no-store" } };
