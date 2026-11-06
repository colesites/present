import { useEffect, useRef, useState } from "react";

/**
 * Real-time microphone level for a chosen input.
 * No device means no stream: "No Input" must stay silent, and the browser
 * must not fall back to the system default microphone.
 */
export function useMicMonitor(deviceId: string | null): number {
  const [level, setLevel] = useState(0);
  const rafRef = useRef<number | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const ctxRef = useRef<AudioContext | null>(null);

  useEffect(() => {
    if (!deviceId) return;

    const id = deviceId;
    let stopped = false;

    async function init() {
      if (typeof window === "undefined" || !navigator?.mediaDevices?.getUserMedia) return;

      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: { deviceId: { exact: id } },
        });
        if (stopped) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }
        streamRef.current = stream;

        const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
        if (!AudioCtx) return;

        const ctx = new AudioCtx();
        ctxRef.current = ctx;

        const source = ctx.createMediaStreamSource(stream);
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 256;
        analyser.smoothingTimeConstant = 0.3;
        source.connect(analyser);

        const data = new Float32Array(analyser.fftSize);
        let smoothed = 0;

        const loop = () => {
          if (stopped) return;
          analyser.getFloatTimeDomainData(data);
          let peak = 0;
          for (let i = 0; i < data.length; i++) {
            const abs = Math.abs(data[i]);
            if (abs > peak) peak = abs;
          }
          // Smooth decay
          smoothed = Math.max(peak, smoothed * 0.86);
          setLevel(Number(smoothed.toFixed(3)));
          rafRef.current = requestAnimationFrame(loop);
        };
        loop();
      } catch {
        // Silently fall back to backend polling
      }
    }

    void init();

    return () => {
      stopped = true;
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((track) => track.stop());
      }
      if (ctxRef.current && ctxRef.current.state !== "closed") {
        void ctxRef.current.close().catch((): undefined => undefined);
      }
    };
  }, [deviceId]);

  return deviceId ? level : 0;
}
