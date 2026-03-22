import { db, type BibleBookRecord, type BibleVersion } from "./db";

export type SuggestionType = "book" | "chapter" | "verse" | "version";

export interface Suggestion {
  text: string;
  type: SuggestionType;
  description?: string;
}

export async function getSuggestions(
  input: string,
  availableBooks: BibleBookRecord[],
  availableVersions: BibleVersion[],
): Promise<Suggestion[]> {
  const trimInput = input.trimStart();
  if (!trimInput) {
    // Return none if empty, or maybe popular books?
    // Let's return nothing to keep it clean until they type
    return [];
  }

  // Split by space to see where we are
  const parts = trimInput.split(/\s+/);

  // 1. Book matching (first part or first two parts if it's "1 John", etc.)
  let bookStr = parts[0];
  let remaining = parts.slice(1);

  if (/^[1-3]$/.test(parts[0]) && parts[1]) {
    bookStr = `${parts[0]} ${parts[1]}`;
    remaining = parts.slice(2);
  }

  const bookSearch = bookStr.toLowerCase();
  const matchedBooks = availableBooks.filter(
    (b) =>
      b.name.toLowerCase().startsWith(bookSearch) ||
      b.id.toLowerCase().startsWith(bookSearch) ||
      b.abbreviation?.toLowerCase().startsWith(bookSearch),
  );

  // If we are still typing the book
  if (remaining.length === 0 && !input.endsWith(" ")) {
    // Sort matches: starts with input first, then others
    const sorted = matchedBooks.sort((a, b) => {
      const aStarts = a.name.toLowerCase().startsWith(bookSearch);
      const bStarts = b.name.toLowerCase().startsWith(bookSearch);
      if (aStarts && !bStarts) return -1;
      if (!aStarts && bStarts) return 1;
      return a.name.localeCompare(b.name);
    });

    // Deduplicate books by name
    const seen = new Set<string>();
    const uniqueBooks = [];
    for (const b of sorted) {
      if (!seen.has(b.name)) {
        seen.add(b.name);
        uniqueBooks.push(b);
      }
    }

    return uniqueBooks
      .slice(0, 5)
      .map((b) => ({ text: b.name, type: "book" as SuggestionType }));
  }

  // If book is matched, move to chapters/verses
  const book = matchedBooks[0]; // Take the best match
  if (!book) return [];

  // 2. Version suggestions (Priority if we have moved past the reference)
  // If we have a reference part, and then another part (version), OR if we have a reference part and a trailing space
  if (remaining.length >= 2 || (remaining.length >= 1 && input.endsWith(" "))) {
    let versionSearch = "";
    let prefix = "";

    if (remaining.length >= 2) {
      // Typed "Gen 6:2 am" -> remaining is ["6:2", "am"]
      versionSearch = remaining[remaining.length - 1].toLowerCase();
      const lastSpaceIndex = input.lastIndexOf(" ");
      prefix = input.substring(0, lastSpaceIndex + 1);
    } else {
      // Typed "Gen 6:2 " -> remaining is ["6:2"]
      versionSearch = "";
      prefix = input;
    }

    const matches = availableVersions.filter((v) =>
      v.code.toLowerCase().startsWith(versionSearch),
    );

    if (matches.length > 0) {
      return matches.map((v) => ({
        text: `${prefix}${v.code}`,
        type: "version" as SuggestionType,
        description: v.name,
      }));
    }
  }

  // 3. Chapter/Verse matching (Only if we are arguably still typing the reference)
  const refPart = remaining[0] || "";
  if (refPart.includes(":")) {
    const [chapterStr, verseStr] = refPart.split(":");
    const chapter = parseInt(chapterStr, 10);

    // Verse suggestions
    if (verseStr !== undefined) {
      // If user typed a range hyphen, stop suggesting verses (let them finish the range)
      if (verseStr.includes("-")) {
        return [];
      }

      // If user typed a verse number, prioritize it and following verses
      // e.g. "2" -> 2, 3, 4, 5, 6
      // "23" -> 23, 24, 25...
      let startVerse = 1;
      const parsedV = parseInt(verseStr, 10);
      if (!isNaN(parsedV) && parsedV > 0) {
        startVerse = parsedV;
      }

      return Array.from({ length: 5 }, (_, i) => ({
        text: `${book.name} ${chapter}:${startVerse + i}`,
        type: "verse" as SuggestionType,
      }));
    }
  } else if (refPart) {
    // Chapter suggestions
    const chapterSearch = parseInt(refPart, 10);
    if (!isNaN(chapterSearch)) {
      return Array.from({ length: 5 }, (_, i) => {
        const c = i + 1; // Simplistic
        return {
          text: `${book.name} ${chapterSearch}${i ? i : ""}`,
          type: "chapter" as SuggestionType,
        };
      }).slice(0, 5);
    }
  } else if (input.endsWith(" ")) {
    // Just finished book, suggest "Chapter 1"
    return [{ text: `${book.name} 1`, type: "chapter" as SuggestionType }];
  }

  // Version logic moved up
  return [];
}

/**
 * Smart transformation for input behavior:
 * "Matthew 3 " -> "Matthew 3:"
 */
export function getSmartTransform(input: string): string {
  // Matches "Book Chapter " (space at end)
  const regex = /^([1-3]?\s*[A-Za-z\s]+)\s+(\d+)\s$/i;
  const match = input.match(regex);
  if (match) {
    return `${match[1].trim()} ${match[2]}:`;
  }
  return input;
}
