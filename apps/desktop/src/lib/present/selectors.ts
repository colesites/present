import type { SlideData } from "../../features/slides";

export function getSlidesForGrid(
  selectedSong: SlideData["song"] | null | undefined
): SlideData[] {
  if (!selectedSong) return [];

  return selectedSong.slides.map((slide, index) => ({
    song: selectedSong,
    slide,
    index,
  }));
}

export function getActiveSlideText(
  activeSlideId: string | null | undefined,
  songs: SlideData["song"][]
): string | null {
  if (!activeSlideId || songs.length === 0) return null;

  const [songId, indexStr] = activeSlideId.split(":");
  const index = Number(indexStr);

  if (!Number.isFinite(index)) return null;

  const song = songs.find((s) => s && String(s._id) === songId);
  return song?.slides[index]?.text ?? null;
}

/**
 * Groups slides by label (unchanged logic)
 */
export function getSlideGroups(
  selectedSong: SlideData["song"] | null | undefined
): { label: string; count: number }[] {
  if (!selectedSong) return [];

  const groups: { label: string; count: number }[] = [];
  let currentLabel = "";

  for (const slide of selectedSong.slides) {
    const label = slide.label || "Untitled";

    if (label !== currentLabel) {
      groups.push({ label, count: 1 });
      currentLabel = label;
    } else {
      groups.at(-1)!.count += 1;
    }
  }

  return groups;
}
