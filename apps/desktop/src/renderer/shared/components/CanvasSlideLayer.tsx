"use client";

import {
  memo,
  useCallback,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import type {
  CanvasSizePreset,
  SlideElement,
  SlideElementStyle,
  SlideTextBody,
} from "../../../shared/types";
import type { LibraryStyle } from "../../../shared/types/output-window";

const DEFAULT_CANVAS_SIZE: CanvasSizePreset = "1920x1080";
const CANVAS_DIMENSIONS: Record<
  CanvasSizePreset,
  { width: number; height: number }
> = {
  "1920x1080": { width: 1920, height: 1080 },
  "1280x720": { width: 1280, height: 720 },
  "1024x768": { width: 1024, height: 768 },
  "800x600": { width: 800, height: 600 },
};

type TextRun = {
  text: string;
  style: {
    fontFamily: string;
    fontSize: number;
    fontWeight: string;
    fontStyle: string;
    color: string;
    underline: boolean;
    textAlign: "left" | "center" | "right" | "justify";
    lineHeight: number;
    letterSpacing: number;
  };
};

type TextParagraph = {
  runs: TextRun[];
  textAlign: "left" | "center" | "right" | "justify";
  lineHeight: number;
  spaceBefore: number;
  spaceAfter: number;
};

type ParsedShadow = {
  offsetX: number;
  offsetY: number;
  blur: number;
  color: string;
};

interface CanvasSlideLayerProps {
  text: string | null;
  elements?: SlideElement[] | null;
  canvasSize?: CanvasSizePreset | null;
  libraryStyle: LibraryStyle;
  className?: string;
  style?: CSSProperties;
}

function resolveCanvasSize(value?: CanvasSizePreset | null): CanvasSizePreset {
  if (value && value in CANVAS_DIMENSIONS) {
    return value;
  }
  return DEFAULT_CANVAS_SIZE;
}

function resolveFontWeight(
  style: SlideElementStyle | undefined,
  libraryStyle: LibraryStyle
) {
  if (style?.fontWeight) return style.fontWeight;
  return (style?.fontBold ?? libraryStyle.fontBold) ? "700" : "400";
}

function resolveFontStyle(
  style: SlideElementStyle | undefined,
  libraryStyle: LibraryStyle
) {
  if (style?.fontStyle) return style.fontStyle;
  return libraryStyle.fontItalic ? "italic" : "normal";
}

function resolveTextAlign(
  style: SlideElementStyle | undefined
): "left" | "center" | "right" | "justify" {
  if (
    style?.textAlign === "left" ||
    style?.textAlign === "right" ||
    style?.textAlign === "justify"
  ) {
    return style.textAlign;
  }
  return "center";
}

function resolveVerticalAlign(
  style: SlideElementStyle | undefined
): "top" | "middle" | "bottom" {
  if (style?.verticalAlign === "top" || style?.verticalAlign === "bottom") {
    return style.verticalAlign;
  }
  return "middle";
}

function parseStructuredTextBody(
  textBody: SlideTextBody,
  defaultStyle: TextRun["style"]
): TextParagraph[] {
  const paragraphs = (textBody.paragraphs ?? []).map((paragraph) => {
    const paragraphAlign = paragraph.alignment ?? defaultStyle.textAlign;
    const paragraphLineHeight =
      paragraph.lineHeight !== undefined && paragraph.lineHeight > 0
        ? paragraph.lineHeight > 4
          ? paragraph.lineHeight
          : Math.max(1, defaultStyle.fontSize * paragraph.lineHeight)
        : defaultStyle.lineHeight;
    const runs = (paragraph.runs ?? []).map((run) => {
      const style: TextRun["style"] = {
        fontFamily: run.fontFamily ?? defaultStyle.fontFamily,
        fontSize: Math.max(1, run.fontSize ?? defaultStyle.fontSize),
        fontWeight: run.fontWeight ?? defaultStyle.fontWeight,
        fontStyle: run.fontStyle ?? defaultStyle.fontStyle,
        color: run.color ?? defaultStyle.color,
        underline: run.underline ?? defaultStyle.underline,
        textAlign: paragraphAlign,
        lineHeight: paragraphLineHeight,
        letterSpacing: run.letterSpacing ?? defaultStyle.letterSpacing,
      };
      return {
        text: run.text ?? "",
        style,
      };
    });

    return {
      runs: runs.length > 0 ? runs : [{ text: "", style: defaultStyle }],
      textAlign: paragraphAlign,
      lineHeight: paragraphLineHeight,
      spaceBefore: Math.max(0, paragraph.spaceBefore ?? 0),
      spaceAfter: Math.max(0, paragraph.spaceAfter ?? 0),
    };
  });

  return paragraphs.length > 0
    ? paragraphs
    : [
        {
          runs: [{ text: "", style: defaultStyle }],
          textAlign: defaultStyle.textAlign,
          lineHeight: defaultStyle.lineHeight,
          spaceBefore: 0,
          spaceAfter: 0,
        },
      ];
}

type MeasuredRun = {
  run: TextRun;
  width: number;
};

type MeasuredLine = {
  runs: MeasuredRun[];
  width: number;
  lineHeight: number;
};

function toCanvasFont(style: TextRun["style"]) {
  return `${style.fontStyle} ${style.fontWeight} ${Math.max(1, style.fontSize)}px "${style.fontFamily}"`;
}

function measureTextWidth(
  ctx: CanvasRenderingContext2D,
  text: string,
  style: TextRun["style"]
): number {
  ctx.font = toCanvasFont(style);
  const base = ctx.measureText(text).width;
  if (style.letterSpacing === 0 || text.length <= 1) {
    return base;
  }
  return base + (text.length - 1) * style.letterSpacing;
}

function splitToTokens(text: string): string[] {
  return text.split(/(\s+)/).filter((token) => token.length > 0);
}

function layoutParagraph(
  ctx: CanvasRenderingContext2D,
  paragraph: TextParagraph,
  maxWidth: number
): MeasuredLine[] {
  const lines: MeasuredLine[] = [];
  let current: MeasuredLine = {
    runs: [],
    width: 0,
    lineHeight: paragraph.lineHeight,
  };

  const pushLine = () => {
    lines.push(current);
    current = { runs: [], width: 0, lineHeight: paragraph.lineHeight };
  };

  for (const run of paragraph.runs) {
    const runParts = run.text.split("\n");
    runParts.forEach((part, partIndex) => {
      const tokens = splitToTokens(part);
      for (const token of tokens) {
        const tokenWidth = measureTextWidth(ctx, token, run.style);
        const nextWidth = current.width + tokenWidth;

        if (current.runs.length > 0 && nextWidth > maxWidth) {
          pushLine();
        }

        current.runs.push({ run: { ...run, text: token }, width: tokenWidth });
        current.width += tokenWidth;
        current.lineHeight = Math.max(
          current.lineHeight,
          run.style.lineHeight || run.style.fontSize * 1.2
        );
      }

      if (partIndex < runParts.length - 1) {
        pushLine();
      }
    });
  }

  lines.push(current);
  return lines;
}

function scaleParagraphs(paragraphs: TextParagraph[], scale: number): TextParagraph[] {
  if (Math.abs(scale - 1) < 0.001) {
    return paragraphs;
  }

  return paragraphs.map((paragraph) => ({
    ...paragraph,
    lineHeight: Math.max(1, paragraph.lineHeight * scale),
    spaceBefore: Math.max(0, paragraph.spaceBefore * scale),
    spaceAfter: Math.max(0, paragraph.spaceAfter * scale),
    runs: paragraph.runs.map((run) => ({
      ...run,
      style: {
        ...run.style,
        fontSize: Math.max(1, run.style.fontSize * scale),
        lineHeight: Math.max(1, run.style.lineHeight * scale),
        letterSpacing: run.style.letterSpacing * scale,
      },
    })),
  }));
}

function measureTextBlock(
  ctx: CanvasRenderingContext2D,
  paragraphs: TextParagraph[],
  maxWidth: number
) {
  const laidOut = paragraphs.map((paragraph) =>
    layoutParagraph(ctx, paragraph, maxWidth)
  );
  const paragraphHeights = laidOut.map((lines, paragraphIndex) => {
    const paragraph = paragraphs[paragraphIndex];
    return (
      (paragraph?.spaceBefore ?? 0) +
      lines.reduce((sum, line) => sum + line.lineHeight, 0) +
      (paragraph?.spaceAfter ?? 0)
    );
  });
  const totalHeight = paragraphHeights.reduce((sum, value) => sum + value, 0);
  const maxLineWidth = laidOut.reduce((outerMax, lines) => {
    const paragraphMax = lines.reduce(
      (innerMax, line) => Math.max(innerMax, line.width),
      0
    );
    return Math.max(outerMax, paragraphMax);
  }, 0);

  return {
    laidOut,
    totalHeight,
    maxLineWidth,
  };
}

function resolveScriptureAutoFitScale(
  ctx: CanvasRenderingContext2D,
  paragraphs: TextParagraph[],
  maxWidth: number,
  maxHeight: number,
  minScale = 0.3
) {
  const clampedMinScale = Math.max(0.1, Math.min(1, minScale));
  let low = clampedMinScale;
  let high = 1;
  let best = clampedMinScale;

  for (let index = 0; index < 9; index += 1) {
    const candidate = (low + high) / 2;
    const scaled = scaleParagraphs(paragraphs, candidate);
    const measurement = measureTextBlock(ctx, scaled, maxWidth);
    const fits =
      measurement.totalHeight <= maxHeight && measurement.maxLineWidth <= maxWidth;

    if (fits) {
      best = candidate;
      low = candidate;
    } else {
      high = candidate;
    }
  }

  return best;
}

function drawUnderlinedText(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  baselineY: number,
  style: TextRun["style"],
  measuredWidth: number
) {
  ctx.fillText(text, x, baselineY);
  if (!style.underline || !text.trim()) return;
  const underlineY = baselineY + Math.max(1, style.fontSize * 0.08);
  ctx.beginPath();
  ctx.lineWidth = Math.max(1, style.fontSize * 0.06);
  ctx.strokeStyle = style.color;
  ctx.moveTo(x, underlineY);
  ctx.lineTo(x + measuredWidth, underlineY);
  ctx.stroke();
}

function buildRoundedRectPath(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number
) {
  const clampedRadius = Math.max(0, Math.min(radius, width / 2, height / 2));
  if (clampedRadius <= 0) {
    ctx.rect(x, y, width, height);
    return;
  }
  ctx.moveTo(x + clampedRadius, y);
  ctx.lineTo(x + width - clampedRadius, y);
  ctx.quadraticCurveTo(x + width, y, x + width, y + clampedRadius);
  ctx.lineTo(x + width, y + height - clampedRadius);
  ctx.quadraticCurveTo(
    x + width,
    y + height,
    x + width - clampedRadius,
    y + height
  );
  ctx.lineTo(x + clampedRadius, y + height);
  ctx.quadraticCurveTo(x, y + height, x, y + height - clampedRadius);
  ctx.lineTo(x, y + clampedRadius);
  ctx.quadraticCurveTo(x, y, x + clampedRadius, y);
}

function parseShadow(shadowValue: string | undefined): ParsedShadow | null {
  if (!shadowValue || !shadowValue.trim()) return null;
  const sanitized = shadowValue
    .replace(/^drop-shadow\(/i, "")
    .replace(/\)$/g, "")
    .trim();

  const match = sanitized.match(
    /(-?\d+(?:\.\d+)?)px?\s+(-?\d+(?:\.\d+)?)px?(?:\s+(-?\d+(?:\.\d+)?)px?)?(?:\s+(.+))?/i
  );
  if (!match) return null;
  const offsetX = Number.parseFloat(match[1] ?? "0");
  const offsetY = Number.parseFloat(match[2] ?? "0");
  const blur = Number.parseFloat(match[3] ?? "0");
  const color = (match[4] ?? "rgba(0,0,0,0.35)").trim();
  if (!Number.isFinite(offsetX) || !Number.isFinite(offsetY) || !Number.isFinite(blur)) {
    return null;
  }
  return {
    offsetX,
    offsetY,
    blur: Math.max(0, blur),
    color,
  };
}

function applyShadow(
  ctx: CanvasRenderingContext2D,
  shadow: ParsedShadow | null,
  scaleX: number,
  scaleY: number
) {
  if (!shadow) {
    ctx.shadowColor = "rgba(0,0,0,0)";
    ctx.shadowBlur = 0;
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = 0;
    return;
  }
  ctx.shadowColor = shadow.color;
  ctx.shadowBlur = shadow.blur * Math.min(scaleX, scaleY);
  ctx.shadowOffsetX = shadow.offsetX * scaleX;
  ctx.shadowOffsetY = shadow.offsetY * scaleY;
}

function fitImageRect(
  image: HTMLImageElement,
  boxWidth: number,
  boxHeight: number,
  objectFit: "cover" | "contain" | "fill"
) {
  const imageWidth = Math.max(1, image.naturalWidth || image.width || 1);
  const imageHeight = Math.max(1, image.naturalHeight || image.height || 1);
  const imageRatio = imageWidth / imageHeight;
  const boxRatio = boxWidth / boxHeight;

  if (objectFit === "fill") {
    return {
      sx: 0,
      sy: 0,
      sw: imageWidth,
      sh: imageHeight,
      dx: 0,
      dy: 0,
      dw: boxWidth,
      dh: boxHeight,
    };
  }

  if (objectFit === "cover") {
    let sw = imageWidth;
    let sh = imageHeight;
    let sx = 0;
    let sy = 0;
    if (imageRatio > boxRatio) {
      sw = imageHeight * boxRatio;
      sx = (imageWidth - sw) / 2;
    } else if (imageRatio < boxRatio) {
      sh = imageWidth / boxRatio;
      sy = (imageHeight - sh) / 2;
    }
    return {
      sx,
      sy,
      sw,
      sh,
      dx: 0,
      dy: 0,
      dw: boxWidth,
      dh: boxHeight,
    };
  }

  const containScale = Math.min(boxWidth / imageWidth, boxHeight / imageHeight);
  const drawWidth = imageWidth * containScale;
  const drawHeight = imageHeight * containScale;
  return {
    sx: 0,
    sy: 0,
    sw: imageWidth,
    sh: imageHeight,
    dx: (boxWidth - drawWidth) / 2,
    dy: (boxHeight - drawHeight) / 2,
    dw: drawWidth,
    dh: drawHeight,
  };
}

function createTextGradient(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  styleData: SlideElementStyle
) {
  if (
    styleData.textFillMode !== "gradient" ||
    !styleData.gradientFromColor ||
    !styleData.gradientToColor
  ) {
    return null;
  }
  const angleDegrees = Number.isFinite(styleData.gradientAngle)
    ? styleData.gradientAngle ?? 315
    : 315;
  const angle = (angleDegrees * Math.PI) / 180;
  const cx = width / 2;
  const cy = height / 2;
  const radius = Math.max(width, height);
  const x1 = cx - Math.cos(angle) * radius;
  const y1 = cy - Math.sin(angle) * radius;
  const x2 = cx + Math.cos(angle) * radius;
  const y2 = cy + Math.sin(angle) * radius;
  const gradient = ctx.createLinearGradient(x1, y1, x2, y2);
  gradient.addColorStop(0, styleData.gradientFromColor);
  gradient.addColorStop(1, styleData.gradientToColor);
  return gradient;
}

export const CanvasSlideLayer = memo(function CanvasSlideLayer({
  text,
  elements,
  canvasSize,
  libraryStyle,
  className,
  style,
}: CanvasSlideLayerProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [containerSize, setContainerSize] = useState({ width: 0, height: 0 });
  const [imageTick, setImageTick] = useState(0);
  const imageCacheRef = useRef<Map<string, HTMLImageElement>>(new Map());

  const updateContainerSize = useCallback((width: number, height: number) => {
    const nextWidth = Math.max(0, Math.round(width));
    const nextHeight = Math.max(0, Math.round(height));
    setContainerSize((current) =>
      current.width === nextWidth && current.height === nextHeight
        ? current
        : { width: nextWidth, height: nextHeight },
    );
  }, []);

  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const measureContainer = () => {
      const { width, height } = container.getBoundingClientRect();
      updateContainerSize(width, height);
    };

    measureContainer();

    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      const { width, height } = entry.contentRect;
      updateContainerSize(width, height);
    });
    observer.observe(container);
    return () => observer.disconnect();
  }, [updateContainerSize]);

  const slideDimensions = useMemo(
    () => CANVAS_DIMENSIONS[resolveCanvasSize(canvasSize)],
    [canvasSize]
  );

  const visibleElements = useMemo(
    () => (elements ?? []).filter((element) => element.isVisible !== false),
    [elements]
  );

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const width = Math.round(containerSize.width);
    const height = Math.round(containerSize.height);

    if (width <= 0 || height <= 0) {
      if (canvas.width !== 0 || canvas.height !== 0) {
        canvas.width = 0;
        canvas.height = 0;
      }
      return;
    }

    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const dpr = window.devicePixelRatio || 1;
    const targetWidth = Math.max(1, Math.round(width * dpr));
    const targetHeight = Math.max(1, Math.round(height * dpr));

    if (canvas.width !== targetWidth || canvas.height !== targetHeight) {
      canvas.width = targetWidth;
      canvas.height = targetHeight;
    }

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);

    const scaleX = width / slideDimensions.width;
    const scaleY = height / slideDimensions.height;

    if (visibleElements.length === 0 && text?.trim()) {
      const styleFontSize = libraryStyle.fontSize * Math.min(scaleX, scaleY);
      ctx.fillStyle = "#ffffff";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.font = `400 ${Math.max(12, styleFontSize)}px "${libraryStyle.fontFamily}"`;
      ctx.fillText(text, width / 2, height / 2, width * 0.9);
      return;
    }

    for (const element of visibleElements) {
      const styleData = element.style ?? {};
      const x = element.x * scaleX;
      const y = element.y * scaleY;
      const w = element.width * scaleX;
      const h = element.height * scaleY;
      const opacity = styleData.opacity ?? 1;
      const borderRadius = (styleData.borderRadius ?? 0) * Math.min(scaleX, scaleY);
      const parsedShadow = parseShadow(styleData.shadow);

      ctx.save();
      ctx.globalAlpha = opacity;

      if (styleData.rotation || styleData.flipX || styleData.flipY) {
        ctx.translate(x + w / 2, y + h / 2);
        if (styleData.rotation) {
          ctx.rotate((styleData.rotation * Math.PI) / 180);
        }
        ctx.scale(styleData.flipX ? -1 : 1, styleData.flipY ? -1 : 1);
        ctx.translate(-w / 2, -h / 2);
      } else {
        ctx.translate(x, y);
      }

      if (borderRadius > 0 && element.type !== "shape") {
        ctx.beginPath();
        buildRoundedRectPath(ctx, 0, 0, w, h, borderRadius);
        ctx.clip();
      }

      if (element.type === "shape") {
        const borderWidth =
          (styleData.borderWidth ?? 0) * Math.min(scaleX, scaleY);
        applyShadow(ctx, parsedShadow, scaleX, scaleY);
        if (
          styleData.backgroundColor &&
          styleData.backgroundColor !== "transparent"
        ) {
          ctx.fillStyle = styleData.backgroundColor;
          ctx.beginPath();
          buildRoundedRectPath(ctx, 0, 0, w, h, borderRadius);
          ctx.fill();
        }
        applyShadow(ctx, null, scaleX, scaleY);
        if (borderWidth > 0 && styleData.borderColor) {
          ctx.strokeStyle = styleData.borderColor;
          ctx.lineWidth = borderWidth;
          ctx.beginPath();
          buildRoundedRectPath(
            ctx,
            borderWidth / 2,
            borderWidth / 2,
            w - borderWidth,
            h - borderWidth,
            Math.max(0, borderRadius - borderWidth / 2)
          );
          ctx.stroke();
        }
        ctx.restore();
        continue;
      }

      if (element.type === "image") {
        if (element.content) {
          const cached = imageCacheRef.current.get(element.content);
          if (cached && cached.complete) {
            applyShadow(ctx, parsedShadow, scaleX, scaleY);
            const fit = fitImageRect(
              cached,
              w,
              h,
              styleData.objectFit ?? "cover"
            );
            ctx.drawImage(
              cached,
              fit.sx,
              fit.sy,
              fit.sw,
              fit.sh,
              fit.dx,
              fit.dy,
              fit.dw,
              fit.dh
            );
            applyShadow(ctx, null, scaleX, scaleY);
          } else {
            const image = new Image();
            image.onload = () => setImageTick((value) => value + 1);
            image.src = element.content;
            imageCacheRef.current.set(element.content, image);
          }
        }
        ctx.restore();
        continue;
      }

      if (element.type === "text") {
        const paddingLeft = (styleData.paddingLeft ?? 0) * scaleX;
        const paddingRight = (styleData.paddingRight ?? 0) * scaleX;
        const paddingTop = (styleData.paddingTop ?? 0) * scaleY;
        const paddingBottom = (styleData.paddingBottom ?? 0) * scaleY;
        const contentX = paddingLeft;
        const contentY = paddingTop;
        const contentWidth = Math.max(1, w - paddingLeft - paddingRight);
        const contentHeight = Math.max(1, h - paddingTop - paddingBottom);

        const defaultStyle: TextRun["style"] = {
          fontFamily: styleData.fontFamily ?? libraryStyle.fontFamily,
          fontSize: Math.max(
            1,
            (styleData.fontSize ?? libraryStyle.fontSize) *
              Math.min(scaleX, scaleY)
          ),
          fontWeight: resolveFontWeight(styleData, libraryStyle),
          fontStyle: resolveFontStyle(styleData, libraryStyle),
          color: styleData.color ?? "#ffffff",
          underline: styleData.textDecoration?.includes("underline") ?? false,
          textAlign: resolveTextAlign(styleData),
          lineHeight: Math.max(
            1,
            (styleData.fontSize ?? libraryStyle.fontSize) *
              Math.min(scaleX, scaleY) *
              1.2
          ),
          letterSpacing: 0,
        };
        const gradientFill = createTextGradient(ctx, w, h, styleData);
        applyShadow(ctx, parsedShadow, scaleX, scaleY);

        const paragraphs = element.textBody
          ? parseStructuredTextBody(element.textBody, defaultStyle)
          : (element.content ?? "").split("\n").map((line) => ({
              runs: [{ text: line, style: defaultStyle }],
              textAlign: defaultStyle.textAlign,
              lineHeight: defaultStyle.lineHeight,
              spaceBefore: 0,
              spaceAfter: 0,
            }));

        const shouldAutoFitScriptureText =
          element.contentRole === "scriptureVerse" ||
          element.contentRole === "scriptureFooter";
        const scaledParagraphs = shouldAutoFitScriptureText
          ? scaleParagraphs(
              paragraphs,
              resolveScriptureAutoFitScale(
                ctx,
                paragraphs,
                contentWidth,
                contentHeight,
                0.3
              )
            )
          : paragraphs;

        const measurement = measureTextBlock(ctx, scaledParagraphs, contentWidth);
        const laidOut = measurement.laidOut;
        const totalTextHeight = measurement.totalHeight;

        const verticalAlign = resolveVerticalAlign(styleData);
        let cursorY = contentY;
        if (verticalAlign === "middle") {
          cursorY =
            contentY + Math.max(0, (contentHeight - totalTextHeight) / 2);
        } else if (verticalAlign === "bottom") {
          cursorY = contentY + Math.max(0, contentHeight - totalTextHeight);
        }

        scaledParagraphs.forEach((paragraph, paragraphIndex) => {
          const lines = laidOut[paragraphIndex] ?? [];
          cursorY += paragraph.spaceBefore;
          for (const line of lines) {
            if (cursorY > contentY + contentHeight) {
              break;
            }

            let lineStartX = contentX;
            const textAlign = paragraph.textAlign;
            if (textAlign === "center") {
              lineStartX = contentX + (contentWidth - line.width) / 2;
            } else if (textAlign === "right") {
              lineStartX = contentX + (contentWidth - line.width);
            }

            let cursorX = lineStartX;
            const baselineY = cursorY + line.lineHeight * 0.82;
            for (const measured of line.runs) {
              const run = measured.run;
              const runStyle = run.style;
              ctx.font = toCanvasFont(runStyle);
              ctx.fillStyle = gradientFill ?? runStyle.color;
              ctx.textAlign = "left";
              ctx.textBaseline = "alphabetic";
              drawUnderlinedText(
                ctx,
                run.text,
                cursorX,
                baselineY,
                runStyle,
                measured.width
              );
              cursorX += measured.width;
            }

            cursorY += line.lineHeight;
          }
          cursorY += paragraph.spaceAfter;
        });
        applyShadow(ctx, null, scaleX, scaleY);

        ctx.restore();
        continue;
      }

      ctx.restore();
    }
  }, [
    containerSize.height,
    containerSize.width,
    libraryStyle,
    slideDimensions.height,
    slideDimensions.width,
    text,
    visibleElements,
  ]);

  // Canvas pixels must be ready in the same pre-paint phase that makes the
  // layer visible. Drawing in a normal effect produces a blank frame whenever
  // React replaces every slide canvas during a song switch.
  useLayoutEffect(() => {
    draw();
  }, [draw, imageTick]);

  const isMeasured = containerSize.width > 0 && containerSize.height > 0;

  return (
    <div ref={containerRef} className={className} style={style}>
      <canvas
        ref={canvasRef}
        className="h-full w-full"
        style={{ opacity: isMeasured ? 1 : 0 }}
      />
    </div>
  );
});
