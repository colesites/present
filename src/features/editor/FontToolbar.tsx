"use client";

import { memo, useState, useEffect, useCallback } from "react";
import { cn } from "@/lib/utils";
import { FontSizeInput, FontFamilySelect } from "@/components"; // Assumes exported from components/index.ts

// Common font size presets

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
  return (
    <div className="flex items-center gap-2 rounded-md border border-border bg-card px-3 py-2">
      <span className="text-[10px] text-muted-foreground uppercase tracking-wide">
        Output Style:
      </span>

      {/* Font family */}
      <FontFamilySelect
        value={fontFamily}
        onChange={onFontFamilyChange}
        className="w-32"
      />

      {/* Font density/size */}
      <FontSizeInput
        value={fontSize}
        onChange={onFontSizeChange}
        presets={FONT_SIZE_PRESETS}
      />

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
