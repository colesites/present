// The voice and AI keys built into the app (`services/service_keys.rs`).
//
// A release build on CI has them in the environment. A build on this machine,
// dev or packaged, takes them from the environment or else from
// apps/desktop/.env.local or apps/web/.env.local (both git-ignored). Left out,
// the packaged app has no key: the Bible agent's microphone is asked to start,
// the token request fails, and listening stops.

import fs from "node:fs";
import path from "node:path";

const KEYS = ["ASSEMBLYAI_API_KEY", "GROQ_API_KEY", "AI_GATEWAY_API_KEY"];

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

/** Keys missing from the environment, read from the local env files. */
export function loadServiceKeys(desktopDir, label) {
  const keys = {};
  const envFiles = [path.join(desktopDir, ".env.local"), path.join(desktopDir, "..", "web", ".env.local")];
  for (const name of KEYS) {
    if (process.env[name]?.trim()) continue;
    for (const file of envFiles) {
      const value = readEnvFile(file)[name]?.trim();
      if (value) {
        keys[name] = value;
        console.log(`[${label}] ${name} from ${path.relative(path.join(desktopDir, "..", ".."), file)}`);
        break;
      }
    }
    if (!keys[name]) {
      console.warn(`[${label}] no ${name}: voice search and the AI agents will not work in this build`);
    }
  }
  return keys;
}
