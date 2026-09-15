"use client";

/**
 * The media transport, as React sees it.
 *
 * The adapter for `services::playback`: Rust owns whether the video runs and
 * where it is, and the caller's own state is shown only until Rust has answered.
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

const rustCore = () => import("../../tauri/playback");

export type PlaybackView = {
  playing: boolean;
  positionSeconds: number;
  durationSeconds: number | null;
  /** When the element was at `positionSeconds`, epoch ms; `null` when unknown. */
  positionSampledAtMs: number | null;
};

export type PlaybackTransport = PlaybackView & {
  /** True once Rust has answered. */
  isRustOwned: boolean;
  play: () => void;
  pause: () => void;
  toggle: () => void;
  seek: (positionSeconds: number) => void;
  reportPosition: (positionSeconds: number) => void;
  setDuration: (durationSeconds: number | null) => void;
  ended: (looping: boolean) => void;
  /** Move to a media item: a different one starts from its beginning. */
  selectMedia: (mediaId: string | null, autoPlay: boolean) => void;
};

/**
 * Follow the Rust transport. `initialView` is what the caller already has, shown
 * until Rust answers.
 */
export function usePlaybackTransport(initialView: PlaybackView): PlaybackTransport {
  const [rustView, setRustView] = useState<PlaybackView | null>(null);

  useEffect(() => {
    let cancelled = false;
    let detach: (() => void) | null = null;

    void (async () => {
      const core = await rustCore();

      const apply = (playback: {
        playing: boolean;
        positionSeconds: number;
        durationSeconds: number | null;
        positionSampledAtMs?: number | null;
      }) => {
        if (cancelled) return;
        setRustView({
          playing: playback.playing,
          positionSeconds: playback.positionSeconds,
          durationSeconds: playback.durationSeconds,
          positionSampledAtMs: playback.positionSampledAtMs ?? null,
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
  }, []);

  const call = useCallback(
    (action: (core: Awaited<ReturnType<typeof rustCore>>) => Promise<unknown>) => {
      void rustCore()
        .then(action)
        .catch((error: unknown) => {
          // A failed transport call leaves the element ahead of Rust until the
          // next one. Not worth interrupting an operator mid-service for.
          console.error("[Playback] transport call failed", error);
        });
    },
    []
  );

  const view = rustView ?? initialView;

  return {
    ...view,
    isRustOwned: rustView !== null,
    play: useCallback(() => call((core) => core.play()), [call]),
    pause: useCallback(() => call((core) => core.pause()), [call]),
    toggle: useCallback(() => call((core) => core.toggle()), [call]),
    seek: useCallback(
      (positionSeconds: number) => {
        const sampledAtMs = Date.now();
        call((core) => core.seek(positionSeconds, sampledAtMs));
      },
      [call]
    ),
    reportPosition: useCallback(
      (positionSeconds: number) => {
        // Stamped here, where the element was read, not where Rust receives it.
        const sampledAtMs = Date.now();
        call((core) => core.reportPosition(positionSeconds, sampledAtMs));
      },
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
