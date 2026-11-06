import { useCallback } from "react";
import type { LibrarySlide } from "../../../shared/types";
import { copySlide, insertSlidesAfter, moveSlide, withBackgroundOf } from "../lib/slides";

export type SlideCommand =
  | "duplicate"
  | "copy"
  | "cut"
  | "paste"
  | "delete"
  | "moveUp"
  | "moveDown"
  | "previous"
  | "next"
  | "backgroundToAll";

/** Slides copied in this window, to paste into any deck or song open here. */
let slideClipboard: LibrarySlide[] = [];

export const hasCopiedSlides = () => slideClipboard.length > 0;

const newSlideId = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `slide_${Math.random().toString(36).slice(2)}_${Date.now().toString(36)}`;

/**
 * What can be done to a slide in the list: duplicate, copy, cut, paste
 * after it, delete, move it up or down, pick the one before or after, and
 * give every slide its background. Each change is one step to undo.
 */
export function useSlideCommands({
  slides,
  setSlides,
  selectSlide,
  removeSlide,
}: {
  slides: LibrarySlide[];
  setSlides: (updater: (slides: LibrarySlide[]) => LibrarySlide[]) => void;
  selectSlide: (id: string | null) => void;
  removeSlide: (id: string) => void;
}) {
  return useCallback(
    (command: SlideCommand, slideId: string | null): boolean => {
      const index = slides.findIndex((slide) => slide.id === slideId);
      const slide = index >= 0 ? slides[index] : null;
      switch (command) {
        case "paste": {
          if (slideClipboard.length === 0) return false;
          const copies = slideClipboard.map((each) => copySlide(each, newSlideId()));
          setSlides((current) => insertSlidesAfter(current, slideId, copies));
          selectSlide(copies[0]?.id ?? null);
          return true;
        }
        case "previous":
        case "next": {
          const target = slides[index + (command === "next" ? 1 : -1)];
          if (!target?.id) return false;
          selectSlide(target.id);
          return true;
        }
        default:
          break;
      }
      if (!slide?.id) return false;
      const id = slide.id;
      switch (command) {
        case "duplicate": {
          const copy = copySlide(slide, newSlideId());
          setSlides((current) => insertSlidesAfter(current, id, [copy]));
          selectSlide(copy.id ?? null);
          return true;
        }
        case "copy":
          slideClipboard = [JSON.parse(JSON.stringify(slide))];
          return true;
        case "cut":
          slideClipboard = [JSON.parse(JSON.stringify(slide))];
          removeSlide(id);
          return true;
        case "delete":
          removeSlide(id);
          return true;
        case "moveUp":
        case "moveDown":
          setSlides((current) => moveSlide(current, id, command === "moveUp" ? -1 : 1));
          return true;
        case "backgroundToAll":
          setSlides((current) => current.map((each) => (each.id === id ? each : withBackgroundOf(each, slide))));
          return true;
      }
      return false;
    },
    [removeSlide, selectSlide, setSlides, slides],
  );
}
