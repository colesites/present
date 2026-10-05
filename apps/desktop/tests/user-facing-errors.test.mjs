import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import { collectSourceFiles, packageRoot } from "./lib/source-scan.mjs";

/**
 * What goes wrong is told to the operator in words written for them
 * (`src/renderer/shared/lib/user-error.ts`), never in the words of whatever
 * failed. "User Input Validation Error: Invalid 'keyterms_prompt': Value
 * error, Invalid JSON array" reached an operator through a tooltip, from
 * `error instanceof Error ? error.message : …`, which hands any library's,
 * service's or stack's text to the screen.
 */
test("no screen shows an error's own message", () => {
  const raw = /(\w+)\s+instanceof\s+Error\s*\?\s*\1\.message\s*:/;
  const files = [...collectSourceFiles(undefined, ".tsx"), ...collectSourceFiles(undefined, ".ts")];
  assert.ok(files.length > 100, `found only ${files.length} source files; the scanner is broken`);
  const offenders = files
    .filter((file) => !file.endsWith(path.join("shared", "lib", "user-error.ts")))
    .filter((file) => raw.test(readFileSync(file, "utf8")))
    .map((file) => path.relative(packageRoot, file));
  assert.deepEqual(
    offenders,
    [],
    "Show userMessage(error, \"a plain sentence\", \"where\") instead: the error goes to the log.",
  );
});

test("the voice service is sent its key terms as one JSON array", () => {
  const speech = readFileSync(
    path.join(packageRoot, "src/features/scripture/hooks/useSpeechRecognition.ts"),
    "utf8",
  );
  assert.ok(!speech.includes('searchParams.append("keyterms_prompt"'), "one parameter per term is refused");
  assert.ok(speech.includes('searchParams.set("keyterms_prompt", JSON.stringify('));
});

test("a voice failure is said in a toast, not a tooltip", () => {
  const speech = readFileSync(
    path.join(packageRoot, "src/features/scripture/hooks/useSpeechRecognition.ts"),
    "utf8",
  );
  assert.ok(speech.includes('toast.error(error, { id: "voice-search" })'));
  const panel = readFileSync(
    path.join(packageRoot, "src/features/scripture/components/ScripturePanel.tsx"),
    "utf8",
  );
  assert.ok(!/title=\{\s*speechError/.test(panel), "the mic's tooltip shows the error again");
});
