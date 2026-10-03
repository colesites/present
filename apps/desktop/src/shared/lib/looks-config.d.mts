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
  | "timer"
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

/** A box on the screen, as percentages of it: its centre, and its size. */
export type LookBox = {
  xPercent: number;
  yPercent: number;
  widthPercent: number;
  heightPercent: number;
};

/** Where the slide's words go, and how they look there. */
export type WordsPlacement = {
  area: LookBox;
  textAlign: "left" | "center" | "right";
  verticalAlign: "top" | "middle" | "bottom";
  /** The words' size, as a percentage of the Screen's size for them. */
  scalePercent: number;
  /** A designed slide's words on their own, laid out afresh in the box. */
  textOnly: boolean;
  /** A colour behind the box, `#rrggbb` or `#rrggbbaa`. */
  backdrop?: string;
};

export type MediaPlacement = { area: LookBox; fill: boolean };
export type TimerPlacement = { xPercent: number; yPercent: number; scalePercent: number };
export type MessageEdge = "asSent" | "top" | "bottom";
export type MessagePlacement = { edge: MessageEdge; scalePercent: number };

/**
 * Where a column puts each layer on its screen. A layer left out is where the
 * Screen puts it, so a column no one has laid out draws as screens always have.
 */
export type LookLayout = {
  words?: WordsPlacement;
  /** A presentation's slide (PDF, PowerPoint), scaled evenly into this box. */
  slide?: LookBox;
  media?: MediaPlacement;
  /** The props, all of them, scaled evenly into this box. */
  props?: LookBox;
  timer?: TimerPlacement;
  messages?: MessagePlacement;
};

export type LookTargetState = {
  layers: Record<LookLayerKey, boolean>;
  textPosition: LookTextPosition;
  layout: LookLayout;
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

export declare const normalizeLayout: (candidate: unknown) => LookLayout;

export declare const withLayout: (
  config: LooksConfig,
  lookId: string,
  target: LookTargetKey,
  layout: LookLayout,
  now?: number,
) => LooksConfig;
