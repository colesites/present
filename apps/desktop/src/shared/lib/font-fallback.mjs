/**
 * What to draw a font in when it is not on this computer.
 *
 * A deck made on Windows or in Canva names fonts a Mac may not have —
 * Calibri, Aptos, Cambria, Century Schoolbook — and left to itself a canvas
 * draws them in its default face, often a serif where the deck wanted a sans
 * or the reverse. Each is given fonts of the same kind, closest first, then a
 * generic family. `compositor/font_fallback.rs` reads the same table.
 *
 * @typedef {"serif" | "sans-serif" | "monospace" | "cursive"} Generic
 */

/** @type {Record<string, { fonts: string[], generic: Generic }>} */
export const FONT_FALLBACKS = {
  calibri: { fonts: ["Carlito", "Helvetica Neue", "Arial"], generic: "sans-serif" },
  "calibri light": { fonts: ["Carlito", "Helvetica Neue", "Arial"], generic: "sans-serif" },
  aptos: { fonts: ["Helvetica Neue", "Arial"], generic: "sans-serif" },
  "aptos display": { fonts: ["Helvetica Neue", "Arial"], generic: "sans-serif" },
  "aptos narrow": { fonts: ["Arial Narrow", "Helvetica Neue"], generic: "sans-serif" },
  "segoe ui": { fonts: ["Helvetica Neue", "Arial"], generic: "sans-serif" },
  "segoe ui light": { fonts: ["Helvetica Neue", "Arial"], generic: "sans-serif" },
  "segoe ui semibold": { fonts: ["Helvetica Neue", "Arial"], generic: "sans-serif" },
  "open sans": { fonts: ["Helvetica Neue", "Arial"], generic: "sans-serif" },
  "open sans bold": { fonts: ["Helvetica Neue", "Arial"], generic: "sans-serif" },
  poppins: { fonts: ["Avenir Next", "Helvetica Neue"], generic: "sans-serif" },
  "poppins bold": { fonts: ["Avenir Next", "Helvetica Neue"], generic: "sans-serif" },
  montserrat: { fonts: ["Avenir Next", "Helvetica Neue"], generic: "sans-serif" },
  raleway: { fonts: ["Avenir Next", "Helvetica Neue"], generic: "sans-serif" },
  lato: { fonts: ["Helvetica Neue", "Arial"], generic: "sans-serif" },
  roboto: { fonts: ["Helvetica Neue", "Arial"], generic: "sans-serif" },
  "canva sans": { fonts: ["Helvetica Neue", "Arial"], generic: "sans-serif" },
  "century gothic": { fonts: ["Futura", "Avenir Next"], generic: "sans-serif" },
  "tw cen mt": { fonts: ["Futura", "Avenir Next Condensed"], generic: "sans-serif" },
  "gill sans mt": { fonts: ["Gill Sans", "Helvetica Neue"], generic: "sans-serif" },
  "franklin gothic medium": { fonts: ["Franklin Gothic Medium", "Avenir Next Condensed"], generic: "sans-serif" },
  "franklin gothic book": { fonts: ["Avenir Next", "Helvetica Neue"], generic: "sans-serif" },
  corbel: { fonts: ["Avenir Next", "Helvetica Neue"], generic: "sans-serif" },
  candara: { fonts: ["Avenir Next", "Helvetica Neue"], generic: "sans-serif" },
  tahoma: { fonts: ["Verdana", "Helvetica Neue"], generic: "sans-serif" },
  "avenir next lt pro": { fonts: ["Avenir Next", "Helvetica Neue"], generic: "sans-serif" },
  "neue haas grotesk text pro": { fonts: ["Helvetica Neue", "Arial"], generic: "sans-serif" },
  cambria: { fonts: ["Caladea", "Georgia", "Times New Roman"], generic: "serif" },
  "cambria math": { fonts: ["Caladea", "Georgia", "Times New Roman"], generic: "serif" },
  "century schoolbook": { fonts: ["New Century Schoolbook", "Georgia", "Times New Roman"], generic: "serif" },
  century: { fonts: ["Georgia", "Times New Roman"], generic: "serif" },
  constantia: { fonts: ["Georgia", "Times New Roman"], generic: "serif" },
  garamond: { fonts: ["Garamond", "EB Garamond", "Baskerville", "Georgia"], generic: "serif" },
  "book antiqua": { fonts: ["Palatino", "Georgia"], generic: "serif" },
  "palatino linotype": { fonts: ["Palatino", "Georgia"], generic: "serif" },
  "bookman old style": { fonts: ["Bookman", "Georgia"], generic: "serif" },
  rockwell: { fonts: ["Rockwell", "American Typewriter", "Georgia"], generic: "serif" },
  consolas: { fonts: ["Menlo", "Courier New"], generic: "monospace" },
  "courier new": { fonts: ["Courier New", "Menlo"], generic: "monospace" },
  "lucida console": { fonts: ["Menlo", "Courier New"], generic: "monospace" },
  "bradley hand itc": { fonts: ["Bradley Hand", "Snell Roundhand"], generic: "cursive" },
  "freestyle script": { fonts: ["Snell Roundhand", "Bradley Hand"], generic: "cursive" },
  "segoe script": { fonts: ["Bradley Hand", "Snell Roundhand"], generic: "cursive" },
  "lucida handwriting": { fonts: ["Bradley Hand", "Snell Roundhand"], generic: "cursive" },
};

const SERIF_HINTS = ["serif", "roman", "times", "georgia", "garamond", "book", "schoolbook", "baskerville", "bodoni", "caslon", "palatino", "cambria", "minion", "didot", "merriweather", "playfair", "lora"];
const MONO_HINTS = ["mono", "code", "courier", "consol"];
const SCRIPT_HINTS = ["script", "hand", "brush", "signature", "calligraph"];

/**
 * The fonts to try after `family`, closest first, and the generic family to
 * end on.
 * @param {string} family
 * @returns {{ fonts: string[], generic: Generic }}
 */
export const fontFallback = (family) => {
  const key = family.trim().toLowerCase();
  const known = FONT_FALLBACKS[key];
  if (known) return known;
  if (/sans/.test(key)) return { fonts: [], generic: "sans-serif" };
  if (MONO_HINTS.some((hint) => key.includes(hint))) return { fonts: [], generic: "monospace" };
  if (SCRIPT_HINTS.some((hint) => key.includes(hint))) return { fonts: [], generic: "cursive" };
  if (SERIF_HINTS.some((hint) => key.includes(hint))) return { fonts: [], generic: "serif" };
  return { fonts: [], generic: "sans-serif" };
};

/**
 * `family` as a canvas or CSS font-family list, its fallbacks after it.
 * @param {string} family
 */
export const fontStack = (family) => {
  const { fonts, generic } = fontFallback(family);
  const quote = (/** @type {string} */ name) => `"${name.replace(/"/g, "")}"`;
  return [quote(family), ...fonts.map(quote), generic].join(", ");
};
