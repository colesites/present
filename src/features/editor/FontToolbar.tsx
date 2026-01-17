"use client";

import { memo } from "react";
import { cn } from "@/lib/utils";

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

      {/* Font size */}
      <div className="flex items-center gap-1">
        <input
          type="number"
          min="12"
          max="500"
          value={fontSize}
          onChange={(e) => onFontSizeChange(Number(e.target.value) || 72)}
          className="w-16 rounded border border-input bg-background px-2 py-1 text-xs text-foreground focus:border-primary focus:outline-none"
        />
        <span className="text-[10px] text-muted-foreground">px</span>
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
