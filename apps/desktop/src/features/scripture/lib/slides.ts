import type { BibleVerse } from "./db";
import type { CanvasSizePreset, SlideElement } from "../../../shared/types";

export interface SlideConfig {
  maxLines: number;
  maxCharsPerLine: number;
  verseNumberMode: "inline" | "superscript" | "none";
  versionName?: string;
}

export interface ScriptureSlide {
  id?: string;
  content: string;
  label: string;
  footer: string;
  elements?: SlideElement[];
  canvasSize?: CanvasSizePreset;
  backgroundColor?: string | null;
  useBackgroundColor?: boolean;
}

export const getScriptureSlideId = (verse: BibleVerse): string =>
  `scripture:${verse.pk}`;

export const getActiveScriptureVersePk = (
  activeSlideId: string | null | undefined,
): string | null => {
  if (!activeSlideId?.startsWith("scripture:")) return null;
  const value = activeSlideId.slice("scripture:".length);
  return value.includes("|") ? value : null;
};

export function generateBibleSlides(
  verses: BibleVerse[],
  config: SlideConfig,
): ScriptureSlide[] {
  return verses.map((verse) => {
    const versePrefix =
      config.verseNumberMode === "none" ? "" : `${verse.verse}. `;

    const versionStr = config.versionName
      ? config.versionName
      : verse.version
        ? verse.version.toUpperCase()
        : "";

    return {
      id: getScriptureSlideId(verse),
      content: `${versePrefix}${verse.text}`,
      label:
        `${verse.bookName} ${verse.chapter}:${verse.verse} ${versionStr ? `(${versionStr})` : ""}`
          .trim()
          .replace(/\s+/g, " "),
      footer:
        `${verse.bookName} ${verse.chapter}:${verse.verse} ${versionStr ? `(${versionStr})` : ""}`
          .trim()
          .replace(/\s+/g, " "),
    };
  });
}

function getScriptureSlideKey(slide: ScriptureSlide) {
  return `${slide.label}::${slide.footer}::${slide.content}`;
}

function isTextElement(element: SlideElement) {
  return element.type === "text" && !element.isPlaceholder;
}

function syncScriptureElementContent(
  elements: SlideElement[] | undefined,
  slide: ScriptureSlide,
) {
  if (!elements || elements.length === 0) {
    return elements;
  }

  let verseIndex = -1;
  let footerIndex = -1;

  elements.forEach((element, index) => {
    if (!isTextElement(element)) {
      return;
    }

    if (element.contentRole === "scriptureVerse" && verseIndex < 0) {
      verseIndex = index;
      return;
    }

    if (element.contentRole === "scriptureFooter" && footerIndex < 0) {
      footerIndex = index;
    }
  });

  if (verseIndex < 0) {
    verseIndex = elements.findIndex((element) => isTextElement(element));
  }

  if (footerIndex < 0 && verseIndex >= 0) {
    footerIndex = elements.findIndex(
      (element, index) => index !== verseIndex && isTextElement(element),
    );
  }

  if (verseIndex < 0 && footerIndex < 0) {
    return elements;
  }

  return elements.map((element, index) => {
    if (index === verseIndex && element.type === "text") {
      return element.content === slide.content
        ? element
        : {
            ...element,
            content: slide.content,
          };
    }

    if (index === footerIndex && element.type === "text") {
      const nextFooter = slide.footer ?? "";
      return element.content === nextFooter
        ? element
        : {
            ...element,
            content: nextFooter,
          };
    }

    return element;
  });
}

export function mergeScriptureSlides(
  previousSlides: ScriptureSlide[],
  nextSlides: ScriptureSlide[],
): ScriptureSlide[] {
  const previousByKey = new Map(
    previousSlides.map((slide) => [getScriptureSlideKey(slide), slide]),
  );

  return nextSlides.map((slide, index) => {
    const previous =
      previousByKey.get(getScriptureSlideKey(slide)) ?? previousSlides[index];

    if (!previous) {
      return {
        ...slide,
        id: slide.id ?? `scripture:${index}`,
      };
    }

    const mergedElements =
      slide.elements && slide.elements.length > 0
        ? slide.elements
        : previous.elements;

    return {
      ...slide,
      id: slide.id ?? previous.id ?? `scripture:${index}`,
      elements: syncScriptureElementContent(mergedElements, slide),
      canvasSize: slide.canvasSize ?? previous.canvasSize,
      backgroundColor:
        slide.backgroundColor !== undefined
          ? slide.backgroundColor
          : previous.backgroundColor,
      useBackgroundColor:
        slide.useBackgroundColor !== undefined
          ? slide.useBackgroundColor
          : previous.useBackgroundColor,
    };
  });
}
