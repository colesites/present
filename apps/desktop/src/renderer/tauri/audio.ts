/**
 * The single audio path, from the Rust core.
 *
 * Loaded only under Tauri and only through a dynamic import, so the Electron
 * bundle never sees `@tauri-apps/api` — the same arrangement as `looks.ts` and
 * `output.ts`.
 *
 * Mirrors `src-tauri/src/services/audio.rs`. The shape of this client is the
 * point of the slice: a surface does not decide whether it is audible, it asks
 * and applies the answer. `applyRouting` is the only place in the renderer
 * that touches `muted`, `volume` or `setSinkId`, so the invariant the audit
 * found spread across nine files (§5.3) has exactly one implementation.
 */

import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

import { safelyUnlisten } from "./electron-bridge";

/** Emitted to every window when the graph changes. `AUDIO_CHANGED_EVENT`. */
export const AUDIO_CHANGED = "audio:changed";

/**
 * Where audio is being asked about. Only `operator` can produce sound; every
 * other value is a mirror of what the operator is already hearing.
 */
export type AudioSurface =
  | "operator"
  | "audience-output"
  | "worship-stage"
  | "media-stage"
  | "screen-composer"
  | "preview"
  | "thumbnail";

export type AudioSource = "presentation-video" | "backing-track";

export type SourceLevel = { gain: number; muted: boolean };

export type AudioSink = {
  /** `null` is the system default. */
  deviceId: string | null;
  deviceLabel: string;
  masterGain: number;
  masterMuted: boolean;
};

export type AudioGraph = {
  sink: AudioSink;
  presentationVideo: SourceLevel;
  backingTrack: SourceLevel;
};

/** What a surface applies to one source. The answer, not the inputs. */
export type SourceRouting = {
  audible: boolean;
  muted: boolean;
  volume: number;
  deviceId: string | null;
};

export const getAudioGraph = (): Promise<AudioGraph> => invoke("get_audio_graph");

export const getSourceRouting = (
  source: AudioSource,
  surface: AudioSurface,
): Promise<SourceRouting> => invoke("get_source_routing", { source, surface });

export const setAudioDevice = (
  deviceId: string | null,
  deviceLabel?: string | null,
): Promise<AudioGraph> =>
  invoke("set_audio_device", { deviceId, deviceLabel: deviceLabel ?? null });

export const setAudioSourceGain = (source: AudioSource, gain: number): Promise<AudioGraph> =>
  invoke("set_audio_source_gain", { source, gain });

export const setAudioSourceMuted = (source: AudioSource, muted: boolean): Promise<AudioGraph> =>
  invoke("set_audio_source_muted", { source, muted });

export const setAudioMasterGain = (gain: number): Promise<AudioGraph> =>
  invoke("set_audio_master_gain", { gain });

export const setAudioMasterMuted = (muted: boolean): Promise<AudioGraph> =>
  invoke("set_audio_master_muted", { muted });

/** Subscribe to graph changes. Resolves to an unsubscribe function. */
export const onAudioChanged = async (
  handler: (graph: AudioGraph) => void,
): Promise<() => void> => {
  const unlisten = await listen<AudioGraph>(AUDIO_CHANGED, (event) => handler(event.payload));

  let detached = false;
  return () => {
    if (detached) return;
    detached = true;
    safelyUnlisten(unlisten);
  };
};

type RoutableElement = HTMLMediaElement & {
  setSinkId?: (deviceId: string) => Promise<void>;
};

/**
 * Apply a routing to a media element.
 *
 * The only function in the renderer that sets `muted`, `volume` or the sink.
 * Every surface calls it, including the mirrors — a mirror passes its own
 * surface and is handed silence, rather than carrying a `muted` attribute
 * somebody has to remember to write.
 *
 * `deviceId: null` reaches `setSinkId` as `""`, which is how the web platform
 * spells "the system default". A rejected `setSinkId` is swallowed: the device
 * may have been unplugged between the operator choosing it and this call, and
 * audio on the wrong device is better than a thrown error that stops playback
 * during a service.
 */
export const applyRouting = (element: RoutableElement | null, routing: SourceRouting): void => {
  if (!element) return;

  // Order matters. Mute before touching the level or the sink, so an element
  // being moved onto a mirror surface cannot make a sound in between.
  element.muted = routing.muted || !routing.audible;
  element.volume = routing.audible ? clampVolume(routing.volume) : 0;

  if (!routing.audible || typeof element.setSinkId !== "function") return;
  void element.setSinkId(routing.deviceId ?? "").catch((): void => undefined);
};

/**
 * `HTMLMediaElement.volume` throws on a value outside 0..1 or on NaN, and a
 * throw here would abort the caller's effect and leave the *previous* level
 * applied — audio that ignores the operator, which is worse than silence.
 * Rust clamps too; this is the boundary that must not trust the wire.
 */
const clampVolume = (volume: number): number => {
  if (!Number.isFinite(volume)) return 0;
  return Math.min(1, Math.max(0, volume));
};
