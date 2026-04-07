import type { CustomFontFace, FontFaceRecord } from "../types/font";

export const SUPPORTED_CUSTOM_FONT_EXTENSIONS = [
  ".ttf",
  ".otf",
  ".woff",
  ".woff2",
] as const;

const WEIGHT_HINTS = [
  { match: /\b(thin|hairline)\b/i, weight: "100", label: "Thin" },
  { match: /\b(extra[\s-]?light|ultra[\s-]?light)\b/i, weight: "200", label: "Extra Light" },
  { match: /\b(light)\b/i, weight: "300", label: "Light" },
  { match: /\b(book|regular|roman|normal)\b/i, weight: "400", label: "Regular" },
  { match: /\b(medium)\b/i, weight: "500", label: "Medium" },
  { match: /\b(semi[\s-]?bold|demi[\s-]?bold)\b/i, weight: "600", label: "Semibold" },
  { match: /\b(bold)\b/i, weight: "700", label: "Bold" },
  { match: /\b(extra[\s-]?bold|ultra[\s-]?bold|heavy)\b/i, weight: "800", label: "Extra Bold" },
  { match: /\b(black|extra[\s-]?black|ultra[\s-]?black)\b/i, weight: "900", label: "Black" },
] as const;

const STYLE_HINTS = [
  { match: /\b(italic)\b/i, style: "italic", label: "Italic" },
  { match: /\b(oblique)\b/i, style: "oblique", label: "Oblique" },
] as const;

function toTitleCase(value: string) {
  return value
    .trim()
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export function normalizeFontWeightMeta(rawWeight?: string | null): {
  weight: string;
  weightLabel: string;
} {
  const normalized = rawWeight?.trim() ?? "";

  if (/^\d+$/.test(normalized)) {
    const parsed = Math.min(Math.max(Number.parseInt(normalized, 10), 100), 900);
    const rounded = `${Math.round(parsed / 100) * 100}`;
    const hinted = WEIGHT_HINTS.find((hint) => hint.weight === rounded);
    return {
      weight: rounded,
      weightLabel: hinted?.label ?? rounded,
    };
  }

  const hinted = WEIGHT_HINTS.find((entry) => entry.match.test(normalized));
  if (hinted) {
    return {
      weight: hinted.weight,
      weightLabel: hinted.label,
    };
  }

  return {
    weight: "400",
    weightLabel: normalized ? toTitleCase(normalized) : "Regular",
  };
}

export function normalizeFontStyleMeta(rawStyle?: string | null): {
  style: string;
  styleLabel: string;
} {
  const normalized = rawStyle?.trim() ?? "";
  const hinted = STYLE_HINTS.find((entry) => entry.match.test(normalized));
  if (hinted) {
    return {
      style: hinted.style,
      styleLabel: hinted.label,
    };
  }

  return {
    style: "normal",
    styleLabel: normalized ? toTitleCase(normalized) : "Normal",
  };
}

export function inferFontMetaFromFileName(fileName: string) {
  const baseName = fileName.replace(/\.[^.]+$/, "");
  const normalized = baseName.replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim();
  const styleMeta = normalizeFontStyleMeta(normalized);
  const weightMeta = normalizeFontWeightMeta(normalized);
  const familyName = normalized
    .replace(
      /\b(thin|hairline|extra[\s-]?light|ultra[\s-]?light|light|book|regular|roman|normal|medium|semi[\s-]?bold|demi[\s-]?bold|bold|extra[\s-]?bold|ultra[\s-]?bold|heavy|black|extra[\s-]?black|ultra[\s-]?black|italic|oblique)\b/gi,
      "",
    )
    .replace(/\s+/g, " ")
    .trim();

  return {
    familyName: familyName || normalized || "Custom Font",
    ...weightMeta,
    ...styleMeta,
  };
}

export function getFontFileMimeType(fileName: string) {
  const lower = fileName.toLowerCase();
  if (lower.endsWith(".otf")) {
    return "font/otf";
  }
  if (lower.endsWith(".woff2")) {
    return "font/woff2";
  }
  if (lower.endsWith(".woff")) {
    return "font/woff";
  }
  return "font/ttf";
}

export function buildFontFaceCssRule(face: CustomFontFace) {
  return `@font-face {
  font-family: ${JSON.stringify(face.familyName)};
  src: url(${JSON.stringify(face.dataUrl)}) format(${JSON.stringify(
    face.fileName.toLowerCase().endsWith(".otf")
      ? "opentype"
      : face.fileName.toLowerCase().endsWith(".woff2")
        ? "woff2"
        : face.fileName.toLowerCase().endsWith(".woff")
          ? "woff"
          : "truetype",
  )});
  font-style: ${face.style};
  font-weight: ${face.weight};
  font-display: swap;
}`;
}

export function getFontFaceSortKey(face: FontFaceRecord) {
  return [
    face.familyName.toLocaleLowerCase(),
    Number.parseInt(face.weight, 10) || 400,
    face.style.toLocaleLowerCase(),
    face.postScriptName.toLocaleLowerCase(),
  ] as const;
}

export function getFontWeightSortValue(weight: string) {
  const parsed = Number.parseInt(weight, 10);
  return Number.isFinite(parsed) ? parsed : 400;
}

export function sortFontFaces<T extends FontFaceRecord>(faces: T[]) {
  return [...faces].sort((left, right) => {
    const leftKey = getFontFaceSortKey(left);
    const rightKey = getFontFaceSortKey(right);
    return leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0;
  });
}

export function dedupeFontFaces<T extends FontFaceRecord>(faces: T[]) {
  const seen = new Set<string>();
  return sortFontFaces(
    faces.filter((face) => {
      const key = [
        face.source,
        face.familyName,
        face.postScriptName,
        face.weight,
        face.style,
        "fileName" in face ? face.fileName : "",
      ].join("|");
      if (seen.has(key)) {
        return false;
      }
      seen.add(key);
      return true;
    }),
  );
}

export function buildFontWeightOptions(faces: FontFaceRecord[]) {
  const seen = new Set<string>();
  return faces
    .filter((face) => {
      const key = `${face.weight}|${face.weightLabel}`;
      if (seen.has(key)) {
        return false;
      }
      seen.add(key);
      return true;
    })
    .sort(
      (left, right) =>
        getFontWeightSortValue(left.weight) - getFontWeightSortValue(right.weight),
    )
    .map((face) => ({
      value: face.weight,
      label: `${face.weightLabel} ${face.weight}`.trim(),
    }));
}
