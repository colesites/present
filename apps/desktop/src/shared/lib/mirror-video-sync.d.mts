export declare const IN_STEP_SECONDS: number;
export declare const SEEK_SECONDS: number;
export declare const PAUSED_TOLERANCE_SECONDS: number;
export declare const MAX_RATE_ADJUSTMENT: number;
export declare const CATCH_UP_SECONDS: number;
export declare const MAX_EXTRAPOLATION_SECONDS: number;

export declare function positionForVideo(state: {
  transportMediaId: string | null;
  videoId: string | null;
  positionSeconds: number;
  sampledAtMs: number | null;
}): { positionSeconds: number; sampledAtMs: number | null };

export declare function mirrorTarget(input: {
  positionSeconds: number;
  sampledAtMs: number | null | undefined;
  playing: boolean;
  nowMs: number;
}): number;

export declare function mirrorCorrection(input: {
  elementSeconds: number;
  targetSeconds: number;
  playing: boolean;
  durationSeconds: number | null;
  loop: boolean;
}): { seekTo: number | null; playbackRate: number };

export declare function syncMirrorVideo(
  video: HTMLVideoElement,
  operator: {
    positionSeconds: number;
    sampledAtMs: number | null | undefined;
    playing: boolean;
    nowMs?: number;
  },
): void;
