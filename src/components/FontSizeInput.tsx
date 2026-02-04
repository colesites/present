"use client";

import { memo, useState, useEffect, useCallback } from "react";
import { cn } from "@/lib/utils";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ChevronDownIcon } from "lucide-react";

const FONT_SIZE_PRESETS = [
  24, 36, 48, 60, 72, 84, 96, 120, 144, 180, 200, 250, 300, 400,
] as const;

// Smaller presets for scripture settings (vh units or just smaller px)
// But for now keeping it generic or maybe accepting presets as prop?
// The user asked to "make the comp in edit a reusable comp", so I'll stick to the existing presets basically,
// but for scripture settings the values are small (5-30).
// I should probably make presets customizable or have a specialized set for scripture.
// However, the request says "make the font size an input box like the one in edit".
// The existing edit one uses px (24-400). The scripture one uses vh (5-30).
// So I should definitely allow passing custom presets or ranges.

interface FontSizeInputProps {
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  className?: string;
  presets?: readonly number[];
  unit?: string;
}

export const FontSizeInput = memo(function FontSizeInput({
  value,
  onChange,
  min = 1,
  max = 400,
  className,
  presets = FONT_SIZE_PRESETS,
  unit = "px",
}: FontSizeInputProps) {
  const [inputValue, setInputValue] = useState(value.toString());

  useEffect(() => {
    setInputValue(value.toString());
  }, [value]);

  const applyValue = useCallback(
    (val: string) => {
      const num = parseInt(val, 10);
      if (!isNaN(num)) {
        const clamped = Math.max(min, Math.min(max, num));
        onChange(clamped);
        setInputValue(clamped.toString());
      } else {
        setInputValue(value.toString());
      }
    },
    [value, onChange, min, max]
  );

  const handleBlur = useCallback(() => {
    applyValue(inputValue);
  }, [inputValue, applyValue]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === "Enter") {
        e.currentTarget.blur();
      }
    },
    []
  );

  return (
    <div className={cn("flex items-center gap-0.5", className)}>
      <input
        type="text"
        inputMode="numeric"
        pattern="[0-9]*"
        value={inputValue}
        onChange={(e) => setInputValue(e.target.value)}
        onBlur={handleBlur}
        onKeyDown={handleKeyDown}
        className="w-12 rounded-l border border-r-0 border-input bg-background px-2 py-1 text-xs text-foreground text-center focus:border-primary focus:outline-none focus:z-10"
      />
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            className="flex h-[26px] items-center rounded-r border border-input bg-background px-1 text-muted-foreground hover:bg-accent hover:text-foreground focus:outline-none focus:border-primary"
          >
            <ChevronDownIcon className="h-3 w-3" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="min-w-[80px] max-h-[300px] overflow-y-auto">
          {presets.map((size) => (
            <DropdownMenuItem
              key={size}
              onClick={() => onChange(size)}
              className={cn(
                "text-xs justify-center",
                value === size && "bg-accent"
              )}
            >
              {size}{unit}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
      {unit && <span className="ml-1 text-[10px] text-muted-foreground">{unit}</span>}
    </div>
  );
});
