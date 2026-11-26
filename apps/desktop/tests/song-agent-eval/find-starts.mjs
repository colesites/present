// A first draft of `truth.mjs` for a recording: given the order the slides
// were sung in (read from the transcript by a person), when each began,
// from the times the speech service gave the words it heard. Check every
// line by ear or against the transcript before trusting it; a first word
// the service missed shows as the next word's time.
//
//   node tests/song-agent-eval/find-starts.mjs --heard capture.json --song it-is-well --order 0,1,2,3,4,0,1
//
// The recordings' times are the same in every capture of them, whatever the
// settings, so this is done once per recording.

import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { heardWord, likeness, prepareSong, wordsOf } from "../../src/features/song-agent/song-match.mjs";
import { songById } from "./songs.mjs";

const { values } = parseArgs({
  options: { heard: { type: "string" }, song: { type: "string" }, order: { type: "string" } },
});
const song = songById(String(values.song));
const prepared = prepareSong(song);
const order = String(values.order).split(",").map(Number);
const capture = JSON.parse(readFileSync(String(values.heard), "utf8"));

// Every word of every finished turn, with when it began.
const heard = [];
for (const { message } of capture.messages) {
  if (message.type !== "Turn" || !message.end_of_turn || !message.turn_is_formatted) continue;
  for (const word of message.words ?? []) {
    for (const text of wordsOf(word.text)) heard.push({ ...heardWord(text, heard.length), start: word.start });
  }
}

let cursor = 0;
const starts = [];
for (const slide of order) {
  const { start, end } = prepared.slides[slide];
  const words = prepared.words.slice(start, end);
  let found = null;
  // The earliest heard word that is one of the slide's first four, followed
  // within three words by one of the words after it.
  for (let at = cursor; at < heard.length && !found; at += 1) {
    for (let j = 0; j < Math.min(4, words.length) && !found; j += 1) {
      if (likeness(heard[at], words[j]) < 0.6) continue;
      const confirmed = heard
        .slice(at + 1, at + 4)
        .some((later) => words.slice(j + 1, j + 4).some((word) => likeness(later, word) >= 0.6));
      if (confirmed) found = { at, j };
    }
  }
  if (!found) {
    console.log(`// slide ${slide}: not found after word ${cursor}`);
    continue;
  }
  const time = heard[found.at].start;
  starts.push([slide, time]);
  console.log(
    `  [${slide}, ${time}], // ${song.slides[slide].text.split("\n")[0]}  <- heard "${heard
      .slice(found.at, found.at + 4)
      .map((word) => word.text)
      .join(" ")}"${found.j > 0 ? ` (from its word ${found.j + 1})` : ""}`,
  );
  cursor = found.at + 1;
}
