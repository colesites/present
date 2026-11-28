import type { BibleVerse } from "./db";
import type { CanvasSizePreset, SlideElement } from "../../../shared/types";
import { readingWords } from "./listening";
import { autoFitFor, splitVerse, type ScriptureOverflow, type WidthOf } from "./overflow";

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
  /** The verse's number in its chapter, for following a reading slide by slide. */
  verse?: number;
  /**
   * One slide of a verse split over several (`splitScriptureSlide`): which,
   * of how many, and the verse's words before it — as the Bible agent counts
   * them (`readingWords`), to know which slide the reader is on.
   */
  part?: { index: number; count: number; fromWord: number };
}

export const getScriptureSlideId = (verse: BibleVerse): string =>
  `scripture:${verse.pk}`;

/** The id of the `index`th slide of a verse split over several: the first keeps the verse's own. */
export const scripturePartId = (id: string, index: number): string =>
  index === 0 ? id : `${id}~${index + 1}`;

export const getActiveScriptureVersePk = (
  activeSlideId: string | null | undefined,
): string | null => {
  if (!activeSlideId?.startsWith("scripture:")) return null;
  const value = activeSlideId.slice("scripture:".length).replace(/~\d+$/, "");
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
      verse: verse.verse,
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

/** A verse slide's words without the number in front of them ("16. "). */
const withoutVerseNumber = (content: string) => content.replace(/^\d+\.\s+/, "");

/**
 * A verse slide as `overflow` says a long verse is shown: its verse box told
 * how to size its words (`autoFit`), and split over as many slides as it
 * needs (`splitVerse`), each with the reference and which of them it is.
 *
 * `widthOf` measures words in the verse box's font, as the audience window
 * does. A slide with no verse box is left as it is.
 */
export function splitScriptureSlide(
  slide: ScriptureSlide,
  overflow: ScriptureOverflow,
  widthOf: (text: string, fontSize: number, font: { family: string; weight: string }) => number,
): ScriptureSlide[] {
  const elements = slide.elements ?? [];
  const verseIndex = elements.findIndex(
    (element) => isTextElement(element) && element.contentRole === "scriptureVerse",
  );
  const verseElement = elements[verseIndex];
  if (!verseElement) return [slide];
  const autoFit = autoFitFor(overflow.mode);
  const sized = elements.map((element) =>
    element.contentRole === "scriptureVerse" ? { ...element, autoFit } : element,
  );

  const style = verseElement.style ?? {};
  const box = {
    width: Math.max(1, verseElement.width - (style.paddingLeft ?? 0) - (style.paddingRight ?? 0)),
    height: Math.max(1, verseElement.height - (style.paddingTop ?? 0) - (style.paddingBottom ?? 0)),
    lineHeight:
      typeof style.lineHeight === "number" && style.lineHeight >= 0.5 && style.lineHeight <= 4
        ? style.lineHeight
        : 1.2,
  };
  const font = {
    family: style.fontFamily ?? "Inter",
    weight: String(style.fontWeight ?? (style.fontBold ? "bold" : "400")),
  };
  const measure: WidthOf = (text, fontSize) => widthOf(text, fontSize, font);
  const { parts } = splitVerse(slide.content, style.fontSize ?? 72, overflow, box, measure);
  if (parts.length <= 1) return [{ ...slide, elements: sized }];

  const id = slide.id ?? slide.label;
  let fromWord = 0;
  return parts.map((content, index) => {
    const count = parts.length;
    const footer = slide.footer ? `${slide.footer} · ${index + 1}/${count}` : `${index + 1}/${count}`;
    const part: ScriptureSlide = {
      ...slide,
      id: scripturePartId(id, index),
      content,
      label: `${slide.label} (${index + 1}/${count})`,
      footer,
      part: { index, count, fromWord },
    };
    fromWord += readingWords(index === 0 ? withoutVerseNumber(content) : content).length;
    return { ...part, elements: syncScriptureElementContent(sized, part) };
  });
}

/**
 * The slide of `verse` among `slides` that holds its `word`th word (0 is its
 * first): the verse's own, or the part of it split over several.
 */
export function scriptureSlideAt(
  slides: ScriptureSlide[],
  verse: number,
  word: number,
): ScriptureSlide | null {
  let found: ScriptureSlide | null = null;
  for (const slide of slides) {
    if (slide.verse !== verse) continue;
    if (!found || (slide.part?.fromWord ?? 0) <= word) found = slide;
  }
  return found;
}

/**
 * The slides of verses split over several put back as one slide each, as
 * they were made: to be split again another way.
 */
export function joinScriptureParts(slides: ScriptureSlide[]): ScriptureSlide[] {
  const joined: ScriptureSlide[] = [];
  for (const slide of slides) {
    const part = slide.part;
    if (!part) {
      joined.push(slide);
      continue;
    }
    const mark = ` · ${part.index + 1}/${part.count}`;
    const footer = slide.footer.endsWith(mark)
      ? slide.footer.slice(0, -mark.length)
      : slide.footer.replace(new RegExp(`^${part.index + 1}/${part.count}$`), "");
    const label = slide.label.replace(/ \(\d+\/\d+\)$/, "");
    const previous = joined.at(-1);
    if (part.index > 0 && previous && previous.verse === slide.verse && previous.label === label) {
      previous.content = `${previous.content} ${slide.content}`;
      previous.elements = syncScriptureElementContent(previous.elements, previous);
      continue;
    }
    const { part: _part, ...rest } = slide;
    const whole: ScriptureSlide = {
      ...rest,
      id: slide.id?.replace(/~\d+$/, ""),
      label,
      footer,
    };
    whole.elements = syncScriptureElementContent(whole.elements, whole);
    joined.push(whole);
  }
  return joined;
}
