/**
 * The transition library, as the picker reads it.
 *
 * The list lives in `services/compositor/transition/registry.rs` and nowhere
 * else: adding a transition is a row there, not a change here as well.
 */

import { invoke } from "@tauri-apps/api/core";

export type TransitionCategoryId =
  | "basic"
  | "slide"
  | "wipe"
  | "zoom"
  | "shape"
  | "split"
  | "three-d"
  | "light"
  | "digital"
  | "creative";

export type TransitionDirection =
  | "left"
  | "right"
  | "up"
  | "down"
  | "in"
  | "out"
  | "clockwise"
  | "counter-clockwise"
  | "diagonal";

export type TransitionEasing =
  | "linear"
  | "ease-in"
  | "ease-out"
  | "ease-in-out"
  | "cubic"
  | "quint"
  | "exponential"
  | "back"
  | "elastic"
  | "bounce";

/** Which layers take part. */
export type TransitionMode = "changed-elements" | "full-slide";

export type TransitionPreset = {
  id: string;
  name: string;
  category: TransitionCategoryId;
  primitive: string;
  direction: TransitionDirection | null;
  defaultDurationMs: number;
  supportsDirection: boolean;
  needsShader: boolean;
  needsIntermediateTexture: boolean;
  /** Whether the engine draws it today, or stands a fade in for it. */
  available: boolean;
};

export type TransitionLibrary = {
  categories: Array<{ id: TransitionCategoryId; title: string }>;
  presets: TransitionPreset[];
};

/** What a slide stores. Mirrors `transition::Transition`. */
export type Transition = {
  type: string;
  durationMs: number;
  easing: TransitionEasing;
  direction: TransitionDirection;
  mode: TransitionMode;
};

export const getTransitions = (): Promise<TransitionLibrary> => invoke("get_transitions");

/**
 * One moment of a transition, drawn by the engine that runs it for real.
 *
 * `progress` is 0 to 1. The tiles show a still at the middle of the movement
 * and step through these on hover.
 */
export const transitionSampleUrl = (
  id: string,
  progress: number,
  width: number,
  height: number,
): string => {
  const query = `p=${progress.toFixed(3)}&w=${Math.round(width)}&h=${Math.round(height)}`;
  const isWindows =
    typeof navigator !== "undefined" && /Windows|Win32|Win64/.test(navigator.userAgent);
  return isWindows
    ? `http://transition-sample.localhost/frame/${encodeURIComponent(id)}?${query}`
    : `transition-sample://frame/${encodeURIComponent(id)}?${query}`;
};

export const DEFAULT_TRANSITION: Transition = {
  type: "fade",
  durationMs: 400,
  easing: "ease-in-out",
  direction: "left",
  mode: "changed-elements",
};

/** Where the operator's choice is kept between runs. */
const STORAGE_KEY = "present-transition";

export const readTransition = (): Transition => {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return raw ? { ...DEFAULT_TRANSITION, ...(JSON.parse(raw) as Transition) } : DEFAULT_TRANSITION;
  } catch {
    return DEFAULT_TRANSITION;
  }
};

const CHANGED_EVENT = "present-transition-changed";

export const writeTransition = (transition: Transition): void => {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(transition));
  } catch {
    // The choice is a convenience; losing it costs one click.
  }
  window.dispatchEvent(new Event(CHANGED_EVENT));
};

export const onTransitionChanged = (handler: () => void): (() => void) => {
  window.addEventListener(CHANGED_EVENT, handler);
  return () => window.removeEventListener(CHANGED_EVENT, handler);
};
