/**
 * Output layer flags and text placement.
 *
 * Everything here comes from `src/shared/lib/looks-config.mjs` and its
 * declaration file. The split exists so `node --test` can characterise the
 * rules without TypeScript before they are ported to Rust — see that file.
 * Import from here in `.ts` and `.tsx`; nothing else needs to know.
 */

export type {
  LookBox,
  LookLayerKey,
  LookLayout,
  MediaPlacement,
  MessageEdge,
  MessagePlacement,
  TimerPlacement,
  WordsPlacement,
  LookPreset,
  LookTargetKey,
  LookTargetState,
  LookTargets,
  LookTextPosition,
  LooksClock,
  LooksConfig,
} from "../lib/looks-config.mjs";

export {
  LOOK_LAYER_ORDER,
  createDefaultLookPreset,
  createDefaultLooksConfig,
  generateLookId,
  isAddedScreenId,
  lookColumn,
  lookTargetForScreen,
  normalizeLayout,
  normalizeLooksConfig,
  parseLookTarget,
  screenDefaultColumn,
  withAddedLook,
  withLayerEnabled,
  withLayout,
  withLookName,
  withSelectedLook,
  withSelectedTarget,
  withTextPosition,
} from "../lib/looks-config.mjs";
