/**
 * The audience scene, from the Rust core.
 *
 * Loaded only under Tauri and only through a dynamic import, so the Electron
 * bundle never sees `@tauri-apps/api`.
 *
 * Mirrors `src-tauri/src/services/output.rs`. Where the Electron path sends
 * four partial payloads and has each receiving window merge them into its own
 * React state, here Rust holds the one scene and every surface is handed the
 * whole thing.
 */

import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

import { safelyUnlisten } from "./electron-bridge";

import type { OutputState } from "../../shared/types/output-window";

/** `OUTPUT_CHANGED_EVENT`. */
export const OUTPUT_SCENE_CHANGED = "output:scene-changed";

/**
 * The scene as Rust holds it.
 *
 * Structurally the same as the `OutputState` each window keeps today, which is
 * the point: the receiver stops reconstructing and starts rendering. The fields
 * Rust cannot supply a default for arrive as null and the merge below keeps
 * whatever the window already had.
 */
export type OutputScene = Omit<
  OutputState,
  "scriptureStyle" | "libraryStyle" | "timerLayout" | "screenComposerLayout"
> & {
  scriptureStyle: OutputState["scriptureStyle"] | null;
  libraryStyle: OutputState["libraryStyle"] | null;
  timerLayout: OutputState["timerLayout"] | null;
  screenComposerLayout: OutputState["screenComposerLayout"] | null;
};

export const getOutputScene = (): Promise<OutputScene> => invoke("get_output_scene");

export const sendToOutput = (payload: unknown): Promise<void> =>
  invoke("send_to_output", { payload });

export const setOutputFrozen = (frozen: boolean): Promise<boolean> =>
  invoke("set_output_frozen", { frozen });

/** Subscribe to scene changes. Resolves to an unsubscribe function. */
export const onOutputSceneChanged = async (
  handler: (scene: OutputScene) => void,
): Promise<() => void> => {
  const unlisten = await listen<OutputScene>(OUTPUT_SCENE_CHANGED, (event) =>
    handler(event.payload),
  );

  // Guarded twice over; see `safelyUnlisten`.
  let detached = false;
  return () => {
    if (detached) return;
    detached = true;
    safelyUnlisten(unlisten);
  };
};

/**
 * Merge a scene over a window's current state.
 *
 * A plain spread would be wrong. Four fields are optional in Rust and required
 * in the React state — the styles and layouts each window seeds with its own
 * defaults — so a scene that has never carried one must not overwrite the
 * default with null and leave the renderer reading `.fontSize` of nothing.
 */
export const mergeScene = (previous: OutputState, scene: OutputScene): OutputState => ({
  ...previous,
  ...scene,
  scriptureStyle: scene.scriptureStyle ?? previous.scriptureStyle,
  libraryStyle: scene.libraryStyle ?? previous.libraryStyle,
  timerLayout: scene.timerLayout ?? previous.timerLayout,
  screenComposerLayout: scene.screenComposerLayout ?? previous.screenComposerLayout,
});
