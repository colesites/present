import type { BibleVerse } from "./db";

export interface SlideConfig {
  maxLines: number;
  maxCharsPerLine: number;
  verseNumberMode: "inline" | "superscript" | "none";
  versionName?: string;
}

export interface ScriptureSlide {
  content: string;
  label: string;
  footer: string;
}

export function generateBibleSlides(
  verses: BibleVerse[],
  config: SlideConfig,
): ScriptureSlide[] {
  return verses.map((verse) => {
    const versePrefix =
      config.verseNumberMode === "none" ? "" : `${verse.verse}. `;

    const versionStr = config.versionName
      ? config.versionName
      : verse.version
        ? verse.version.toUpperCase()
        : "";

    return {
      content: `${versePrefix}${verse.text}`,
      label:
        `${verse.bookName} ${verse.chapter}:${verse.verse} ${versionStr}`.trim(),
      footer:
        `${verse.bookName} ${verse.chapter}:${verse.verse} ${versionStr}`.trim(),
    };
  });
}
