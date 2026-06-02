"use client";

import { Type as TypeIcon } from "lucide-react";
import { cn } from "../../../renderer/shared/lib/utils";

interface TextTabPanelProps {
  isEnabled: boolean;
  onToggle: () => void;
}

export function TextTabPanel({ isEnabled, onToggle }: TextTabPanelProps) {
  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden">
      <div className="border-b border-border/70 px-4 py-3">
        <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
          Text
        </p>
        <p className="mt-1 text-[11px] text-muted-foreground">
          Live text layer on the audience output.
        </p>
      </div>

      <div className="flex flex-1 flex-col items-stretch gap-3 p-4">
        <button
          type="button"
          onClick={onToggle}
          aria-pressed={isEnabled}
          className={cn(
            "group flex items-center justify-between rounded-md border px-3 py-2.5 text-left transition",
            isEnabled
              ? "border-primary/60 bg-primary/15 text-primary"
              : "border-border/70 bg-background/40 text-foreground hover:bg-foreground/5",
          )}
        >
          <span className="flex items-center gap-2 text-[12px] font-medium">
            <TypeIcon className="h-4 w-4" strokeWidth={1.6} />
            Text layer
          </span>
          <span
            className={cn(
              "rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider",
              isEnabled
                ? "bg-primary text-primary-foreground"
                : "bg-foreground/10 text-muted-foreground",
            )}
          >
            {isEnabled ? "On" : "Off"}
          </span>
        </button>

        <p className="text-[11px] leading-relaxed text-muted-foreground">
          Shortcut: <kbd className="rounded bg-foreground/10 px-1.5 py-0.5 text-[10px]">⌘T</kbd>
          {" "}/{" "}
          <kbd className="rounded bg-foreground/10 px-1.5 py-0.5 text-[10px]">Ctrl T</kbd>
        </p>

        <div className="mt-4 rounded-md border border-dashed border-border/60 bg-background/30 p-3 text-[11px] text-muted-foreground">
          Theme presets, alignment, and per-slide overrides are coming in the
          next turn. For now use the Editor inspector to style individual slides.
        </div>
      </div>
    </div>
  );
}
