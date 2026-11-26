// The song agent, replayed against what the speech service heard in real
// recordings of singing (`capture.mjs`), message by message at the time each
// came, as `useSongAgent` hears them. Each recording (`recordings.mjs`)
// starts with its song on screen at the first slide, as an operator would put
// it up.
//
// Measured against when each slide was really begun (`truth.mjs`, or a
// synthetic recording's own timing, kept in its capture):
//   late    from the first word of a slide to the slide on screen
//   missed  slides that never came up while they were sung
//   wrong   moves to a slide that wasn't being sung, and how long it stayed
//   heard   of the words sung, how many the speech service heard (spelt or
//           sounding the same), which says how well it hears singing with
//           the settings captured, whatever the matcher
//
//   node tests/song-agent-eval/run.mjs --heard <capture dir> [--matcher <song-match.mjs>] [--song <id>] [--show]
//
// `--ahead` puts the next slide up on the last word of the one showing,
// as the "Change on the last word" setting does; "late" then goes below
// nothing when it is early.
//
// `--matcher` replays another version of the matcher (the one before this,
// say, from `git show`), for before and after.

import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { pathToFileURL } from "node:url";
import { readTurn } from "../../src/features/scripture/lib/assemblyai-turn.ts";
import { RECORDINGS } from "./recordings.mjs";
import { songById } from "./songs.mjs";
import { TRUTH } from "./truth.mjs";

const { values } = parseArgs({
  options: {
    heard: { type: "string" },
    matcher: { type: "string" },
    show: { type: "boolean", default: false },
    ahead: { type: "boolean", default: false },
    song: { type: "string" },
  },
});
if (!values.heard) throw new Error("--heard <capture dir> is needed");
const matcherPath = values.matcher
  ? pathToFileURL(resolve(values.matcher)).href
  : new URL("../../src/features/song-agent/song-match.mjs", import.meta.url).href;
const matcher = await import(matcherPath);
// The matcher before word-by-word lining up followed pairs of words.
const isPairs = typeof matcher.prepareSong !== "function";

/** @param {ReturnType<typeof songById>} song */
function follow(song, messages) {
  const heard = matcher.createHeardWords();
  const follower = matcher.createFollower({ ahead: values.ahead });
  const prepared = isPairs ? matcher.buildSongIndex([song]).slidePairs[0] : matcher.prepareSong(song);
  let current = 0;
  const moves = [];
  for (const { at, message } of messages) {
    if (message.type !== "Turn") continue;
    const turn = readTurn(message, true);
    if (!turn.text) continue;
    heard.hear(turn.text, turn.isFinal, isPairs ? undefined : `1:${message.turn_order}`);
    const next = isPairs
      ? follower.step({ slides: prepared, words: heard.words(), currentIndex: current, now: at })
      : follower.step({ song: prepared, heard: heard.words(), currentIndex: current, now: at });
    if (next !== null && next !== current) {
      moves.push({ at, slide: next, heard: heard.words().slice(-6).map((word) => word.text ?? word).join(" ") });
      current = next;
    }
  }
  return moves;
}

/**
 * Of the words sung, in the order sung, the share the service heard: the
 * longest run of them in order in its finished turns.
 */
async function heardShare(song, truth, messages) {
  const { heardWord, likeness, prepareSong, wordsOf } = await import(
    new URL("../../src/features/song-agent/song-match.mjs", import.meta.url).href
  );
  const prepared = prepareSong(song);
  const sung = truth.flatMap(([slide]) => prepared.words.slice(prepared.slides[slide].start, prepared.slides[slide].end));
  const heard = [];
  for (const { message } of messages) {
    if (message.type !== "Turn" || !message.end_of_turn || !message.turn_is_formatted) continue;
    for (const text of wordsOf(message.transcript)) heard.push(heardWord(text, heard.length));
  }
  let previous = new Int32Array(heard.length + 1);
  for (const word of sung) {
    const row = new Int32Array(heard.length + 1);
    for (let j = 1; j <= heard.length; j += 1) {
      row[j] = likeness(heard[j - 1], word) >= 0.85 ? previous[j - 1] + 1 : Math.max(previous[j], row[j - 1]);
    }
    previous = row;
  }
  return { matched: previous[heard.length], of: sung.length };
}

/**
 * How long before a slide is begun putting it up counts as on time: the end
 * of the slide before, a held last note and a breath (`--ahead`).
 */
const EARLY_MS = values.ahead ? 5000 : 1500;

const textOf = (song, slide) => song.slides[slide]?.text.toLowerCase().replace(/[^a-z\s]/g, "").replace(/\s+/g, " ");

/**
 * The slide on screen over time, against the slide being sung.
 */
function measure(song, truth, moves, end) {
  const sameAs = (left, right) => left === right || textOf(song, left) === textOf(song, right);
  const late = [];
  let missed = 0;
  let wrong = 0;
  let wrongMs = 0;
  const shownAt = (time) => {
    let slide = 0;
    for (const move of moves) if (move.at <= time) slide = move.slide;
    return slide;
  };
  for (let index = 1; index < truth.length; index += 1) {
    const [slide, start] = truth[index];
    const until = truth[index + 1]?.[1] ?? end;
    // Up by the slide's start, or the first move to it while it is sung.
    let at = sameAs(shownAt(start), slide) ? start : null;
    if (at === null) {
      const move = moves.find((entry) => entry.at > start && entry.at < until && sameAs(entry.slide, slide));
      at = move?.at ?? null;
      // A move made a little before the first word, ahead of the singer.
      const early = moves.findLast((entry) => entry.at <= start && entry.at > start - EARLY_MS && sameAs(entry.slide, slide));
      if (early && sameAs(shownAt(start), slide)) at = early.at;
    }
    if (at === null) missed += 1;
    else late.push(at - start);
  }
  // A move to a slide that is neither being sung nor was just sung.
  for (const [index, move] of moves.entries()) {
    const sung = truth.findLast(([, start]) => start <= move.at + EARLY_MS);
    const before = truth[truth.indexOf(sung) - 1];
    const fine = (sung && sameAs(move.slide, sung[0])) || (before && sameAs(move.slide, before[0]) && move.at - sung[1] < 1500);
    if (fine) continue;
    wrong += 1;
    wrongMs += (moves[index + 1]?.at ?? end) - move.at;
  }
  return { late, missed, wrong, wrongMs };
}

const percentile = (list, share) => {
  if (list.length === 0) return NaN;
  const sorted = [...list].sort((left, right) => left - right);
  return sorted[Math.min(sorted.length - 1, Math.floor(share * sorted.length))];
};
const seconds = (ms) => (Number.isNaN(ms) ? "  -  " : `${(ms / 1000).toFixed(1).padStart(5)}`);

const total = () => ({ late: [], missed: 0, wrong: 0, wrongMs: 0, changes: 0, matched: 0, of: 0 });
const totals = { sung: total(), synthetic: total(), all: total() };
const row = (name, part) =>
  `${name.padEnd(22)} ${String(part.changes).padStart(7)}  ${seconds(percentile(part.late, 0.5))} ${seconds(percentile(part.late, 0.9))}  ${String(part.missed).padStart(6)}  ${`${String(part.wrong).padStart(5)} (${(part.wrongMs / 1000).toFixed(1)})`.padEnd(18)} ${`${Math.round((100 * part.matched) / Math.max(1, part.of))}%`.padStart(5)}`;
console.log(`${values.matcher ?? "song-match.mjs"} on ${values.heard}`);
console.log("recording              changes  late p50   p90  missed  wrong (s on screen)  heard");
for (const recording of RECORDINGS) {
  if (values.song && recording.id !== values.song && recording.song !== values.song) continue;
  const file = `${values.heard}/${recording.id}.json`;
  if (!existsSync(file)) continue;
  const capture = JSON.parse(readFileSync(file, "utf8"));
  const truth = TRUTH[recording.id] ?? capture.truth;
  if (!truth) continue;
  const song = songById(recording.song);
  const moves = follow(song, capture.messages);
  const result = measure(song, truth, moves, capture.seconds * 1000);
  const words = await heardShare(song, truth, capture.messages);
  const part = { ...result, changes: truth.length - 1, ...words };
  for (const sum of [totals[recording.kind], totals.all]) {
    sum.late.push(...part.late);
    for (const key of ["missed", "wrong", "wrongMs", "changes", "matched", "of"]) sum[key] += part[key];
  }
  console.log(row(recording.id, part));
  if (values.show) {
    for (const move of moves) {
      console.log(`    ${(move.at / 1000).toFixed(1).padStart(6)} s -> ${move.slide} ${song.slides[move.slide].label ?? ""}  «${move.heard}»`);
    }
  }
}
for (const [name, part] of Object.entries(totals)) {
  if (part.changes > 0) console.log(row(`all ${name === "all" ? "" : name}`.trim(), part));
}
