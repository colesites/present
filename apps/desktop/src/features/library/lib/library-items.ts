"use client";

import { parseLyricsToSlides } from "../../../renderer/shared/lib/lyrics";
import type {
  CanvasSizePreset,
  LibraryContent,
  LibraryItem,
  LibraryItemDraft,
  LibraryPresentationSettings,
  LibrarySlide,
  SlideElement,
} from "../../../shared/types";

export const DEFAULT_SLIDE_LABEL_OPTIONS = [
  "Instrumental",
  "Spoken Word",
  "Verse 1",
  "Verse 2",
  "Verse 3",
  "Chorus",
  "Bridge",
  "Tag",
  "Outro",
] as const;

export const DEFAULT_CANVAS_SIZE: CanvasSizePreset = "1920x1080";
const DEFAULT_LIBRARY_TEXT_FONT_SIZE = 80;

export const CANVAS_SIZE_DIMENSIONS: Record<
  CanvasSizePreset,
  { width: number; height: number }
> = {
  "1920x1080": { width: 1920, height: 1080 },
  "1280x720": { width: 1280, height: 720 },
  "1024x768": { width: 1024, height: 768 },
  "800x600": { width: 800, height: 600 },
};

const DEFAULT_PRESENTATION: LibraryPresentationSettings = {
  artist: "",
  author: "",
  canvasSize: DEFAULT_CANVAS_SIZE,
  backgroundColor: "#2c211b",
  useBackgroundColor: false,
};

const createSlideId = () => {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `slide_${Math.random().toString(36).slice(2)}_${Date.now().toString(36)}`;
};

const cleanOptionalText = (value: string | null | undefined) => {
  const nextValue = value?.trim() ?? "";
  return nextValue.length > 0 ? nextValue : undefined;
};

export type LibraryTextStyleDefaults = {
  fontFamily?: string;
  fontSize?: number;
  fontWeight?: string;
};

function normalizeLibraryTextDefaults(defaults?: LibraryTextStyleDefaults) {
  const fontSize = Number.isFinite(defaults?.fontSize)
    ? Math.min(Math.max(Math.round(defaults?.fontSize ?? DEFAULT_LIBRARY_TEXT_FONT_SIZE), 8), 400)
    : DEFAULT_LIBRARY_TEXT_FONT_SIZE;
  const fontFamily = cleanOptionalText(defaults?.fontFamily ?? "");
  const fontWeight = cleanOptionalText(defaults?.fontWeight ?? "");

  return {
    fontFamily,
    fontSize,
    fontWeight,
  };
}

export function normalizeCanvasSizePreset(
  canvasSize: CanvasSizePreset | null | undefined,
): CanvasSizePreset {
  if (canvasSize && canvasSize in CANVAS_SIZE_DIMENSIONS) {
    return canvasSize;
  }

  return DEFAULT_CANVAS_SIZE;
}

export function getCanvasSizeDimensions(canvasSize?: CanvasSizePreset | null) {
  const preset = normalizeCanvasSizePreset(canvasSize);
  const dimensions = CANVAS_SIZE_DIMENSIONS[preset];

  return {
    preset,
    width: dimensions.width,
    height: dimensions.height,
    aspectRatio: dimensions.width / dimensions.height,
  };
}

function createDefaultTextElement(
  slideId: string,
  text: string,
  canvasSize: CanvasSizePreset,
  textDefaults?: LibraryTextStyleDefaults,
): SlideElement {
  const { width, height } = getCanvasSizeDimensions(canvasSize);
  const normalizedDefaults = normalizeLibraryTextDefaults(textDefaults);

  return {
    id: `${slideId}_text_0`,
    type: "text",
    x: 0,
    y: 0,
    width,
    height,
    content: text,
    style: {
      textAlign: "center",
      verticalAlign: "middle",
      fontFamily: normalizedDefaults.fontFamily,
      fontWeight: normalizedDefaults.fontWeight,
      fontSize: normalizedDefaults.fontSize,
    },
  };
}

const scaleValue = (value: number, multiplier: number) =>
  Number((value * multiplier).toFixed(2));

function reorderItems<T>(
  items: T[],
  fromIndex: number,
  toIndex: number,
): T[] {
  if (
    fromIndex < 0 ||
    toIndex < 0 ||
    fromIndex >= items.length ||
    toIndex >= items.length ||
    fromIndex === toIndex
  ) {
    return items;
  }

  const nextItems = [...items];
  const [movedItem] = nextItems.splice(fromIndex, 1);
  if (movedItem === undefined) {
    return items;
  }
  nextItems.splice(toIndex, 0, movedItem);
  return nextItems;
}

export function normalizeLibrarySlide(
  slide: Partial<LibrarySlide> & Pick<LibrarySlide, "text">,
  canvasSize: CanvasSizePreset = DEFAULT_CANVAS_SIZE,
  textDefaults?: LibraryTextStyleDefaults,
): LibrarySlide {
  const slideId = slide.id ?? createSlideId();
  const text = slide.text ?? "";
  const normalizedCanvasSize = normalizeCanvasSizePreset(canvasSize);
  
  // If no elements exist, create a default text element from the legacy 'text' field
  const elements: SlideElement[] =
    slide.elements ??
    (text.trim().length > 0
      ? [
          createDefaultTextElement(
            slideId,
            text,
            normalizedCanvasSize,
            textDefaults,
          ),
        ]
      : []);

  return {
    id: slideId,
    text,
    elements,
    label: cleanOptionalText(slide.label),
    labelColor: cleanOptionalText(slide.labelColor),
    modifier: cleanOptionalText(slide.modifier),
    backgroundId: cleanOptionalText(slide.backgroundId),
    backgroundColor: cleanOptionalText(slide.backgroundColor),
    useBackgroundColor: Boolean(slide.useBackgroundColor),
  };
}

export function normalizePresentationSettings(
  value: LibraryPresentationSettings | undefined,
): LibraryPresentationSettings {
  const canvasSize = normalizeCanvasSizePreset(value?.canvasSize);

  return {
    artist: cleanOptionalText(value?.artist) ?? "",
    author: cleanOptionalText(value?.author) ?? "",
    canvasSize,
    backgroundColor:
      cleanOptionalText(value?.backgroundColor) ??
      DEFAULT_PRESENTATION.backgroundColor,
    useBackgroundColor:
      value?.useBackgroundColor ?? DEFAULT_PRESENTATION.useBackgroundColor,
  };
}

export function scaleSlideToCanvas(
  slide: LibrarySlide,
  fromCanvasSize: CanvasSizePreset | null | undefined,
  toCanvasSize: CanvasSizePreset | null | undefined,
): LibrarySlide {
  const fromDimensions = getCanvasSizeDimensions(fromCanvasSize);
  const toDimensions = getCanvasSizeDimensions(toCanvasSize);

  if (fromDimensions.preset === toDimensions.preset) {
    return slide;
  }

  const scaleX = toDimensions.width / fromDimensions.width;
  const scaleY = toDimensions.height / fromDimensions.height;

  return {
    ...slide,
    elements: (slide.elements ?? []).map((element) => ({
      ...element,
      x: scaleValue(element.x, scaleX),
      y: scaleValue(element.y, scaleY),
      width: scaleValue(element.width, scaleX),
      height: scaleValue(element.height, scaleY),
    })),
  };
}

export function scaleSlidesToCanvas(
  slides: LibrarySlide[],
  fromCanvasSize: CanvasSizePreset | null | undefined,
  toCanvasSize: CanvasSizePreset | null | undefined,
): LibrarySlide[] {
  return slides.map((slide) =>
    scaleSlideToCanvas(slide, fromCanvasSize, toCanvasSize),
  );
}

export function getLibraryLabelOptions(
  content: LibraryContent | undefined,
  slides: LibrarySlide[],
): string[] {
  const values = new Set<string>(DEFAULT_SLIDE_LABEL_OPTIONS);

  for (const option of content?.slideLabelOptions ?? []) {
    const cleanOption = cleanOptionalText(option);
    if (cleanOption) {
      values.add(cleanOption);
    }
  }

  for (const slide of slides) {
    const cleanLabel = cleanOptionalText(slide.label);
    if (cleanLabel) {
      values.add(cleanLabel);
    }
  }

  return Array.from(values);
}

export function normalizeLibraryContent(
  content: LibraryContent | undefined,
  slides: LibrarySlide[],
): LibraryContent {
  return {
    presentation: normalizePresentationSettings(content?.presentation),
    slideLabelOptions: getLibraryLabelOptions(content, slides),
    composition: content?.composition,
    editorView: content?.editorView === "source" ? "source" : "slides",
  };
}

export function buildSlidesFromBody(
  body: string,
  canvasSize: CanvasSizePreset = DEFAULT_CANVAS_SIZE,
  textDefaults?: LibraryTextStyleDefaults,
): LibrarySlide[] {
  return parseLyricsToSlides(body).map((slide) =>
    normalizeLibrarySlide(slide, canvasSize, textDefaults),
  );
}

export function slidesToBody(slides: LibrarySlide[]): string {
  const blocks = slides.map((slide) => {
    const lines: string[] = [];
    const label = cleanOptionalText(slide.label);
    const modifier = cleanOptionalText(slide.modifier);

    // Always emit label WITHOUT modifier in the bracket header.
    // Modifiers are per-slide inline annotations and must stay in the text.
    if (label) {
      lines.push(`[${label}]`);
    }

    const primaryTextElement =
      slide.elements?.find(
        (element) =>
          element.type === "text" &&
          !element.isPlaceholder &&
          element.contentRole === "scriptureVerse",
      ) ??
      slide.elements?.find(
        (element) => element.type === "text" && !element.isPlaceholder,
      );
    let slideText = (primaryTextElement?.content ?? slide.text).trim();

    // Append modifier as inline bracket at the end of the first line
    // so round-tripping through parseLyricsToSlides preserves it correctly.
    if (modifier && !slideText.includes(`[${modifier}]`)) {
      const textLines = slideText.split("\n");
      textLines[0] = `${textLines[0]} [${modifier}]`;
      slideText = textLines.join("\n");
    }

    lines.push(slideText);
    return lines.join("\n").trim();
  });

  return blocks.filter(Boolean).join("\n\n");
}

export function normalizeLibraryItem(
  item: LibraryItem,
  textDefaults?: LibraryTextStyleDefaults,
): LibraryItem {
  const content = normalizeLibraryContent(item.content, item.slides ?? []);
  const canvasSize = content.presentation?.canvasSize ?? DEFAULT_CANVAS_SIZE;
  const hasStoredSlides = Array.isArray(item.slides) && item.slides.length > 0;
  let baseSlides = hasStoredSlides
    ? item.slides
    : buildSlidesFromBody(item.body ?? "", canvasSize, textDefaults);

  // Always re-derive labels and modifiers from body text.
  // This fixes legacy data where modifiers were incorrectly accumulated
  // across slides (e.g. slide 2 got "3x x2" instead of just "x2").
  const bodyText = item.body?.trim() ?? "";
  if (bodyText && hasStoredSlides) {
    const freshParsed = parseLyricsToSlides(bodyText);
    if (freshParsed.length === baseSlides.length) {
      baseSlides = baseSlides.map((slide, i) => ({
        ...slide,
        label: freshParsed[i]?.label ?? slide.label,
        modifier: freshParsed[i]?.modifier,
      }));
    }
  }

  const slides = baseSlides.map((slide) =>
    normalizeLibrarySlide(slide, canvasSize, textDefaults),
  );
  const body = typeof item.body === "string" && item.body.trim().length > 0
    ? item.body
    : slidesToBody(slides);

  return {
    ...item,
    body,
    slides,
    content: normalizeLibraryContent(item.content, slides),
  };
}

export function createDraftFromLibraryItem(
  item: LibraryItem,
  textDefaults?: LibraryTextStyleDefaults,
): LibraryItemDraft {
  const normalized = normalizeLibraryItem(item, textDefaults);
  return {
    title: normalized.title,
    body: normalized.body,
    slides: normalized.slides,
    content: normalized.content,
  };
}

export function createDraftFromBody(
  title: string,
  body: string,
  content?: LibraryContent,
  textDefaults?: LibraryTextStyleDefaults,
): LibraryItemDraft {
  const normalizedContent = normalizeLibraryContent(content, []);
  const slides = buildSlidesFromBody(
    body,
    normalizedContent.presentation?.canvasSize ?? DEFAULT_CANVAS_SIZE,
    textDefaults,
  );
  return {
    title,
    body,
    slides,
    content: normalizeLibraryContent(content, slides),
  };
}

export function reorderLibrarySlides(
  slides: LibrarySlide[],
  fromIndex: number,
  toIndex: number,
): LibrarySlide[] {
  return reorderItems(slides, fromIndex, toIndex);
}

export function reorderSlideElements(
  elements: SlideElement[],
  fromIndex: number,
  toIndex: number,
): SlideElement[] {
  return reorderItems(elements, fromIndex, toIndex);
}

export function getSlideBackgroundColor(
  slide: LibrarySlide | undefined,
  content: LibraryContent | undefined,
): string | null {
  if (slide?.useBackgroundColor && slide.backgroundColor) {
    return slide.backgroundColor;
  }

  if (content?.presentation?.useBackgroundColor && content.presentation.backgroundColor) {
    return content.presentation.backgroundColor;
  }

  return null;
}

export function createComposedLibraryDraft(
  title: string,
  sourceItems: LibraryItem[],
  textDefaults?: LibraryTextStyleDefaults,
): LibraryItemDraft {
  const normalizedItems = sourceItems.map((item) =>
    normalizeLibraryItem(item, textDefaults),
  );
  const slides = normalizedItems.flatMap((item) =>
    item.slides.map((slide) =>
      normalizeLibrarySlide({
        ...slide,
        id: undefined,
      }, DEFAULT_CANVAS_SIZE, textDefaults),
    ),
  );

  return {
    title,
    body: slidesToBody(slides),
    slides,
    content: normalizeLibraryContent(
      {
        composition: {
          sourceItems: normalizedItems.map((item) => ({
            libraryId: String(item._id),
            title: item.title,
            slideCount: item.slides.length,
          })),
          createdAt: Date.now(),
        },
      },
      slides,
    ),
  };
}
