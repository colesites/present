import assert from "node:assert/strict";
import test from "node:test";
import { buildVerseSearchIndex, findQuotedVerse, searchVerseIndex } from "../src/features/scripture/lib/verse-search-index.mjs";

const verses = [
  { pk: "1", text: "For God so loved the world that he gave his one and only Son" },
  { pk: "2", text: "The Lord is my shepherd I shall not want" },
  { pk: "3", text: "For the world offers only a craving for physical pleasure" },
  { pk: "4", text: "In the beginning God created the heavens and the earth" },
];
const index = buildVerseSearchIndex(verses);

test("exact mode requires the complete phrase in order", () => {
  assert.deepEqual(searchVerseIndex(index, { query: "God so loved the world", mode: "exact" }).map((v) => v.pk), ["1"]);
  assert.deepEqual(searchVerseIndex(index, { query: "world God loved", mode: "exact" }), []);
});

test("broad mode ranks coverage and ordered words", () => {
  const results = searchVerseIndex(index, { query: "God loved world gave son", mode: "broad" });
  assert.equal(results[0]?.pk, "1");
});

test("partial speech tokens use prefix postings", () => {
  const results = searchVerseIndex(index, { query: "lord shep", mode: "broad" });
  assert.equal(results[0]?.pk, "2");
});

test("spoken verse text phrases rank immediate scripture suggestions", () => {
  const results = searchVerseIndex(index, { query: "in the beginning", mode: "broad" });
  assert.equal(results[0]?.pk, "4");
});

// The Bible agent's Find it: a verse quoted rather than named.
const quotable = buildVerseSearchIndex([
  { pk: "jhn|11|35", text: "Jesus wept." },
  { pk: "jhn|3|16", text: "For God so loved the world, that he gave his only begotten Son, that whosoever believeth in him should not perish, but have everlasting life." },
  { pk: "psa|23|1", text: "The LORD is my shepherd; I shall not want." },
  { pk: "psa|136|1", text: "O give thanks unto the LORD; for he is good: for his mercy endureth for ever." },
  { pk: "psa|136|2", text: "O give thanks unto the God of gods: for his mercy endureth for ever." },
  { pk: "act|4|18", text: "And they called them, and commanded them not to speak at all nor teach in the name of Jesus." },
  { pk: "joh|11|36", text: "Then said the Jews, Behold how he loved him!" },
  { pk: "php|2|10", text: "That at the name of Jesus every knee should bow, of things in heaven." },
  { pk: "mat|6|9", text: "After this manner therefore pray ye: Our Father which art in heaven, Hallowed be thy name." },
]);
// As in a whole Bible: "name", "Jesus" and "heaven" are in more verses than
// this, "wept" and "shepherd" are not.
const quoted = (heard) => findQuotedVerse(quotable, heard, { commonAfter: 2 })?.pk ?? null;

test("a short verse said whole is found though no reference was named", () => {
  assert.equal(quoted("Jesus wept"), "jhn|11|35");
  assert.equal(quoted("as the shortest verse in the Bible says, Jesus wept."), "jhn|11|35");
});

test("a longer verse is found by enough of its words in a row", () => {
  assert.equal(quoted("remember for God so loved the world church"), "jhn|3|16");
  assert.equal(quoted("the Lord is my shepherd I shall not want"), "psa|23|1");
});

test("what is not a quote, or quotes several verses alike, finds nothing", () => {
  assert.equal(quoted("Jesus"), null, "one word is not a verse");
  assert.equal(quoted("we pray in the name of Jesus"), null, "a stock phrase, no rare word");
  assert.equal(quoted("for his mercy endureth for ever"), null, "more than one verse says it");
  assert.equal(quoted("God so loved"), null, "too little of a long verse");
  assert.equal(quoted("please be seated and turn to your neighbour"), null);
});
