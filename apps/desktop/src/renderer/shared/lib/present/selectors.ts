import type { LibraryItem, LibrarySlide } from "../../../../shared/types";
import type { SlideData } from "../../../../features/slides";

export function getSlidesForGrid(
  selectedLibraryItem: LibraryItem | null | undefined,
): SlideData[] {
  if (!selectedLibraryItem) return [];

  return selectedLibraryItem.slides.map((slide, index) => ({
    libraryItem: selectedLibraryItem,
    slide,
    index,
  }));
}

export function getActiveSlideText(
  activeSlideId: string | null | undefined,
  libraryItems: (LibraryItem | null | undefined)[],
): string | null {
  return getActiveLibrarySlide(activeSlideId, libraryItems)?.slide.text ?? null;
}

export function getActiveLibrarySlide(
  activeSlideId: string | null | undefined,
  libraryItems: (LibraryItem | null | undefined)[],
): { item: LibraryItem; slide: LibrarySlide; index: number } | null {
  if (!activeSlideId || libraryItems.length === 0) return null;

  const separatorIndex = activeSlideId.indexOf(":");
  if (separatorIndex <= 0) {
    return null;
  }

  const idPart = activeSlideId.slice(0, separatorIndex);
  const slideToken = activeSlideId.slice(separatorIndex + 1);
  const parsedIndex = Number(slideToken);

  const item = libraryItems.find((s) => s && String(s._id) === idPart);
  if (!item) {
    return null;
  }

  const matchedSlideIndex = item.slides.findIndex((slide) => slide.id === slideToken);
  const slideIndex =
    matchedSlideIndex >= 0
      ? matchedSlideIndex
      : Number.isFinite(parsedIndex)
        ? parsedIndex
        : -1;

  const slide = item.slides[slideIndex];
  if (!item || !slide) {
    return null;
  }

  return {
    item,
    slide,
    index: slideIndex,
  };
}

/**
 * Groups slides by label (unchanged logic)
 */
export function getSlideGroups(
  selectedLibraryItem: LibraryItem | null | undefined,
): { label: string; count: number }[] {
  if (!selectedLibraryItem) return [];

  const groups: { label: string; count: number }[] = [];
  let currentLabel = "";

  for (const slide of selectedLibraryItem.slides) {
    const label = slide.label || "Untitled";

    if (label !== currentLabel) {
      groups.push({ label, count: 1 });
      currentLabel = label;
    } else {
      const lastGroup = groups[groups.length - 1];
      if (lastGroup) {
        lastGroup.count += 1;
      }
    }
  }

  return groups;
}
