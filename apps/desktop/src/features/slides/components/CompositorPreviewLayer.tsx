"use client";

import { useCallback } from "react";

import { previewFrameUrl } from "../../../renderer/tauri/preview-frames";
import { FrameCanvas, type FrameSize } from "../../../renderer/shared/components/FrameCanvas";

/** The widest the preview is ever drawn, whatever the screen's density. */
const WIDEST = 960;

/**
 * An audience screen's picture as the compositor draws it, over the preview:
 * the Screen's unless another is named.
 *
 * Every format FFmpeg reads plays here, because there is no video element in
 * this path at all — which is the point of it. (The source scan that counts
 * audible players reads comments too, so this one says it in words.)
 *
 * Drawn by `FrameCanvas`, which asks for each frame drawn as far ahead as the
 * trip to this screen takes, so the preview shows what the audience screen
 * shows at the same moment rather than a frame or two after it.
 */
export function CompositorPreviewLayer({
  className,
  screen = "audience",
}: {
  className?: string;
  /** Which audience screen, by id (Screen Configuration). */
  screen?: string;
}) {
  // Sharp enough to read, and not a pixel more: a Retina panel asks for four
  // times the drawing and encoding for a picture a few inches across. Past
  // this the frame rate costs more than the sharpness is worth.
  const frameUrl = useCallback(
    (size: FrameSize, leadMs: number, after: number | null) => {
      const scale = Math.min(1, WIDEST / size.width);
      return previewFrameUrl(size.width * scale, size.height * scale, leadMs, after, screen);
    },
    [screen],
  );
  return <FrameCanvas frameUrl={frameUrl} className={className} />;
}
