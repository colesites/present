/**
 * Output layer flags and text placement.
 *
 * Everything here comes from `src/shared/lib/looks-config.mjs` and its
 * declaration file. The split exists so `node --test` can characterise the
 * rules without TypeScript before they are ported to Rust — see that file.
 * Import from here in `.ts` and `.tsx`; nothing else needs to know.
 */

export type {
  LookLayerKey,
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
  normalizeLooksConfig,
  parseLookTarget,
  screenDefaultColumn,
  withAddedLook,
  withLayerEnabled,
  withLookName,
  withSelectedLook,
  withSelectedTarget,
  withTextPosition,
} from "../lib/looks-config.mjs";
