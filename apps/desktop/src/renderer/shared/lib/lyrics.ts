/**
 * Strip bracket annotations like [Verse 1], [Chorus], etc. from text
 * so it can be displayed cleanly on slides / output preview.
 */
export function stripBracketsForDisplay(text: string): string {
  return text
    .replace(/^\s*\[[^\]]+\]\s*$/gm, "")
    .replace(/^\s*\([^)]+\)\s*$/gm, "")
    .replace(/^\[[^\]]+\]\s*/gm, "")
    .replace(/\[.*?\]/g, "")
    .trim();
}

/**
 * Parse raw lyrics text into an array of slide objects.
 *
 * Rules:
 * - Slides are separated by blank lines (double newlines).
 * - A line matching `[Label]` (optionally with a modifier after a colon,
 *   e.g. `[Verse 1: Repeat]`) sets the label/modifier for the *next* slide.
 * - Everything else becomes the slide text.
 */
export function parseLyricsToSlides(
  lyrics: string,
): Array<{ text: string; label?: string; modifier?: string }> {
  if (!lyrics || !lyrics.trim()) return [];

  const blocks = lyrics.split(/\n\s*\n/); // split on blank lines
  const slides: Array<{ text: string; label?: string; modifier?: string }> = [];

  let pendingLabel: string | undefined;
  let pendingModifier: string | undefined;

  for (const raw of blocks) {
    const block = raw.trim();
    if (!block) continue;

    const lines = block.split("\n");
    let label = pendingLabel;
    let modifier = pendingModifier;
    let textStartIndex = 0;

    for (let index = 0; index < lines.length; index += 1) {
      const trimmedLine = lines[index]?.trim() ?? "";
      if (!trimmedLine) {
        textStartIndex = index + 1;
        continue;
      }

      const labelMatch = trimmedLine.match(/^\[([^\]]+)\]\s*$/);
      if (labelMatch) {
        const parts = labelMatch[1].split(":");
        label = parts[0]?.trim() || label;
        modifier = parts[1]?.trim() || modifier;
        textStartIndex = index + 1;
        continue;
      }

      const instructionMatch = trimmedLine.match(/^\(([^)]+)\)\s*$/);
      if (instructionMatch) {
        modifier = instructionMatch[1]?.trim() || modifier;
        textStartIndex = index + 1;
        continue;
      }

      break;
    }

    const text = lines.slice(textStartIndex).join("\n").trim();

    if (!text && textStartIndex >= lines.length) {
      pendingLabel = label;
      pendingModifier = modifier;
      continue;
    }

    pendingLabel = undefined;
    pendingModifier = undefined;

    if (text) {
      slides.push({ text, label, modifier });
    }
  }

  return slides;
}

/**
 * Fixes lyrics using the server-side AI endpoint.
 * @param lyrics The raw lyrics string to clean up.
 * @returns The cleaned lyrics or original if failed.
 */
export async function fixLyrics(lyrics: string): Promise<string> {
  const res = await fetch("/api/lyrics/fix", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ lyrics }),
  });

  const data = await res.json();

  if (data.notes?.includes("failed")) {
    throw new Error(data.notes);
  }

  return data.cleanedLyrics ?? lyrics;
}
