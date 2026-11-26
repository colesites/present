// Finding the song being sung, replayed against what the speech service
// heard in each recording (`capture.mjs`), as `useSongAgent` searches: at the
// end of each turn, and at most every half second as words form.
//
// Each recording is replayed four ways, with every song in `songs.mjs` in
// the library:
//   service   nothing on screen; the song is in the open service
//   next      another song on screen; this one is next in the service
//   library   nothing on screen; the song is only in the library
//   on screen the song itself is on screen: any suggestion is a false alarm
//
// For each: whether the right song was suggested, how long after singing
// began, and how many times a wrong song was.
//
// A song suggested before singing began was found from its name, said
// first (LibriVox's singers say what they will sing); those are counted
// apart from the time taken.
//
// `--matcher` replays the matcher before this one (pairs of words over the
// whole library, the service's songs only winning a close call), for before
// and after.
//
// `--distractors N` adds N made-up songs to the library, each line the first
// half of one song's line and the second half of another's: songs that share
// many phrases with the ones sung, as a large library's do. They are never
// sung, so any suggestion of one is wrong.
//
//   node tests/song-agent-eval/find.mjs --heard <capture dir> [--matcher <old song-match.mjs>] [--distractors 500] [--show]

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { pathToFileURL } from "node:url";
import { readTurn } from "../../src/features/scripture/lib/assemblyai-turn.ts";
import {
  buildLibraryIndex,
  createHeardWords,
  findOtherSong,
  prepareSong,
} from "../../src/features/song-agent/song-match.mjs";
import { RECORDINGS } from "./recordings.mjs";
import { SONGS } from "./songs.mjs";
import { TRUTH } from "./truth.mjs";

const { values } = parseArgs({
  options: {
    heard: { type: "string" },
    matcher: { type: "string" },
    distractors: { type: "string", default: "0" },
    show: { type: "boolean", default: false },
  },
});
if (!values.heard) throw new Error("--heard <capture dir> is needed");
const before = values.matcher ? await import(pathToFileURL(resolve(values.matcher)).href) : null;

/** Made-up songs that share phrases with the real ones (see above). */
function distractors(count) {
  const lines = SONGS.flatMap((song) => song.slides.flatMap((slide) => slide.text.split("\n")));
  const halves = lines.map((line) => {
    const words = line.split(" ");
    const middle = Math.ceil(words.length / 2);
    return [words.slice(0, middle).join(" "), words.slice(middle).join(" ")];
  });
  let seed = 11;
  const pick = (list) => {
    seed = (seed * 1_103_515_245 + 12_345) % 2_147_483_648;
    return list[seed % list.length];
  };
  return Array.from({ length: count }, (_, n) => ({
    id: `distractor-${n}`,
    title: `Distractor ${n}`,
    slides: Array.from({ length: 8 }, () => ({
      label: null,
      text: [0, 1].map(() => `${pick(halves)[0]} ${pick(halves)[1]}`).join("\n"),
    })),
  }));
}
const LIBRARY = [...SONGS, ...distractors(Number(values.distractors))];
const library = buildLibraryIndex(LIBRARY);
const prepared = new Map(LIBRARY.map((song) => [song.id, prepareSong(song)]));
const SEARCH_EVERY_MS = 500;

/** The suggestions made while `messages` are heard, as the agent makes them. */
function suggestions(messages, where) {
  const heard = createHeardWords();
  const made = [];
  let lastSearch = -Infinity;
  let showing = null;
  for (const { at, message } of messages) {
    if (message.type !== "Turn") continue;
    const turn = readTurn(message, true);
    if (!turn.text) continue;
    heard.hear(turn.text, turn.isFinal, `1:${message.turn_order}`);
    if (!turn.isFinal && at - lastSearch < SEARCH_EVERY_MS) continue;
    lastSearch = at;
    const found = before ? findBefore(heard.words(), where) : findOtherSong(heard.words(), where);
    if (found && found.song.id !== showing) {
      showing = found.song.id;
      made.push({ at, song: found.song.id, from: found.from, sure: Boolean(found.sure), lead: found.lead ?? null });
    }
  }
  return made;
}

// The matcher before: the whole library searched by pairs of words, the
// service's songs winning a close call; nothing while the song on screen's
// own words are heard.
const beforeIndex = before?.buildSongIndex(LIBRARY);
function findBefore(words, where) {
  const text = words.map((word) => word.text);
  const prefer = new Set(where.service.map((song) => song.id));
  const best = before.confidentSong(before.findSongs(beforeIndex, text, { prefer }));
  if (!best) return null;
  const song = LIBRARY[best.songIndex];
  if (song.id === where.live?.id) return null;
  if (where.live) {
    const at = LIBRARY.findIndex((entry) => entry.id === where.live.id);
    const own = before.followSong(beforeIndex.slidePairs[at], text, 0);
    if (own && own.hits >= 2) return null;
  }
  return { song: prepared.get(song.id), slide: best.slideIndex, from: prefer.has(song.id) ? "service" : "library" };
}

const ways = {
  service: (id) => ({ live: null, service: SONGS.map((song) => prepared.get(song.id)), library }),
  next: (id) => {
    const before = SONGS[(SONGS.findIndex((song) => song.id === id) + SONGS.length - 1) % SONGS.length];
    const order = [before.id, id, ...SONGS.map((song) => song.id).filter((other) => other !== id && other !== before.id)];
    return { live: prepared.get(before.id), service: order.map((other) => prepared.get(other)), nextServiceId: id, library };
  },
  library: () => ({ live: null, service: [], library }),
  "on screen": (id) => ({ live: prepared.get(id), service: SONGS.map((song) => prepared.get(song.id)), library }),
};

const results = Object.fromEntries(
  Object.keys(ways).map((way) => [way, { tried: 0, found: 0, byName: 0, times: [], wrong: 0, wrongSure: 0 }]),
);
for (const recording of RECORDINGS) {
  const file = `${values.heard}/${recording.id}.json`;
  if (!existsSync(file)) continue;
  const capture = JSON.parse(readFileSync(file, "utf8"));
  const truth = TRUTH[recording.id] ?? capture.truth;
  if (!truth) continue;
  const began = truth[0][1];
  const line = [recording.id.padEnd(22)];
  for (const [way, setUp] of Object.entries(ways)) {
    const made = suggestions(capture.messages, setUp(recording.song));
    const result = results[way];
    result.tried += 1;
    if (way === "on screen") {
      result.wrong += made.length;
      result.wrongSure += made.filter((entry) => entry.sure).length;
      line.push(`${way}: ${made.length === 0 ? "quiet" : `${made.length} false`}`);
    } else {
      const right = made.find((entry) => entry.song === recording.song);
      const wrong = made.filter((entry) => entry.song !== recording.song).length;
      result.wrong += wrong;
      result.wrongSure += made.filter((entry) => entry.song !== recording.song && entry.sure).length;
      if (right) {
        result.found += 1;
        if (right.at < began) result.byName += 1;
        else result.times.push(right.at - began);
      }
      const when = !right ? "not found" : right.at < began ? "by name" : `${((right.at - began) / 1000).toFixed(1)} s`;
      line.push(`${way}: ${when}${wrong ? `, ${wrong} wrong` : ""}`);
    }
    if (values.show) {
      for (const entry of made) {
        line.push(`\n    ${way} ${(entry.at / 1000).toFixed(1)} s ${entry.song} (${entry.from}${entry.sure ? ", put up" : ""}${entry.lead !== null ? `, ahead by ${entry.lead.toFixed(2)}` : ""})`);
      }
    }
  }
  console.log(line.join("  "));
}
const median = (list) => {
  if (list.length === 0) return NaN;
  const sorted = [...list].sort((left, right) => left - right);
  return sorted[Math.floor(sorted.length / 2)];
};
console.log("");
for (const [way, result] of Object.entries(results)) {
  console.log(
    way === "on screen"
      ? `${way.padEnd(10)} false: ${result.wrong} in ${result.tried} recordings, ${result.wrongSure} of them put up`
      : `${way.padEnd(10)} found ${result.found}/${result.tried} (${result.byName} by name before singing; the rest a median ${(median(result.times) / 1000).toFixed(1)} s into it), wrong: ${result.wrong}, ${result.wrongSure} of them put up`,
  );
}
