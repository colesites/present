export declare const OPERATOR_PAUSE_WITHIN_MS: number;

export declare function isOperatorPause(pause: {
  nowMs: number;
  touchedAtMs: number;
  programmatic: boolean;
  ended: boolean;
  hidden: boolean;
}): boolean;

export declare function shouldResume(player: {
  nowMs: number;
  transportPlaying: boolean;
  paused: boolean;
  ended: boolean;
  seeking: boolean;
  hidden: boolean;
  operatorPausedAtMs: number;
}): boolean;
