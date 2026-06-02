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

// Packages to stage if they exist at the repo root.
const PACKAGES = ["grandi", "grandiose", "@grandi"];

function stageNdiModules() {
  // Start clean so stale arch binaries never linger.
  fs.rmSync(STAGE_NODE_MODULES, { recursive: true, force: true });
  fs.mkdirSync(STAGE_NODE_MODULES, { recursive: true });

  let stagedAny = false;
  for (const pkg of PACKAGES) {
    const source = path.join(ROOT_NODE_MODULES, pkg);
    if (!fs.existsSync(source)) {
      continue;
    }
    const dest = path.join(STAGE_NODE_MODULES, pkg);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    // dereference: resolve symlinks to real files so the copy is self-contained.
    fs.cpSync(source, dest, { recursive: true, dereference: true });
    stagedAny = true;
    console.log(`[stage-ndi] staged ${pkg}`);
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
