"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";

/** A panel's size on screen, in device pixels. */
export type FrameSize = { width: number; height: number };

/**
 * The address of the next frame: `leadMs` is how far ahead to draw it,
 * `after` the frame already shown. `null` while there is nothing to ask for.
 */
export type FrameUrl = (size: FrameSize, leadMs: number, after: number | null) => string | null;

/** The longest side asked for, unless a panel asks for less. */
const LARGEST = 1920;

/** One display refresh: a frame drawn in this callback is seen at the next. */
const ONE_REFRESH_MS = 1000 / 60;

/**
 * Frames drawn by Rust, on a canvas, as close to the moment they are due as
 * the trip allows.
 *
 * A frame reaches the screen some time after it was drawn: its age when Rust
 * answered, the trip back, the JPEG's decode and the next paint. Each answer
 * says how old its frame was (`X-Frame-Age-Ms`, `services/frame_delivery.rs`);
 * from that and the times measured here, this works out how late its frames
 * arrive and asks for the next to be drawn that far ahead (`lead`). The
 * picture here then shows what the audience screen and the sound show at the
 * same moment, rather than a frame or two behind.
 *
 * One request at a time, the next as soon as one is painted. A request for a
 * frame newer than the one shown is held in Rust until it is drawn, so a
 * running video's frames arrive as they are made, and a still picture is
 * asked after four times a second rather than polled for: an answer with
 * nothing new (`X-Frame-Same`) costs no JPEG.
 */
export function FrameCanvas({
  frameUrl,
  fit = "contain",
  largest = LARGEST,
  className,
  style,
  label,
  onClick,
}: {
  frameUrl: FrameUrl;
  fit?: "contain" | "cover" | "fill";
  /** The longest side to ask for: smaller frames reach the screen sooner. */
  largest?: number;
  className?: string;
  style?: CSSProperties;
  label?: string;
  onClick?: () => void;
}) {
  const boxRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [size, setSize] = useState<FrameSize | null>(null);
  const frameUrlRef = useRef(frameUrl);
  useEffect(() => {
    frameUrlRef.current = frameUrl;
  }, [frameUrl]);
  const fitRef = useRef(fit);
  useEffect(() => {
    fitRef.current = fit;
  }, [fit]);

  // Its size on screen, in device pixels, so frames are drawn at that size.
  useEffect(() => {
    const box = boxRef.current;
    if (!box) return;
    const measure = () => {
      const { width, height } = box.getBoundingClientRect();
      if (width <= 0 || height <= 0) return;
      const scale = Math.min(window.devicePixelRatio || 1, largest / width, largest / height);
      const next = { width: Math.round(width * scale), height: Math.round(height * scale) };
      setSize((previous) =>
        previous && previous.width === next.width && previous.height === next.height ? previous : next,
      );
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(box);
    return () => observer.disconnect();
  }, [largest]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");
    if (!size || !canvas || !context) return;
    canvas.width = size.width;
    canvas.height = size.height;
    let stopped = false;
    let lead = 0;
    let shownSeq: number | null = null;
    const wait = (ms: number) => new Promise<void>((resolve) => window.setTimeout(resolve, ms));
    const nextPaint = () =>
      new Promise<number>((resolve) => window.requestAnimationFrame(() => resolve(performance.now())));

    void (async () => {
      while (!stopped) {
        const url = frameUrlRef.current(size, Math.round(lead), shownSeq);
        if (!url) {
          await wait(50);
          continue;
        }
        const askedAt = performance.now();
        let response: Response;
        try {
          response = await fetch(url, { cache: "no-store" });
        } catch {
          // Dropped across a sleep, or while the window was hidden.
          await wait(100);
          continue;
        }
        const answeredAt = performance.now();
        // How long Rust held the request for a newer frame: not travel time.
        const waited = Number(response.headers.get("X-Frame-Waited-Ms")) || 0;
        if (response.status !== 200) {
          // Nothing newer than what is shown — Rust already waited for one,
          // so ask again at once — or nothing yet at all.
          if (response.headers.get("X-Frame-Same")) {
            await wait(waited >= 100 ? 0 : 16);
          } else {
            await wait(60);
          }
          continue;
        }
        const age = Number(response.headers.get("X-Frame-Age-Ms")) || 0;
        const seq = Number(response.headers.get("X-Frame-Seq"));
        let bitmap: ImageBitmap;
        try {
          bitmap = await createImageBitmap(await response.blob());
        } catch {
          await wait(30);
          continue;
        }
        if (stopped) {
          bitmap.close();
          break;
        }
        const paintedAt = await nextPaint();
        draw(context, bitmap, size, fitRef.current);
        bitmap.close();
        shownSeq = Number.isFinite(seq) ? seq : null;

        // How late this frame reached the screen: as old as it was when Rust
        // answered, plus the trip back (half the round trip, less the time it
        // was held waiting for the frame), plus the time since, plus the
        // refresh it is shown at.
        const tripBack = Math.max(0, answeredAt - askedAt - waited) / 2;
        const late = age + tripBack + (paintedAt - answeredAt) + ONE_REFRESH_MS;
        lead = lead === 0 ? late : lead * 0.9 + late * 0.1;
      }
    })();

    return () => {
      stopped = true;
    };
  }, [size]);

  return (
    <div
      ref={boxRef}
      className={className}
      style={style}
      role={label ? "img" : undefined}
      aria-label={label}
      onClick={onClick}
    >
      <canvas ref={canvasRef} className="block h-full w-full" />
    </div>
  );
}

/** Draw `bitmap` into the canvas, fitted as `fit` says. */
function draw(
  context: CanvasRenderingContext2D,
  bitmap: ImageBitmap,
  size: FrameSize,
  fit: "contain" | "cover" | "fill",
) {
  context.clearRect(0, 0, size.width, size.height);
  if (fit === "fill") {
    context.drawImage(bitmap, 0, 0, size.width, size.height);
    return;
  }
  const scaleX = size.width / bitmap.width;
  const scaleY = size.height / bitmap.height;
  const scale = fit === "cover" ? Math.max(scaleX, scaleY) : Math.min(scaleX, scaleY);
  const width = bitmap.width * scale;
  const height = bitmap.height * scale;
  context.drawImage(bitmap, (size.width - width) / 2, (size.height - height) / 2, width, height);
}
