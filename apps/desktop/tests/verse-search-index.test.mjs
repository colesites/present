import assert from "node:assert/strict";
import test from "node:test";
import { buildVerseSearchIndex, searchVerseIndex } from "../src/features/scripture/lib/verse-search-index.mjs";

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
