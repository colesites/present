/**
 * Reading a scripture reference in the Rust core.
 *
 * The same rules as `features/scripture/lib/parser.ts`, held to the same table
 * (`tests/fixtures/scripture-references.json`). The panel still parses as the
 * operator types, where an answer is wanted on the keystroke; anything that can
 * wait a round trip — a service item, the AI operator, and the pedals and phone
 * remote being built — reads it here, so the core and the panel agree.
 */

import { invoke } from "@tauri-apps/api/core";

import type { BibleBookRecord } from "../../features/scripture/lib/db";
import type { ParsedReference } from "../../features/scripture/lib/parser";

type RustReference = {
  book: string | null;
  chapter: number | null;
  verseStart: number | null;
  verseEnd: number | null;
  versionCode: string | null;
  errors: string[];
};

export async function parseScriptureReference(
  input: string,
  books: BibleBookRecord[],
): Promise<ParsedReference> {
  const parsed = await invoke<RustReference>("parse_scripture_reference", { input, books });
  return {
    // Rust answers with the book's id; the panel works in whole records.
    book: books.find((book) => book.id === parsed.book) ?? null,
    chapter: parsed.chapter,
    verseStart: parsed.verseStart,
    verseEnd: parsed.verseEnd,
    versionCode: parsed.versionCode,
    errors: parsed.errors,
  };
}
