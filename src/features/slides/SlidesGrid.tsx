"use client";

import { memo } from "react";
import type { Id } from "@/../convex/_generated/dataModel";
import type { Song } from "@/types";
import { stripBracketsForDisplay } from "@/lib/lyrics";
import { getLabelColor } from "@/types";
import { cn } from "@/lib/utils";
import { AutoFitText } from "@/components/AutoFitText";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { Pencil } from "lucide-react";

// Fixed slide box height
const SLIDE_HEIGHT = 160;
// Minimum width for each slide (controls when columns reduce)
const MIN_SLIDE_WIDTH = 220;

export interface SlideData {
  song?: Song | null;
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
  onEditSlide?: (songId: Id<"songs">, index: number) => void;
}

export const SlidesGrid = memo(function SlidesGrid({
  slides,
  activeSlideId,
  selectedIndex,
  onSelectSlide,
  onEditSlide,
}: SlidesGridProps) {
  if (slides.length === 0) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        Select a song or search scripture to view slides
      </div>
    );
  }

  return (
    <div
      className="grid gap-4 pb-4"
      style={{
        gridTemplateColumns: `repeat(auto-fill, minmax(${MIN_SLIDE_WIDTH}px, 1fr))`,
      }}
    >
      {slides.map(({ song, slide, index, id }) => {
        const slideId =
          id || (song ? `${song._id}:${index}` : `scripture:${index}`);
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
              onEditSlide && song
                ? () => onEditSlide(song._id, index)
                : undefined
            }
          />
        );
      })}
    </div>
  );
});

interface SlideCardProps {
  songId?: Id<"songs">;
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
}

const SlideCard = memo(function SlideCard({
  slide,
  index,
  isActive,
  isSelected,
  onClick,
  onEdit,
}: SlideCardProps) {
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <button
          type="button"
          onClick={onClick}
          style={{ height: SLIDE_HEIGHT }}
          className={cn(
            "group relative flex w-full flex-col overflow-hidden rounded-lg border text-left transition",
            isActive
              ? "border-primary ring-2 ring-primary"
              : isSelected
                ? "border-primary/50"
                : "border-border hover:border-primary/50",
          )}
        >
          {/* Slide preview - black background like main output */}
          <div className="flex flex-1 items-center justify-center overflow-hidden bg-black p-2">
            <AutoFitText
              text={stripBracketsForDisplay(slide.text)}
              className="pointer-events-none select-none text-sm leading-relaxed text-white"
              minScale={0.5}
            />
          </div>

          {/* Label bar: number left, label center, modifier right */}
          <div
            className={cn(
              "flex shrink-0 items-center justify-between px-3 py-1.5 text-xs font-medium",
              getLabelColor(slide.label),
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
