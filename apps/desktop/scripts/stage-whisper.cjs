// Stages a SELF-CONTAINED whisper-cli (binary + its non-system dylibs,
// relinked to load from @loader_path) plus the base.en model into
// apps/desktop/.whisper-stage/whisper, which forge.config ships as an
// extraResource → Resources/whisper.
//
//   Resources/whisper/<platform>/whisper-cli(+ *.dylib)
//   Resources/whisper/models/ggml-base.en.bin
//
// macOS: resolves the dylib graph with otool and rewrites install names with
// install_name_tool so the bundled binary runs without Homebrew present.
// Windows/Linux: copies the binary and any sibling .dll/.so files (provide a
// self-contained build of whisper-cli for those platforms).
//
// Run automatically by forge.config.ts (prePackage); also standalone:
//   node scripts/stage-whisper.cjs

const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const DESKTOP_DIR = path.resolve(__dirname, "..");
const STAGE_WHISPER = path.resolve(DESKTOP_DIR, ".whisper-stage/whisper");

const binaryName =
  process.platform === "win32" ? "whisper-cli.exe" : "whisper-cli";

function resolveSourceBinary() {
  const candidates = [
    process.env.WHISPER_CLI_PATH,
    path.join(DESKTOP_DIR, ".whisper/bin", binaryName),
  ].filter(Boolean);
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return fs.realpathSync(candidate);
  }
  return null;
}

function resolveSourceModel() {
  const candidates = [
    process.env.WHISPER_MODEL_PATH,
    path.join(DESKTOP_DIR, ".whisper/models/ggml-base.en.bin"),
  ].filter(Boolean);
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

// ── macOS dylib bundling ──
function macRpaths(file) {
  const out = execFileSync("otool", ["-l", file], { encoding: "utf8" });
  const rpaths = [];
  const lines = out.split("\n");
  for (let i = 0; i < lines.length; i += 1) {
    if (lines[i].includes("LC_RPATH")) {
      for (let j = i; j < Math.min(i + 4, lines.length); j += 1) {
        const m = lines[j].trim().match(/^path (.+?) \(offset/);
        if (m) {
          rpaths.push(m[1]);
          break;
        }
      }
    }
  }
  return rpaths;
}

// Returns [{ ref, real }] for every non-system dependency, resolving
// @rpath / @loader_path references to their real on-disk paths.
function macDeps(file) {
  const fileDir = path.dirname(file);
  const rpaths = macRpaths(file);
  const out = execFileSync("otool", ["-L", file], { encoding: "utf8" });
  const refs = out
    .split("\n")
    .slice(1)
    .map((line) => line.trim().split(" ")[0])
    .filter(Boolean)
    .filter((ref) => !ref.startsWith("/usr/lib/") && !ref.startsWith("/System/"));

  const result = [];
  for (const ref of refs) {
    if (path.basename(ref) === path.basename(file)) continue; // self id
    let real = null;
    if (ref.startsWith("@rpath/")) {
      const rel = ref.slice("@rpath/".length);
      for (const rp of rpaths) {
        const base = rp.replace("@loader_path", fileDir).replace("@executable_path", fileDir);
        const candidate = path.resolve(base, rel);
        if (fs.existsSync(candidate)) {
          real = fs.realpathSync(candidate);
          break;
        }
      }
    } else if (ref.startsWith("@loader_path/") || ref.startsWith("@executable_path/")) {
      const rel = ref.replace(/^@(loader|executable)_path\//, "");
      const candidate = path.resolve(fileDir, rel);
      if (fs.existsSync(candidate)) real = fs.realpathSync(candidate);
    } else if (!ref.startsWith("@")) {
      if (fs.existsSync(ref)) real = fs.realpathSync(ref);
    }
    if (real && fs.existsSync(real)) {
      result.push({ ref, real });
    }
  }
  return result;
}

// ggml loads its compute backends (libggml-cpu.so, libggml-blas.so, …) at
// runtime as plugins, not as linked dylibs — they live in the ggml `libexec`
// dir, not `lib`. Find them so we can bundle them and point GGML_BACKEND_PATH
// at the bundle.
function findGgmlBackendSos(copiedReals) {
  const sos = [];
  for (const real of copiedReals) {
    if (!path.basename(real).startsWith("libggml")) continue;
    const libexec = path.resolve(path.dirname(real), "../libexec");
    if (!fs.existsSync(libexec)) continue;
    for (const entry of fs.readdirSync(libexec)) {
      if (entry.endsWith(".so")) sos.push(path.join(libexec, entry));
    }
    break;
  }
  return [...new Set(sos)];
}

function bundleMac(sourceBinary, destDir) {
  fs.mkdirSync(destDir, { recursive: true });
  const destBinary = path.join(destDir, "whisper-cli");
  fs.copyFileSync(sourceBinary, destBinary);
  fs.chmodSync(destBinary, 0o755);

  // BFS the transitive non-system dylib graph, copying each real file once
  // and recording every original reference string so we can relink it.
  const copied = new Map(); // realPath -> basename
  const refsByFile = new Map(); // destFilePath -> [{ref, real}]
  const queue = [{ src: sourceBinary, dest: destBinary }];
  const seen = new Set([sourceBinary]);

  const drainQueue = () => {
    while (queue.length > 0) {
      const { src, dest } = queue.shift();
      const deps = macDeps(src);
      refsByFile.set(dest, deps);
      for (const { real } of deps) {
        const base = path.basename(real);
        const destDep = path.join(destDir, base);
        if (!copied.has(real)) {
          fs.copyFileSync(real, destDep);
          fs.chmodSync(destDep, 0o644);
          copied.set(real, base);
        }
        if (!seen.has(real)) {
          seen.add(real);
          queue.push({ src: real, dest: destDep });
        }
      }
    }
  };
  drainQueue();

  // Bundle the ggml runtime backend plugins (.so) + their deps, and copy
  // them into the same dir (GGML_BACKEND_PATH points here at runtime).
  for (const so of findGgmlBackendSos([...copied.keys()])) {
    const base = path.basename(so);
    const destSo = path.join(destDir, base);
    if (!copied.has(so)) {
      fs.copyFileSync(so, destSo);
      fs.chmodSync(destSo, 0o755);
      copied.set(so, base);
      queue.push({ src: so, dest: destSo });
    }
  }
  drainQueue();

  // Relink every recorded reference → @loader_path/<base>, and give each
  // copied dylib a matching id.
  for (const [destFile, deps] of refsByFile) {
    for (const { ref, real } of deps) {
      const base = copied.get(real);
      if (!base) continue;
      try {
        execFileSync("install_name_tool", [
          "-change",
          ref,
          `@loader_path/${base}`,
          destFile,
        ]);
      } catch {
        // ignore
      }
    }
  }
  for (const base of copied.values()) {
    try {
      execFileSync("install_name_tool", [
        "-id",
        `@loader_path/${base}`,
        path.join(destDir, base),
      ]);
    } catch {
      // ignore
    }
  }
  return destBinary;
}

function bundleGeneric(sourceBinary, destDir) {
  fs.mkdirSync(destDir, { recursive: true });
  const dest = path.join(destDir, binaryName);
  fs.copyFileSync(sourceBinary, dest);
  if (process.platform !== "win32") fs.chmodSync(dest, 0o755);
  // Copy sibling shared libraries next to the binary.
  const srcDir = path.dirname(sourceBinary);
  for (const entry of fs.readdirSync(srcDir)) {
    if (/\.(dll|so|so\.\d+)$/i.test(entry)) {
      fs.copyFileSync(path.join(srcDir, entry), path.join(destDir, entry));
    }
  }
  return dest;
}

function stageWhisper() {
  const sourceBinary = resolveSourceBinary();
  const sourceModel = resolveSourceModel();
  if (!sourceBinary) {
    console.warn(
      "[stage-whisper] No whisper-cli found (set WHISPER_CLI_PATH or place " +
        "it at .whisper/bin/). Voice operator will be unavailable in this build.",
    );
    return false;
  }

  fs.rmSync(STAGE_WHISPER, { recursive: true, force: true });
  const platformDir = path.join(STAGE_WHISPER, process.platform);

  if (process.platform === "darwin") {
    bundleMac(sourceBinary, platformDir);
  } else {
    bundleGeneric(sourceBinary, platformDir);
  }
  console.log(`[stage-whisper] staged whisper-cli for ${process.platform}`);

  if (sourceModel) {
    const modelsDir = path.join(STAGE_WHISPER, "models");
    fs.mkdirSync(modelsDir, { recursive: true });
    fs.copyFileSync(sourceModel, path.join(modelsDir, "ggml-base.en.bin"));
    console.log("[stage-whisper] staged ggml-base.en.bin");
  } else {
    console.warn(
      "[stage-whisper] No model found — run `pnpm whisper:model` or set " +
        "WHISPER_MODEL_PATH.",
    );
  }

  return true;
}

if (require.main === module) {
  stageWhisper();
}

module.exports = { stageWhisper, STAGE_WHISPER };
