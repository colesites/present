import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const repositoryRoot = path.resolve(import.meta.dirname, "../..");
const desktopPackage = JSON.parse(
  fs.readFileSync(path.join(repositoryRoot, "apps/desktop/package.json"), "utf8"),
);
const changelog = fs.readFileSync(
  path.join(repositoryRoot, "CHANGELOG.md"),
  "utf8",
);
const tag =
  process.argv.slice(2).find((value) => value.startsWith("desktop-v")) ??
  process.env.GITHUB_REF_NAME ??
  "";
const expectedTag = `desktop-v${desktopPackage.version}`;

assert.match(
  desktopPackage.version,
  /^\d+\.\d+\.\d+$/,
  "Desktop package version must use MAJOR.MINOR.PATCH",
);
assert.equal(
  tag,
  expectedTag,
  `Release tag ${JSON.stringify(tag)} must match ${expectedTag}`,
);
assert.match(
  changelog,
  new RegExp(`^## \\[${desktopPackage.version.replaceAll(".", "\\.")}\\]`, "m"),
  `CHANGELOG.md must contain a section for ${desktopPackage.version}`,
);

console.log(`Verified ${expectedTag}`);
