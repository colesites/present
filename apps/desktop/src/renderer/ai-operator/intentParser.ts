import type { AiOperatorSessionMemory, AiToolCall } from "../../shared/ai-operator/types";

const bibleBooks = [
  "genesis",
  "exodus",
  "leviticus",
  "numbers",
  "deuteronomy",
  "joshua",
  "judges",
  "ruth",
  "samuel",
  "kings",
  "chronicles",
  "ezra",
  "nehemiah",
  "esther",
  "job",
  "psalms",
  "proverbs",
  "ecclesiastes",
  "song of solomon",
  "isaiah",
  "jeremiah",
  "lamentations",
  "ezekiel",
  "daniel",
  "hosea",
  "joel",
  "amos",
  "obadiah",
  "jonah",
  "micah",
  "nahum",
  "habakkuk",
  "zephaniah",
  "haggai",
  "zechariah",
  "malachi",
  "matthew",
  "mark",
  "luke",
  "john",
  "acts",
  "romans",
  "corinthians",
  "galatians",
  "ephesians",
  "philippians",
  "colossians",
  "thessalonians",
  "timothy",
  "titus",
  "philemon",
  "hebrews",
  "james",
  "peter",
  "jude",
  "revelation",
];

const numberWords: Record<string, number> = {
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  eleven: 11,
  twelve: 12,
  thirteen: 13,
  fourteen: 14,
  fifteen: 15,
  sixteen: 16,
  seventeen: 17,
  eighteen: 18,
  nineteen: 19,
  twenty: 20,
  thirty: 30,
  forty: 40,
  fifty: 50,
  sixty: 60,
};

function id() {
  return crypto.randomUUID();
}

function cleanTitle(value: string) {
  return value
    .replace(/^(please\s+)?(can you\s+)?(could you\s+)?(let'?s\s+)?/i, "")
    .replace(/^(open|load|search for|find|queue|start|sing|play)\s+/i, "")
    .replace(/\s+(please|for me)$/i, "")
    .trim();
}

function parseNumber(value: string): number | null {
  const normalized = value.toLowerCase().trim();
  const numeric = Number.parseInt(normalized, 10);
  if (Number.isFinite(numeric)) return numeric;
  return numberWords[normalized] ?? null;
}

function parseCountdownSeconds(text: string): number | null {
  const match = text.match(/(\d+|[a-z]+)\s*(second|seconds|minute|minutes|hour|hours)/i);
  if (!match) return null;
  const amount = parseNumber(match[1] ?? "");
  if (!amount) return null;
  const unit = match[2]?.toLowerCase() ?? "minutes";
  if (unit.startsWith("second")) return amount;
  if (unit.startsWith("hour")) return amount * 3600;
  return amount * 60;
}

function parseBibleReference(text: string, memory: AiOperatorSessionMemory): string | null {
  const normalized = text.toLowerCase();
  const explicit = normalized.match(
    /\b(?:show|open|load)?\s*((?:1|2|3)?\s*[a-z ]+?)\s+(?:chapter\s+)?(\d+)(?:\s*(?::|verse\s+)\s*(\d+))?\b/,
  );

  if (explicit) {
    const bookCandidate = (explicit[1] ?? "").trim();
    if (bibleBooks.some((book) => bookCandidate.endsWith(book))) {
      const chapter = explicit[2];
      const verse = explicit[3];
      return `${bookCandidate} ${chapter}${verse ? `:${verse}` : ""}`;
    }
  }

  const verseOnly = normalized.match(/\b(?:show|open|load)?\s*verse\s+(\d+)\b/);
  if (verseOnly && memory.currentBible?.book && memory.currentBible.chapter) {
    return `${memory.currentBible.book} ${memory.currentBible.chapter}:${verseOnly[1]}`;
  }

  return null;
}

export function parseOperatorIntent(
  transcript: string,
  memory: AiOperatorSessionMemory,
): AiToolCall | null {
  const text = transcript.toLowerCase().replace(/\s+/g, " ").trim();
  if (!text) return null;

  if (/\b(next|advance|forward)\b.*\b(slide|screen)?\b/.test(text) || text === "next") {
    return { id: id(), name: "next_slide", arguments: {} };
  }

  if (/\b(previous|back|go back)\b.*\b(slide|screen)?\b/.test(text)) {
    return { id: id(), name: "previous_slide", arguments: {} };
  }

  const goToSlide = text.match(/\b(?:go to|jump to|show)\s+slide\s+(\d+)\b/);
  if (goToSlide) {
    return {
      id: id(),
      name: "go_to_slide",
      arguments: { slide: Number.parseInt(goToSlide[1] ?? "1", 10) },
    };
  }

  const bibleReference = parseBibleReference(text, memory);
  if (bibleReference) {
    return {
      id: id(),
      name: "open_bible_verse",
      arguments: { reference: bibleReference },
    };
  }

  if (/\b(countdown|timer)\b/.test(text) && /\b(start|set|begin)\b/.test(text)) {
    return {
      id: id(),
      name: "start_countdown",
      arguments: { seconds: parseCountdownSeconds(text) ?? 300 },
    };
  }

  if (/\b(stop|pause)\b.*\b(countdown|timer)\b/.test(text)) {
    return { id: id(), name: "stop_countdown", arguments: {} };
  }

  if (/\b(reset|restart)\b.*\b(countdown|timer)\b/.test(text)) {
    return { id: id(), name: "reset_countdown", arguments: {} };
  }

  if (/\b(open|show)\b.*\b(settings)\b/.test(text)) {
    return { id: id(), name: "open_settings", arguments: {} };
  }

  if (/\b(open|show)\b.*\b(library)\b/.test(text)) {
    return { id: id(), name: "open_library", arguments: {} };
  }

  if (/\b(open|show)\b.*\b(notes|schedule|service)\b/.test(text)) {
    return { id: id(), name: "open_schedule", arguments: {} };
  }

  const background = text.match(/\b(?:switch to|change to|use|show)\s+(.+?)\s+background\b/);
  if (background) {
    return {
      id: id(),
      name: "change_background",
      arguments: { background: cleanTitle(background[1] ?? "") },
    };
  }

  const media = text.match(/\b(?:play|show|open)\s+(.+?)\s+(?:video|media)\b/);
  if (media) {
    return {
      id: id(),
      name: "play_video",
      arguments: { media: cleanTitle(media[1] ?? "") },
    };
  }

  const section = text.match(/\b(?:start|take|begin)\s+(?:it|song|that)?\s*(?:from|at)?\s*(the\s+)?(chorus|bridge|verse\s+\d+|ending|intro|outro)\b/);
  if (section && memory.currentSong?.title) {
    return {
      id: id(),
      name: "open_song",
      arguments: {
        song: memory.currentSong.title,
        section: (section[2] ?? "").trim(),
      },
    };
  }

  const song = text.match(/\b(?:open|load|sing|play|let'?s sing|can you open|could you open)\s+(.+)\b/);
  if (song) {
    return {
      id: id(),
      name: "open_song",
      arguments: { song: cleanTitle(song[1] ?? "") },
    };
  }

  return null;
}
