"use client";

import { useEffect, useRef, useState } from "react";

import * as core from "../../tauri/audio";
import type { AudioSource, AudioSurface, SourceRouting } from "../../tauri/audio";

/**
 * What one surface should apply to one audio source.
 *
 * The answer comes from `services/audio.rs`, which owns the single sink and its
 * device. The routing rule is **not** reimplemented here: asking Rust costs one
 * `invoke` per mounted surface per change, and graph changes are an operator
 * moving a slider, not a render loop.
 *
 * `initialRouting` is applied until Rust has answered. Falling back to silence
 * instead would mute the operator's video for a frame every time a surface
 * mounts.
 */
export function useAudioRouting(
  source: AudioSource,
  surface: AudioSurface,
  initialRouting: SourceRouting,
): SourceRouting {
  const [rustRouting, setRustRouting] = useState<SourceRouting | null>(null);

  useEffect(() => {
    let cancelled = false;
    let detach: (() => void) | null = null;

    void (async () => {
      const refresh = () => {
        void core.getSourceRouting(source, surface).then((next) => {
          if (!cancelled) setRustRouting(next);
        });
      };

      // Subscribe before the first read, so a change landing between the two
      // is not missed — the same ordering `useLooksConfig` uses.
      const unlisten = await core.onAudioChanged(refresh);
      if (cancelled) {
        unlisten();
        return;
      }
      detach = unlisten;
      refresh();
    })().catch((error: unknown) => {
      console.error("[Audio] could not reach the Rust core", error);
    });

    return () => {
      cancelled = true;
      detach?.();
    };
  }, [source, surface]);

  return rustRouting ?? initialRouting;
}

/** Apply a routing to a media element. */
export const applyAudioRouting = (
  element: (HTMLMediaElement & { setSinkId?: (id: string) => Promise<void> }) | null,
  routing: SourceRouting,
): void => {
  if (!element) return;

  element.muted = routing.muted || !routing.audible;
  element.volume = routing.audible ? clampVolume(routing.volume) : 0;

  // `null` is the system default, which reaches `setSinkId` as `""`.
  if (!routing.audible || typeof element.setSinkId !== "function") return;
  void element.setSinkId(routing.deviceId ?? "").catch((): void => undefined);
};

/**
 * `HTMLMediaElement.volume` throws on NaN or a value outside 0..1, and a throw
 * would abort the caller's effect and leave the *previous* level applied.
 * Audio that ignores the operator is worse than audio that goes quiet.
 */
const clampVolume = (volume: number): number => {
  if (!Number.isFinite(volume)) return 0;
  return Math.min(1, Math.max(0, volume));
};

/** Set the backing track's level on the Rust sink. */
export const setBackingTrackGain = async (gain: number): Promise<void> => {
  try {
    await core.setAudioSourceGain("backing-track", gain);
  } catch (error: unknown) {
    // A failed write leaves the slider ahead of the sink until the next one.
    // Not worth interrupting an operator mid-service for.
    console.error("[Audio] could not set the backing track level", error);
  }
};

/** Point the single sink at an output device. */
export const setAudioOutputDevice = async (
  deviceId: string | null,
  deviceLabel?: string | null,
): Promise<void> => {
  try {
    await core.setAudioDevice(deviceId, deviceLabel);
  } catch (error: unknown) {
    console.error("[Audio] could not set the output device", error);
  }
};

/**
 * Keep the settings screen's device choice and the Rust sink in step.
 *
 * The two audible sources read their device from the sink rather than from
 * React, so the settings picker has to write there.
 *
 * Rust is seeded *from* rather than *to* on mount, so React's first, empty
 * value never overwrites a device the operator had already chosen.
 */
export function useAudioDeviceSync(
  hydrated: boolean,
  deviceId: string | null,
  deviceLabel: string,
  seedFromRust: (deviceId: string | null, deviceLabel: string) => void,
): void {
  const seededRef = useRef(false);

  useEffect(() => {
    if (seededRef.current) return;

    let cancelled = false;
    void (async () => {
      const graph = await core.getAudioGraph();
      if (cancelled) return;
      seededRef.current = true;
      seedFromRust(graph.sink.deviceId, graph.sink.deviceLabel);
    })().catch((error: unknown) => {
      console.error("[Audio] could not read the output device", error);
    });

    return () => {
      cancelled = true;
    };
  }, [seedFromRust]);

  useEffect(() => {
    // Only after the seed, or the first render would push React's empty value
    // over whatever Rust had saved.
    if (!hydrated || !seededRef.current) return;
    void setAudioOutputDevice(deviceId, deviceLabel);
  }, [hydrated, deviceId, deviceLabel]);
}
