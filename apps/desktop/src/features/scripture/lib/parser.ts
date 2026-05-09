import { type BibleBookRecord } from "./db";

export interface ParsedReference {
  book: BibleBookRecord | null;
  chapter: number | null;
  verseStart: number | null;
  verseEnd: number | null;
  versionCode: string | null;
  errors: string[];
}

const SPOKEN_NUMBER_VALUES = new Map<string, number>([
  ["zero", 0],
  ["one", 1],
  ["two", 2],
  ["three", 3],
  ["four", 4],
  ["five", 5],
  ["six", 6],
  ["seven", 7],
  ["eight", 8],
  ["nine", 9],
  ["ten", 10],
  ["eleven", 11],
  ["twelve", 12],
  ["thirteen", 13],
  ["fourteen", 14],
  ["fifteen", 15],
  ["sixteen", 16],
  ["seventeen", 17],
  ["eighteen", 18],
  ["nineteen", 19],
  ["twenty", 20],
  ["thirty", 30],
  ["forty", 40],
  ["fifty", 50],
  ["sixty", 60],
  ["seventy", 70],
  ["eighty", 80],
  ["ninety", 90],
  ["hundred", 100],
]);

function normalizeBookLookup(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/^(first|1st|i)\b/, "1")
    .replace(/^(second|2nd|ii)\b/, "2")
    .replace(/^(third|3rd|iii)\b/, "3")
    .replace(/\s+/g, " ");
}

function parseSpokenNumberTokens(tokens: string[]): number | null {
  let current = 0;
  let hasValue = false;

  for (const token of tokens) {
    if (token === "and") {
      continue;
    }

    const value = SPOKEN_NUMBER_VALUES.get(token);
    if (value === undefined) {
      return null;
    }

    hasValue = true;

    if (value === 100) {
      current = (current || 1) * value;
      continue;
    }

    current += value;
  }

  return hasValue ? current : null;
}

function replaceSpokenNumberPhrases(input: string): string {
  const tokens = input.split(/\s+/);
  const normalizedTokens: string[] = [];

  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index]?.toLowerCase().replace(/[^a-z-]/g, "");
    if (!token || (!SPOKEN_NUMBER_VALUES.has(token) && token !== "and")) {
      normalizedTokens.push(tokens[index] ?? "");
      continue;
    }

    const phraseTokens: string[] = [];
    let lookahead = index;

    while (lookahead < tokens.length) {
      const candidate = tokens[lookahead]?.toLowerCase().replace(/[^a-z-]/g, "");
      if (!candidate || (!SPOKEN_NUMBER_VALUES.has(candidate) && candidate !== "and")) {
        break;
      }
      phraseTokens.push(candidate);
      lookahead += 1;
    }

    const parsedNumber = parseSpokenNumberTokens(phraseTokens);
    if (parsedNumber === null) {
      normalizedTokens.push(...tokens.slice(index, lookahead));
      index = lookahead - 1;
      continue;
    }

    normalizedTokens.push(String(parsedNumber));
    index = lookahead - 1;
  }

  return normalizedTokens.join(" ");
}

function normalizeReferenceInput(input: string): string {
  return replaceSpokenNumberPhrases(
    input
      .trim()
      .replace(/[.,]/g, " ")
      .replace(/\s+/g, " ")
      .replace(/^(first|1st|i)\b/i, "1")
      .replace(/^(second|2nd|ii)\b/i, "2")
      .replace(/^(third|3rd|iii)\b/i, "3"),
  )
    .replace(/\bchapters?\b/gi, "")
    .replace(/\bverses?\b\s+(\d+)\s+(?:to|through)\s+(\d+)\b/gi, ":$1-$2")
    .replace(/\bverses?\b\s+(\d+)\s*-\s*(\d+)\b/gi, ":$1-$2")
    .replace(/\bverses?\b\s+(\d+)\b/gi, ":$1")
    .replace(/\s+:/g, ":")
    .replace(/\s*-\s*/g, "-")
    .replace(/\s+/g, " ")
    .trim();
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

  const trimInput = normalizeReferenceInput(input);
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
    result.errors.push(
      "Invalid format. Expected: Book Chapter or Book Chapter:Verse",
    );
    return result;
  }

  const [, bookRaw, chapterRaw, verseStartRaw, verseEndRaw, versionRaw] = match;

  // 1. Resolve Book
  const bookSearch = normalizeBookLookup(bookRaw);
  const book = availableBooks.find(
    (b) =>
      normalizeBookLookup(b.name) === bookSearch ||
      normalizeBookLookup(b.id) === bookSearch ||
      normalizeBookLookup(b.abbreviation ?? "") === bookSearch,
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
