"use client";

import { useCallback, useEffect, useId, useMemo, useRef, type CSSProperties } from "react";

import type { MediaFramesClock } from "../../tauri/media-frames";
import { useNativePanel } from "../hooks/useNativePanel";
import { FrameCanvas, type FrameSize } from "./FrameCanvas";

const frames = () => import("../../tauri/media-frames");

/** Loaded once, so the frame address can be made without waiting. */
let core: Awaited<ReturnType<typeof frames>> | null = null;
void frames().then((loaded) => {
  core = loaded;
});

/**
 * A video, decoded by FFmpeg in Rust and shown as the frames it hands back
 * (`services/media_frames.rs`). Every format FFmpeg reads plays here, it is
 * silent by construction — the sound is Rust's too (`services/sound`) — and
 * it keeps the time `clock` says: for the screens' video, the sound's own
 * clock, which every screen keeps (`sound/clock.rs`).
 *
 * Drawn by `FrameCanvas`, which asks for each frame drawn as far ahead as the
 * trip to this screen takes, so the picture here and the audience screen are
 * on the same frame at the same moment.
 *
 * With `native`, on a Mac, the picture is not drawn by this page at all but by
 * the app, under it, as the audience screen is (`useNativePanel`): the frame
 * the screens show, at the moment they show it, and nothing this page is busy
 * with can make it stutter. Where that cannot be, it is drawn here as above.
 */
export function RustVideo({
  url,
  clock,
  className,
  style,
  fit = "contain",
  largest,
  label,
  onClick,
  native = false,
}: {
  url: string;
  clock: MediaFramesClock;
  className?: string;
  style?: CSSProperties;
  fit?: "contain" | "cover" | "fill";
  /** The longest side to decode at (`FrameCanvas`). */
  largest?: number;
  label?: string;
  onClick?: () => void;
  /** Drawn by the app under the page where it can be (`useNativePanel`). */
  native?: boolean;
}) {
  const reactId = useId();
  const id = `v${reactId.replace(/[^A-Za-z0-9_-]/g, "")}`;
  const boxRef = useRef<HTMLDivElement>(null);

  const clockKey = JSON.stringify(clock);
  // The app fits its picture inside the box, as `contain` does; a picture
  // that covers or fills its box is the page's to draw.
  const drawnNatively = native && fit === "contain";
  const source = useMemo(
    () =>
      drawnNatively
        ? { kind: "media" as const, url, clock: JSON.parse(clockKey) as MediaFramesClock }
        : null,
    [clockKey, drawnNatively, url],
  );
  const drawing = useNativePanel(boxRef, id, source);
  const pageDraws = drawing === "page";

  // Which file, and how it keeps time — for the page's own drawing. A running
  // local clock is not sent again as it runs: Rust moves it on.
  useEffect(() => {
    if (!pageDraws) return;
    const parsed = JSON.parse(clockKey) as MediaFramesClock;
    void frames()
      .then((loaded) => loaded.setMediaFrames(id, url, parsed))
      .catch((error: unknown) => console.error("[Video] could not set the player", error));
  }, [clockKey, id, pageDraws, url]);

  useEffect(() => {
    if (!pageDraws) return;
    return () => {
      void frames()
        .then((loaded) => loaded.removeMediaFrames(id))
        .catch((): void => undefined);
    };
  }, [id, pageDraws]);

  const frameUrl = useCallback(
    (size: FrameSize, leadMs: number, after: number | null) =>
      core ? core.mediaFrameUrl(id, size.width, size.height, leadMs, after) : null,
    [id],
  );

  if (drawnNatively) {
    // The box the app draws under, or — where it cannot — the page's own
    // canvas inside it.
    return (
      <div
        ref={boxRef}
        className={className}
        style={style}
        role={label ? "img" : undefined}
        aria-label={label}
        onClick={onClick}
      >
        {pageDraws ? (
          <FrameCanvas frameUrl={frameUrl} fit={fit} largest={largest} className="h-full w-full" />
        ) : null}
      </div>
    );
  }

  return (
    <FrameCanvas
      frameUrl={frameUrl}
      fit={fit}
      largest={largest}
      className={className}
      style={style}
      label={label}
      onClick={onClick}
    />
  );
}
