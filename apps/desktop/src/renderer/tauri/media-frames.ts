/**
 * A video file's pictures, decoded by FFmpeg in Rust for a panel here
 * (`src-tauri/src/services/media_frames.rs`). No `<video>` element: the
 * frames arrive as JPEGs through `media-frame://`, the way the operator's
 * preview of the audience screen does (`preview-frames.ts`).
 */

import { invoke } from "@tauri-apps/api/core";

/** How a player keeps time. */
export type MediaFramesClock =
  /** With the scene: the video on screen, where every screen has it. */
  | { mode: "scene" }
  /** Its own: the operator previewing a video. Was at `positionSeconds` when set, at `rate`. */
  | { mode: "local"; playing: boolean; positionSeconds: number; loop?: boolean; rate?: number }
  /** Round and round from the start: a prop. */
  | { mode: "loop" };

export const setMediaFrames = (id: string, url: string, clock: MediaFramesClock): Promise<void> =>
  invoke("set_media_frames", { id, url, clock });

export const removeMediaFrames = (id: string): Promise<void> => invoke("remove_media_frames", { id });

/** How long a video file is, when its container says. */
export const mediaDuration = (url: string): Promise<number | null> => invoke("media_duration", { url });

const isWindows = (): boolean =>
  typeof navigator !== "undefined" && /Windows|Win32|Win64/.test(navigator.userAgent);

/**
 * One frame of player `id`, at most `width` by `height`, drawn `leadMs` ahead;
 * `after` is the frame already shown (`services/frame_delivery.rs`).
 */
export const mediaFrameUrl = (
  id: string,
  width: number,
  height: number,
  leadMs: number,
  after: number | null,
): string => {
  const side = (value: number) => Math.max(16, Math.min(1920, Math.round(value) || 16));
  const lead = Math.max(0, Math.min(250, Math.round(leadMs) || 0));
  const query = `w=${side(width)}&h=${side(height)}&lead=${lead}${after === null ? "" : `&after=${after}`}`;
  const path = `frame/${id}?${query}`;
  // WebView2 does not resolve custom schemes; the form Tauri rewrites them to.
  return isWindows() ? `http://media-frame.localhost/${path}` : `media-frame://${path}`;
};
