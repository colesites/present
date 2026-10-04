import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

import test from "node:test";

import {
  collectSourceFiles,
  findElements,
  findInSources,
  packageRoot,
} from "./lib/source-scan.mjs";

/**
 * The complete inventory of ways this application can make a sound.
 *
 * `single-audible-video.test.mjs` guards one class of audio source: the
 * `<video>` elements. It scans for `<video>` and nothing else, so the other
 * routes to a speaker are invisible to it — and known-issues §1 lived in one
 * of them.
 *
 * Stage 5's gate is an audio regression suite, and a suite that can only see
 * one source class is not one. This file is the other half: every remaining way
 * audio reaches an output device, pinned as it behaves **today**, before the
 * media engine moves any of it.
 *
 * These are characterisation tests in the audit's §10.8 sense. They assert what
 * is true, not what ought to be — including the defect. When Stage 5 routes
 * both playback paths through one Rust-owned sink, the assertion that records
 * the defect fails, and that failure is the deliverable: it is how the fix
 * announces itself rather than drifting in unnoticed.
 */

const readSource = (relative) => readFileSync(path.join(packageRoot, relative), "utf8");

/**
 * The two sources that are meant to be heard — the live video's sound and the
 * backing track — are both played by Rust since 0.4.11 (`services/sound`),
 * on the device the audio graph names. The webview makes no sound at all.
 */
const PLAYED_BY_RUST = {
  presentationVideo: {
    owner: "src/renderer/shared/hooks/useShowVideoSync.ts",
    call: "selectPlaybackMedia(",
  },
  backingTrack: {
    owner: "src/features/sidebar-rail/panels/AudioTabPanel.tsx",
    call: "backingTrackPlay(",
  },
};

test("the application constructs no bare Audio element", () => {
  // `new Audio()` is invisible to a `<video>` scanner. The backing track was
  // one until it moved to Rust; another would be a source the device choice
  // and the levels do not reach.
  const constructed = findInSources("new Audio(");

  const described = constructed.map((hit) => `${hit.file}:${hit.line}`).join("\n  ");
  assert.equal(
    constructed.length,
    0,
    `Expected no \`new Audio()\`. Found ${constructed.length}:\n  ${described}\n\n` +
      "Sound is played by Rust (services/sound), on the device Audio settings name.",
  );
});

test("no <audio> elements exist, so the inventory above is complete", () => {
  // If this fails the application grew a source class neither suite scans for.
  // Extend the scanner before deciding the new element is harmless.
  const elements = findElements("audio");

  const described = elements.map((element) => `${element.file}:${element.line}`).join("\n  ");
  assert.equal(
    elements.length,
    0,
    `Found ${elements.length} <audio> element(s):\n  ${described}\n\n` +
      "Neither audio suite classifies these. Add them to the inventory.",
  );
});

test("no element in the webview is pointed at an output device", () => {
  // known-issues §1 was a `setSinkId` that reached one element and not the
  // other. Nothing in the webview plays sound now, so nothing is routed there:
  // the device is Rust's, for both sources at once.
  // The call form, not the identifier: prose and type annotations mention
  // `setSinkId` and must not read as a place that routes audio.
  const callSites = [
    ...findInSources("setSinkId(", ".ts"),
    ...findInSources("setSinkId(", ".tsx"),
  ];
  assert.deepEqual(
    callSites.map((hit) => `${hit.file}:${hit.line}`),
    [],
    "A webview element is being routed to a device, so it is making a sound Rust does not.",
  );
});

test("both audible sources are played by Rust", () => {
  for (const [name, entry] of Object.entries(PLAYED_BY_RUST)) {
    assert.ok(
      readSource(entry.owner).includes(entry.call),
      `${name} (${entry.owner}) no longer hands its sound to Rust.`,
    );
  }
  const engine = readSource("src-tauri/src/services/sound/mod.rs");
  assert.ok(engine.includes("BACKING_TRACK") && engine.includes("VIDEO"), "the engine lost a voice");
});

test("the audience YouTube embed is muted by its URL", () => {
  // A prop can put a YouTube embed on the audience screen. It plays in a
  // webview, so no `muted` attribute governs it and no `<video>` scanner sees
  // it: its silence is one `mute=1` in a parameter list that is edited by hand.
  //
  // Two lists: the app's, which development embeds directly, and the
  // website's, which builds the player an installed app frames through it
  // (`shared/lib/youtube-embed.mjs`).
  const outputWindow = readSource("src/renderer/output/OutputWindow.tsx");
  assert.ok(
    outputWindow.includes("youtubeEmbedUrl(") && outputWindow.includes("shared/lib/youtube-embed.mjs"),
    "The audience window no longer builds its YouTube embed with the shared builder.",
  );

  for (const [builder, name] of [
    [readSource("src/shared/lib/youtube-embed.mjs"), "the app's YouTube player"],
    [readSource("../web/src/lib/youtube-embed.ts"), "the website's YouTube page"],
  ]) {
    const player = builder.slice(builder.indexOf("youtubePlayerUrl ="));
    assert.ok(
      /\bmute:\s*"1"/.test(player),
      `${name} lost \`mute: "1"\`. It will play sound over the presenter's own ` +
        "audio on the congregation's screen.",
    );
  }
});

test("the microphone is captured by Rust, not the webview", () => {
  // Speech-to-search used to open the microphone in the webview and route it
  // through a WebKit audio graph whose only guard against feeding the house
  // system was one gain node pinned to zero. Since 0.4.11 Rust opens the
  // device (`services/sound/input.rs`) and hands the samples over; there is
  // no graph in the webview to misconnect.
  const speech = readSource("src/features/scripture/hooks/useSpeechRecognition.ts");
  assert.ok(speech.includes("startMicrophone("), "speech no longer listens through Rust");
  for (const webkit of ["getUserMedia(", "createMediaStreamSource(", "audioContext.destination"]) {
    assert.ok(!speech.includes(webkit), `speech capture uses the webview again: ${webkit}`);
  }
});

test("captured HDMI streams are attached only to muted elements", () => {
  // `getUserMedia` screen capture is assigned via `srcObject`, which carries
  // its own audio tracks. The elements it lands in are mirrors and must be
  // muted like every other mirror.
  const assignments = findInSources("srcObject");
  assert.ok(assignments.length > 0, "no srcObject assignments found; the scanner is broken");

  const hostFiles = [...new Set(assignments.map((hit) => hit.file))];
  for (const file of hostFiles) {
    const audible = findElements("video").filter(
      (element) => element.file === file && !/(^|\s)muted/.test(element.attributes),
    );
    assert.equal(
      audible.length,
      0,
      `${file} assigns a captured stream and contains an unmuted <video>. ` +
        "A capture stream's audio tracks would play on a mirror surface.",
    );
  }
});

test("no source file outside the inventory plays media programmatically", () => {
  // `.play()` on an element the suites do not know about is how a fourth audio
  // path would arrive. Every call today belongs to a file already accounted
  // for above or in the video guard.
  // Every `.play()` in the tree, with what it plays. The reason is carried
  // per entry rather than as a bare list, because the two kinds are not
  // interchangeable: an element player can put sound in a room, a transport
  // call cannot. A new file in the first group is a new audio path.
  const known = new Map([
    // Media elements — each one can make a sound.
    ["src/features/present/PresentCenterArea.tsx", "element: the audible Show View player"],
    ["src/features/sidebar-rail/panels/AudioTabPanel.tsx", "element: the backing-track player"],
    ["src/features/slides/OutputPreview.tsx", "element: a muted mirror"],
    ["src/features/stage/StageSlideView.tsx", "element: a muted mirror, the stage's Current Slide"],
    ["src/renderer/output/OutputWindow.tsx", "element: muted mirrors on the audience screen"],
    ["src/renderer/shared/hooks/useShowVideoSync.ts", "element: drives the Show View player"],
    // Not an element. `playback.play()` is a Rust command on the media
    // transport, which owns whether a video is running and owns no audio.
    ["src/renderer/tauri/boot-probe.ts", "transport: proves the Rust transport refuses with nothing loaded"],
    [
      "src/renderer/shared/hooks/usePlaybackTransport.ts",
      "transport: the adapter onto the Rust transport, which owns no audio",
    ],
  ]);

  const unexpected = new Set();
  for (const extension of [".ts", ".tsx"]) {
    for (const file of collectSourceFiles(undefined, extension)) {
      const relative = path.relative(packageRoot, file);
      if (known.has(relative)) continue;
      if (/\.play\(\)/.test(readFileSync(file, "utf8"))) unexpected.add(relative);
    }
  }

  assert.deepEqual(
    [...unexpected].sort(),
    [],
    "These files start media playback and are not in the audio inventory. " +
      "Classify them: mirror, mixer input, or capture graph.",
  );
});
