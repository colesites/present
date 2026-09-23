// Checks that FFmpeg's source is beside the bundle, and is the source the
// bundle was built from (ADR-003, after-stage-7.md §5).
//
// Present ships FFmpeg under the LGPL, which asks that whoever receives the
// app can receive that source too. CI uploads the tarball with every bundle;
// this fails the build if it is missing, or if it is not the pinned release.
//
// `node scripts/check-ffmpeg-source.mjs`

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const DESKTOP_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SCRIPT = path.join(DESKTOP_DIR, "scripts", "build-ffmpeg.sh");

const fail = (message) => {
  console.error(`[check-ffmpeg-source] ${message}`);
  process.exit(1);
};

// The one place the version and checksum are written down.
const build = fs.readFileSync(SCRIPT, "utf8");
const version = build.match(/^VERSION="([^"]+)"/m)?.[1];
const expected = build.match(/^SHA256="([0-9a-f]{64})"/m)?.[1];
if (!version || !expected) fail(`could not read the version and checksum from ${SCRIPT}`);

const tarball = path.join(DESKTOP_DIR, "src-tauri", "ffmpeg", "cache", `ffmpeg-${version}.tar.xz`);
if (!fs.existsSync(tarball)) {
  fail(`${tarball} is missing; the bundle would ship without the source it must offer`);
}
const actual = crypto.createHash("sha256").update(fs.readFileSync(tarball)).digest("hex");
if (actual !== expected) fail(`${tarball} is not FFmpeg ${version}: ${actual}`);

console.log(`[check-ffmpeg-source] FFmpeg ${version} source present and matching`);
