/**
 * The single audio path, from the Rust core.
 *
 * Loaded only under Tauri and only through a dynamic import, so the Electron
 * bundle never sees `@tauri-apps/api` — the same arrangement as `looks.ts` and
 * `output.ts`.
 *
 * Mirrors `src-tauri/src/services/audio.rs`. Transport only: `invoke` and
 * `listen`, with no rules of its own. The sound itself is played by Rust
 * (`services/sound`), which follows this graph for the device and the levels;
 * no element in the webview makes a sound.
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
