export declare function positionForVideo(state: {
  transportMediaId: string | null;
  videoId: string | null;
  positionSeconds: number;
  sampledAtMs: number | null;
}): { positionSeconds: number; sampledAtMs: number | null };
