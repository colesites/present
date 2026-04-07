"use client";

import { memo, type CSSProperties } from "react";
import { AutoFitText } from "./AutoFitText";
import { applyCapitalization } from "../lib/capitalization";
import { stripBracketsForDisplay } from "../lib/lyrics";
import { plainTextToHtml } from "../lib/rich-text";
import { cn } from "../lib/utils";
import type {
  CanvasSizePreset,
  SlideElement,
  SlideElementStyle,
} from "../../../shared/types";
import type { LibraryStyle } from "../../../shared/types/output-window";

const DEFAULT_CANVAS_SIZE: CanvasSizePreset = "1920x1080";

const CANVAS_DIMENSIONS: Record<CanvasSizePreset, { width: number; height: number }> =
  {
    "1920x1080": { width: 1920, height: 1080 },
    "1280x720": { width: 1280, height: 720 },
    "1024x768": { width: 1024, height: 768 },
    "800x600": { width: 800, height: 600 },
  };

interface LibrarySlideLayerProps {
  text: string | null;
  elements?: SlideElement[] | null;
  canvasSize?: CanvasSizePreset | null;
  libraryStyle: LibraryStyle;
  className?: string;
  textClassName?: string;
  minScale?: number;
  fontSizeScale?: number;
  fitScale?: number;
}

function resolveCanvasSize(value?: CanvasSizePreset | null): CanvasSizePreset {
  if (value && value in CANVAS_DIMENSIONS) {
    return value;
  }

  return DEFAULT_CANVAS_SIZE;
}

function resolveTextDecoration(
  style: SlideElementStyle | undefined,
  libraryStyle: LibraryStyle,
) {
  const tokens = new Set<string>();

  for (const token of style?.textDecoration?.split(" ") ?? []) {
    const trimmed = token.trim();
    if (trimmed && trimmed !== "none") {
      tokens.add(trimmed);
    }
  }

  if (style?.fontUnderline ?? libraryStyle.fontUnderline) {
    tokens.add("underline");
  }

  return tokens.size > 0 ? Array.from(tokens).join(" ") : "none";
}

function resolveFontWeight(
  style: SlideElementStyle | undefined,
  libraryStyle: LibraryStyle,
) {
  if (style?.fontWeight) {
    return style.fontWeight;
  }

  return style?.fontBold ?? libraryStyle.fontBold ? "bold" : "normal";
}

function resolveFontStyle(
  style: SlideElementStyle | undefined,
  libraryStyle: LibraryStyle,
) {
  if (style?.fontStyle) {
    return style.fontStyle;
  }

  return libraryStyle.fontItalic ? "italic" : "normal";
}

function resolveHorizontalAlign(
  value: SlideElementStyle["textAlign"],
): "left" | "center" | "right" {
  if (value === "left" || value === "justify") {
    return "left";
  }

  if (value === "right") {
    return "right";
  }

  return "center";
}

function resolveVerticalAlign(
  value: SlideElementStyle["verticalAlign"],
): "top" | "center" | "bottom" {
  if (value === "top") {
    return "top";
  }

  if (value === "bottom") {
    return "bottom";
  }

  return "center";
}

function resolveFlexJustifyContent(
  value: SlideElementStyle["verticalAlign"],
): "flex-start" | "center" | "flex-end" {
  if (value === "top") {
    return "flex-start";
  }

  if (value === "bottom") {
    return "flex-end";
  }

  return "center";
}

function resolveTextPaintStyle(style: SlideElementStyle): CSSProperties {
  if (
    style.textFillMode === "gradient" &&
    style.gradientFromColor &&
    style.gradientToColor
  ) {
    const angle = Number.isFinite(style.gradientAngle)
      ? style.gradientAngle
      : 315;

    return {
      backgroundImage: `linear-gradient(${angle}deg, ${style.gradientFromColor}, ${style.gradientToColor})`,
      backgroundClip: "text",
      WebkitBackgroundClip: "text",
      color: "transparent",
      WebkitTextFillColor: "transparent",
    };
  }

  return {
    color: style.color ?? "#ffffff",
  };
}

export const LibrarySlideLayer = memo(function LibrarySlideLayer({
  text,
  elements,
  canvasSize,
  libraryStyle,
  className,
  textClassName,
  minScale = 0.25,
  fontSizeScale = 1,
  fitScale = 1,
}: LibrarySlideLayerProps) {
  const { width, height } = CANVAS_DIMENSIONS[resolveCanvasSize(canvasSize)];
  const scaledFontSizeMultiplier =
    Number.isFinite(fontSizeScale) && fontSizeScale > 0 ? fontSizeScale : 1;
  const visibleElements = (elements ?? []).filter(
    (element) => element.isVisible !== false,
  );

  if (visibleElements.length === 0) {
    if (!text) {
      return null;
    }

    return (
      <div className={cn("absolute inset-0 z-10 p-[4%]", className)}>
        <AutoFitText
          text={stripBracketsForDisplay(text)}
          className={cn(
            "pointer-events-none select-none leading-relaxed text-white drop-shadow-[0_4px_8px_rgba(0,0,0,0.8)]",
            libraryStyle.fontBold && "font-bold",
            libraryStyle.fontItalic && "italic",
            textClassName,
          )}
          style={{
            fontFamily: libraryStyle.fontFamily,
            textDecoration: libraryStyle.fontUnderline ? "underline" : "none",
          }}
          align="center"
          verticalAlign="center"
          maxFontSize={libraryStyle.fontSize * scaledFontSizeMultiplier}
          minScale={minScale}
          fitScale={fitScale}
        />
      </div>
    );
  }

  return (
    <div className={cn("absolute inset-0 z-10", className)}>
      {visibleElements.map((element) => {
        const style = element.style ?? {};
        const isPlaceholderText =
          element.type === "text" &&
          element.isPlaceholder &&
          element.content.trim().length === 0;

        if (isPlaceholderText) {
          return null;
        }

        const frameStyle: CSSProperties = {
          left: `${(element.x / width) * 100}%`,
          top: `${(element.y / height) * 100}%`,
          width: `${(element.width / width) * 100}%`,
          height: `${(element.height / height) * 100}%`,
          opacity: style.opacity ?? 1,
          transform: `rotate(${style.rotation ?? 0}deg) scaleX(${style.flipX ? -1 : 1}) scaleY(${style.flipY ? -1 : 1})`,
          transformOrigin: "center",
        };

        if (element.type === "shape") {
          return (
            <div
              key={element.id}
              className="absolute"
              style={frameStyle}
            >
              <div
                className="h-full w-full"
                style={{
                  backgroundColor: style.backgroundColor ?? "transparent",
                  border: `${style.borderWidth ?? 0}px solid ${style.borderColor ?? "transparent"}`,
                  borderRadius: `${style.borderRadius ?? 0}px`,
                }}
              />
            </div>
          );
        }

        if (element.type === "image") {
          if (!element.content.trim()) {
            return null;
          }

          return (
            <div
              key={element.id}
              className="absolute overflow-hidden"
              style={{
                ...frameStyle,
                borderRadius: `${style.borderRadius ?? 0}px`,
              }}
            >
              <img
                src={element.content}
                alt=""
                draggable={false}
                className="h-full w-full select-none"
                style={{ objectFit: style.objectFit ?? "cover" }}
              />
            </div>
          );
        }

        if (element.type === "web") {
          if (!element.content.trim()) {
            return null;
          }

          return (
            <div
              key={element.id}
              className="absolute overflow-hidden"
              style={{
                ...frameStyle,
                backgroundColor: style.backgroundColor ?? "#ffffff",
                borderRadius: `${style.borderRadius ?? 0}px`,
              }}
            >
              <iframe
                title={element.id}
                srcDoc={element.content}
                sandbox="allow-same-origin"
                className="h-full w-full border-0 bg-white pointer-events-none"
              />
            </div>
          );
        }

        if (element.type !== "text") {
          return null;
        }

        const hasExplicitTextPadding =
          style.paddingTop !== undefined ||
          style.paddingRight !== undefined ||
          style.paddingBottom !== undefined ||
          style.paddingLeft !== undefined;
        const textFramePaddingStyle: CSSProperties = hasExplicitTextPadding
          ? {
              paddingTop: `${style.paddingTop ?? 0}px`,
              paddingRight: `${style.paddingRight ?? 0}px`,
              paddingBottom: `${style.paddingBottom ?? 0}px`,
              paddingLeft: `${style.paddingLeft ?? 0}px`,
            }
          : {
              padding: "3% 4%",
            };
        const shouldClipTextContent = !hasExplicitTextPadding;

        return (
          <div
            key={element.id}
            className="absolute overflow-hidden"
            style={frameStyle}
          >
            <div className="h-full w-full" style={textFramePaddingStyle}>
              {element.contentRole === "scriptureVerse" ||
              element.contentRole === "scriptureFooter" ? (
                <AutoFitText
                  text={applyCapitalization(
                    stripBracketsForDisplay(element.content),
                    style.capitalization,
                  )}
                  className={cn(
                    "pointer-events-none select-none whitespace-pre-line leading-[1.2] text-white drop-shadow-[0_4px_8px_rgba(0,0,0,0.8)]",
                    textClassName,
                  )}
                  style={{
                    fontFamily: style.fontFamily ?? libraryStyle.fontFamily,
                    ...resolveTextPaintStyle(style),
                    fontWeight: resolveFontWeight(style, libraryStyle),
                    fontStyle: resolveFontStyle(style, libraryStyle),
                    textDecoration: resolveTextDecoration(style, libraryStyle),
                    textAlign: style.textAlign ?? "center",
                  }}
                  align={resolveHorizontalAlign(style.textAlign)}
                  verticalAlign={resolveVerticalAlign(style.verticalAlign)}
                  maxFontSize={
                    (style.fontSize ?? libraryStyle.fontSize) *
                    scaledFontSizeMultiplier
                  }
                  minScale={minScale}
                  fitScale={fitScale}
                />
              ) : (
                <div
                  className={cn(
                    "flex h-full w-full flex-col",
                    shouldClipTextContent && "overflow-hidden",
                  )}
                  style={{
                    justifyContent: resolveFlexJustifyContent(style.verticalAlign),
                  }}
                >
                  <div
                    className={cn(
                      "pointer-events-none w-full select-none whitespace-pre-wrap break-words leading-[1.2] text-white drop-shadow-[0_4px_8px_rgba(0,0,0,0.8)]",
                      shouldClipTextContent && "overflow-hidden",
                      textClassName,
                    )}
                    style={{
                      fontFamily: style.fontFamily ?? libraryStyle.fontFamily,
                      ...resolveTextPaintStyle(style),
                      fontWeight: resolveFontWeight(style, libraryStyle),
                      fontStyle: resolveFontStyle(style, libraryStyle),
                      textDecoration: resolveTextDecoration(style, libraryStyle),
                      textAlign: style.textAlign ?? "center",
                      fontSize: `${
                        (style.fontSize ?? libraryStyle.fontSize) *
                        scaledFontSizeMultiplier
                      }px`,
                    }}
                    dangerouslySetInnerHTML={{
                      __html:
                        element.richTextHtml?.trim() ||
                        plainTextToHtml(
                          applyCapitalization(
                            stripBracketsForDisplay(element.content),
                            style.capitalization,
                          ),
                        ),
                    }}
                  />
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
});
