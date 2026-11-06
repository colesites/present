import counts from "./canonical-verse-counts.json";

const CANONICAL_VERSE_COUNTS: Record<string, Record<string, number>> =
  counts && typeof counts === "object" && "default" in counts
    ? (counts as { default: Record<string, Record<string, number>> }).default
    : (counts as Record<string, Record<string, number>>);

/**
 * Returns the canonical number of verses for a given book and chapter.
 * Fallback to 30 if book or chapter is not recognized.
 */
export function getCanonicalVerseCount(bookName: string, chapter: number): number {
  if (!bookName || chapter < 1) return 30;
  const normalized = bookName.trim().toLowerCase();
  const bookKey = Object.keys(CANONICAL_VERSE_COUNTS || {}).find(
    (k) => k.toLowerCase() === normalized,
  );
  if (!bookKey) return 30;
  const bookCounts = CANONICAL_VERSE_COUNTS[bookKey];
  return bookCounts?.[String(chapter)] ?? 30;
}

const BY_NAME = new Map(
  Object.entries(CANONICAL_VERSE_COUNTS ?? {}).map(([name, chapters]) => [name.toLowerCase(), chapters]),
);

/**
 * The verses in a chapter of a book of the Protestant canon, by its English
 * name, or `null` where the book or chapter is not one it knows: for the
 * parser to tell "psalm 1191" (119:1) from what it cannot be.
 */
export function verseCountOf(bookName: string, chapter: number): number | null {
  return BY_NAME.get(bookName.trim().toLowerCase())?.[String(chapter)] ?? null;
}

