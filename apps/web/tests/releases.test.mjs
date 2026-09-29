import assert from "node:assert/strict";
import test from "node:test";

const { isReleaseVersion, newestReleaseWith, releaseDownloads, releaseForVersion, updateFor } =
  await import("../src/lib/releases.ts");

const file = (slug, platform, size) => ({
  slug,
  platform,
  name: `${slug}.bin`,
  size,
  url: `https://storage.example/desktop/${slug}.bin`,
});

const manifest = {
  latest: "0.4.1",
  versions: [
    {
      version: "0.4.1",
      publishedAt: "2026-09-26T18:00:00Z",
      files: [
        file("mac-apple-silicon", "mac", 38_000_000),
        file("mac-intel", "mac", 39_000_000),
        file("windows", "windows", 41_000_000),
        file("ffmpeg-source", "source", 20_000_000),
      ],
    },
    {
      version: "0.4.0",
      publishedAt: "2026-09-24T18:00:00Z",
      files: [file("mac-apple-silicon", "mac", 38_000_000), file("mac-intel", "mac", 39_000_000)],
    },
  ],
};

test("a release is found by its version, and a version never published is not", () => {
  assert.equal(releaseForVersion(manifest, "0.4.0")?.version, "0.4.0");
  assert.equal(releaseForVersion(manifest, "0.3.9"), null);
});

test("an earlier release is offered by platform, at the site's own address", () => {
  const downloads = releaseDownloads(manifest.versions[0]);
  assert.deepEqual(
    downloads.map(({ label, path }) => [label, path]),
    [
      ["Apple Silicon", "/download/mac-apple-silicon/0.4.1"],
      ["Intel", "/download/mac-intel/0.4.1"],
      ["Windows", "/download/windows/0.4.1"],
    ],
  );
  for (const download of downloads) {
    assert.ok(!download.path.includes("storage.example"), "the file's own address is never the link");
  }
});

test("a release without a Windows build says so, and Linux appears only when built", () => {
  const downloads = releaseDownloads(manifest.versions[1]);
  assert.deepEqual(
    downloads.map(({ label, size }) => [label, size]),
    [
      ["Apple Silicon", 38_000_000],
      ["Intel", 39_000_000],
      ["Windows", null],
    ],
  );
});

test("only a version the release job writes is a version", () => {
  assert.equal(isReleaseVersion("0.4.1"), true);
  for (const value of ["latest", "0.4", "0.4.1-beta", "../0.4.1", ""]) {
    assert.equal(isReleaseVersion(value), false, value);
  }
});

// 0.4.5 built for the Mac alone so far; Windows and Linux are still 0.4.4's.
const macFirst = {
  latest: "0.4.5",
  versions: [
    {
      version: "0.4.5",
      publishedAt: "2026-09-30T18:00:00Z",
      files: [file("mac-apple-silicon", "mac", 38_000_000), file("mac-intel", "mac", 39_000_000)],
      updates: {
        "darwin-aarch64": { url: "https://storage.example/0.4.5/arm.tar.gz", signature: "sig-mac" },
      },
    },
    {
      version: "0.4.4",
      publishedAt: "2026-09-27T18:00:00Z",
      notes: "The 0.4.4 notes.",
      files: [
        file("mac-apple-silicon", "mac", 38_000_000),
        file("windows", "windows", 41_000_000),
        file("linux", "linux", 40_000_000),
      ],
      updates: {
        "darwin-aarch64": { url: "https://storage.example/0.4.4/arm.tar.gz", signature: "sig-mac-old" },
        "windows-x86_64": { url: "https://storage.example/0.4.4/setup.exe", signature: "sig-win" },
      },
    },
  ],
};

test("each download is the newest release's that has it, not nothing", () => {
  assert.equal(newestReleaseWith(macFirst, "mac-apple-silicon")?.version, "0.4.5");
  assert.equal(newestReleaseWith(macFirst, "windows")?.version, "0.4.4", "Windows keeps the one before");
  assert.equal(newestReleaseWith(macFirst, "linux")?.version, "0.4.4");
  assert.equal(newestReleaseWith(macFirst, "linux-rpm"), null, "never built is never offered");
});

test("the newest is found by version, wherever it sits in the file", () => {
  const shuffled = { ...macFirst, versions: [...macFirst.versions].reverse() };
  assert.equal(newestReleaseWith(shuffled, "mac-apple-silicon")?.version, "0.4.5");
});

test("an app updates to the newest release built for it", () => {
  assert.equal(updateFor(macFirst, "darwin-aarch64", "0.4.4")?.version, "0.4.5");

  const windows = updateFor(macFirst, "windows-x86_64", "0.4.3");
  assert.equal(windows?.version, "0.4.4", "Windows is offered 0.4.4 while 0.4.5 is Mac only");
  assert.equal(windows?.signature, "sig-win");
  assert.equal(windows?.notes, "The 0.4.4 notes.");

  assert.equal(updateFor(macFirst, "windows-x86_64", "0.4.4"), null, "already on the newest for it");
  assert.equal(updateFor(macFirst, "linux-x86_64", "0.4.3"), null, "no signed update for it");
});
