import { useEffect } from "react";
import type { LibraryItem } from "../../../shared/types";
import type { SlideData } from "../../../features/slides";

interface UseAppNavigationProps {
  viewMode: string;
  selectedLibraryItem: LibraryItem | null;
  selectedLibraryId: string | null;
  selected: { libraryId: string | null; index: number } | null;
  slidesForGrid: SlideData[];
  handleSelectSlide: (slideId: string, text: string, footer?: string) => Promise<void>;
  scriptureSlidesCount: number;
}

export function useAppNavigation({
  viewMode,
  selectedLibraryItem,
  selectedLibraryId,
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
        selectedLibraryId
      ) {
        e.preventDefault();
        return;
      }

      // Arrow navigation in show mode
      if (
        viewMode === "show" &&
        (selectedLibraryItem || scriptureSlidesCount > 0) &&
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
          const slideId = nextSlide.libraryItem
            ? `${nextSlide.libraryItem._id}:${nextSlide.index}`
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
          const slideId = prevSlide.libraryItem
            ? `${prevSlide.libraryItem._id}:${prevSlide.index}`
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
    selectedLibraryItem,
    selectedLibraryId,
    selected,
    slidesForGrid,
    handleSelectSlide,
    scriptureSlidesCount,
  ]);
}
