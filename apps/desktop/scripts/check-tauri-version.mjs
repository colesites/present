#!/usr/bin/env node
/**
 * Keeps the desktop version in sync across the three places that carry it:
 *
 *   package.json          → the Electron build and the workspace
 *   src-tauri/Cargo.toml  → the Rust crate (and `env!("CARGO_PKG_VERSION")`)
 *   src-tauri/tauri.conf.json → the bundled installers
 *
 * A mismatch is invisible until a release ships with the wrong version stamped
 * on it, so this runs in CI. Pass `--fix` to rewrite Cargo.toml and
 * tauri.conf.json from package.json.
 */

import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const desktopRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const packageJsonPath = path.join(desktopRoot, "package.json");
const cargoTomlPath = path.join(desktopRoot, "src-tauri", "Cargo.toml");
const tauriConfPath = path.join(desktopRoot, "src-tauri", "tauri.conf.json");

const shouldFix = process.argv.includes("--fix");

const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf8"));
const expected = packageJson.version;

if (typeof expected !== "string" || expected.length === 0) {
  console.error("[version] package.json has no version field.");
  process.exit(1);
}

// Only the [package] table's own `version` key, not a dependency's.
const CARGO_VERSION_PATTERN = /(^\[package\][\s\S]*?^version\s*=\s*")([^"]*)(")/m;

const readCargoVersion = (source) => {
  const match = source.match(CARGO_VERSION_PATTERN);
  return match ? match[2] : null;
};

const cargoToml = readFileSync(cargoTomlPath, "utf8");
const tauriConf = JSON.parse(readFileSync(tauriConfPath, "utf8"));

const cargoVersion = readCargoVersion(cargoToml);
const tauriVersion = tauriConf.version;

const mismatches = [];
if (cargoVersion !== expected) {
  mismatches.push({ file: "src-tauri/Cargo.toml", found: cargoVersion });
}
if (tauriVersion !== expected) {
  mismatches.push({ file: "src-tauri/tauri.conf.json", found: tauriVersion });
}

if (mismatches.length === 0) {
  console.log(`[version] all three manifests agree on ${expected}.`);
  process.exit(0);
}

if (!shouldFix) {
  console.error(`[version] package.json says ${expected}, but:`);
  for (const { file, found } of mismatches) {
    console.error(`  ${file} says ${found ?? "<unreadable>"}`);
  }
  console.error("Run `node scripts/check-tauri-version.mjs --fix` to align them.");
  process.exit(1);
}

if (cargoVersion !== expected) {
  if (!CARGO_VERSION_PATTERN.test(cargoToml)) {
    console.error("[version] could not locate the [package] version in Cargo.toml.");
    process.exit(1);
  }
  writeFileSync(
    cargoTomlPath,
    cargoToml.replace(CARGO_VERSION_PATTERN, `$1${expected}$3`),
    "utf8",
  );
  console.log(`[version] Cargo.toml → ${expected}`);
}

if (tauriVersion !== expected) {
  tauriConf.version = expected;
  writeFileSync(tauriConfPath, `${JSON.stringify(tauriConf, null, 2)}\n`, "utf8");
  console.log(`[version] tauri.conf.json → ${expected}`);
}
