/**
 * The computer's audio devices and the test sound, from the Rust core
 * (`src-tauri/src/commands/sound.rs`).
 *
 * The devices are the system's own, named and identified by Core Audio (or
 * WASAPI, or ALSA), not WebKit's: WebKit lists none until a page has opened
 * the microphone, and its ids are its own. An output's `id` is what the audio
 * graph's sink holds and the sound engine plays on.
 */

import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

import { safelyUnlisten } from "./electron-bridge";

export type AudioDevice = {
  /** Stable across restarts and reconnections. */
  id: string;
  label: string;
  isDefault: boolean;
};

export type AudioDevices = {
  outputs: AudioDevice[];
  inputs: AudioDevice[];
};

export const listAudioDevices = (): Promise<AudioDevices> => invoke("list_audio_devices");

/** A short tone on the output the sound goes to. */
export const playTestSound = (): Promise<void> => invoke("play_test_sound");

/** The backing track, played by Rust like the video's sound. */
export type BackingTrack = {
  /** The file, or `null` with none loaded. */
  path: string | null;
  playing: boolean;
  positionSeconds: number;
  durationSeconds: number | null;
};

/** `BACKING_TRACK_EVENT`. */
export const BACKING_TRACK_CHANGED = "backing-track:changed";

export const getBackingTrack = (): Promise<BackingTrack> => invoke("get_backing_track");

/** Play `path`: from its start, or from where it was paused if it is the one loaded. */
export const backingTrackPlay = (path: string): Promise<void> => invoke("backing_track_play", { path });
export const backingTrackPause = (): Promise<void> => invoke("backing_track_pause");
export const backingTrackSeek = (seconds: number): Promise<void> =>
  invoke("backing_track_seek", { seconds });
export const backingTrackStop = (): Promise<void> => invoke("backing_track_stop");

/**
 * Follow the backing track: about four times a second while it plays, and
 * whenever it starts, stops or moves. `ended` is set once, when it plays to
 * its end. Resolves to an unsubscribe function.
 */
export const onBackingTrackChanged = async (
  handler: (track: BackingTrack & { ended: boolean }) => void,
): Promise<() => void> => {
  const unlisten = await listen<BackingTrack & { ended: boolean }>(BACKING_TRACK_CHANGED, (event) =>
    handler(event.payload),
  );
  let detached = false;
  return () => {
    if (detached) return;
    detached = true;
    safelyUnlisten(unlisten);
  };
};

/** A microphone being listened to by Rust. */
export type ListeningMicrophone = {
  /** What the samples are: 16-bit little-endian mono at this rate. */
  sampleRate: number;
  /** The device, as the system names it. */
  label: string;
  stop: () => void;
};

/**
 * Listen to a microphone (the system's id, from `listAudioDevices`; `null`
 * for the default). Rust opens the device and FFmpeg converts it; `onAudio`
 * receives the samples about twenty times a second until `stop`.
 */
export const startMicrophone = async (
  deviceId: string | null,
  onAudio: (pcm: ArrayBuffer) => void,
): Promise<ListeningMicrophone> => {
  const { Channel } = await import("@tauri-apps/api/core");
  const channel = new Channel<ArrayBuffer>();
  channel.onmessage = onAudio;
  const started = await invoke<{ session: number; sampleRate: number; label: string }>(
    "start_microphone",
    { deviceId, onAudio: channel },
  );
  let stopped = false;
  return {
    sampleRate: started.sampleRate,
    label: started.label,
    stop: () => {
      if (stopped) return;
      stopped = true;
      channel.onmessage = () => undefined;
      void invoke("stop_microphone", { session: started.session }).catch((error: unknown) =>
        console.error("[Audio] could not stop the microphone", error),
      );
    },
  };
};
