"use client";

import React, {
  memo,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { cn } from "@/lib/utils";

export interface AutoFitTextProps {
  text: string;
  className?: string;
  style?: CSSProperties;
  minScale?: number;
  align?: "left" | "center" | "right";
  verticalAlign?: "top" | "center" | "bottom";
}

/**
 * Auto-fit text component
 * Fits by adjusting font-size so wrapping behavior is natural.
 */
const AutoFitTextComponent = ({
  text,
  className,
  style,
  minScale = 0.4,
  align = "center",
  verticalAlign = "center",
}: AutoFitTextProps) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const textRef = useRef<HTMLParagraphElement>(null);

  const [fittedFontSizePx, setFittedFontSizePx] = useState<number | null>(null);

  useLayoutEffect(() => {
    const container = containerRef.current;
    const textEl = textRef.current;
    if (!container || !textEl) return;

    const fit = () => {
      const containerWidth = container.clientWidth;
      const containerHeight = container.clientHeight;

      if (containerWidth === 0 || containerHeight === 0) return;

      // Binary search for the largest font size that fits
      let min = 10;
      let max = 500;
      let best = min;

      // Save original styles to restore later
      const originalFontSize = textEl.style.fontSize;
      const originalVisibility = textEl.style.visibility;

      // Hide during measurement to prevent flickering
      textEl.style.visibility = "hidden";

      for (let i = 0; i < 10; i++) {
        const mid = (min + max) / 2;
        textEl.style.fontSize = `${mid}px`;

        const fits =
          textEl.scrollWidth <= containerWidth &&
          textEl.scrollHeight <= containerHeight;

        if (fits) {
          best = mid;
          min = mid;
        } else {
          max = mid;
        }
      }

      // Restore and apply best fit
      textEl.style.visibility = originalVisibility;
      textEl.style.fontSize = originalFontSize;
      setFittedFontSizePx(best);
    };

    const raf = requestAnimationFrame(fit);
    const ro = new ResizeObserver(() => {
      requestAnimationFrame(fit);
    });
    ro.observe(container);

    // Initial fit
    fit();

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, [text, minScale, style]);

  return (
    <div
      ref={containerRef}
      className={cn(
        "flex h-full w-full min-w-0 overflow-hidden",
        align === "center" && "justify-center",
        align === "left" && "justify-start",
        align === "right" && "justify-end",
        verticalAlign === "center" && "items-center",
        verticalAlign === "top" && "items-start",
        verticalAlign === "bottom" && "items-end",
      )}
    >
      <p
        ref={textRef}
        className={cn(
          "min-w-0 whitespace-pre-line break-words",
          // Don't force w-full, let it naturally width-fit
          align === "center" && "text-center",
          align === "left" && "text-left",
          align === "right" && "text-right",
          className,
        )}
        style={{
          ...(style ?? {}),
          fontSize:
            fittedFontSizePx !== null
              ? `${fittedFontSizePx}px`
              : (style as any)?.fontSize,
        }}
      >
        {text}
      </p>
    </div>
  );
};

export const AutoFitText = memo(AutoFitTextComponent);
AutoFitText.displayName = "AutoFitText";
