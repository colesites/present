"use client";

import { FontSizeInput } from "../../../renderer/shared/components";
import { cn } from "../../../renderer/shared/lib/utils";
import type {
  ScriptureFooterPosition,
  ScriptureTextAlign,
  ScriptureVerticalAlign,
} from "../../../shared/types/output-window";

const ALIGN_OPTIONS: ScriptureTextAlign[] = ["left", "center", "right"];
const VERTICAL_OPTIONS: ScriptureVerticalAlign[] = ["top", "middle", "bottom"];
const FOOTER_POSITION_OPTIONS: ScriptureFooterPosition[] = ["top", "bottom"];
const SCRIPTURE_FONT_SIZE_PRESETS = [48, 60, 72, 84, 96, 120, 144, 180] as const;

type ToggleGroupProps<T extends string> = {
  label: string;
  value: T;
  options: readonly T[];
  onChange: (value: T) => void;
  compact?: boolean;
};

function ToggleGroup<T extends string>({
  label,
  value,
  options,
  onChange,
  compact = false,
}: ToggleGroupProps<T>) {
  return (
    <div className="space-y-1.5">
      <p
        className={cn(
          "font-semibold uppercase tracking-wide text-muted-foreground",
          compact ? "text-[9px]" : "text-[10px]",
        )}
      >
        {label}
      </p>
      <div className="flex flex-wrap gap-1.5">
        {options.map((option) => (
          <button
            key={option}
            type="button"
            onClick={() => onChange(option)}
            className={cn(
              "rounded-md border px-2.5 py-1 text-xs capitalize transition",
              value === option
                ? "border-primary bg-primary/10 text-primary"
                : "border-border text-muted-foreground hover:bg-muted",
            )}
          >
            {option}
          </button>
        ))}
      </div>
    </div>
  );
}

interface ScriptureLayoutControlsProps {
  fontSize: number;
  onFontSizeChange: (value: number) => void;
  textAlign: ScriptureTextAlign;
  onTextAlignChange: (value: ScriptureTextAlign) => void;
  verticalAlign: ScriptureVerticalAlign;
  onVerticalAlignChange: (value: ScriptureVerticalAlign) => void;
  footerAlign: ScriptureTextAlign;
  onFooterAlignChange: (value: ScriptureTextAlign) => void;
  footerPosition: ScriptureFooterPosition;
  onFooterPositionChange: (value: ScriptureFooterPosition) => void;
  compact?: boolean;
  className?: string;
}

export function ScriptureLayoutControls({
  fontSize,
  onFontSizeChange,
  textAlign,
  onTextAlignChange,
  verticalAlign,
  onVerticalAlignChange,
  footerAlign,
  onFooterAlignChange,
  footerPosition,
  onFooterPositionChange,
  compact = false,
  className,
}: ScriptureLayoutControlsProps) {
  return (
    <div className={cn("space-y-3", className)}>
      <div className="space-y-1.5">
        <p
          className={cn(
            "font-semibold uppercase tracking-wide text-muted-foreground",
            compact ? "text-[9px]" : "text-[10px]",
          )}
        >
          Verse Size
        </p>
        <FontSizeInput
          value={fontSize}
          onChange={onFontSizeChange}
          presets={SCRIPTURE_FONT_SIZE_PRESETS}
          unit="px"
          min={24}
          max={400}
        />
      </div>

      <ToggleGroup
        label="Verse Align"
        value={textAlign}
        options={ALIGN_OPTIONS}
        onChange={onTextAlignChange}
        compact={compact}
      />

      <ToggleGroup
        label="Verse Vertical"
        value={verticalAlign}
        options={VERTICAL_OPTIONS}
        onChange={onVerticalAlignChange}
        compact={compact}
      />

      <ToggleGroup
        label="Footer Align"
        value={footerAlign}
        options={ALIGN_OPTIONS}
        onChange={onFooterAlignChange}
        compact={compact}
      />

      <ToggleGroup
        label="Footer Position"
        value={footerPosition}
        options={FOOTER_POSITION_OPTIONS}
        onChange={onFooterPositionChange}
        compact={compact}
      />

      <p className={cn("text-muted-foreground", compact ? "text-[10px]" : "text-[11px]")}>
        Long verses shrink automatically to stay inside the output frame.
      </p>
    </div>
  );
}
