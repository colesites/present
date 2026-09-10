import assert from "node:assert/strict";
import test from "node:test";

import { findElements } from "./lib/source-scan.mjs";

/**
 * The regression that must never return.
 *
 * Exactly one `<video>` in the application is allowed to produce sound: the
 * Show-View player the operator watches. Every other one — the audience output,
 * both stage displays, the preview, thumbnails, the screen composer — is a
 * muted mirror. If any of them gains audio, the congregation hears the same
 * video twice, a fraction of a second apart.
 *
 * Today that invariant is held by hard-coded `muted` attributes spread across
 * nine files (audit §5.3). It is convention, not architecture: one new `<video>`
 * that forgets the attribute reintroduces the echo, and nothing catches it.
 * This test catches it.
 *
 * The audit asks for this suite before Stages 4 and 5 move any of this code,
 * so there is something to verify parity *against*. Stage 5 replaces the
 * convention with a single Rust-owned audio sink; until then, this is the
 * guard.
 */

/** The one element allowed to be audible, and why. */
const THE_AUDIBLE_PLAYER = {
  file: "src/features/present/PresentCenterArea.tsx",
  reason:
    "the presenter Show View — the application's only audible player, driven by useShowVideoSync",
};

/**
 * How a `<video>` treats audio.
 *
 * `muted` or `muted={true}` can never make a sound. `muted={expression}` can,
 * depending on the expression. No `muted` attribute always can.
 */
const classify = (attributes) => {
  const match = attributes.match(/(^|\s)muted(\s*=\s*\{([^}]*)\})?/);
  if (!match) return "audible";
  if (match[2] === undefined) return "silent";
  return match[3].trim() === "true" ? "silent" : "audible";
};

const videoElements = () =>
  findElements("video").map((element) => ({
    file: element.file,
    line: element.line,
    audio: classify(element.attributes),
  }));

test("every video element is accounted for", () => {
  const elements = videoElements();
  assert.ok(
    elements.length >= 15,
    `found only ${elements.length} video elements; the scanner is probably broken`,
  );
});

test("exactly one video element in the application can produce sound", () => {
  const audible = videoElements().filter((element) => element.audio === "audible");

  const described = audible
    .map((element) => `${element.file}:${element.line}`)
    .join("\n  ");

  assert.equal(
    audible.length,
    1,
    `Expected exactly one audible <video>. Found ${audible.length}:\n  ${described}\n\n` +
      "A second audible player means the congregation hears the video twice. " +
      "Every mirror surface must be hard-coded `muted`.",
  );
});

test("the audible one is the presenter Show View", () => {
  const [audible] = videoElements().filter((element) => element.audio === "audible");

  assert.equal(
    audible.file,
    THE_AUDIBLE_PLAYER.file,
    `The audible <video> moved. It is meant to be ${THE_AUDIBLE_PLAYER.reason}.`,
  );
});

test("the output window's players are all silent", () => {
  // The audience surface is the one that matters most: it is the screen the
  // congregation is looking at.
  const outputPlayers = videoElements().filter((element) =>
    element.file.includes("renderer/output/OutputWindow.tsx"),
  );

  assert.ok(outputPlayers.length > 0, "no video elements found in the output window");
  for (const player of outputPlayers) {
    assert.equal(
      player.audio,
      "silent",
      `${player.file}:${player.line} can produce audio on the audience screen`,
    );
  }
});

test("both stage displays are silent", () => {
  const stagePlayers = videoElements().filter(
    (element) =>
      element.file.includes("features/stage/") ||
      element.file.includes("features/screen-composer/"),
  );

  assert.ok(stagePlayers.length > 0, "no video elements found in the stage surfaces");
  for (const player of stagePlayers) {
    assert.equal(
      player.audio,
      "silent",
      `${player.file}:${player.line} can produce audio on a stage display`,
    );
  }
});
