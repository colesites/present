/**
 * Lyrics as people type them, and the slides they become.
 *
 * Shared by the desktop app and the website, so a song typed on either one
 * splits into the same slides. Moved from the desktop app's
 * `renderer/shared/lib/lyrics.ts` unchanged.
 */

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

/** A slide as `lyricsFromSlides` reads it: the parts that are lyrics. */
export type LyricSlide = {
  text: string;
  label?: string;
  modifier?: string;
  sectionRepeat?: string;
  elements?: unknown;
};

type TextElementLike = { type?: unknown; isPlaceholder?: unknown; contentRole?: unknown; content?: unknown };

/**
 * The lyrics a song's slides spell out, section headers and repeats included:
 * the reverse of `parseLyricsToSlides`, as the desktop app's `slidesToBody`
 * writes it.
 */
export function lyricsFromSlides(slides: LyricSlide[]): string {
  const clean = (value: string | undefined) => (value ?? "").trim();
  const blocks = slides.map((slide) => {
    const lines: string[] = [];
    const label = clean(slide.label);
    const modifier = clean(slide.modifier);
    const sectionRepeat = clean(slide.sectionRepeat);
    if (label) {
      lines.push(`[${[label, sectionRepeat].filter(Boolean).join(" ")}]`);
    }
    const elements = Array.isArray(slide.elements) ? (slide.elements as TextElementLike[]) : [];
    const primary =
      elements.find((element) => element?.type === "text" && !element.isPlaceholder && element.contentRole === "scriptureVerse") ??
      elements.find((element) => element?.type === "text" && !element.isPlaceholder);
    let text = (typeof primary?.content === "string" ? primary.content : slide.text).trim();
    if (modifier && !text.includes(`[${modifier}]`)) {
      const textLines = text.split("\n");
      textLines[0] = `${textLines[0]} [${modifier}]`;
      text = textLines.join("\n");
    }
    lines.push(text);
    return lines.join("\n").trim();
  });
  return blocks.filter(Boolean).join("\n\n");
}

/** A library slide as Convex stores it (`librarySlideInput`). */
export type StoredSlide = {
  id?: string;
  text: string;
  elements?: unknown[];
  label?: string;
  labelColor?: string;
  modifier?: string;
  sectionRepeat?: string;
  backgroundId?: string;
  backgroundColor?: string;
  useBackgroundColor?: boolean;
};

type ElementRecord = Record<string, unknown> & { id?: unknown; type?: unknown; isPlaceholder?: unknown; contentRole?: unknown };

const primaryTextIndex = (elements: ElementRecord[]) => {
  const verse = elements.findIndex(
    (element) => element?.type === "text" && !element.isPlaceholder && element.contentRole === "scriptureVerse",
  );
  return verse >= 0 ? verse : elements.findIndex((element) => element?.type === "text" && !element.isPlaceholder);
};

/** The element with new words. Its structured text and HTML described the old ones, so they go. */
const withText = (element: ElementRecord, text: string, id?: string): ElementRecord => {
  const next: ElementRecord = { ...element, content: text };
  delete next.textBody;
  delete next.richTextHtml;
  if (id) next.id = id;
  return next;
};

/**
 * Which old slide each new slide is, by index, or -1 for a new one.
 *
 * Slides whose words are unchanged are paired first, in order, wherever
 * they moved to; then each edited slide takes the unpaired old slide that
 * sat where it sits, between the same unchanged neighbours. So deleting or
 * adding a verse leaves every other slide itself, and editing a line
 * changes that slide and no other.
 */
export function pairSlides(next: string[], previous: string[]): number[] {
  const pairs = next.map(() => -1);
  const used = new Set<number>();
  let from = 0;
  next.forEach((text, index) => {
    for (let candidate = from; candidate < previous.length; candidate += 1) {
      if (!used.has(candidate) && previous[candidate] === text) {
        pairs[index] = candidate;
        used.add(candidate);
        from = candidate + 1;
        return;
      }
    }
  });
  next.forEach((_, index) => {
    if (pairs[index] >= 0) return;
    let before = -1;
    for (let back = index - 1; back >= 0; back -= 1) {
      if (pairs[back] >= 0) {
        before = pairs[back];
        break;
      }
    }
    let after = previous.length;
    for (let ahead = index + 1; ahead < next.length; ahead += 1) {
      if (pairs[ahead] >= 0 && previous[pairs[ahead]] === next[ahead]) {
        after = pairs[ahead];
        break;
      }
    }
    for (let candidate = before + 1; candidate < after; candidate += 1) {
      if (!used.has(candidate)) {
        pairs[index] = candidate;
        used.add(candidate);
        return;
      }
    }
  });
  return pairs;
}

/**
 * The slides a song's lyrics make, keeping what the old slides looked like.
 *
 * Slide `n` keeps slide `n`'s id, elements and background, with its main
 * text box holding the new words, and a slide that had no styled text box
 * keeps having none. Slides past the old count copy the last styled one. A song that never had styled elements gets none, and the
 * desktop app gives it its default text box, as it does for songs it makes.
 *
 * A slide whose words did not change is kept exactly as it was, bold and
 * italics and all, so editing one line of a song changes one slide. That is
 * also what lets the desktop app edit a live song: slides keep their ids, so
 * the slide on screen is still the slide on screen after a save, with its
 * new words. New slides take a theme's box and background (the elements
 * whose ids end `__theme-band` and `__theme-bg`) along with the text box.
 */
export function slidesFromLyrics(
  lyrics: string,
  previous: StoredSlide[],
  makeId: () => string,
): StoredSlide[] {
  const parsed = parseLyricsToSlides(lyrics);
  const template = [...previous].reverse().find((slide) => Array.isArray(slide.elements) && slide.elements.length > 0);
  const pairs = pairSlides(parsed.map((slide) => slide.text), previous.map((slide) => slide.text));

  return parsed.map((parsedSlide, index) => {
    const old = pairs[index] >= 0 ? previous[pairs[index]] : undefined;
    const look = old ?? previous[previous.length - 1];
    const id = old?.id ?? makeId();
    const slide: StoredSlide = {
      id,
      text: parsedSlide.text,
      ...(parsedSlide.label ? { label: parsedSlide.label } : {}),
      ...(parsedSlide.modifier ? { modifier: parsedSlide.modifier } : {}),
      ...(parsedSlide.sectionRepeat ? { sectionRepeat: parsedSlide.sectionRepeat } : {}),
    };
    if (old?.labelColor && old.label === parsedSlide.label) slide.labelColor = old.labelColor;
    if (look?.backgroundId) slide.backgroundId = look.backgroundId;
    if (look?.backgroundColor) slide.backgroundColor = look.backgroundColor;
    if (look?.useBackgroundColor !== undefined) slide.useBackgroundColor = look.useBackgroundColor;

    const oldElements = Array.isArray(old?.elements) ? (old.elements as ElementRecord[]) : null;
    const oldPrimary = oldElements ? primaryTextIndex(oldElements) : -1;
    if (oldElements && old && old.text === parsedSlide.text) {
      slide.elements = oldElements;
    } else if (oldElements && oldPrimary >= 0) {
      slide.elements = oldElements.map((element, position) =>
        position === oldPrimary ? withText(element, parsedSlide.text) : element,
      );
    } else if (!old && template) {
      const templateElements = template.elements as ElementRecord[];
      const templatePrimary = primaryTextIndex(templateElements);
      if (templatePrimary >= 0) {
        const themeShapes = templateElements.filter(
          (element) =>
            typeof element?.id === "string" &&
            (element.id.endsWith("__theme-band") || element.id.endsWith("__theme-bg")),
        );
        slide.elements = [...themeShapes, withText(templateElements[templatePrimary], parsedSlide.text, `${id}_text_0`)];
      }
    }
    return slide;
  });
}
