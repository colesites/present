import { useEffect } from "react";
import type { Id } from "@present/backend/convex/_generated/dataModel";
import type { SlideData } from "../features/slides";

interface UseAppNavigationProps {
  viewMode: string;
  selectedSong: { _id: Id<"songs">; title: string; lyrics: string } | null;
  selectedSongId: Id<"songs"> | null;
  selected: { songId: Id<"songs"> | null; index: number } | null;
  slidesForGrid: SlideData[];
  handleSelectSlide: (slideId: string, text: string, footer?: string) => Promise<void>;
  scriptureSlidesCount: number;
}

export function useAppNavigation({
  viewMode,
  selectedSong,
  selectedSongId,
  selected,
  slidesForGrid,
  handleSelectSlide,
  scriptureSlidesCount,
}: UseAppNavigationProps) {
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Cmd+S is handled by LyricsEditor component, but we prevent default here if needed
      if (
        (e.metaKey || e.ctrlKey) &&
        e.key === "s" &&
        viewMode === "edit" &&
        selectedSongId
      ) {
        e.preventDefault();
        return;
      }

      // Arrow navigation in show mode
      if (
        viewMode === "show" &&
        (selectedSong || scriptureSlidesCount > 0) &&
        slidesForGrid.length > 0
      ) {
        const currentIndex = selected?.index ?? 0;
        if (e.key === "ArrowRight" || e.key === "ArrowDown") {
          e.preventDefault();
          const nextIndex = Math.min(
            currentIndex + 1,
            slidesForGrid.length - 1,
          );
          const nextSlide = slidesForGrid[nextIndex];
          const slideId = nextSlide.song
            ? `${nextSlide.song._id}:${nextSlide.index}`
            : `scripture:${nextSlide.index}`;
          handleSelectSlide(
            slideId,
            nextSlide.slide.text,
            nextSlide.slide.footer,
          );
        } else if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
          e.preventDefault();
          const prevIndex = Math.max(currentIndex - 1, 0);
          const prevSlide = slidesForGrid[prevIndex];
          const slideId = prevSlide.song
            ? `${prevSlide.song._id}:${prevSlide.index}`
            : `scripture:${prevSlide.index}`;
          handleSelectSlide(
            slideId,
            prevSlide.slide.text,
            prevSlide.slide.footer,
          );
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [
    viewMode,
    selectedSong,
    selectedSongId,
    selected,
    slidesForGrid,
    handleSelectSlide,
    scriptureSlidesCount,
  ]);
}
