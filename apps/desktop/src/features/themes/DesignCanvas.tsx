"use client";

import { useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { CanvasSlideLayer } from "../../renderer/shared/components/CanvasSlideLayer";
import { cn } from "../../renderer/shared/lib/utils";
import type { CanvasSizePreset, LibrarySlide, SlideElement } from "../../shared/types";
import { getCanvasSizeDimensions } from "../library/lib/library-items";
import { dragFrame, snapFrame, type DragMode, type Guide } from "./design-frames.mjs";
import type { ThemeFrame, ThemeLook } from "./theme-look.mjs";

export type DesignTarget = "words" | "box";

/** Standing in for a video or image where a theme leaves the slide clear. */
export const MEDIA_STAND_IN =
  "radial-gradient(120% 90% at 20% 15%, #3b3f6b 0%, transparent 55%), radial-gradient(90% 80% at 85% 90%, #5a3a2e 0%, transparent 60%), #15161f";

/** How close, in screen pixels, an edge comes to a line before it snaps. */
const SNAP_PIXELS = 6;

const HANDLES: Array<{ mode: DragMode; className: string; cursor: string }> = [
  { mode: "nw", className: "-left-1 -top-1", cursor: "nwse-resize" },
  { mode: "n", className: "left-1/2 -top-1 -translate-x-1/2", cursor: "ns-resize" },
  { mode: "ne", className: "-right-1 -top-1", cursor: "nesw-resize" },
  { mode: "e", className: "-right-1 top-1/2 -translate-y-1/2", cursor: "ew-resize" },
  { mode: "se", className: "-bottom-1 -right-1", cursor: "nwse-resize" },
  { mode: "s", className: "-bottom-1 left-1/2 -translate-x-1/2", cursor: "ns-resize" },
  { mode: "sw", className: "-bottom-1 -left-1", cursor: "nesw-resize" },
  { mode: "w", className: "-left-1 top-1/2 -translate-y-1/2", cursor: "ew-resize" },
];

/**
 * The slide being designed, drawn by the renderer the output uses, with the
 * words and the box behind them as frames to drag and resize. Edges snap to
 * the slide's edges, middle and safe margins and to each other; Alt drags
 * freely.
 */
export function DesignCanvas({
  look,
  slide,
  canvasSize,
  selected,
  editable,
  onSelect,
  onFrameChange,
}: {
  look: ThemeLook;
  /** The slide with the look applied, as the audience will see it. */
  slide: LibrarySlide;
  canvasSize: CanvasSizePreset;
  selected: DesignTarget | null;
  editable: boolean;
  onSelect: (target: DesignTarget | null) => void;
  /** A frame moved; `done` once the drag ends. */
  onFrameChange: (target: DesignTarget, frame: ThemeFrame, done: boolean) => void;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [guides, setGuides] = useState<Guide[]>([]);
  const [dragging, setDragging] = useState<DesignTarget | null>(null);
  const { width, height } = getCanvasSizeDimensions(canvasSize);

  const background =
    look.background?.kind === "color"
      ? look.background.color
      : look.background
        ? look.background.kind === "gradient"
          ? look.background.from
          : look.background.base
        : MEDIA_STAND_IN;

  const startDrag = (event: ReactPointerEvent, target: DesignTarget, mode: DragMode) => {
    event.stopPropagation();
    onSelect(target);
    if (!editable || event.button !== 0) return;
    event.preventDefault();
    const rect = rootRef.current?.getBoundingClientRect();
    const origin = target === "words" ? look.frame : look.box?.frame;
    if (!rect || !origin) return;
    const others = target === "words" ? (look.box ? [look.box.frame] : []) : [look.frame];
    const threshold = { x: SNAP_PIXELS / rect.width, y: SNAP_PIXELS / rect.height };
    const startX = event.clientX;
    const startY = event.clientY;
    let latest = origin;
    setDragging(target);

    const move = (moveEvent: PointerEvent) => {
      const next = dragFrame(origin, mode, (moveEvent.clientX - startX) / rect.width, (moveEvent.clientY - startY) / rect.height);
      const snapped = moveEvent.altKey ? { frame: next, guides: [] } : snapFrame(next, mode, others, threshold);
      latest = snapped.frame;
      setGuides(snapped.guides);
      onFrameChange(target, latest, false);
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
      setGuides([]);
      setDragging(null);
      onFrameChange(target, latest, true);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
  };

  const frameBox = (target: DesignTarget, frame: ThemeFrame) => {
    const isSelected = selected === target;
    return (
      <div
        key={target}
        role="button"
        tabIndex={-1}
        aria-label={target === "words" ? "The words" : "The box behind the words"}
        onPointerDown={(event) => startDrag(event, target, "move")}
        className={cn(
          "group absolute",
          editable ? "cursor-move" : "cursor-pointer",
          isSelected
            ? "outline outline-1 outline-primary"
            : "outline-dashed outline-1 outline-transparent hover:outline-white/40",
        )}
        style={{
          left: `${frame.x * 100}%`,
          top: `${frame.y * 100}%`,
          width: `${frame.width * 100}%`,
          height: `${frame.height * 100}%`,
        }}
      >
        {isSelected ? (
          <>
            <span className="pointer-events-none absolute -top-5 left-0 rounded bg-primary px-1.5 py-px text-[9px] font-semibold uppercase tracking-wide text-primary-foreground">
              {target === "words" ? "Words" : "Box"}
              {dragging === target
                ? ` ${Math.round(frame.width * 100)}% × ${Math.round(frame.height * 100)}%`
                : ""}
            </span>
            {editable
              ? HANDLES.map((handle) => (
                  <span
                    key={handle.mode}
                    onPointerDown={(event) => startDrag(event, target, handle.mode)}
                    className={cn(
                      "absolute h-2 w-2 rounded-[2px] border border-primary bg-white shadow",
                      handle.className,
                    )}
                    style={{ cursor: handle.cursor }}
                  />
                ))
              : null}
          </>
        ) : null}
      </div>
    );
  };

  return (
    <div
      ref={rootRef}
      onPointerDown={() => onSelect(null)}
      className="relative w-full touch-none select-none overflow-visible rounded-lg"
      style={{ aspectRatio: `${width} / ${height}` }}
    >
      <div className="absolute inset-0 overflow-hidden rounded-lg border border-border/60" style={{ background }}>
        <CanvasSlideLayer
          text={slide.text}
          elements={(slide.elements ?? []) as SlideElement[]}
          canvasSize={canvasSize}
          className="absolute inset-0"
          libraryStyle={{
            fontFamily: look.text.fontFamily,
            fontSize: look.text.fontSize,
            fontBold: false,
            fontItalic: false,
            fontUnderline: false,
          }}
        />
        {/* The safe area, faintly, while something is being moved. */}
        {dragging ? <div className="pointer-events-none absolute inset-[5%] border border-dashed border-white/15" /> : null}
        {guides.map((guide, index) => (
          <div
            key={`${guide.axis}-${index}`}
            className="pointer-events-none absolute bg-fuchsia-400"
            style={
              guide.axis === "x"
                ? { left: `${guide.at * 100}%`, top: 0, bottom: 0, width: 1 }
                : { top: `${guide.at * 100}%`, left: 0, right: 0, height: 1 }
            }
          />
        ))}
      </div>
      {look.box ? frameBox("box", look.box.frame) : null}
      {frameBox("words", look.frame)}
    </div>
  );
}
