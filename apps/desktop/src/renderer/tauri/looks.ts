/**
 * The output layer flags, from the Rust core.
 *
 * Loaded only under Tauri, and only through a dynamic import, so the Electron
 * bundle never sees `@tauri-apps/api` — the same arrangement the speech broker
 * uses. `useLooksConfig` picks between this and `localStorage` at runtime; no
 * component knows which one it got.
 *
 * Mirrors `src-tauri/src/commands/looks.rs`.
 */

import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

import { safelyUnlisten } from "./electron-bridge";

import type {
  LookLayerKey,
  LookLayout,
  LookTargetKey,
  LookTextPosition,
  LooksConfig,
} from "../../shared/types/looks";

/** Emitted to every window when the flags change. `LOOKS_CHANGED_EVENT`. */
export const LOOKS_CHANGED = "looks:changed";

export const getLooksConfig = (): Promise<LooksConfig> => invoke("get_looks_config");

export const setLooksTarget = (target: LookTargetKey): Promise<LooksConfig> =>
  invoke("set_looks_target", { target });

export const setSelectedLook = (lookId: string): Promise<LooksConfig> =>
  invoke("set_selected_look", { lookId });

export const addLook = (name?: string): Promise<LooksConfig> =>
  invoke("add_look", { name: name ?? null });

/** Remove a look. The core refuses to remove the last one. */
export const removeLook = (lookId: string): Promise<LooksConfig> =>
  invoke("remove_look", { lookId });

export const setLookName = (lookId: string, name: string): Promise<LooksConfig> =>
  invoke("set_look_name", { lookId, name });

export const setLookLayer = (
  lookId: string,
  target: LookTargetKey,
  layer: LookLayerKey,
  enabled: boolean,
): Promise<LooksConfig> => invoke("set_look_layer", { lookId, target, layer, enabled });

/**
 * Turn several layers on or off together, as one change.
 *
 * A quick toggle is rarely one layer — "words" is the slide layer and the
 * presentation layer — and sending one command each made them two changes
 * whose events could arrive in either order, leaving one of the pair on.
 */
export const setLookLayers = (
  lookId: string,
  target: LookTargetKey,
  layers: LookLayerKey[],
  enabled: boolean,
): Promise<LooksConfig> => invoke("set_look_layers", { lookId, target, layers, enabled });

export const setLookTextPosition = (
  lookId: string,
  target: LookTargetKey,
  patch: Partial<LookTextPosition>,
): Promise<LooksConfig> => invoke("set_look_text_position", { lookId, target, patch });

/** Lay a column out afresh: where each layer goes on its screen. */
export const setLookLayout = (
  lookId: string,
  target: LookTargetKey,
  layout: LookLayout,
): Promise<LooksConfig> => invoke("set_look_layout", { lookId, target, layout });

/**
 * Subscribe to flag changes. Resolves to an unsubscribe function.
 *
 * This is what replaces the 400 ms `localStorage` poll: the Looks window and
 * the audience output learn about a toggle in the same tick Rust applied it.
 */
export const onLooksChanged = async (
  handler: (config: LooksConfig) => void,
): Promise<() => void> => {
  const unlisten = await listen<LooksConfig>(LOOKS_CHANGED, (event) => handler(event.payload));

  // Guarded twice over: once so a second cleanup does nothing, and once
  // because Tauri's unlisten throws outright on a listener that has already
  // gone. See `safelyUnlisten`.
  let detached = false;
  return () => {
    if (detached) return;
    detached = true;
    safelyUnlisten(unlisten);
  };
};
