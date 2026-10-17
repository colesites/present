/**
 * Panels whose pictures are drawn natively under the page, as the audience
 * screen is (`src-tauri/src/services/surface/panel.rs`): the center pane's
 * video and the operator's preview, on macOS. Elsewhere `attachNativePanel`
 * answers `false` and the page draws the panel itself.
 */

import { invoke } from "@tauri-apps/api/core";

import type { MediaFramesClock } from "./media-frames";

/** What a panel shows. */
export type NativePanelSource =
  | { kind: "media"; url: string; clock: MediaFramesClock }
  | { kind: "preview"; screen: string };

/** x, y, width, height, in CSS pixels from the page's top-left. */
export type PanelRect = [number, number, number, number];

/** Where a panel is, as the page measures it. */
export type NativePanelGeometry = {
  rect: PanelRect;
  /** The part of it on screen: inside the window and every scrolling box around it, which the page leaves clear. */
  clip: PanelRect;
  visible: boolean;
  /** Whether the page is being shown at all: `false` while its window is covered or minimised. The picture keeps its place and last frame; only the drawing stops. */
  active: boolean;
  /** The page's viewport, width and height: where its top-left is measured from. */
  viewport: [number, number];
  dpr: number;
  /** How round its corners are, and which: top-left 1, top-right 2, bottom-left 4, bottom-right 8. */
  radius: number;
  corners: number;
};

/**
 * Each panel's calls, one after another. A panel mounted, unmounted and
 * mounted again — React does this — sends attach, detach and attach; run
 * side by side they could land detach last and leave the panel blank.
 */
const queues = new Map<string, Promise<unknown>>();

const inTurn = <T>(id: string, call: () => Promise<T>): Promise<T> => {
  const previous = queues.get(id) ?? Promise.resolve();
  const next = previous.then(call, call);
  queues.set(id, next);
  const forget = () => {
    if (queues.get(id) === next) queues.delete(id);
  };
  next.then(forget, forget);
  return next;
};

/** Draw panel `id` natively. `false` where the page should draw it itself. */
export const attachNativePanel = (
  id: string,
  source: NativePanelSource,
  geometry: NativePanelGeometry,
): Promise<boolean> =>
  inTurn(id, () => invoke<boolean>("attach_native_panel", { id, source, geometry })).catch(() => false);

export const setNativePanelGeometry = (id: string, geometry: NativePanelGeometry): Promise<void> =>
  inTurn(id, () => invoke<void>("set_native_panel_geometry", { id, geometry }));

export const setNativePanelSource = (id: string, source: NativePanelSource): Promise<void> =>
  inTurn(id, () => invoke<void>("set_native_panel_source", { id, source }));

export const detachNativePanel = (id: string): Promise<void> =>
  inTurn(id, () => invoke<void>("detach_native_panel", { id }));

/**
 * This window's page has loaded: whatever panels its previous page left —
 * a reload, a crash — go, before any of this page's attach.
 */
const reset: Promise<void> = invoke<void>("reset_native_panels").catch((): void => undefined);

/** Resolves once this page's window has been cleared of an earlier page's panels. */
export const ready = (): Promise<void> => reset;
