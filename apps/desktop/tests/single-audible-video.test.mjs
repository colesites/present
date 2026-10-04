import assert from "node:assert/strict";
import test from "node:test";

import { readFileSync } from "node:fs";
import path from "node:path";

import { findElements, packageRoot } from "./lib/source-scan.mjs";

/**
 * The regression that must never return.
 *
 * No `<video>` in the application is allowed to produce sound. The video's
 * sound is played once, by Rust (`services/sound`); every `<video>` — the
 * operator's preview, the audience output, both stage displays, thumbnails,
 * the screen composer — is a muted picture. If any of them gains audio, the
 * congregation hears the same video twice, a fraction of a second apart.
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

test("every video element is a capture, never a file", () => {
  // Since 0.4.11 every video file is decoded by Rust and shown as its frames
  // (`RustVideo`, `services/media_frames.rs`): the center pane, the stage,
  // video props, composer regions, and the audience window before its native
  // view has a frame. What is left are cameras and HDMI capture, which arrive
  // as a stream (`srcObject`). A `<video src=…>` is WebKit decoding a file a
  // second time, on a clock of its own.
  const elements = findElements("video");
  assert.ok(
    elements.length >= 1,
    `found only ${elements.length} video elements; the scanner is probably broken`,
  );
  const files = elements.filter((element) => /(^|\s)src=/.test(element.attributes));
  assert.deepEqual(
    files.map((element) => `${element.file}:${element.line}`),
    [],
    "A <video> plays a file. Show it with RustVideo, which Rust decodes.",
  );
});

test("no video element in the application can produce sound", () => {
  // Since 0.4.11 the video's sound is played by Rust (`services/sound`):
  // FFmpeg decodes it beside the picture and it goes to the audio device the
  // graph names. Before, one `<video>` in the operator window was allowed to
  // be heard — a second decode of the file on WebKit's own clock, which
  // drifted from the screens and stopped whenever WebKit paused it. Now every
  // `<video>` is a picture.
  const audible = videoElements().filter((element) => element.audio === "audible");

  const described = audible
    .map((element) => `${element.file}:${element.line}`)
    .join("\n  ");

  assert.equal(
    audible.length,
    0,
    `Expected no audible <video>. Found ${audible.length}:\n  ${described}\n\n` +
      "The video's sound is Rust's; a <video> that can be heard plays it a second time.",
  );
});

test("the video's sound is played by Rust, from the file the operator chose", () => {
  // The operator window names the live video's file when it selects it, and
  // Rust plays that file's sound (`commands/playback.rs`, `services/sound`).
  const hook = readFileSync(
    path.join(packageRoot, "src/renderer/shared/hooks/useShowVideoSync.ts"),
    "utf8",
  );
  assert.ok(
    hook.includes("selectPlaybackMedia(currentVideoItem.id, currentVideoItem.url"),
    "useShowVideoSync no longer tells Rust which file the live video is, so it has no sound.",
  );
  const engine = readFileSync(path.join(packageRoot, "src-tauri/src/services/sound/mod.rs"), "utf8");
  assert.ok(engine.includes("fn report_position"), "the sound engine no longer reports where it is");
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

test("the stage displays have no video element at all", () => {
  // Their video is decoded by Rust (`StageSlideView` shows it with
  // `RustVideo`), so nothing on a stage can be heard or drift.
  const stagePlayers = videoElements().filter(
    (element) =>
      element.file.includes("features/stage/") ||
      element.file.includes("features/screen-composer/"),
  );
  assert.deepEqual(
    stagePlayers.map((player) => `${player.file}:${player.line}`),
    [],
  );
});
