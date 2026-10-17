/**
 * The recording window (`src-tauri/src/commands/recorder.rs`).
 *
 * File ▸ New Recording is the only way in. Share ▸ Export Recording is the
 * only way out: the takes stay in the app until that writes them.
 */

import { invoke } from "@tauri-apps/api/core";

export type RecordingTrack = {
  id: number;
  name: string;
  seconds: number;
  recording: boolean;
  paused: boolean;
  /** Loudest sample in each slice of the take, 0 to 1. */
  peaks: number[];
};

export type RecordingSnapshot = {
  inputId: string | null;
  tracks: RecordingTrack[];
  recordingTrackId: number | null;
  pausedTrackId: number | null;
  /** 0 to 1, the loudest moment since the last read. */
  level: number;
  warning: string | null;
  /** Share ▸ Export Recording was chosen. */
  exportRequested: boolean;
  /** What this computer can write. AAC is only present on a Mac. */
  formats: RecordingFormat[];
};

export type RecordingQuality = "low" | "medium" | "high" | "highest";
export type RecordingFormat = "aac" | "mp3" | "aiff" | "wave";

export const recordingSnapshot = (): Promise<RecordingSnapshot> => invoke("recorder_snapshot");

export const setRecordingInput = (deviceId: string | null): Promise<void> =>
  invoke("recorder_set_input", { deviceId });

export const addRecordingTrack = (): Promise<RecordingTrack> => invoke("recorder_add_track");

export const renameRecordingTrack = (trackId: number, name: string): Promise<void> =>
  invoke("recorder_rename_track", { trackId, name });

export const removeRecordingTrack = (trackId: number): Promise<void> =>
  invoke("recorder_remove_track", { trackId });

export const startRecording = (trackId: number): Promise<void> =>
  invoke("recorder_start", { trackId });

export const pauseRecording = (): Promise<void> => invoke("recorder_pause");

export const stopRecording = (): Promise<void> => invoke("recorder_stop");

export const acknowledgeExport = (): Promise<void> => invoke("recorder_acknowledge_export");

/** Paths written. Empty when the save dialog was cancelled. */
export const exportRecording = (
  format: RecordingFormat,
  quality: RecordingQuality,
  fileName: string,
  scope: "mix" | "separate",
): Promise<string[]> =>
  invoke("recorder_export", {
    formatName: format,
    qualityName: quality,
    fileName,
    scope,
    trackId: null,
  });
