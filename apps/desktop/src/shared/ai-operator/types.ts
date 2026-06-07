export type AiOperatorVisualState =
  | "idle"
  | "connecting"
  | "listening"
  | "thinking"
  | "executing"
  | "success"
  | "error";

export type AiToolNamespace =
  | "present"
  | "obs"
  | "spotify"
  | "powerpoint"
  | "browser"
  | "os";

export interface AiToolJsonSchema {
  type: "object";
  properties?: Record<string, unknown>;
  required?: string[];
  additionalProperties?: boolean;
}

export interface AiModelToolDefinition {
  name: string;
  namespace: AiToolNamespace;
  description: string;
  inputSchema: AiToolJsonSchema;
  dangerous?: boolean;
  requiresConfirmation?: boolean;
}

export interface AiToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

export interface AiToolResult {
  callId: string;
  ok: boolean;
  data?: unknown;
  error?: {
    code: string;
    message: string;
  };
}

export interface AiRealtimeClientSecret {
  value: string;
  expires_at?: number;
}

export interface AiOperatorSessionMemory {
  sessionId: string;
  startedAt: number;
  currentSong?: {
    id: string;
    title: string;
    section?: string;
  };
  currentBible?: {
    translation?: string;
    book?: string;
    chapter?: number;
    verse?: number;
    range?: string;
  };
  currentMedia?: {
    id: string;
    type: "image" | "video" | "audio" | "background";
    title: string;
  };
  currentPresentation?: {
    slideIndex: number;
    slideCount: number;
    itemType?: "song" | "bible" | "media" | "notes";
  };
  currentCountdown?: {
    durationSeconds: number;
    remainingSeconds: number;
    running: boolean;
  };
  recentToolCalls: Array<{
    name: string;
    arguments: Record<string, unknown>;
    resultSummary: string;
    timestamp: number;
  }>;
}

export interface AiOperatorCommandEvent {
  call: AiToolCall;
  resolve: (result: AiToolResult) => void;
}

export type AiOperatorTranscriptEvent = {
  transcript: string;
  isFinal: boolean;
};

// ── Whisper (local, offline STT via spawned whisper-cli) ──

export interface WhisperStatus {
  /** True only when both the binary and the model are present and runnable. */
  available: boolean;
  binaryPresent: boolean;
  modelPresent: boolean;
  binaryPath: string | null;
  modelPath: string | null;
  error: string | null;
}

export interface WhisperTranscriptEvent {
  sessionId: string;
  /** Best transcript for the current rolling window. */
  transcript: string;
  /** True when an utterance boundary (pause) committed the text. */
  isFinal: boolean;
}

/** Audio contract the renderer must satisfy when streaming to whisper. */
export const WHISPER_SAMPLE_RATE = 16000;
export const WHISPER_CHANNELS = 1;
