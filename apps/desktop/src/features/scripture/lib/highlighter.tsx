import * as React from "react";

/**
 * Escapes any special regex characters in a string.
 */
export function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export interface HighlightOptions {
  isExact?: boolean;
  className?: string;
}

export interface TextSegment {
  text: string;
  isMatch: boolean;
}

export const DEFAULT_HIGHLIGHT_CLASS =
  "bg-yellow-300 dark:bg-yellow-400 text-zinc-950 font-semibold rounded-[2px] px-1 py-0.5 shadow-xs";

/**
 * Splits text into segments indicating whether each segment matches the query.
 */
export function getHighlightSegments(
  text: string,
  query?: string | null,
  isExact = false,
): TextSegment[] {
  if (!text) return [];
  const trimmed = (query ?? "").trim();
  if (!trimmed) {
    return [{ text, isMatch: false }];
  }

  let pattern: string | null = null;

  if (isExact) {
    pattern = `(${escapeRegex(trimmed)})`;
  } else {
    // Check if the full phrase exists in text first
    const fullPhraseRegex = new RegExp(escapeRegex(trimmed), "i");
    if (fullPhraseRegex.test(text)) {
      pattern = `(${escapeRegex(trimmed)})`;
    } else {
      // Split into distinct words
      const words = trimmed
        .split(/\s+/)
        .map((w) => w.replace(/[^\p{L}\p{N}]/gu, "").trim())
        .filter((w) => w.length > 0);

      if (words.length === 0) {
        return [{ text, isMatch: false }];
      }

      // Sort descending by length so longer substrings match first
      const uniqueWords = Array.from(new Set(words)).sort(
        (a, b) => b.length - a.length,
      );
      pattern = `(${uniqueWords.map(escapeRegex).join("|")})`;
    }
  }

  if (!pattern) {
    return [{ text, isMatch: false }];
  }

  try {
    const regex = new RegExp(pattern, "gi");
    const parts = text.split(regex);

    if (parts.length <= 1) {
      return [{ text, isMatch: false }];
    }

    const testRegex = new RegExp(`^${pattern}$`, "i");

    return parts
      .filter((part) => part.length > 0)
      .map((part) => ({
        text: part,
        isMatch: testRegex.test(part),
      }));
  } catch {
    return [{ text, isMatch: false }];
  }
}

/**
 * Highlights matches of query within text using yellow mark tags.
 *
 * Supports:
 * - Exact phrase matches (e.g. "created the")
 * - Case-insensitive matching
 * - Multi-word / token matching when in broad mode
 * - Safe regex escaping for special characters and punctuation
 */
export function highlightText(
  text: string,
  query?: string | null,
  options?: HighlightOptions,
): React.ReactNode {
  if (!text) return "";
  const segments = getHighlightSegments(text, query, options?.isExact);

  if (segments.length === 1 && !segments[0]?.isMatch) {
    return text;
  }

  const highlightClass = options?.className ?? DEFAULT_HIGHLIGHT_CLASS;

  return (
    <>
      {segments.map((segment, index) => {
        if (segment.isMatch) {
          return (
            <mark key={index} className={highlightClass}>
              {segment.text}
            </mark>
          );
        }
        return <React.Fragment key={index}>{segment.text}</React.Fragment>;
      })}
    </>
  );
}
