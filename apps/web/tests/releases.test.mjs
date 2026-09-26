import assert from "node:assert/strict";
import test from "node:test";

const { isReleaseVersion, releaseDownloads, releaseForVersion } = await import(
  "../src/lib/releases.ts"
);

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
