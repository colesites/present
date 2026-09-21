"use client";

import { useEffect, useRef, useState } from "react";

import {
  PREVIEW_FRAMES_PER_SECOND,
  previewFrameUrl,
} from "../../../renderer/tauri/preview-frames";

/**
 * The audience picture as the compositor draws it, over the preview.
 *
 * Every format FFmpeg reads plays here, because there is no video element in
 * this path at all — which is the point of it. (The source scan that counts
 * audible players reads comments too, so this one says it in words.)
 *
 * Two frames are kept at once and a new one is only shown when it has loaded.
 * An `<img>` whose `src` changes is blank until the next arrives, and a
 * preview that blinks twenty times a second is worse than one a frame behind.
 */
export function CompositorPreviewLayer({ className }: { className?: string }) {
  const boxRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState<{ width: number; height: number } | null>(null);
  const [shown, setShown] = useState<string | null>(null);
  const [loading, setLoading] = useState<string | null>(null);

  // The size the preview is on screen, in device pixels, so the compositor
  // draws what is shown rather than something to be scaled up.
  useEffect(() => {
    const box = boxRef.current;
    if (!box) return;
    const measure = () => {
      const scale = window.devicePixelRatio || 1;
      const { width, height } = box.getBoundingClientRect();
      if (width > 0 && height > 0) {
        setSize({ width: width * scale, height: height * scale });
      }
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(box);
    return () => observer.disconnect();
  }, []);

  // Ask for the next frame. The core answers with the one it already has when
  // nothing has changed, so a still slide costs a request and no drawing.
  useEffect(() => {
    if (!size) return;
    let tick = 0;
    const next = () => {
      tick += 1;
      setLoading(previewFrameUrl(size.width, size.height, tick));
    };
    next();
    const timer = window.setInterval(next, Math.round(1000 / PREVIEW_FRAMES_PER_SECOND));
    return () => window.clearInterval(timer);
  }, [size]);

  return (
    <div ref={boxRef} className={className}>
      {shown ? (
        <img src={shown} alt="" className="absolute inset-0 h-full w-full object-contain" />
      ) : null}
      {loading && loading !== shown ? (
        <img
          key={loading}
          src={loading}
          alt=""
          className="absolute inset-0 h-full w-full object-contain opacity-0"
          onLoad={() => setShown(loading)}
          // A frame the core could not draw comes back empty; whatever is on
          // screen stays until the next one arrives.
          onError={() => undefined}
        />
      ) : null}
    </div>
  );
}
