"use client";

import { memo, useMemo, useState } from "react";
import type { LibraryItem } from "../../shared/types";
import { stripBracketsForDisplay } from "../../renderer/shared/lib/lyrics";
import { getLabelColor } from "../../shared/types";
import { cn } from "../../renderer/shared/lib/utils";
import { AutoFitText } from "../../renderer/shared/components/AutoFitText";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "../../renderer/shared/components/ui/context-menu";
import { Pencil } from "lucide-react";

// Fixed slide box height
const BASE_SLIDE_HEIGHT = 160;
// Minimum width for each slide (controls when columns reduce)
const BASE_MIN_SLIDE_WIDTH = 220;

export interface SlideData {
  libraryItem?: LibraryItem | null;
  slide: {
    text: string;
    label?: string;
    modifier?: string;
    backgroundId?: string;
    footer?: string;
  };
  index: number;
  id?: string; // Optional unique ID override
}

interface SlidesGridProps {
  slides: SlideData[];
  activeSlideId: string | null;
  selectedIndex: number | null;
  onSelectSlide: (slideId: string, text: string, footer?: string) => void;
  onEditSlide?: (libraryId: string, index: number) => void;
  fontFamily?: string;
  fontSize?: number;
  fontBold?: boolean;
  fontItalic?: boolean;
  fontUnderline?: boolean;
}

export const SlidesGrid = memo(function SlidesGrid({
  slides,
  activeSlideId,
  selectedIndex,
  onSelectSlide,
  onEditSlide,
  fontFamily,
  fontSize,
  fontBold,
  fontItalic,
  fontUnderline,
}: SlidesGridProps) {
  const [itemScalePercent, setItemScalePercent] = useState(60);
  const scaleFactor = itemScalePercent / 60;
  const slideHeight = useMemo(
    () => Math.round(BASE_SLIDE_HEIGHT * scaleFactor),
    [scaleFactor]
  );
  const minSlideWidth = useMemo(
    () => Math.round(BASE_MIN_SLIDE_WIDTH * scaleFactor),
    [scaleFactor]
  );
  const gridGap = useMemo(
    () => Math.max(8, Math.round(16 * scaleFactor)),
    [scaleFactor]
  );

  if (slides.length === 0) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        Select a library item to view slides
      </div>
    );
  }

  return (
    <div className="relative pb-8">
      <div
        className="grid pb-4"
        style={{
          gap: `${gridGap}px`,
          gridTemplateColumns: `repeat(auto-fill, minmax(${minSlideWidth}px, 1fr))`,
        }}
      >
        {slides.map(({ libraryItem, slide, index, id }) => {
          const slideId =
            id ||
            (libraryItem
              ? `${libraryItem._id}:${index}`
              : `scripture:${index}`);
          const isActive = activeSlideId === slideId;
          const isSelected = selectedIndex === index;

          return (
            <SlideCard
              key={slideId}
              slide={slide}
              index={index}
              isActive={isActive}
              isSelected={isSelected}
              onClick={() => onSelectSlide(slideId, slide.text, slide.footer)}
              onEdit={
                onEditSlide && libraryItem
                  ? () => onEditSlide(libraryItem._id, index)
                  : undefined
              }
              isScripture={!libraryItem}
              fontFamily={fontFamily}
              fontSize={fontSize}
              fontBold={fontBold}
              fontItalic={fontItalic}
              fontUnderline={fontUnderline}
              slideHeight={slideHeight}
            />
          );
        })}
      </div>
      <div className="pointer-events-none absolute bottom-0 left-0 right-0 flex justify-center">
        <input
          type="range"
          min={30}
          max={110}
          value={itemScalePercent}
          onChange={(event) =>
            setItemScalePercent(Number.parseInt(event.target.value, 10))
          }
          className="pointer-events-auto h-1.5 w-56 accent-primary"
          aria-label="Slide item size"
        />
      </div>
    </div>
  );
});

interface SlideCardProps {
  libraryId?: string;
  slide: {
    text: string;
    label?: string;
    modifier?: string;
    footer?: string;
  };
  index: number;
  isActive: boolean;
  isSelected: boolean;
  onClick: () => void;
  onEdit?: () => void;
  isScripture?: boolean;
  fontFamily?: string;
  fontSize?: number;
  fontBold?: boolean;
  fontItalic?: boolean;
  fontUnderline?: boolean;
  slideHeight: number;
}

const SlideCard = memo(function SlideCard({
  slide,
  index,
  isActive,
  isSelected,
  onClick,
  onEdit,
  isScripture,
  fontFamily,
  fontSize,
  fontBold,
  fontItalic,
  fontUnderline,
  slideHeight,
}: SlideCardProps) {
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <button
          type="button"
          onClick={onClick}
          style={{ height: slideHeight }}
          className={cn(
            "group relative flex w-full flex-col overflow-hidden rounded-lg border text-left transition",
            isActive
              ? "border-primary ring-2 ring-primary"
              : isSelected
                ? "border-primary/50"
                : "border-border hover:border-primary/50"
          )}
        >
          {/* Slide preview - black background like main output */}
          <div className="flex flex-1 items-center justify-center overflow-hidden bg-black p-2">
            <AutoFitText
              text={stripBracketsForDisplay(slide.text)}
              className={cn(
                "pointer-events-none select-none text-white",
                fontBold && "font-bold",
                fontItalic && "italic",
                fontUnderline && "underline"
              )}
              style={{
                fontFamily,
                fontSize: isScripture ? "18vh" : undefined, // scaled in CSS usually, but let's be safe
              }}
              maxFontSize={
                isScripture ? undefined : fontSize ? fontSize * 0.2 : 24
              }
              minScale={isScripture ? 0.1 : 0.5}
            />
          </div>

          {/* Label bar: number left, label center, modifier right */}
          <div
            className={cn(
              "flex shrink-0 items-center justify-between px-3 py-1.5 text-xs font-medium",
              getLabelColor(slide.label)
            )}
          >
            <span>{index + 1}</span>
            <span>{slide.label || ""}</span>
            <span>{slide.modifier || ""}</span>
          </div>
        </button>
      </ContextMenuTrigger>
      <ContextMenuContent className="w-48">
        {onEdit && (
          <ContextMenuItem onClick={onEdit} className="gap-2">
            <Pencil className="h-4 w-4" />
            Edit in Editor
          </ContextMenuItem>
        )}
      </ContextMenuContent>
    </ContextMenu>
  );
});
