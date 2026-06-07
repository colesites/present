import { useCallback, useMemo, useRef } from "react";
import { WHISPER_SAMPLE_RATE } from "../../shared/ai-operator/types";

// Captures microphone audio in the renderer, downsamples to 16 kHz mono Int16
// PCM, and streams it to the main process (whisper-cli). Uses a
// ScriptProcessorNode — deprecated but universally available and simplest for
// Electron (no AudioWorklet module URL plumbing needed). Frames are small and
// the transfer is one-way (ipcRenderer.send), so overhead is negligible.

const FRAME_SIZE = 4096;

function downsampleToInt16(
  input: Float32Array,
  inputRate: number,
): Int16Array {
  if (inputRate === WHISPER_SAMPLE_RATE) {
    const out = new Int16Array(input.length);
    for (let i = 0; i < input.length; i += 1) {
      const s = Math.max(-1, Math.min(1, input[i]));
      out[i] = Math.round(s * 32767);
    }
    return out;
  }
  const ratio = inputRate / WHISPER_SAMPLE_RATE;
  const outLength = Math.floor(input.length / ratio);
  const out = new Int16Array(outLength);
  for (let i = 0; i < outLength; i += 1) {
    const idx = i * ratio;
    const i0 = Math.floor(idx);
    const i1 = Math.min(i0 + 1, input.length - 1);
    const frac = idx - i0;
    const sample = input[i0] * (1 - frac) + input[i1] * frac;
    out[i] = Math.max(-32768, Math.min(32767, Math.round(sample * 32767)));
  }
  return out;
}

interface MicHandle {
  stream: MediaStream;
  context: AudioContext;
  source: MediaStreamAudioSourceNode;
  processor: ScriptProcessorNode;
  sink: GainNode;
}

export function useWhisperMic(options: { onError?: (message: string) => void } = {}) {
  const handleRef = useRef<MicHandle | null>(null);
  const onErrorRef = useRef(options.onError);
  onErrorRef.current = options.onError;

  const stop = useCallback((sessionId?: string) => {
    const handle = handleRef.current;
    handleRef.current = null;
    if (handle) {
      try {
        handle.processor.disconnect();
        handle.sink.disconnect();
        handle.source.disconnect();
        handle.stream.getTracks().forEach((track) => track.stop());
        void handle.context.close();
      } catch {
        // Best-effort teardown.
      }
    }
    if (sessionId) {
      window.electronAPI?.stopWhisper(sessionId);
    }
  }, []);

  const start = useCallback(
    async (sessionId: string, inputDeviceId?: string | null) => {
      if (!window.electronAPI?.pushWhisperAudio) {
        // The preload bridge is missing — almost always a stale dev process
        // (preload changes need a FULL app restart, not just Cmd+R).
        onErrorRef.current?.(
          "Audio bridge missing — fully quit and restart the app (preload is out of date).",
        );
        return false;
      }
      if (!navigator.mediaDevices?.getUserMedia) {
        onErrorRef.current?.(
          "This window can't access the microphone (no mediaDevices API).",
        );
        return false;
      }
      stop();

      // Nudge the OS-level (macOS TCC) prompt, but DO NOT block on its result.
      // getUserMedia below is the real acquisition + the thing that lights the
      // macOS mic indicator; we always let it run and only report failure if
      // it actually throws.
      try {
        const access = await window.electronAPI?.requestMicrophoneAccess?.();
        console.info("[AI Operator] mic access pre-check:", access);
      } catch (err) {
        console.warn("[AI Operator] requestMicrophoneAccess threw:", err);
      }

      let stream: MediaStream;
      try {
        console.info("[AI Operator] requesting getUserMedia…");
        // Use the simplest possible constraint set — extra constraints
        // (channelCount/autoGainControl/exact deviceId) can throw
        // OverconstrainedError in Electron and silently abort capture. We
        // downsample to mono 16 kHz ourselves anyway.
        stream = await navigator.mediaDevices.getUserMedia(
          inputDeviceId
            ? { audio: { deviceId: { ideal: inputDeviceId } } }
            : { audio: true },
        );
        console.info(
          "[AI Operator] getUserMedia granted; tracks:",
          stream.getAudioTracks().map((t) => t.label),
        );
      } catch (error) {
        console.error("[AI Operator] getUserMedia failed:", error);
        const name = error instanceof Error ? error.name : "";
        const blocked =
          name === "NotAllowedError" || name === "SecurityError";
        onErrorRef.current?.(
          blocked
            ? "Mic blocked by macOS. Run `tccutil reset Microphone`, fully restart the app, then allow the prompt — or enable it in System Settings → Privacy → Microphone."
            : error instanceof Error
              ? `Microphone failed: ${error.message}`
              : "Microphone access failed.",
        );
        return false;
      }

      // Prefer a 16 kHz context so no resampling is needed; fall back to the
      // device rate and downsample.
      let context: AudioContext;
      try {
        context = new AudioContext({ sampleRate: WHISPER_SAMPLE_RATE });
      } catch {
        context = new AudioContext();
      }
      if (context.state === "suspended") {
        await context.resume().catch((): void => {});
      }

      const source = context.createMediaStreamSource(stream);
      const processor = context.createScriptProcessor(FRAME_SIZE, 1, 1);
      // Zero-gain sink keeps the processor running without echoing to speakers.
      const sink = context.createGain();
      sink.gain.value = 0;

      processor.onaudioprocess = (event: AudioProcessingEvent): void => {
        const input = event.inputBuffer.getChannelData(0);
        const pcm = downsampleToInt16(input, context.sampleRate);
        // Copy out of the shared buffer before transferring.
        const copy = new Int16Array(pcm);
        window.electronAPI?.pushWhisperAudio(sessionId, copy.buffer);
      };

      source.connect(processor);
      processor.connect(sink);
      sink.connect(context.destination);

      handleRef.current = { stream, context, source, processor, sink };
      return true;
    },
    [stop],
  );

  // Stable object — callers put `mic` in effect deps (teardown on unmount).
  // A fresh object each render would make those effects fire every render and
  // tear the mic down the instant a session starts.
  return useMemo(() => ({ start, stop }), [start, stop]);
}
