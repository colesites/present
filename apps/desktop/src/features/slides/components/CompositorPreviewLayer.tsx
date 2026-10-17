"use client";

import { useCallback, useId, useMemo, useRef } from "react";

import { previewFrameUrl } from "../../../renderer/tauri/preview-frames";
import { FrameCanvas, type FrameSize } from "../../../renderer/shared/components/FrameCanvas";
import { useNativePanel } from "../../../renderer/shared/hooks/useNativePanel";

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
 * On a Mac the app draws it, under the page (`useNativePanel`), as it draws
 * the audience screen: while the screen's window is open, the very frame that
 * window shows, made smaller by the GPU — no second drawing of the screen, no
 * JPEG, and nothing this page is busy with can make it stutter. Props the page
 * draws over the preview are drawn over it still; the layers this one covered
 * are marked `data-under-native` and hidden.
 *
 * Otherwise drawn by `FrameCanvas`, which asks for each frame drawn as far
 * ahead as the trip to this screen takes, so the preview shows what the
 * audience screen shows at the same moment rather than a frame or two after it.
 */
export function CompositorPreviewLayer({
  className,
  screen = "audience",
}: {
  className?: string;
  /** Which audience screen, by id (Screen Configuration). */
  screen?: string;
}) {
  const reactId = useId();
  const id = `p${reactId.replace(/[^A-Za-z0-9_-]/g, "")}`;
  const boxRef = useRef<HTMLDivElement>(null);
  const source = useMemo(() => ({ kind: "preview" as const, screen }), [screen]);
  const drawing = useNativePanel(boxRef, id, source);

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
  return (
    <div ref={boxRef} className={className}>
      {drawing === "page" ? <FrameCanvas frameUrl={frameUrl} className="h-full w-full" /> : null}
    </div>
  );
}
