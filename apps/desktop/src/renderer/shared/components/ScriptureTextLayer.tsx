"use client";

import { AutoFitText } from "./AutoFitText";
import { stripBracketsForDisplay } from "../lib/lyrics";
import { cn } from "../lib/utils";
import type {
  ScriptureFooterPosition,
  ScriptureTextAlign,
  ScriptureVerticalAlign,
} from "../../../shared/types/output-window";

const toAutoFitVerticalAlign = (
  value: ScriptureVerticalAlign,
): "top" | "center" | "bottom" => {
  if (value === "top") {
    return "top";
  }
  if (value === "bottom") {
    return "bottom";
  }
  return "center";
};

interface ScriptureTextLayerProps {
  text: string;
  footer?: string | null;
  fontFamily: string;
  fontSize: number;
  fontWeight?: string;
  footerFontSize?: number;
  footerFontFamily?: string;
  footerFontWeight?: string;
  textAlign: ScriptureTextAlign;
  verticalAlign: ScriptureVerticalAlign;
  footerAlign: ScriptureTextAlign;
  footerPosition: ScriptureFooterPosition;
  maxFontSize: number;
  minScale?: number;
  fitScale?: number;
  containerClassName?: string;
  bodyClassName?: string;
  textClassName?: string;
  footerClassName?: string;
}

export function ScriptureTextLayer({
  text,
  footer,
  fontFamily,
  fontSize,
  fontWeight = "400",
  footerFontSize,
  footerFontFamily,
  footerFontWeight,
  textAlign,
  verticalAlign,
  footerAlign,
  footerPosition,
  maxFontSize,
  minScale = 0.3,
  fitScale = 1,
  containerClassName,
  bodyClassName,
  textClassName,
  footerClassName,
}: ScriptureTextLayerProps) {
  const resolvedFooterFontSize = Math.max(
    8,
    Math.round(footerFontSize ?? fontSize * 0.28),
  );
  const resolvedFooterFontFamily = footerFontFamily ?? fontFamily;
  const resolvedFooterFontWeight = footerFontWeight ?? fontWeight;

  const footerNode =
    footer && footer.trim().length > 0 ? (
      <div
        className={cn(
          "w-full shrink-0",
          footerAlign === "left" && "text-left",
          footerAlign === "center" && "text-center",
          footerAlign === "right" && "text-right",
          footerClassName,
        )}
        style={{
          fontFamily: resolvedFooterFontFamily,
          fontWeight: resolvedFooterFontWeight,
          fontSize: `${resolvedFooterFontSize}px`,
        }}
      >
        {footer}
      </div>
    ) : null;

  return (
    <div className={containerClassName}>
      {footerPosition === "top" ? footerNode : null}
      <div className={cn("min-h-0 w-full flex-1", bodyClassName)}>
        <AutoFitText
          text={stripBracketsForDisplay(text)}
          className={textClassName}
          style={{
            fontFamily,
            fontSize,
            fontWeight,
          }}
          align={textAlign}
          verticalAlign={toAutoFitVerticalAlign(verticalAlign)}
          maxFontSize={maxFontSize}
          minScale={minScale}
          fitScale={fitScale}
        />
      </div>
      {footerPosition !== "top" ? footerNode : null}
    </div>
  );
}
