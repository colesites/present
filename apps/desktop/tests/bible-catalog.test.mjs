import assert from "node:assert/strict";
import { readdirSync } from "node:fs";
import { basename, extname } from "node:path";
import test from "node:test";

import {
  KNOWN_BIBLE_CODES,
  SUPPORTED_BIBLE_EXTENSIONS,
  bundledBibleId,
  formatBibleName,
  inferBibleCodeFromName,
  orderBundledBibles,
} from "../src/shared/lib/bible-catalog.mjs";

// What Electron's `list-bundled-bibles` does, pinned before the Rust port
// (`src-tauri/src/services/bible.rs` carries the same cases). The quirks are
// deliberate: an id is built from the code, and the scripture panel keys the
// versions a church has installed on it.

test("every Bible shipped in apps/desktop/bible gets the code and name it has today", () => {
  const shipped = Object.fromEntries(
    readdirSync(new URL("../bible", import.meta.url))
      .filter((file) => SUPPORTED_BIBLE_EXTENSIONS.has(extname(file).toLowerCase()))
      .map((file) => {
        const base = basename(file, extname(file));
        return [file, [inferBibleCodeFromName(base), formatBibleName(base)]];
      }),
  );
  assert.deepEqual(shipped, {
    "AMP.xml": ["AMP", "AMP"],
    "AMPC.xml": ["AMPC", "AMPC"],
    "ESV.xml": ["ESV", "ESV"],
    // Not "ERV": "RV" is earlier in the list and inside "ENGLISHERVBIBLE".
    "EnglishERVBible.xml": ["RV", "EnglishERVBible"],
    "GNT.xml": ["GNT", "GNT"],
    "KJV.xml": ["KJV", "KJV"],
    "MSG.xml": ["MSG", "MSG"],
    "NIV.xml": ["NIV", "NIV"],
    "NKJV.xml": ["NKJV", "NKJV"],
    "NLT.xml": ["NLT", "NLT"],
    "NRSV.xml": ["NRSV", "NRSV"],
    "RSV.xml": ["RSV", "RSV"],
    "TPT.xml": ["TPT", "TPT"],
  });
});

test("the first code in the list that the upper-cased name contains wins", () => {
  assert.equal(inferBibleCodeFromName("NRSVCE"), "NRSVCE", "listed before NRSV");
  assert.equal(inferBibleCodeFromName("nrsv-ce"), "NRSV", "the hyphen splits it");
  assert.equal(inferBibleCodeFromName("kjv-1611"), "KJV", "case is ignored");
  assert.equal(inferBibleCodeFromName("AKJV"), "KJV", "AKJV is listed after KJV, so never reached");
  assert.equal(inferBibleCodeFromName("ERV"), "RV", "RV is listed before ERV");
  assert.equal(inferBibleCodeFromName("NIrV"), "RV", "the mixed-case entry can never match an upper-cased name");
  assert.equal(inferBibleCodeFromName("Webster"), "WEB", "a code inside an ordinary word still counts");
});

test("a name with no known code is compacted, or called BIBLE", () => {
  assert.equal(inferBibleCodeFromName("my-bible_2"), "MYBIBLE2", "eight characters is the most kept");
  assert.equal(inferBibleCodeFromName("my-bible_23"), "BIBLE", "nine characters is one too many");
  assert.equal(inferBibleCodeFromName("q-z"), "QZ", "two characters is enough");
  assert.equal(inferBibleCodeFromName("x"), "BIBLE", "one character is too few");
  assert.equal(inferBibleCodeFromName("Very Long Name Here"), "BIBLE", "sixteen is too many");
  assert.equal(inferBibleCodeFromName(""), "BIBLE");
});

test("the display name turns underscores and hyphens into single spaces", () => {
  assert.equal(formatBibleName("New_King-James  Version"), "New King James Version");
  assert.equal(formatBibleName("a--b__c"), "a b c");
  assert.equal(formatBibleName(" ESV "), "ESV");
  assert.equal(formatBibleName("__"), "Bible");
});

test("an id is the lower-cased code, the size, and the modified time rounded to a millisecond", () => {
  assert.equal(bundledBibleId("NKJV", 4504794, 1742922000123.6), "nkjv-4504794-1742922000124");
  assert.equal(bundledBibleId("RV", 1, 0.4), "rv-1-0");
});

test("only xml, json and zip files are Bibles, and the caller lower-cases the extension", () => {
  assert.deepEqual([...SUPPORTED_BIBLE_EXTENSIONS].sort(), [".json", ".xml", ".zip"]);
  assert.equal(SUPPORTED_BIBLE_EXTENSIONS.has(".XML"), false);
});

test("the list is in localeCompare order, not character-code order", () => {
  const names = [
    "b",
    "A",
    "a",
    "B",
    "New King James",
    "new international",
    "NIV",
    "Amplified Classic",
    "AMP",
    "English ERV Bible",
    "_x",
    "9 thing",
  ];
  assert.deepEqual(
    orderBundledBibles(names.map((name) => ({ name }))).map((bible) => bible.name),
    [
      "_x",
      "9 thing",
      "a",
      "A",
      "AMP",
      "Amplified Classic",
      "b",
      "B",
      "English ERV Bible",
      "new international",
      "New King James",
      "NIV",
    ],
  );
});

test("the code list is the one bible.constants.ts had", () => {
  assert.equal(KNOWN_BIBLE_CODES.length, 56);
  assert.deepEqual(KNOWN_BIBLE_CODES.slice(0, 4), ["NRSVCE", "NRSVA", "NRSV", "NKJV"]);
  assert.deepEqual(KNOWN_BIBLE_CODES.slice(-3), ["BRG", "EASY", "EXB"]);
});
