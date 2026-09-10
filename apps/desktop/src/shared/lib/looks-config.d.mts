/**
 * Types for `looks-config.mjs`.
 *
 * The implementation is JavaScript so `node --test` can characterise it before
 * the Rust port; this file is what keeps the rest of the app precisely typed.
 * `src/shared/types/looks.ts` re-exports everything here.
 */

export type LookLayerKey =
  | "mask"
  | "messages"
  | "props"
  | "announcements"
  | "presentation"
  | "slide"
  | "media"
  | "videoInput";

export type LookTargetKey = "program" | "stage" | "ndi";

export type LookTextPosition = {
  xPercent: number;
  yPercent: number;
  widthPercent: number;
  heightPercent: number;
  textAlign: "left" | "center" | "right";
  verticalAlign: "top" | "middle" | "bottom";
};

export type LookTargetState = {
  layers: Record<LookLayerKey, boolean>;
  textPosition: LookTextPosition;
};

export type LookPreset = {
  id: string;
  name: string;
  targets: Record<LookTargetKey, LookTargetState>;
};

export type LooksConfig = {
  version: 2;
  selectedTarget: LookTargetKey;
  selectedLookId: string;
  liveLookId: string;
  looks: LookPreset[];
  updatedAt: number;
};

/** The clock and id source, injected so tests and the Rust port are exact. */
export type LooksClock = { now?: number; newId?: () => string };

export declare const LOOK_LAYER_ORDER: ReadonlyArray<{
  key: LookLayerKey;
  label: string;
}>;

export declare const LOOK_TARGET_ORDER: ReadonlyArray<{
  key: LookTargetKey;
  label: string;
}>;

export declare const createDefaultLookPreset: () => LookPreset;
export declare const createDefaultLooksConfig: (now?: number) => LooksConfig;
export declare const generateLookId: () => string;

export declare const normalizeLooksConfig: (
  candidate: unknown,
  clock?: LooksClock,
) => LooksConfig;

export declare const withSelectedTarget: (
  config: LooksConfig,
  target: LookTargetKey,
  now?: number,
) => LooksConfig;

export declare const withSelectedLook: (
  config: LooksConfig,
  lookId: string,
  now?: number,
) => LooksConfig;

export declare const withAddedLook: (
  config: LooksConfig,
  name?: string,
  clock?: LooksClock,
) => LooksConfig;

export declare const withLookName: (
  config: LooksConfig,
  lookId: string,
  name: string,
  now?: number,
) => LooksConfig;

export declare const withLayerEnabled: (
  config: LooksConfig,
  lookId: string,
  target: LookTargetKey,
  layer: LookLayerKey,
  enabled: boolean,
  now?: number,
) => LooksConfig;

export declare const withTextPosition: (
  config: LooksConfig,
  lookId: string,
  target: LookTargetKey,
  patch: Partial<LookTextPosition>,
  now?: number,
) => LooksConfig;
