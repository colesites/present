// @ts-check

/**
 * The bundled Bible catalog's rules: which files count, what each is called,
 * its id, and the order the list is in.
 *
 * Extracted verbatim from `features/bible/bible.utils.ts`,
 * `bible.constants.ts` and `bible.service.ts` so `tests/bible-catalog.test.mjs`
 * can pin what Electron does before `src-tauri/src/services/bible.rs` ports it.
 * The quirks are kept on purpose: an id changes if a code does, and the
 * scripture panel keys installed versions on it.
 */

/** Order matters: the first code contained in a file name wins. */
export const KNOWN_BIBLE_CODES = [
  "NRSVCE",
  "NRSVA",
  "NRSV",
  "NKJV",
  "TNIV",
  "AMPC",
  "HCSB",
  "NIrV",
  "NABRE",
  "RSVCE",
  "KJV",
  "NIV",
  "ESV",
  "NASB",
  "NLT",
  "RSV",
  "AMP",
  "MSG",
  "CSB",
  "NCV",
  "GNT",
  "CEV",
  "TPT",
  "VOICE",
  "TLB",
  "PHILLIPS",
  "MOUNCE",
  "NET",
  "ISV",
  "LEB",
  "WEB",
  "ASV",
  "YLT",
  "DARBY",
  "AKJV",
  "RV",
  "ERV",
  "BBE",
  "DRA",
  "JB",
  "NJB",
  "GW",
  "JUB",
  "MEV",
  "NOG",
  "TLV",
  "CEB",
  "CJB",
  "EHV",
  "GNV",
  "ICB",
  "NLV",
  "BSB",
  "BRG",
  "EASY",
  "EXB",
];

export const SUPPORTED_BIBLE_EXTENSIONS = new Set([".xml", ".json", ".zip"]);

/** @param {string} fileNameBase the file name without its extension */
export const inferBibleCodeFromName = (fileNameBase) => {
  const upperBase = fileNameBase.toUpperCase();
  const knownCode = KNOWN_BIBLE_CODES.find((code) => upperBase.includes(code));
  if (knownCode) {
    return knownCode;
  }

  const compact = fileNameBase.replace(/[^A-Za-z0-9]/g, "").toUpperCase();
  if (compact.length >= 2 && compact.length <= 8) {
    return compact;
  }

  return "BIBLE";
};

/** @param {string} fileNameBase the file name without its extension */
export const formatBibleName = (fileNameBase) => {
  const spaced = fileNameBase.replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim();
  return spaced.length > 0 ? spaced : "Bible";
};

/**
 * @param {string} code
 * @param {number} sizeBytes
 * @param {number} mtimeMs
 */
export const bundledBibleId = (code, sizeBytes, mtimeMs) =>
  `${code.toLowerCase()}-${sizeBytes}-${Math.round(mtimeMs)}`;

/**
 * @template {{ name: string }} T
 * @param {T[]} bibles
 * @returns {T[]}
 */
export const orderBundledBibles = (bibles) =>
  [...bibles].sort((a, b) => a.name.localeCompare(b.name));
