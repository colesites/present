// `tauri build`, with the LGPL FFmpeg linked and bundled (ADR-003).
//
// 1. builds FFmpeg with scripts/build-ffmpeg.sh, unless the pinned build is
//    already there (on Windows the build needs MSYS2 and MSVC, so CI runs the
//    script itself first and this only checks for the result);
// 2. stages its libraries with scripts/stage-tauri-ffmpeg.mjs;
// 3. runs `tauri build` with FFMPEG_DIR pointing at that build, so the app
//    links it rather than whatever FFmpeg the machine has.
//
// Arguments pass through to `tauri build`.

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const DESKTOP_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PREFIX = path.join(DESKTOP_DIR, "src-tauri", "ffmpeg", "prefix");

function run(command, args, env = process.env) {
  const result = spawnSync(command, args, { cwd: DESKTOP_DIR, stdio: "inherit", env });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

if (process.platform === "win32") {
  if (!fs.existsSync(path.join(PREFIX, "BUILD-STAMP"))) {
    console.error(
      "[tauri-build] no FFmpeg build; run `bash scripts/build-ffmpeg.sh` in MSYS2 from an MSVC developer prompt",
    );
    process.exit(1);
  }
} else {
  run("bash", [path.join("scripts", "build-ffmpeg.sh")]);
}
run(process.execPath, [path.join("scripts", "stage-tauri-ffmpeg.mjs")]);
run("bun", ["run", "tauri", "build", ...process.argv.slice(2)], {
  ...process.env,
  FFMPEG_DIR: PREFIX,
  PRESENT_BUNDLE_BUILD: "1",
});
