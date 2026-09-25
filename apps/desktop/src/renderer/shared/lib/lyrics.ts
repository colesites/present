import { ConvexHttpClient } from "convex/browser";
import { ConvexError } from "convex/values";
import { api } from "@present/backend/convex/_generated/api";

const DEFAULT_DESKTOP_CONVEX_URL = "https://wary-iguana-735.convex.cloud";
const convexUrl = process.env.CONVEX_URL ?? DEFAULT_DESKTOP_CONVEX_URL;
const convex = new ConvexHttpClient(convexUrl);

/**
 * Strip square-bracket annotations like [Verse 1], [Chorus], [x2], etc.
 * from text so it can be displayed cleanly on slides / output preview.
 * Parentheses are normal lyric text and must remain visible.
 */
export function stripBracketsForDisplay(text: string): string {
  return text
    .replace(/^\s*\[[^\]]+\]\s*$/gm, "")
    .replace(/^\[[^\]]+\]\s*/gm, "")
    .replace(/\[.*?\]/g, "")
    .trim();
}

const REPEAT_TOKEN_PATTERN = /^(?:x\s*\d+|\d+\s*x)$/i;

function normalizeRepeatToken(value: string): string | null {
  const compact = value.replace(/\s+/g, "").toLowerCase();
  if (!/^(?:x\d+|\d+x)$/.test(compact)) return null;
  return compact.startsWith("x")
    ? compact
    : `x${compact.slice(0, -1)}`;
}

function splitTrailingSectionRepeat(value: string) {
  const match = value.trim().match(/^(.*?)(?:\s+)(x\s*\d+|\d+\s*x)$/i);
  const label = match?.[1]?.trim() ?? "";
  const repeat = match?.[2] ? normalizeRepeatToken(match[2]) : null;
  if (!label || !repeat) return null;
  return { label, repeat };
}

function isRepeatToken(value: string) {
  return REPEAT_TOKEN_PATTERN.test(value.trim());
}

/**
 * Parse raw lyrics text into an array of slide objects.
 *
 * Rules:
 * - Slides are separated by blank lines (double newlines).
 * - A line matching `[Label]` sets the label for the next slide.
 * - A label with a trailing repeat (`[Verse 1 x2]` or `[Verse 1 2x]`)
 *   stores a section repeat that follows every slide in that section.
 * - Inline square brackets (`this line [x3]`) become the slide modifier.
 * - Everything else becomes the slide text.
 */
export function parseLyricsToSlides(
  lyrics: string,
): Array<{
  text: string;
  label?: string;
  modifier?: string;
  sectionRepeat?: string;
}> {
  if (!lyrics || !lyrics.trim()) return [];

  const blocks = lyrics.split(/\n\s*\n/); // split on blank lines
  const slides: Array<{
    text: string;
    label?: string;
    modifier?: string;
    sectionRepeat?: string;
  }> = [];

  let pendingLabel: string | undefined;
  let pendingModifier: string | undefined;
  let pendingSectionRepeat: string | undefined;

  for (const raw of blocks) {
    const block = raw.trim();
    if (!block) continue;

    const lines = block.split("\n");
    let label = pendingLabel;
    let modifier = pendingModifier;
    let sectionRepeat = pendingSectionRepeat;
    let textStartIndex = 0;
    let foundLabel = false;

    for (let index = 0; index < lines.length; index += 1) {
      const trimmedLine = lines[index]?.trim() ?? "";
      if (!trimmedLine) {
        textStartIndex = index + 1;
        continue;
      }

      const labelMatch = trimmedLine.match(/^\[([^\]]+)\]\s*$/);
      if (labelMatch) {
        const parts = labelMatch[1].split(":");
        let bracketLabel = parts[0]?.trim();
        const bracketModifier = parts[1]?.trim();
        if (!foundLabel) {
          const repeatOnly = bracketLabel
            ? normalizeRepeatToken(bracketLabel)
            : null;
          if (repeatOnly) {
            modifier = repeatOnly;
            foundLabel = true;
            textStartIndex = index + 1;
            continue;
          }

          const repeatInfo = bracketLabel
            ? splitTrailingSectionRepeat(bracketLabel)
            : null;
          if (repeatInfo) {
            bracketLabel = repeatInfo.label;
            sectionRepeat = repeatInfo.repeat;
          } else {
            sectionRepeat = undefined;
          }
          label = bracketLabel || label;
          foundLabel = true;
          if (bracketModifier) {
            const repeatToken = normalizeRepeatToken(bracketModifier);
            if (repeatToken) {
              sectionRepeat = repeatToken;
            } else {
              modifier = bracketModifier;
            }
          }
        } else {
          const nextValue = bracketLabel || "";
          if (nextValue && isRepeatToken(nextValue) && label) {
            sectionRepeat = normalizeRepeatToken(nextValue) ?? sectionRepeat;
          } else {
            modifier = nextValue || modifier;
          }
        }
        textStartIndex = index + 1;
        continue;
      }

      break;
    }

    let text = lines.slice(textStartIndex).join("\n").trim();

    if (!text && textStartIndex >= lines.length) {
      pendingLabel = label;
      pendingModifier = modifier;
      pendingSectionRepeat = sectionRepeat;
      continue;
    }

    const inlineBrackets = text.match(/\[([^\]]+)\]/g);
    if (inlineBrackets) {
      const bracketValues = inlineBrackets?.map((m) => m.slice(1, -1)) ?? [];
      const modValues = bracketValues;
      const uniqueMods = [...new Set(modValues)];
      const combinedMod = uniqueMods.join(" ");
      modifier = combinedMod;
      text = text
        .replace(/\[[^\]]*\]/g, "")
        .split("\n")
        .map((l) => l.trim())
        .join("\n")
        .trim();
    }

    pendingLabel = label;
    pendingModifier = undefined;
    pendingSectionRepeat = sectionRepeat;

    if (text) {
      slides.push({ text, label, modifier, sectionRepeat });
    }
  }

  return slides;
}

/**
 * Local-only lyric cleaner. Runs deterministically and offline so the
 * "Fix Lyrics" button always improves output even when the AI Gateway key
 * isn't configured. Handles the small cleanups operators actually care
 * about: decorative junk, repeated whitespace, deity casing, and
 * pad-around-punctuation artefacts pasted from PDFs / web lyric sites.
 */
export function cleanLyricsLocally(lyrics: string): string {
  if (!lyrics) return "";

  let text = lyrics
    // Normalise newlines (CRLF, CR) → LF
    .replace(/\r\n?/g, "\n")
    // Strip BOM / zero-widths that sneak in from copy-paste
    .replace(/[\u200B-\u200D\uFEFF]/g, "")
    // Curly quotes → straight, em/en-dashes → hyphen
    .replace(/[‘’‚‛]/g, "'")
    .replace(/[“”„‟]/g, '"')
    .replace(/[–—]/g, "-")
    // Ellipsis char → three dots, then collapse runs of decorative dots
    .replace(/…/g, "...")
    .replace(/\.{3,}/g, "")
    // Decorative separator lines (---- ____ ====)
    .replace(/^[\s_\-=]{3,}$/gm, "")
    // Trailing whitespace before line break
    .replace(/[ \t]+$/gm, "")
    // Leading whitespace at line start
    .replace(/^[ \t]+/gm, "")
    // Collapse multiple spaces inside a line
    .replace(/[ \t]{2,}/g, " ");

  // Casing fix for the deity references operators consistently want.
  // Only fix when it's a word on its own (so we don't mangle "good" → "God").
  text = text.replace(/\bgod\b/g, "God").replace(/\blord\b/g, "Lord");

  // Collapse 3+ blank lines down to a single blank line (slide separator)
  text = text.replace(/\n{3,}/g, "\n\n");

  return text.trim();
}

/**
 * Re-split a lyric body into slides of N lines each, preserving section
 * labels like `[Verse 1]` / `[Chorus]`.
 *
 * IMPORTANT: blank lines are NOT treated as hard breaks. Earlier slide
 * separators (the blank lines a previous break inserted) are ignored so
 * the body can be freely re-flowed to any N — breaking to 4 and then to 6
 * works correctly. Only a section label or reaching `size` lyric lines
 * starts a new slide.
 */
export function breakLyricsIntoChunks(
  lyrics: string,
  linesPerSlide: number,
): string {
  const size = Math.max(1, Math.min(linesPerSlide | 0, 12));
  const cleaned = cleanLyricsLocally(lyrics);
  if (!cleaned) return "";

  const rawLines = cleaned.split("\n");
  const out: string[] = [];
  let bufferLabel: string | null = null;
  let buffer: string[] = [];

  const flush = () => {
    if (buffer.length === 0 && !bufferLabel) return;
    if (bufferLabel) out.push(bufferLabel);
    if (buffer.length > 0) out.push(...buffer);
    out.push("");
    buffer = [];
    bufferLabel = null;
  };

  for (const rawLine of rawLines) {
    const line = rawLine.trim();
    // Skip blank lines entirely — they were previous slide separators and
    // must not constrain the new chunk size.
    if (!line) {
      continue;
    }
    // A section label closes the current slide and labels the next one.
    if (/^\[[^\]]+\]$/.test(line)) {
      flush();
      bufferLabel = line;
      continue;
    }
    buffer.push(line);
    if (buffer.length >= size) {
      flush();
    }
  }
  flush();

  while (out.length > 0 && out[out.length - 1] === "") out.pop();
  return out.join("\n");
}

/**
 * Fixes lyrics. Always applies the deterministic local cleaner first,
 * then asks the Convex AI action for further improvements (rewording,
 * casing edge cases, structural breaks). If the AI is unavailable, the
 * locally-cleaned text is returned — never the raw input.
 */
export async function fixLyrics(lyrics: string): Promise<string> {
  const locallyCleaned = cleanLyricsLocally(lyrics);

  try {
    // As the signed-in user: each AI fix counts against their plan's monthly
    // allowance, and the server refuses anyone it cannot count against.
    const { ensureFreshDesktopAccessToken } = await import("../store/desktopSession");
    const token = await ensureFreshDesktopAccessToken();
    if (token) convex.setAuth(token);
    else convex.clearAuth();

    const data = await convex.action(api.lyrics.fixLyrics, {
      lyrics: locallyCleaned,
    });
    if (data.notes?.includes("failed")) {
      // Don't throw — the local clean is still valuable, surface it.
      return locallyCleaned;
    }
    return data.cleanedLyrics?.trim() || locallyCleaned;
  } catch (error) {
    // Offline or Convex down: the local clean is returned without a word, as
    // it always has been. A plan limit or a signed-out app is said, though:
    // otherwise the operator thinks the AI ran when it did not.
    if (error instanceof ConvexError) {
      const { toast } = await import("sonner");
      toast.error(String(error.data));
    }
    return locallyCleaned;
  }
}
