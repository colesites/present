export type SlideDraft = {
  text: string;
  label?: string; // Section label like "Verse 1", "Praise"
  modifier?: string; // Bottom modifier like "x3", "2x"
};

// Matches section labels like [Verse 1], [Praise], [Chorus]
const sectionLabelRegex = /^\[([^\]]+)\]$/;
// Matches repeat modifiers like [x3], [2x], [x2]
const modifierPattern = /^(x\d+|\d+x)$/i;
// Matches inline modifier at end of line like "I am blessed [x3]"
const inlineModifierRegex = /\s*\[(x\d+|\d+x)\]\s*$/i;

export function parseLyricsToSlides(raw: string): SlideDraft[] {
  const lines = raw.split(/\r?\n/);
  const slides: SlideDraft[] = [];
  let buffer: string[] = [];
  let currentLabel: string | undefined;

  const flush = () => {
    if (buffer.length === 0) return;

    let modifier: string | undefined;
    const processedLines: string[] = [];

    for (const line of buffer) {
      const trimmedLine = line.trim();

      // Check if entire line is just a modifier like [x3]
      const bracketMatch = trimmedLine.match(sectionLabelRegex);
      if (bracketMatch && modifierPattern.test(bracketMatch[1])) {
        modifier = bracketMatch[1];
        continue; // Don't add to processed lines
      }

      // Check for inline modifier at end of line
      const inlineMatch = line.match(inlineModifierRegex);
      if (inlineMatch) {
        modifier = inlineMatch[1];
        processedLines.push(line.replace(inlineModifierRegex, "").trimEnd());
      } else {
        processedLines.push(line.trimEnd());
      }
    }

    const text = processedLines.join("\n").trim();

    if (text.length > 0) {
      slides.push({
        text,
        label: currentLabel,
        modifier,
      });
    }
    buffer = [];
  };

  for (const line of lines) {
    const trimmed = line.trim();

    // Empty line = end of slide
    if (trimmed.length === 0) {
      flush();
      continue;
    }

    // Check if it's a bracketed item
    const bracketMatch = trimmed.match(sectionLabelRegex);
    if (bracketMatch) {
      const content = bracketMatch[1];

      // Is it a modifier? (x3, 2x, etc.)
      if (modifierPattern.test(content)) {
        buffer.push(line); // Add to buffer, flush() will handle it
        continue;
      }

      // It's a section label
      flush();
      currentLabel = content.charAt(0).toUpperCase() + content.slice(1);
      continue;
    }

    // Regular line
    buffer.push(line);
  }

  flush();
  return slides;
}

// Format slide label for display: "1 Praise x3" or "2 Praise"
export function formatSlideLabel(
  index: number,
  label?: string,
  modifier?: string,
): string {
  const parts = [(index + 1).toString()];
  if (label) parts.push(label);
  if (modifier) parts.push(modifier);
  return parts.join(" ");
}

/**
 * Strip all bracketed content from text for display.
 * [Verse], [x3], [Praise], etc. should NOT show in slides/output.
 * They only appear in Edit mode and in the slide footer/label.
 */
export function stripBracketsForDisplay(text: string): string {
  return (
    text
      // Remove standalone bracket lines like [Verse] or [x3]
      .replace(/^\[.+\]$/gm, "")
      // Remove inline brackets like "I am blessed [x3]" → "I am blessed"
      .replace(/\s*\[.+?\]/g, "")
      // Clean up multiple empty lines that might result
      .replace(/\n{3,}/g, "\n\n")
      // Trim whitespace
      .trim()
  );
}
