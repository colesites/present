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

const FONT_OPTIONS = [
  "Inter",
  "Georgia",
  "Times New Roman",
  "Arial",
  "Helvetica",
  "Verdana",
  "Trebuchet MS",
  "Palatino",
  "Garamond",
  "Bookman",
] as const;

// Common font size presets
const FONT_SIZE_PRESETS = [24, 36, 48, 60, 72, 84, 96, 120, 144, 180, 200, 250, 300, 400] as const;

interface FontToolbarProps {
  fontFamily: string;
  fontSize: number;
  fontBold: boolean;
  fontItalic: boolean;
  fontUnderline: boolean;
  onFontFamilyChange: (family: string) => void;
  onFontSizeChange: (size: number) => void;
  onBoldToggle: () => void;
  onItalicToggle: () => void;
  onUnderlineToggle: () => void;
}

export const FontToolbar = memo(function FontToolbar({
  fontFamily,
  fontSize,
  fontBold,
  fontItalic,
  fontUnderline,
  onFontFamilyChange,
  onFontSizeChange,
  onBoldToggle,
  onItalicToggle,
  onUnderlineToggle,
}: FontToolbarProps) {
  // Local state for input - only apply on blur
  const [inputValue, setInputValue] = useState(fontSize.toString());

  // Sync input value when fontSize prop changes (e.g., from dropdown selection)
  useEffect(() => {
    setInputValue(fontSize.toString());
  }, [fontSize]);

  // Apply font size change with validation
  const applyFontSize = useCallback(
    (value: string) => {
      const num = parseInt(value, 10);
      if (!isNaN(num)) {
        // Clamp between 1 and 400
        const clamped = Math.max(1, Math.min(400, num));
        onFontSizeChange(clamped);
        setInputValue(clamped.toString());
      } else {
        // Reset to current fontSize if invalid
        setInputValue(fontSize.toString());
      }
    },
    [fontSize, onFontSizeChange]
  );

  // Handle blur - apply changes
  const handleBlur = useCallback(() => {
    applyFontSize(inputValue);
  }, [inputValue, applyFontSize]);

  // Handle Enter key - apply changes
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === "Enter") {
        e.currentTarget.blur();
      }
    },
    []
  );

  // Handle dropdown selection
  const handlePresetSelect = useCallback(
    (size: number) => {
      onFontSizeChange(size);
    },
    [onFontSizeChange]
  );

  return (
    <div className="flex items-center gap-2 rounded-md border border-border bg-card px-3 py-2">
      <span className="text-[10px] text-muted-foreground uppercase tracking-wide">
        Output Style:
      </span>

      {/* Font family */}
      <select
        value={fontFamily}
        onChange={(e) => onFontFamilyChange(e.target.value)}
        className="rounded border border-input bg-background px-2 py-1 text-xs text-foreground focus:border-primary focus:outline-none"
      >
        {FONT_OPTIONS.map((font) => (
          <option key={font} value={font}>
            {font}
          </option>
        ))}
      </select>

      {/* Font size with dropdown */}
      <div className="flex items-center gap-0.5">
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
          <DropdownMenuContent align="start" className="min-w-[80px]">
            {FONT_SIZE_PRESETS.map((size) => (
              <DropdownMenuItem
                key={size}
                onClick={() => handlePresetSelect(size)}
                className={cn(
                  "text-xs justify-center",
                  fontSize === size && "bg-accent"
                )}
              >
                {size}px
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
        <span className="ml-1 text-[10px] text-muted-foreground">px</span>
      </div>

      <div className="mx-2 h-4 w-px bg-border" />

      {/* Bold */}
      <button
        type="button"
        onClick={onBoldToggle}
        className={cn(
          "flex h-7 w-7 items-center justify-center rounded text-sm font-bold transition",
          fontBold
            ? "bg-primary text-primary-foreground"
            : "bg-secondary text-foreground hover:bg-secondary/80",
        )}
        title="Bold"
      >
        B
      </button>

      {/* Italic */}
      <button
        type="button"
        onClick={onItalicToggle}
        className={cn(
          "flex h-7 w-7 items-center justify-center rounded text-sm italic transition",
          fontItalic
            ? "bg-primary text-primary-foreground"
            : "bg-secondary text-foreground hover:bg-secondary/80",
        )}
        title="Italic"
      >
        I
      </button>

      {/* Underline */}
      <button
        type="button"
        onClick={onUnderlineToggle}
        className={cn(
          "flex h-7 w-7 items-center justify-center rounded text-sm underline transition",
          fontUnderline
            ? "bg-primary text-primary-foreground"
            : "bg-secondary text-foreground hover:bg-secondary/80",
        )}
        title="Underline"
      >
        U
      </button>
    </div>
  );
});
