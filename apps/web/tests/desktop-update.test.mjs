import assert from "node:assert/strict";
import test from "node:test";

const { isLaterVersion, updateFor } = await import("../src/lib/releases.ts");

const manifest = {
  latest: "0.4.4",
  versions: [
    {
      version: "0.4.4",
      publishedAt: "2026-09-28T10:00:00Z",
      notes: "### Fixed\n\n- Things.",
      files: [],
      updates: {
        "darwin-aarch64": { url: "https://storage.example/0.4.4/Present.app.tar.gz", signature: "c2ln" },
        "windows-x86_64": { url: "https://storage.example/0.4.4/Present_0.4.4_x64-setup.exe", signature: "d2lu" },
      },
    },
    { version: "0.4.3", publishedAt: "2026-09-27T10:00:00Z", files: [] },
  ],
};

test("versions compare by number, not as text", () => {
  assert.equal(isLaterVersion("0.4.10", "0.4.9"), true);
  assert.equal(isLaterVersion("0.4.4", "0.4.4"), false);
  assert.equal(isLaterVersion("0.4.3", "0.4.4"), false);
  assert.equal(isLaterVersion("1.0.0", "0.9.9"), true);
  assert.equal(isLaterVersion("nonsense", "0.4.4"), false);
  assert.equal(isLaterVersion("0.4.4", "nonsense"), false);
});

test("an older app on a built platform is told where the newer one is, signed", () => {
  assert.deepEqual(updateFor(manifest, "darwin-aarch64", "0.4.3"), {
    version: "0.4.4",
    notes: "### Fixed\n\n- Things.",
    pub_date: "2026-09-28T10:00:00Z",
    url: "https://storage.example/0.4.4/Present.app.tar.gz",
    signature: "c2ln",
  });
});

test("nothing is offered to an app that is current, or a platform not built", () => {
  assert.equal(updateFor(manifest, "darwin-aarch64", "0.4.4"), null, "already current");
  assert.equal(updateFor(manifest, "darwin-x86_64", "0.4.3"), null, "Intel not built yet");
  assert.equal(
    updateFor(
      { ...manifest, versions: [{ ...manifest.versions[0], updates: { "darwin-aarch64": { url: "x", signature: "" } } }] },
      "darwin-aarch64",
      "0.4.3",
    ),
    null,
    "an unsigned package is never offered",
  );
});
