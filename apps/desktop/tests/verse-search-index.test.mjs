import assert from "node:assert/strict";
import test from "node:test";
import { buildVerseSearchIndex, chooseAcrossBibles, findQuotedVerse, quotedVerseMatch, searchVerseIndex } from "../src/features/scripture/lib/verse-search-index.mjs";

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

// Read aloud from one Bible while the tab shows another.
test("the Bible a verse is read from is the one its words follow furthest", () => {
  const nkjv = buildVerseSearchIndex([
    { pk: "nkjv|jhn|3|16", text: "For God so loved the world that He gave His only begotten Son, that whoever believes in Him should not perish but have everlasting life." },
  ]);
  const niv = buildVerseSearchIndex([
    { pk: "niv|jhn|3|16", text: "For God so loved the world that he gave his one and only Son, that whoever believes in him shall not perish but have eternal life." },
  ]);
  const heard = "Now look at verse 16. For God so loved the world that he gave his one and only Son,";
  const fromNkjv = quotedVerseMatch(nkjv, heard, { commonAfter: 2 });
  const fromNiv = quotedVerseMatch(niv, heard, { commonAfter: 2 });
  assert.equal(fromNkjv?.run, 10, "the NKJV shares its first ten words");
  assert.equal(fromNiv?.run, 14, "the NIV, all fourteen said so far");
  assert.equal(fromNkjv?.shared, 12, "and twelve in order");
  assert.equal(fromNiv?.shared, 14);
  const chosen = chooseAcrossBibles(
    [
      { versionId: "nkjv", ...fromNkjv },
      { versionId: "niv", ...fromNiv },
    ],
    "nkjv",
  );
  assert.equal(chosen.verse.pk, "niv|jhn|3|16", "two words further: the NIV is being read");
});

test("one word's difference is not a reason to switch Bibles", () => {
  // Said in the app: the KJV in use, and "heavens", where the KJV has "heaven".
  const heard = "In the beginning, God created the heavens and the earth.";
  const kjv = quotedVerseMatch(
    buildVerseSearchIndex([{ pk: "kjv|gen|1|1", text: "In the beginning God created the heaven and the earth." }]),
    heard,
    { commonAfter: 2 },
  );
  const esv = quotedVerseMatch(
    buildVerseSearchIndex([{ pk: "esv|gen|1|1", text: "In the beginning, God created the heavens and the earth." }]),
    heard,
    { commonAfter: 2 },
  );
  assert.equal(esv.shared - kjv.shared, 1);
  const kept = chooseAcrossBibles(
    [
      { versionId: "kjv", ...kjv },
      { versionId: "esv", ...esv },
    ],
    "kjv",
  );
  assert.equal(kept.verse.pk, "kjv|gen|1|1");
  assert.equal(
    chooseAcrossBibles([{ versionId: "esv", ...esv }], "kjv").verse.pk,
    "esv|gen|1|1",
    "found only in another Bible, it is that one's",
  );
});

test("only a quote being read now counts, not one the preacher has moved on from", () => {
  const read = "except a man be born again, he cannot see the kingdom of God";
  const bornAgain = buildVerseSearchIndex([{ pk: "jhn|3|3", text: `Jesus answered and said unto him, Verily, verily, I say unto thee, ${read}.` }]);
  assert.equal(quotedVerseMatch(bornAgain, `${read}.`, { endingWithin: 3 })?.verse.pk, "jhn|3|3");
  assert.equal(
    quotedVerseMatch(bornAgain, `${read}. And then look at verse 16.`, { endingWithin: 3 }),
    null,
    "verse 16 is named after it",
  );
  assert.equal(findQuotedVerse(bornAgain, `${read}. And then look at verse 16.`)?.pk, "jhn|3|3", "unless asked about any");
});

test("four words are enough when no other verse has them, said as a quote", () => {
  const verses = buildVerseSearchIndex([
    { pk: "gen|1|1", text: "In the beginning God created the heaven and the earth." },
    { pk: "jhn|1|1", text: "In the beginning was the Word, and the Word was with God, and the Word was God." },
    { pk: "jhn|1|2", text: "The same was in the beginning with God." },
    { pk: "gen|1|3", text: "And God said, Let there be light: and there was light." },
    { pk: "jdg|17|7", text: "And there was a young man out of Bethlehemjudah of the family of Judah." },
    { pk: "psa|46|10", text: "Be still, and know that I am God: I will be exalted among the heathen." },
  ]);
  const quote = (heard) => findQuotedVerse(verses, heard, { commonAfter: 3 })?.pk ?? null;
  assert.equal(quote("Let there be light"), "gen|1|3", "said as a sentence of its own");
  assert.equal(quote("Amen. Be still and know"), "psa|46|10", "a sentence after another");
  assert.equal(quote("in the beginning"), null, "three verses open alike: the model's to say");
  assert.equal(quote("in the beginning was the"), "jhn|1|1", "until one has more of it");
  assert.equal(
    quote("when I was a young man"),
    null,
    "four words in the middle of a sentence and of a verse are not a quote",
  );
});
