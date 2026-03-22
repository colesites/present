/**
 * Strip bracket annotations like [Verse 1], [Chorus], etc. from text
 * so it can be displayed cleanly on slides / output preview.
 */
export function stripBracketsForDisplay(text: string): string {
  return text
    .replace(/^\[.*?\]\s*/gm, "") // remove [Label] at the start of a line
    .replace(/\[.*?\]/g, "")       // remove any remaining inline [Label]
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

    // Check if this entire block is just a label line like [Verse 1]
    const labelMatch = block.match(/^\[([^\]]+)\]$/);
    if (labelMatch) {
      const parts = labelMatch[1].split(":");
      pendingLabel = parts[0].trim();
      pendingModifier = parts[1]?.trim() || undefined;
      continue;
    }

    // Extract inline label from the first line if present
    const lines = block.split("\n");
    const firstLineLabel = lines[0].match(/^\[([^\]]+)\]\s*$/);
    let text: string;
    let label = pendingLabel;
    let modifier = pendingModifier;

    if (firstLineLabel) {
      const parts = firstLineLabel[1].split(":");
      label = parts[0].trim();
      modifier = parts[1]?.trim() || undefined;
      text = lines.slice(1).join("\n").trim();
    } else {
      text = block;
    }

    // Reset pending after consumption
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
