"use client";

import { memo } from "react";

import type { LibraryContent, LibrarySlide } from "../../../shared/types";
import { CanvasSlideLayer } from "../../../renderer/shared/components/CanvasSlideLayer";
import { getSlideBackgroundColor } from "../../library/lib/library-items";
import { cn } from "../../../renderer/shared/lib/utils";

const PREVIEW_STYLE = {
  fontFamily: "inherit",
  fontSize: 80,
  fontBold: false,
  fontItalic: false,
  fontUnderline: false,
};

/**
 * One slide of a Media deck, drawn as the slides grid draws a presentation's:
 * its background and its elements on the deck's canvas. Fills its box.
 */
export const MediaSlidePreview = memo(function MediaSlidePreview({
  slide,
  content,
  className,
}: {
  slide: LibrarySlide;
  content?: LibraryContent;
  className?: string;
}) {
  return (
    <div
      className={cn("relative h-full w-full overflow-hidden", className)}
      style={{ backgroundColor: getSlideBackgroundColor(slide, content) ?? "#000000" }}
    >
      <CanvasSlideLayer
        text={slide.text}
        elements={slide.elements}
        canvasSize={content?.presentation?.canvasSize}
        className="absolute inset-0"
        libraryStyle={PREVIEW_STYLE}
      />
    </div>
  );
});
