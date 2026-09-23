/**
 * Reading the source tree for audio sources.
 *
 * Both audio suites need the same two primitives: walk the renderer tree, and
 * read the attributes of a JSX opening tag. They live here so there is one
 * implementation to trust rather than two that can drift apart — the guard in
 * `single-audible-video.test.mjs` is load-bearing, and a scanner that quietly
 * stops finding elements is a guard that quietly stops guarding.
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));

/** `apps/desktop`, so paths can be reported the way a developer types them. */
export const packageRoot = path.join(here, "..", "..");
export const sourceRoot = path.join(packageRoot, "src");

/** Every `.tsx` file under `src`, recursively. */
export const collectSourceFiles = (directory = sourceRoot, extension = ".tsx") => {
  const found = [];
  for (const entry of readdirSync(directory)) {
    const full = path.join(directory, entry);
    if (statSync(full).isDirectory()) {
      found.push(...collectSourceFiles(full, extension));
      continue;
    }
    if (full.endsWith(extension)) {
      found.push(full);
    }
  }
  return found;
};

/**
 * The attribute text of a JSX opening tag starting at `start`.
 *
 * Scans rather than pattern-matches: an attribute value can contain `>` inside
 * a JSX expression or a string, so the closing bracket has to be found at
 * brace depth zero and outside quotes.
 */
export const openingTagAt = (source, start) => {
  let depth = 0;
  let quote = null;

  for (let index = start; index < source.length; index += 1) {
    const character = source[index];

    if (quote) {
      if (character === quote && source[index - 1] !== "\\") quote = null;
      continue;
    }
    if (character === '"' || character === "'" || character === "`") {
      quote = character;
      continue;
    }
    if (character === "{") depth += 1;
    else if (character === "}") depth -= 1;
    else if (character === ">" && depth === 0) {
      return source.slice(start, index + 1);
    }
  }
  return source.slice(start);
};

/** Every occurrence of `token`, as `{ file, line, source }` with the file's text. */
export const findInSources = (token, extension = ".tsx") => {
  const found = [];
  for (const file of collectSourceFiles(sourceRoot, extension)) {
    const source = readFileSync(file, "utf8");
    const relative = path.relative(packageRoot, file);

    let index = source.indexOf(token);
    while (index !== -1) {
      found.push({
        file: relative,
        line: source.slice(0, index).split("\n").length,
        index,
        source,
      });
      index = source.indexOf(token, index + 1);
    }
  }
  return found;
};

/** Every JSX element of the given tag name, with its opening-tag attributes. */
export const findElements = (tagName) =>
  findInSources(`<${tagName}`).map((hit) => ({
    file: hit.file,
    line: hit.line,
    attributes: openingTagAt(hit.source, hit.index),
  }));
