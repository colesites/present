"use client";

import { useEffect, useRef, useState } from "react";

import { previewFrameUrl } from "../../../renderer/tauri/preview-frames";

/** The widest the preview is ever drawn, whatever the screen's density. */
const WIDEST = 960;

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
      const { width, height } = box.getBoundingClientRect();
      if (width <= 0 || height <= 0) {
        return;
      }
      // Sharp enough to read, and not a pixel more. A Retina panel asks for
      // twice the pixels in each direction — four times the drawing, four
      // times the encoding — for a picture a few inches across that nobody
      // inspects. Past this the frame rate costs more than the sharpness is
      // worth, and the frame rate is what a preview is for.
      const scale = Math.min(window.devicePixelRatio || 1, WIDEST / width);
      setSize({ width: width * scale, height: height * scale });
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(box);
    return () => observer.disconnect();
  }, []);

  // One frame asked for at a time, and the next as soon as it has arrived and
  // this screen can paint again. The core draws what is newest whenever it is
  // asked, so this runs as fast as a frame can be drawn and delivered, and no
  // faster. A new frame used to be asked for on every repaint whether the last
  // had arrived or not: each one replaced the image still loading, so a frame
  // that took longer than a repaint was thrown away, and the core drew frames
  // nobody saw. Things that move, a scrolling message most of all, moved in
  // uneven jumps.
  const askRef = useRef<(() => void) | null>(null);
  useEffect(() => {
    if (!size) return;
    let tick = 0;
    let frame = 0;
    const ask = () => {
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(() => {
        tick += 1;
        setLoading(previewFrameUrl(size.width, size.height, tick));
      });
    };
    askRef.current = ask;
    ask();
    return () => {
      askRef.current = null;
      window.cancelAnimationFrame(frame);
    };
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
          onLoad={() => {
            setShown(loading);
            askRef.current?.();
          }}
          // A frame the core could not draw comes back empty; whatever is on
          // screen stays, and the next is asked for after a moment rather
          // than at once, so a core that is still starting is not hammered.
          onError={() => {
            window.setTimeout(() => askRef.current?.(), 100);
          }}
        />
      ) : null}
    </div>
  );
}
