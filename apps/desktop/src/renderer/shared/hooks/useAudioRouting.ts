"use client";

import { useEffect, useRef, useState } from "react";

import type { AudioSource, AudioSurface, SourceRouting } from "../../tauri/audio";

/**
 * What one surface should apply to one audio source.
 *
 * The adapter for the Rust audio graph, shaped like every other slice's:
 * the hook keeps its signature, the component does not know which shell it is
 * running in, and the Electron path is untouched.
 *
 * Under Tauri the answer comes from `services/audio.rs`, which owns the single
 * sink and its device. Under Electron the caller's own value is returned
 * unchanged, so the shipping app behaves exactly as it does today — including
 * known-issues §1, which is deliberately fixed in the rewrite only (handoff §6).
 *
 * The routing rule is **not** reimplemented here. Asking Rust costs one
 * `invoke` per mounted surface per change, and graph changes are an operator
 * moving a slider, not a render loop. Computing it in JS would put the rule in
 * two places, which is the arrangement this whole stage exists to remove.
 */

const isTauriShell = (): boolean =>
  typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

/** Dynamic, so the Electron bundle never pulls in `@tauri-apps/api`. */
const rustCore = () => import("../../tauri/audio");

export function useAudioRouting(
  source: AudioSource,
  surface: AudioSurface,
  electronRouting: SourceRouting,
): SourceRouting {
  const onRust = isTauriShell();

  // Only the Rust answer needs to be held. The Electron path already has its
  // value on every render, so storing a copy of it would be a second source of
  // truth updated one render late.
  const [rustRouting, setRustRouting] = useState<SourceRouting | null>(null);

  useEffect(() => {
    if (!onRust) return;

    let cancelled = false;
    let detach: (() => void) | null = null;

    void (async () => {
      const core = await rustCore();

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
  }, [onRust, source, surface]);

  // Before Rust has answered, keep applying what React already had. Falling
  // back to silence instead would mute the operator's video for a frame every
  // time a surface mounts.
  return (onRust ? rustRouting : null) ?? electronRouting;
}

/**
 * Apply a routing to a media element.
 *
 * Re-exported through a shell check so a shared component can call it without
 * importing the Tauri client. Under Electron it applies the same three
 * properties directly, which is what the call sites did inline before.
 */
export const applyAudioRouting = (
  element: (HTMLMediaElement & { setSinkId?: (id: string) => Promise<void> }) | null,
  routing: SourceRouting,
): void => {
  if (!element) return;

  element.muted = routing.muted || !routing.audible;
  element.volume = routing.audible ? clampVolume(routing.volume) : 0;

  // `null` is the system default, which reaches `setSinkId` as `""`. That is
  // also what an element that has never been routed already uses, so applying
  // it on the Electron path changes nothing — which is the point: the shipping
  // shell keeps known-issues §1 exactly as it is (handoff §6).
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

/**
 * Set the backing track's level on the Rust sink.
 *
 * A no-op under Electron, where the panel's own `volume` state is still the
 * only level there is. Exported from here rather than from the Tauri client so
 * a shared component can call it without importing `@tauri-apps/api`, which
 * would pull the whole Tauri runtime into the Electron bundle.
 */
export const setBackingTrackGain = async (gain: number): Promise<void> => {
  if (!isTauriShell()) return;
  try {
    const core = await rustCore();
    await core.setAudioSourceGain("backing-track", gain);
  } catch (error: unknown) {
    // A failed write leaves the slider ahead of the sink until the next one.
    // Not worth interrupting an operator mid-service for.
    console.error("[Audio] could not set the backing track level", error);
  }
};

/**
 * Point the single sink at an output device. A no-op under Electron, where the
 * setting is applied per element by whoever remembered to.
 */
export const setAudioOutputDevice = async (
  deviceId: string | null,
  deviceLabel?: string | null,
): Promise<void> => {
  if (!isTauriShell()) return;
  try {
    const core = await rustCore();
    await core.setAudioDevice(deviceId, deviceLabel);
  } catch (error: unknown) {
    console.error("[Audio] could not set the output device", error);
  }
};

/**
 * Keep the settings screen's device choice and the Rust sink in step.
 *
 * Needed because the two audible sources now read their device from the sink
 * rather than from React. Without this the settings picker would still write to
 * `localStorage` under Tauri and reach nothing, which would take the video's
 * routing away rather than give the backing track its own.
 *
 * Rust is seeded *from* rather than *to* on mount. The Tauri build is a fresh
 * browser origin with an empty `present-settings` key (known-issues §2), so
 * pushing React's value first would overwrite a device the operator had already
 * chosen with a blank one, every launch.
 *
 * A no-op under Electron, where `localStorage` remains the only owner.
 */
export function useAudioDeviceSync(
  hydrated: boolean,
  deviceId: string | null,
  deviceLabel: string,
  seedFromRust: (deviceId: string | null, deviceLabel: string) => void,
): void {
  const onRust = isTauriShell();
  const seededRef = useRef(false);

  useEffect(() => {
    if (!onRust || seededRef.current) return;

    let cancelled = false;
    void (async () => {
      const core = await rustCore();
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
  }, [onRust, seedFromRust]);

  useEffect(() => {
    // Only after the seed, or the first render would push React's empty value
    // over whatever Rust had saved.
    if (!onRust || !hydrated || !seededRef.current) return;
    void setAudioOutputDevice(deviceId, deviceLabel);
  }, [onRust, hydrated, deviceId, deviceLabel]);
}
