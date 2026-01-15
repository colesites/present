"use client";

import { memo } from "react";
import type { Id } from "@/../convex/_generated/dataModel";
import type { Song } from "@/types";
import { formatSlideLabel, stripBracketsForDisplay } from "@/lib/lyrics";
import { getLabelColor } from "@/types";
import { cn } from "@/lib/utils";
import { AutoFitText } from "@/components/ui/AutoFitText";

interface SlideData {
  song: Song;
  slide: {
    text: string;
    label?: string;
    modifier?: string;
    backgroundId?: string;
  };
  index: number;
}

interface SlidesGridProps {
  slides: SlideData[];
  activeSlideId: string | null;
  selectedIndex: number | null;
  onSelectSlide: (songId: Id<"songs">, index: number, text: string) => void;
}

export const SlidesGrid = memo(function SlidesGrid({
  slides,
  activeSlideId,
  selectedIndex,
  onSelectSlide,
}: SlidesGridProps) {
  if (slides.length === 0) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        Select a song from below to view slides
      </div>
    );
  }

  return (
    <div className="grid grid-cols-6 gap-4 pb-4">
      {slides.map(({ song, slide, index }) => {
        const slideId = `${song._id}:${index}`;
        const isActive = activeSlideId === slideId;
        const isSelected = selectedIndex === index;

        return (
          <SlideCard
            key={slideId}
            slide={slide}
            index={index}
            isActive={isActive}
            isSelected={isSelected}
            onClick={() => onSelectSlide(song._id, index, slide.text)}
          />
        );
      })}
    </div>
  );
});

interface SlideCardProps {
  slide: {
    text: string;
    label?: string;
    modifier?: string;
  };
  index: number;
  isActive: boolean;
  isSelected: boolean;
  onClick: () => void;
}

const SlideCard = memo(function SlideCard({
  slide,
  index,
  isActive,
  isSelected,
  onClick,
}: SlideCardProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "group relative flex h-36 flex-col overflow-hidden rounded-lg border text-left transition",
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
          className="text-sm leading-relaxed text-white"
          minScale={0.5}
        />
      </div>

      {/* Label bar */}
      <div
        className={cn(
          "flex shrink-0 items-center justify-between px-3 py-1.5 text-xs font-medium",
          getLabelColor(slide.label)
        )}
      >
        {formatSlideLabel(index, slide.label, slide.modifier)}
      </div>
    </button>
  );
});
