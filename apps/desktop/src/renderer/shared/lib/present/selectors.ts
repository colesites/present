import type { LibraryItem } from "../../../../shared/types";
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
  if (!activeSlideId || libraryItems.length === 0) return null;

  const [idPart, indexStr] = activeSlideId.split(":");
  const index = Number(indexStr);

  if (!Number.isFinite(index)) return null;

  const item = libraryItems.find((s) => s && String(s._id) === idPart);
  return item?.slides[index]?.text ?? null;
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
