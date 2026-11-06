import { useCallback, useEffect, useRef } from "react";
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
  const goTo = useCallback(
    (index: number) => {
      const slide = slidesForGrid[index];
      if (!slide) return;
      const slideId =
        slide.id ??
        (slide.libraryItem
          ? `${slide.libraryItem._id}:${slide.index}`
          : `scripture:${slide.index}`);
      void handleSelectSlide(slideId, slide.slide.text, slide.slide.footer);
    },
    [handleSelectSlide, slidesForGrid],
  );

  // A slide that moves on by itself (a deck's "After 5 seconds"), in Show.
  const liveIndex = selected?.index ?? -1;
  const advanceAfterMs =
    viewMode === "show" && liveIndex >= 0
      ? (slidesForGrid[liveIndex]?.slide as { advanceAfterMs?: number } | undefined)?.advanceAfterMs
      : undefined;
  // The timer restarts only when the live slide or its delay changes: this
  // component renders many times a second while a video plays.
  const goToRef = useRef(goTo);
  const slidesRef = useRef(slidesForGrid);
  useEffect(() => {
    goToRef.current = goTo;
    slidesRef.current = slidesForGrid;
  });
  const liveSlideKey = liveIndex >= 0 ? (slidesForGrid[liveIndex]?.id ?? `index:${liveIndex}`) : null;
  useEffect(() => {
    if (!advanceAfterMs || advanceAfterMs <= 0 || liveSlideKey === null) return;
    const timer = window.setTimeout(() => {
      const next = stepFrom(slidesRef.current, liveIndex, 1);
      if (next !== liveIndex) goToRef.current(next);
    }, advanceAfterMs);
    return () => window.clearTimeout(timer);
  }, [advanceAfterMs, liveIndex, liveSlideKey]);

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

      // Arrow navigation in show mode: hidden slides are passed over.
      if (
        viewMode === "show" &&
        bottomTab !== "shows" &&
        slidesForGrid.length > 0
      ) {
        const currentIndex = selected?.index ?? 0;
        const forward = e.key === "ArrowRight" || e.key === "ArrowDown";
        const back = e.key === "ArrowLeft" || e.key === "ArrowUp";
        if (!forward && !back) return;
        e.preventDefault();
        const here = () => goTo(stepFrom(slidesForGrid, currentIndex, forward ? 1 : -1));
        if (!selectedLibraryId) {
          here();
          return;
        }
        // A deck: the core steps through its builds and past hidden slides,
        // as for a pedal, and the window follows (`PresentContainer`).
        void import("../../tauri/presentation")
          .then((core) => (forward ? core.nextSlide() : core.previousSlide()))
          .catch(here);
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
    goTo,
  ]);
}

const isHidden = (entry: SlideData | undefined) =>
  Boolean((entry?.slide as { hidden?: boolean } | undefined)?.hidden);

/**
 * The slide `by` steps from `from` (1 next, -1 previous), passing over
 * hidden ones; `from` itself when there is none to go to.
 */
export function stepFrom(slides: SlideData[], from: number, by: 1 | -1): number {
  let index = from + by;
  while (index >= 0 && index < slides.length && isHidden(slides[index])) {
    index += by;
  }
  return index >= 0 && index < slides.length ? index : from;
}
