"use client";

import { memo } from "react";
import { cn } from "@/lib/utils";
import { AutoFitText } from "@/components/ui/AutoFitText";
import { stripBracketsForDisplay } from "@/lib/lyrics";

// Fixed output preview dimensions (16:9 aspect ratio)
const OUTPUT_WIDTH = 240;
const OUTPUT_HEIGHT = 135;

interface SlideGroup {
  label: string;
  count: number;
}

interface OutputPreviewProps {
  text: string | null;
  fontBold: boolean;
  fontItalic: boolean;
  fontUnderline: boolean;
  groups?: SlideGroup[];
}

export const OutputPreview = memo(function OutputPreview({
  text,
  fontBold,
  fontItalic,
  fontUnderline,
  groups = [],
}: OutputPreviewProps) {
  return (
    <div className="flex h-full flex-col">
      {/* Main Output label with status indicator */}
      <div className="flex items-center gap-2 px-3 py-2">
        <span className="h-2 w-2 rounded-full bg-primary" />
        <p className="text-xs font-medium text-muted-foreground">Main Output</p>
      </div>

      {/* Preview box - fixed size rectangle (16:9) */}
      <div className="flex justify-center px-3">
        <div
          style={{ width: OUTPUT_WIDTH, height: OUTPUT_HEIGHT }}
          className="shrink-0 overflow-hidden rounded-lg bg-black p-2"
        >
          {text ? (
            <AutoFitText
              text={stripBracketsForDisplay(text)}
              className={cn(
                "pointer-events-none select-none text-sm leading-relaxed text-white",
                fontBold && "font-bold",
                fontItalic && "italic",
                fontUnderline && "underline"
              )}
              minScale={0.4}
            />
          ) : (
            <div className="flex h-full items-center justify-center">
              <p className="text-xs text-zinc-600">No slide selected</p>
            </div>
          )}
        </div>
      </div>

      {/* Groups section */}
      <div className="mt-4 flex-1 px-3">
        <p className="mb-2 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
          Groups
        </p>
        <div className="space-y-1">
          {groups.length > 0 ? (
            groups.map((group) => (
              <div
                key={group.label}
                className="flex items-center justify-between py-1 text-sm"
              >
                <span className="text-foreground">{group.label}</span>
                <span className="text-muted-foreground">{group.count}</span>
              </div>
            ))
          ) : (
            <p className="text-xs text-muted-foreground">No groups</p>
          )}
        </div>
      </div>
    </div>
  );
});
