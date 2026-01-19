import { type BibleBookRecord } from "./db";

export interface ParsedReference {
  book: BibleBookRecord | null;
  chapter: number | null;
  verseStart: number | null;
  verseEnd: number | null;
  versionCode: string | null;
  errors: string[];
}

export function parseReference(
  input: string,
  availableBooks: BibleBookRecord[],
): ParsedReference {
  const result: ParsedReference = {
    book: null,
    chapter: null,
    verseStart: null,
    verseEnd: null,
    versionCode: null,
    errors: [],
  };

  const trimInput = input.trim();
  if (!trimInput) return result;

  // Regex to match: [Book] [Chapter]:[Verse]-[Verse] [Version]
  // Improved to handle optional spaces and simpler grouping
  // Group 1: Book (allow "1 John", "Song of Songs")
  // Group 2: Chapter
  // Group 3: Verse Start (Optional)
  // Group 4: Verse End (Optional range)
  // Group 5: Version (Optional)
  const regex =
    /^([1-3]?\s*[A-Za-z]+(?:[A-Za-z\s]*))\s+(\d+)(?::\s*(\d+)(?:\s*-\s*(\d+))?)?(?:\s+([A-Za-z0-9]+))?$/i;
  const match = trimInput.match(regex);

  if (!match) {
    result.errors.push("Invalid format. Expected: Book Chapter:Verse");
    return result;
  }

  const [, bookRaw, chapterRaw, verseStartRaw, verseEndRaw, versionRaw] = match;

  // 1. Resolve Book
  const bookSearch = bookRaw.trim().toLowerCase();
  const book = availableBooks.find(
    (b) =>
      b.name.toLowerCase() === bookSearch ||
      b.id.toLowerCase() === bookSearch ||
      b.abbreviation?.toLowerCase() === bookSearch,
  );

  if (!book) {
    result.errors.push(`Unknown book: "${bookRaw.trim()}"`);
  } else {
    result.book = book;
  }

  // 2. Resolve Chapter
  const chapter = parseInt(chapterRaw, 10);
  if (book && (chapter < 1 || chapter > book.chapters)) {
    result.errors.push(
      `Invalid chapter: ${chapter}. ${book.name} has ${book.chapters} chapters.`,
    );
  }
  result.chapter = chapter;

  // 3. Resolve Verse Start
  if (verseStartRaw) {
    result.verseStart = parseInt(verseStartRaw, 10);
  }

  // 4. Resolve Verse End
  if (verseEndRaw) {
    result.verseEnd = parseInt(verseEndRaw, 10);
    if (result.verseStart && result.verseEnd <= result.verseStart) {
      result.errors.push("End verse must be greater than start verse.");
    }
  }

  // 5. Version
  if (versionRaw) {
    result.versionCode = versionRaw.toUpperCase();
  }

  return result;
}

export function isValidCharacter(char: string): boolean {
  return /^[A-Za-z0-9\s:.-]$/.test(char);
}
