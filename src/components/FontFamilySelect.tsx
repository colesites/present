"use client";

import { memo } from "react";
import { cn } from "@/lib/utils";

export const FONT_OPTIONS = [
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

interface FontFamilySelectProps {
  value: string;
  onChange: (value: string) => void;
  className?: string;
}

export const FontFamilySelect = memo(function FontFamilySelect({
  value,
  onChange,
  className,
}: FontFamilySelectProps) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className={cn(
        "h-[26px] w-32 rounded border border-input bg-background px-2 text-xs text-foreground focus:border-primary focus:outline-none",
        className
      )}
    >
      {FONT_OPTIONS.map((font) => (
        <option key={font} value={font}>
          {font}
        </option>
      ))}
    </select>
  );
});
