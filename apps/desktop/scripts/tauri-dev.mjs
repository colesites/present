// `tauri dev`, linked against the app's own FFmpeg (ADR-003), as
// `tauri-build.mjs` builds the release: the FFmpeg the app ships, with the
// decoders and the resampler the sound engine needs (`services/sound`), not
// whatever FFmpeg this machine happens to have.
//
// Builds it first if it is not there (several minutes, once). Arguments pass
// through to `tauri dev`.

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
      "[tauri-dev] no FFmpeg build; run `bash scripts/build-ffmpeg.sh` in MSYS2 from an MSVC developer prompt",
    );
    process.exit(1);
  }
} else {
  run("bash", [path.join("scripts", "build-ffmpeg.sh")]);
}

run("bun", ["run", "tauri", "dev", ...process.argv.slice(2)], { ...process.env, FFMPEG_DIR: PREFIX });
