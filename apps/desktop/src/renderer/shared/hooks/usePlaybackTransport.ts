"use client";

/**
 * The media transport, as React sees it.
 *
 * The adapter for `services::playback`, shaped like every other slice: the hook
 * keeps its signature, no component learns which shell it is running in, and
 * the Electron path is untouched.
 *
 * Under Tauri the answer comes from Rust, which owns where the video is and
 * remembers where each item was left. Under Electron the caller keeps its own
 * state, which is what it did before.
 *
 * Two things are deliberately separate here, because collapsing them is how a
 * playhead ends up being dragged backwards mid-service:
 *
 * - `seek` is the operator saying where the video *should be*. Authoritative,
 *   and rare.
 * - `reportPosition` is the element saying where it *is*. About ten times a
 *   second, and not authoritative.
 */

import { useCallback, useEffect, useState } from "react";

const isTauriShell = (): boolean =>
  typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

/** Dynamic, so the Electron bundle never pulls in `@tauri-apps/api`. */
const rustCore = () => import("../../tauri/playback");

export type PlaybackView = {
  playing: boolean;
  positionSeconds: number;
  durationSeconds: number | null;
};

export type PlaybackTransport = PlaybackView & {
  /** True when Rust owns this, so a caller knows whether to keep its own state. */
  isRustOwned: boolean;
  play: () => void;
  pause: () => void;
  toggle: () => void;
  seek: (positionSeconds: number) => void;
  reportPosition: (positionSeconds: number) => void;
  setDuration: (durationSeconds: number | null) => void;
  ended: (looping: boolean) => void;
  /** Move to a media item, restoring where it was left. */
  selectMedia: (mediaId: string | null, autoPlay: boolean) => void;
};

/**
 * Follow the Rust transport, or report that it is not in charge.
 *
 * `electronView` is what the caller already has: its own playing flag and
 * position. It is returned unchanged under Electron, and replaced by Rust's
 * answer under Tauri.
 */
export function usePlaybackTransport(electronView: PlaybackView): PlaybackTransport {
  const onRust = isTauriShell();
  const [rustView, setRustView] = useState<PlaybackView | null>(null);

  useEffect(() => {
    if (!onRust) return;

    let cancelled = false;
    let detach: (() => void) | null = null;

    void (async () => {
      const core = await rustCore();

      const apply = (playback: {
        playing: boolean;
        positionSeconds: number;
        durationSeconds: number | null;
      }) => {
        if (cancelled) return;
        setRustView({
          playing: playback.playing,
          positionSeconds: playback.positionSeconds,
          durationSeconds: playback.durationSeconds,
        });
      };

      // Subscribe before the first read, so a change landing between the two is
      // not missed.
      const unlisten = await core.onPlaybackChanged(apply);
      if (cancelled) {
        unlisten();
        return;
      }
      detach = unlisten;
      apply(await core.getPlayback());
    })().catch((error: unknown) => {
      console.error("[Playback] could not reach the Rust core", error);
    });

    return () => {
      cancelled = true;
      detach?.();
    };
  }, [onRust]);

  const call = useCallback(
    (action: (core: Awaited<ReturnType<typeof rustCore>>) => Promise<unknown>) => {
      if (!onRust) return;
      void rustCore()
        .then(action)
        .catch((error: unknown) => {
          // A failed transport call leaves the element ahead of Rust until the
          // next one. Not worth interrupting an operator mid-service for.
          console.error("[Playback] transport call failed", error);
        });
    },
    [onRust]
  );

  const view = (onRust ? rustView : null) ?? electronView;

  return {
    ...view,
    isRustOwned: onRust && rustView !== null,
    play: useCallback(() => call((core) => core.play()), [call]),
    pause: useCallback(() => call((core) => core.pause()), [call]),
    toggle: useCallback(() => call((core) => core.toggle()), [call]),
    seek: useCallback(
      (positionSeconds: number) => call((core) => core.seek(positionSeconds)),
      [call]
    ),
    reportPosition: useCallback(
      (positionSeconds: number) => call((core) => core.reportPosition(positionSeconds)),
      [call]
    ),
    setDuration: useCallback(
      (durationSeconds: number | null) => call((core) => core.setDuration(durationSeconds)),
      [call]
    ),
    ended: useCallback((looping: boolean) => call((core) => core.ended(looping)), [call]),
    selectMedia: useCallback(
      (mediaId: string | null, autoPlay: boolean) =>
        call((core) => core.selectPlaybackMedia(mediaId, autoPlay)),
      [call]
    ),
  };
}
