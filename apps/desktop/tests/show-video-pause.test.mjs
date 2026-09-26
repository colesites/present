import assert from "node:assert/strict";
import test from "node:test";

import {
  OPERATOR_PAUSE_WITHIN_MS,
  isOperatorPause,
  shouldResume,
} from "../src/shared/lib/show-video-pause.mjs";

const pause = (overrides) => ({
  nowMs: 10_000,
  touchedAtMs: 9_800,
  programmatic: false,
  ended: false,
  hidden: false,
  ...overrides,
});

test("a pause right after the operator touches the player is theirs", () => {
  assert.equal(isOperatorPause(pause()), true);
});

test("a pause nobody touched the player for is the system's, as when the computer sleeps", () => {
  // The window still showing, and the last touch long ago, or never.
  assert.equal(isOperatorPause(pause({ touchedAtMs: 10_000 - OPERATOR_PAUSE_WITHIN_MS - 1 })), false);
  assert.equal(isOperatorPause(pause({ touchedAtMs: Number.NEGATIVE_INFINITY })), false);
});

test("the hook's own pause, the end of a video and a hidden window are not the operator", () => {
  assert.equal(isOperatorPause(pause({ programmatic: true })), false);
  assert.equal(isOperatorPause(pause({ ended: true })), false);
  assert.equal(isOperatorPause(pause({ hidden: true })), false);
});

const player = (overrides) => ({
  nowMs: 10_000,
  transportPlaying: true,
  paused: true,
  ended: false,
  seeking: false,
  hidden: false,
  operatorPausedAtMs: Number.NEGATIVE_INFINITY,
  ...overrides,
});

test("a video meant to be playing, found paused after a sleep, starts again", () => {
  assert.equal(shouldResume(player()), true);
});

test("it is left alone when it is meant to be paused, is playing, or is busy", () => {
  assert.equal(shouldResume(player({ transportPlaying: false })), false);
  assert.equal(shouldResume(player({ paused: false })), false);
  assert.equal(shouldResume(player({ ended: true })), false);
  assert.equal(shouldResume(player({ seeking: true })), false);
  assert.equal(shouldResume(player({ hidden: true })), false);
});

test("the operator's own pause is not undone while the transport catches up", () => {
  assert.equal(shouldResume(player({ operatorPausedAtMs: 9_500 })), false);
  assert.equal(
    shouldResume(player({ operatorPausedAtMs: 10_000 - OPERATOR_PAUSE_WITHIN_MS - 1 })),
    true,
    "and a pause from long ago that the transport has since overruled does not hold it",
  );
});
