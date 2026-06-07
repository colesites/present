import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  AiOperatorSessionMemory,
  AiOperatorVisualState,
  AiToolResult,
} from "../../shared/ai-operator/types";
import { aiOperatorBus } from "./operatorBus";
import { parseOperatorIntent } from "./intentParser";
import { useWhisperMic } from "./useWhisperMic";

function createSessionMemory(): AiOperatorSessionMemory {
  return {
    sessionId: crypto.randomUUID(),
    startedAt: Date.now(),
    recentToolCalls: [],
  };
}

function appendToolResult(
  memory: AiOperatorSessionMemory,
  toolName: string,
  args: Record<string, unknown>,
  result: AiToolResult,
): AiOperatorSessionMemory {
  const next: AiOperatorSessionMemory = {
    ...memory,
    recentToolCalls: [
      ...memory.recentToolCalls,
      {
        name: toolName,
        arguments: args,
        resultSummary: result.ok ? "ok" : result.error?.message ?? "failed",
        timestamp: Date.now(),
      },
    ].slice(-12),
  };

  if (result.ok && toolName === "open_song") {
    const song = args.song;
    if (typeof song === "string") {
      next.currentSong = {
        id: String((result.data as { songId?: unknown } | undefined)?.songId ?? song),
        title: song,
        section: typeof args.section === "string" ? args.section : undefined,
      };
    }
  }

  if (result.ok && toolName === "open_bible_verse") {
    const data = result.data as
      | { book?: string; chapter?: number; verse?: number; reference?: string }
      | undefined;
    next.currentBible = {
      ...next.currentBible,
      book: data?.book ?? next.currentBible?.book,
      chapter: data?.chapter ?? next.currentBible?.chapter,
      verse: data?.verse ?? next.currentBible?.verse,
      range: data?.reference ?? next.currentBible?.range,
    };
  }

  if (result.ok && toolName === "start_countdown") {
    const seconds = typeof args.seconds === "number" ? args.seconds : 300;
    next.currentCountdown = {
      durationSeconds: seconds,
      remainingSeconds: seconds,
      running: true,
    };
  }

  return next;
}

export function useRealtimeOperator() {
  const [isActive, setIsActive] = useState(false);
  const [visualState, setVisualState] = useState<AiOperatorVisualState>("idle");
  const [error, setError] = useState<string | null>(null);
  const [lastTranscript, setLastTranscript] = useState("");
  const [lastResult, setLastResult] = useState<AiToolResult | null>(null);
  const memoryRef = useRef<AiOperatorSessionMemory>(createSessionMemory());
  const lastCommandKeyRef = useRef("");
  const sessionIdRef = useRef<string | null>(null);

  const mic = useWhisperMic({
    onError: (message) => {
      setError(message);
      setVisualState("error");
    },
  });

  const executeTranscript = useCallback(async (transcript: string) => {
    const call = parseOperatorIntent(transcript, memoryRef.current);
    if (!call) {
      setVisualState("listening");
      return;
    }

    const commandKey = `${call.name}:${JSON.stringify(call.arguments)}`;
    if (lastCommandKeyRef.current === commandKey) {
      setVisualState("listening");
      return;
    }
    lastCommandKeyRef.current = commandKey;

    setVisualState("executing");
    const result = await aiOperatorBus.executeTool(call);
    setLastResult(result);
    memoryRef.current = appendToolResult(
      memoryRef.current,
      call.name,
      call.arguments,
      result,
    );
    setVisualState(result.ok ? "success" : "error");
    if (!result.ok) {
      setError(result.error?.message ?? "AI Operator action failed.");
    }

    window.setTimeout(() => {
      setVisualState((current) =>
        current === "success" || current === "error" ? "listening" : current,
      );
    }, result.ok ? 650 : 1200);
  }, []);

  // Subscribe to whisper transcripts for the active session. Interim updates
  // keep the glow in "listening"; a committed (final) transcript runs the
  // intent → tool pipeline.
  useEffect(() => {
    if (!window.electronAPI?.onWhisperTranscript) return;
    const unsubscribe = window.electronAPI.onWhisperTranscript((event) => {
      if (event.sessionId !== sessionIdRef.current) return;
      setLastTranscript(event.transcript);
      aiOperatorBus.emitTranscript({
        transcript: event.transcript,
        isFinal: event.isFinal,
      });
      if (event.isFinal) {
        setVisualState("thinking");
        void executeTranscript(event.transcript);
      } else {
        setVisualState((current) =>
          current === "executing" ? current : "listening",
        );
      }
    });
    return unsubscribe;
  }, [executeTranscript]);

  const activate = useCallback(async () => {
    memoryRef.current = createSessionMemory();
    lastCommandKeyRef.current = "";
    setError(null);
    setIsActive(true);
    setVisualState("connecting");
    console.info("[AI Operator] activating…");

    const sessionId = crypto.randomUUID();
    sessionIdRef.current = sessionId;

    // 1. Start the microphone first — this requests OS permission and is the
    //    visible "listening" feedback. It must work even if whisper isn't set
    //    up yet, so the operator never silently does nothing.
    //    NOTE: we stay engaged (isActive stays true) even on failure, so the
    //    next long-press always TURNS IT OFF rather than re-trying.
    const started = await mic.start(sessionId);
    if (!started) {
      console.error("[AI Operator] mic failed to start");
      setVisualState("error");
      return; // mic.start already surfaced the error message
    }
    setVisualState("listening");
    console.info("[AI Operator] mic listening");

    // 2. Start the whisper transcription session (non-fatal if unavailable —
    //    the mic still streams; transcripts simply won't arrive).
    try {
      const status = await window.electronAPI?.getWhisperStatus?.();
      console.info("[AI Operator] whisper status:", status);
      if (status?.available) {
        await window.electronAPI?.startWhisper?.(sessionId);
      } else {
        setError(
          status?.error ??
            "Listening, but the voice engine isn't installed — transcription is off.",
        );
      }
    } catch (err) {
      console.error("[AI Operator] whisper start failed:", err);
    }
  }, [mic]);

  const deactivate = useCallback(() => {
    const sessionId = sessionIdRef.current;
    sessionIdRef.current = null;
    mic.stop(sessionId ?? undefined);
    setIsActive(false);
    setVisualState("idle");
    setError(null);
  }, [mic]);

  const toggle = useCallback(() => {
    if (isActive) {
      deactivate();
      return;
    }
    void activate();
  }, [activate, deactivate, isActive]);

  // Ensure the mic + main-process session are torn down on unmount.
  useEffect(() => {
    return () => {
      const sessionId = sessionIdRef.current;
      sessionIdRef.current = null;
      mic.stop(sessionId ?? undefined);
    };
  }, [mic]);

  return useMemo(
    () => ({
      isActive,
      visualState,
      error,
      lastTranscript,
      lastResult,
      activate,
      deactivate,
      toggle,
    }),
    [
      activate,
      deactivate,
      error,
      isActive,
      lastResult,
      lastTranscript,
      toggle,
      visualState,
    ],
  );
}
