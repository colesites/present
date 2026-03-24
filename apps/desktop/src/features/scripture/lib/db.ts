import Dexie, { type Table } from "dexie";

export interface BibleVersion {
  id: string; // e.g. "kjv"
  name: string; // e.g. "King James Version"
  code: string; // e.g. "KJV"
  lastUpdated: number;
  size: number;
}

export interface BibleVerse {
  pk: string; // `${version}|${bookId}|${chapter}|${verse}`
  version: string;
  bookId: string;
  bookName: string;
  chapter: number;
  verse: number;
  text: string;
}

export interface BibleBookRecord {
  pk: string; // `${version}|${bookId}`
  version: string;
  id: string; // e.g. "gen"
  name: string;
  abbreviation?: string;
  chapters: number;
}

export class ScriptureDatabase extends Dexie {
  versions!: Table<BibleVersion>;
  books!: Table<BibleBookRecord>;
  verses!: Table<BibleVerse>;

  constructor() {
    super("ScriptureDB");
    this.version(2).stores({
      versions: "id, code",
      books: "pk, version, id, name",
      verses: "pk, version, bookId, [version+bookId+chapter], [version+bookId+chapter+verse]",
    });
  }
}

export const db = new ScriptureDatabase();
