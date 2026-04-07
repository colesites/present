import type { SlideElementStyle } from "../../../shared/types";

export function normalizeCapitalizationMode(
  value: SlideElementStyle["capitalization"],
): "none" | "allCaps" | "titleCase" | "lineStart" | "lowercase" {
  if (value === "uppercase") {
    return "lineStart";
  }

  if (value === "capitalize") {
    return "titleCase";
  }

  if (
    value === "allCaps" ||
    value === "titleCase" ||
    value === "lineStart" ||
    value === "lowercase"
  ) {
    return value;
  }

  return "none";
}

export function applyCapitalization(
  text: string,
  value: SlideElementStyle["capitalization"],
) {
  const mode = normalizeCapitalizationMode(value);

  if (mode === "allCaps") {
    return text.toUpperCase();
  }

  if (mode === "lowercase") {
    return text.toLowerCase();
  }

  if (mode === "titleCase") {
    return text.replace(/\b(\p{L})/gu, (letter) => letter.toUpperCase());
  }

  if (mode === "lineStart") {
    return text
      .split("\n")
      .map((line) =>
        line.replace(/^([^\p{L}]*)(\p{L})/u, (_match, prefix, letter) => {
          return `${prefix}${letter.toUpperCase()}`;
        }),
      )
      .join("\n");
  }

  return text;
}
