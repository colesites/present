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

function tool(name: string, args: Record<string, unknown> = {}): AiToolCall {
  return { id: id(), name, arguments: args };
}

function hasAny(text: string, values: string[]) {
  return values.some((value) => text.includes(value));
}

function wantsOff(text: string) {
  return /\b(turn off|switch off|hide|remove|disable|stop showing|clear|close)\b/.test(text);
}

function wantsOn(text: string) {
  return /\b(turn on|switch on|show|display|enable|start showing|bring back|open)\b/.test(text);
}

function wantsToggle(text: string) {
  return /\b(toggle|switch)\b/.test(text);
}

function panelFromText(text: string): string | null {
  if (/\b(search|global search|find panel|search panel)\b/.test(text)) return "search";
  if (/\b(bible|scripture|verse panel|scripture panel)\b/.test(text)) return "scripture";
  if (/\b(library|libraries|song library|shows|schedule|service schedule|notes)\b/.test(text)) {
    return "library";
  }
  if (/\b(media panel|media library|background panel|video panel)\b/.test(text)) return "media";
  if (/\b(edit|editor|edit mode|lyrics editor)\b/.test(text)) return "edit";
  if (/\b(settings|preferences)\b/.test(text)) return "settings";
  if (/\b(browser|web browser|browser mode)\b/.test(text)) return "browser";
  return null;
}

function sidebarTabFromText(text: string): string | null {
  if (/\b(audio|music|sound)\b/.test(text)) return "audio";
  if (/\b(text tab|lyrics tab|words tab)\b/.test(text)) return "text";
  if (/\b(timer tab|countdown tab)\b/.test(text)) return "timer";
  if (/\b(messages? tab|announcements? tab)\b/.test(text)) return "messages";
  if (/\b(layers? tab|props? tab)\b/.test(text)) return "layers";
  if (/\b(masters? tab|templates? tab)\b/.test(text)) return "masters";
  return null;
}

function displayFromText(text: string): string | null {
  if (/\b(output window|output display|audience display|main display|projector|audience screen)\b/.test(text)) {
    return "output";
  }
  if (/\b(stage window|stage display|confidence monitor|confidence display)\b/.test(text)) {
    return "stage";
  }
  if (/\b(looks window|looks display)\b/.test(text)) return "looks";
  if (/\b(screen composer|composer window|composer display)\b/.test(text)) return "composer";
  return null;
}

export function parseOperatorIntent(
  transcript: string,
  memory: AiOperatorSessionMemory,
): AiToolCall | null {
  const text = transcript.toLowerCase().replace(/\s+/g, " ").trim();
  if (!text) return null;

  const display = displayFromText(text);
  if (display && wantsOff(text)) {
    return tool("close_display", { display });
  }
  if (display && wantsOn(text)) {
    return tool("open_display", { display });
  }

  const sidebarTab = sidebarTabFromText(text);
  if (sidebarTab && (wantsOn(text) || /\bgo to\b/.test(text))) {
    return tool("open_sidebar_tab", { tab: sidebarTab });
  }

  const panel = panelFromText(text);
  if (panel && wantsOff(text)) {
    return tool("close_panel", { panel });
  }
  if (panel && (wantsOn(text) || /\b(go to|switch to)\b/.test(text))) {
    return tool("open_panel", { panel });
  }

  if (/\b(edit mode|editor mode)\b/.test(text)) {
    return tool("set_view_mode", { mode: "edit" });
  }
  if (/\b(show mode|presentation mode|present mode)\b/.test(text)) {
    return tool("set_view_mode", { mode: "show" });
  }

  if (/\b(grid|grid view)\b/.test(text)) {
    if (wantsToggle(text)) return tool("toggle_slide_grid");
    return tool("set_slide_grid", { visible: !wantsOff(text) });
  }
  if (/\b(single slide|single view|list view)\b/.test(text)) {
    return tool("set_slide_grid", { visible: false });
  }

  if (hasAny(text, ["text", "lyrics", "words"])) {
    if (wantsToggle(text)) return tool("toggle_text");
    if (wantsOff(text)) return tool("set_text_visibility", { enabled: false });
    if (wantsOn(text)) return tool("set_text_visibility", { enabled: true });
  }

  if (/\b(media layer|media output|media on output|video layer)\b/.test(text)) {
    if (wantsToggle(text)) return tool("toggle_media");
    if (wantsOff(text)) return tool("set_media_visibility", { enabled: false });
    if (wantsOn(text)) return tool("set_media_visibility", { enabled: true });
  }

  if (/\b(background|backgrounds)\b/.test(text) && !/\bchange|switch to|use\b/.test(text)) {
    if (wantsToggle(text)) return tool("toggle_background");
    if (wantsOff(text)) return tool("set_background_visibility", { enabled: false });
    if (wantsOn(text)) return tool("set_background_visibility", { enabled: true });
  }

  if (/\b(unfreeze|un frozen|resume output)\b/.test(text)) {
    return tool("set_output_freeze", { enabled: false });
  }
  if (/\b(freeze|hold output|lock output)\b/.test(text)) {
    if (wantsToggle(text)) return tool("toggle_output_freeze");
    return tool("set_output_freeze", { enabled: true });
  }

  if (/\b(timer layer|timer overlay|countdown layer|countdown overlay)\b/.test(text)) {
    if (wantsToggle(text)) return tool("toggle_timer_layer");
    if (wantsOff(text)) return tool("set_timer_layer", { enabled: false });
    if (wantsOn(text)) return tool("set_timer_layer", { enabled: true });
  }

  if (/\b(message layer|message overlay|messages layer|messages overlay)\b/.test(text)) {
    if (wantsToggle(text)) return tool("toggle_message_layer");
    if (wantsOff(text)) return tool("set_message_layer", { enabled: false });
    if (wantsOn(text)) return tool("set_message_layer", { enabled: true });
  }

  if (/\b(next|advance|forward)\b.*\b(slide|screen)?\b/.test(text) || text === "next") {
    return tool("next_slide");
  }

  if (/\b(previous|back|go back)\b.*\b(slide|screen)?\b/.test(text)) {
    return tool("previous_slide");
  }

  const goToSlide = text.match(/\b(?:go to|jump to|show)\s+slide\s+(\d+)\b/);
  if (goToSlide) {
    return tool("go_to_slide", { slide: Number.parseInt(goToSlide[1] ?? "1", 10) });
  }

  const bibleReference = parseBibleReference(text, memory);
  if (bibleReference) {
    return tool("open_bible_verse", { reference: bibleReference });
  }

  if (/\b(countdown|timer)\b/.test(text) && /\b(start|set|begin)\b/.test(text)) {
    return tool("start_countdown", { seconds: parseCountdownSeconds(text) ?? 300 });
  }

  if (/\b(stop|pause)\b.*\b(countdown|timer)\b/.test(text)) {
    return tool("stop_countdown");
  }

  if (/\b(reset|restart)\b.*\b(countdown|timer)\b/.test(text)) {
    return tool("reset_countdown");
  }

  if (/\b(open|show)\b.*\b(settings)\b/.test(text)) {
    return tool("open_settings");
  }

  if (/\b(open|show)\b.*\b(library)\b/.test(text)) {
    return tool("open_library");
  }

  if (/\b(open|show)\b.*\b(notes|schedule|service)\b/.test(text)) {
    return tool("open_schedule");
  }

  const background = text.match(/\b(?:switch to|change to|use|show)\s+(.+?)\s+background\b/);
  if (background) {
    return tool("change_background", { background: cleanTitle(background[1] ?? "") });
  }

  const media = text.match(/\b(?:play|show|open)\s+(.+?)\s+(?:video|media)\b/);
  if (media) {
    return tool("play_video", { media: cleanTitle(media[1] ?? "") });
  }

  const section = text.match(/\b(?:start|take|begin)\s+(?:it|song|that)?\s*(?:from|at)?\s*(the\s+)?(chorus|bridge|verse\s+\d+|ending|intro|outro)\b/);
  if (section && memory.currentSong?.title) {
    return tool("open_song", {
        song: memory.currentSong.title,
        section: (section[2] ?? "").trim(),
      });
  }

  const song = text.match(/\b(?:open|load|sing|play|let'?s sing|can you open|could you open)\s+(.+)\b/);
  if (song) {
    return tool("open_song", { song: cleanTitle(song[1] ?? "") });
  }

  return null;
}
