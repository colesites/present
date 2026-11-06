/**
 * The recording window (`src-tauri/src/commands/recorder.rs`).
 *
 * File ▸ New Recording is the only way in. Share ▸ Export Recording is the
 * only way out: the takes stay in the app until that writes them.
 */

import { invoke } from "@tauri-apps/api/core";

/**
 * A track's place in the mix: its header's fader, pan, mute and solo. Not the
 * record level, which is how loud the take is printed.
 */
export type TrackMix = {
  /** Fader in dB, from SILENT_DB (off) to MAX_DB. */
  volumeDb: number;
  /** -1 hard left, 0 middle, 1 hard right. */
  pan: number;
  mute: boolean;
  solo: boolean;
};

export const SILENT_DB = -96;
export const MAX_DB = 6;
export const DEFAULT_MIX: TrackMix = { volumeDb: 0, pan: 0, mute: false, solo: false };

export type RecordingTrack = {
  id: number;
  name: string;
  /** Where the take begins on the timeline, in seconds. */
  start: number;
  /** How long the take is, in seconds. */
  seconds: number;
  recording: boolean;
  paused: boolean;
  /** Loudest moment in each slice of the take (peaksPerSecond a second), 0 to 255. */
  peaks: number[];
  /** Changes when what the track plays changes. Volume, pan, mute and solo do not. */
  revision: number;
  strip: ChannelStrip;
  mix: TrackMix;
};

export type RecordingSnapshot = {
  inputId: string | null;
  tracks: RecordingTrack[];
  /** The track the input is heard through and recorded onto. */
  armedTrackId: number | null;
  recordingTrackId: number | null;
  pausedTrackId: number | null;
  /** 0 to 1, the loudest moment since the last read. */
  level: number;
  warning: string | null;
  /** Feedback protection heard feedback and muted monitoring. */
  feedback: boolean;
  /** Share ▸ Export Recording was chosen. */
  exportRequested: boolean;
  /** What this computer can write. AAC is only present on a Mac. */
  formats: RecordingFormat[];
  peaksPerSecond: number;
};

export type RecordingQuality = "low" | "medium" | "high" | "highest";
export type RecordingFormat = "aac" | "mp3" | "aiff" | "wave";

/** Smart controls. Knobs are 0 to 100. */
export type ChannelStrip = {
  recordLevel: number;
  autoLevel: boolean;
  noiseGate: boolean;
  noiseGateAmount: number;
  monitor: boolean;
  feedbackProtection: boolean;
  compressor: boolean;
  compressorAmount: number;
  eq: boolean;
  eqLow: number;
  eqMid: number;
  eqHigh: number;
  eqLowCut: number;
  eqMidFreq: number;
  ambience: number;
  reverb: number;
};

export const DEFAULT_STRIP: ChannelStrip = {
  recordLevel: 75,
  autoLevel: false,
  noiseGate: false,
  noiseGateAmount: 35,
  monitor: false,
  feedbackProtection: false,
  compressor: true,
  compressorAmount: 35,
  eq: true,
  eqLow: 50,
  eqMid: 48,
  eqHigh: 55,
  eqLowCut: 20,
  eqMidFreq: 60,
  ambience: 25,
  reverb: 40,
};

export const setChannelStrip = (trackId: number, strip: ChannelStrip): Promise<void> =>
  invoke("recorder_set_strip", { trackId, strip });

export const setTrackMix = (trackId: number, mix: TrackMix): Promise<void> =>
  invoke("recorder_set_mix", { trackId, mix });

export const armRecordingTrack = (trackId: number): Promise<void> =>
  invoke("recorder_arm", { trackId });

/** The input and the speakers are one source: monitoring out loud would feed back. */
export const monitoringFeedbackRisk = (): Promise<boolean> => invoke("recorder_feedback_risk");

/** After feedback protection muted monitoring: carry on, or turn monitoring off. */
export const resolveFeedback = (keepMonitoring: boolean): Promise<void> =>
  invoke("recorder_resolve_feedback", { keepMonitoring });

export const recordingSnapshot = (): Promise<RecordingSnapshot> => invoke("recorder_snapshot");

export const setRecordingInput = (deviceId: string | null): Promise<void> =>
  invoke("recorder_set_input", { deviceId });

export const addRecordingTrack = (): Promise<RecordingTrack> => invoke("recorder_add_track");

export const renameRecordingTrack = (trackId: number, name: string): Promise<void> =>
  invoke("recorder_rename_track", { trackId, name });

export const removeRecordingTrack = (trackId: number): Promise<void> =>
  invoke("recorder_remove_track", { trackId });

export const clearRecordingTrack = (trackId: number): Promise<void> =>
  invoke("recorder_clear_track", { trackId });

/** One track's take through its smart controls, as a WAVE. */
export const getTrackPlayback = (trackId: number): Promise<ArrayBuffer> =>
  invoke("recorder_playback_track", { trackId });

/** Record onto `trackId` from `at` seconds on the timeline. */
export const startRecording = (trackId: number, at: number): Promise<void> =>
  invoke("recorder_start", { trackId, at });

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
