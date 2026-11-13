"use client";

import { memo, useEffect, useMemo, useState, type CSSProperties } from "react";

import type { CanvasSizePreset, SlideElement } from "../../../shared/types";
import type { LibraryStyle } from "../../../shared/types/output-window";
import { CanvasSlideLayer } from "../../../renderer/shared/components/CanvasSlideLayer";
import { getCanvasSizeDimensions } from "../../library/lib/library-items";
import {
  buildTimeline,
  posesAt,
  stepLengthMs,
  type BuildPose,
  type PlacedBuild,
} from "../lib/builds";
import type { BuildPreview } from "../lib/build-preview";

/** The pause between one click's builds settling and the next click. */
const CLICK_PAUSE_MS = 700;
/** How long the finished slide stays before the preview ends. */
const HOLD_AT_END_MS = 900;

/**
 * The slide's builds played on the editor's canvas, as the screens play
 * them (`compositor/build.rs`, mirrored in `lib/builds.ts`): what comes with
 * the slide, then each click in turn, by itself. Each object is drawn on its
 * own layer and faded, moved, scaled and wiped there.
 */
export const BuildPreviewLayer = memo(function BuildPreviewLayer({
  preview,
  elements,
  canvasSize,
  libraryStyle,
  backgroundColor,
  onDone,
}: {
  preview: BuildPreview;
  elements: SlideElement[];
  canvasSize: CanvasSizePreset;
  libraryStyle: LibraryStyle;
  backgroundColor: string;
  onDone: () => void;
}) {
  const canvas = getCanvasSizeDimensions(canvasSize);

  // One build alone: it runs with the slide, and nothing else moves.
  const timeline = useMemo((): { placed: PlacedBuild[]; clickSteps: number } => {
    if (!preview.only) return buildTimeline(elements);
    const { elementId, phase } = preview.only;
    const element = elements.find((each) => each.id === elementId);
    const build = element?.builds?.[phase];
    if (!element || !build) return { placed: [], clickSteps: 0 };
    return buildTimeline([{ ...element, builds: { [phase]: { ...build, start: "with-previous", order: 0 } } }]);
  }, [elements, preview.only]);

  const [frame, setFrame] = useState({ step: 0, elapsedMs: 0 });

  useEffect(() => {
    let raf = 0;
    let step = 0;
    let stepStartedAt = performance.now();
    let settledAt: number | null = null;
    const tick = (now: number) => {
      const elapsedMs = now - stepStartedAt;
      setFrame({ step, elapsedMs });
      const length = stepLengthMs(timeline, step);
      if (elapsedMs >= length) {
        settledAt ??= now;
        const isLast = step >= timeline.clickSteps;
        if (now - settledAt >= (isLast ? HOLD_AT_END_MS : CLICK_PAUSE_MS)) {
          if (isLast) {
            onDone();
            return;
          }
          step += 1;
          stepStartedAt = now;
          settledAt = null;
        }
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
    // `run` restarts it when Preview is pressed again.
  }, [onDone, preview.run, timeline]);

  const { poses } = posesAt(timeline, frame.step, frame.elapsedMs);
  const shown = elements.filter((element) => element.isVisible !== false);

  return (
    <div
      className="absolute inset-0 z-30 overflow-hidden"
      style={{ backgroundColor, containerType: "size" }}
      onPointerDown={(event) => {
        // A press anywhere ends the preview.
        event.stopPropagation();
        onDone();
      }}
    >
      {shown.map((element) => (
        <PosedElement
          key={element.id}
          element={element}
          pose={poses.get(element.id)}
          canvas={canvas}
          canvasSize={canvasSize}
          libraryStyle={libraryStyle}
        />
      ))}
      <div className="pointer-events-none absolute left-2 top-2 rounded bg-black/70 px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-white">
        {preview.only
          ? "Preview"
          : frame.step === 0
            ? "Preview · with the slide"
            : `Preview · click ${frame.step} of ${timeline.clickSteps}`}
      </div>
    </div>
  );
});

/** One object, drawn alone, at its pose. */
const PosedElement = memo(function PosedElement({
  element,
  pose,
  canvas,
  canvasSize,
  libraryStyle,
}: {
  element: SlideElement;
  pose: BuildPose | undefined;
  canvas: { width: number; height: number };
  canvasSize: CanvasSizePreset;
  libraryStyle: LibraryStyle;
}) {
  const only = useMemo(() => [element], [element]);
  if (pose && pose.hidden) return null;
  const moving = pose && !pose.hidden ? (pose as Extract<BuildPose, { hidden: false }>) : null;

  const left = (element.x / canvas.width) * 100;
  const top = (element.y / canvas.height) * 100;
  const width = (element.width / canvas.width) * 100;
  const height = (element.height / canvas.height) * 100;
  const style: CSSProperties = { position: "absolute", inset: 0 };
  if (moving) {
    style.opacity = moving.opacity;
    style.transformOrigin = `${left + width / 2}% ${top + height / 2}%`;
    style.transform = `translate(${moving.dx * 100}%, ${moving.dy * 100}%) scale(${moving.scale})`;
    if (moving.wipe) {
      // What is not shown yet, cut away from the far side.
      const { from, shown } = moving.wipe;
      const right = 100 - left - width;
      const bottom = 100 - top - height;
      style.clipPath =
        from === "left"
          ? `inset(0 ${right + width * (1 - shown)}% 0 0)`
          : from === "right"
            ? `inset(0 0 0 ${left + width * (1 - shown)}%)`
            : from === "top"
              ? `inset(0 0 ${bottom + height * (1 - shown)}% 0)`
              : `inset(${top + height * (1 - shown)}% 0 0 0)`;
    }
  }
  return (
    <div style={style}>
      <CanvasSlideLayer
        text={null}
        elements={only}
        canvasSize={canvasSize}
        libraryStyle={libraryStyle}
        className="pointer-events-none absolute inset-0"
      />
    </div>
  );
});
