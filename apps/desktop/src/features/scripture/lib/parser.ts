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
    .replace(/^(?:the\s+book\s+of|book\s+of)\s+/, "")
    .replace(/^(first|1st|i)\b/, "1")
    .replace(/^(second|2nd|ii)\b/, "2")
    .replace(/^(third|3rd|iii)\b/, "3")
    .replace(/\s+/g, " ");
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
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

    const isAdjacentUnitSequence =
      phraseTokens.length > 1 &&
      phraseTokens.every((phraseToken) => {
        if (phraseToken === "and") return true;
        const value = SPOKEN_NUMBER_VALUES.get(phraseToken);
        return value !== undefined && value < 20;
      });

    if (isAdjacentUnitSequence) {
      normalizedTokens.push(
        ...phraseTokens
          .filter((phraseToken) => phraseToken !== "and")
          .map((phraseToken) => String(SPOKEN_NUMBER_VALUES.get(phraseToken))),
      );
      index = lookahead - 1;
      continue;
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
      .replace(/\b(first|1st)\b/gi, "1")
      .replace(/\b(second|2nd)\b/gi, "2")
      .replace(/\b(third|3rd)\b/gi, "3")
      .replace(/\s+/g, " ")
      .replace(/^(first|1st|i)\b/i, "1")
      .replace(/^(second|2nd|ii)\b/i, "2")
      .replace(/^(third|3rd|iii)\b/i, "3"),
  )
    .replace(/\bchapters?\b/gi, "")
    // "from verse 2 to verse 10", "beginning at verse 3": the words that
    // introduce a verse carry nothing the numbers do not.
    .replace(/\b(?:from|beginning|starting|at)\b/gi, " ")
    // A range, with the word repeated after "to" as it usually is when said
    // aloud: "from verse 3 to verse 5".
    .replace(
      /\bverses?\b\s+(\d+)\s*(?:to|through|-)\s*(?:verses?\s+)?(\d+)\b/gi,
      ":$1-$2",
    )
    .replace(/\bverses?\b\s+(\d+)\b/gi, ":$1")
    // A range between two bare numbers, said without the word at all:
    // "john 3 16 to 18".
    .replace(/(\d+)\s+(?:to|through)\s+(?:verses?\s+)?(\d+)\b/gi, "$1-$2")
    .replace(/\s+:/g, ":")
    .replace(/\s*-\s*/g, "-")
    .replace(/\s+/g, " ")
    .trim();
}

function getBookAliases(book: BibleBookRecord): string[] {
  const named = [book.name, book.id, book.abbreviation]
    .filter((value): value is string => Boolean(value?.trim()))
    .map(normalizeBookLookup);
  // "Psalm 23" is how it is said, and the book is called Psalms. A name that
  // ends in "s" answers to itself without it, and one that does not answers
  // to itself with it — which covers Psalm(s), Proverb(s) and Song(s) without
  // a table of exceptions.
  const spoken = named.map((alias) =>
    alias.endsWith("s") && alias.length > 3 ? alias.slice(0, -1) : `${alias}s`,
  );
  return Array.from(new Set([...named, ...spoken])).sort(
    (left, right) => right.length - left.length,
  );
}

function findReferencedBook(
  input: string,
  availableBooks: BibleBookRecord[],
): { book: BibleBookRecord; rawBook: string; tail: string } | null {
  let bestMatch:
    | {
        book: BibleBookRecord;
        rawBook: string;
        start: number;
        end: number;
      }
    | null = null;

  for (const book of availableBooks) {
    for (const alias of getBookAliases(book)) {
      if (!alias) continue;

      // A colon ends the name as surely as a space does: normalising
      // "2 John verse 5" leaves "2 john:5", and a book of one chapter is
      // said that way more often than not.
      const match = new RegExp(`(^|\\s)(${escapeRegex(alias)})(?=[\\s:]|$)`, "i").exec(input);
      if (!match || match.index === undefined) continue;

      const start = match.index + (match[1]?.length ?? 0);
      const end = start + (match[2]?.length ?? alias.length);
      const rawBook = input.slice(start, end);

      if (
        !bestMatch ||
        start < bestMatch.start ||
        (start === bestMatch.start && rawBook.length > bestMatch.rawBook.length)
      ) {
        bestMatch = { book, rawBook, start, end };
      }
    }
  }

  if (!bestMatch) return null;
  return {
    book: bestMatch.book,
    rawBook: bestMatch.rawBook,
    tail: input.slice(bestMatch.end).trim(),
  };
}

function parseChapterVerseTail(tail: string): {
  chapter: number | null;
  verseStart: number | null;
  verseEnd: number | null;
  versionCode: string | null;
} {
  const result = {
    chapter: null as number | null,
    verseStart: null as number | null,
    verseEnd: null as number | null,
    versionCode: null as string | null,
  };

  const match = tail.match(/^(\d+)(?::(\d+)(?:-(\d+))?)?(?:\s+(.+))?$/);
  if (!match) return result;

  result.chapter = parseInt(match[1], 10);
  if (match[2]) {
    result.verseStart = parseInt(match[2], 10);
  }
  if (match[3]) {
    result.verseEnd = parseInt(match[3], 10);
  }

  const rest = match[4]?.trim();
  if (!rest) return result;

  const [firstToken, secondToken] = rest.split(/\s+/);
  const verseRange = firstToken.match(/^(\d+)(?:-(\d+))?$/);
  if (verseRange) {
    result.verseStart = parseInt(verseRange[1], 10);
    if (verseRange[2]) {
      result.verseEnd = parseInt(verseRange[2], 10);
    }
    if (secondToken && /^[A-Za-z][A-Za-z0-9]*$/.test(secondToken)) {
      result.versionCode = secondToken.toUpperCase();
    }
    return result;
  }

  if (/^[A-Za-z][A-Za-z0-9]*$/.test(firstToken)) {
    result.versionCode = firstToken.toUpperCase();
  }

  return result;
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

  const bookMatch = findReferencedBook(trimInput, availableBooks);
  if (!bookMatch) {
    result.errors.push(
      "Invalid format. Expected: Book Chapter or Book Chapter:Verse",
    );
    return result;
  }

  result.book = bookMatch.book;

  // 2. Resolve Chapter
  //
  // A book of one chapter is spoken without it: "Jude verse 3", "2 John
  // verse 5". The verse is there; the chapter can only be the one.
  const tail =
    bookMatch.tail.startsWith(":") && bookMatch.book.chapters === 1
      ? `1${bookMatch.tail}`
      : bookMatch.tail;
  const parsedTail = parseChapterVerseTail(tail);
  const chapter = parsedTail.chapter;
  if (!chapter) {
    result.errors.push("Missing chapter number.");
    return result;
  }

  if (chapter < 1 || chapter > bookMatch.book.chapters) {
    result.errors.push(
      `Invalid chapter: ${chapter}. ${bookMatch.book.name} has ${bookMatch.book.chapters} chapters.`,
    );
  }
  result.chapter = chapter;

  // 3. Resolve Verse Start
  result.verseStart = parsedTail.verseStart;

  // 4. Resolve Verse End
  result.verseEnd = parsedTail.verseEnd;
  if (result.verseStart && result.verseEnd && result.verseEnd <= result.verseStart) {
    result.errors.push("End verse must be greater than start verse.");
  }

  // 5. Version
  result.versionCode = parsedTail.versionCode;

  return result;
}

/**
 * The first reference said anywhere in a sentence, as a preacher says one:
 * "turn with me to John chapter three verse sixteen this morning".
 *
 * Read from each word in turn, so a word early on that is also a book's short
 * name ("am", "ex") does not hide the reference after it. `null` when the
 * sentence names no book with a chapter it has.
 */
export function findReferenceInSentence(
  sentence: string,
  availableBooks: BibleBookRecord[],
): ParsedReference | null {
  const words = sentence.trim().split(/\s+/).filter(Boolean);
  for (let start = 0; start < words.length; start += 1) {
    const parsed = parseReference(words.slice(start).join(" "), availableBooks);
    if (parsed.book && parsed.chapter && parsed.errors.length === 0) {
      return parsed;
    }
  }
  return null;
}

/**
 * A verse or chapter said on its own, read against the passage already open:
 * "look at verse eighteen" with John 3 open is John 3:18, "chapter four" is
 * John 4, "chapter four verse two" is John 4:2. Only when "verse" or
 * "chapter" is said, so a time like "3:30" in a sentence is not a passage.
 * `null` when nothing open or nothing said reads as one.
 */
export function findRelativeReference(
  sentence: string,
  current: ParsedReference,
): ParsedReference | null {
  const book = current.book;
  if (!book || !current.chapter || !/\b(verses?|chapters?)\b/i.test(sentence)) {
    return null;
  }
  const saidChapter = /\bchapters?\b/i.test(sentence);
  // The same reading of spoken numbers and words a typed reference gets:
  // "chapter four verse two" is "4:2", "verse eighteen" is ":18".
  const normalized = normalizeReferenceInput(sentence);
  const match = saidChapter
    ? normalized.match(/(?:^|\s)(\d+)(?::(\d+)(?:-(\d+))?)?(?=\s|$)/)
    : normalized.match(/(?<!\d):(\d+)(?:-(\d+))?(?=\s|$)/);
  if (!match) {
    return null;
  }
  const [chapter, verseStart, verseEnd] = saidChapter
    ? [Number(match[1]), match[2] ? Number(match[2]) : null, match[3] ? Number(match[3]) : null]
    : [current.chapter, Number(match[1]), match[2] ? Number(match[2]) : null];
  if (chapter < 1 || chapter > book.chapters || (verseStart !== null && verseStart < 1)) {
    return null;
  }
  if (verseStart !== null && verseEnd !== null && verseEnd <= verseStart) {
    return null;
  }
  return { book, chapter, verseStart, verseEnd, versionCode: null, errors: [] };
}

export function isValidCharacter(char: string): boolean {
  return /^[A-Za-z0-9\s:.-]$/.test(char);
}
