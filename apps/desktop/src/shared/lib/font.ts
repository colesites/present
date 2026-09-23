import type { CustomFontFace, FontFaceRecord } from "../types/font";

// The rules the font service applies live in font-catalog.mjs, where
// tests/font-catalog.test.mjs pins them for the Rust port.
export {
  SUPPORTED_CUSTOM_FONT_EXTENSIONS,
  dedupeFontFaces,
  getFontFaceSortKey,
  getFontFileMimeType,
  inferFontMetaFromFileName,
  normalizeFontStyleMeta,
  normalizeFontWeightMeta,
  sortFontFaces,
} from "./font-catalog.mjs";

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

export function getFontWeightSortValue(weight: string) {
  const parsed = Number.parseInt(weight, 10);
  return Number.isFinite(parsed) ? parsed : 400;
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
