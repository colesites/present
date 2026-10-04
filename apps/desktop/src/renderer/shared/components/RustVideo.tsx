"use client";

import { useCallback, useEffect, useId, type CSSProperties } from "react";

import type { MediaFramesClock } from "../../tauri/media-frames";
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
 */
export function RustVideo({
  url,
  clock,
  className,
  style,
  fit = "contain",
  label,
  onClick,
}: {
  url: string;
  clock: MediaFramesClock;
  className?: string;
  style?: CSSProperties;
  fit?: "contain" | "cover" | "fill";
  label?: string;
  onClick?: () => void;
}) {
  const reactId = useId();
  const id = `v${reactId.replace(/[^A-Za-z0-9_-]/g, "")}`;

  // Which file, and how it keeps time. A running local clock is not sent again
  // as it runs: Rust moves it on.
  const clockKey = JSON.stringify(clock);
  useEffect(() => {
    const parsed = JSON.parse(clockKey) as MediaFramesClock;
    void frames()
      .then((loaded) => loaded.setMediaFrames(id, url, parsed))
      .catch((error: unknown) => console.error("[Video] could not set the player", error));
  }, [clockKey, id, url]);

  useEffect(
    () => () => {
      void frames()
        .then((loaded) => loaded.removeMediaFrames(id))
        .catch((): void => undefined);
    },
    [id],
  );

  const frameUrl = useCallback(
    (size: FrameSize, leadMs: number, after: number | null) =>
      core ? core.mediaFrameUrl(id, size.width, size.height, leadMs, after) : null,
    [id],
  );

  return (
    <FrameCanvas
      frameUrl={frameUrl}
      fit={fit}
      className={className}
      style={style}
      label={label}
      onClick={onClick}
    />
  );
}
