"use client";

import { useState, useCallback, useRef, useEffect } from "react";

interface ScriptRecognitionResult {
  transcript: string;
  isFinal: boolean;
}

interface UseSpeechRecognitionOptions {
  onResult?: (result: ScriptRecognitionResult) => void;
  onFinalResult?: (transcript: string) => void;
  continuous?: boolean;
  interimResults?: boolean;
  lang?: string;
  sessionToken?: string | null;
  keyterms?: string[];
}

interface UseSpeechRecognitionReturn {
  isListening: boolean;
  isStarting: boolean;
  isSupported: boolean;
  transcript: string;
  interimTranscript: string;
  startListening: () => Promise<void>;
  stopListening: () => void;
  error: string | null;
}

// TypeScript declarations for Web Speech API
interface SpeechRecognitionEvent extends Event {
  results: SpeechRecognitionResultList;
  resultIndex: number;
}

interface SpeechRecognitionResultList {
  length: number;
  item(index: number): SpeechRecognitionResult;
  [index: number]: SpeechRecognitionResult;
}

interface SpeechRecognitionResult {
  length: number;
  item(index: number): SpeechRecognitionAlternative;
  [index: number]: SpeechRecognitionAlternative;
  isFinal: boolean;
}

interface SpeechRecognitionAlternative {
  transcript: string;
  confidence: number;
}

interface SpeechRecognitionErrorEvent extends Event {
  error: string;
  message?: string;
}

interface SpeechRecognition extends EventTarget {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((event: SpeechRecognitionEvent) => void) | null;
  onerror: ((event: SpeechRecognitionErrorEvent) => void) | null;
  onend: (() => void) | null;
  onstart: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}

declare global {
  interface Window {
    SpeechRecognition: new () => SpeechRecognition;
    webkitSpeechRecognition: new () => SpeechRecognition;
    webkitAudioContext?: typeof AudioContext;
  }
}

interface AssemblyAiTokenResponse {
  token: string;
  expiresInSeconds?: number;
}

interface AssemblyAiTokenErrorPayload {
  error?: string;
  message?: string;
}

interface AssemblyAiMessage {
  type?: string;
  id?: string;
  transcript?: string;
  utterance?: string;
  end_of_turn?: boolean;
  turn_is_formatted?: boolean;
  error?: string;
  message?: string;
}

interface StreamingSession {
  socket: WebSocket;
  mediaStream: MediaStream;
  audioContext: AudioContext;
  source: MediaStreamAudioSourceNode;
  processor: ScriptProcessorNode;
  silenceSink: GainNode;
}

const DEFAULT_WEB_APP_URL = "https://present-gha.vercel.app";
const ASSEMBLYAI_STREAM_URL = "wss://streaming.assemblyai.com/v3/ws";
const ASSEMBLYAI_TOKEN_PATH = "/api/assemblyai/token";
const ASSEMBLYAI_TOKEN_REFRESH_BUFFER_MS = 15_000;

let cachedAssemblyAiToken:
  | {
      sessionToken: string;
      token: string;
      expiresAt: number;
    }
  | null = null;

const resolveWebBaseUrl = (): string => {
  const configured = process.env.WEB_APP_URL;
  if (configured) {
    return configured;
  }

  return process.env.NODE_ENV === "development"
    ? "http://localhost:3001"
    : DEFAULT_WEB_APP_URL;
};

const sanitizeKeyterms = (value: string[] | undefined): string[] =>
  Array.from(
    new Set(
      (value ?? [])
        .map((item) => item.trim())
        .filter((item) => item.length > 0 && item.length <= 64),
    ),
  ).slice(0, 100);

const buildAssemblyAiSocketUrl = (input: {
  token: string;
  sampleRate: number;
  lang: string;
  keyterms: string[];
}): string => {
  const url = new URL(ASSEMBLYAI_STREAM_URL);
  url.searchParams.set("token", input.token);
  url.searchParams.set("sample_rate", String(input.sampleRate));
  url.searchParams.set("encoding", "pcm_s16le");
  url.searchParams.set("format_turns", "false");

  if (input.lang.toLowerCase().startsWith("en")) {
    url.searchParams.set("speech_model", "u3-rt-pro");
  } else {
    url.searchParams.set("speech_model", "universal-streaming-multilingual");
    url.searchParams.set("language_detection", "true");
  }

  for (const keyterm of input.keyterms) {
    url.searchParams.append("keyterms_prompt", keyterm);
  }

  return url.toString();
};

const float32ToPcm16 = (input: Float32Array): Int16Array => {
  const output = new Int16Array(input.length);
  for (let index = 0; index < input.length; index += 1) {
    const sample = Math.max(-1, Math.min(1, input[index] ?? 0));
    output[index] = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
  }
  return output;
};

const formatSpeechError = (error: unknown): string => {
  if (typeof error === "string" && error.trim()) {
    return error;
  }

  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }

  return "Voice input failed to start.";
};

const mapRecognitionError = (error: string): string => {
  switch (error) {
    case "not-allowed":
    case "service-not-allowed":
      return "Microphone access was denied.";
    case "audio-capture":
      return "No microphone was found for voice input.";
    case "network":
      return "Browser speech recognition is unavailable in this desktop session.";
    case "no-speech":
      return "No speech was detected.";
    default:
      return error;
  }
};

export function useSpeechRecognition(
  options: UseSpeechRecognitionOptions = {}
): UseSpeechRecognitionReturn {
  const {
    onResult,
    onFinalResult,
    continuous = true,
    interimResults = true,
    lang = "en-US",
    sessionToken = null,
    keyterms,
  } = options;

  const [isListening, setIsListening] = useState(false);
  const [isStarting, setIsStarting] = useState(false);
  const [transcript, setTranscript] = useState("");
  const [interimTranscript, setInterimTranscript] = useState("");
  const [error, setError] = useState<string | null>(null);

  const recognitionRef = useRef<SpeechRecognition | null>(null);
  const streamingSessionRef = useRef<StreamingSession | null>(null);
  const isStoppingRef = useRef(false);
  const finalTranscriptRef = useRef("");
  const activeModeRef = useRef<"assemblyai" | "webspeech" | null>(null);

  const hasBrowserSpeechRecognition =
    typeof window !== "undefined" &&
    ("SpeechRecognition" in window || "webkitSpeechRecognition" in window);

  const hasStreamingSupport =
    typeof window !== "undefined" &&
    typeof WebSocket !== "undefined" &&
    Boolean(navigator.mediaDevices?.getUserMedia) &&
    Boolean(window.AudioContext || window.webkitAudioContext);

  const isSupported =
    hasBrowserSpeechRecognition ||
    (hasStreamingSupport && Boolean(sessionToken));

  // Use refs for callbacks to avoid re-initializing recognition when they change
  const onResultRef = useRef(onResult);
  const onFinalResultRef = useRef(onFinalResult);

  useEffect(() => {
    onResultRef.current = onResult;
    onFinalResultRef.current = onFinalResult;
  }, [onResult, onFinalResult]);

  useEffect(() => {
    if (!hasBrowserSpeechRecognition) return;

    const SpeechRecognitionAPI =
      window.SpeechRecognition || window.webkitSpeechRecognition;
    recognitionRef.current = new SpeechRecognitionAPI();

    const recognition = recognitionRef.current;
    recognition.continuous = continuous;
    recognition.interimResults = interimResults;
    recognition.lang = lang;

    recognition.onstart = () => {
      setIsStarting(false);
      setIsListening(true);
      setError(null);
      isStoppingRef.current = false;
    };

    recognition.onresult = (event: SpeechRecognitionEvent) => {
      let nextFinalTranscript = finalTranscriptRef.current;
      let nextInterimTranscript = "";
      let emittedFinalTranscript = "";

      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        const text = result[0].transcript.trim();
        if (!text) {
          continue;
        }

        if (result.isFinal) {
          nextFinalTranscript = `${nextFinalTranscript} ${text}`.trim();
          emittedFinalTranscript = `${emittedFinalTranscript} ${text}`.trim();
        } else {
          nextInterimTranscript = `${nextInterimTranscript} ${text}`.trim();
        }
      }

      finalTranscriptRef.current = nextFinalTranscript;
      setTranscript(nextFinalTranscript);
      setInterimTranscript(nextInterimTranscript);

      const combinedTranscript = [nextFinalTranscript, nextInterimTranscript]
        .filter(Boolean)
        .join(" ")
        .trim();

      if (combinedTranscript) {
        onResultRef.current?.({
          transcript: combinedTranscript,
          isFinal: nextInterimTranscript.length === 0 && emittedFinalTranscript.length > 0,
        });
      }

      if (emittedFinalTranscript) {
        onFinalResultRef.current?.(emittedFinalTranscript);
      }
    };

    recognition.onerror = (event: SpeechRecognitionErrorEvent) => {
      // Ignore "aborted" errors when we intentionally stop
      if (event.error === "aborted" && isStoppingRef.current) {
        return;
      }
      setIsStarting(false);
      setError(mapRecognitionError(event.error));
      setIsListening(false);
    };

    recognition.onend = () => {
      setIsStarting(false);
      setIsListening(false);
      setInterimTranscript("");
      
      // Auto-restart if still supposed to be listening (for continuous mode)
      if (!isStoppingRef.current && continuous) {
        try {
          recognition.start();
        } catch {
          // Already started or other error
        }
      }
    };

    return () => {
      isStoppingRef.current = true;
      setIsStarting(false);
      recognition.abort();
    };
  }, [hasBrowserSpeechRecognition, continuous, interimResults, lang]);

  const requestMicrophonePermission = useCallback(async () => {
    if (typeof window === "undefined") {
      return;
    }

    const mediaAccess = await window.electronAPI?.requestMicrophoneAccess?.();
    if (mediaAccess && !mediaAccess.granted) {
      throw new Error("Microphone access was denied.");
    }
  }, []);

  const stopStreamingSession = useCallback(() => {
    const session = streamingSessionRef.current;
    streamingSessionRef.current = null;

    if (!session) {
      return;
    }

    session.processor.onaudioprocess = null;

    try {
      if (session.socket.readyState === WebSocket.OPEN) {
        session.socket.send(JSON.stringify({ type: "Terminate" }));
      }
    } catch {
      // Ignore shutdown send failures.
    }

    try {
      session.socket.close();
    } catch {
      // Ignore close errors.
    }

    try {
      session.source.disconnect();
    } catch {
      // Ignore disconnect errors.
    }

    try {
      session.processor.disconnect();
    } catch {
      // Ignore disconnect errors.
    }

    try {
      session.silenceSink.disconnect();
    } catch {
      // Ignore disconnect errors.
    }

    session.mediaStream.getTracks().forEach((track) => track.stop());
    void session.audioContext.close().catch((): void => undefined);
  }, []);

  const fetchAssemblyAiToken = useCallback(async (): Promise<AssemblyAiTokenResponse> => {
    if (!sessionToken) {
      throw new Error("Sign in to use voice search.");
    }

    if (
      cachedAssemblyAiToken &&
      cachedAssemblyAiToken.sessionToken === sessionToken &&
      cachedAssemblyAiToken.expiresAt > Date.now() + ASSEMBLYAI_TOKEN_REFRESH_BUFFER_MS
    ) {
      return {
        token: cachedAssemblyAiToken.token,
        expiresInSeconds: Math.max(
          0,
          Math.floor((cachedAssemblyAiToken.expiresAt - Date.now()) / 1000),
        ),
      };
    }

    if (window.electronAPI?.requestAssemblyAiToken) {
      const payload = await window.electronAPI.requestAssemblyAiToken(sessionToken) as
        | AssemblyAiTokenResponse
        | AssemblyAiTokenErrorPayload
        | null;

      if (!payload || !("token" in payload) || typeof payload.token !== "string") {
        const errorPayload = payload as AssemblyAiTokenErrorPayload | null;
        throw new Error(
          errorPayload?.error
          ?? errorPayload?.message
          ?? "Live transcription could not start.",
        );
      }

      cachedAssemblyAiToken = {
        sessionToken,
        token: payload.token,
        expiresAt:
          Date.now() +
          (typeof payload.expiresInSeconds === "number"
            ? payload.expiresInSeconds
            : 300) *
            1000,
      };
      return payload;
    }

    const response = await fetch(`${resolveWebBaseUrl()}${ASSEMBLYAI_TOKEN_PATH}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${sessionToken}`,
      },
      cache: "no-store",
    });

    const raw = await response.text();
    let payload: AssemblyAiTokenResponse | AssemblyAiTokenErrorPayload | null = null;

    try {
      payload = raw ? JSON.parse(raw) as AssemblyAiTokenResponse : null;
    } catch {
      payload = null;
    }

    if (!response.ok || !payload || !("token" in payload) || typeof payload.token !== "string") {
      const errorPayload = payload as AssemblyAiTokenErrorPayload | null;
      const message =
        errorPayload?.error
        ?? errorPayload?.message
        ?? raw;
      throw new Error(message || "Live transcription could not start.");
    }

    cachedAssemblyAiToken = {
      sessionToken,
      token: payload.token,
      expiresAt:
        Date.now() +
        (typeof payload.expiresInSeconds === "number"
          ? payload.expiresInSeconds
          : 300) *
          1000,
    };
    return payload;
  }, [sessionToken]);

  const startAssemblyAiListening = useCallback(async () => {
    if (!hasStreamingSupport) {
      throw new Error("Live transcription is unavailable in this runtime.");
    }

    await requestMicrophonePermission();

    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error("Audio capture is unavailable in this desktop session.");
    }

    const [mediaStreamResult, tokenResult] = await Promise.allSettled([
      navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      }),
      fetchAssemblyAiToken(),
    ]);

    if (mediaStreamResult.status === "rejected") {
      throw mediaStreamResult.reason;
    }

    const mediaStream = mediaStreamResult.value;

    if (tokenResult.status === "rejected") {
      mediaStream.getTracks().forEach((track) => track.stop());
      throw tokenResult.reason;
    }

    const { token } = tokenResult.value;

    const AudioContextCtor = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextCtor) {
      mediaStream.getTracks().forEach((track) => track.stop());
      throw new Error("Audio capture is unavailable in this desktop session.");
    }

    const audioContext = new AudioContextCtor({ sampleRate: 16000 });
    const source = audioContext.createMediaStreamSource(mediaStream);
    const processor = audioContext.createScriptProcessor(4096, 1, 1);
    const silenceSink = audioContext.createGain();
    silenceSink.gain.value = 0;

    source.connect(processor);
    processor.connect(silenceSink);
    silenceSink.connect(audioContext.destination);

    try {
      await audioContext.resume();
      const socketUrl = buildAssemblyAiSocketUrl({
        token,
        sampleRate: audioContext.sampleRate,
        lang,
        keyterms: sanitizeKeyterms(keyterms),
      });

      const socket = new WebSocket(socketUrl);
      socket.binaryType = "arraybuffer";

      const session: StreamingSession = {
        socket,
        mediaStream,
        audioContext,
        source,
        processor,
        silenceSink,
      };

      streamingSessionRef.current = session;
      activeModeRef.current = "assemblyai";

      await new Promise<void>((resolve, reject) => {
        const handleOpen = () => {
          socket.removeEventListener("open", handleOpen);
          socket.removeEventListener("error", handleSocketOpenError);
          resolve();
        };

        const handleSocketOpenError = () => {
          socket.removeEventListener("open", handleOpen);
          socket.removeEventListener("error", handleSocketOpenError);
          reject(new Error("AssemblyAI connection failed."));
        };

        socket.addEventListener("open", handleOpen, { once: true });
        socket.addEventListener("error", handleSocketOpenError, { once: true });
      });

      processor.onaudioprocess = (event) => {
        if (socket.readyState !== WebSocket.OPEN) {
          return;
        }

        const inputData = event.inputBuffer.getChannelData(0);
        if (!inputData?.length) {
          return;
        }

        const pcmChunk = float32ToPcm16(inputData);
        socket.send(pcmChunk.buffer);
      };

      socket.onmessage = (event) => {
        let payload: AssemblyAiMessage;

        try {
          payload = JSON.parse(String(event.data)) as AssemblyAiMessage;
        } catch {
          return;
        }

        if (payload.type === "Begin") {
          console.info("[AssemblyAI] streaming session started", {
            sessionId: typeof event.data === "string" ? payload["id"] : undefined,
          });
          setIsStarting(false);
          setIsListening(true);
          setError(null);
          return;
        }

        if (payload.type === "Error" || payload.error || payload.message) {
          setIsStarting(false);
          setError(payload.error ?? payload.message ?? "Live transcription failed.");
          return;
        }

        if (payload.type !== "Turn") {
          if (payload.type === "Termination") {
            setIsStarting(false);
            setIsListening(false);
            setInterimTranscript("");
          }
          return;
        }

        const runningTranscript = String(payload.transcript ?? "").trim();
        const utterance = String(payload.utterance ?? "").trim();
        const isFinalTurn =
          Boolean(payload.end_of_turn) ||
          Boolean(utterance) ||
          Boolean(payload.turn_is_formatted);

        if (runningTranscript) {
          setTranscript(runningTranscript);
          setInterimTranscript(isFinalTurn ? "" : runningTranscript);
          onResultRef.current?.({
            transcript: runningTranscript,
            isFinal: isFinalTurn,
          });
        }

        const finalTranscript = utterance || (isFinalTurn ? runningTranscript : "");
        if (finalTranscript) {
          finalTranscriptRef.current = finalTranscript;
          onFinalResultRef.current?.(finalTranscript);
        }
      };

      socket.onerror = (event) => {
        console.error("[AssemblyAI] websocket error", event);
        setIsStarting(false);
        setError("Live transcription connection failed.");
      };

      socket.onclose = (event) => {
        console.error("[AssemblyAI] websocket closed", {
          code: event.code,
          reason: event.reason,
          wasClean: event.wasClean,
        });

        if (streamingSessionRef.current?.socket === socket) {
          stopStreamingSession();
        }
        setIsStarting(false);
        setIsListening(false);
        setInterimTranscript("");

        if (!isStoppingRef.current) {
          const closeMessage = event.reason
            ? `Live transcription closed (${event.code}): ${event.reason}`
            : `Live transcription closed (${event.code}).`;

          setError((currentError) => currentError ?? closeMessage);
        }
      };
    } catch (error) {
      const partialSession = streamingSessionRef.current;
      if (partialSession) {
        stopStreamingSession();
      } else {
        processor.onaudioprocess = null;
        mediaStream.getTracks().forEach((track) => track.stop());
        void audioContext.close().catch((): void => undefined);
      }
      throw error;
    }
  }, [
    fetchAssemblyAiToken,
    hasStreamingSupport,
    keyterms,
    lang,
    requestMicrophonePermission,
    stopStreamingSession,
  ]);

  const startListening = useCallback(async () => {
    if (isListening || isStarting) {
      return Promise.resolve();
    }

    finalTranscriptRef.current = "";
    setTranscript("");
    setInterimTranscript("");
    setError(null);
    setIsStarting(true);
    isStoppingRef.current = false;

    if (sessionToken && hasStreamingSupport) {
      try {
        await startAssemblyAiListening();
        return;
      } catch (error) {
        stopStreamingSession();
        activeModeRef.current = null;
        if (!hasBrowserSpeechRecognition) {
          setIsStarting(false);
          setError(formatSpeechError(error));
          return;
        }
      }
    }

    if (!recognitionRef.current) {
      setIsStarting(false);
      setError("Voice input is unavailable in this runtime.");
      return;
    }

    activeModeRef.current = "webspeech";
    return requestMicrophonePermission()
      .then(() => {
        recognitionRef.current?.start();
      })
      .catch((e) => {
        setIsStarting(false);
        setError(formatSpeechError(e));
      });
  }, [
    sessionToken,
    hasBrowserSpeechRecognition,
    hasStreamingSupport,
    isListening,
    isStarting,
    requestMicrophonePermission,
    startAssemblyAiListening,
    stopStreamingSession,
  ]);

  const stopListening = useCallback(() => {
    isStoppingRef.current = true;
    setIsStarting(false);
    if (activeModeRef.current === "assemblyai") {
      stopStreamingSession();
      activeModeRef.current = null;
      setIsListening(false);
      setInterimTranscript("");
      return;
    }

    if (recognitionRef.current) {
      try {
        recognitionRef.current.stop();
      } catch {
        // Already stopped
      }
    }

    activeModeRef.current = null;
    setIsListening(false);
    setInterimTranscript("");
  }, [stopStreamingSession]);

  useEffect(() => {
    return () => {
      stopStreamingSession();
    };
  }, [stopStreamingSession]);

  return {
    isListening,
    isStarting,
    isSupported,
    transcript: transcript.trim(),
    interimTranscript,
    startListening,
    stopListening,
    error,
  };
}
