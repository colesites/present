"use client";

import * as React from "react";
import { useState, useMemo, useEffect } from "react";
import { Search, ChevronRight, ArrowLeft, BookOpen, Layers, X, Hash } from "lucide-react";
import { cn } from "../../../renderer/shared/lib/utils";
import type { BibleBookRecord } from "../lib/db";
import { getCanonicalVerseCount } from "../lib/canonical-verses";

export interface CanonicalBook {
  id: string;
  name: string;
  testament: "OT" | "NT";
  category: string;
  chapters: number;
  abbreviation: string;
}

export const CANONICAL_BOOKS: CanonicalBook[] = [
  // Old Testament - Law (Pentateuch)
  { id: "gen", name: "Genesis", testament: "OT", category: "Law", chapters: 50, abbreviation: "Gen" },
  { id: "exod", name: "Exodus", testament: "OT", category: "Law", chapters: 40, abbreviation: "Exo" },
  { id: "lev", name: "Leviticus", testament: "OT", category: "Law", chapters: 27, abbreviation: "Lev" },
  { id: "num", name: "Numbers", testament: "OT", category: "Law", chapters: 36, abbreviation: "Num" },
  { id: "deut", name: "Deuteronomy", testament: "OT", category: "Law", chapters: 34, abbreviation: "Deu" },

  // Old Testament - History
  { id: "josh", name: "Joshua", testament: "OT", category: "History", chapters: 24, abbreviation: "Jos" },
  { id: "judg", name: "Judges", testament: "OT", category: "History", chapters: 21, abbreviation: "Jdg" },
  { id: "ruth", name: "Ruth", testament: "OT", category: "History", chapters: 4, abbreviation: "Rut" },
  { id: "1sam", name: "1 Samuel", testament: "OT", category: "History", chapters: 31, abbreviation: "1Sa" },
  { id: "2sam", name: "2 Samuel", testament: "OT", category: "History", chapters: 24, abbreviation: "2Sa" },
  { id: "1kgs", name: "1 Kings", testament: "OT", category: "History", chapters: 22, abbreviation: "1Ki" },
  { id: "2kgs", name: "2 Kings", testament: "OT", category: "History", chapters: 25, abbreviation: "2Ki" },
  { id: "1chr", name: "1 Chronicles", testament: "OT", category: "History", chapters: 29, abbreviation: "1Ch" },
  { id: "2chr", name: "2 Chronicles", testament: "OT", category: "History", chapters: 36, abbreviation: "2Ch" },
  { id: "ezra", name: "Ezra", testament: "OT", category: "History", chapters: 10, abbreviation: "Ezr" },
  { id: "neh", name: "Nehemiah", testament: "OT", category: "History", chapters: 13, abbreviation: "Neh" },
  { id: "esth", name: "Esther", testament: "OT", category: "History", chapters: 10, abbreviation: "Est" },

  // Old Testament - Poetry & Wisdom
  { id: "job", name: "Job", testament: "OT", category: "Poetry", chapters: 42, abbreviation: "Job" },
  { id: "ps", name: "Psalms", testament: "OT", category: "Poetry", chapters: 150, abbreviation: "Psa" },
  { id: "prov", name: "Proverbs", testament: "OT", category: "Poetry", chapters: 31, abbreviation: "Pro" },
  { id: "eccl", name: "Ecclesiastes", testament: "OT", category: "Poetry", chapters: 12, abbreviation: "Ecc" },
  { id: "song", name: "Song of Solomon", testament: "OT", category: "Poetry", chapters: 8, abbreviation: "Sos" },

  // Old Testament - Major Prophets
  { id: "isa", name: "Isaiah", testament: "OT", category: "Major Prophets", chapters: 66, abbreviation: "Isa" },
  { id: "jer", name: "Jeremiah", testament: "OT", category: "Major Prophets", chapters: 52, abbreviation: "Jer" },
  { id: "lam", name: "Lamentations", testament: "OT", category: "Major Prophets", chapters: 5, abbreviation: "Lam" },
  { id: "ezek", name: "Ezekiel", testament: "OT", category: "Major Prophets", chapters: 48, abbreviation: "Eze" },
  { id: "dan", name: "Daniel", testament: "OT", category: "Major Prophets", chapters: 12, abbreviation: "Dan" },

  // Old Testament - Minor Prophets
  { id: "hos", name: "Hosea", testament: "OT", category: "Minor Prophets", chapters: 14, abbreviation: "Hos" },
  { id: "joel", name: "Joel", testament: "OT", category: "Minor Prophets", chapters: 3, abbreviation: "Joe" },
  { id: "amos", name: "Amos", testament: "OT", category: "Minor Prophets", chapters: 9, abbreviation: "Amo" },
  { id: "obad", name: "Obadiah", testament: "OT", category: "Minor Prophets", chapters: 1, abbreviation: "Oba" },
  { id: "jonah", name: "Jonah", testament: "OT", category: "Minor Prophets", chapters: 4, abbreviation: "Jon" },
  { id: "mic", name: "Micah", testament: "OT", category: "Minor Prophets", chapters: 7, abbreviation: "Mic" },
  { id: "nah", name: "Nahum", testament: "OT", category: "Minor Prophets", chapters: 3, abbreviation: "Nah" },
  { id: "hab", name: "Habakkuk", testament: "OT", category: "Minor Prophets", chapters: 3, abbreviation: "Hab" },
  { id: "zeph", name: "Zephaniah", testament: "OT", category: "Minor Prophets", chapters: 3, abbreviation: "Zep" },
  { id: "hag", name: "Haggai", testament: "OT", category: "Minor Prophets", chapters: 2, abbreviation: "Hag" },
  { id: "zech", name: "Zechariah", testament: "OT", category: "Minor Prophets", chapters: 14, abbreviation: "Zec" },
  { id: "mal", name: "Malachi", testament: "OT", category: "Minor Prophets", chapters: 4, abbreviation: "Mal" },

  // New Testament - Gospels
  { id: "matt", name: "Matthew", testament: "NT", category: "Gospels", chapters: 28, abbreviation: "Mat" },
  { id: "mark", name: "Mark", testament: "NT", category: "Gospels", chapters: 16, abbreviation: "Mrk" },
  { id: "luke", name: "Luke", testament: "NT", category: "Gospels", chapters: 24, abbreviation: "Luk" },
  { id: "john", name: "John", testament: "NT", category: "Gospels", chapters: 21, abbreviation: "Jhn" },

  // New Testament - Church History
  { id: "acts", name: "Acts", testament: "NT", category: "History", chapters: 28, abbreviation: "Act" },

  // New Testament - Pauline Epistles
  { id: "rom", name: "Romans", testament: "NT", category: "Pauline Epistles", chapters: 16, abbreviation: "Rom" },
  { id: "1cor", name: "1 Corinthians", testament: "NT", category: "Pauline Epistles", chapters: 16, abbreviation: "1Co" },
  { id: "2cor", name: "2 Corinthians", testament: "NT", category: "Pauline Epistles", chapters: 13, abbreviation: "2Co" },
  { id: "gal", name: "Galatians", testament: "NT", category: "Pauline Epistles", chapters: 6, abbreviation: "Gal" },
  { id: "eph", name: "Ephesians", testament: "NT", category: "Pauline Epistles", chapters: 6, abbreviation: "Eph" },
  { id: "phil", name: "Philippians", testament: "NT", category: "Pauline Epistles", chapters: 4, abbreviation: "Php" },
  { id: "col", name: "Colossians", testament: "NT", category: "Pauline Epistles", chapters: 4, abbreviation: "Col" },
  { id: "1thess", name: "1 Thessalonians", testament: "NT", category: "Pauline Epistles", chapters: 5, abbreviation: "1Th" },
  { id: "2thess", name: "2 Thessalonians", testament: "NT", category: "Pauline Epistles", chapters: 3, abbreviation: "2Th" },
  { id: "1tim", name: "1 Timothy", testament: "NT", category: "Pauline Epistles", chapters: 6, abbreviation: "1Ti" },
  { id: "2tim", name: "2 Timothy", testament: "NT", category: "Pauline Epistles", chapters: 4, abbreviation: "2Ti" },
  { id: "titus", name: "Titus", testament: "NT", category: "Pauline Epistles", chapters: 3, abbreviation: "Tit" },
  { id: "phlm", name: "Philemon", testament: "NT", category: "Pauline Epistles", chapters: 1, abbreviation: "Phm" },

  // New Testament - General Epistles
  { id: "heb", name: "Hebrews", testament: "NT", category: "General Epistles", chapters: 13, abbreviation: "Heb" },
  { id: "jas", name: "James", testament: "NT", category: "General Epistles", chapters: 5, abbreviation: "Jas" },
  { id: "1pet", name: "1 Peter", testament: "NT", category: "General Epistles", chapters: 5, abbreviation: "1Pe" },
  { id: "2pet", name: "2 Peter", testament: "NT", category: "General Epistles", chapters: 3, abbreviation: "2Pe" },
  { id: "1john", name: "1 John", testament: "NT", category: "General Epistles", chapters: 5, abbreviation: "1Jn" },
  { id: "2john", name: "2 John", testament: "NT", category: "General Epistles", chapters: 1, abbreviation: "2Jn" },
  { id: "3john", name: "3 John", testament: "NT", category: "General Epistles", chapters: 1, abbreviation: "3Jn" },
  { id: "jude", name: "Jude", testament: "NT", category: "General Epistles", chapters: 1, abbreviation: "Jud" },

  // New Testament - Prophecy
  { id: "rev", name: "Revelation", testament: "NT", category: "Prophecy", chapters: 22, abbreviation: "Rev" },
];

export interface BookChapterBrowserProps {
  /** The currently active or viewed book name (e.g. "Genesis", "Romans") */
  activeBookName?: string | null;
  /** The currently active or viewed chapter number */
  activeChapter?: number | null;
  /** The currently active or viewed verse number */
  activeVerse?: number | null;
  /** Available books from the installed version/db if present */
  availableBooks?: BibleBookRecord[];
  /** Callback when user selects a book, chapter, and optional verse */
  onSelectPassage: (bookName: string, chapter: number, verse?: number | null) => void;
  className?: string;
}

export function BookChapterBrowser({
  activeBookName,
  activeChapter,
  activeVerse,
  availableBooks = [],
  onSelectPassage,
  className,
}: BookChapterBrowserProps) {
  // Merge canonical books with database chapter counts if available
  const books = useMemo(() => {
    if (availableBooks.length === 0) return CANONICAL_BOOKS;

    const dbMap = new Map<string, BibleBookRecord>();
    for (const b of availableBooks) {
      dbMap.set(b.name.toLowerCase(), b);
    }

    return CANONICAL_BOOKS.map((canon) => {
      const dbBook = dbMap.get(canon.name.toLowerCase());
      if (dbBook && dbBook.chapters > 0) {
        return {
          ...canon,
          chapters: dbBook.chapters,
        };
      }
      return canon;
    });
  }, [availableBooks]);

  // Which view tab is active: "books" | "chapters" | "verses".
  // A passage that is already open starts on its verses, not the book list.
  const [viewTab, setViewTab] = useState<"books" | "chapters" | "verses">(() =>
    activeChapter && activeChapter > 0 ? "verses" : "books",
  );
  // Testament filter: "all" | "OT" | "NT"
  const [testamentFilter, setTestamentFilter] = useState<"all" | "OT" | "NT">("all");
  // Search query for books
  const [searchQuery, setSearchQuery] = useState("");

  // Currently highlighted/selected book for chapter picking
  const [selectedBook, setSelectedBook] = useState<CanonicalBook | null>(() => {
    if (activeBookName) {
      return (
        books.find(
          (b) => b.name.toLowerCase() === activeBookName.toLowerCase(),
        ) ?? books[0]
      );
    }
    return books[0];
  });

  // Selected chapter for verses picking
  const [selectedChapter, setSelectedChapter] = useState<number>(() => {
    return activeChapter && activeChapter > 0 ? activeChapter : 1;
  });

  const contentRef = React.useRef<HTMLDivElement>(null);
  // The passage last opened from a search or the Bible agent. A later click
  // on Books stays put until a different passage arrives.
  const [followedKey, setFollowedKey] = useState(() =>
    `${activeBookName ?? ""}:${activeChapter ?? ""}:${activeVerse ?? ""}`,
  );
  const passageKey = `${activeBookName ?? ""}:${activeChapter ?? ""}:${activeVerse ?? ""}`;
  const matchedBook = activeBookName
    ? books.find((b) => b.name.toLowerCase() === activeBookName.toLowerCase()) ?? null
    : null;

  if (!activeBookName) {
    if (followedKey !== "") setFollowedKey("");
  } else if (followedKey !== passageKey) {
    setFollowedKey(passageKey);
    if (matchedBook) setSelectedBook(matchedBook);
    if (activeChapter && activeChapter > 0) {
      setSelectedChapter(activeChapter);
      setViewTab("verses");
    } else {
      setViewTab("chapters");
    }
  } else if (
    matchedBook &&
    selectedBook?.name.toLowerCase() !== matchedBook.name.toLowerCase()
  ) {
    setSelectedBook(matchedBook);
  }

  useEffect(() => {
    const target =
      viewTab === "verses" && activeVerse
        ? contentRef.current?.querySelector(`[data-verse="${activeVerse}"]`)
        : viewTab === "chapters" && activeChapter
          ? contentRef.current?.querySelector(`[data-chapter="${activeChapter}"]`)
          : null;
    target?.scrollIntoView({ block: "nearest" });
  }, [viewTab, activeVerse, activeChapter, selectedBook, selectedChapter]);

  // Filtered books list
  const filteredBooks = useMemo(() => {
    let list = books;
    if (testamentFilter !== "all") {
      list = list.filter((b) => b.testament === testamentFilter);
    }
    const q = searchQuery.trim().toLowerCase();
    if (q) {
      list = list.filter(
        (b) =>
          b.name.toLowerCase().includes(q) ||
          b.abbreviation.toLowerCase().includes(q) ||
          b.category.toLowerCase().includes(q),
      );
    }
    return list;
  }, [books, testamentFilter, searchQuery]);

  // Group filtered books by category
  const categories = useMemo(() => {
    const map = new Map<string, CanonicalBook[]>();
    for (const b of filteredBooks) {
      const cat = b.category;
      if (!map.has(cat)) {
        map.set(cat, []);
      }
      map.get(cat)!.push(b);
    }
    return Array.from(map.entries());
  }, [filteredBooks]);

  const handleBookClick = (book: CanonicalBook) => {
    setSelectedBook(book);
    setSelectedChapter(1);
    setViewTab("chapters");
  };

  const handleChapterClick = (chapterNum: number) => {
    if (!selectedBook) return;
    setSelectedChapter(chapterNum);
    setViewTab("verses");
    // Also notify passage selection without specific verse so reading view updates immediately
    onSelectPassage(selectedBook.name, chapterNum, null);
  };

  const handleVerseClick = (verseNum: number) => {
    if (!selectedBook) return;
    onSelectPassage(selectedBook.name, selectedChapter, verseNum);
  };

  const handleShowAllVerses = () => {
    if (!selectedBook) return;
    onSelectPassage(selectedBook.name, selectedChapter, null);
  };

  const currentBookChapters = selectedBook?.chapters ?? 1;
  const chapterArray = useMemo(() => {
    return Array.from({ length: currentBookChapters }, (_, i) => i + 1);
  }, [currentBookChapters]);

  // Calculate verse count for currently selected book and chapter
  const currentChapterVerseCount = useMemo(() => {
    if (!selectedBook) return 30;
    return getCanonicalVerseCount(selectedBook.name, selectedChapter);
  }, [selectedBook, selectedChapter]);

  const verseArray = useMemo(() => {
    return Array.from({ length: currentChapterVerseCount }, (_, i) => i + 1);
  }, [currentChapterVerseCount]);

  const isCurrentActive = (book: CanonicalBook) =>
    activeBookName?.toLowerCase() === book.name.toLowerCase();

  return (
    <div
      className={cn(
        "flex h-full flex-col border-r border-border/60 bg-card/60 select-none",
        className,
      )}
    >
      {/* Top Header & 3-Tab Segmented Controls: Books | Chapters | Verses */}
      <div className="shrink-0 border-b border-border/50 p-2.5 space-y-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5 text-xs font-semibold text-foreground">
            <BookOpen className="h-4 w-4 text-primary" />
            <span>Bible Browser</span>
          </div>

          {/* Quick Tab Switcher: Books | Chapters | Verses */}
          <div className="flex items-center rounded-md bg-muted/60 p-0.5 text-[11px]">
            <button
              type="button"
              onClick={() => setViewTab("books")}
              className={cn(
                "rounded px-2 py-0.5 font-medium transition",
                viewTab === "books"
                  ? "bg-background text-foreground shadow-xs"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              Books
            </button>
            <button
              type="button"
              onClick={() => setViewTab("chapters")}
              className={cn(
                "rounded px-2 py-0.5 font-medium transition",
                viewTab === "chapters"
                  ? "bg-background text-foreground shadow-xs"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              Chapters
            </button>
            <button
              type="button"
              onClick={() => setViewTab("verses")}
              className={cn(
                "rounded px-2 py-0.5 font-medium transition",
                viewTab === "verses"
                  ? "bg-background text-foreground shadow-xs"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              Verses
            </button>
          </div>
        </div>

        {viewTab === "books" ? (
          <>
            {/* Search Input for Books */}
            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Filter books (e.g. Genesis, Rom)..."
                className="h-7 w-full rounded-md bg-background/80 pl-8 pr-7 text-xs text-foreground placeholder:text-muted-foreground/60 border border-input focus:outline-hidden focus:ring-1 focus:ring-primary"
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => setSearchQuery("")}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                >
                  <X className="h-3 w-3" />
                </button>
              )}
            </div>

            {/* Testament Filter Pills */}
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => setTestamentFilter("all")}
                className={cn(
                  "flex-1 rounded-sm py-0.5 text-[10px] font-semibold transition text-center",
                  testamentFilter === "all"
                    ? "bg-primary/15 text-primary border border-primary/30"
                    : "text-muted-foreground hover:bg-muted/40",
                )}
              >
                All (66)
              </button>
              <button
                type="button"
                onClick={() => setTestamentFilter("OT")}
                className={cn(
                  "flex-1 rounded-sm py-0.5 text-[10px] font-semibold transition text-center",
                  testamentFilter === "OT"
                    ? "bg-primary/15 text-primary border border-primary/30"
                    : "text-muted-foreground hover:bg-muted/40",
                )}
              >
                Old Test. (39)
              </button>
              <button
                type="button"
                onClick={() => setTestamentFilter("NT")}
                className={cn(
                  "flex-1 rounded-sm py-0.5 text-[10px] font-semibold transition text-center",
                  testamentFilter === "NT"
                    ? "bg-primary/15 text-primary border border-primary/30"
                    : "text-muted-foreground hover:bg-muted/40",
                )}
              >
                New Test. (27)
              </button>
            </div>
          </>
        ) : viewTab === "chapters" ? (
          /* Chapters Header: Breadcrumb & Back */
          <div className="flex items-center justify-between pt-0.5">
            <button
              type="button"
              onClick={() => setViewTab("books")}
              className="inline-flex items-center gap-1 text-[11px] font-medium text-primary hover:underline"
            >
              <ArrowLeft className="h-3 w-3" />
              <span>Back to Books</span>
            </button>
            <span className="text-[10px] text-muted-foreground font-medium">
              {selectedBook?.name} ({currentBookChapters} Ch)
            </span>
          </div>
        ) : (
          /* Verses Header: Breadcrumb & Back */
          <div className="flex items-center justify-between pt-0.5">
            <button
              type="button"
              onClick={() => setViewTab("chapters")}
              className="inline-flex items-center gap-1 text-[11px] font-medium text-primary hover:underline"
            >
              <ArrowLeft className="h-3 w-3" />
              <span>Back to Chapters</span>
            </button>
            <span className="text-[10px] text-muted-foreground font-medium">
              {selectedBook?.name} {selectedChapter} ({currentChapterVerseCount} v)
            </span>
          </div>
        )}
      </div>

      {/* Main Content Area: Books List, Chapter Grid, or Verse Grid */}
      <div ref={contentRef} className="custom-scrollbar flex-1 overflow-y-auto p-2">
        {viewTab === "books" ? (
          <div className="space-y-3">
            {categories.length === 0 ? (
              <div className="py-6 text-center text-xs text-muted-foreground">
                No matching books found
              </div>
            ) : (
              categories.map(([category, catBooks]) => (
                <div key={category} className="space-y-1">
                  <div className="flex items-center gap-1.5 px-1 py-0.5">
                    <Layers className="h-3 w-3 text-muted-foreground/60" />
                    <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground/70">
                      {category}
                    </span>
                  </div>

                  <div className="grid grid-cols-1 gap-0.5">
                    {catBooks.map((book) => {
                      const isActive = isCurrentActive(book);
                      const isSelected =
                        selectedBook?.name.toLowerCase() === book.name.toLowerCase();

                      return (
                        <button
                          key={book.id}
                          type="button"
                          onClick={() => handleBookClick(book)}
                          className={cn(
                            "group flex w-full items-center justify-between rounded-md px-2.5 py-1.5 text-left text-xs transition",
                            isActive
                              ? "bg-primary/20 text-primary font-semibold ring-1 ring-primary/40"
                              : isSelected
                                ? "bg-muted text-foreground font-medium"
                                : "text-muted-foreground hover:bg-muted/50 hover:text-foreground",
                          )}
                        >
                          <div className="flex items-center gap-2">
                            <span className="truncate">{book.name}</span>
                            {isActive && (
                              <span className="rounded-xs bg-primary px-1 py-0.2 text-[9px] font-bold text-primary-foreground leading-none">
                                ACTIVE
                              </span>
                            )}
                          </div>

                          <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground/70 group-hover:text-muted-foreground">
                            <span>{book.chapters} ch</span>
                            <ChevronRight className="h-3 w-3 opacity-60 group-hover:opacity-100 transition" />
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))
            )}
          </div>
        ) : viewTab === "chapters" ? (
          /* Chapters Grid View */
          <div className="space-y-2.5">
            {selectedBook && (
              <div className="rounded-lg border border-border/60 bg-background/50 p-2.5">
                <div className="flex items-center justify-between">
                  <h4 className="text-sm font-bold text-foreground">
                    {selectedBook.name}
                  </h4>
                  <span className="rounded-xs bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
                    {selectedBook.testament} · {selectedBook.category}
                  </span>
                </div>
                <p className="mt-0.5 text-[11px] text-muted-foreground">
                  Select a chapter to jump to verses:
                </p>
              </div>
            )}

            {/* Grid of Chapter Numbers */}
            <div className="grid grid-cols-5 gap-1.5 sm:grid-cols-6">
              {chapterArray.map((chNum) => {
                const isActive =
                  selectedBook?.name.toLowerCase() === activeBookName?.toLowerCase() &&
                  activeChapter === chNum;

                return (
                  <button
                    key={chNum}
                    type="button"
                    data-chapter={chNum}
                    onClick={() => handleChapterClick(chNum)}
                    className={cn(
                      "flex aspect-square items-center justify-center rounded-md text-xs font-semibold transition",
                      isActive
                        ? "bg-primary text-primary-foreground shadow-sm ring-2 ring-primary/40 scale-105"
                        : "border border-border/50 bg-background text-foreground hover:border-primary/50 hover:bg-primary/10 hover:text-primary",
                    )}
                  >
                    {chNum}
                  </button>
                );
              })}
            </div>
          </div>
        ) : (
          /* Verses Grid View */
          <div className="space-y-2.5">
            {selectedBook && (
              <div className="rounded-lg border border-border/60 bg-background/50 p-2.5 space-y-1.5">
                <div className="flex items-center justify-between">
                  <h4 className="text-sm font-bold text-foreground">
                    {selectedBook.name} {selectedChapter}
                  </h4>
                  <button
                    type="button"
                    onClick={handleShowAllVerses}
                    className="inline-flex items-center gap-1 rounded bg-primary/10 px-2 py-0.5 text-[10px] font-semibold text-primary hover:bg-primary/20 transition"
                  >
                    <span>All Verses</span>
                  </button>
                </div>
                <p className="text-[11px] text-muted-foreground">
                  Select a verse to jump directly to reading & presentation:
                </p>
              </div>
            )}

            {/* Grid of Verse Numbers */}
            <div className="grid grid-cols-5 gap-1.5 sm:grid-cols-6">
              {verseArray.map((vNum) => {
                const isSelected =
                  selectedBook?.name.toLowerCase() === activeBookName?.toLowerCase() &&
                  activeChapter === selectedChapter &&
                  activeVerse === vNum;

                return (
                  <button
                    key={vNum}
                    type="button"
                    data-verse={vNum}
                    onClick={() => handleVerseClick(vNum)}
                    className={cn(
                      "flex aspect-square items-center justify-center rounded-md text-xs font-semibold transition",
                      isSelected
                        ? "bg-primary text-primary-foreground shadow-sm ring-2 ring-primary/40 scale-105"
                        : "border border-border/50 bg-background text-foreground hover:border-primary/50 hover:bg-primary/10 hover:text-primary",
                    )}
                  >
                    {vNum}
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {/* Footer Info / Selected Passage Status */}
      {selectedBook && (
        <div className="shrink-0 border-t border-border/40 p-2 bg-muted/20 flex items-center justify-between text-[11px] text-muted-foreground">
          <span className="font-medium text-foreground truncate">
            {selectedBook.name} {selectedChapter ? `Ch ${selectedChapter}` : ""} {activeVerse ? `:${activeVerse}` : ""}
          </span>
          <span className="text-[10px]">{selectedBook.testament === "OT" ? "Old Testament" : "New Testament"}</span>
        </div>
      )}
    </div>
  );
}
