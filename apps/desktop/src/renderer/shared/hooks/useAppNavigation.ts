import { useEffect } from "react";
import type { BottomTab } from "../../../shared/types";
import type { SlideData } from "../../../features/slides";

interface UseAppNavigationProps {
  viewMode: string;
  bottomTab: BottomTab;
  selectedLibraryId: string | null;
  selected: { libraryId: string | null; index: number } | null;
  slidesForGrid: SlideData[];
  handleSelectSlide: (slideId: string, text: string, footer?: string) => Promise<void>;
}

export function useAppNavigation({
  viewMode,
  bottomTab,
  selectedLibraryId,
  selected,
  slidesForGrid,
  handleSelectSlide,
}: UseAppNavigationProps) {
  useEffect(() => {
    const isEditableTarget = (eventTarget: EventTarget | null) => {
      if (!(eventTarget instanceof HTMLElement)) {
        return false;
      }

      const tagName = eventTarget.tagName.toLowerCase();
      if (
        tagName === "input" ||
        tagName === "textarea" ||
        tagName === "select"
      ) {
        return true;
      }

      return eventTarget.isContentEditable || Boolean(eventTarget.closest("[contenteditable='true']"));
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (isEditableTarget(e.target)) {
        return;
      }

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
        bottomTab !== "shows" &&
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
          const slideId =
            nextSlide.id ??
            (nextSlide.libraryItem
              ? `${nextSlide.libraryItem._id}:${nextSlide.index}`
              : `scripture:${nextSlide.index}`);
          handleSelectSlide(
            slideId,
            nextSlide.slide.text,
            nextSlide.slide.footer,
          );
        } else if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
          e.preventDefault();
          const prevIndex = Math.max(currentIndex - 1, 0);
          const prevSlide = slidesForGrid[prevIndex];
          const slideId =
            prevSlide.id ??
            (prevSlide.libraryItem
              ? `${prevSlide.libraryItem._id}:${prevSlide.index}`
              : `scripture:${prevSlide.index}`);
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
    bottomTab,
    selectedLibraryId,
    selected,
    slidesForGrid,
    handleSelectSlide,
  ]);
}
