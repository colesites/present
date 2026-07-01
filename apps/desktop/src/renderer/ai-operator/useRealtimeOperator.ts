import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  type AiOperatorSessionMemory,
  type AiOperatorVisualState,
  type AiToolResult,
} from "../../shared/ai-operator/types";
import { useSpeechRecognition } from "../../features/scripture/hooks/useSpeechRecognition";
import { aiOperatorBus } from "./operatorBus";
import { parseOperatorIntent } from "./intentParser";

const OPERATOR_SPEECH_KEYTERMS = [
  "Bible",
  "library",
  "libraries",
  "media",
  "search",
  "text",
  "lyrics",
  "grid",
  "edit",
  "presentation",
  "countdown",
  "livestream",
  "background",
];

const INSTANT_INTERIM_TOOLS = new Set([
  "next_slide",
  "previous_slide",
  "go_to_slide",
  "set_text_visibility",
  "toggle_text",
  "set_media_visibility",
  "toggle_media",
  "set_background_visibility",
  "toggle_background",
  "set_output_freeze",
  "toggle_output_freeze",
  "set_timer_layer",
  "toggle_timer_layer",
  "set_message_layer",
  "toggle_message_layer",
  "set_slide_grid",
  "toggle_slide_grid",
  "set_view_mode",
  "open_panel",
  "close_panel",
  "open_sidebar_tab",
  "open_display",
  "close_display",
  "open_library",
  "open_notes",
  "open_schedule",
  "open_settings",
  "stop_countdown",
  "reset_countdown",
  "stop_presentation",
]);

interface UseRealtimeOperatorOptions {
  sessionToken?: string | null;
  speechInputDeviceId?: string | null;
  speechLang?: string;
}

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

export function useRealtimeOperator({
  sessionToken = null,
  speechInputDeviceId = null,
  speechLang = "en-US",
}: UseRealtimeOperatorOptions = {}) {
  const [isActive, setIsActive] = useState(false);
  const [visualState, setVisualState] = useState<AiOperatorVisualState>("idle");
  const [error, setError] = useState<string | null>(null);
  const [lastTranscript, setLastTranscript] = useState("");
  const [lastResult, setLastResult] = useState<AiToolResult | null>(null);
  const memoryRef = useRef<AiOperatorSessionMemory>(createSessionMemory());
  const lastCommandKeyRef = useRef("");
  const lastCommandAtRef = useRef(0);

  const executeToolCall = useCallback(async (call: ReturnType<typeof parseOperatorIntent>) => {
    if (!call) return;
    const commandKey = `${call.name}:${JSON.stringify(call.arguments)}`;
    const now = Date.now();
    if (
      lastCommandKeyRef.current === commandKey &&
      now - lastCommandAtRef.current < 1600
    ) {
      setVisualState("listening");
      return;
    }
    lastCommandKeyRef.current = commandKey;
    lastCommandAtRef.current = now;

    setVisualState("executing");
    console.info("[AI Operator] executing tool", {
      tool: call.name,
      arguments: call.arguments,
    });
    const result = await aiOperatorBus.executeTool(call);
    console.info("[AI Operator] tool result", {
      tool: call.name,
      ok: result.ok,
      error: result.error,
    });
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

  const handleTranscript = useCallback(
    (transcript: string, isFinal: boolean) => {
      const cleanTranscript = transcript.trim();
      if (!cleanTranscript) {
        return;
      }

      const call = parseOperatorIntent(cleanTranscript, memoryRef.current);
      console.info("[AI Operator] transcript", {
        transcript: cleanTranscript,
        isFinal,
        parsedTool: call?.name ?? null,
        parsedArguments: call?.arguments ?? null,
      });

      setLastTranscript(cleanTranscript);
      aiOperatorBus.emitTranscript({
        transcript: cleanTranscript,
        isFinal,
      });

      if (!call) {
        setVisualState((current) =>
          current === "executing" ? current : "listening",
        );
        return;
      }

      if (!isFinal && !INSTANT_INTERIM_TOOLS.has(call.name)) {
        setVisualState((current) =>
          current === "executing" ? current : "listening",
        );
        return;
      }

      setVisualState("thinking");
      void executeToolCall(call);
    },
    [executeToolCall],
  );

  const {
    error: speechError,
    isSupported: isSpeechRecognitionSupported,
    startListening,
    stopListening,
  } = useSpeechRecognition({
    continuous: true,
    interimResults: true,
    lang: speechLang,
    inputDeviceId: speechInputDeviceId,
    sessionToken,
    keyterms: OPERATOR_SPEECH_KEYTERMS,
    usageSource: "library",
    throwOnStartFailure: true,
    onResult: ({ transcript, isFinal }) => {
      handleTranscript(transcript, isFinal);
    },
    onFinalResult: (transcript) => {
      handleTranscript(transcript, true);
    },
  });

  useEffect(() => {
    if (!isActive || !speechError) {
      return;
    }

    const frame = window.requestAnimationFrame(() => {
      setError(speechError);
      setVisualState("error");
    });
    return () => window.cancelAnimationFrame(frame);
  }, [isActive, speechError]);

  useEffect(() => {
    return () => {
      stopListening();
    };
  }, [stopListening]);

  const activate = useCallback(async () => {
    memoryRef.current = createSessionMemory();
    lastCommandKeyRef.current = "";
    lastCommandAtRef.current = 0;
    setError(null);
    setIsActive(true);
    setVisualState("connecting");
    console.info("[AI Operator] activating AssemblyAI stream…");

    if (!sessionToken) {
      console.error("[AI Operator] activation failed: missing desktop session token");
      setIsActive(false);
      setError("Sign in to use AI Operator voice control.");
      setVisualState("error");
      return;
    }

    if (!isSpeechRecognitionSupported) {
      console.error("[AI Operator] activation failed: speech runtime unavailable");
      setIsActive(false);
      setError("AssemblyAI live transcription is unavailable in this desktop session.");
      setVisualState("error");
      return;
    }

    try {
      await startListening();
      setVisualState("listening");
      console.info("[AI Operator] AssemblyAI stream listening");
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "AI Operator voice failed to start.";
      console.error("[AI Operator] AssemblyAI start failed:", err);
      setIsActive(false);
      setError(message);
      setVisualState("error");
    }
  }, [isSpeechRecognitionSupported, sessionToken, startListening]);

  const deactivate = useCallback(() => {
    stopListening();
    setIsActive(false);
    setVisualState("idle");
    setError(null);
  }, [stopListening]);

  const toggle = useCallback(() => {
    if (isActive) {
      deactivate();
      return;
    }
    void activate();
  }, [activate, deactivate, isActive]);

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
