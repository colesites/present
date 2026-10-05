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

/** Write what the Bible agent heard or did to the app's log. */
export function noteBibleAgent(event: string, detail: string): void {
  void invoke("note_bible_agent", { event, detail }).catch((): void => undefined);
}

/** What the listening agent made of a sentence. */
export type SpokenScripture = {
  reference: ParsedReference;
  confidence: number;
  /** Recognised from a story told, rather than a passage named. */
  story: boolean;
  /** Sure enough, and real enough, to go on screen without being asked. */
  mayProject: boolean;
};

/**
 * Ask what was said meant, when the parser could not read it: a passage named
 * sideways or misheard, or a story told.
 *
 * `null` when there is nothing to ask about, nobody is signed in, or the model
 * could not be reached — none of which stop the operator doing it by hand. The
 * judgement about whether an answer is good enough is the core's, against the
 * books installed there (`services/scripture_agent.rs`).
 */
export async function understandSpokenScripture(
  sessionToken: string,
  /** The words new since the model was last asked. */
  heard: string,
  books: BibleBookRecord[],
  /** The passage in the Bible tab, for "verse eighteen" said on its own. */
  openPassage: string | null = null,
  /** What was said before `heard`, to understand it by. */
  earlier: string | null = null,
): Promise<SpokenScripture | null> {
  const answer = await invoke<{
    reference: RustReference;
    confidence: number;
    story: boolean;
    mayProject: boolean;
  } | null>("understand_spoken_scripture", {
    sessionToken,
    heard,
    earlier,
    books,
    openPassage,
  });
  if (!answer) {
    return null;
  }
  return {
    reference: {
      book: books.find((book) => book.id === answer.reference.book) ?? null,
      chapter: answer.reference.chapter,
      verseStart: answer.reference.verseStart,
      verseEnd: answer.reference.verseEnd,
      versionCode: answer.reference.versionCode,
      errors: answer.reference.errors,
    },
    confidence: answer.confidence,
    story: answer.story,
    mayProject: answer.mayProject,
  };
}
