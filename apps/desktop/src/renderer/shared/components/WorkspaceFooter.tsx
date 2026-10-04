"use client";

import type { ReactNode } from "react";
import { LayoutGrid, List } from "lucide-react";
import { cn } from "../lib/utils";
import { TransitionPicker } from "../../../features/transitions/TransitionPicker";

/** The slide grid's scale: smallest, and largest — one slide to a row. */
export const SLIDE_SCALE_MIN = 30;
export const SLIDE_SCALE_MAX = 110;

interface WorkspaceFooterProps {
  isGridView: boolean;
  onViewModeChange: (val: boolean) => void;
  scale: number;
  onScaleChange: (val: number) => void;
  disableViewModeToggle?: boolean;
  disableScaleControl?: boolean;
  centerContent?: ReactNode;
  leftContent?: ReactNode;
  /**
   * Show how the next slide arrives, beside the view toggles.
   *
   * The show area only: the media panel uses this same footer, and a
   * transition belongs to a slide rather than to a folder of files.
   */
  showTransitionPicker?: boolean;
  className?: string;
}

export function WorkspaceFooter({
  isGridView,
  onViewModeChange,
  scale,
  onScaleChange,
  disableViewModeToggle = false,
  disableScaleControl = false,
  centerContent,
  leftContent,
  showTransitionPicker = false,
  className,
}: WorkspaceFooterProps) {
  return (
    <div className={cn(
      "z-10 flex h-10 items-center justify-between border-t border-border bg-card/60 px-4 shrink-0 transition-colors",
      className
    )}>
      {/* Left side: Contextual actions */}
      <div className="flex items-center min-w-24">
        {leftContent}
      </div>

      {/* Middle side: Potential Slot for Filter/Search (like in Media) */}
      <div className="flex-1 flex justify-center px-4 max-w-xl">
        {centerContent}
      </div>

      {/* Right side: Transition + View Toggles + Scale Control */}
      <div className="flex items-center gap-4">
        {showTransitionPicker ? <TransitionPicker /> : null}

        <div className="mr-1 flex items-center gap-0.5 rounded-lg bg-secondary/40 p-0.5">
          <button
            type="button"
            disabled={disableViewModeToggle}
            onClick={() => onViewModeChange(true)}
            className={cn(
              "rounded-md p-1.5 transition",
              disableViewModeToggle && "cursor-not-allowed opacity-45",
              isGridView
                ? "bg-background text-foreground shadow-sm ring-1 ring-border/60"
                : "text-muted-foreground hover:text-foreground"
            )}
            title="Grid View"
          >
            <LayoutGrid className="h-4 w-4" />
          </button>
          <button
            type="button"
            disabled={disableViewModeToggle}
            onClick={() => onViewModeChange(false)}
            className={cn(
              "rounded-md p-1.5 transition",
              disableViewModeToggle && "cursor-not-allowed opacity-45",
              !isGridView
                ? "bg-background text-foreground shadow-sm ring-1 ring-border/60"
                : "text-muted-foreground hover:text-foreground"
            )}
            title="List View"
          >
            <List className="h-4 w-4" />
          </button>
        </div>

        <div className="flex items-center gap-3">
          <span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground/60 select-none">Scale</span>
          <div className="flex items-center group">
            <input
              type="range"
              min={SLIDE_SCALE_MIN}
              max={SLIDE_SCALE_MAX}
              value={scale}
              disabled={disableScaleControl}
              onChange={(event) => onScaleChange(Number.parseInt(event.target.value, 10))}
              className={cn(
                "h-1.5 w-32 xl:w-40 accent-primary transition-all",
                disableScaleControl
                  ? "cursor-not-allowed opacity-45"
                  : "cursor-pointer hover:scale-y-110 active:cursor-grabbing",
              )}
              aria-label="Scale/Zoom Control"
            />
          </div>
        </div>
      </div>
    </div>
  );
}
