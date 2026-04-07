"use client";

import type { ReactNode } from "react";
import { LayoutGrid, List } from "lucide-react";
import { cn } from "../lib/utils";

interface WorkspaceFooterProps {
  isGridView: boolean;
  onViewModeChange: (val: boolean) => void;
  scale: number;
  onScaleChange: (val: number) => void;
  centerContent?: ReactNode;
  leftContent?: ReactNode;
  className?: string;
}

export function WorkspaceFooter({
  isGridView,
  onViewModeChange,
  scale,
  onScaleChange,
  centerContent,
  leftContent,
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

      {/* Right side: View Toggles + Scale Control */}
      <div className="flex items-center gap-4">
        <div className="flex items-center gap-1.5 border-r border-border pr-4 mr-1">
          <button
            type="button"
            onClick={() => onViewModeChange(true)}
            className={cn(
              "p-1.5 transition rounded-md",
              isGridView
                ? "bg-primary text-primary-foreground shadow-sm"
                : "text-muted-foreground hover:bg-muted/50 hover:text-foreground"
            )}
            title="Grid View"
          >
            <LayoutGrid className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={() => onViewModeChange(false)}
            className={cn(
              "p-1.5 transition rounded-md",
              !isGridView
                ? "bg-primary text-primary-foreground shadow-sm"
                : "text-muted-foreground hover:bg-muted/50 hover:text-foreground"
            )}
            title="List View"
          >
            <List className="h-4 w-4" />
          </button>
        </div>

        <div className="flex items-center gap-4">
          <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground/60 select-none">Scale</span>
          <div className="flex items-center group">
            <input
              type="range"
              min={30}
              max={110}
              value={scale}
              onChange={(event) => onScaleChange(Number.parseInt(event.target.value, 10))}
              className="h-1.5 w-32 xl:w-40 accent-primary cursor-pointer transition-all hover:scale-y-110 active:cursor-grabbing"
              aria-label="Scale/Zoom Control"
            />
          </div>
        </div>
      </div>
    </div>
  );
}
