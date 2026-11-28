/**
 * What becomes of a verse too long for its slide (Bible edit, "Long verses").
 *
 * The audience screen shrinks a verse's words to fit its box, but only so
 * far: past that the box cut them off, and the end of a long verse was not on
 * screen at all. Now the operator says what happens instead:
 *
 * - **smart**: shrink to the smallest size they will read, then split the
 *   verse over as many slides as it needs at that size.
 * - **shrink**: shrink as far as it takes, never split.
 * - **split**: never shrink: split it over slides at the size chosen.
 * - **fit**: fill the box, larger or smaller — a short verse grows.
 * - **fixed**: the size chosen, always; the editor says when it overflows.
 *
 * A verse is split here, where its slides are made, so every screen — the
 * audience window, the preview, the stream — is given slides that fit.
 * Measured as the audience window lays words out (`CanvasSlideLayer.tsx`):
 * wrapped at spaces, each line the size times the line height.
 */

export type ScriptureOverflowMode = "smart" | "shrink" | "split" | "fit" | "fixed";
export type ScriptureSplitBy = "sentence" | "words" | "lines";

export type ScriptureOverflow = {
  mode: ScriptureOverflowMode;
  /** The smallest size a verse shrinks to before it is split (smart). */
  minFontSize: number;
  /** Where a verse is divided: at its sentences and clauses, evenly by words, or by lines. */
  splitBy: ScriptureSplitBy;
  /** The most lines on a slide, split by lines. */
  maxLines: number;
  /** The reference below a verse takes the room it needs, not three tenths of the slide. */
  compactFooter: boolean;
};

export const DEFAULT_SCRIPTURE_OVERFLOW: ScriptureOverflow = {
  mode: "smart",
  minFontSize: 56,
  splitBy: "sentence",
  maxLines: 4,
  compactFooter: true,
};

export const SCRIPTURE_OVERFLOW_MODES: readonly ScriptureOverflowMode[] = [
  "smart",
  "shrink",
  "split",
  "fit",
  "fixed",
];
export const SCRIPTURE_SPLIT_BY: readonly ScriptureSplitBy[] = ["sentence", "words", "lines"];

/** A setting read back from storage, whatever was stored. */
export function normalizeScriptureOverflow(value: unknown): ScriptureOverflow {
  const given = (value && typeof value === "object" ? value : {}) as Partial<ScriptureOverflow>;
  const number = (candidate: unknown, fallback: number, least: number, most: number) =>
    typeof candidate === "number" && Number.isFinite(candidate)
      ? Math.min(most, Math.max(least, Math.round(candidate)))
      : fallback;
  return {
    mode: SCRIPTURE_OVERFLOW_MODES.includes(given.mode as ScriptureOverflowMode)
      ? (given.mode as ScriptureOverflowMode)
      : DEFAULT_SCRIPTURE_OVERFLOW.mode,
    minFontSize: number(given.minFontSize, DEFAULT_SCRIPTURE_OVERFLOW.minFontSize, 12, 400),
    splitBy: SCRIPTURE_SPLIT_BY.includes(given.splitBy as ScriptureSplitBy)
      ? (given.splitBy as ScriptureSplitBy)
      : DEFAULT_SCRIPTURE_OVERFLOW.splitBy,
    maxLines: number(given.maxLines, DEFAULT_SCRIPTURE_OVERFLOW.maxLines, 1, 20),
    compactFooter:
      typeof given.compactFooter === "boolean"
        ? given.compactFooter
        : DEFAULT_SCRIPTURE_OVERFLOW.compactFooter,
  };
}

/**
 * How a verse's box sizes its words, as every screen reads the element's
 * `autoFit`: "shrink" to fit and no larger than its size, "grow" to fill the
 * box either way, "none" at its size whatever happens.
 */
export type ScriptureAutoFit = "shrink" | "grow" | "none";

export function autoFitFor(mode: ScriptureOverflowMode): ScriptureAutoFit {
  if (mode === "fit") return "grow";
  if (mode === "fixed") return "none";
  return "shrink";
}

/** A box to set words in, as a verse element is drawn. */
export type VerseBox = {
  width: number;
  height: number;
  /** A multiple of the size: 1.2 unless the element says. */
  lineHeight: number;
};

/** How wide `text` is at `fontSize`, in the box's pixels. */
export type WidthOf = (text: string, fontSize: number) => number;

/** How many lines `text` takes at `fontSize` in `box`, wrapped as the audience window wraps. */
export function linesAt(text: string, fontSize: number, box: VerseBox, widthOf: WidthOf): {
  lines: number;
  widest: number;
} {
  let lines = 0;
  let widest = 0;
  for (const paragraph of text.split("\n")) {
    let line = 0;
    let used = 0;
    for (const token of paragraph.split(/(\s+)/).filter((each) => each.length > 0)) {
      const width = widthOf(token, fontSize);
      if (used > 0 && line + width > box.width) {
        lines += 1;
        widest = Math.max(widest, line);
        line = 0;
        used = 0;
      }
      line += width;
      used += 1;
    }
    lines += 1;
    widest = Math.max(widest, line);
  }
  return { lines, widest };
}

/** Whether `text` fits `box` at `fontSize`, in at most `maxLines` lines when that is given. */
export function fitsAt(
  text: string,
  fontSize: number,
  box: VerseBox,
  widthOf: WidthOf,
  maxLines = Infinity,
): boolean {
  const { lines, widest } = linesAt(text, fontSize, box, widthOf);
  return lines <= maxLines && lines * fontSize * box.lineHeight <= box.height && widest <= box.width;
}

/**
 * The places a verse can be divided, as pieces that put back together are
 * the verse: after each sentence and clause ("…the face of the deep." "And
 * the Spirit…"), or after each word.
 */
function piecesOf(text: string, by: ScriptureSplitBy): string[] {
  const words = text.split(/(?<=\s)(?=\S)/);
  if (by !== "sentence") return words;
  const pieces: string[] = [];
  let piece = "";
  for (const word of words) {
    piece += word;
    if (/[.;:?!,—)]["'’”)]*\s*$/.test(word)) {
      pieces.push(piece);
      piece = "";
    }
  }
  if (piece) pieces.push(piece);
  return pieces;
}

const wordCount = (text: string) => text.split(/\s+/).filter(Boolean).length;

/**
 * `pieces` in `count` runs, as even in words as the pieces allow: each run
 * closed at the piece that brings it nearest its share.
 */
function inRuns(pieces: string[], count: number): string[] {
  const total = pieces.reduce((sum, piece) => sum + wordCount(piece), 0);
  const runs: string[] = [];
  let run = "";
  let words = 0;
  let done = 0;
  pieces.forEach((piece, index) => {
    const left = pieces.length - index;
    const runsLeft = count - runs.length;
    const share = (total - done) / runsLeft;
    const size = wordCount(piece);
    // Close the run before this piece when that leaves it nearer its share,
    // and enough pieces are left for the runs still to make.
    if (
      run
      && runsLeft > 1
      && (Math.abs(words + size - share) > Math.abs(words - share) || left < runsLeft)
    ) {
      runs.push(run);
      done += words;
      run = "";
      words = 0;
    }
    run += piece;
    words += size;
  });
  if (run) runs.push(run);
  return runs.map((each) => each.trim()).filter(Boolean);
}

export type SplitVerse = {
  /** The verse's words on each slide, in order. */
  parts: string[];
};

/**
 * A verse's words over as many slides as `overflow` says it needs, in a box
 * at `fontSize`. One part when it fits, or when the mode does not split.
 *
 * Split by sentence, a sentence too long for a slide on its own is divided
 * at its words. The parts are as even as the places to divide allow: never
 * nine words in ten on one slide and the last word on the next.
 */
export function splitVerse(
  text: string,
  fontSize: number,
  overflow: ScriptureOverflow,
  box: VerseBox,
  widthOf: WidthOf,
): SplitVerse {
  const whole = { parts: [text] };
  if (overflow.mode !== "smart" && overflow.mode !== "split") return whole;
  const size = overflow.mode === "smart" ? Math.min(fontSize, overflow.minFontSize) : fontSize;
  const maxLines = overflow.splitBy === "lines" ? overflow.maxLines : Infinity;
  const fits = (part: string) => fitsAt(part, size, box, widthOf, maxLines);
  if (fits(text)) return whole;

  const tryPieces = (pieces: string[]): string[] | null => {
    for (let count = 2; count <= pieces.length; count += 1) {
      const runs = inRuns(pieces, count);
      if (runs.every(fits)) return runs;
    }
    return null;
  };
  const byPiece = overflow.splitBy === "sentence" ? tryPieces(piecesOf(text, "sentence")) : null;
  const parts = byPiece ?? tryPieces(piecesOf(text, "words"));
  // A word too long for the box at any count: as many words as there are,
  // each shrunk by the screen.
  return { parts: parts ?? text.split(/\s+/).filter(Boolean) };
}
