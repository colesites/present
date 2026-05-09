"use client";

import type {
  CanvasSizePreset,
  LibrarySlide,
  SlideElement,
} from "../../../shared/types";
import type { ScriptureSlide } from "./slides";
import type { ScriptureLayoutTemplate } from "./layout-template-state";

function isTextElement(element: SlideElement) {
  return element.type === "text" && !element.isPlaceholder;
}

function syncTemplateElements(
  templateElements: SlideElement[],
  slide: Pick<ScriptureSlide, "content" | "footer">,
) {
  let verseIndex = -1;
  let footerIndex = -1;

  templateElements.forEach((element, index) => {
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
    verseIndex = templateElements.findIndex((element) => isTextElement(element));
  }

  if (footerIndex < 0 && verseIndex >= 0) {
    footerIndex = templateElements.findIndex(
      (element, index) => index !== verseIndex && isTextElement(element),
    );
  }

  return templateElements.map((element, index) => {
    if (index === verseIndex && element.type === "text") {
      return {
        ...element,
        content: slide.content,
      };
    }

    if (index === footerIndex && element.type === "text") {
      return {
        ...element,
        content: slide.footer ?? "",
      };
    }

    return element;
  });
}

export function applyScriptureLayoutTemplate(
  slide: ScriptureSlide,
  template: ScriptureLayoutTemplate | null,
): ScriptureSlide {
  if (!template || template.elements.length === 0) {
    return slide;
  }

  return {
    ...slide,
    elements: syncTemplateElements(template.elements, slide),
    canvasSize: slide.canvasSize ?? template.canvasSize,
    backgroundColor:
      slide.backgroundColor !== undefined
        ? slide.backgroundColor
        : template.backgroundColor,
    useBackgroundColor:
      slide.useBackgroundColor !== undefined
        ? slide.useBackgroundColor
        : template.useBackgroundColor,
  };
}

export function createScriptureLayoutTemplate(input: {
  slide: Pick<LibrarySlide, "elements" | "backgroundColor" | "useBackgroundColor"> | null;
  canvasSize?: CanvasSizePreset | null;
}): ScriptureLayoutTemplate | null {
  const elements = input.slide?.elements ?? [];
  const canvasSize = input.canvasSize ?? "1920x1080";

  if (elements.length === 0) {
    return null;
  }

  return {
    elements,
    canvasSize,
    backgroundColor: input.slide?.backgroundColor ?? null,
    useBackgroundColor: Boolean(input.slide?.useBackgroundColor),
  };
}
