/**
 * Verses preachers quote most, most quoted first: which one to suggest when
 * the first words said open several verses alike. "In the beginning" opens
 * Genesis 1:1, John 1:1 and two verses of Jeremiah; the box suggests Genesis
 * 1:1, and the next words ("was the Word") change it if it was another.
 *
 * Only ever a suggestion, in the box (`suggestedFrom`, `verse-search-index.mjs`):
 * nothing goes on screen for being on this list.
 */
const WELL_KNOWN = [
  "John 3:16", "Jeremiah 29:11", "Romans 8:28", "Philippians 4:13", "Genesis 1:1", "Proverbs 3:5",
  "Proverbs 3:6", "Romans 12:2", "Philippians 4:6", "Matthew 28:19", "Ephesians 2:8", "Galatians 5:22",
  "Romans 12:1", "John 10:10", "Isaiah 41:10", "Psalms 23:1", "John 14:6", "Romans 3:23", "Matthew 6:33",
  "Romans 6:23", "Joshua 1:9", "2 Timothy 3:16", "Isaiah 40:31", "Romans 5:8", "John 1:1", "Hebrews 11:1",
  "2 Corinthians 5:17", "Philippians 4:7", "Matthew 11:28", "1 John 1:9", "Psalms 46:10", "Galatians 2:20",
  "Ephesians 2:9", "Romans 10:9", "John 11:35", "Psalms 119:105", "Hebrews 12:2", "Isaiah 53:5",
  "Matthew 5:16", "1 Corinthians 13:4", "Romans 15:13", "1 Peter 5:7", "Psalms 37:4", "Proverbs 22:6",
  "Isaiah 54:17", "1 John 4:4", "Romans 10:17", "Matthew 7:7", "Psalms 91:1", "Psalms 27:1",
  "2 Chronicles 7:14", "Lamentations 3:22", "Lamentations 3:23", "Micah 6:8", "James 1:2", "John 14:27",
  "John 15:13", "John 8:32", "Acts 1:8", "Acts 2:38", "Matthew 22:37", "Matthew 5:14", "Matthew 6:9",
  "Psalms 121:1", "Psalms 139:14", "Psalms 118:24", "Psalms 34:8", "Psalms 51:10", "Proverbs 18:10",
  "Isaiah 9:6", "Isaiah 26:3", "Isaiah 43:2", "Ecclesiastes 3:1", "Deuteronomy 31:6", "Genesis 1:27",
  "Genesis 2:24", "Genesis 1:3", "Exodus 20:3", "Numbers 6:24", "Malachi 3:10", "Mark 16:15", "Luke 1:37",
  "John 13:34", "John 1:14", "Romans 1:16", "Romans 8:1", "Romans 8:38", "1 Corinthians 10:13",
  "1 Corinthians 13:13", "2 Corinthians 12:9", "Galatians 6:9", "Ephesians 6:10", "Ephesians 6:11",
  "Ephesians 3:20", "Philippians 1:6", "Philippians 4:4", "Philippians 4:19", "Colossians 3:23",
  "1 Thessalonians 5:16", "1 Thessalonians 5:17", "1 Thessalonians 5:18", "2 Timothy 1:7", "Hebrews 4:12",
  "Hebrews 13:8", "Hebrews 11:6", "James 1:5", "James 4:7", "1 Peter 2:9", "1 John 4:8", "1 John 4:19",
  "Revelation 3:20", "Revelation 21:4", "Revelation 22:13", "Psalms 100:4", "Psalms 103:1", "Psalms 150:6",
  "Psalms 23:4", "Psalms 19:14", "Psalms 16:11", "Joel 2:28", "Zechariah 4:6", "Habakkuk 2:4",
  "Nehemiah 8:10", "Job 19:25", "Isaiah 60:1", "Isaiah 40:8", "Matthew 18:20", "Matthew 24:35",
  "Mark 11:24", "Mark 10:27", "Luke 6:38", "John 3:3", "John 4:24", "John 6:63", "John 14:1", "Acts 4:12",
  "Acts 16:31", "Romans 8:31", "Romans 8:37", "Romans 13:8", "Galatians 5:1", "Ephesians 4:32",
  "Ephesians 5:25", "Philippians 2:5", "Colossians 3:2", "Hebrews 10:25", "James 5:16", "1 Peter 5:8",
  "2 Peter 3:9", "1 John 3:1", "3 John 1:2", "Jude 1:24",
];

/**
 * A book's id as `import-pipeline.ts` makes it (its name, lower case, no
 * spaces), cut to five letters: "Psalm" and "Psalms", "Revelation" and
 * "Revelations" are one book, and no two of the sixty-six are.
 */
const bookKey = (bookIdOrName) => String(bookIdOrName).toLowerCase().replace(/\s+/g, "").slice(0, 5);

const RANKS = new Map(
  WELL_KNOWN.map((reference, rank) => {
    const [, book, chapter, verse] = reference.match(/^(.+) (\d+):(\d+)$/);
    return [`${bookKey(book)}|${chapter}|${verse}`, rank];
  }),
);

/** Where a verse is on the list, most quoted first; `null` when it is not on it. */
export function wellKnownRank(verse) {
  return RANKS.get(`${bookKey(verse.bookId ?? verse.bookName)}|${verse.chapter}|${verse.verse}`) ?? null;
}
