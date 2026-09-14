// Stages the NDI runtime for the Tauri bundle.
//
// The Electron build ships `libndi` inside grandi's prebuilt package
// (scripts/stage-ndi.cjs). The Tauri build does not load grandi — it opens the
// runtime itself (src-tauri/src/services/ndi/library.rs) — but it ships the
// same library from the same place, so both builds carry the runtime a service
// was rehearsed on. The loader looks for it in the bundle's `ndi/` resource
// directory before any runtime installed on the machine.
//
// Copies this platform's library and its licence files from
// `@grandi/<platform>-<arch>` into `src-tauri/ndi/`, which tauri.conf.json
// bundles. Nothing else is copied: no Node addon, no JavaScript.
//
// Run by `tauri build` (beforeBuildCommand); also runnable on its own:
// `node scripts/stage-tauri-ndi.mjs`.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const DESKTOP_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ROOT_NODE_MODULES = path.resolve(DESKTOP_DIR, "../../node_modules");
const STAGE_DIR = path.join(DESKTOP_DIR, "src-tauri", "ndi");

// Kept in the staging directory: it is committed so `bundle.resources` always
// names a directory that exists, including on a machine with no NDI package.
const KEEP = new Set(["README.md", ".gitignore"]);

// `NDILIB_LIBRARY_NAME` per platform, and the licence files NewTek's
// redistribution terms require to travel with it.
const LIBRARY = /^(libndi\.dylib|libndi\.so(\.\d+)*|Processing\.NDI\.Lib\.x64\.dll)$/;
const LICENCE = /^(LICENSE\.pdf|libndi_licenses\.txt|.*licen[cs]e.*\.txt)$/i;

const platform = { darwin: "darwin", win32: "win32", linux: "linux" }[process.platform];
const arch = { x64: "x64", arm64: "arm64", arm: "armv7l" }[process.arch];

for (const entry of fs.existsSync(STAGE_DIR) ? fs.readdirSync(STAGE_DIR) : []) {
  if (!KEEP.has(entry)) {
    fs.rmSync(path.join(STAGE_DIR, entry), { recursive: true, force: true });
  }
}
fs.mkdirSync(STAGE_DIR, { recursive: true });

const source = platform && arch ? path.join(ROOT_NODE_MODULES, "@grandi", `${platform}-${arch}`) : null;
if (!source || !fs.existsSync(source)) {
  console.warn(
    `[stage-tauri-ndi] no @grandi package for ${process.platform}-${process.arch}; ` +
      "this bundle will use an installed NDI runtime if there is one.",
  );
  process.exit(0);
}

let libraries = 0;
for (const entry of fs.readdirSync(source)) {
  if (!LIBRARY.test(entry) && !LICENCE.test(entry)) continue;
  fs.cpSync(path.join(source, entry), path.join(STAGE_DIR, entry), { dereference: true });
  if (LIBRARY.test(entry)) libraries += 1;
  console.log(`[stage-tauri-ndi] staged ${entry}`);
}

if (libraries === 0) {
  console.warn(`[stage-tauri-ndi] ${source} holds no NDI library; nothing to ship.`);
}
