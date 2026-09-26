"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import {
  ensureFreshDesktopAccessToken,
  updateDesktopBillingSnapshot,
  type DesktopBillingSnapshot,
} from "../../../renderer/shared/store/desktopSession";
import { useSpeechUsageStore } from "../../../renderer/shared/store/speechUsage";

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
  inputDeviceId?: string | null;
  sessionToken?: string | null;
  keyterms?: string[];
  // "song" is the library's voice search, a Pro and Power feature.
  usageSource?: "bible" | "library" | "song";
  throwOnStartFailure?: boolean;
}

interface UseSpeechRecognitionReturn {
  isListening: boolean;
  isStarting: boolean;
  isSupported: boolean;
  transcript: string;
  interimTranscript: string;
  activeSessionStartedAtMs: number | null;
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
  sessionId?: string;
  allowedDurationSeconds?: number;
  billing?: DesktopBillingSnapshot;
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

interface AssemblyAiUsageResponse {
  sessionId?: string;
  usedSeconds?: number;
  billing?: DesktopBillingSnapshot;
}

interface StreamingSession {
  billingSessionId: string | null;
  socket: WebSocket;
  mediaStream: MediaStream;
  audioContext: AudioContext;
  source: MediaStreamAudioSourceNode;
  processor: ScriptProcessorNode;
  silenceSink: GainNode;
  startedAtMs: number;
  maxDurationSeconds: number;
}

const DEFAULT_WEB_APP_URL = "https://present.multivrs.space";
const ASSEMBLYAI_STREAM_URL = "wss://streaming.assemblyai.com/v3/ws";
const SPEECH_QUOTA_EXHAUSTED_MESSAGE =
  "You've used all of your speech-to-search time for this billing period. Upgrade your plan or wait for the next billing period to continue using voice search.";

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
    url.searchParams.set("speech_model", "universal-3-5-pro");
    url.searchParams.set("language_code", "en");
  } else {
    url.searchParams.set("speech_model", "universal-streaming-multilingual");
    url.searchParams.set("language_detection", "true");
  }

  for (const keyterm of input.keyterms) {
    url.searchParams.append("keyterms_prompt", keyterm);
  }

  return url.toString();
};

const shouldEmitTranscriptForLanguage = (transcript: string, lang: string): boolean => {
  if (!lang.toLowerCase().startsWith("en")) {
    return true;
  }

  const letters = transcript.match(/\p{Letter}/gu) ?? [];
  if (letters.length === 0) {
    return true;
  }

  const latinLetters = transcript.match(/\p{Script=Latin}/gu) ?? [];
  return latinLetters.length / letters.length >= 0.7;
};

const float32ToPcm16 = (input: Float32Array): ArrayBuffer => {
  const output = new Int16Array(input.length);
  for (let index = 0; index < input.length; index += 1) {
    const sample = Math.max(-1, Math.min(1, input[index] ?? 0));
    output[index] = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
  }
  return output.buffer;
};

const formatSpeechError = (error: unknown): string => {
  if (typeof error === "string" && error.trim()) {
    if (/speech-to-search quota exhausted|quota exhausted/i.test(error)) {
      return SPEECH_QUOTA_EXHAUSTED_MESSAGE;
    }

    return error;
  }

  if (error instanceof Error && error.message.trim()) {
    if (/speech-to-search quota exhausted|quota exhausted/i.test(error.message)) {
      return SPEECH_QUOTA_EXHAUSTED_MESSAGE;
    }

    return error.message;
  }

  return "Voice input failed to start.";
};

const parseAssemblyAiTokenPayload = (
  payload: AssemblyAiTokenResponse | AssemblyAiTokenErrorPayload | null,
  fallbackMessage: string,
): AssemblyAiTokenResponse => {
  if (!payload || !("token" in payload) || typeof payload.token !== "string") {
    const errorPayload = payload as AssemblyAiTokenErrorPayload | null;
    throw new Error(
      errorPayload?.message
      ?? errorPayload?.error
      ?? fallbackMessage,
    );
  }

  return payload;
};

const computeBoundedSessionUsageSeconds = (input: {
  startedAtMs: number;
  maxDurationSeconds: number;
  endedAtMs?: number;
}): number => {
  const elapsedSeconds = Math.max(
    0,
    Math.ceil(((input.endedAtMs ?? Date.now()) - input.startedAtMs) / 1000),
  );

  return Math.min(input.maxDurationSeconds, elapsedSeconds);
};

const resolveInputDeviceConstraint = async (
  preferredInputDeviceId: string | null,
): Promise<MediaTrackConstraints> => {
  const baseConstraints: MediaTrackConstraints = {
    channelCount: 1,
    echoCancellation: true,
    noiseSuppression: true,
    autoGainControl: true,
  };

  const normalizedDeviceId = preferredInputDeviceId?.trim();
  if (
    !normalizedDeviceId ||
    normalizedDeviceId === "default" ||
    normalizedDeviceId === "communications" ||
    !navigator.mediaDevices?.enumerateDevices
  ) {
    return baseConstraints;
  }

  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    const matchingDevice = devices.find(
      (device) =>
        device.kind === "audioinput" && device.deviceId === normalizedDeviceId,
    );

    if (!matchingDevice) {
      return baseConstraints;
    }

    return {
      ...baseConstraints,
      deviceId: { exact: normalizedDeviceId },
    };
  } catch {
    return baseConstraints;
  }
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
    inputDeviceId = null,
    sessionToken = null,
    keyterms,
    usageSource = "bible",
    throwOnStartFailure = false,
  } = options;

  const [isListening, setIsListening] = useState(false);
  const [isStarting, setIsStarting] = useState(false);
  const [transcript, setTranscript] = useState("");
  const [interimTranscript, setInterimTranscript] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [activeSessionStartedAtMs, setActiveSessionStartedAtMs] = useState<number | null>(null);
  const setSharedActiveSessionStartedAtMs = useSpeechUsageStore(
    (state) => state.setActiveSessionStartedAtMs,
  );
  const setPendingCommittedUsageSeconds = useSpeechUsageStore(
    (state) => state.setPendingCommittedUsageSeconds,
  );

  const recognitionRef = useRef<SpeechRecognition | null>(null);
  const streamingSessionRef = useRef<StreamingSession | null>(null);
  const isStoppingRef = useRef(false);
  const finalTranscriptRef = useRef("");
  const activeModeRef = useRef<"assemblyai" | "webspeech" | null>(null);
  const isElectronRuntime =
    typeof window !== "undefined" && Boolean(window.electronAPI);

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
        if (!text || !shouldEmitTranscriptForLanguage(text, lang)) {
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

  const checkMicrophonePermission = useCallback(async () => {
    if (typeof window === "undefined") {
      return { granted: true, status: "unknown" };
    }
    const mediaAccess = await window.electronAPI?.requestMicrophoneAccess?.() as { granted: boolean; status: string } | undefined;
    return mediaAccess ?? { granted: true, status: "unknown" };
  }, []);

  const stopStreamingSession = useCallback(() => {
    const session = streamingSessionRef.current;
    streamingSessionRef.current = null;

    if (!session) {
      return;
    }

    session.processor.onaudioprocess = null;
    const endedAtMs = Date.now();
    const localUsedSeconds = computeBoundedSessionUsageSeconds({
      startedAtMs: session.startedAtMs,
      maxDurationSeconds: session.maxDurationSeconds,
      endedAtMs,
    });
    setPendingCommittedUsageSeconds(localUsedSeconds);

    if (session.billingSessionId) {
      const authBearerPromise =
        typeof window !== "undefined" && window.electronAPI
          ? ensureFreshDesktopAccessToken().catch((): null => null)
          : Promise.resolve(sessionToken);

      void authBearerPromise.then((authBearer) => {
        if (!authBearer) {
          return;
        }

        // Through the Rust core for the same reason the token request goes
        // there — a browser preflight from the app's origin would drop it
        // silently, and this call is what meters the feature.
        void import("../../../renderer/tauri/runtime")
          .then(({ reportSpeechUsage }) =>
            reportSpeechUsage({
              webAppBaseUrl: resolveWebBaseUrl(),
              authBearer,
              sessionId: session.billingSessionId as string,
              endedAtMs,
            }),
          )
          .then((payload) => {
            const usage = payload as AssemblyAiUsageResponse | null;
            if (usage?.billing) {
              updateDesktopBillingSnapshot(usage.billing);
            }
            // Recorded, so nothing is pending. The web-route path this replaced
            // did this; the Rust path had not.
            if (usage) {
              setPendingCommittedUsageSeconds(0);
            }
          })
          .catch((error: unknown) => {
            console.error("[Speech] usage report failed", error);
          });
      });
    }

    setActiveSessionStartedAtMs(null);
    setSharedActiveSessionStartedAtMs(null);

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
  }, [
    sessionToken,
    setPendingCommittedUsageSeconds,
    setActiveSessionStartedAtMs,
    setSharedActiveSessionStartedAtMs,
  ]);

  const fetchAssemblyAiToken = useCallback(async (): Promise<AssemblyAiTokenResponse> => {
    if (!sessionToken) {
      throw new Error("Sign in to use voice search.");
    }

    // The web route is called from the Rust core. The broker does not move — the desktop must never hold an AssemblyAI key
    // — but a request from Rust is not a browser request, so there is no CORS
    // preflight and no origin allowlist to keep in step with the app's origin.
    // That preflight is why this ended up being used through the web app.
    const fetchFromRustCore = async (): Promise<AssemblyAiTokenResponse> => {
      const { requestSpeechToken } = await import("../../../renderer/tauri/runtime");

      try {
        const payload = await requestSpeechToken({
          webAppBaseUrl: resolveWebBaseUrl(),
          sessionToken,
          source: usageSource,
        });
        return parseAssemblyAiTokenPayload(
          payload as AssemblyAiTokenResponse | null,
          "Live transcription could not start.",
        );
      } catch (error) {
        // Rust rejects with `{ kind, message }`; surface the message the same
        // way the web-route path does.
        const appError = error as { message?: string } | null;
        throw new Error(
          formatSpeechError(
            appError?.message ?? "Live transcription could not start.",
          ),
        );
      }
    };

    const payload = await fetchFromRustCore();
    if (payload.billing) {
      updateDesktopBillingSnapshot(payload.billing);
    }
    return payload;
  }, [sessionToken, usageSource]);

  const startAssemblyAiListening = useCallback(async () => {
    if (!hasStreamingSupport) {
      throw new Error("Live transcription is unavailable in this runtime.");
    }

    const osPermission = await checkMicrophonePermission();
    if (!osPermission.granted && osPermission.status !== "not-determined") {
      console.warn("[Speech] OS reports microphone access is not granted:", osPermission);
    }

    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error("Audio capture is unavailable in this desktop session.");
    }

    const audioConstraints = await resolveInputDeviceConstraint(inputDeviceId);

    const [mediaStreamResult, tokenResult] = await Promise.allSettled([
      navigator.mediaDevices.getUserMedia({
        audio: audioConstraints,
      }),
      fetchAssemblyAiToken(),
    ]);

    if (mediaStreamResult.status === "rejected") {
      if (!osPermission.granted) {
        throw new Error(
          "Microphone access is blocked by macOS. Enable Present in System Settings > Privacy & Security > Microphone. If no prompt appears, run `tccutil reset Microphone` and fully restart Present.",
        );
      }
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

    const audioContext = new AudioContextCtor();
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
        billingSessionId: tokenResult.value.sessionId ?? null,
        socket,
        mediaStream,
        audioContext,
        source,
        processor,
        silenceSink,
        startedAtMs: Date.now(),
        maxDurationSeconds:
          tokenResult.value.allowedDurationSeconds ?? Number.MAX_SAFE_INTEGER,
      };

      streamingSessionRef.current = session;
      activeModeRef.current = "assemblyai";
      setActiveSessionStartedAtMs(session.startedAtMs);
      setSharedActiveSessionStartedAtMs(session.startedAtMs);

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
        socket.send(pcmChunk);
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
          setActiveSessionStartedAtMs(null);
          setSharedActiveSessionStartedAtMs(null);
          setPendingCommittedUsageSeconds(0);
          return;
        }

        if (payload.type !== "Turn") {
          if (payload.type === "Termination") {
            setIsStarting(false);
            setIsListening(false);
            setInterimTranscript("");
            setActiveSessionStartedAtMs(null);
            setSharedActiveSessionStartedAtMs(null);
            setPendingCommittedUsageSeconds(0);
          }
          return;
        }

        const runningTranscript = String(payload.transcript ?? "").trim();
        const utterance = String(payload.utterance ?? "").trim();
        const isFinalTurn =
          Boolean(payload.end_of_turn) ||
          Boolean(utterance) ||
          Boolean(payload.turn_is_formatted);

        if (runningTranscript && shouldEmitTranscriptForLanguage(runningTranscript, lang)) {
          setTranscript(runningTranscript);
          setInterimTranscript(isFinalTurn ? "" : runningTranscript);
          onResultRef.current?.({
            transcript: runningTranscript,
            isFinal: isFinalTurn,
          });
        }

        const finalTranscript = utterance || (isFinalTurn ? runningTranscript : "");
        if (finalTranscript && shouldEmitTranscriptForLanguage(finalTranscript, lang)) {
          finalTranscriptRef.current = finalTranscript;
          onFinalResultRef.current?.(finalTranscript);
        }
      };

      socket.onerror = (event) => {
        console.error("[AssemblyAI] websocket error", event);
        setIsStarting(false);
        setError("Live transcription connection failed.");
        setActiveSessionStartedAtMs(null);
        setSharedActiveSessionStartedAtMs(null);
        setPendingCommittedUsageSeconds(0);
      };

      socket.onclose = (event) => {
        if (!isStoppingRef.current && !(event.wasClean && event.code === 1005)) {
          console.error("[AssemblyAI] websocket closed", {
            code: event.code,
            reason: event.reason,
            wasClean: event.wasClean,
          });
        }

        if (streamingSessionRef.current?.socket === socket) {
          stopStreamingSession();
        }
        setIsStarting(false);
        setIsListening(false);
        setInterimTranscript("");
        setActiveSessionStartedAtMs(null);
        setSharedActiveSessionStartedAtMs(null);
        setPendingCommittedUsageSeconds(0);

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
    inputDeviceId,
    keyterms,
    lang,
    checkMicrophonePermission,
    setSharedActiveSessionStartedAtMs,
    setPendingCommittedUsageSeconds,
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
        console.error("[Speech] live transcription startup failed", error);
        stopStreamingSession();
        activeModeRef.current = null;
        if (isElectronRuntime || !hasBrowserSpeechRecognition) {
          const message = formatSpeechError(error);
          setIsStarting(false);
          setError(message);
          setSharedActiveSessionStartedAtMs(null);
          setPendingCommittedUsageSeconds(0);
          if (throwOnStartFailure) {
            throw new Error(message);
          }
          return;
        }
      }
    }

    if (!recognitionRef.current) {
      const message = "Voice input is unavailable in this runtime.";
      setIsStarting(false);
      setError(message);
      setSharedActiveSessionStartedAtMs(null);
      setPendingCommittedUsageSeconds(0);
      if (throwOnStartFailure) {
        throw new Error(message);
      }
      return;
    }

    activeModeRef.current = "webspeech";
    return checkMicrophonePermission()
      .then((osPermission) => {
        if (!osPermission.granted && osPermission.status !== "not-determined") {
          console.warn("[Speech] OS reports microphone access is not granted:", osPermission);
        }
        recognitionRef.current?.start();
      })
      .catch((e: unknown) => {
        const message = formatSpeechError(e);
        setIsStarting(false);
        setError(message);
        setActiveSessionStartedAtMs(null);
        setSharedActiveSessionStartedAtMs(null);
        setPendingCommittedUsageSeconds(0);
        if (throwOnStartFailure) {
          throw new Error(message);
        }
      });
  }, [
    sessionToken,
    hasBrowserSpeechRecognition,
    hasStreamingSupport,
    isElectronRuntime,
    isListening,
    isStarting,
    checkMicrophonePermission,
    setSharedActiveSessionStartedAtMs,
    setPendingCommittedUsageSeconds,
    startAssemblyAiListening,
    stopStreamingSession,
    throwOnStartFailure,
  ]);

  const stopListening = useCallback(() => {
    isStoppingRef.current = true;
    setIsStarting(false);
    setActiveSessionStartedAtMs(null);
    setSharedActiveSessionStartedAtMs(null);
    setPendingCommittedUsageSeconds(0);
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
  }, [
    setPendingCommittedUsageSeconds,
    setSharedActiveSessionStartedAtMs,
    stopStreamingSession,
  ]);

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
    activeSessionStartedAtMs,
    startListening,
    stopListening,
    error,
  };
}
