// Publish the built installers to Cloudflare R2, and keep the manifest the
// download page reads.
//
// R2 serves objects publicly but will not let a browser list a bucket — that
// needs credentials nobody should ship to a browser. So every release writes
// `desktop/releases.json` beside the files: the latest version, and every
// version before it, with a URL for each download. The page reads that one
// file and needs nothing else.
//
// Objects are laid out by version so a release is self-contained and an old
// one is never overwritten:
//
//     desktop/0.4.0/mac/Present_0.4.0_aarch64.dmg
//     desktop/0.4.0/windows/Present_0.4.0_x64_en-US.msi
//     desktop/0.4.0/updates/darwin-aarch64/Present.app.tar.gz
//     desktop/releases.json
//
// A signed build (TAURI_SIGNING_PRIVATE_KEY set, so `tauri build` made update
// packages and their `.sig` files) also publishes what the app updates itself
// from: the package, and its signature in the manifest under the platform's
// updater target, `darwin-aarch64`, `darwin-x86_64` or `windows-x86_64`. The
// website answers the app's "is there a newer version?" from those
// (`apps/web/src/app/api/desktop/update`).
//
// Usage:
//   node publish-to-r2.mjs --version 0.4.0 --artifacts <dir> [--dry-run]
//
// Expects in the environment:
//   R2_ACCOUNT_ID, R2_BUCKET, R2_PUBLIC_BASE_URL,
//   AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY   (an R2 API token)

import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import os from "node:os";

const args = process.argv.slice(2);
const flag = (name, fallback = null) => {
  const at = args.indexOf(`--${name}`);
  return at === -1 ? fallback : args[at + 1];
};
const dryRun = args.includes("--dry-run");

const version = flag("version");
const artifactsDir = flag("artifacts");
if (!version || !artifactsDir) {
  console.error("usage: publish-to-r2.mjs --version <x.y.z> --artifacts <dir> [--dry-run]");
  process.exit(2);
}

const required = ["R2_ACCOUNT_ID", "R2_BUCKET", "R2_PUBLIC_BASE_URL"];
const missing = required.filter((key) => !process.env[key]?.trim());
if (missing.length && !dryRun) {
  console.error(`[publish] missing environment: ${missing.join(", ")}`);
  process.exit(2);
}

const bucket = process.env.R2_BUCKET ?? "present";
const endpoint = `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`;
const publicBase = (process.env.R2_PUBLIC_BASE_URL ?? "").replace(/\/+$/, "");

/**
 * Which download a built file is.
 *
 * Matched on what Tauri actually names its bundles. Anything unrecognised is
 * skipped rather than guessed at — a file with no slug has nowhere to appear
 * on the download page, and inventing one would put it under the wrong
 * heading.
 */
const classify = (name) => {
  const lower = name.toLowerCase();
  // What the app updates itself from, and signatures: published with the
  // update, not offered on the download page. A `.app.tar.gz` used to be
  // classed as a Mac download, and could have taken the `.dmg`'s place.
  if (lower.endsWith(".app.tar.gz") || lower.endsWith(".sig")) return null;
  if (lower.endsWith(".dmg")) {
    const arm = /aarch64|arm64|silicon/.test(lower);
    return { slug: arm ? "mac-apple-silicon" : "mac-intel", platform: "mac" };
  }
  if (lower.endsWith(".msi")) return { slug: "windows", platform: "windows" };
  if (lower.endsWith(".exe")) return { slug: "windows", platform: "windows" };
  if (lower.endsWith(".deb")) return { slug: "linux", platform: "linux" };
  if (lower.endsWith(".rpm")) return { slug: "linux-rpm", platform: "linux" };
  if (lower.endsWith(".appimage")) return { slug: "linux-appimage", platform: "linux" };
  // FFmpeg's source travels with every bundle, because the LGPL asks that
  // whoever has the binary can get the source it was built from.
  if (/^ffmpeg-.*\.tar\.xz$/.test(lower)) return { slug: "ffmpeg-source", platform: "source" };
  return null;
};

const walk = (dir) =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    return entry.isDirectory() ? walk(full) : [full];
  });

const aws = (argv, options = {}) =>
  execFileSync("aws", [...argv, "--endpoint-url", endpoint], {
    encoding: "utf8",
    stdio: options.quiet ? ["ignore", "pipe", "pipe"] : "inherit",
  });

if (!existsSync(artifactsDir)) {
  console.error(`[publish] no artifacts at ${artifactsDir}`);
  process.exit(1);
}

const files = [];
for (const full of walk(artifactsDir)) {
  const name = path.basename(full);
  const kind = classify(name);
  if (!kind) {
    console.log(`[publish] skipping ${name} — not a download`);
    continue;
  }
  const key = `desktop/${version}/${kind.platform}/${name}`;
  files.push({
    slug: kind.slug,
    platform: kind.platform,
    name,
    size: statSync(full).size,
    key,
    url: `${publicBase}/${key}`,
    localPath: full,
  });
}

/**
 * The platform an update package is for, as the updater names it. Each Mac
 * architecture is built on a runner of its own, so the runner's is the
 * bundle's.
 */
const macTarget = () => (process.arch === "arm64" ? "darwin-aarch64" : "darwin-x86_64");

const updates = [];
for (const full of walk(artifactsDir)) {
  const name = path.basename(full);
  const lower = name.toLowerCase();
  // The Windows update is the NSIS installer, run quietly; the MSI stays a
  // download only.
  const target = lower.endsWith(".app.tar.gz")
    ? macTarget()
    : lower.endsWith("-setup.exe")
      ? "windows-x86_64"
      : null;
  if (!target) continue;
  const signature = `${full}.sig`;
  if (!existsSync(signature)) {
    console.log(`[publish] ${name} has no signature; this build cannot update anyone`);
    continue;
  }
  const key = `desktop/${version}/updates/${target}/${name}`;
  updates.push({
    target,
    name,
    key,
    url: `${publicBase}/${key}`,
    signature: readFileSync(signature, "utf8").trim(),
    localPath: full,
  });
}

if (files.length === 0) {
  console.error("[publish] nothing recognisable to publish");
  process.exit(1);
}

/** This version's section of CHANGELOG.md, for the update's notes. */
const notesFor = (wanted) => {
  try {
    const changelog = readFileSync(
      path.join(path.dirname(new URL(import.meta.url).pathname), "..", "..", "..", "CHANGELOG.md"),
      "utf8",
    );
    const heading = new RegExp(`^## \\[${wanted.replaceAll(".", "\\.")}\\][^\\n]*\\n`, "m");
    const start = changelog.search(heading);
    if (start === -1) return null;
    const body = changelog.slice(start).replace(heading, "");
    const end = body.search(/^## \[/m);
    return (end === -1 ? body : body.slice(0, end)).trim() || null;
  } catch {
    return null;
  }
};

console.log(`[publish] ${files.length} files for ${version}:`);
for (const file of files) {
  console.log(`  ${file.slug.padEnd(20)} ${file.name} (${(file.size / 1e6).toFixed(1)} MB)`);
}

for (const update of updates) {
  console.log(`  ${`update ${update.target}`.padEnd(20)} ${update.name}`);
}

if (dryRun) {
  console.log("[publish] dry run — nothing uploaded");
  process.exit(0);
}

for (const file of [...files, ...updates]) {
  console.log(`[publish] → ${file.key}`);
  aws(["s3", "cp", file.localPath, `s3://${bucket}/${file.key}`]);
}

// The manifest is read, added to and written back, so a version published
// today does not erase the ones published before it.
const manifestKey = "desktop/releases.json";
const scratch = path.join(os.tmpdir(), `releases-${process.pid}.json`);
let manifest = { latest: null, versions: [] };
try {
  aws(["s3", "cp", `s3://${bucket}/${manifestKey}`, scratch], { quiet: true });
  manifest = JSON.parse(readFileSync(scratch, "utf8"));
  console.log(`[publish] manifest has ${manifest.versions?.length ?? 0} version(s)`);
} catch {
  console.log("[publish] no manifest yet — starting one");
}

// Each platform publishes on its own, so a version's entry is added to
// rather than replaced: macOS running after Windows must not erase the
// Windows downloads from the release they both belong to. A file published
// twice — a re-run of the same platform — replaces its older self.
const existing = (manifest.versions ?? []).find((each) => each.version === version);
const published = files.map(({ slug, platform, name, size, url }) => ({
  slug,
  platform,
  name,
  size,
  url,
}));
const kept = (existing?.files ?? []).filter(
  (file) => !published.some((each) => each.slug === file.slug),
);

// Updates are kept per platform in the same way.
const updatesByTarget = { ...(existing?.updates ?? {}) };
for (const { target, url, signature } of updates) {
  updatesByTarget[target] = { url, signature };
}

const notes = notesFor(version) ?? existing?.notes ?? null;
const entry = {
  version,
  publishedAt: existing?.publishedAt ?? new Date().toISOString(),
  ...(notes ? { notes } : {}),
  files: [...kept, ...published].sort((a, b) => a.slug.localeCompare(b.slug)),
  ...(Object.keys(updatesByTarget).length > 0 ? { updates: updatesByTarget } : {}),
};

const versions = [
  entry,
  ...(manifest.versions ?? []).filter((each) => each.version !== version),
];
// Newest first, by semver where it parses, so the page can take [0].
versions.sort((a, b) => {
  const parts = (value) => String(value.version).split(".").map((n) => Number(n) || 0);
  const [x, y] = [parts(a), parts(b)];
  for (let i = 0; i < Math.max(x.length, y.length); i += 1) {
    if ((y[i] ?? 0) !== (x[i] ?? 0)) return (y[i] ?? 0) - (x[i] ?? 0);
  }
  return 0;
});

const next = { latest: versions[0].version, versions };
writeFileSync(scratch, `${JSON.stringify(next, null, 2)}\n`);
aws([
  "s3",
  "cp",
  scratch,
  `s3://${bucket}/${manifestKey}`,
  "--content-type",
  "application/json",
  "--cache-control",
  // Short, so a new release shows up quickly, but not zero: the page asks for
  // this on every visit.
  "public, max-age=60",
]);

console.log(`[publish] ${version} published; manifest lists ${versions.length} version(s)`);
