// @ts-check

/**
 * The font catalog's rules: how a system font or an installed font file becomes
 * the face the font pickers list, and the order they are listed in.
 *
 * Moved verbatim out of `shared/lib/font.ts` and `main/services/font.service.ts`,
 * with the post-processing `font-list` 2.0.2 applies in JavaScript, so
 * `tests/font-catalog.test.mjs` can pin what Electron does before
 * `src-tauri/src/services/fonts.rs` ports it.
 *
 * No Node imports: the renderer imports this through `font.ts`.
 */

/** @typedef {import("../types/font").SystemFontFace} SystemFontFace */
/** @typedef {import("../types/font").CustomFontFace} CustomFontFace */
/** @typedef {import("../types/font").FontFaceRecord} FontFaceRecord */

export const SUPPORTED_CUSTOM_FONT_EXTENSIONS = /** @type {const} */ ([
  ".ttf",
  ".otf",
  ".woff",
  ".woff2",
]);

const WEIGHT_HINTS = [
  { match: /\b(thin|hairline)\b/i, weight: "100", label: "Thin" },
  { match: /\b(extra[\s-]?light|ultra[\s-]?light)\b/i, weight: "200", label: "Extra Light" },
  { match: /\b(light)\b/i, weight: "300", label: "Light" },
  { match: /\b(book|regular|roman|normal)\b/i, weight: "400", label: "Regular" },
  { match: /\b(medium)\b/i, weight: "500", label: "Medium" },
  { match: /\b(semi[\s-]?bold|demi[\s-]?bold)\b/i, weight: "600", label: "Semibold" },
  { match: /\b(bold)\b/i, weight: "700", label: "Bold" },
  { match: /\b(extra[\s-]?bold|ultra[\s-]?bold|heavy)\b/i, weight: "800", label: "Extra Bold" },
  { match: /\b(black|extra[\s-]?black|ultra[\s-]?black)\b/i, weight: "900", label: "Black" },
];

const STYLE_HINTS = [
  { match: /\b(italic)\b/i, style: "italic", label: "Italic" },
  { match: /\b(oblique)\b/i, style: "oblique", label: "Oblique" },
];

/** @param {string} value */
function toTitleCase(value) {
  return value
    .trim()
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

/**
 * @param {string | null | undefined} rawWeight
 * @returns {{ weight: string, weightLabel: string }}
 */
export function normalizeFontWeightMeta(rawWeight) {
  const normalized = rawWeight?.trim() ?? "";

  if (/^\d+$/.test(normalized)) {
    const parsed = Math.min(Math.max(Number.parseInt(normalized, 10), 100), 900);
    const rounded = `${Math.round(parsed / 100) * 100}`;
    const hinted = WEIGHT_HINTS.find((hint) => hint.weight === rounded);
    return {
      weight: rounded,
      weightLabel: hinted?.label ?? rounded,
    };
  }

  const hinted = WEIGHT_HINTS.find((entry) => entry.match.test(normalized));
  if (hinted) {
    return {
      weight: hinted.weight,
      weightLabel: hinted.label,
    };
  }

  return {
    weight: "400",
    weightLabel: normalized ? toTitleCase(normalized) : "Regular",
  };
}

/**
 * @param {string | null | undefined} rawStyle
 * @returns {{ style: string, styleLabel: string }}
 */
export function normalizeFontStyleMeta(rawStyle) {
  const normalized = rawStyle?.trim() ?? "";
  const hinted = STYLE_HINTS.find((entry) => entry.match.test(normalized));
  if (hinted) {
    return {
      style: hinted.style,
      styleLabel: hinted.label,
    };
  }

  return {
    style: "normal",
    styleLabel: normalized ? toTitleCase(normalized) : "Normal",
  };
}

/** @param {string} fileName */
export function inferFontMetaFromFileName(fileName) {
  const baseName = fileName.replace(/\.[^.]+$/, "");
  const normalized = baseName.replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim();
  const styleMeta = normalizeFontStyleMeta(normalized);
  const weightMeta = normalizeFontWeightMeta(normalized);
  const familyName = normalized
    .replace(
      /\b(thin|hairline|extra[\s-]?light|ultra[\s-]?light|light|book|regular|roman|normal|medium|semi[\s-]?bold|demi[\s-]?bold|bold|extra[\s-]?bold|ultra[\s-]?bold|heavy|black|extra[\s-]?black|ultra[\s-]?black|italic|oblique)\b/gi,
      "",
    )
    .replace(/\s+/g, " ")
    .trim();

  return {
    familyName: familyName || normalized || "Custom Font",
    ...weightMeta,
    ...styleMeta,
  };
}

/** @param {string} fileName */
export function getFontFileMimeType(fileName) {
  const lower = fileName.toLowerCase();
  if (lower.endsWith(".otf")) {
    return "font/otf";
  }
  if (lower.endsWith(".woff2")) {
    return "font/woff2";
  }
  if (lower.endsWith(".woff")) {
    return "font/woff";
  }
  return "font/ttf";
}

/** @param {FontFaceRecord} face */
export function getFontFaceSortKey(face) {
  return /** @type {const} */ ([
    face.familyName.toLocaleLowerCase(),
    Number.parseInt(face.weight, 10) || 400,
    face.style.toLocaleLowerCase(),
    face.postScriptName.toLocaleLowerCase(),
  ]);
}

/**
 * Compares the keys as `<` compares two arrays: as their comma-joined strings.
 *
 * @template {FontFaceRecord} T
 * @param {T[]} faces
 * @returns {T[]}
 */
export function sortFontFaces(faces) {
  return [...faces].sort((left, right) => {
    const leftKey = getFontFaceSortKey(left);
    const rightKey = getFontFaceSortKey(right);
    return leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0;
  });
}

/**
 * @template {FontFaceRecord} T
 * @param {T[]} faces
 * @returns {T[]}
 */
export function dedupeFontFaces(faces) {
  const seen = new Set();
  return sortFontFaces(
    faces.filter((face) => {
      const key = [
        face.source,
        face.familyName,
        face.postScriptName,
        face.weight,
        face.style,
        "fileName" in face ? face.fileName : "",
      ].join("|");
      if (seen.has(key)) {
        return false;
      }
      seen.add(key);
      return true;
    }),
  );
}

// --- The system font list ---------------------------------------------------
//
// On macOS, font-list runs two small Objective-C helpers. `fontlist` prints
// NSFontManager's families; `fontlist2` prints one entry per family, for its
// first member, guessing the rest from that member's PostScript name. The
// guesses are `describeMacFontFamily`; the test checks them against the
// helper itself.

export const FONT_LIST_EXCEPTIONS = ["iconfont"];

/**
 * `fontlist2.m`: what the helper says about a family from its first member.
 *
 * @param {string} familyName
 * @param {string} postScriptName the first member's, or the family name when
 *   the family has no members
 */
export function describeMacFontFamily(familyName, postScriptName) {
  const lowerName = postScriptName.toLowerCase();
  let weight = "regular";
  if (lowerName.includes("ultralight") || lowerName.includes("thin")) {
    weight = "ultralight";
  } else if (lowerName.includes("light")) {
    weight = "light";
  } else if (lowerName.includes("medium")) {
    weight = "medium";
  } else if (lowerName.includes("semibold") || lowerName.includes("demibold")) {
    weight = "semibold";
  } else if (lowerName.includes("bold")) {
    weight = "bold";
  } else if (lowerName.includes("heavy") || lowerName.includes("black")) {
    weight = "heavy";
  }

  const style = lowerName.includes("italic") || lowerName.includes("oblique") ? "italic" : "normal";

  let width = "normal";
  if (lowerName.includes("condensed") || lowerName.includes("narrow")) {
    width = "condensed";
  } else if (lowerName.includes("expanded") || lowerName.includes("extended")) {
    width = "expanded";
  }

  const monospace = [
    "mono",
    "courier",
    "console",
    "terminal",
    "fixed",
    "typewriter",
    "source",
    "code",
    "fira",
    "jetbrains",
    "menlo",
    "monaco",
  ].some((hint) => lowerName.includes(hint));

  return { familyName, postScriptName, weight, style, width, monospace };
}

/**
 * font-list's `standardize` with `disableQuoting: true`.
 *
 * @param {string} name
 */
export function standardizeFontListName(name) {
  let value = name.replace(/\\u([\da-f]{4})/gi, (_match, hex) =>
    String.fromCharCode(Number.parseInt(hex, 16)),
  );
  if (value.startsWith('"') && value.endsWith('"')) {
    value = value.substr(1, value.length - 2);
  }
  return value;
}

/**
 * font-list's sort: lower-cased, leading quotes ignored, and never "equal".
 *
 * @template T
 * @param {T[]} items
 * @param {(item: T) => string} nameOf
 * @returns {T[]}
 */
export function orderFontList(items, nameOf) {
  return [...items].sort((a, b) =>
    nameOf(a).replace(/^['"]+/, "").toLocaleLowerCase() <
    nameOf(b).replace(/^['"]+/, "").toLocaleLowerCase()
      ? -1
      : 1,
  );
}

/**
 * What font-list's `getFonts` does with the helper's family names.
 *
 * @param {string[]} helperLines
 * @returns {string[]}
 */
export function fontListFamilies(helperLines) {
  return orderFontList(
    Array.from(new Set(helperLines))
      .filter((name) => name && !FONT_LIST_EXCEPTIONS.includes(name))
      .map(standardizeFontListName),
    (name) => name,
  );
}

/**
 * `getSystemFontFamilies`, given what font-list returned.
 *
 * @param {string[]} fonts
 * @returns {string[]}
 */
export function finishSystemFontFamilies(fonts) {
  return Array.from(new Set(fonts.map((font) => font.trim()).filter(Boolean))).sort(
    (left, right) => left.localeCompare(right),
  );
}

/**
 * `get-system-fonts` from the helper's output.
 *
 * @param {string[]} helperLines
 */
export function systemFontFamilies(helperLines) {
  return finishSystemFontFamilies(fontListFamilies(helperLines));
}

/**
 * @typedef {{
 *   familyName: string,
 *   postScriptName: string,
 *   weight?: string,
 *   style?: string,
 *   width?: string,
 *   monospace?: boolean,
 * }} FontListFace
 */

/**
 * What font-list's `getFonts2` does with the helper's entries.
 *
 * @param {Array<{ familyName?: unknown, postScriptName?: unknown, weight?: string, style?: string, width?: string, monospace?: boolean }>} entries
 * @returns {FontListFace[]}
 */
export function fontListFaces(entries) {
  return orderFontList(
    entries
      .filter(
        (font) =>
          font.familyName &&
          typeof font.familyName === "string" &&
          !FONT_LIST_EXCEPTIONS.includes(font.familyName),
      )
      .map((font) => ({
        familyName: standardizeFontListName(/** @type {string} */ (font.familyName)),
        postScriptName: /** @type {string} */ (font.postScriptName),
        weight: font.weight || "regular",
        style: font.style || "normal",
        width: font.width || "normal",
        monospace: font.monospace || false,
      })),
    (font) => font.familyName,
  );
}

/**
 * `getSystemFontFaces`, given what font-list returned.
 *
 * @param {FontListFace[]} faces
 * @returns {SystemFontFace[]}
 */
export function finishSystemFontFaces(faces) {
  return dedupeFontFaces(
    faces
      .map((face) => {
        const weightMeta = normalizeFontWeightMeta(face.weight);
        const styleMeta = normalizeFontStyleMeta(face.style);
        return /** @type {SystemFontFace} */ ({
          familyName: face.familyName.trim(),
          postScriptName: face.postScriptName.trim(),
          weight: weightMeta.weight,
          weightLabel: weightMeta.weightLabel,
          style: styleMeta.style,
          styleLabel: styleMeta.styleLabel,
          width: face.width?.trim() ?? "",
          monospace: Boolean(face.monospace),
          source: "system",
        });
      })
      .filter((face) => Boolean(face.familyName) && Boolean(face.postScriptName)),
  );
}

/**
 * `get-system-font-faces` from the helper's entries.
 *
 * @param {Array<{ familyName?: unknown, postScriptName?: unknown, weight?: string, style?: string, width?: string, monospace?: boolean }>} entries
 */
export function systemFontFaces(entries) {
  return finishSystemFontFaces(fontListFaces(entries));
}

/**
 * What `getSystemFontFaces` falls back to when font-list's detailed call throws.
 *
 * @param {string[]} families
 * @returns {SystemFontFace[]}
 */
export function plainSystemFontFaces(families) {
  return families.map((familyName) => ({
    familyName,
    postScriptName: familyName,
    weight: "400",
    weightLabel: "Regular",
    style: "normal",
    styleLabel: "Normal",
    width: "",
    monospace: false,
    source: /** @type {const} */ ("system"),
  }));
}

// --- Installed fonts --------------------------------------------------------

/**
 * `path.parse(fileName)` for a bare file name: the stem and the extension.
 *
 * @param {string} fileName
 */
export function splitFontFileName(fileName) {
  const dot = fileName.lastIndexOf(".");
  if (dot <= 0) {
    return { name: fileName, ext: "" };
  }
  return { name: fileName.slice(0, dot), ext: fileName.slice(dot) };
}

/** @param {string} fileName */
export function isSupportedFontFile(fileName) {
  const extension = splitFontFileName(fileName).ext.toLowerCase();
  return SUPPORTED_CUSTOM_FONT_EXTENSIONS.some((supported) => supported === extension);
}

/**
 * The name an installed copy of `originalFileName` gets, never one that
 * `exists` says is taken: `Name.ttf`, then `Name 1.ttf`, `Name 2.ttf`…
 *
 * @param {string} originalFileName
 * @param {(fileName: string) => boolean} exists
 */
export function uniqueFontFileName(originalFileName, exists) {
  const parsed = splitFontFileName(originalFileName);
  const extension = parsed.ext || ".ttf";
  const safeStem = parsed.name.trim() || "Custom Font";
  let candidate = `${safeStem}${extension}`;
  let counter = 1;
  while (exists(candidate)) {
    candidate = `${safeStem} ${counter}${extension}`;
    counter += 1;
  }
  return candidate;
}

/**
 * An installed font as the pickers list it.
 *
 * @param {string} fileName
 * @param {string} filePath
 * @param {string} base64 the file's bytes
 * @returns {CustomFontFace}
 */
export function customFontFace(fileName, filePath, base64) {
  const inferred = inferFontMetaFromFileName(fileName);
  return {
    familyName: inferred.familyName,
    postScriptName: splitFontFileName(fileName).name,
    weight: inferred.weight,
    weightLabel: inferred.weightLabel,
    style: inferred.style,
    styleLabel: inferred.styleLabel,
    width: "",
    monospace: false,
    source: "custom",
    fileName,
    filePath,
    dataUrl: `data:${getFontFileMimeType(fileName)};base64,${base64}`,
  };
}
