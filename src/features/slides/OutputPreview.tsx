"use client";

import { memo } from "react";
import { cn } from "@/lib/utils";
import { AutoFitText } from "@/components/ui/AutoFitText";
import { stripBracketsForDisplay } from "@/lib/lyrics";

interface SlideGroup {
  label: string;
  count: number;
}

interface OutputPreviewProps {
  text: string | null;
  fontFamily: string;
  fontSize: number;
  fontBold: boolean;
  fontItalic: boolean;
  fontUnderline: boolean;
  groups?: SlideGroup[];
}

export const OutputPreview = memo(function OutputPreview({
  text,
  fontFamily,
  fontSize,
  fontBold,
  fontItalic,
  fontUnderline,
  groups = [],
}: OutputPreviewProps) {
  // Scale font size for preview (preview is smaller than output)
  const previewFontSize = Math.max(10, fontSize * 0.18);

  return (
    <div className="flex h-full flex-col">
      {/* Main Output label with status indicator */}
      <div className="flex items-center gap-2 px-3 py-2">
        <span className="h-2 w-2 rounded-full bg-primary" />
        <p className="text-xs font-medium text-muted-foreground">Main Output</p>
      </div>

      {/* Preview box - fixed height with auto-fit text */}
      <div className="mx-3 h-36 overflow-hidden rounded-lg bg-black p-2">
        {text ? (
          <AutoFitText
            text={stripBracketsForDisplay(text)}
            className={cn(
              "leading-relaxed text-white",
              fontBold && "font-bold",
              fontItalic && "italic",
              fontUnderline && "underline"
            )}
            style={{
              fontFamily,
              fontSize: `${previewFontSize}px`,
            }}
            minScale={0.4}
          />
        ) : (
          <div className="flex h-full items-center justify-center">
            <p className="text-xs text-zinc-600">No slide selected</p>
          </div>
        )}
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
