"use client";

import type {
  CanvasSizePreset,
  LibraryItem,
  LibraryItemDraft,
  SlideElement,
} from "../../../shared/types";
import type {
  ScriptureFooterPosition,
  ScriptureTextAlign,
  ScriptureVerticalAlign,
} from "../../../shared/types/output-window";
import {
  DEFAULT_CANVAS_SIZE,
  getCanvasSizeDimensions,
  normalizeLibrarySlide,
  slidesToBody,
} from "../../library/lib/library-items";
import type { ScriptureSlide } from "./slides";

type ScriptureEditorDefaults = {
  canvasSize?: CanvasSizePreset;
  fontFamily: string;
  fontSize: number;
  fontWeight: string;
  textAlign: ScriptureTextAlign;
  verticalAlign: ScriptureVerticalAlign;
  footerAlign: ScriptureTextAlign;
  footerPosition: ScriptureFooterPosition;
};

const SCRIPTURE_EDITOR_LIBRARY_ID = "scripture-editor";

function hashString(value: string) {
  let hash = 0;

  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) | 0;
  }

  return Math.abs(hash) || 1;
}

function resolveScriptureSlideId(slide: ScriptureSlide, index: number) {
  return slide.id ?? `scripture:${index}`;
}

function createScriptureTextElements(
  slide: ScriptureSlide,
  index: number,
  defaults: ScriptureEditorDefaults,
) {
  if ((slide.elements?.length ?? 0) > 0) {
    return slide.elements ?? [];
  }

  const canvasSize = slide.canvasSize ?? defaults.canvasSize ?? DEFAULT_CANVAS_SIZE;
  const { width, height } = getCanvasSizeDimensions(canvasSize);
  const slideId = resolveScriptureSlideId(slide, index);
  const footerHeight = Math.max(72, Math.round(height * 0.11));
  const footerWidth = Math.round(width * 0.78);
  const footerMargin = Math.round(height * 0.06);
  const footerY =
    defaults.footerPosition === "top"
      ? footerMargin
      : height - footerHeight - footerMargin;
  const verseX = Math.round(width * 0.05);
  const verseY =
    defaults.footerPosition === "top"
      ? footerY + footerHeight + Math.round(height * 0.04)
      : Math.round(height * 0.08);
  const verseWidth = Math.round(width * 0.9);
  const verseBottomPadding =
    defaults.footerPosition === "bottom"
      ? footerHeight + footerMargin + Math.round(height * 0.04)
      : Math.round(height * 0.1);
  const verseHeight = Math.max(
    Math.round(height * 0.48),
    height - verseY - verseBottomPadding,
  );

  const verseElement: SlideElement = {
    id: `${slideId}_verse`,
    type: "text",
    contentRole: "scriptureVerse",
    x: verseX,
    y: verseY,
    width: verseWidth,
    height: verseHeight,
    content: slide.content,
    style: {
      fontFamily: defaults.fontFamily,
      fontSize: defaults.fontSize,
      fontWeight: defaults.fontWeight,
      textAlign: defaults.textAlign,
      verticalAlign: defaults.verticalAlign,
      color: "#ffffff",
    },
  };

  const footerElement: SlideElement = {
    id: `${slideId}_footer`,
    type: "text",
    contentRole: "scriptureFooter",
    x: Math.round((width - footerWidth) / 2),
    y: footerY,
    width: footerWidth,
    height: footerHeight,
    content: slide.footer,
    style: {
      fontFamily: defaults.fontFamily,
      fontSize: Math.max(28, Math.round(defaults.fontSize * 0.28)),
      fontWeight: defaults.fontWeight,
      textAlign: defaults.footerAlign,
      verticalAlign: "middle",
      color: "#ffffff",
    },
  };

  return [verseElement, footerElement];
}

function getScriptureTextElements(elements: SlideElement[] | undefined | null) {
  return (elements ?? []).filter(
    (element) => element.type === "text" && !element.isPlaceholder,
  );
}

function getVerseElement(elements: SlideElement[] | undefined | null) {
  const textElements = getScriptureTextElements(elements);

  return (
    textElements.find((element) => element.contentRole === "scriptureVerse") ??
    textElements[0] ??
    null
  );
}

function getFooterElement(elements: SlideElement[] | undefined | null) {
  const textElements = getScriptureTextElements(elements);
  const verseElement = getVerseElement(elements);

  return (
    textElements.find((element) => element.contentRole === "scriptureFooter") ??
    textElements.find((element) => element.id !== verseElement?.id) ??
    null
  );
}

export function buildScriptureEditorLibraryItem(
  slides: ScriptureSlide[],
  defaults: ScriptureEditorDefaults,
): LibraryItem | null {
  if (slides.length === 0) {
    return null;
  }

  const normalizedSlides = slides.map((slide, index) => {
    const slideId = resolveScriptureSlideId(slide, index);
    const canvasSize = slide.canvasSize ?? defaults.canvasSize ?? DEFAULT_CANVAS_SIZE;

    return normalizeLibrarySlide(
      {
        id: slideId,
        text: slide.content,
        label: slide.label,
        backgroundColor: slide.backgroundColor ?? undefined,
        useBackgroundColor: slide.useBackgroundColor ?? false,
        elements: createScriptureTextElements(
          { ...slide, id: slideId },
          index,
          { ...defaults, canvasSize },
        ),
      },
      canvasSize,
    );
  });

  const revision = hashString(
    JSON.stringify(
      slides.map((slide) => ({
        id: slide.id,
        label: slide.label,
        content: slide.content,
        footer: slide.footer,
        canvasSize: slide.canvasSize,
        backgroundColor: slide.backgroundColor,
        useBackgroundColor: slide.useBackgroundColor,
        elements: slide.elements,
      })),
    ),
  );

  return {
    _id: SCRIPTURE_EDITOR_LIBRARY_ID,
    _creationTime: 0,
    orgId: SCRIPTURE_EDITOR_LIBRARY_ID,
    userId: undefined,
    categoryId: undefined,
    type: "scripture",
    content: {
      presentation: {
        canvasSize: defaults.canvasSize ?? DEFAULT_CANVAS_SIZE,
        backgroundColor: "#2c211b",
        useBackgroundColor: false,
      },
      editorView: "slides",
    },
    title: "Scripture",
    body: slidesToBody(normalizedSlides),
    slides: normalizedSlides,
    createdAt: 0,
    updatedAt: revision,
    version: revision,
    deleted: false,
  };
}

export function scriptureDraftToSlides(
  draft: LibraryItemDraft,
  previousSlides: ScriptureSlide[],
): ScriptureSlide[] {
  const canvasSize =
    draft.content?.presentation?.canvasSize ?? DEFAULT_CANVAS_SIZE;

  return draft.slides.map((slide, index) => {
    const previousSlide = previousSlides[index];
    const elements = slide.elements ?? [];
    const verseElement = getVerseElement(elements);
    const footerElement = getFooterElement(elements);

    return {
      id: slide.id ?? previousSlide?.id ?? `scripture:${index}`,
      label:
        slide.label?.trim() ||
        previousSlide?.label ||
        `Scripture ${index + 1}`,
      content: verseElement?.content ?? slide.text ?? previousSlide?.content ?? "",
      footer: footerElement?.content ?? previousSlide?.footer ?? "",
      elements,
      canvasSize,
      backgroundColor:
        slide.useBackgroundColor ? slide.backgroundColor ?? null : null,
      useBackgroundColor: slide.useBackgroundColor ?? false,
    };
  });
}
