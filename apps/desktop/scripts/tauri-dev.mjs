// `tauri dev`, linked against the app's own FFmpeg (ADR-003), as
// `tauri-build.mjs` builds the release: the FFmpeg the app ships, with the
// decoders and the resampler the sound engine needs (`services/sound`), not
// whatever FFmpeg this machine happens to have.
//
// Builds it first if it is not there (several minutes, once). Arguments pass
// through to `tauri dev`.
//
// The voice and AI keys are built into the app (`services/service_keys.rs`),
// from ASSEMBLYAI_API_KEY and AI_GATEWAY_API_KEY in the build's environment.
// Release builds get them from CI's secrets; a development build takes them
// from this machine's environment, or else from apps/desktop/.env.local or
// apps/web/.env.local (both git-ignored). Without them, voice search says it
// is not set up in this copy of Present.

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

const KEYS = ["ASSEMBLYAI_API_KEY", "AI_GATEWAY_API_KEY"];

/** `NAME=value` lines from an env file, quotes and comments aside. */
function readEnvFile(file) {
  if (!fs.existsSync(file)) return {};
  const values = {};
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const match = line.match(/^\s*(?:export\s+)?([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (!match) continue;
    let value = match[2];
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    } else {
      value = value.replace(/\s+#.*$/, "");
    }
    values[match[1]] = value;
  }
  return values;
}

const keys = {};
const envFiles = [path.join(DESKTOP_DIR, ".env.local"), path.join(DESKTOP_DIR, "..", "web", ".env.local")];
for (const name of KEYS) {
  if (process.env[name]?.trim()) continue;
  for (const file of envFiles) {
    const value = readEnvFile(file)[name]?.trim();
    if (value) {
      keys[name] = value;
      console.log(`[tauri-dev] ${name} from ${path.relative(path.join(DESKTOP_DIR, "..", ".."), file)}`);
      break;
    }
  }
  if (!keys[name]) {
    console.warn(`[tauri-dev] no ${name}: voice search and the AI agents will not work in this build`);
  }
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

run("bun", ["run", "tauri", "dev", ...process.argv.slice(2)], {
  ...process.env,
  ...keys,
  FFMPEG_DIR: PREFIX,
});
