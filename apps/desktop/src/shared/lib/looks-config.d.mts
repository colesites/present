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

/**
 * A column of a look: `program` for the Screen every setup has, `ndi` for the
 * NDI output in Connections, `stage` kept only so a stored config reads, and
 * an added audience screen's own id for the rest.
 */
export type LookTargetKey = "program" | "stage" | "ndi" | (string & {});

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

export type LookTargets = {
  program: LookTargetState;
  stage: LookTargetState;
  ndi: LookTargetState;
  /** The audience screens added in Screen Configuration, by id. */
  screens: Record<string, LookTargetState>;
};

export type LookPreset = {
  id: string;
  name: string;
  targets: LookTargets;
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

export declare const isAddedScreenId: (id: unknown) => boolean;
export declare const parseLookTarget: (value: unknown) => LookTargetKey | null;
export declare const lookTargetForScreen: (screenId: string) => LookTargetKey | null;
export declare const screenDefaultColumn: (targets: LookTargets) => LookTargetState;
export declare const lookColumn: (look: LookPreset, target: LookTargetKey) => LookTargetState;

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
