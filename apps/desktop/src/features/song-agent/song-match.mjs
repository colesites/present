// @ts-check

/**
 * Which song is being sung, and where in it the singers are.
 *
 * Speech recognition of singing is rough: words come out wrong ("rich" for
 * "wretch"), run together or go missing, and a band repeats a chorus as
 * often as it likes. So the singing is followed the way a musician follows a
 * lyric sheet: the words heard are lined up against the song's words, in
 * order, a word counting when it is spelt or sounds the same. Where the
 * line-up ends is where the singers are.
 *
 * Because the order is known, one clear word is enough to move on: once the
 * end of a slide has been sung, the next slide's first real word says the
 * singers are on it. Going anywhere else (back to the chorus, past a verse)
 * takes a few words in order, so a stray word never jumps the slide.
 *
 * Kept apart from React so it can be tested, and replayed against
 * recordings of singing (`tests/song-agent-eval`).
 */

/**
 * @typedef {{ text: string, label?: string | null, modifier?: string | null, sectionRepeat?: string | null }} SongSlideInput
 * @typedef {{ id: string, title: string, slides: SongSlideInput[] }} SongInput
 * @typedef {{ text: string, sound: string, weight: number, slide: number }} SongWord
 * @typedef {{
 *   start: number, end: number, lastLine: number, endsOnce: boolean, section: number, chorus: boolean,
 *   verseEnd: boolean, sectionEnd: boolean, label: string | null,
 *   times: number, sectionTimes: number, mayRepeat: boolean,
 * }} SongSlide
 * @typedef {{ id: string, title: string, words: SongWord[], slides: SongSlide[], refrain: number }} PreparedSong
 * @typedef {{ text: string, sound: string, index: number }} HeardWord
 * @typedef {{
 *   slide: number,
 *   word: number,
 *   score: number,
 *   bySlide: Float64Array,
 *   evidence: number,
 *   firstHeard: number,
 *   latest: boolean,
 *   lastLineMissed: number,
 *   endRun: number,
 *   into: number,
 *   from: number,
 *   entry: "flow" | "jump" | "start",
 * }} Alignment
 */

/**
 * A text as the words the matcher compares: lower case, without section
 * markers ("[Chorus]", "[x2]"), apostrophes ("'twas" is "twas") or
 * punctuation. Letters of any language are kept.
 *
 * @param {string | null | undefined} text
 * @returns {string[]}
 */
export function wordsOf(text) {
  return String(text ?? "")
    .toLowerCase()
    .replace(/\[[^\]]*\]/g, " ")
    // Tags the speech service puts round what it hears sung ("<LYRICS>").
    .replace(/<[^>]*>/g, " ")
    .replace(/[’'`]/g, "")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter(Boolean);
}

/**
 * How an English word sounds, roughly: its consonants, spelt one way. Sung
 * words are often heard as others that sound alike ("rich" for "wretch",
 * "grays" for "grace", "saviour" for "savior"), and all of those come out
 * the same here. A word in another script is kept as it is.
 *
 * @param {string} word
 * @returns {string}
 */
export function soundOf(word) {
  const known = SOUNDS.get(word);
  if (known !== undefined) return known;
  const sound = soundOfWord(word);
  if (SOUNDS.size >= SOUNDS_KEPT) SOUNDS.clear();
  SOUNDS.set(word, sound);
  return sound;
}

/**
 * Sounds worked out before: a library's words, and the words heard, come
 * round again and again. Worked out afresh, they were half the time spent
 * indexing a library and searching it.
 */
const SOUNDS = new Map();
const SOUNDS_KEPT = 100_000;

/** @param {string} word */
function soundOfWord(word) {
  const letters = word.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
  if (!/^[a-z]+$/.test(letters)) return letters;
  const spelt = letters
    .replace(/^(kn|gn|pn|wr|ps)/, (start) => start[1])
    .replace(/^wh/, "w")
    .replace(/^x/, "s")
    .replace(/x/g, "ks")
    .replace(/tch/g, "ch")
    .replace(/dg(?=[eiy])/g, "j")
    .replace(/gh(?=t|$)/g, "")
    .replace(/ph/g, "f")
    .replace(/sch/g, "sk")
    .replace(/ch|sh/g, "X")
    .replace(/th/g, "0")
    .replace(/ck/g, "k")
    .replace(/c(?=[eiy])/g, "s")
    .replace(/[cq]/g, "k")
    .replace(/z/g, "s");
  const first = /[aeiouy]/.test(spelt[0]) ? "A" : spelt[0];
  const rest = spelt.slice(1).replace(/[aeiouyhw]/g, "");
  return `${first}${rest}`.replace(/(.)\1+/g, "$1");
}

/**
 * Whether `left` and `right` are within `most` edits of each other.
 *
 * @param {string} left
 * @param {string} right
 * @param {number} most
 */
function withinEdits(left, right, most) {
  if (Math.abs(left.length - right.length) > most) return false;
  let previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let i = 1; i <= left.length; i += 1) {
    const row = [i];
    let smallest = i;
    for (let j = 1; j <= right.length; j += 1) {
      const cost = left[i - 1] === right[j - 1] ? 0 : 1;
      const value = Math.min(previous[j] + 1, row[j - 1] + 1, previous[j - 1] + cost);
      row.push(value);
      smallest = Math.min(smallest, value);
    }
    if (smallest > most) return false;
    previous = row;
  }
  return previous[right.length] <= most;
}

/**
 * How surely a heard word is a word of the song: 1 spelt the same, less when
 * it only sounds the same or is spelt nearly the same, 0 when it is another
 * word.
 *
 * @param {{ text: string, sound: string }} heard
 * @param {{ text: string, sound: string }} sung
 * @returns {number}
 */
export function likeness(heard, sung) {
  if (heard.text === sung.text) return 1;
  if (heard.sound === sung.sound && heard.sound.length >= 2) return 0.85;
  if (Math.max(heard.text.length, sung.text.length) < 4) return 0;
  let known = LIKENESS.get(heard.text);
  if (!known) {
    if (LIKENESS.size >= LIKENESS_KEPT) LIKENESS.clear();
    LIKENESS.set(heard.text, (known = new Map()));
  }
  let value = known.get(sung.text);
  if (value === undefined) {
    value = likenessOf(heard, sung);
    known.set(sung.text, value);
  }
  return value;
}

/**
 * Likenesses worked out before, by heard word then by song word: the same
 * words heard are lined up against the same songs many times a second as a
 * line is sung.
 *
 * @type {Map<string, Map<string, number>>}
 */
const LIKENESS = new Map();
const LIKENESS_KEPT = 20_000;

/**
 * @param {{ text: string, sound: string }} heard
 * @param {{ text: string, sound: string }} sung
 */
function likenessOf(heard, sung) {
  if (heard.sound === sung.sound && heard.sound.length >= 2) return 0.85;
  const longest = Math.max(heard.text.length, sung.text.length);
  if (longest < 4) return 0;
  if (withinEdits(heard.text, sung.text, longest >= 7 ? 2 : 1)) return 0.7;
  const shortest = Math.min(heard.text.length, sung.text.length);
  if (shortest >= 4 && (heard.text.startsWith(sung.text) || sung.text.startsWith(heard.text))) {
    return 0.6;
  }
  return 0;
}

// Words in nearly every line of every song. Heard alone, they say little
// about where the singers are.
const COMMON = new Set(
  (
    "a an and are as at be but by for from he her him his how i in is it its me my no nor not o of oh on or " +
    "our so that the thee their them then there they thine this thou thy to us was we were what when who " +
    "will with ye yet you your"
  ).split(" "),
);

/** @param {string} word */
const weightOf = (word) => (word.length <= 2 || COMMON.has(word) ? 0.35 : 1);

/**
 * A heard word, ready to be compared.
 *
 * @param {string} text
 * @param {number} index
 * @returns {HeardWord}
 */
export const heardWord = (text, index) => ({ text, sound: soundOf(text), index });

/** Sections a band goes back to: a slide whose text comes again counts too. */
const CHORUS = /chorus|refrain|tag|vamp|hook/i;

/**
 * A song as the matcher follows it: every word in order, and where each
 * slide's words begin and end.
 *
 * @param {SongInput} song
 * @returns {PreparedSong}
 */
export function prepareSong(song) {
  /** @type {SongWord[]} */
  const words = [];
  const texts = song.slides.map((slide) => wordsOf(slide.text).join(" "));
  /** @type {Map<string, number>} */
  const times = new Map();
  for (const text of texts) if (text) times.set(text, (times.get(text) ?? 0) + 1);
  const labels = song.slides.map((slide) => slide.label?.trim().toLowerCase() || null);
  /** @type {SongSlide[]} */
  const slides = [];
  song.slides.forEach((slide, index) => {
    const start = words.length;
    let lastLine = start;
    for (const line of String(slide.text ?? "").split("\n")) {
      const said = wordsOf(line);
      if (said.length > 0) lastLine = words.length;
      for (const text of said) words.push({ text, sound: soundOf(text), weight: weightOf(text), slide: index });
    }
    const label = labels[index];
    // A section is a run of slides under one label; a slide without one is
    // a section by itself.
    const section = label && index > 0 && labels[index - 1] === label ? slides[index - 1].section : index;
    const chorus = CHORUS.test(label ?? "") || (times.get(texts[index]) ?? 0) > 1;
    // Whether the slide's last three words come only at its end: hearing
    // them then says it is ending ("end of time"), where an ending it sings
    // twice ("come home, come home … come home") says nothing.
    const ending = words.slice(Math.max(start, words.length - 3)).map((word) => word.text).join(" ");
    const before = words.slice(start, Math.max(start, words.length - 1)).map((word) => word.text).join(" ");
    const endsOnce = words.length - start >= 3 && !before.includes(ending);
    // Repeat marks as the library keeps them (`parseLyricsToSlides`): "x3"
    // on a line repeats its slide, on a section's label the section;
    // "Repeat", with no count, says it may be sung again.
    slides.push({
      start, end: words.length, lastLine, endsOnce, section, chorus, verseEnd: false, sectionEnd: false, label,
      times: repeatCount(slide.modifier),
      sectionTimes: repeatCount(slide.sectionRepeat),
      mayRepeat: isOpenRepeat(slide.modifier) || isOpenRepeat(slide.sectionRepeat),
    });
  });
  // A section's last slide with words, where a band goes on to the next
  // section or back to the chorus.
  const sections = new Map();
  slides.forEach((slide, index) => {
    if (slide.end > slide.start) sections.set(slide.section, index);
  });
  for (const last of sections.values()) {
    slides[last].verseEnd = !slides[last].chorus;
    slides[last].sectionEnd = true;
  }
  // A section repeats as its slides say: any count, any open "Repeat". A
  // section of one slide repeats as that slide does, sung again where it is:
  // its times are counted by its ending heard, as a line marked "x3" is.
  for (const slide of slides) {
    const own = slides.filter((other) => other.section === slide.section);
    slide.sectionTimes = Math.max(...own.map((other) => other.sectionTimes));
    slide.mayRepeat = own.some((other) => other.mayRepeat);
    if (own.length === 1 && slide.sectionTimes > 1) {
      slide.times = Math.max(slide.times, slide.sectionTimes);
      slide.sectionTimes = 1;
    }
  }
  // A chorus kept once, by its label, in a song with more than one verse:
  // the library leaves it to the operator to go back to after each verse.
  const choruses = [...sections.keys()].filter((section) => CHORUS.test(labels[section] ?? ""));
  const verses = [...sections.keys()].filter((section) => !slides[section].chorus);
  const once = choruses.length === 1 && verses.length > 1 ? choruses[0] : -1;
  const refrain = once >= 0 && texts.filter((text) => text === texts[once]).length === 1 ? once : -1;
  return { id: song.id, title: song.title, words, slides, refrain };
}

/**
 * How many times a repeat mark says to sing ("x3", "3x", "x 3"), or 1.
 *
 * @param {string | null | undefined} mark
 */
function repeatCount(mark) {
  const found = String(mark ?? "").replace(/\s+/g, "").toLowerCase().match(/^(?:x(\d+)|(\d+)x)$/);
  const times = found ? Number(found[1] ?? found[2]) : 1;
  return times >= 1 ? times : 1;
}

/**
 * A repeat mark with no count ("Repeat", "repeat chorus"): sung again,
 * how many times the band decides.
 *
 * @param {string | null | undefined} mark
 */
function isOpenRepeat(mark) {
  return /repeat/i.test(String(mark ?? "")) && repeatCount(mark) === 1;
}

/**
 * The slide after `index` that has words, or -1.
 *
 * @param {PreparedSong} song
 * @param {number} index
 */
export function nextSlideOf(song, index) {
  for (let next = index + 1; next < song.slides.length; next += 1) {
    if (song.slides[next].end > song.slides[next].start) return next;
  }
  return -1;
}

/** A heard word that isn't in the song: misheard, or said rather than sung. */
const HEARD_SKIP = 0.3;
/** A word of the song not heard: missed, or not sung. */
const SONG_SKIP = 0.2;
/** How many heard words in a row may be passed over. */
const MOST_SKIPPED = 3;
/**
 * How many of the song's words in a row may be passed over: a whole line,
 * which the speech service sometimes doesn't hear at all over a band.
 */
const MOST_PASSED = 8;

/**
 * What it costs to go from the end of slide `from` to the start of slide
 * `to` other than straight on: the more often bands do it, the less.
 *
 * @param {PreparedSong} song
 * @param {number} from
 * @param {number} to
 * @param {number} resume where the song goes on after a chorus it went back to
 * @param {number} planned where the worship leader said to go
 */
function jumpCost(song, from, to, resume, planned) {
  if (to === resume || to === planned) return 0;
  if (to === song.refrain && song.slides[from].verseEnd) return 0.3;
  if (to === from || to === song.slides[from].section) return 1;
  const target = song.slides[to];
  const ahead = aheadCost(from, to, song.slides.length);
  if (target.section !== to) return 2.5 + ahead;
  return (target.chorus ? 1.2 : 2) + ahead;
}

/**
 * A little more the further `to` is past `from`, going forward round the
 * song: of slides alike, the nearest ahead wins. Never as much as a word.
 *
 * @param {number} from
 * @param {number} to
 * @param {number} count
 */
function aheadCost(from, to, count) {
  const ahead = (to - from + count) % count;
  return Math.min(0.5, ahead * 0.02);
}

/**
 * Where in `song` the latest of the words heard are, lined up in order.
 *
 * Lining up may start anywhere, and passes over words heard that aren't in
 * the song and words of the song not heard, at a cost; it goes from the end
 * of one slide to the start of another as bands do (straight on, the same
 * again, back to the chorus), at a cost by how usual that is. Starting on
 * the slide showing (`current`) costs nothing, so a slide that matches no
 * better than it does is not where the singers are.
 *
 * @param {PreparedSong} song
 * @param {HeardWord[]} heard oldest first
 * @param {{ current?: number, resume?: number, planned?: number, since?: number, trailing?: number }} [options]
 *   `since`: only words heard from this index on count as evidence for the
 *   slide the line-up ends on.
 * @returns {Alignment | null}
 */
export function alignHeard(song, heard, options = {}) {
  const count = heard.length;
  const size = song.words.length;
  if (count === 0 || size === 0) return null;
  const current = options.current ?? -1;
  const resume = options.resume ?? -1;
  const planned = options.planned ?? -1;
  const since = options.since ?? -Infinity;
  const trailing = options.trailing ?? 1;
  const slideCount = song.slides.length;
  // Where the band goes from the slide showing, as songs usually go: on
  // from the verse it left for the chorus, if it did, else the next slide.
  const following = current >= 0 && resume < 0 ? nextSlideOf(song, current) : -1;
  // From anywhere in a verse, the chorus kept once is where it goes next:
  // the rest of the verse may not have been heard.
  const refrainNext = current >= 0 && !song.slides[current].chorus ? song.refrain : -1;

  // The singers can be anywhere in the slide showing, but on another slide
  // only from its start: its middle, heard first, is more likely the same
  // words somewhere else. Of slides alike (a chorus written out five times),
  // the one soonest after the slide showing: songs go forward. Taking the
  // first of them sent the slide back to the song's first chorus.
  /** @param {number} k */
  const startCost = (k) => {
    const slide = song.words[k].slide;
    if (current < 0 || slide === current) return 0;
    const middle = k - song.slides[slide].start >= 2 ? 1 : 0;
    if (slide === following || slide === resume || slide === refrainNext || slide === planned) return 0.4 + middle;
    if (slide === current - 1) return 0.6 + middle;
    return 1.5 + middle + aheadCost(current, slide, slideCount);
  };

  const gain = Array.from({ length: count }, () => new Float64Array(size));
  // A word heard as two ("shows in" for "chosen", "bless" "ed" for
  // "blessed"): the two together, when they sound like it.
  const joined = Array.from({ length: count }, () => new Float64Array(size));
  for (let i = 0; i < count; i += 1) {
    const together =
      i > 0 && heard[i - 1].text.length + heard[i].text.length <= 14
        ? heardWord(`${heard[i - 1].text}${heard[i].text}`, heard[i].index)
        : null;
    for (let k = 0; k < size; k += 1) {
      const word = song.words[k];
      gain[i][k] = likeness(heard[i], word) * word.weight;
      if (together && word.weight >= 1) {
        const like = likeness(together, word);
        if (like >= 0.85) joined[i][k] = like * word.weight;
      }
    }
  }
  // The gain each step of the best line-up took, and whether it took two
  // heard words for one.
  const taken = Array.from({ length: count }, () => new Float64Array(size));
  const pairs = Array.from({ length: count }, () => new Uint8Array(size));
  const score = Array.from({ length: count }, () => new Float64Array(size).fill(-Infinity));
  // Where each step came from: i * size + k, or -1 where the line-up starts.
  const back = Array.from({ length: count }, () => new Int32Array(size).fill(-1));
  // The best line-up ending near the end of each slide, by heard word.
  const ends = Array.from({ length: count }, () => new Float64Array(slideCount).fill(-Infinity));
  const endsAt = Array.from({ length: count }, () => new Int32Array(slideCount).fill(-1));

  for (let i = 0; i < count; i += 1) {
    for (let k = 0; k < size; k += 1) {
      if (gain[i][k] <= 0 && joined[i][k] <= 0) continue;
      const slide = song.words[k].slide;
      const into = k - song.slides[slide].start;
      let best = -Infinity;
      let from = -1;
      let took = 0;
      let pair = 0;
      // Reached with the gain of this heard word alone, from a step no later
      // than the one before it; or of it and the one before together, from a
      // step before those two.
      for (let joinedUp = 0; joinedUp <= 1; joinedUp += 1) {
        const g = joinedUp ? joined[i][k] : gain[i][k];
        if (g <= 0) continue;
        const last = i - 1 - joinedUp;
        let value = g - startCost(k);
        if (value > best) {
          best = value;
          from = -1;
          took = g;
          pair = joinedUp;
        }
        for (let i2 = last; i2 >= 0 && i2 >= last - MOST_SKIPPED; i2 -= 1) {
          const passed = HEARD_SKIP * (last - i2);
          const row = score[i2];
          for (let k2 = k - 1; k2 >= 0 && k2 >= k - 1 - MOST_PASSED; k2 -= 1) {
            if (row[k2] === -Infinity) continue;
            const leaving = song.words[k2].slide;
            // Out of a chorus the band went back to, the song goes on from the
            // verse it left, not from the slide after the chorus.
            const detour = resume >= 0 && leaving !== slide && song.slides[leaving].chorus && slide !== resume ? 0.5 : 0;
            value = row[k2] - passed - SONG_SKIP * (k - k2 - 1) - detour + g;
            if (value > best) {
              best = value;
              from = i2 * size + k2;
              took = g;
              pair = joinedUp;
            }
          }
          if (into < 2) {
            const ended = ends[i2];
            for (let leaving = 0; leaving < slideCount; leaving += 1) {
              if (ended[leaving] === -Infinity || song.slides[leaving].end === song.slides[slide].start) continue;
              value = ended[leaving] - passed - jumpCost(song, leaving, slide, resume, planned) - SONG_SKIP * into + g;
              if (value > best) {
                best = value;
                from = i2 * size + endsAt[i2][leaving];
                took = g;
                pair = joinedUp;
              }
            }
          }
        }
      }
      taken[i][k] = took;
      pairs[i][k] = pair;
      score[i][k] = best;
      back[i][k] = from;
    }
    for (let slide = 0; slide < slideCount; slide += 1) {
      const { start, end } = song.slides[slide];
      for (let k = Math.max(start, end - 2); k < end; k += 1) {
        const value = score[i][k] - SONG_SKIP * (end - 1 - k);
        if (value > ends[i][slide]) {
          ends[i][slide] = value;
          endsAt[i][slide] = k;
        }
      }
    }
  }

  // Ends on the latest word, or one before it when the latest is not in the
  // song (misheard as the singer holds a note); in finding which song it is
  // (`trailing`), up to three before, each costing what a heard word passed
  // over does. Ending only on the latest two, a line sung right but ending in
  // "of a dem" was lined up with any song that has an "a" in it.
  const bySlide = new Float64Array(slideCount).fill(-Infinity);
  let bestScore = -Infinity;
  let bestI = -1;
  let bestK = -1;
  for (let i = Math.max(0, count - 1 - trailing); i < count; i += 1) {
    const trailing = HEARD_SKIP * (count - 1 - i);
    for (let k = 0; k < size; k += 1) {
      const value = score[i][k] - trailing;
      if (value === -Infinity) continue;
      const slide = song.words[k].slide;
      if (value > bySlide[slide]) bySlide[slide] = value;
      // Of equal line-ups, the one on the slide showing, then the latest word.
      if (value > bestScore + 1e-9 || (Math.abs(value - bestScore) <= 1e-9 && slide === current)) {
        bestScore = value;
        bestI = i;
        bestK = k;
      }
    }
  }
  if (bestK < 0) return null;

  // Back along the line-up: what it heard on the slide it ends on, and how
  // it got there.
  const slide = song.words[bestK].slide;
  let evidence = 0;
  let i = bestI;
  let k = bestK;
  let lastInSlide = bestK;
  let firstHeard = heard[bestI].index;
  let previous = -1;
  const matched = new Set();
  while (i >= 0 && k >= 0) {
    if (song.words[k].slide !== slide) {
      previous = k;
      break;
    }
    if (heard[i].index >= since) evidence += taken[i][k];
    matched.add(k);
    lastInSlide = k;
    firstHeard = heard[pairs[i][k] ? i - 1 : i].index;
    const step = back[i][k];
    if (step < 0) break;
    i = Math.floor(step / size);
    k = step % size;
  }
  let from = -1;
  /** @type {"flow" | "jump" | "start"} */
  let entry = "start";
  if (previous >= 0) {
    from = song.words[previous].slide;
    entry = lastInSlide - previous <= MOST_SKIPPED + 1 && song.slides[from].end <= song.slides[slide].start
      ? "flow"
      : "jump";
  }
  // Of the slide's last line, the words the line-up passed over; and how
  // many of the words up to where it ends it matched one after another.
  let lastLineMissed = 0;
  for (let at = Math.max(song.slides[slide].lastLine, lastInSlide); at <= bestK; at += 1) {
    if (!matched.has(at)) lastLineMissed += 1;
  }
  let endRun = 0;
  while (matched.has(bestK - endRun)) endRun += 1;
  return {
    slide,
    lastLineMissed,
    endRun,
    word: bestK,
    score: bestScore,
    bySlide,
    evidence,
    firstHeard,
    latest: bestI === count - 1,
    into: lastInSlide - song.slides[slide].start,
    from,
    entry,
  };
}

/** How many of the words last heard the follower lines up. */
export const FOLLOW_WORDS = 10;

const COUNTED = /** @type {Record<string, number>} */ ({
  one: 1, first: 1, two: 2, second: 2, three: 3, third: 3, four: 4, fourth: 4,
  five: 5, fifth: 5, six: 6, sixth: 6, seven: 7, eight: 8, nine: 9, ten: 10,
});

/**
 * The start of the first section after `current` (or else the first of all)
 * whose label `matches`, or -1.
 *
 * @param {PreparedSong} song
 * @param {number} current
 * @param {(label: string) => boolean} matches
 */
function sectionLabelled(song, current, matches) {
  const starts = song.slides
    .map((slide, index) => ({ slide, index }))
    .filter(({ slide, index }) => slide.section === index && slide.end > slide.start && slide.label && matches(slide.label))
    .map(({ index }) => index);
  return starts.find((index) => index > current) ?? starts[0] ?? -1;
}

/**
 * The slide a worship leader called for in `words` ("one more time", "back
 * to the chorus", "bridge", "verse two", "from the top"), or -1. A call that
 * is in the song's own words ("one more time" sung) is no call.
 *
 * @param {PreparedSong} song
 * @param {string[]} words newest last
 * @param {number} current the slide showing
 * @returns {{ slide: number, said: string }}
 */
export function cueOf(song, words, current) {
  const said = words.join(" ");
  const sung = ` ${song.words.map((word) => word.text).join(" ")} `;
  /** @param {RegExp} pattern */
  const call = (pattern) => {
    const found = said.match(pattern);
    return found && !sung.includes(` ${found[0]} `) ? found[0] : null;
  };
  const none = { slide: -1, said: "" };
  if (current < 0 || current >= song.slides.length) return none;

  let heard = call(/\b(one more time|once more|sing it again|sing that again|do it again|lets go again|go again|repeat that)\b/);
  if (heard) return { slide: song.slides[current].section, said: heard };
  heard = call(/\b(from the top|from the beginning|top of the song)\b/);
  if (heard) return { slide: nextSlideOf(song, -1), said: heard };
  heard = call(/\b(chorus|refrain)\b/);
  if (heard) {
    const chorus = song.refrain >= 0 ? song.refrain : sectionLabelled(song, current, (label) => /chorus|refrain/.test(label));
    return chorus >= 0 ? { slide: chorus, said: heard } : none;
  }
  heard = call(/\bbridge\b/);
  if (heard) {
    const bridge = sectionLabelled(song, current, (label) => label.includes("bridge"));
    return bridge >= 0 ? { slide: bridge, said: heard } : none;
  }
  const verse = said.match(/\bverse (\d+|one|first|two|second|three|third|four|fourth|five|fifth|six|sixth|seven|eight|nine|ten)\b/);
  if (verse && !sung.includes(` ${verse[0]} `)) {
    const number = COUNTED[verse[1]] ?? Number(verse[1]);
    const slide = sectionLabelled(song, -1, (label) => label.replace(/\s+/g, " ") === `verse ${number}`);
    return slide >= 0 ? { slide, said: verse[0] } : none;
  }
  heard = call(/\b(the tag|tag it|last line)\b/);
  if (heard) {
    const tag = sectionLabelled(song, current, (label) => label.includes("tag"));
    return tag >= 0 ? { slide: tag, said: heard } : none;
  }
  return none;
}

/** How long a worship leader's call holds, if the band doesn't take it. */
const CALL_HOLDS_MS = 30_000;

/**
 * Following one song as it is sung: when to move the slide on.
 *
 * Until it has heard the slide showing, it can't be sure the band has
 * begun: words heard then (the song's name, said before it starts) move it
 * only to the start of the slide that comes next, on two real words, or to
 * the start of another, on four or five.
 *
 * After that, the slide the song goes to next takes one real word ("grace",
 * not "and") at its start, whether or not the end of the slide showing was
 * heard: straight on to the next slide, back to a chorus the library keeps
 * once when a verse ends, on from the verse the band left for the chorus,
 * and wherever the worship leader called for ("one more time", "to the
 * bridge"). Anywhere else, or a slide
 * come to in its middle, takes about two real words in order; back to a
 * slide just left, more. Only words heard since the slide showing went up
 * count towards leaving it, so its own last words never pull it back.
 *
 * With `ahead`, it doesn't wait for the next slide's first word: as the last
 * word of the slide showing is sung, it puts up the slide the song goes to
 * next, as an operator reading ahead does. If the band goes elsewhere, the
 * first words sung there take it back, as above.
 *
 * @param {{ holdMs?: number, backLockMs?: number, ahead?: boolean }} [options]
 */
export function createFollower(options = {}) {
  const holdMs = options.holdMs ?? 350;
  const backLockMs = options.backLockMs ?? 3000;
  const ahead = options.ahead ?? false;
  let lastMoveAt = -Infinity;
  let lastMoveTo = -1;
  /** The slide left on its last word, before the next was sung, or -1. */
  let guessedPast = -1;
  let resume = -1;
  let since = -Infinity;
  let heardShowing = false;
  /** Where the worship leader said to go, and until when. */
  let planned = { slide: -1, until: -Infinity };
  /** Words from this index on haven't been read for a call. */
  let callsFrom = -Infinity;
  /** A call read in the last step, for the agent to say. */
  /** @type {{ slide: number, said: string } | null} */
  let lastCall = null;
  /** Times through the section showing, done: for a section marked "x3". */
  let sectionPasses = { section: -1, done: 0 };
  /**
   * Times the slide showing has been sung to its end: for a slide marked
   * "x3". `armed` once its earlier words are heard again since the last.
   */
  let slideEndings = { slide: -1, count: 0, armed: true };
  /** When the song showing was last heard being sung. */
  let heardSongAt = -Infinity;
  /** The slides sung since the song went up. */
  const visited = new Set();
  /** After the last verse it left, did the band go to the chorus kept once, or on? */
  /** @type {"refrain" | "next" | null} */
  let afterVerse = null;

  /** @param {number} index */
  const startFrom = (index) => {
    sectionPasses = { section: -1, done: 0 };
    slideEndings = { slide: -1, count: 0, armed: true };
    since = index;
    callsFrom = index;
    resume = -1;
    lastMoveTo = -1;
    heardShowing = false;
    planned = { slide: -1, until: -Infinity };
  };

  /**
   * Where the song most likely goes after the slide showing.
   *
   * @param {PreparedSong} song
   * @param {number} currentIndex
   * @param {number} now
   */
  const expected = (song, currentIndex, now) => {
    if (planned.slide >= 0 && now < planned.until) return planned.slide;
    const showing = song.slides[currentIndex];
    // Marked "x3": the slide, or its section, again until the count is done.
    if (showing && showing.times > 1 && endingsOf(currentIndex) < showing.times) return currentIndex;
    if (
      showing?.sectionEnd &&
      showing.sectionTimes > 1 &&
      passesOf(showing.section) + 1 < showing.sectionTimes
    ) {
      return showing.section;
    }
    if (resume >= 0) return resume;
    const next = nextSlideOf(song, currentIndex);
    if (song.slides[currentIndex]?.verseEnd && song.refrain >= 0 && afterVerse !== "next") return song.refrain;
    return next;
  };

  /** @param {number} slide */
  const endingsOf = (slide) => (slideEndings.slide === slide ? slideEndings.count : 0);
  /** @param {number} section */
  const passesOf = (section) => (sectionPasses.section === section ? sectionPasses.done : 0);

  /**
   * @param {PreparedSong} song
   * @param {number} from the slide showing
   * @param {number} to
   * @param {number} now
   * @param {number} sinceIndex
   * @param {number} origin the slide the band came from, which may be ahead
   *   of the one showing
   */
  const move = (song, from, to, now, sinceIndex, origin = from, guessed = false) => {
    guessedPast = guessed ? from : -1;
    // A section sung again from its start after its end counts a time
    // through; going into another section starts its count.
    const leaving = song.slides[from];
    if (leaving && to === leaving.section && leaving.sectionEnd) {
      sectionPasses = { section: leaving.section, done: passesOf(leaving.section) + 1 };
    } else if (song.slides[to].section !== sectionPasses.section) {
      sectionPasses = { section: song.slides[to].section, done: 0 };
    }
    if (to !== from) slideEndings = { slide: to, count: 0, armed: true };
    if (song.slides[origin]?.verseEnd && song.refrain >= 0) {
      afterVerse = to === song.refrain ? "refrain" : to === nextSlideOf(song, origin) ? "next" : afterVerse;
    }
    // Where to go on from after a chorus: kept while in the chorus, set on
    // going into one from a verse, forgotten once the song is past it.
    if (!song.slides[to].chorus || to === resume) {
      resume = -1;
    } else if (!song.slides[origin]?.chorus && to !== nextSlideOf(song, origin)) {
      // After the whole verse: a band sings a verse through before the
      // chorus, though the end of it may not have been heard.
      let end = origin;
      while (end + 1 < song.slides.length && song.slides[end + 1].section === song.slides[origin].section) end += 1;
      resume = nextSlideOf(song, end);
    }
    if (to === planned.slide) planned = { slide: -1, until: -Infinity };
    lastMoveAt = now;
    lastMoveTo = to;
    since = sinceIndex;
    heardShowing = true;
    visited.add(from);
    visited.add(to);
    return to;
  };

  return {
    reset() {
      lastMoveAt = -Infinity;
      heardSongAt = -Infinity;
      afterVerse = null;
      visited.clear();
      startFrom(-Infinity);
    },
    /**
     * Someone else put up the slide: words heard before `index` say nothing
     * about where to go from it.
     *
     * @param {number} index
     */
    anchor(index) {
      visited.clear();
      startFrom(index);
    },
    /**
     * The slide was moved on by the second hearing (`createCatchUp`), which
     * heard it sung: carry on from there as if this had moved it, with words
     * from `index` on.
     *
     * @param {PreparedSong} song
     * @param {number} from
     * @param {number} to
     * @param {number} now
     * @param {number} index
     */
    adopt(song, from, to, now, index) {
      move(song, from, to, now, index);
    },
    /**
     * The agent put up another song, having heard it sung: follow it from
     * the slide put up, as heard, with words from `index` on.
     *
     * @param {number} index
     * @param {number} now
     */
    begin(index, now) {
      visited.clear();
      afterVerse = null;
      startFrom(index);
      heardShowing = true;
      lastMoveAt = now;
    },
    /**
     * Where the song most likely goes after `currentIndex`, or -1 at its end.
     *
     * @param {PreparedSong} song
     * @param {number} currentIndex
     * @param {number} now
     */
    expected(song, currentIndex, now) {
      return currentIndex >= 0 && currentIndex < song.slides.length ? expected(song, currentIndex, now) : -1;
    },
    /** When words of the song showing were last heard, by the clock `step` is given. */
    heardSongAt() {
      return heardSongAt;
    },
    /** The worship leader's call read in the last step, once. */
    takeCall() {
      const call = lastCall;
      lastCall = null;
      return call;
    },
    /**
     * @param {{ song: PreparedSong, heard: HeardWord[], currentIndex: number, now: number }} input
     * @returns {number | null} the slide to move to, or null to stay
     */
    step({ song, heard, currentIndex, now }) {
      if (currentIndex < 0 || currentIndex >= song.slides.length) return null;
      const newest = heard.filter((word) => word.index >= callsFrom);
      if (newest.length > 0) {
        const call = cueOf(song, newest.map((word) => word.text), currentIndex);
        if (call.slide >= 0) {
          planned = { slide: call.slide, until: now + CALL_HOLDS_MS };
          callsFrom = newest[newest.length - 1].index + 1;
          lastCall = call;
        }
      }
      if (now >= planned.until) planned = { slide: -1, until: -Infinity };
      const plannedSlide = planned.slide;
      const found = alignHeard(song, heard.slice(-FOLLOW_WORDS), {
        current: currentIndex,
        resume,
        planned: plannedSlide,
        since,
      });
      if (!found) return null;
      if (found.evidence >= 1) heardSongAt = now;
      if (found.slide === currentIndex) {
        if (found.evidence >= 1) heardShowing = true;
        // Ahead: its last word is being sung, the line it ends heard nearly
        // whole.
        const last = song.slides[currentIndex].end - 1;
        // The slide is ending when its last words are heard in order and
        // come nowhere else in it ("end of time"), or when the line-up has
        // come through most of its last line. It moves on as its last word is
        // heard, about 0.3 s into it: the next slide is up while the singer
        // still sings it. On the word before (tried), a slow hymn's held last
        // note put the next slide up 5 or 6 s before its first line. A slide
        // whose lines end alike ("with my soul … with my soul") isn't over at
        // the end of its first: its last line must be heard nearly whole.
        const showing = song.slides[currentIndex];
        const { start, end, lastLine, endsOnce } = showing;
        const lineLength = end - lastLine;
        const toGo = last - found.word;
        const ending =
          toGo === 0
            ? start + found.into < lastLine || endsOnce
              ? endsOnce
                ? found.endRun >= 3 || found.lastLineMissed <= Math.max(1, Math.floor(lineLength / 3))
                : found.lastLineMissed <= 1
              : false
            : false;
        // Its earlier words, heard again, ready a slide marked "x3" to count
        // its next time to the end.
        if (slideEndings.slide !== currentIndex) slideEndings = { slide: currentIndex, count: 0, armed: true };
        if (found.word - start <= 1 || found.word < lastLine - 1) slideEndings.armed = true;
        if (ending && found.latest && slideEndings.armed) {
          slideEndings = { slide: currentIndex, count: slideEndings.count + 1, armed: false };
        }
        // Where a repeat may come ("x3" not yet done, or an open "Repeat"),
        // it waits to hear the next word: the band decides, not the slide.
        const waitsForWord =
          (showing.times > 1 && slideEndings.count < showing.times) ||
          (showing.sectionEnd &&
            (showing.mayRepeat || (showing.sectionTimes > 1 && passesOf(showing.section) + 1 < showing.sectionTimes)));
        if (
          ahead &&
          heardShowing &&
          found.latest &&
          ending &&
          !waitsForWord &&
          found.evidence >= 1.6 &&
          now - lastMoveAt >= holdMs
        ) {
          // Not to a verse already sung: after a verse sung again at the
          // end, the song is more likely over than back in verse 2.
          const to = expected(song, currentIndex, now);
          const again = visited.has(to) && !song.slides[to]?.chorus && to !== planned.slide;
          if (to >= 0 && to !== currentIndex && !again) {
            return move(song, currentIndex, to, now, heard[heard.length - 1].index + 1, currentIndex, true);
          }
        }
        return null;
      }
      // Plainly better than staying: the line-up ending on the slide showing.
      if (found.score - found.bySlide[currentIndex] < 0.25) return null;
      // Where the song goes next, come to at its start: one real word moves
      // there, though the end of the slide showing was misheard or missed.
      const showingSlide = song.slides[currentIndex];
      const repeatsHere =
        showingSlide.sectionEnd && (showingSlide.mayRepeat || showingSlide.sectionTimes > 1)
          ? showingSlide.section
          : -1;
      const usual =
        found.into <= 1 &&
        (found.from === currentIndex || found.from < 0) &&
        (found.slide === expected(song, currentIndex, now) || found.slide === repeatsHere);
      let need = usual ? 0.8 : 1.6;
      // Not yet heard the slide showing (just put up, or the agent just
      // switched on): two real words for where the song goes next, four or
      // five for anywhere else.
      if (!heardShowing) need = found.into > 1 ? Infinity : usual ? Math.max(need, 1.6) : Math.max(need, 4);
      if (found.slide < currentIndex && lastMoveTo === currentIndex && now - lastMoveAt < backLockMs) {
        // Back to the slide it put up the next of on its last word: the band
        // sang it again. Two real words of it put it right; back anywhere
        // else just after a move takes more.
        const putRight = found.slide === guessedPast || found.slide === plannedSlide;
        need = Math.max(need, found.slide === plannedSlide ? 0.8 : putRight ? 1.6 : 2.4);
      }
      if (found.evidence < need) return null;
      if (now - lastMoveAt < holdMs) return null;
      return move(song, currentIndex, found.slide, now, found.firstHeard, found.from >= 0 ? found.from : currentIndex);
    },
  };
}

/**
 * Catching up from a second hearing of the singing: one that hears words
 * through a band far better, but sends them a second or more later (a model
 * with voice isolation, `useSongAgent`). Its words are followed on their
 * own, and only ever move the slide on: to where the song goes next, or the
 * slide after that, when the first hearing missed the words that would have
 * moved it. Being late, they never move it back, nor anywhere else; the
 * first hearing does that.
 */
export function createCatchUp() {
  const follower = createFollower();
  return {
    reset() {
      follower.reset();
    },
    /**
     * The slide showing changed: words heard before `index` are of where it
     * was.
     *
     * @param {number} index
     */
    shown(index) {
      follower.anchor(index);
    },
    /**
     * @param {{ song: PreparedSong, heard: HeardWord[], currentIndex: number, now: number }} input
     * @returns {number | null} the slide to move on to, or null
     */
    step({ song, heard, currentIndex, now }) {
      const to = follower.step({ song, heard, currentIndex, now });
      if (to === null || to === currentIndex) return null;
      const next = follower.expected(song, currentIndex, now);
      const afterNext = next >= 0 ? nextSlideOf(song, next) : -1;
      return to === next || to === afterNext ? to : null;
    },
  };
}

/** How many of the words last heard decide which song is being sung. */
export const SEARCH_WORDS = 12;

/**
 * Each of `songs` lined up against the latest words, best first.
 *
 * @param {PreparedSong[]} songs
 * @param {HeardWord[]} heard
 * @returns {Array<{ song: PreparedSong, slide: number, score: number }>}
 */
export function rankSongs(songs, heard) {
  const tail = heard.slice(-SEARCH_WORDS);
  /** @type {Array<{ song: PreparedSong, slide: number, score: number }>} */
  const ranked = [];
  for (const song of songs) {
    const found = alignHeard(song, tail, { trailing: MOST_SKIPPED });
    if (found) ranked.push({ song, slide: found.slide, score: found.score });
  }
  return ranked.sort((left, right) => right.score - left.score);
}

/**
 * The best of songs ranked by `rankSongs`, if it is plainly the song: lined
 * up in order to about `need` real words (three by default), and well ahead
 * of the next best.
 *
 * @param {Array<{ song: PreparedSong, slide: number, score: number }>} ranked
 * @param {{ need?: number, margin?: number, needFor?: (song: PreparedSong) => number }} [options]
 */
function plainlyBest(ranked, options = {}) {
  const [best, second] = ranked;
  if (!best) return null;
  const need = options.needFor?.(best.song) ?? options.need ?? 3;
  if (best.score < need || best.score - (second?.score ?? -Infinity) < (options.margin ?? 1)) return null;
  return best;
}

/**
 * Which of `songs` the latest words are from, if one plainly is: lined up
 * in order to about `need` real words (three by default), and well ahead of
 * the next best.
 *
 * @param {PreparedSong[]} songs
 * @param {HeardWord[]} heard
 * @param {{ need?: number, margin?: number, needFor?: (song: PreparedSong) => number }} [options]
 * @returns {{ song: PreparedSong, slide: number, score: number } | null}
 */
export function identifySong(songs, heard, options = {}) {
  return plainlyBest(rankSongs(songs, heard), options);
}

/** Library songs lined up before, kept while the library is the same. */
const preparedLibrary = new WeakMap();

/** @param {SongInput} song */
const preparedOnce = (song) => {
  let prepared = preparedLibrary.get(song);
  if (!prepared) preparedLibrary.set(song, (prepared = prepareSong(song)));
  return prepared;
};

/**
 * The song being sung, when it isn't the one on screen (`live`), and
 * whether it is plainly enough that one to put it up without asking.
 *
 * Every song that could be it is lined up against the words heard: the
 * open service's, the next in its order most of all, and the library's
 * songs that share the most of the rarer words heard. The best must be
 * well ahead of all the others, the song on screen included. A line that
 * only one song has (two or three real words in order, "chosen generation")
 * is enough: the more songs share it, the more it takes. A song in the
 * service wins a close call over one in the library.
 *
 * @param {HeardWord[]} heard
 * While the song on screen is being sung (`liveSung`: its words heard in
 * the last few seconds), leaving it takes far more: under a band, its own
 * words misheard fit other songs now and then ("i also find alive" put up
 * another song mid-verse).
 *
 * @param {{
 *   live: PreparedSong | null,
 *   service: PreparedSong[],
 *   nextServiceId?: string | null,
 *   library?: ReturnType<typeof createLibraryIndex> | null,
 *   liveSung?: boolean,
 * }} where
 * @returns {{ song: PreparedSong, slide: number, score: number, lead: number, from: "service" | "library", sure: boolean } | null}
 */
export function findOtherSong(heard, { live, service, nextServiceId = null, library = null, liveSung = false }) {
  const tail = heard.slice(-SEARCH_WORDS);
  const own = live ? (alignHeard(live, tail, { trailing: MOST_SKIPPED })?.score ?? -Infinity) : -Infinity;
  const inService = new Set(service.map((song) => song.id));
  const candidates = service.filter((song) => song.id !== live?.id);
  if (library) {
    for (const id of libraryCandidates(library, tail, LIBRARY_SHORTLIST)) {
      const song = library.songs.get(id);
      if (song && id !== live?.id && !inService.has(id)) candidates.push(preparedOnce(song));
    }
  }
  const ranked = rankSongs(candidates, tail)
    .map((entry) => ({
      ...entry,
      from: /** @type {"service" | "library"} */ (inService.has(entry.song.id) ? "service" : "library"),
      // The service's songs, the next above all, are where the band is
      // likely to go.
      weighed: entry.score + (entry.song.id === nextServiceId ? 0.8 : inService.has(entry.song.id) ? 0.4 : 0),
    }))
    .sort((left, right) => right.weighed - left.weighed);
  const [best, second] = ranked;
  if (!best) return null;
  const lead = best.weighed - Math.max(own, second?.weighed ?? -Infinity);
  const needs = liveSung ? LEAVING_NEEDS : FOUND_NEEDS;
  if (best.score < needs || lead < FOUND_LEAD) return null;
  return {
    song: best.song,
    slide: best.slide,
    score: best.score,
    lead,
    from: best.from,
    sure: lead >= (liveSung ? LEAVING_LEAD : SURE_LEAD),
  };
}

/** Real words in order a song needs before it is taken for the one sung. */
const FOUND_NEEDS = 2;
/** How far ahead of every other song it must be to be suggested. */
const FOUND_LEAD = 1;
/** How far ahead to be put up without asking. */
const SURE_LEAD = 1.5;
/** Real words in order to leave a song still being sung: most of a line. */
const LEAVING_NEEDS = 4;
/** How far ahead to put up another song while the one on screen is sung. */
const LEAVING_LEAD = 3;

/**
 * How many of the library's songs sharing the most rare words are lined up.
 * Five was too few once the library held many songs sharing phrases: the
 * song being sung could fall out of them.
 */
const LIBRARY_SHORTLIST = 12;

/**
 * The library, ready to be searched as it is sung: which songs each word's
 * sound is in, and each pair of neighbouring words' sounds. A large library
 * is narrowed to a few songs this way, and only those are lined up.
 *
 * Kept a song at a time, so a library of thousands is indexed in small
 * pieces, and a song edited is indexed again on its own (`set`), not the
 * whole library.
 */
export function createLibraryIndex() {
  /** @type {Map<string, SongInput>} */
  const songs = new Map();
  /** @type {Map<string, Set<string>>} */
  const postings = new Map();
  /** @type {Map<string, string[]>} */
  const keysOf = new Map();
  /** @type {Map<string, string>} */
  const versions = new Map();

  /** @param {string} id */
  const remove = (id) => {
    for (const key of keysOf.get(id) ?? []) {
      const list = postings.get(key);
      list?.delete(id);
      if (list && list.size === 0) postings.delete(key);
    }
    keysOf.delete(id);
    versions.delete(id);
    songs.delete(id);
  };

  return {
    songs,
    postings,
    /**
     * Index `song`, in place of what was indexed under its id. `version`
     * says when it changed (`versionOf`), so a song the same as before can
     * be left as it is.
     *
     * @param {SongInput} song
     * @param {string} [version]
     */
    set(song, version = versionOf(song)) {
      remove(song.id);
      const keys = new Set();
      for (const slide of song.slides) {
        const words = wordsOf(slide.text);
        words.forEach((word, at) => {
          const sound = soundOf(word);
          if (weightOf(word) >= 1) keys.add(sound);
          if (at > 0) keys.add(`${soundOf(words[at - 1])} ${sound}`);
        });
      }
      for (const key of keys) {
        let list = postings.get(key);
        if (!list) postings.set(key, (list = new Set()));
        list.add(song.id);
      }
      keysOf.set(song.id, [...keys]);
      versions.set(song.id, version);
      songs.set(song.id, song);
    },
    remove,
    /** @param {string} id @param {string} version */
    isCurrent(id, version) {
      return versions.get(id) === version;
    },
  };
}

/**
 * What a song is, as far as the index goes: its words. A song whose
 * version is unchanged needn't be indexed again.
 *
 * @param {SongInput} song
 */
export function versionOf(song) {
  return song.slides.map((slide) => slide.text).join("\n\n");
}

/**
 * The library indexed all at once (tests, and the eval).
 *
 * @param {SongInput[]} songs
 */
export function buildLibraryIndex(songs) {
  const index = createLibraryIndex();
  for (const song of songs) index.set(song);
  return index;
}

/**
 * The songs the words heard could most be from, best first: those sharing
 * the most of their rarer words, and of their words in the order heard,
 * which a song made of the same words in another order doesn't.
 *
 * @param {ReturnType<typeof createLibraryIndex>} index
 * @param {HeardWord[]} heard
 * @param {number} [limit]
 * @returns {string[]} the songs' ids
 */
export function libraryCandidates(index, heard, limit = 5) {
  const total = Math.max(1, index.songs.size);
  const tail = heard.slice(-SEARCH_WORDS);
  const keys = new Set();
  tail.forEach((word, at) => {
    if (weightOf(word.text) >= 1) keys.add(word.sound);
    if (at > 0) keys.add(`${tail[at - 1].sound} ${word.sound}`);
  });
  /** @type {Map<string, number>} */
  const weights = new Map();
  for (const key of keys) {
    const list = index.postings.get(key);
    if (!list) continue;
    const weight = Math.log(1 + total / list.size);
    for (const song of list) weights.set(song, (weights.get(song) ?? 0) + weight);
  }
  return [...weights.entries()]
    .sort((left, right) => right[1] - left[1])
    .slice(0, limit)
    .map(([song]) => song);
}

/**
 * What to tell the speech service to listen for: the songs' less common
 * words ("tenderly", "portals", "deathbeds"), each once, the song on screen's
 * first, no more than the service takes (100).
 *
 * Words, not lines: given whole lines of recorded hymns, the service heard
 * no more of the singing, and left out words a line repeats ("come home,
 * come home" came back as "come"); given the words, it heard the most of
 * any setting tried (`tests/song-agent-eval`).
 *
 * @param {SongInput[]} songs most likely first
 * @param {number} [limit]
 * @returns {string[]}
 */
export function songKeyterms(songs, limit = 100) {
  /** @type {string[]} */
  const terms = [];
  const seen = new Set();
  for (const song of songs) {
    for (const slide of song.slides) {
      const text = String(slide.text ?? "").replace(/\[[^\]]*\]/g, " ");
      for (const word of text.split(/[^\p{L}\p{N}’']+/u)) {
        const key = word.toLowerCase();
        if (key.length < 5 || weightOf(key) < 1 || seen.has(key)) continue;
        seen.add(key);
        terms.push(word);
        if (terms.length >= limit) return terms;
      }
    }
  }
  return terms;
}

/**
 * Words heard so far, as the agent keeps them: every finished turn, and the
 * one still being sung, which speech recognition keeps revising. Each word
 * is numbered in the order heard, so the follower can tell words heard
 * before the operator moved the slide from those after. Only the last
 * `limit` are kept.
 *
 * @param {number} [limit]
 */
export function createHeardWords(limit = 48) {
  /** @type {HeardWord[]} */
  let committed = [];
  /** @type {string[]} */
  let current = [];
  let counted = 0;
  let lastFinal = "";
  /** @type {string | null} */
  let currentTurn = null;

  /** @param {string[]} words */
  const commit = (words) => {
    // A turn can be sent final twice: plain, then with punctuation.
    const key = words.join(" ");
    if (!key || key === lastFinal) return;
    lastFinal = key;
    const added = words.map((word, offset) => heardWord(word, counted + offset));
    counted += words.length;
    committed = [...committed, ...added].slice(-limit);
  };

  return {
    /**
     * @param {string} transcript
     * @param {boolean} isFinal
     * @param {string | null} [turn] which turn this is, when known: a turn
     *   that ended without its final copy (the connection went) is kept as
     *   it was last heard when the next begins
     */
    hear(transcript, isFinal, turn = null) {
      const words = wordsOf(transcript);
      if (turn !== null && currentTurn !== null && turn !== currentTurn && current.length > 0) {
        commit(current);
        current = [];
      }
      currentTurn = turn;
      if (!isFinal) {
        current = words;
        return;
      }
      current = [];
      commit(words);
    },
    /** @returns {HeardWord[]} */
    words() {
      const forming = current.map((word, offset) => heardWord(word, counted + offset));
      return [...committed, ...forming].slice(-limit);
    },
    /** How many words have been heard: the number the next one will have. */
    count() {
      return counted + current.length;
    },
    clear() {
      committed = [];
      current = [];
      lastFinal = "";
    },
  };
}
