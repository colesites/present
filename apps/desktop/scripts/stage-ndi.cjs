// Stages the native NDI packages (grandi + its @grandi/<arch> prebuilt addon,
// and grandiose if present) into `apps/desktop/.ndi/node_modules` so they can
// be shipped as an UNPACKED extra resource (Resources/node_modules/...).
//
// Why this is needed:
//   - The monorepo uses pnpm `node-linker=hoisted`, so grandi lives in the
//     repo-root node_modules, not in apps/desktop/node_modules. Electron Forge
//     only bundles deps from the app's own node_modules, so grandi was never
//     packaged.
//   - grandi is ESM-only and ships a native .node addon, which cannot be
//     loaded from inside app.asar. Shipping it unpacked on the real filesystem
//     and importing by absolute file:// URL is the reliable path.
//
// Run automatically by forge.config.ts (prePackage hook); also runnable
// standalone: `node scripts/stage-ndi.cjs`.

const fs = require("node:fs");
const path = require("node:path");

const DESKTOP_DIR = path.resolve(__dirname, "..");
const ROOT_NODE_MODULES = path.resolve(DESKTOP_DIR, "../../node_modules");
const STAGE_NODE_MODULES = path.resolve(DESKTOP_DIR, ".ndi/node_modules");

// Entry packages to stage if they exist at the repo root. Their transitive
// runtime dependencies are resolved and staged automatically (below) — with
// node-linker=hoisted those deps (e.g. node-gyp-build) live flat at the repo
// root, NOT inside grandi/node_modules, so they must be copied explicitly.
const ENTRY_PACKAGES = ["grandi", "grandiose"];
// Native prebuilt arch packages for grandi (contain the .node binaries).
const ARCH_PACKAGES = ["@grandi"];

// Resolve a package directory by walking up node_modules from `fromDir`, then
// falling back to the repo root (covers both nested and hoisted layouts).
function resolvePackageDir(pkgName, fromDir) {
  let dir = fromDir;
  for (let i = 0; i < 12; i += 1) {
    const candidate = path.join(dir, "node_modules", pkgName);
    if (fs.existsSync(path.join(candidate, "package.json"))) return candidate;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  const rootCandidate = path.join(ROOT_NODE_MODULES, pkgName);
  return fs.existsSync(path.join(rootCandidate, "package.json"))
    ? rootCandidate
    : null;
}

function copyPackage(sourceDir, pkgName) {
  const dest = path.join(STAGE_NODE_MODULES, pkgName);
  if (fs.existsSync(dest)) return; // already staged
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  // dereference: resolve symlinks so the copy is self-contained.
  fs.cpSync(sourceDir, dest, { recursive: true, dereference: true });
  console.log(`[stage-ndi] staged ${pkgName}`);
}

// Stage a package AND its transitive runtime dependencies.
function stagePackageWithDeps(pkgName, fromDir, seen) {
  if (seen.has(pkgName)) return;
  const sourceDir = resolvePackageDir(pkgName, fromDir);
  if (!sourceDir) {
    console.warn(`[stage-ndi] dependency not found: ${pkgName}`);
    return;
  }
  seen.add(pkgName);
  copyPackage(sourceDir, pkgName);

  let deps = {};
  try {
    const manifest = JSON.parse(
      fs.readFileSync(path.join(sourceDir, "package.json"), "utf8"),
    );
    deps = { ...(manifest.dependencies ?? {}) };
  } catch {
    // ignore unparsable manifest
  }
  for (const depName of Object.keys(deps)) {
    stagePackageWithDeps(depName, sourceDir, seen);
  }
}

function stageNdiModules() {
  // Start clean so stale arch binaries never linger.
  fs.rmSync(STAGE_NODE_MODULES, { recursive: true, force: true });
  fs.mkdirSync(STAGE_NODE_MODULES, { recursive: true });

  const seen = new Set();
  let stagedAny = false;

  for (const pkg of ENTRY_PACKAGES) {
    if (resolvePackageDir(pkg, DESKTOP_DIR)) {
      stagePackageWithDeps(pkg, DESKTOP_DIR, seen);
      stagedAny = true;
    }
  }

  // Arch packages are scoped dirs with their own subpackages; copy wholesale.
  for (const scope of ARCH_PACKAGES) {
    const source = path.join(ROOT_NODE_MODULES, scope);
    if (fs.existsSync(source)) {
      copyPackage(source, scope);
      stagedAny = true;
    }
  }

  if (!stagedAny) {
    console.warn(
      "[stage-ndi] No NDI packages found at repo root node_modules — " +
        "NDI output will be unavailable in this build.",
    );
  }
  return stagedAny;
}

if (require.main === module) {
  stageNdiModules();
}

module.exports = { stageNdiModules, STAGE_NODE_MODULES };
