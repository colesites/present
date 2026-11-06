/**
 * A deck's slides in the editor: copies, moving them, and backgrounds.
 *
 * No imports but types, so the tests can load this file on its own.
 */
import type { LibrarySlide, SlideElement } from "../../../shared/types";

/**
 * A picture behind a slide's objects: chosen in the inspector, or the page
 * a PDF or "PowerPoint as Images" import made of each slide.
 */
export const PICTURE_BACKGROUND_ID = "__picture-bg";

/** Pages imported before they were backgrounds: `pdf_page_3_image`, `pptx_slide_3_image`. */
const LEGACY_PAGE = /^(pdf_page|pptx_slide)_\d+_image$/;

/** Whether an object is the slide's picture background. */
export const isPictureBackground = (element: SlideElement) =>
  element.id === PICTURE_BACKGROUND_ID || LEGACY_PAGE.test(element.id);

/** Objects a slide keeps under a fixed id: its theme's and its picture background. */
const FIXED_IDS = ["__theme-bg", "__theme-band", PICTURE_BACKGROUND_ID];
const isFixed = (id: string) => FIXED_IDS.some((fixed) => id.endsWith(fixed));

/**
 * A copy of a slide with ids of its own: the slide's, each object's and each
 * group's, so the copy and the original never share one.
 */
export function copySlide(slide: LibrarySlide, newId: string): LibrarySlide {
  const copy: LibrarySlide = JSON.parse(JSON.stringify(slide));
  copy.id = newId;
  const groups = new Map<string, string>();
  const oldId = slide.id ?? "";
  copy.elements = (copy.elements ?? []).map((element: SlideElement, index: number) => {
    const id = isFixed(element.id)
      ? element.id
      : oldId && element.id.startsWith(oldId)
        ? `${newId}${element.id.slice(oldId.length)}`
        : `${newId}_${element.type}_${index}`;
    const next: SlideElement = { ...element, id };
    if (element.groupId) {
      if (!groups.has(element.groupId)) groups.set(element.groupId, `${newId}_group_${groups.size + 1}`);
      next.groupId = groups.get(element.groupId);
    }
    return next;
  });
  return copy;
}

/** The slides with others put in after one of them (or at the end). */
export function insertSlidesAfter(slides: LibrarySlide[], afterId: string | null, added: LibrarySlide[]): LibrarySlide[] {
  const index = afterId ? slides.findIndex((slide) => slide.id === afterId) : -1;
  const at = index >= 0 ? index + 1 : slides.length;
  return [...slides.slice(0, at), ...added, ...slides.slice(at)];
}

/** A slide moved one place up (-1) or down (1); the same list at either end. */
export function moveSlide(slides: LibrarySlide[], id: string, by: -1 | 1): LibrarySlide[] {
  const from = slides.findIndex((slide) => slide.id === id);
  const to = from + by;
  if (from < 0 || to < 0 || to >= slides.length) return slides;
  const next = [...slides];
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved);
  return next;
}

/** The slide's picture background, if it has one. */
export function pictureBackgroundOf(slide: LibrarySlide | null): SlideElement | null {
  return slide?.elements?.find(isPictureBackground) ?? null;
}

/**
 * The slide with a picture filling it behind everything, or none. It is an
 * ordinary locked picture, first in the layers, so every renderer draws it.
 */
export function withPictureBackground(
  slide: LibrarySlide,
  url: string | null,
  canvas: { width: number; height: number },
): LibrarySlide {
  const rest = (slide.elements ?? []).filter((element) => !isPictureBackground(element));
  if (!url) return { ...slide, elements: rest };
  const picture: SlideElement = {
    id: PICTURE_BACKGROUND_ID,
    type: "image",
    x: 0,
    y: 0,
    width: canvas.width,
    height: canvas.height,
    content: url,
    isLocked: true,
    style: { objectFit: "cover", opacity: 1, borderRadius: 0 },
  };
  return { ...slide, elements: [picture, ...rest] };
}

/** What makes up a slide's background: its colour, media, and the objects behind. */
const isBackgroundElement = (element: SlideElement) =>
  isPictureBackground(element) || element.id.endsWith("__theme-bg");

/** `target` with `source`'s background, its own objects kept on top. */
export function withBackgroundOf(target: LibrarySlide, source: LibrarySlide): LibrarySlide {
  const behind = (source.elements ?? []).filter(isBackgroundElement).map((element) => ({ ...element }));
  const own = (target.elements ?? []).filter((element) => !isBackgroundElement(element));
  const next: LibrarySlide = {
    ...target,
    backgroundColor: source.backgroundColor,
    useBackgroundColor: source.useBackgroundColor,
    elements: [...behind, ...own],
  };
  if (source.backgroundId) next.backgroundId = source.backgroundId;
  else delete next.backgroundId;
  return next;
}
