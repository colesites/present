"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import { useMutation } from "convex/react";
import { api } from "@present/backend/convex/_generated/api";
import type { Id } from "@present/backend/convex/_generated/dataModel";
import {
  updateDesktopBillingSnapshot,
  type DesktopBillingSnapshot,
} from "../../../renderer/shared/store/desktopSession";
import { toast } from "sonner";
import { useSpeechUsageStore } from "../../../renderer/shared/store/speechUsage";
import { logFault, rawText, userMessage, UserFacingError } from "../../../renderer/shared/lib/user-error";
import type { ListeningMicrophone } from "../../../renderer/tauri/sound";

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
  /** The microphone, listened to by Rust (`services/sound/input.rs`). */
  microphone: ListeningMicrophone;
  startedAtMs: number;
  maxDurationSeconds: number;
}

const ASSEMBLYAI_STREAM_URL = "wss://streaming.assemblyai.com/v3/ws";
const SPEECH_QUOTA_EXHAUSTED_MESSAGE =
  "You've used all of your speech-to-search time for this billing period. Upgrade your plan or wait for the next billing period to continue using voice search.";

const sanitizeKeyterms = (value: string[] | undefined): string[] =>
  Array.from(
    new Set(
      (value ?? [])
        .map((item) => item.trim())
        // AssemblyAI ignores a term over 50 characters, and refuses a
        // session with more than 100.
        .filter((item) => item.length > 0 && item.length <= 50),
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

  // One JSON array, not a parameter per term: sent one by one, AssemblyAI
  // refused the whole session ("Invalid 'keyterms_prompt': Invalid JSON
  // array") and the Bible agent never started.
  if (input.keyterms.length > 0) {
    url.searchParams.set("keyterms_prompt", JSON.stringify(input.keyterms));
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

/** What anyone is told when voice search fails for a reason that is ours. */
const VOICE_FAILED = "Voice search couldn't start. Try again in a moment.";
const VOICE_DISCONNECTED = "Voice search couldn't connect. Check the internet connection and try again.";
const VOICE_STOPPED = "Voice search stopped. Click the microphone to listen again.";

/**
 * What to tell the operator about `error`: the plan's own words when its
 * speech time is spent, words written for people (`user-error.ts`), and
 * otherwise a plain sentence — the error itself goes to the log, never the
 * screen.
 */
const speechMessage = (error: unknown, fallback = VOICE_FAILED): string => {
  if (/speech-to-search quota exhausted|quota exhausted/i.test(rawText(error))) {
    return SPEECH_QUOTA_EXHAUSTED_MESSAGE;
  }
  return userMessage(error, fallback, "Speech");
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

  // The plan's speech time, kept by Convex: a session starts with the
  // microphone and ends with it.
  const startUsageSession = useMutation(api.billing.startSpeechUsageSession);
  const completeUsageSession = useMutation(api.billing.completeSpeechUsageSession);

  const [isListening, setIsListening] = useState(false);
  const [isStarting, setIsStarting] = useState(false);
  const [transcript, setTranscript] = useState("");
  const [interimTranscript, setInterimTranscript] = useState("");
  const [error, setError] = useState<string | null>(null);
  // Said where the operator will see it, once: a toast, replaced rather than
  // stacked if it comes again. Every message here is written for people
  // (`speechMessage`); the fault behind it is in the log.
  useEffect(() => {
    if (error) toast.error(error, { id: "voice-search", duration: 8000 });
  }, [error]);
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

  // The microphone is Rust's (`services/sound/input.rs`); the webview only
  // needs to reach the transcription service.
  const hasStreamingSupport =
    typeof window !== "undefined" &&
    typeof WebSocket !== "undefined" &&
    "__TAURI_INTERNALS__" in window;

  // WebKit's own recognizer, outside the app only. In the app it can never
  // listen: it needs a speech-recognition grant the app does not ask for, so
  // macOS refused it without a prompt and the operator was told the
  // microphone was denied.
  const hasBrowserSpeechRecognition =
    !hasStreamingSupport &&
    typeof window !== "undefined" &&
    ("SpeechRecognition" in window || "webkitSpeechRecognition" in window);

  const isSupported = hasBrowserSpeechRecognition || hasStreamingSupport;

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

    session.microphone.stop();
    const endedAtMs = Date.now();
    const localUsedSeconds = computeBoundedSessionUsageSeconds({
      startedAtMs: session.startedAtMs,
      maxDurationSeconds: session.maxDurationSeconds,
      endedAtMs,
    });
    setPendingCommittedUsageSeconds(localUsedSeconds);

    if (session.billingSessionId) {
      // Straight to Convex, which meters the feature: the session started
      // there when the microphone did is ended there.
      void completeUsageSession({
        sessionId: session.billingSessionId as Id<"speechUsageSessions">,
        endedAtMs,
      })
        .then((payload) => {
          const usage = payload as AssemblyAiUsageResponse | null;
          if (usage?.billing) {
            updateDesktopBillingSnapshot(usage.billing);
          }
          // Recorded, so nothing is pending.
          if (usage) {
            setPendingCommittedUsageSeconds(0);
          }
        })
        .catch((error: unknown) => {
          console.error("[Speech] usage report failed", error);
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

  }, [
    completeUsageSession,
    setPendingCommittedUsageSeconds,
    setActiveSessionStartedAtMs,
    setSharedActiveSessionStartedAtMs,
  ]);

  const fetchAssemblyAiToken = useCallback(async (): Promise<AssemblyAiTokenResponse> => {
    if (!sessionToken) {
      throw new UserFacingError("Sign in to Present to use voice search.");
    }

    // Straight from the desktop, with nothing through the website: the usage
    // session from Convex, which keeps a plan within its speech time and its
    // features, then a token from AssemblyAI for no longer than that, minted
    // with the key built into the app (`services/speech.rs`).
    let usage: {
      sessionId: Id<"speechUsageSessions">;
      allowedDurationSeconds: number;
      billing: unknown;
    };
    try {
      usage = await startUsageSession({ source: usageSource, requestedMaxDurationSeconds: 15 * 60 });
    } catch (error) {
      // The plan's own refusal (a ConvexError) is said as it is; anything
      // else is a fault.
      throw new UserFacingError(speechMessage(error));
    }

    try {
      const { mintSpeechToken } = await import("../../../renderer/tauri/runtime");
      const minted = await mintSpeechToken(usage.allowedDurationSeconds);
      const payload: AssemblyAiTokenResponse = {
        token: minted.token,
        expiresInSeconds: minted.expiresInSeconds,
        sessionId: usage.sessionId,
        allowedDurationSeconds: usage.allowedDurationSeconds,
        billing: usage.billing as DesktopBillingSnapshot,
      };
      if (payload.billing) {
        updateDesktopBillingSnapshot(payload.billing);
      }
      return payload;
    } catch (error) {
      // The session was started for a stream that never opened: end it now,
      // so it costs nothing.
      void completeUsageSession({ sessionId: usage.sessionId, endedAtMs: Date.now() }).catch(
        (): void => undefined,
      );
      throw new UserFacingError(speechMessage(error));
    }
  }, [completeUsageSession, sessionToken, startUsageSession, usageSource]);

  const startAssemblyAiListening = useCallback(async () => {
    if (!hasStreamingSupport) {
      throw new Error("Live transcription is unavailable in this runtime.");
    }

    const osPermission = await checkMicrophonePermission();
    if (!osPermission.granted && osPermission.status !== "not-determined") {
      console.warn("[Speech] OS reports microphone access is not granted:", osPermission);
    }

    // The socket the samples go to, once it is open: until then they are
    // dropped, as the webview's capture dropped them.
    let socket: WebSocket | null = null;
    const [microphoneResult, tokenResult] = await Promise.allSettled([
      import("../../../renderer/tauri/sound").then(({ startMicrophone }) =>
        startMicrophone(inputDeviceId?.trim() || null, (pcm) => {
          if (socket?.readyState === WebSocket.OPEN) socket.send(pcm);
        }),
      ),
      fetchAssemblyAiToken(),
    ]);

    if (microphoneResult.status === "rejected") {
      if (!osPermission.granted) {
        throw new UserFacingError(
          "Present isn't allowed to use the microphone. Turn it on in System Settings > Privacy & Security > Microphone, then try again.",
        );
      }
      throw microphoneResult.reason instanceof Error
        ? microphoneResult.reason
        : new Error(String(microphoneResult.reason));
    }

    const microphone = microphoneResult.value;

    if (tokenResult.status === "rejected") {
      microphone.stop();
      throw tokenResult.reason;
    }

    const { token } = tokenResult.value;

    try {
      const socketUrl = buildAssemblyAiSocketUrl({
        token,
        sampleRate: microphone.sampleRate,
        lang,
        keyterms: sanitizeKeyterms(keyterms),
      });

      const openedSocket = new WebSocket(socketUrl);
      openedSocket.binaryType = "arraybuffer";
      socket = openedSocket;

      const session: StreamingSession = {
        billingSessionId: tokenResult.value.sessionId ?? null,
        socket: openedSocket,
        microphone,
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
          openedSocket.removeEventListener("open", handleOpen);
          openedSocket.removeEventListener("error", handleSocketOpenError);
          resolve();
        };

        const handleSocketOpenError = () => {
          openedSocket.removeEventListener("open", handleOpen);
          openedSocket.removeEventListener("error", handleSocketOpenError);
          reject(new Error("AssemblyAI connection failed."));
        };

        openedSocket.addEventListener("open", handleOpen, { once: true });
        openedSocket.addEventListener("error", handleSocketOpenError, { once: true });
      });

      openedSocket.onmessage = (event) => {
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
          // The service's own words are for us, not the operator.
          logFault(payload, "Speech: AssemblyAI");
          setIsStarting(false);
          setError(VOICE_FAILED);
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

      openedSocket.onerror = (event) => {
        console.error("[AssemblyAI] websocket error", event);
        setIsStarting(false);
        setError(VOICE_DISCONNECTED);
        setActiveSessionStartedAtMs(null);
        setSharedActiveSessionStartedAtMs(null);
        setPendingCommittedUsageSeconds(0);
      };

      openedSocket.onclose = (event) => {
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
          // The close code and reason are logged above; the operator is told
          // what to do.
          const closeMessage = /quota|limit|duration/i.test(event.reason)
            ? SPEECH_QUOTA_EXHAUSTED_MESSAGE
            : VOICE_STOPPED;
          setError((currentError) => currentError ?? closeMessage);
        }
      };
    } catch (error) {
      const partialSession = streamingSessionRef.current;
      if (partialSession) {
        stopStreamingSession();
      } else {
        microphone.stop();
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
          const message = speechMessage(error);
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
      const message = hasStreamingSupport
        ? "Sign in to Present to use voice. Listening is part of your plan."
        : "Voice input is unavailable in this runtime.";
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
        const message = speechMessage(e);
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
