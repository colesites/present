#!/usr/bin/env node
// Record what the Electron PPTX importer makes of each fixture:
// parse_pptx.py, then lib/pptx-payload.mjs — exactly the path
// `parse-pptx` takes. The Rust importer is tested against these files.
//
//   PRESENT_PPTX_PYTHON=/path/to/python node scripts/pptx-expected.mjs
//
// The Python needs python-pptx. Without PRESENT_PPTX_PYTHON, `python3` is used.

import { execFileSync } from "node:child_process";
import { readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { convertPayloadToPresentation } from "../src/main/lib/pptx-payload.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const fixtures = path.join(here, "..", "tests", "fixtures", "pptx");
const parser = path.join(here, "..", "parse_pptx.py");
const python = process.env.PRESENT_PPTX_PYTHON || "python3";

export function importWithElectron(file) {
  const stdout = execFileSync(python, [parser, "--mode", "pptx", file], {
    maxBuffer: 512 * 1024 * 1024,
    stdio: ["ignore", "pipe", "ignore"],
  });
  return convertPayloadToPresentation(JSON.parse(stdout.toString()), file);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  for (const name of readdirSync(fixtures).filter((entry) => entry.endsWith(".pptx")).sort()) {
    const file = path.join(fixtures, name);
    const expected = importWithElectron(file);
    const target = file.replace(/\.pptx$/, ".expected.json");
    writeFileSync(target, `${JSON.stringify(expected, null, 2)}\n`);
    console.log(`wrote ${path.relative(process.cwd(), target)}: ${expected.slides.length} slide(s)`);
  }
}
