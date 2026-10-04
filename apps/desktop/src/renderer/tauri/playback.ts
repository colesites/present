/**
 * The media transport, from the Rust core.
 *
 * Loaded only under Tauri and only through a dynamic import, so the Electron
 * bundle never sees `@tauri-apps/api`.
 *
 * Mirrors `src-tauri/src/services/playback.rs`. Transport only: no rules of its
 * own, because the rules are the part that moved.
 *
 * Note `reportPosition` next to `seek`. A report is the element saying where it
 * *is*; a seek is the operator saying where it *should be*. They arrive at very
 * different rates and only one of them is authoritative.
 */

import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

import { safelyUnlisten } from "./electron-bridge";

/** `PLAYBACK_CHANGED_EVENT`. */
export const PLAYBACK_CHANGED = "playback:changed";

export type MediaPlayback = {
  mediaId: string | null;
  playing: boolean;
  positionSeconds: number;
  /** `null` until the element reports it. A video without one is still playable. */
  durationSeconds: number | null;
  /** When the element was at `positionSeconds`, epoch ms. `null` when set, not observed. */
  positionSampledAtMs: number | null;
};

export const getPlayback = (): Promise<MediaPlayback> => invoke("get_playback");

/** `mediaUrl` is the item's file: Rust plays its sound (`services/sound`). */
export const selectPlaybackMedia = (
  mediaId: string | null,
  mediaUrl: string | null,
  autoPlay: boolean,
): Promise<MediaPlayback> => invoke("select_playback_media", { mediaId, mediaUrl, autoPlay });

export const play = (): Promise<MediaPlayback> => invoke("play_playback");
export const pause = (): Promise<MediaPlayback> => invoke("pause_playback");
export const toggle = (): Promise<MediaPlayback> => invoke("toggle_playback");
export const stop = (): Promise<MediaPlayback> => invoke("stop_playback");

export const seek = (positionSeconds: number, sampledAtMs: number): Promise<MediaPlayback> =>
  invoke("seek_playback", { positionSeconds, sampledAtMs });

export const reportPosition = (
  positionSeconds: number,
  sampledAtMs: number,
): Promise<MediaPlayback> =>
  invoke("report_playback_position", { positionSeconds, sampledAtMs });

export const setDuration = (durationSeconds: number | null): Promise<MediaPlayback> =>
  invoke("set_playback_duration", { durationSeconds });

export const ended = (looping: boolean): Promise<MediaPlayback> =>
  invoke("playback_ended", { looping });

/** Subscribe to transport changes. Resolves to an unsubscribe function. */
export const onPlaybackChanged = async (
  handler: (playback: MediaPlayback) => void,
): Promise<() => void> => {
  const unlisten = await listen<MediaPlayback>(PLAYBACK_CHANGED, (event) =>
    handler(event.payload),
  );

  let detached = false;
  return () => {
    if (detached) return;
    detached = true;
    safelyUnlisten(unlisten);
  };
};
