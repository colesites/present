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
 * `single-audible-video.test.mjs` guards one class of audio source: the fifteen
 * `<video>` elements. That guard is real and it holds, but it scans for
 * `<video>` and nothing else, so three other routes to a speaker are invisible
 * to it — and the live bug in known-issues §1 lives in one of them.
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
 * The two paths that are meant to be heard.
 *
 * Everything else in the application is either a muted mirror or a capture
 * graph. These two are the mixer inputs Stage 5 has to unify.
 */
const AUDIBLE_PLAYBACK_PATHS = {
  presentationVideo: {
    file: "src/features/present/PresentCenterArea.tsx",
    element: "<video>",
    routed: true,
    reason: "the presenter Show View, driven by useShowVideoSync",
  },
  backingTrack: {
    file: "src/features/sidebar-rail/panels/AudioTabPanel.tsx",
    element: "new Audio()",
    routed: false,
    reason: "the backing-track playlist player — known-issues §1",
  },
};

test("the application constructs exactly one bare Audio element", () => {
  // `new Audio()` is invisible to a `<video>` scanner, which is why the backing
  // track player could drift out of the audio architecture unnoticed for as
  // long as it has. A second one appearing is a second unrouted audio path.
  const constructed = findInSources("new Audio(");

  const described = constructed.map((hit) => `${hit.file}:${hit.line}`).join("\n  ");
  assert.equal(
    constructed.length,
    1,
    `Expected exactly one \`new Audio()\`. Found ${constructed.length}:\n  ${described}\n\n` +
      "Every audio element outside the mixer is a path that ignores the " +
      "audio-output-device setting.",
  );
  assert.equal(constructed[0].file, AUDIBLE_PLAYBACK_PATHS.backingTrack.file);
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

test("audio device routing reaches exactly one of the two playback paths", () => {
  // This is known-issues §1, pinned. `setSinkId` is the only way a web media
  // element can be pointed at a chosen output device, and it is called on the
  // Show-View video and nowhere else. So the audio-output-device setting moves
  // video audio to the desk and leaves backing tracks on the laptop speakers.
  //
  // Stage 5 makes device selection a property of one sink rather than of each
  // element, at which point this test is expected to fail and be rewritten.
  const callSites = findInSources("setSinkId", ".ts").filter(
    (hit) => !hit.file.includes("renderer/tauri/capability-probe.ts"),
  );

  const files = [...new Set(callSites.map((hit) => hit.file))];
  assert.deepEqual(
    files,
    ["src/renderer/shared/hooks/useShowVideoSync.ts"],
    "setSinkId moved or spread. The audio-output-device setting covers only " +
      "the files listed here.",
  );

  const backingTrack = readSource(AUDIBLE_PLAYBACK_PATHS.backingTrack.file);
  assert.ok(
    !backingTrack.includes("setSinkId"),
    "The backing-track player now calls setSinkId. known-issues §1 is fixed — " +
      "update this suite to assert both paths share one sink.",
  );
});

test("the audience YouTube embed is muted by its URL", () => {
  // A prop can put a YouTube embed on the audience screen. It plays in a
  // webview, so no `muted` attribute governs it and no `<video>` scanner sees
  // it: its silence is one `mute=1` in a parameter list that is edited by hand.
  const outputWindow = readSource("src/renderer/output/OutputWindow.tsx");

  const builder = outputWindow.slice(outputWindow.indexOf("function getYouTubeEmbedUrl"));
  assert.ok(
    /\bmute:\s*"1"/.test(builder),
    "The audience YouTube embed lost `mute: \"1\"`. It will play sound over " +
      "the presenter's own audio on the congregation's screen.",
  );
});

test("the speech capture graph reaches the speakers only through a zero gain", () => {
  // Speech-to-search connects the microphone to `audioContext.destination`.
  // That is deliberate — a ScriptProcessorNode does not fire unless it reaches
  // a destination — and it is made safe by a single gain node pinned to zero.
  //
  // Raise that gain and the operator's microphone feeds back through the house
  // system mid-service. It is one line, and nothing else guards it.
  const speech = readSource("src/features/scripture/hooks/useSpeechRecognition.ts");

  assert.ok(
    speech.includes("silenceSink.gain.value = 0"),
    "The speech capture graph's silence gain changed. The microphone now " +
      "reaches the audio destination at non-zero gain.",
  );
  assert.ok(
    /silenceSink\.connect\(audioContext\.destination\)/.test(speech),
    "The speech graph's connection to the destination changed shape; " +
      "re-check what the zero gain is still protecting.",
  );
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
  // Exactly the files that call it today. Deliberately not "every file in the
  // video guard": an allowlist wider than reality would wave through a new
  // `.play()` in a file that has never had one.
  const known = new Set([
    "src/features/present/PresentCenterArea.tsx",
    "src/features/settings/components/SettingsScreen.tsx",
    "src/features/sidebar-rail/panels/AudioTabPanel.tsx",
    "src/features/slides/OutputPreview.tsx",
    "src/features/stage/WorshipStageDisplayWindow.tsx",
    "src/renderer/output/OutputWindow.tsx",
    "src/renderer/shared/hooks/useShowVideoSync.ts",
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
