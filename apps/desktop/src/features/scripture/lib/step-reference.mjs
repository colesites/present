// @ts-check

/**
 * The passage before or after the one on show, for the Bible panel's
 * Previous and Next.
 *
 * A single verse steps to the next verse, into the next chapter at the end
 * of one; a range steps by its own length; a whole chapter steps a chapter.
 * It stays in the book: past its first or last verse there is nothing.
 *
 * Kept apart from React so it can be tested.
 */

/**
 * @typedef {{ name: string, chapters: number }} Book
 * @typedef {{ book: Book, chapter: number, verseStart: number | null, verseEnd: number | null, versionCode?: string | null }} Passage
 * @typedef {{ chapter: number, verseStart: number | null, verseEnd: number | null }} Step
 */

/**
 * @param {Passage} passage
 * @param {"previous" | "next"} direction
 * @param {(chapter: number) => number} versesIn how many verses a chapter has; 0 when it isn't there
 * @returns {Step | null}
 */
export function stepPassage(passage, direction, versesIn) {
  const { book, chapter } = passage;
  const forward = direction === "next";
  const exists = (/** @type {number} */ at) => at >= 1 && at <= book.chapters && versesIn(at) > 0;

  if (passage.verseStart === null) {
    const next = forward ? chapter + 1 : chapter - 1;
    return exists(next) ? { chapter: next, verseStart: null, verseEnd: null } : null;
  }

  const start = passage.verseStart;
  const end = passage.verseEnd !== null && passage.verseEnd > start ? passage.verseEnd : start;
  const length = end - start + 1;
  const last = versesIn(chapter);

  if (forward) {
    if (end < last) {
      const from = end + 1;
      const to = Math.min(last, end + length);
      return { chapter, verseStart: from, verseEnd: to > from ? to : null };
    }
    if (!exists(chapter + 1)) return null;
    const to = Math.min(versesIn(chapter + 1), length);
    return { chapter: chapter + 1, verseStart: 1, verseEnd: to > 1 ? to : null };
  }

  if (start > 1) {
    const to = start - 1;
    const from = Math.max(1, start - length);
    return { chapter, verseStart: from, verseEnd: to > from ? to : null };
  }
  if (!exists(chapter - 1)) return null;
  const lastBefore = versesIn(chapter - 1);
  const from = Math.max(1, lastBefore - length + 1);
  return { chapter: chapter - 1, verseStart: from, verseEnd: lastBefore > from ? lastBefore : null };
}

/**
 * A step as a reference to type: "John 2:5", "John 2:5-7", "John 3", with
 * the version when there is one.
 *
 * @param {Book} book
 * @param {Step} step
 * @param {string | null | undefined} [versionCode]
 */
export function referenceText(book, step, versionCode) {
  let text = `${book.name} ${step.chapter}`;
  if (step.verseStart !== null) {
    text += `:${step.verseStart}`;
    if (step.verseEnd !== null) text += `-${step.verseEnd}`;
  }
  return versionCode ? `${text} ${versionCode}` : text;
}

/** The short label for a step: "2:5", "2:5-7" or "Chapter 3". */
export function stepLabel(/** @type {Step} */ step) {
  if (step.verseStart === null) return `Chapter ${step.chapter}`;
  return `${step.chapter}:${step.verseStart}${step.verseEnd !== null ? `-${step.verseEnd}` : ""}`;
}
