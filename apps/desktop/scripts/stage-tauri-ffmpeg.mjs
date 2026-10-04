// Stages the FFmpeg libraries for the Tauri bundle (ADR-003).
//
// Takes them from the LGPL build `scripts/build-ffmpeg.sh` made in
// `src-tauri/ffmpeg/prefix/` and copies what the app loads at run time into
// `src-tauri/ffmpeg/runtime/`, with the licence notices into
// `src-tauri/ffmpeg/licenses/`. Where each platform's bundle puts them is in
// `tauri.macos.conf.json`, `tauri.windows.conf.json` and
// `tauri.linux.conf.json`; this checks that they bundle what it staged — by
// name on macOS, where a new FFmpeg major version renames every library.
//
// Refuses a build that is not the one the script made — a system FFmpeg is
// GPL on most machines (Homebrew's is) and must never ship.
//
// `node scripts/stage-tauri-ffmpeg.mjs`, run by `scripts/tauri-build.mjs`.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const DESKTOP_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const TAURI_DIR = path.join(DESKTOP_DIR, "src-tauri");
const FFMPEG_DIR = path.join(TAURI_DIR, "ffmpeg");
const PREFIX = path.join(FFMPEG_DIR, "prefix");
const RUNTIME = path.join(FFMPEG_DIR, "runtime");
const LICENSES = path.join(FFMPEG_DIR, "licenses");

// The libraries the Rust crate links, per platform (`Cargo.toml`: avfilter is
// macOS only, for `scale_vt`).
const LIBRARIES = {
  darwin: ["avcodec", "avformat", "avutil", "swscale", "swresample", "avfilter"],
  linux: ["avcodec", "avformat", "avutil", "swscale", "swresample"],
  win32: ["avcodec", "avformat", "avutil", "swscale", "swresample"],
}[process.platform];

const fail = (message) => {
  console.error(`[stage-tauri-ffmpeg] ${message}`);
  process.exit(1);
};

if (!LIBRARIES) fail(`no FFmpeg staging for ${process.platform}`);

const stamp = path.join(PREFIX, "BUILD-STAMP");
if (!fs.existsSync(stamp)) {
  fail(`no FFmpeg build in ${PREFIX}; run scripts/build-ffmpeg.sh first`);
}
const source = fs.readFileSync(path.join(PREFIX, "share", "licenses", "FFMPEG-SOURCE.txt"), "utf8");
if (!source.includes("GNU Lesser General Public License")) {
  fail("the FFmpeg build does not describe itself as LGPL; refusing to ship it");
}

/** The file each library is loaded by, as the platform names it. */
function runtimeFile(library) {
  if (process.platform === "win32") {
    const bin = path.join(PREFIX, "bin");
    const name = fs.readdirSync(bin).find((entry) => new RegExp(`^${library}-\\d+\\.dll$`).test(entry));
    return name && path.join(bin, name);
  }
  const lib = path.join(PREFIX, "lib");
  const pattern =
    process.platform === "darwin"
      ? new RegExp(`^lib${library}\\.\\d+\\.dylib$`)
      : new RegExp(`^lib${library}\\.so\\.\\d+$`);
  const name = fs.readdirSync(lib).find((entry) => pattern.test(entry));
  return name && path.join(lib, name);
}

for (const directory of [RUNTIME, LICENSES]) {
  for (const entry of fs.existsSync(directory) ? fs.readdirSync(directory) : []) {
    if (entry !== "README.md") fs.rmSync(path.join(directory, entry), { recursive: true, force: true });
  }
  fs.mkdirSync(directory, { recursive: true });
}

// On Windows the linker needs each library's import library in lib/, which
// is where the Rust build looks. Checked here, before the Rust build, so a
// build without them fails in seconds rather than at the final link.
if (process.platform === "win32") {
  for (const library of LIBRARIES) {
    if (!fs.existsSync(path.join(PREFIX, "lib", `${library}.lib`))) {
      fail(
        `${library}.lib is not in ${path.join(PREFIX, "lib")}; the link would fail with ` +
          "LNK1181. Rebuild FFmpeg with scripts/build-ffmpeg.sh, which puts it there.",
      );
    }
  }
}

const staged = [];
for (const library of LIBRARIES) {
  const file = runtimeFile(library);
  if (!file) fail(`${library} is missing from ${PREFIX}`);
  const name = path.basename(file);
  // The versioned name is what the app was linked against; copy the file it
  // points at, not the link.
  fs.copyFileSync(fs.realpathSync(file), path.join(RUNTIME, name));
  staged.push(name);
  console.log(`[stage-tauri-ffmpeg] staged ${name}`);
}
for (const entry of fs.readdirSync(path.join(PREFIX, "share", "licenses"))) {
  fs.copyFileSync(path.join(PREFIX, "share", "licenses", entry), path.join(LICENSES, entry));
}

// The platform config must bundle exactly these.
const readConfig = (name) => JSON.parse(fs.readFileSync(path.join(TAURI_DIR, name), "utf8"));
const isRuntimeDir = (source) => source.replace(/\/$/, "") === "ffmpeg/runtime";
if (process.platform === "darwin") {
  // Frameworks are named one by one, with their major version. Syphon's is
  // bundled beside them (`src-tauri/syphon`), and is not this script's.
  const named = readConfig("tauri.macos.conf.json")
    .bundle.macOS.frameworks.filter((framework) => framework.startsWith("ffmpeg/"))
    .sort();
  const expected = staged.map((name) => `ffmpeg/runtime/${name}`).sort();
  if (JSON.stringify(named) !== JSON.stringify(expected)) {
    fail(
      `tauri.macos.conf.json bundles ${JSON.stringify(named)} but the build has ` +
        `${JSON.stringify(expected)}; update it for this FFmpeg`,
    );
  }
} else if (process.platform === "linux") {
  const linux = readConfig("tauri.linux.conf.json").bundle.linux;
  for (const format of ["deb", "rpm", "appimage"]) {
    const files = linux[format]?.files ?? {};
    if (!Object.values(files).some(isRuntimeDir)) {
      fail(`tauri.linux.conf.json does not put ffmpeg/runtime in the ${format}`);
    }
  }
} else {
  const resources = readConfig("tauri.windows.conf.json").bundle.resources;
  if (!Object.keys(resources).some(isRuntimeDir)) {
    fail("tauri.windows.conf.json does not put ffmpeg/runtime beside the executable");
  }
}
